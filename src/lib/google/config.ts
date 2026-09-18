// Google service-account configuration parsing, shared by the API clients
// (src/lib/google/auth.ts) and the configuration report (src/lib/env.ts).
//
// Pure: no Node.js-only imports and no network access, so it can run anywhere and be unit
// tested. Nothing here is ever sent to the browser — every consumer is server-only.

export type GoogleEnv = {
  clientEmail: string;
  // PEM PKCS#8 private key, with real newlines.
  privateKey: string;
  privateKeyId: string | null;
  spreadsheetId: string;
  driveFolderId: string;
  // Set when documents live on a Shared Drive. Required for Google Workspace deployments,
  // because a service account has no storage quota of its own in My Drive.
  sharedDriveId: string | null;
  // Domain-wide delegation: the Workspace user the service account acts as. The alternative to
  // a Shared Drive when files must be owned by a real account.
  impersonateUser: string | null;
};

export type GoogleEnvProblem = { variable: string; message: string };

export type GoogleEnvResult = {
  settings: GoogleEnv | null;
  problems: GoogleEnvProblem[];
  // Whether any Google variable is set at all (distinguishes "not set up" from "misconfigured").
  anySet: boolean;
};

type Env = Record<string, string | undefined>;

export const GOOGLE_VARIABLES = [
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_PRIVATE_KEY",
  "GOOGLE_PRIVATE_KEY_ID",
  "GOOGLE_SHEETS_SPREADSHEET_ID",
  "GOOGLE_DRIVE_FOLDER_ID",
  "GOOGLE_DRIVE_SHARED_DRIVE_ID",
  "GOOGLE_IMPERSONATE_USER",
] as const;

// Google resource ids are URL-safe base64-ish strings. Deliberately loose, but tight enough that
// an id can never break out of a URL path or a query parameter.
const RESOURCE_ID = /^[A-Za-z0-9_-]{10,200}$/;
const SERVICE_ACCOUNT_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PEM_BODY = /-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+-----END (?:RSA )?PRIVATE KEY-----/;

function read(env: Env, name: string): string {
  return (env[name] ?? "").trim();
}

// Hosting dashboards mangle multi-line values in different ways. Accept the three shapes that
// actually occur: real newlines, literal "\n" escapes, and a base64 blob of the whole PEM.
export function normalizePrivateKey(raw: string): string {
  let value = raw.trim();
  if (!value) return "";

  // Some dashboards keep the surrounding quotes from the .env file.
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }

  if (!value.includes("-----BEGIN") && /^[A-Za-z0-9+/=\s]+$/.test(value)) {
    try {
      const decoded = Buffer.from(value, "base64").toString("utf8");
      if (decoded.includes("-----BEGIN")) value = decoded;
    } catch {
      // Not base64 after all; fall through and let the PEM check report it.
    }
  }

  value = value.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\r\n/g, "\n");
  // A trailing newline is required by some OpenSSL builds.
  return value.endsWith("\n") ? value : `${value}\n`;
}

type ServiceAccountJson = {
  client_email?: unknown;
  private_key?: unknown;
  private_key_id?: unknown;
};

// GOOGLE_SERVICE_ACCOUNT_JSON accepts the downloaded key file verbatim, or base64 of it (the
// practical choice for hosting dashboards that cannot hold multi-line values).
function parseServiceAccountJson(raw: string, problems: GoogleEnvProblem[]): ServiceAccountJson | null {
  let text = raw;
  if (!text.trimStart().startsWith("{")) {
    try {
      text = Buffer.from(text, "base64").toString("utf8");
    } catch {
      problems.push({
        variable: "GOOGLE_SERVICE_ACCOUNT_JSON",
        message: "GOOGLE_SERVICE_ACCOUNT_JSON must be the service account JSON key file, or that file base64-encoded.",
      });
      return null;
    }
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as ServiceAccountJson;
  } catch {
    problems.push({
      variable: "GOOGLE_SERVICE_ACCOUNT_JSON",
      message: "GOOGLE_SERVICE_ACCOUNT_JSON could not be parsed as JSON. Paste the key file exactly as downloaded, or base64-encode it.",
    });
    return null;
  }
}

function checkResourceId(value: string, variable: string, hint: string, problems: GoogleEnvProblem[]): string {
  if (!value) {
    problems.push({ variable, message: `${variable} is required. ${hint}` });
    return "";
  }
  if (!RESOURCE_ID.test(value)) {
    problems.push({
      variable,
      message: `${variable} does not look like a Google resource id. ${hint}`,
    });
    return "";
  }
  return value;
}

