import { expect, test } from "@playwright/test";
import { api, uniqueSuffix } from "../support/api";
import { expectApiError, expectRetryAfter, expectStatus } from "./lib/assertions";
import { ORIGIN_EVIL, VALID_PHONE, isolatedClientIp, sendStreamedJson } from "./lib/fixtures";
import { sentTo, waitForEmails } from "./lib/mail";

// POST /api/contact: the website contact form, delivered to CONTACT_NOTIFICATION_EMAIL.

const CONTACT_INBOX = "info@synergypharma.lk";
const SUCCESS = { success: true, message: "Thank you for reaching out. Our team will get back to you shortly." };

function contactBody(marker: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fullName: "Kasun Fernando",
    company: "Colombo Traders",
    email: `e2e.contact.${marker}@example.com`,
    phone: VALID_PHONE,
    subject: `Distribution enquiry ${marker}`,
    message: "We would like to discuss distribution in the Western Province.",
    website: "",
    ...overrides,
  };
}

test.describe("POST /api/contact", () => {
  test("accepts a message and emails it to the contact inbox with the sender as Reply-To", async () => {
    const marker = uniqueSuffix();
    const body = contactBody(marker, {
      subject: `<script>alert("x")</script> Pricing ${marker}`,
      message: `Hello & welcome <img src=x onerror=alert(1)>\nSecond line ${marker}`,
    });
    const result = await api("POST", "/api/contact", { json: body });
    expectStatus(result, 202);
    expect(result.body).toEqual(SUCCESS);
    expect(result.headers.get("cache-control")).toContain("no-store");

    const [mail] = await waitForEmails((item) => sentTo(item, CONTACT_INBOX) && item.text.includes(`Second line ${marker}`));
    expect(mail.replyTo.toLowerCase()).toContain(String(body.email));
    expect(mail.envelopeTo).toEqual([CONTACT_INBOX]);
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<img src=x");
    expect(mail.text).toContain("Colombo Traders");
  });

  test("reports invalid fields using the form's field names", async () => {
    const result = await api("POST", "/api/contact", {
      json: { fullName: "4", email: "nope", phone: "abc", company: "c".repeat(121), subject: "", message: "" },
    });
    expectApiError(result, 400, "invalid_input", { fields: ["fullName", "email", "phone", "company", "subject", "message"] });

    const operators = await api("POST", "/api/contact", { json: contactBody(uniqueSuffix(), { email: { $ne: null }, message: ["a"] }) });
    expectApiError(operators, 400, "invalid_input", { fields: ["email", "message"] });

    // Phone and company are optional.
    const minimal = await api("POST", "/api/contact", { json: contactBody(uniqueSuffix(), { phone: "", company: "" }) });
    expectStatus(minimal, 202);
  });

  test("an autofilled website field is ignored and the message is still delivered", async () => {
    // There is no honeypot: autofill filled it for real visitors, whose messages were silently dropped.
    const marker = uniqueSuffix();
    const result = await api("POST", "/api/contact", { json: contactBody(marker, { website: "https://visitor.example" }) });
    expectStatus(result, 202);
    expect(result.body).toEqual(SUCCESS);
    await waitForEmails((mail) => mail.subject.includes(marker) || mail.text.includes(marker));
  });

  test("cross-site submissions are refused", async () => {
    const body = contactBody(uniqueSuffix());
    expectApiError(await api("POST", "/api/contact", { json: body, headers: { origin: ORIGIN_EVIL } }), 403, "cross_site_request");
    expectApiError(
      await api("POST", "/api/contact", { json: body, sameOrigin: false, headers: { "sec-fetch-site": "cross-site" } }),
      403,
      "cross_site_request"
    );
  });

  test("requires a JSON object body within 1 MB", async () => {
    const body = contactBody(uniqueSuffix());
    expectApiError(await api("POST", "/api/contact", { body: new URLSearchParams({ fullName: "Kasun" }).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } }), 415, "unsupported_media_type");
    expectApiError(await api("POST", "/api/contact", { json: [body] }), 400, "invalid_json");
    expectApiError(await api("POST", "/api/contact", { json: { ...body, message: "m".repeat(1024 * 1024) } }), 413, "payload_too_large");
    const streamed = await sendStreamedJson("POST", "/api/contact", 1100 * 1024);
    expect(streamed.status, streamed.text.slice(0, 200)).toBe(413);
  });

  test("the contact-ip bucket allows 5 messages per 15 minutes per client", async () => {
    const ip = isolatedClientIp();
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const result = await api("POST", "/api/contact", { json: contactBody(uniqueSuffix()), ip });
      expect(result.status, `message ${attempt}`).toBe(202);
    }
    const limited = await api("POST", "/api/contact", { json: contactBody(uniqueSuffix()), ip });
    expectApiError(limited, 429, "rate_limited");
    expectRetryAfter(limited, 15 * 60);
  });
});
