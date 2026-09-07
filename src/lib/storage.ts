import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

// Works with any S3-compatible provider (AWS S3, Cloudflare R2, Backblaze B2,
// Supabase/MinIO storage, ...). Set S3_ENDPOINT for non-AWS providers; leave it
// unset for real AWS S3.
const bucket = process.env.S3_BUCKET;
const region = process.env.S3_REGION ?? "auto";
const endpoint = process.env.S3_ENDPOINT;
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

function requireBucket(): string {
  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Object storage is not configured. Set S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY " +
        "(and S3_ENDPOINT for non-AWS providers) in your environment."
    );
  }
  return bucket;
}

let client: S3Client | undefined;
function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region,
      endpoint,
      forcePathStyle: Boolean(endpoint),
      credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
    });
  }
  return client;
}

export async function putPrivateObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const Bucket = requireBucket();
  await getClient().send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
}

export async function getPrivateObject(key: string): Promise<Buffer | null> {
  const Bucket = requireBucket();
  try {
    const result = await getClient().send(new GetObjectCommand({ Bucket, Key: key }));
    const bytes = await result.Body?.transformToByteArray();
    return bytes ? Buffer.from(bytes) : null;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export async function deletePrivateObject(key: string): Promise<void> {
  const Bucket = requireBucket();
  await getClient()
    .send(new DeleteObjectCommand({ Bucket, Key: key }))
    .catch(() => {});
}

function isNotFound(err: unknown): boolean {
  const name = (err as { name?: string } | undefined)?.name;
  return name === "NoSuchKey" || name === "NotFound";
}
