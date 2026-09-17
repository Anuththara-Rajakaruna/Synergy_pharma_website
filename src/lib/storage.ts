import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { logger } from "@/lib/logger";
import { readStorageEnv, type StorageEnv } from "@/lib/storage-origin";

// Private object storage for candidate documents. Works with any S3-compatible provider
// (AWS S3, Cloudflare R2, MinIO, ...). Configuration is documented in src/lib/storage-origin.ts.
//
// Errors: configuration and permission problems throw StorageConfigError (a deployment bug,
// reported as 500); network failures, timeouts and provider 5xx responses throw
// StorageUnavailableError (reported as 503). Messages never contain keys, which for legacy
// documents can include a candidate's original file name.

export class StorageConfigError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StorageConfigError";
  }
}

export class StorageUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StorageUnavailableError";
  }
}

// The requested object does not exist (only thrown where a missing object is not a normal result).
export class StorageObjectNotFoundError extends Error {
  constructor(message = "Stored object not found.") {
    super(message);
    this.name = "StorageObjectNotFoundError";
  }
}

const MAX_RANGE_BYTES = 1024 * 1024;
const MAX_LIST_PAGES = 50;

type Clients = { settings: StorageEnv; internal: S3Client; presign: S3Client };

let clients: Clients | null = null;

function createClient(settings: StorageEnv, endpoint: string | null): S3Client {
  return new S3Client({
    region: settings.region,
    endpoint: endpoint ?? undefined,
    forcePathStyle: settings.forcePathStyle,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
    // Only send checksums when an operation requires them: several S3-compatible providers
    // reject the SDK's default CRC32 headers, and presigned browser uploads cannot compute them.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    maxAttempts: 3,
    requestHandler: {
      connectionTimeout: 5_000,
      socketTimeout: 30_000,
      requestTimeout: 30_000,
      throwOnRequestTimeout: true,
    },
  });
}

function getClients(): Clients {
  if (clients) return clients;
  const { settings, problems } = readStorageEnv();
  if (!settings) {
    const variables = [...new Set(problems.map((p) => p.variable))].join(", ");
    throw new StorageConfigError(`Object storage is not configured correctly (check ${variables}).`);
  }
  const internal = createClient(settings, settings.endpoint);
  const presign =
    settings.publicEndpoint && settings.publicEndpoint !== settings.endpoint ? createClient(settings, settings.publicEndpoint) : internal;
  clients = { settings, internal, presign };
  return clients;
}

export function isStorageConfigured(): boolean {
  return readStorageEnv().settings !== null;
}

type SdkError = {
  name?: string;
  $fault?: string;
  $retryable?: unknown;
  $metadata?: { httpStatusCode?: number };
};

const CONFIG_ERROR_NAMES = new Set([
  "AccessDenied",
  "AccountProblem",
  "AllAccessDisabled",
  "AuthorizationHeaderMalformed",
  "CredentialsProviderError",
  "InvalidAccessKeyId",
  "InvalidBucketName",
  "InvalidRegion",
  "NoSuchBucket",
  "PermanentRedirect",
  "SignatureDoesNotMatch",
]);

function statusOf(err: unknown): number | undefined {
  return (err as SdkError | undefined)?.$metadata?.httpStatusCode;
}

function isNotFound(err: unknown): boolean {
  const name = (err as SdkError | undefined)?.name;
  if (name === "NoSuchBucket") return false;
  return name === "NotFound" || name === "NoSuchKey" || statusOf(err) === 404;
}

function toStorageError(err: unknown, operation: string): Error {
  if (err instanceof StorageConfigError || err instanceof StorageUnavailableError || err instanceof StorageObjectNotFoundError) {
    return err;
  }
  const name = (err as SdkError | undefined)?.name ?? "UnknownError";
  const status = statusOf(err);
  const detail = `${name}${status ? `, HTTP ${status}` : ""}`;
  const isConfig =
    CONFIG_ERROR_NAMES.has(name) ||
    status === 301 ||
    status === 400 ||
    status === 401 ||
    status === 403 ||
    (status === 404 && name === "NoSuchBucket");
  if (isConfig) return new StorageConfigError(`Object storage rejected ${operation} (${detail}).`, { cause: err });
  return new StorageUnavailableError(`Object storage ${operation} failed (${detail}).`, { cause: err });
}

function assertKey(key: string): void {
  if (!key || key.length > 1024 || key.startsWith("/") || /[\x00-\x1F\x7F]/.test(key)) {
    throw new Error("Invalid storage key.");
  }
}

// CopySource is "<bucket>/<key>" and must be URL-encoded (legacy keys can contain spaces).
function copySource(bucket: string, key: string): string {
  return `${bucket}/${encodeURIComponent(key).replace(/%2F/g, "/")}`;
}

// Presigned PUT for a direct browser upload. content-type and content-length are part of the
// signature, so the provider rejects (403) a body of a different size or type. Browsers set
// Content-Length themselves (it is a forbidden request header), so only Content-Type is
// returned for the client to send.
export async function presignUpload(
  key: string,
  opts: { contentType: string; contentLength: number; expiresInSeconds: number }
): Promise<{ url: string; headers: Record<string, string> }> {
  assertKey(key);
  if (!Number.isInteger(opts.contentLength) || opts.contentLength < 1) throw new Error("Invalid upload size.");
  const { settings, presign } = getClients();
  try {
    const url = await getSignedUrl(
      presign,
      new PutObjectCommand({
        Bucket: settings.bucket,
        Key: key,
        ContentType: opts.contentType,
        ContentLength: opts.contentLength,
      }),
      { expiresIn: opts.expiresInSeconds, signableHeaders: new Set(["content-type", "content-length"]) }
    );
    return { url, headers: { "Content-Type": opts.contentType } };
  } catch (err) {
    throw new StorageConfigError("Could not presign an upload URL.", { cause: err });
  }
}