export function readGoogleEnv(env: Env = process.env): GoogleEnvResult {
  const problems: GoogleEnvProblem[] = [];
  const anySet = GOOGLE_VARIABLES.some((name) => read(env, name) !== "");

  let clientEmail = read(env, "GOOGLE_SERVICE_ACCOUNT_EMAIL");
  let privateKey = normalizePrivateKey(read(env, "GOOGLE_PRIVATE_KEY"));
  let privateKeyId: string | null = read(env, "GOOGLE_PRIVATE_KEY_ID") || null;

  // The single-variable form wins only for the fields it actually provides, so a deployment can
  // supply the JSON blob and still override, say, the impersonated user.
  const json = read(env, "GOOGLE_SERVICE_ACCOUNT_JSON");
  if (json) {
    const parsed = parseServiceAccountJson(json, problems);
    if (parsed) {
      if (!clientEmail && typeof parsed.client_email === "string") clientEmail = parsed.client_email.trim();
      if (!privateKey && typeof parsed.private_key === "string") privateKey = normalizePrivateKey(parsed.private_key);
      if (!privateKeyId && typeof parsed.private_key_id === "string") privateKeyId = parsed.private_key_id.trim() || null;
    }
  }

  if (!clientEmail) {
    problems.push({
      variable: "GOOGLE_SERVICE_ACCOUNT_EMAIL",
      message:
        "GOOGLE_SERVICE_ACCOUNT_EMAIL is required (or provide GOOGLE_SERVICE_ACCOUNT_JSON). It is the client_email field of the service account key file.",
    });
  } else if (!SERVICE_ACCOUNT_EMAIL.test(clientEmail)) {
    problems.push({ variable: "GOOGLE_SERVICE_ACCOUNT_EMAIL", message: "GOOGLE_SERVICE_ACCOUNT_EMAIL must be an email address." });
    clientEmail = "";
  }

  if (!privateKey) {
    problems.push({
      variable: "GOOGLE_PRIVATE_KEY",
      message:
        "GOOGLE_PRIVATE_KEY is required (or provide GOOGLE_SERVICE_ACCOUNT_JSON). Copy the private_key field including the BEGIN/END lines.",
    });
  } else if (!PEM_BODY.test(privateKey)) {
    problems.push({
      variable: "GOOGLE_PRIVATE_KEY",
      message: "GOOGLE_PRIVATE_KEY must be a PEM private key, starting with -----BEGIN PRIVATE KEY-----.",
    });
    privateKey = "";
  }

  const spreadsheetId = checkResourceId(
    read(env, "GOOGLE_SHEETS_SPREADSHEET_ID"),
    "GOOGLE_SHEETS_SPREADSHEET_ID",
    "Copy it from the sheet URL: https://docs.google.com/spreadsheets/d/<THIS PART>/edit.",
    problems
  );
  const driveFolderId = checkResourceId(
    read(env, "GOOGLE_DRIVE_FOLDER_ID"),
    "GOOGLE_DRIVE_FOLDER_ID",
    "Copy it from the folder URL: https://drive.google.com/drive/folders/<THIS PART>.",
    problems
  );

  let sharedDriveId: string | null = read(env, "GOOGLE_DRIVE_SHARED_DRIVE_ID") || null;
  if (sharedDriveId && !RESOURCE_ID.test(sharedDriveId)) {
    problems.push({
      variable: "GOOGLE_DRIVE_SHARED_DRIVE_ID",
      message: "GOOGLE_DRIVE_SHARED_DRIVE_ID does not look like a Google resource id. Leave it empty if you are not using a Shared Drive.",
    });
    sharedDriveId = null;
  }

  let impersonateUser: string | null = read(env, "GOOGLE_IMPERSONATE_USER") || null;
  if (impersonateUser && !SERVICE_ACCOUNT_EMAIL.test(impersonateUser)) {
    problems.push({ variable: "GOOGLE_IMPERSONATE_USER", message: "GOOGLE_IMPERSONATE_USER must be an email address." });
    impersonateUser = null;
  }

  const complete = Boolean(clientEmail && privateKey && spreadsheetId && driveFolderId);
  return {
    settings: complete
      ? { clientEmail, privateKey, privateKeyId, spreadsheetId, driveFolderId, sharedDriveId, impersonateUser }
      : null,
    problems,
    anySet,
  };
}

// True when every required Google variable is present and well-formed. Does not contact Google.
export function isGoogleConfigured(env: Env = process.env): boolean {
  return readGoogleEnv(env).settings !== null;
}
