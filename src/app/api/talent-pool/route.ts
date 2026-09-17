import { submitTalentProfile } from "@/lib/careers/server/talent-pool";
import { normalizeEmail, validateTalentSubmission } from "@/lib/careers/validation";
import { badRequest } from "@/lib/http/errors";
import { apiHandler, jsonResponse } from "@/lib/http/handler";
import { assertSameOrigin, getClientIp, readJsonBody } from "@/lib/http/request";
import { RATE_LIMITS, enforceRateLimit } from "@/lib/rate-limit";
import type { SubmissionResponse } from "@/types/careers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 1024 * 1024;
const SUCCESS_MESSAGE = "Talent profile submitted successfully.";

// POST /api/talent-pool — public talent pool profile. Files were uploaded directly to storage
// beforehand (POST /api/uploads); this request references them by upload id.
export const POST = apiHandler("api.talent_pool", async (request: Request) => {
  assertSameOrigin(request);
  const body = await readJsonBody(request, MAX_BODY_BYTES);

  const ip = getClientIp(request);
  await enforceRateLimit(
    "talent-ip",
    ip,
    RATE_LIMITS["talent-ip"],
    "Too many profiles have been sent from your network. Please try again later."
  );

  const result = validateTalentSubmission(body);
  if (!result.ok) throw badRequest(result.message, result.errors);

  await enforceRateLimit(
    "talent-email",
    normalizeEmail(result.value.email),
    RATE_LIMITS["talent-email"],
    "Too many profiles have been sent for this email address. Please try again tomorrow."
  );

  const { reference } = await submitTalentProfile(result.value, { ip });
  const response: SubmissionResponse = { success: true, reference, message: SUCCESS_MESSAGE };
  return jsonResponse(response, { status: 201 });
});
