import { getAccessToken, getGoogleSettings } from "@/lib/google/auth";
import { GoogleConfigError, GoogleUnavailableError, isGoogleUnavailableError } from "@/lib/google/errors";
import { googleFetch, googleJson } from "@/lib/google/request";
import { logger } from "@/lib/logger";

// Google Drive v3 for candidate documents. Files are private: the only sharing is with the
// service account (or the impersonated user), and the admin portal streams them through an
// authenticated API route rather than handing out any Drive link.
//
// `supportsAllDrives` is set on every call so the same code works whether GOOGLE_DRIVE_FOLDER_ID
// lives in My Drive or on a Shared Drive. A Shared Drive is the recommended production setup: a
// service account has no Drive storage quota of its own, so uploads into a plain My Drive folder
// fail with storageQuotaExceeded unless GOOGLE_IMPERSONATE_USER is set.

const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";

const FILE_FIELDS = "id,name,mimeType,size,createdTime,modifiedTime,parents,appProperties,trashed";
const UPLOAD_TIMEOUT_MS = 120_000;

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  // Drive returns size as a decimal string.
  size?: string;
  createdTime?: string;
  modifiedTime?: string;
  parents?: string[];
  appProperties?: Record<string, string>;
  trashed?: boolean;
};

export type DriveUploadInput = {
  name: string;
  parentId: string;
  mimeType: string;
  body: Buffer;
  // Small key/value metadata stored on the file and queryable. Used to carry the upload ticket
  // and the owning record so an orphaned file can always be traced back.
  appProperties?: Record<string, string>;
  description?: string;
};

function withCommonParams(params: Record<string, string>): Record<string, string> {
  return { supportsAllDrives: "true", ...params };
}

function driveUrl(path: string, params: Record<string, string> = {}): string {
  const search = new URLSearchParams(withCommonParams(params)).toString();
  return `${DRIVE_API}${path}${search ? `?${search}` : ""}`;
}

// Drive's query language quotes string literals with single quotes; a literal backslash or
// apostrophe in a value must be escaped or the query changes meaning.
export function escapeQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// ── Upload ───────────────────────────────────────────────────────────────────

