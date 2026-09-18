import { UPLOAD_LIMITS } from "@/lib/careers/constants";
import { receiveUpload } from "@/lib/careers/server/uploads";
import { payloadTooLarge } from "@/lib/http/errors";
import { apiHandler } from "@/lib/http/handler";
import { assertSameOrigin, getClientIp } from "@/lib/http/request";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A 10 MB CV over a slow mobile connection needs more than the default budget, and the bytes
// are forwarded to Drive before the response is sent.
export const maxDuration = 60;

// The largest a single upload may ever be; the ticket pins the exact size per file and
// receiveUpload() enforces the per-kind limit, so this is only the outer cap on what is read
// into memory at all.
const MAX_UPLOAD_BYTES = UPLOAD_LIMITS.cvMaxBytes;

type UploadRouteContext = { params: Promise<{ id: string }> };

// PUT /api/uploads/<uploadId>?t=<ticket> — receives the file bytes issued a ticket by
// POST /api/uploads. The signed ticket is the authorisation (it names the upload id, the kind,
// the purpose and the exact byte length), so there is no session requirement here: this is the
// URL the candidate's browser writes to, and candidates are not signed in. The same-origin
// check and the 'upload-ip' rate limit that guard the ticket request guard this too, so a
// stolen ticket cannot be replayed from elsewhere or used to hammer the server.
export const PUT = apiHandler("api.uploads.receive", async (request: Request, context: UploadRouteContext) => {
  assertSameOrigin(request);
  await enforceRateLimit(
    "upload-ip",
    getClientIp(request),
    RATE_LIMITS["upload-ip"],
    "Too many upload attempts. Please wait a few minutes and try again."
  );

  const { id } = await context.params;
  const token = new URL(request.url).searchParams.get("t");

  // A truthful Content-Length is rejected before the body is read at all; a missing or lying
  // one is caught by the check on the bytes actually received.
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) throw payloadTooLarge("That file is too large.");

  const body = Buffer.from(await request.arrayBuffer());
  if (body.byteLength > MAX_UPLOAD_BYTES) throw payloadTooLarge("That file is too large.");

  await receiveUpload(id, token, body);

  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
});
