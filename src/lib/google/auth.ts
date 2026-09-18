import { createSign } from "node:crypto";
import { GoogleConfigError, GoogleUnavailableError, isGoogleUnavailableError } from "@/lib/google/errors";
import { readGoogleEnv, type GoogleEnv } from "@/lib/google/config";
import { logger } from "@/lib/logger";

// OAuth 2.0 for a Google service account (RFC 7523 JWT bearer flow), implemented directly on
// node:crypto and fetch. The `googleapis` package would pull in a large dependency tree for
// what is two HTTP calls, and this way nothing but the standard library sees the private key.
//
// The private key never leaves the server: this module is imported only by server-side code,
// and `next build` fails the build if it is ever reached from a client component.

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:jwt-bearer";

// Sheets needs read/write on the one spreadsheet; Drive needs to create files inside a folder
// it did not create itself, which drive.file does not cover.
export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"] as const;

// Google issues one-hour tokens. Refresh early so an in-flight request never uses a token that
// expires mid-call.
const TOKEN_LIFETIME_SECONDS = 3600;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const TOKEN_REQUEST_TIMEOUT_MS = 10_000;

type CachedToken = { accessToken: string; expiresAt: number };

type AuthCache = {
  token: CachedToken | null;
  // In-flight refresh, so concurrent requests on a cold instance make one token call, not ten.
  pending: Promise<CachedToken> | null;
  // The settings the cached token was issued for; a configuration change invalidates it.
  fingerprint: string | null;
};

// Next.js dev-mode hot reload re-evaluates this module on every edit, and serverless hosts reuse
// warm instances across requests; caching on `globalThis` keeps one token per process in both cases.
declare global {
  var __synergyGoogleAuth: AuthCache | undefined;
}

const cache: AuthCache = (globalThis.__synergyGoogleAuth ??= { token: null, pending: null, fingerprint: null });

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export function getGoogleSettings(): GoogleEnv {
  const { settings, problems } = readGoogleEnv();
  if (!settings) {
    const variables = [...new Set(problems.map((p) => p.variable))].join(", ");
    throw new GoogleConfigError(`Google Sheets/Drive is not configured correctly (check ${variables}).`);
  }
  return settings;
}

// Changes to the account, key or impersonated user must drop a cached token. The private key
// itself is never part of the fingerprint.
function fingerprintOf(settings: GoogleEnv): string {
  return [settings.clientEmail, settings.privateKeyId ?? "", settings.impersonateUser ?? ""].join("|");
}

function signAssertion(settings: GoogleEnv, nowSeconds: number): string {
  const header = { alg: "RS256", typ: "JWT", ...(settings.privateKeyId ? { kid: settings.privateKeyId } : {}) };
  const claims = {
    iss: settings.clientEmail,
    scope: GOOGLE_SCOPES.join(" "),
    aud: TOKEN_ENDPOINT,
    iat: nowSeconds,
    exp: nowSeconds + TOKEN_LIFETIME_SECONDS,
    // Domain-wide delegation: act as this Workspace user instead of as the service account.
    ...(settings.impersonateUser ? { sub: settings.impersonateUser } : {}),
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  try {
    const signature = createSign("RSA-SHA256").update(signingInput).sign(settings.privateKey);
    return `${signingInput}.${base64url(signature)}`;
  } catch (err) {
    // A malformed PEM only fails here, not when the variable is read.
    throw new GoogleConfigError("GOOGLE_PRIVATE_KEY could not be used to sign a token. Check that the key was copied completely.", {
      cause: err,
    });
  }
}

type TokenResponse = { access_token?: unknown; expires_in?: unknown; error?: unknown; error_description?: unknown };

async function requestToken(settings: GoogleEnv): Promise<CachedToken> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const assertion = signAssertion(settings, nowSeconds);

  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: GRANT_TYPE, assertion }).toString(),
      signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    if (isGoogleUnavailableError(err)) {
      throw new GoogleUnavailableError("Could not reach Google to obtain an access token.", { cause: err });
    }
    throw err;
  }

  let body: TokenResponse = {};
  try {
    body = (await response.json()) as TokenResponse;
  } catch {
    // Leave body empty; the status drives the error below.
  }

  if (!response.ok) {
    const code = typeof body.error === "string" ? body.error : `http_${response.status}`;
    // invalid_grant / invalid_client / unauthorized_client are all deployment problems: a wrong
    // key, a disabled account, or delegation that was never granted. Retrying will not help.
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new GoogleConfigError(
        `Google rejected the service account credentials (${code}). Check GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, that the Sheets and Drive APIs are enabled, and that the server clock is correct.`
      );
    }
    throw new GoogleUnavailableError(`Google's token endpoint returned HTTP ${response.status}.`);
  }

  if (typeof body.access_token !== "string" || !body.access_token) {
    throw new GoogleUnavailableError("Google's token endpoint returned no access token.");
  }
  const expiresIn = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : TOKEN_LIFETIME_SECONDS;
  logger.info("google.token_issued", { expiresInSeconds: expiresIn, impersonated: Boolean(settings.impersonateUser) });
  return { accessToken: body.access_token, expiresAt: Date.now() + expiresIn * 1000 };
}

// A valid OAuth access token for the configured service account, cached for the process.
export async function getAccessToken(): Promise<string> {
  const settings = getGoogleSettings();
  const fingerprint = fingerprintOf(settings);

  if (cache.fingerprint !== fingerprint) {
    cache.token = null;
    cache.pending = null;
    cache.fingerprint = fingerprint;
  }

  const cached = cache.token;
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) return cached.accessToken;

  if (!cache.pending) {
    cache.pending = requestToken(settings)
      .then((token) => {
        cache.token = token;
        return token;
      })
      .finally(() => {
        cache.pending = null;
      });
  }
  return (await cache.pending).accessToken;
}

// Drops the cached token so the next call fetches a fresh one. Used after a 401 from an API,
// which can happen when a key is rotated while the instance is warm.
export function invalidateAccessToken(): void {
  cache.token = null;
}
