import { AppError, badRequest, forbidden, payloadTooLarge, unsupportedMediaType } from "@/lib/http/errors";
import { SITE_URL } from "@/lib/site";

const DEFAULT_JSON_LIMIT = 256 * 1024;

// Reads a JSON object body. Rejects non-JSON content types (415), oversize bodies (413) and
// malformed or non-object JSON (400). The size cap is enforced while streaming, so a
// missing or false Content-Length cannot be used to exhaust memory.
export async function readJsonBody(request: Request, maxBytes = DEFAULT_JSON_LIMIT): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(contentType)) throw unsupportedMediaType();

  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) throw payloadTooLarge();

  const text = await readBodyText(request, maxBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw badRequest("Invalid request body.", undefined, "invalid_json");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw badRequest("Invalid request body.", undefined, "invalid_json");
  }
  return parsed as Record<string, unknown>;
}

async function readBodyText(request: Request, maxBytes: number): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw payloadTooLarge();
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

// Best-effort client IP for rate limiting and audit logs.
//
// Headers a client can forge must not be trusted blindly. Configure TRUSTED_IP_HEADER to the
// header your platform sets and overwrites (Vercel: "x-real-ip"; Cloudflare: "cf-connecting-ip";
// nginx with `proxy_set_header X-Real-IP $remote_addr`: "x-real-ip"). Otherwise the right-most
// X-Forwarded-For entry added by the TRUSTED_PROXY_COUNT nearest proxies is used.
export function getClientIp(request: Request): string {
  const headerName = process.env.TRUSTED_IP_HEADER?.trim().toLowerCase();
  if (headerName) {
    const value = request.headers.get(headerName)?.split(",")[0]?.trim();
    if (value && isPlausibleIp(value)) return value;
  }
  if (process.env.VERCEL === "1") {
    const vercel = request.headers.get("x-real-ip")?.trim();
    if (vercel && isPlausibleIp(vercel)) return vercel;
  }
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (forwarded && forwarded.length > 0) {
    const hops = Number.parseInt(process.env.TRUSTED_PROXY_COUNT ?? "1", 10);
    const index = forwarded.length - (Number.isFinite(hops) && hops > 0 ? hops : 1);
    const candidate = forwarded[Math.max(0, index)];
    if (candidate && isPlausibleIp(candidate)) return candidate;
  }
  return "unknown";
}

function isPlausibleIp(value: string): boolean {
  return value.length <= 45 && /^[0-9a-fA-F:.]+$/.test(value);
}

export function getUserAgent(request: Request): string | null {
  const ua = request.headers.get("user-agent");
  return ua ? ua.slice(0, 400) : null;
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// CSRF defence for cookie-authenticated requests: unsafe methods must come from this site.
// Browsers always send Origin (or Sec-Fetch-Site) on cross-origin POST/PUT/PATCH/DELETE.
export function assertSameOrigin(request: Request): void {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "same-origin") return;
  const origin = request.headers.get("origin");
  if (origin) {
    if (allowedOrigins(request).has(origin)) return;
    throw forbidden("Cross-site request blocked.", "cross_site_request");
  }
  if (fetchSite && fetchSite !== "none") throw forbidden("Cross-site request blocked.", "cross_site_request");
  // No Origin and no Sec-Fetch-Site: not a browser (curl, server-to-server). Cookies are not
  // sent cross-site by browsers without these headers, so this is not a CSRF vector.
}

function allowedOrigins(request: Request): Set<string> {
  const origins = new Set<string>();
  try {
    origins.add(new URL(SITE_URL).origin);
  } catch {
    // SITE_URL is validated elsewhere.
  }
  try {
    origins.add(new URL(request.url).origin);
  } catch {
    // ignore
  }
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  if (host) origins.add(`${proto.split(",")[0].trim()}://${host.split(",")[0].trim()}`);
  return origins;
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
