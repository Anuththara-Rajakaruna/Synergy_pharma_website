import { newCandidate, submitTalentProfile } from "./helpers/data";
import { decodeQuotedPrintable, expect, pdfUpload, reviewShot, test, waitForEmail } from "./helpers/fixtures";
import { expectFieldError, talentForm, uploadedFileNames } from "./helpers/public-forms";

test("the talent pool form reports every missing field and focuses the first one", async ({ page }) => {
  await page.goto("/careers#talent-pool");
  const form = talentForm(page);
  await form.submit.click();

  await expectFieldError(form.name, "Full name is required.");
  await expectFieldError(form.email, "Email address is required.");
  await expectFieldError(form.phone, "Phone number is required.");
  await expectFieldError(form.area, "Please choose an area of interest.");
  await expectFieldError(form.consent, "Please read and accept the privacy policy to submit your profile.");
  await expect(form.section.locator("#talent-cv-error")).toHaveText("Please upload your CV.");
  await expect(form.name).toBeFocused();
  await reviewShot(page, "talent-pool-form-errors", { target: form.section });

  await form.cvInput.setInputFiles({ name: "cv.png", mimeType: "image/png", buffer: Buffer.from("png") });
  await expect(form.section.locator("#talent-cv-error")).toHaveText("CV must be a PDF file.");
});

test("a candidate joins the talent pool with documents and receives a confirmation email", async ({ page }) => {
  const candidate = newCandidate("Talent");
  await page.goto("/careers#talent-pool");
  const form = talentForm(page);

  await form.name.fill(candidate.name);
  await form.email.fill(candidate.email);
  await form.phone.fill(candidate.phone);
  await form.area.selectOption("Regulatory Affairs");
  await form.notes.fill("Interested in dossier preparation roles.");
  await expect(form.section.getByText(/^40 \/ 1500 characters$/)).toBeVisible();
  await form.cvInput.setInputFiles(pdfUpload("Talent CV.pdf"));
  await form.supportingInput.setInputFiles([pdfUpload("Reference letter.pdf", 4000), pdfUpload("Transcript.pdf", 4000)]);
  await expect(uploadedFileNames(form.section)).toHaveText(["Talent CV.pdf", "Reference letter.pdf", "Transcript.pdf"]);
  await form.consent.check();
  await reviewShot(page, "talent-pool-form-filled", { target: form.section });
  await form.submit.click();

  const heading = form.section.getByRole("heading", { name: "Thank you for joining our talent pool." });
  await expect(heading).toBeVisible({ timeout: 60_000 });
  await expect(heading).toBeFocused();
  const reference = form.section.locator(".careers-success-reference strong");
  await expect(reference).toHaveText(/^TP-[0-9A-F]{8}$/);
  await expect(form.section.getByRole("link", { name: "View open positions" })).toBeVisible();
  await reviewShot(page, "talent-pool-form-success", { target: form.section });

  const mail = await waitForEmail({ to: candidate.email, subject: "talent pool" });
  expect(decodeQuotedPrintable(mail.raw)).toContain(candidate.name);
});

test("an email address already in the talent pool gets the duplicate message", async ({ page }) => {
  const candidate = newCandidate("TalentDup");
  await submitTalentProfile(candidate);

  await page.goto("/careers#talent-pool");
  const form = talentForm(page);
  await form.name.fill(candidate.name);
  await form.email.fill(candidate.email);
  await form.phone.fill(candidate.phone);
  await form.area.selectOption("Quality Control");
  await form.cvInput.setInputFiles(pdfUpload("Another CV.pdf"));
  await form.consent.check();
  await form.submit.click();

  await expect(form.alert).toHaveText(/already in our talent pool/);
  await expect(form.section.getByRole("heading", { name: "Thank you for joining our talent pool." })).toHaveCount(0);
});
