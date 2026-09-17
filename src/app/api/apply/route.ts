import { submitApplication } from "@/lib/careers/server/applications";
import { normalizeEmail, validateApplicationSubmission } from "@/lib/careers/validation";
import { badRequest } from "@/lib/http/errors";
import { apiHandler, jsonResponse } from "@/lib/http/handler";
import { assertSameOrigin, getClientIp, readJsonBody } from "@/lib/http/request";
import { RATE_LIMITS, enforceRateLimit } from "@/lib/rate-limit";
import type { SubmissionResponse } from "@/types/careers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 1024 * 1024;
const SUCCESS_MESSAGE = "Application submitted successfully.";

// POST /api/apply — public job application. Files were uploaded directly to storage beforehand
// (POST /api/uploads); this request references them by upload id.
export const POST = apiHandler("api.apply", async (request: Request) => {
  assertSameOrigin(request);
  const body = await readJsonBody(request, MAX_BODY_BYTES);

  const ip = getClientIp(request);
  await enforceRateLimit(
    "apply-ip",
    ip,
    RATE_LIMITS["apply-ip"],
    "Too many applications have been sent from your network. Please try again later."
  );

  const result = validateApplicationSubmission(body);
  if (!result.ok) throw badRequest(result.message, result.errors);

  await enforceRateLimit(
    "apply-email",
    normalizeEmail(result.value.email),
    RATE_LIMITS["apply-email"],
    "Too many applications have been sent for this email address. Please try again later."
  );

  const { reference } = await submitApplication(result.value, { ip });
  const response: SubmissionResponse = { success: true, reference, message: SUCCESS_MESSAGE };
  return jsonResponse(response, { status: 201 });
});
