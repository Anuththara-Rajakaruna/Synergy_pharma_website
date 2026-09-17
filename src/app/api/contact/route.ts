import { randomUUID } from "node:crypto";
import { validateContactSubmission } from "@/lib/careers/validation";
import { contactRecipients, enqueueEmails, scheduleEmailDelivery } from "@/lib/email/outbox";
import { contactMessageEmail } from "@/lib/email/templates";
import { badRequest, serviceUnavailable } from "@/lib/http/errors";
import { apiHandler, jsonResponse } from "@/lib/http/handler";
import { assertSameOrigin, getClientIp, readJsonBody } from "@/lib/http/request";
import { logger } from "@/lib/logger";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Gives the after() email delivery a known time budget.
export const maxDuration = 60;

const CONTACT_BODY_LIMIT = 1024 * 1024;
const SUCCESS = { success: true, message: "Thank you for reaching out. Our team will get back to you shortly." } as const;

export const POST = apiHandler("api.contact.create", async (request: Request) => {
  assertSameOrigin(request);
  const body = await readJsonBody(request, CONTACT_BODY_LIMIT);

  const result = validateContactSubmission(body);
  if (!result.ok) throw badRequest(result.message, result.errors);

  await enforceRateLimit(
    "contact-ip",
    getClientIp(request),
    RATE_LIMITS["contact-ip"],
    "You have sent several messages recently. Please try again later."
  );

  const recipients = contactRecipients();
  if (recipients.length === 0) {
    logger.error("email.contact_recipients_missing", {});
    throw serviceUnavailable(
      "We couldn't send your message right now. Please try again later or contact us by phone or email.",
      "contact_unavailable"
    );
  }

  const content = contactMessageEmail(result.value);
  const entityId = randomUUID();
  const ids = await enqueueEmails(
    recipients.map((to) => ({
      to,
      replyTo: result.value.email,
      template: "contact_message",
      content,
      related: { entityType: "contact", entityId },
    }))
  );
  scheduleEmailDelivery(ids);
  logger.info("contact.received", { entityId, recipients: ids.length });

  return jsonResponse(SUCCESS, { status: 202 });
});
