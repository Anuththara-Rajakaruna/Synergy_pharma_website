import { requireAdmin } from "@/lib/auth/require-admin";
import { createUploadTickets } from "@/lib/careers/server/uploads";
import { validateUploadRequest } from "@/lib/careers/validation";
import { badRequest } from "@/lib/http/errors";
import { apiHandler, jsonResponse } from "@/lib/http/handler";
import { assertSameOrigin, getClientIp, readJsonBody } from "@/lib/http/request";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import type { UploadResponse } from "@/types/careers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UPLOAD_REQUEST_LIMIT = 64 * 1024;

// Issues one signed upload ticket per file. The ticket points at PUT /api/uploads/<uploadId>,
// which receives the bytes, validates them and stages them in Google Drive.
export const POST = apiHandler("api.uploads.create", async (request: Request) => {
  const body = await readJsonBody(request, UPLOAD_REQUEST_LIMIT);

  let adminUserId: string | null = null;
  if (body.purpose === "admin_talent") {
    const ctx = await requireAdmin(request);
    adminUserId = ctx.userId;
  } else {
    assertSameOrigin(request);
    await enforceRateLimit(
      "upload-ip",
      getClientIp(request),
      RATE_LIMITS["upload-ip"],
      "Too many upload attempts. Please wait a few minutes and try again."
    );
  }

  const result = validateUploadRequest(body);
  if (!result.ok) throw badRequest(result.message, result.errors);

  const uploads = await createUploadTickets(result.value, { adminUserId });
  const response: UploadResponse = { uploads };
  return jsonResponse(response, { status: 201 });
});