export async function headObject(key: string): Promise<{ size: number; contentType: string | null; lastModified: Date | null } | null> {
  assertKey(key);
  const { settings, internal } = getClients();
  try {
    const result = await internal.send(new HeadObjectCommand({ Bucket: settings.bucket, Key: key }));
    return {
      size: result.ContentLength ?? 0,
      contentType: result.ContentType ?? null,
      lastModified: result.LastModified ?? null,
    };
  } catch (err) {
    if (isNotFound(err)) return null;
    throw toStorageError(err, "HeadObject");
  }
}

// Reads a small byte range (at most 1 MiB): either [start, end] inclusive, or the last `suffix` bytes.
// Throws StorageObjectNotFoundError when the object does not exist.
export async function readObjectBytes(key: string, range: { start: number; end: number } | { suffix: number }): Promise<Buffer> {
  assertKey(key);
  let header: string;
  if ("suffix" in range) {
    if (!Number.isInteger(range.suffix) || range.suffix < 1 || range.suffix > MAX_RANGE_BYTES) throw new Error("Invalid byte range.");
    header = `bytes=-${range.suffix}`;
  } else {
    const { start, end } = range;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end - start >= MAX_RANGE_BYTES) {
      throw new Error("Invalid byte range.");
    }
    header = `bytes=${start}-${end}`;
  }
  const { settings, internal } = getClients();
  try {
    const result = await internal.send(new GetObjectCommand({ Bucket: settings.bucket, Key: key, Range: header }));
    if (!result.Body) return Buffer.alloc(0);
    return Buffer.from(await result.Body.transformToByteArray());
  } catch (err) {
    if (isNotFound(err)) throw new StorageObjectNotFoundError();
    throw toStorageError(err, "GetObject");
  }
}

// Server-side copy. Throws StorageObjectNotFoundError when the source does not exist.
export async function copyObject(sourceKey: string, destinationKey: string, opts: { contentType?: string } = {}): Promise<void> {
  assertKey(sourceKey);
  assertKey(destinationKey);
  const { settings, internal } = getClients();
  try {
    await internal.send(
      new CopyObjectCommand({
        Bucket: settings.bucket,
        Key: destinationKey,
        CopySource: copySource(settings.bucket, sourceKey),
        ...(opts.contentType
          ? { MetadataDirective: "REPLACE" as const, ContentType: opts.contentType, ContentDisposition: "attachment" }
          : {}),
        ...(settings.serverSideEncryption ? { ServerSideEncryption: settings.serverSideEncryption } : {}),
      })
    );
  } catch (err) {
    if (isNotFound(err)) throw new StorageObjectNotFoundError("Source object not found.");
    throw toStorageError(err, "CopyObject");
  }
}

// Deleting an object that does not exist succeeds.
export async function deleteObject(key: string): Promise<void> {
  assertKey(key);
  const { settings, internal } = getClients();
  try {
    await internal.send(new DeleteObjectCommand({ Bucket: settings.bucket, Key: key }));
  } catch (err) {
    if (isNotFound(err)) return;
    throw toStorageError(err, "DeleteObject");
  }
}

function contentDisposition(fileName: string): string {
  const cleaned = fileName.replace(/[\x00-\x1F\x7F]/g, "").trim() || "document.pdf";
  const ascii = cleaned.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(cleaned).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

// Short-lived download URL that always downloads (never renders inline) as a PDF.
export async function presignDownload(key: string, opts: { fileName: string; expiresInSeconds?: number }): Promise<string> {
  assertKey(key);
  const { settings, presign } = getClients();
  try {
    return await getSignedUrl(
      presign,
      new GetObjectCommand({
        Bucket: settings.bucket,
        Key: key,
        ResponseContentDisposition: contentDisposition(opts.fileName),
        ResponseContentType: "application/pdf",
      }),
      { expiresIn: opts.expiresInSeconds ?? 60 }
    );
  } catch (err) {
    throw new StorageConfigError("Could not presign a download URL.", { cause: err });
  }
}

export async function listObjectsOlderThan(prefix: string, olderThan: Date, limit: number): Promise<{ key: string; lastModified: Date }[]> {
  if (!prefix || prefix.startsWith("/")) throw new Error("Invalid storage prefix.");
  const { settings, internal } = getClients();
  const found: { key: string; lastModified: Date }[] = [];
  let continuationToken: string | undefined;
  try {
    for (let page = 0; page < MAX_LIST_PAGES && found.length < limit; page++) {
      const result = await internal.send(
        new ListObjectsV2Command({ Bucket: settings.bucket, Prefix: prefix, MaxKeys: 1000, ContinuationToken: continuationToken })
      );
      for (const item of result.Contents ?? []) {
        if (!item.Key || !item.LastModified) continue;
        if (item.LastModified.getTime() < olderThan.getTime()) {
          found.push({ key: item.Key, lastModified: item.LastModified });
          if (found.length >= limit) break;
        }
      }
      if (!result.IsTruncated || !result.NextContinuationToken) break;
      continuationToken = result.NextContinuationToken;
    }
  } catch (err) {
    throw toStorageError(err, "ListObjectsV2");
  }
  return found;
}

// True when the bucket is reachable with the configured credentials.
export async function checkBucketAccess(): Promise<boolean> {
  try {
    const { settings, internal } = getClients();
    await internal.send(new HeadBucketCommand({ Bucket: settings.bucket }));
    return true;
  } catch (err) {
    logger.warn("storage.bucket_check_failed", { errorName: (err as SdkError | undefined)?.name ?? "UnknownError", status: statusOf(err) });
    return false;
  }
}
