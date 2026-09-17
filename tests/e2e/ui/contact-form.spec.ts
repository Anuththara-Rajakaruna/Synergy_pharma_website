import { letters, token } from "./helpers/data";
import { decodeQuotedPrintable, expect, reviewShot, test, waitForEmail } from "./helpers/fixtures";
import { expectFieldError } from "./helpers/public-forms";
import type { Page } from "@playwright/test";

function contactForm(page: Page) {
  const form = page.locator("form.contact-form");
  return {
    form,
    fullName: form.getByLabel("Full Name"),
    company: form.getByLabel("Company / Organization"),
    email: form.getByLabel("Email Address"),
    phone: form.getByLabel("Phone Number"),
    subject: form.getByLabel("Subject"),
    message: form.getByLabel("Message"),
    send: form.getByRole("button", { name: /Send Message|Sending/ }),
  };
}

test("the contact form shows field errors and focuses the first invalid field", async ({ page }) => {
  await page.goto("/contact");
  const contact = contactForm(page);
  await contact.send.click();

  await expect(contact.form.getByRole("alert")).toHaveText("Please correct the highlighted fields and try again.");
  await expectFieldError(contact.fullName, "Full name is required.");
  await expectFieldError(contact.email, "Email address is required.");
  await expectFieldError(contact.subject, "Subject is required.");
  await expectFieldError(contact.message, "Message is required.");
  await expect(contact.phone).toHaveAttribute("aria-invalid", "false");
  await expect(contact.fullName).toBeFocused();

  await contact.fullName.fill("Kasun Silva");
  await contact.email.fill("kasun@invalid");
  await contact.phone.fill("abc");
  await contact.send.click();
  await expectFieldError(contact.email, "Please enter a valid email address.");
  await expectFieldError(contact.phone, "Please enter a valid phone number.");
  await expect(contact.email).toBeFocused();
  await reviewShot(page, "contact-form-errors", { target: contact.form });
});

test("a valid enquiry is sent, the form resets and the team receives the email", async ({ page }) => {
  await page.goto("/contact");
  const contact = contactForm(page);
  const subject = `Distribution enquiry ${token()}`;
  await contact.fullName.fill(`Kasun ${letters()}`);
  await contact.company.fill("Lanka Pharmacy Group");
  await contact.email.fill(`ui.contact.${token()}@example.com`);
  await contact.phone.fill("+94 11 234 5678");
  await contact.subject.fill(subject);
  await contact.message.fill("We would like to discuss distributing your products in the Southern Province.");
  await reviewShot(page, "contact-form-filled", { target: contact.form });
  await contact.send.click();

  await expect(contact.form.getByRole("status")).toHaveText("Thank you for reaching out. Our team will get back to you shortly.");
  await expect(contact.fullName).toHaveValue("");
  await expect(contact.message).toHaveValue("");
  await reviewShot(page, "contact-form-success", { target: contact.form });

  const mail = await waitForEmail({ to: "info@synergypharma.lk", subject: `Website enquiry: ${subject}` });
  expect(decodeQuotedPrintable(mail.raw)).toContain("Southern Province");
});