// Resumable upload, used for every size: Drive documents the multipart endpoint as suitable for
// files up to 5 MB, and a CV may be up to 10 MB. Two calls: open a session, then send the bytes.
//
// The session URI carries its own authorisation, so the second call must NOT repeat the bearer
// token, and it is never retried automatically - a retried upload would create a second file.
export async function uploadFile(input: DriveUploadInput): Promise<DriveFile> {
  const { sharedDriveId } = getGoogleSettings();
  const metadata = {
    name: input.name,
    parents: [input.parentId],
    mimeType: input.mimeType,
    ...(input.appProperties ? { appProperties: input.appProperties } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(sharedDriveId ? { driveId: sharedDriveId } : {}),
  };

  const session = await googleFetch({
    method: "POST",
    url: `${DRIVE_UPLOAD_API}?${new URLSearchParams(withCommonParams({ uploadType: "resumable", fields: FILE_FIELDS })).toString()}`,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": input.mimeType,
      "X-Upload-Content-Length": String(input.body.byteLength),
    },
    body: JSON.stringify(metadata),
    operation: "drive.files.create.session",
  });
  if (!session) throw new Error("unreachable: drive session cannot be null");
  await session.arrayBuffer().catch(() => undefined);

  const sessionUri = session.headers.get("location");
  if (!sessionUri) throw new GoogleUnavailableError("Google Drive did not return an upload session.");

  let response: Response;
  try {
    response = await fetch(sessionUri, {
      method: "PUT",
      headers: { "Content-Type": input.mimeType, "Content-Length": String(input.body.byteLength) },
      // Buffer is a Uint8Array; pass a plain view so undici does not re-encode it.
      body: new Uint8Array(input.body),
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    if (isGoogleUnavailableError(err)) throw new GoogleUnavailableError("The upload to Google Drive did not complete.", { cause: err });
    throw err;
  }

  if (!response.ok) {
    let reason = `http_${response.status}`;
    try {
      const body = (await response.json()) as { error?: { status?: string; errors?: { reason?: string }[] } };
      // The specific reason first: a quota failure arrives as PERMISSION_DENIED /
      // storageQuotaExceeded, and only the latter names the actual problem.
      reason = body.error?.errors?.[0]?.reason ?? body.error?.status ?? reason;
    } catch {
      // Non-JSON body; the status is enough.
    }
    logger.error("drive.upload_failed", { status: response.status, reason });
    if (reason === "storageQuotaExceeded") {
      throw new GoogleConfigError(
        "Google Drive refused the upload because the service account has no storage quota of its own. " +
          "Move GOOGLE_DRIVE_FOLDER_ID to a Shared Drive and set GOOGLE_DRIVE_SHARED_DRIVE_ID, or set GOOGLE_IMPERSONATE_USER."
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new GoogleConfigError(`Google Drive denied the upload (${reason}). Check that the folder is shared with the service account as an Editor.`);
    }
    throw new GoogleUnavailableError(`Google Drive returned HTTP ${response.status} for the upload.`);
  }

  const file = (await response.json()) as DriveFile;
  if (!file?.id) throw new GoogleUnavailableError("Google Drive did not return a file id for the upload.");
  return file;
}

// ── Metadata ─────────────────────────────────────────────────────────────────

export async function getFile(fileId: string): Promise<DriveFile | null> {
  return googleJson<DriveFile>({
    url: driveUrl(`/${encodeURIComponent(fileId)}`, { fields: FILE_FIELDS }),
    operation: "drive.files.get",
    allowNotFound: true,
  });
}

type FileList = { files?: DriveFile[]; nextPageToken?: string };

// Files directly inside `parentId` matching an optional extra query clause, newest first.
export async function listFiles(
  parentId: string,
  opts: { extraQuery?: string; pageSize?: number; maxPages?: number; orderBy?: string } = {}
): Promise<DriveFile[]> {
  const { sharedDriveId } = getGoogleSettings();
  const clauses = [`'${escapeQueryValue(parentId)}' in parents`, "trashed = false"];
  if (opts.extraQuery) clauses.push(opts.extraQuery);

  const found: DriveFile[] = [];
  let pageToken: string | undefined;
  const maxPages = opts.maxPages ?? 20;

  for (let page = 0; page < maxPages; page += 1) {
    const params: Record<string, string> = {
      q: clauses.join(" and "),
      fields: `nextPageToken,files(${FILE_FIELDS})`,
      pageSize: String(opts.pageSize ?? 100),
      orderBy: opts.orderBy ?? "createdTime desc",
      includeItemsFromAllDrives: "true",
      ...(sharedDriveId ? { corpora: "drive", driveId: sharedDriveId } : {}),
      ...(pageToken ? { pageToken } : {}),
    };
    const result = await googleJson<FileList>({ url: driveUrl("", params), operation: "drive.files.list" });
    found.push(...(result?.files ?? []));
    pageToken = result?.nextPageToken;
    if (!pageToken) break;
  }
  return found;
}

// Exactly one file with this name inside the folder, or null. Drive allows duplicate names, so
// the newest is returned and any older duplicate is reported by the caller's cleanup job.
export async function findFileByName(parentId: string, name: string): Promise<DriveFile | null> {
  const files = await listFiles(parentId, { extraQuery: `name = '${escapeQueryValue(name)}'`, pageSize: 5, maxPages: 1 });
  return files[0] ?? null;
}

export type DriveFileUpdate = {
  name?: string;
  appProperties?: Record<string, string>;
  description?: string;
  addParents?: string[];
  removeParents?: string[];
};

// Renames a file, moves it between folders, or replaces its metadata. Moving is how a staged
// upload becomes a permanent document: the bytes are never copied.
export async function updateFile(fileId: string, update: DriveFileUpdate): Promise<DriveFile> {
  const params: Record<string, string> = { fields: FILE_FIELDS };
  if (update.addParents?.length) params.addParents = update.addParents.join(",");
  if (update.removeParents?.length) params.removeParents = update.removeParents.join(",");

  const body: Record<string, unknown> = {};
  if (update.name !== undefined) body.name = update.name;
  if (update.appProperties !== undefined) body.appProperties = update.appProperties;
  if (update.description !== undefined) body.description = update.description;

  const file = await googleJson<DriveFile>({
    method: "PATCH",
    url: driveUrl(`/${encodeURIComponent(fileId)}`, params),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    operation: "drive.files.update",
  });
  if (!file) throw new Error("unreachable: drive.files.update cannot return null");
  return file;
}

// Permanent delete. Deleting a file that is already gone succeeds.
export async function deleteFile(fileId: string): Promise<void> {
  await googleFetch({
    method: "DELETE",
    url: driveUrl(`/${encodeURIComponent(fileId)}`),
    operation: "drive.files.delete",
    allowNotFound: true,
  });
}

// ── Download ─────────────────────────────────────────────────────────────────

// The raw bytes as a stream, for the authenticated admin download route. Returns null when the
// file no longer exists, so a document whose Drive file was removed shows as "not found" rather
// than a 500.
export async function downloadFileStream(fileId: string): Promise<{ body: ReadableStream<Uint8Array>; size: number | null } | null> {
  const response = await googleFetch({
    url: driveUrl(`/${encodeURIComponent(fileId)}`, { alt: "media" }),
    operation: "drive.files.download",
    allowNotFound: true,
    timeoutMs: 60_000,
  });
  if (!response || !response.body) return null;
  const length = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  return { body: response.body, size: Number.isFinite(length) ? length : null };
}

// The whole file in memory. Only for the PDF signature check, which reads a file the server just
// received itself and whose size is already capped.
export async function downloadFileBuffer(fileId: string): Promise<Buffer | null> {
  const response = await googleFetch({
    url: driveUrl(`/${encodeURIComponent(fileId)}`, { alt: "media" }),
    operation: "drive.files.download",
    allowNotFound: true,
    timeoutMs: 60_000,
  });
  if (!response) return null;
  return Buffer.from(await response.arrayBuffer());
}

// ── Folders ──────────────────────────────────────────────────────────────────

export const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

export async function findFolder(parentId: string, name: string): Promise<DriveFile | null> {
  const files = await listFiles(parentId, {
    extraQuery: `name = '${escapeQueryValue(name)}' and mimeType = '${FOLDER_MIME_TYPE}'`,
    pageSize: 5,
    maxPages: 1,
  });
  return files[0] ?? null;
}

export async function createFolder(parentId: string, name: string): Promise<DriveFile> {
  const { sharedDriveId } = getGoogleSettings();
  const file = await googleJson<DriveFile>({
    method: "POST",
    url: driveUrl("", { fields: FILE_FIELDS }),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME_TYPE,
      parents: [parentId],
      ...(sharedDriveId ? { driveId: sharedDriveId } : {}),
    }),
    operation: "drive.folders.create",
  });
  if (!file) throw new Error("unreachable: drive.folders.create cannot return null");
  return file;
}

// Finds a subfolder, creating it when absent. Concurrent callers can both create one; the loser's
// duplicate is harmless (both are valid parents) but is logged so it can be tidied up.
export async function ensureFolder(parentId: string, name: string): Promise<string> {
  const existing = await findFolder(parentId, name);
  if (existing) return existing.id;
  const created = await createFolder(parentId, name);
  logger.info("drive.folder_created", { name });
  return created.id;
}

// True when the configured folder is reachable and writable by the service account.
export async function checkFolderAccess(): Promise<{ ok: boolean; error?: string }> {
  try {
    const { driveFolderId } = getGoogleSettings();
    const folder = await googleJson<DriveFile & { capabilities?: { canAddChildren?: boolean } }>({
      url: driveUrl(`/${encodeURIComponent(driveFolderId)}`, { fields: "id,name,mimeType,capabilities(canAddChildren)" }),
      operation: "drive.folder.check",
      allowNotFound: true,
      timeoutMs: 8_000,
      maxAttempts: 1,
    });
    if (!folder) return { ok: false, error: "folder_not_found" };
    if (folder.mimeType !== FOLDER_MIME_TYPE) return { ok: false, error: "not_a_folder" };
    if (folder.capabilities?.canAddChildren === false) return { ok: false, error: "not_writable" };
    return { ok: true };
  } catch (err) {
    if (err instanceof Error && err.name === "GoogleConfigError") return { ok: false, error: "misconfigured" };
    return { ok: false, error: "unavailable" };
  }
}

// Re-exported so callers that only import this module can still sign a raw request if needed.
export { getAccessToken };
