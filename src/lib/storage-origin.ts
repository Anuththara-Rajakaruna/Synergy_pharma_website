// Object-storage configuration parsing shared by the S3 client (src/lib/storage.ts), the
// configuration report (src/lib/env.ts) and the proxy's Content-Security-Policy. Pure: no AWS
// SDK or Node.js-only imports, so it can run anywhere.

export const SERVER_SIDE_ENCRYPTION_VALUES = ["AES256", "aws:kms", "aws:kms:dsse"] as const;
export type ServerSideEncryptionValue = (typeof SERVER_SIDE_ENCRYPTION_VALUES)[number];

export type StorageEnv = {
  bucket: string;
  region: string;
  // Endpoint the server talks to. null means AWS S3's regional endpoint.
  endpoint: string | null;
  // Endpoint browsers use for presigned URLs when it differs from the internal one.
  publicEndpoint: string | null;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  serverSideEncryption: ServerSideEncryptionValue | null;
};

export type StorageEnvProblem = { variable: string; message: string };

export type StorageEnvResult = {
  settings: StorageEnv | null;
  problems: StorageEnvProblem[];
  // Whether any storage variable is set at all (distinguishes "not set up" from "misconfigured").
  anySet: boolean;
};

type Env = Record<string, string | undefined>;

const STORAGE_VARIABLES = [
  "S3_BUCKET",
  "S3_REGION",
  "S3_ENDPOINT",
  "S3_PUBLIC_ENDPOINT",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_FORCE_PATH_STYLE",
  "S3_SERVER_SIDE_ENCRYPTION",
] as const;

// Loose on purpose (legacy AWS buckets allow upper case and underscores); it only has to keep
// the value safe to place in a hostname or URL path.
const BUCKET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{1,253}[A-Za-z0-9]$/;
const REGION_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function read(env: Env, name: string): string {
  return (env[name] ?? "").trim();
}

function parseEndpoint(raw: string, variable: string, problems: StorageEnvProblem[]): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    problems.push({ variable, message: `${variable} must be a full URL such as https://<account>.r2.cloudflarestorage.com.` });
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    problems.push({ variable, message: `${variable} must use https:// (or http:// for a local development server).` });
    return null;
  }
  if (url.username || url.password || url.search || url.hash) {
    problems.push({ variable, message: `${variable} must not contain credentials, a query string or a fragment.` });
    return null;
  }
  return url.toString().replace(/\/+$/, "");
}

export function readStorageEnv(env: Env = process.env): StorageEnvResult {
  const problems: StorageEnvProblem[] = [];
  const anySet = STORAGE_VARIABLES.some((name) => read(env, name) !== "");

  const bucket = read(env, "S3_BUCKET");
  if (!bucket) problems.push({ variable: "S3_BUCKET", message: "S3_BUCKET is not set." });
  else if (!BUCKET_NAME.test(bucket)) problems.push({ variable: "S3_BUCKET", message: "S3_BUCKET is not a valid bucket name." });

  const endpoint = parseEndpoint(read(env, "S3_ENDPOINT"), "S3_ENDPOINT", problems);
  const publicEndpoint = parseEndpoint(read(env, "S3_PUBLIC_ENDPOINT"), "S3_PUBLIC_ENDPOINT", problems);
  const endpointProvided = read(env, "S3_ENDPOINT") !== "";

  let region = read(env, "S3_REGION");
  if (!region) {
    if (endpointProvided) region = "auto";
    else problems.push({ variable: "S3_REGION", message: "S3_REGION is required for AWS S3 (for example ap-south-1)." });
  } else if (!REGION_NAME.test(region)) {
    problems.push({ variable: "S3_REGION", message: "S3_REGION is not a valid region name." });
  } else if (region === "auto" && !endpointProvided) {
    problems.push({
      variable: "S3_REGION",
      message: 'S3_REGION "auto" only works with S3_ENDPOINT (e.g. Cloudflare R2). Set a real AWS region such as ap-south-1.',
    });
  }

  const pathStyleRaw = read(env, "S3_FORCE_PATH_STYLE").toLowerCase();
  let forcePathStyle = endpointProvided;
  if (pathStyleRaw === "true") forcePathStyle = true;
  else if (pathStyleRaw === "false") forcePathStyle = false;
  else if (pathStyleRaw) problems.push({ variable: "S3_FORCE_PATH_STYLE", message: "S3_FORCE_PATH_STYLE must be true or false." });

  const accessKeyId = read(env, "S3_ACCESS_KEY_ID");
  const secretAccessKey = read(env, "S3_SECRET_ACCESS_KEY");
  if (!accessKeyId) problems.push({ variable: "S3_ACCESS_KEY_ID", message: "S3_ACCESS_KEY_ID is not set." });
  if (!secretAccessKey) problems.push({ variable: "S3_SECRET_ACCESS_KEY", message: "S3_SECRET_ACCESS_KEY is not set." });

  const sseRaw = read(env, "S3_SERVER_SIDE_ENCRYPTION");
  let serverSideEncryption: ServerSideEncryptionValue | null = null;
  if (sseRaw) {
    if ((SERVER_SIDE_ENCRYPTION_VALUES as readonly string[]).includes(sseRaw)) {
      serverSideEncryption = sseRaw as ServerSideEncryptionValue;
    } else {
      problems.push({
        variable: "S3_SERVER_SIDE_ENCRYPTION",
        message: `S3_SERVER_SIDE_ENCRYPTION must be one of ${SERVER_SIDE_ENCRYPTION_VALUES.join(", ")}.`,
      });
    }
  }

  if (problems.length > 0) return { settings: null, problems, anySet };
  return {
    settings: { bucket, region, endpoint, publicEndpoint, forcePathStyle, accessKeyId, secretAccessKey, serverSideEncryption },
    problems,
    anySet,
  };
}

// Mirrors the AWS SDK's addressing rules: DNS-compatible bucket names without dots are
// addressed virtual-host style unless path style is forced or the endpoint is an IP address.
function isVirtualHostableBucket(bucket: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket);
}

function isIpHostname(hostname: string): boolean {
  return hostname.startsWith("[") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
}

// The origin browsers send presigned PUT uploads to. Used for the CSP connect-src directive and
// must match the URLs generated by presignUpload().
export function storageBrowserOrigin(settings: StorageEnv): string {
  const explicit = settings.publicEndpoint ?? settings.endpoint;
  const virtualHost = !settings.forcePathStyle && isVirtualHostableBucket(settings.bucket);
  if (explicit) {
    const url = new URL(explicit);
    if (virtualHost && !isIpHostname(url.hostname)) return `${url.protocol}//${settings.bucket}.${url.host}`;
    return url.origin;
  }
  const domain = settings.region.startsWith("cn-") ? "amazonaws.com.cn" : "amazonaws.com";
  return virtualHost ? `https://${settings.bucket}.s3.${settings.region}.${domain}` : `https://s3.${settings.region}.${domain}`;
}

export function getStorageUploadOrigin(): string | null {
  const { settings } = readStorageEnv();
  if (!settings) return null;
  try {
    return storageBrowserOrigin(settings);
  } catch {
    return null;
  }
}
