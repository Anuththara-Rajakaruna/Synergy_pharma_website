// Direct access to the integration bucket, independent of the application's storage module, so
// tests can verify what the application stored and prepare objects the application did not create.

import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { integrationConfig } from "./env";

let client: S3Client | null = null;

function s3(): S3Client {
  client ??= new S3Client({
    region: "auto",
    endpoint: integrationConfig.s3Endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: integrationConfig.s3AccessKeyId, secretAccessKey: integrationConfig.s3SecretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return client;
}

const Bucket = integrationConfig.s3Bucket;

function statusOf(err: unknown): number | undefined {
  return (err as { $metadata?: { httpStatusCode?: number } } | undefined)?.$metadata?.httpStatusCode;
}

export async function ensureBucket(): Promise<void> {
  try {
    await s3().send(new HeadBucketCommand({ Bucket }));
  } catch (err) {
    if (statusOf(err) !== 404 && (err as { name?: string }).name !== "NotFound") throw err;
    await s3().send(new CreateBucketCommand({ Bucket }));
  }
}

export async function listKeys(prefix = ""): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await s3().send(new ListObjectsV2Command({ Bucket, Prefix: prefix || undefined, ContinuationToken: token }));
    for (const item of page.Contents ?? []) if (item.Key) keys.push(item.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

// Only ever called for the dedicated integration bucket.
export async function emptyBucket(): Promise<void> {
  const keys = await listKeys();
  for (let i = 0; i < keys.length; i += 500) {
    const batch = keys.slice(i, i + 500);
    await s3().send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }));
  }
}

export async function putObject(key: string, body: Buffer, contentType = "application/pdf"): Promise<void> {
  await s3().send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
}

export async function headObject(key: string): Promise<{ size: number; contentType: string | null } | null> {
  try {
    const result = await s3().send(new HeadObjectCommand({ Bucket, Key: key }));
    return { size: result.ContentLength ?? 0, contentType: result.ContentType ?? null };
  } catch (err) {
    if (statusOf(err) === 404 || (err as { name?: string }).name === "NotFound") return null;
    throw err;
  }
}

export async function objectExists(key: string): Promise<boolean> {
  return (await headObject(key)) !== null;
}

export async function getObjectBytes(key: string): Promise<Buffer> {
  const result = await s3().send(new GetObjectCommand({ Bucket, Key: key }));
  if (!result.Body) return Buffer.alloc(0);
  return Buffer.from(await result.Body.transformToByteArray());
}

export function destroyS3Client(): void {
  client?.destroy();
  client = null;
}
