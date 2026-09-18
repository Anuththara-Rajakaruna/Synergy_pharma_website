// Direct access to the integration Drive folder, so tests can verify what the application
// stored and prepare files the application did not create.
//
// This replaces the old support/s3.ts. There is no second Drive SDK to reach for, so it uses the
// application's own client (src/lib/google/drive.ts) - the value of the module is that every
// test goes through one place that knows the test folder and its layout, and that the folder is
// emptied the same way at the start of every run.

import { getGoogleSettings } from "@/lib/google/auth";
import {
  FOLDER_MIME_TYPE,
  deleteFile,
  downloadFileBuffer,
  findFolder,
  getFile,
  listFiles,
  uploadFile,
  type DriveFile,
} from "@/lib/google/drive";
import { APPLICATION_FOLDER_NAME, STAGING_FOLDER_NAME, TALENT_FOLDER_NAME } from "@/lib/careers/server/uploads";

export const FOLDER_NAMES = {
  staging: STAGING_FOLDER_NAME,
  applications: APPLICATION_FOLDER_NAME,
  talent: TALENT_FOLDER_NAME,
} as const;

export function rootFolderId(): string {
  return getGoogleSettings().driveFolderId;
}

export async function subfolderId(name: string): Promise<string | null> {
  const folder = await findFolder(rootFolderId(), name);
  return folder?.id ?? null;
}

// Every file under the test folder, at any depth. Subfolders themselves are not returned.
export async function listAllFiles(parentId: string = rootFolderId()): Promise<DriveFile[]> {
  const children = await listFiles(parentId, { pageSize: 100 });
  const files: DriveFile[] = [];
  for (const child of children) {
    if (child.mimeType === FOLDER_MIME_TYPE) files.push(...(await listAllFiles(child.id)));
    else files.push(child);
  }
  return files;
}

export async function listFilesIn(folderName: string): Promise<DriveFile[]> {
  const id = await subfolderId(folderName);
  return id ? listFiles(id, { pageSize: 100 }) : [];
}

// Deletes every file under the test folder, keeping the folders themselves: the upload service
// caches the id of each subfolder per process, and re-creating them would strand that cache.
// Only ever called for the folder named by INTEGRATION_GOOGLE_DRIVE_FOLDER_ID.
export async function emptyDriveFolder(): Promise<number> {
  const files = await listAllFiles();
  for (const file of files) await deleteFile(file.id);
  return files.length;
}

export async function driveFileExists(fileId: string): Promise<boolean> {
  const file = await getFile(fileId);
  return Boolean(file && !file.trashed);
}

export async function driveFileBytes(fileId: string): Promise<Buffer> {
  const bytes = await downloadFileBuffer(fileId);
  if (!bytes) throw new Error(`Drive file ${fileId} does not exist.`);
  return bytes;
}

export async function driveFile(fileId: string): Promise<DriveFile | null> {
  return getFile(fileId);
}

// Puts a file into the test folder without going through the upload flow, for the cases the
// application itself cannot produce (a leftover staged file, a document whose record was
// hand-written).
export async function putDriveFile(
  parentId: string,
  name: string,
  body: Buffer,
  opts: { appProperties?: Record<string, string>; mimeType?: string } = {}
): Promise<DriveFile> {
  return uploadFile({
    name,
    parentId,
    mimeType: opts.mimeType ?? "application/pdf",
    body,
    ...(opts.appProperties ? { appProperties: opts.appProperties } : {}),
  });
}
