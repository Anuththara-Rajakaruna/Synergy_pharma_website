import { createJob, jobSeed, newCandidate, retireJob, token, type AdminJobDto } from "./helpers/data";
import { decodeQuotedPrintable, expect, pdfUpload, reviewShot, test, waitForEmail } from "./helpers/fixtures";
import { applicationForm, completeApplication, expectCurrentStep, expectFieldError, slowDownStorageUploads, uploadedFileNames } from "./helpers/public-forms";

let job: AdminJobDto;

test.beforeAll(async ({ adminCookie }) => {
  job = await createJob(adminCookie, jobSeed({ title: `Production Pharmacist ${token()}` }));
});

test.afterAll(async ({ adminCookie }) => {
  if (job) await retireJob(adminCookie, job.id);
});

test("each step validates its fields before moving on", async ({ page }) => {
  await page.goto(`/careers/${job.id}#apply`);
  const form = applicationForm(page);
  await expectCurrentStep(form.progress, "Details");
  await expect(form.backButton).toBeDisabled();

  await form.continueButton.click();
  await expectFieldError(form.name, "Full name is required.");
  await expectFieldError(form.email, "Email address is required.");
  await expectFieldError(form.phone, "Phone number is required.");
  await expect(form.name).toBeFocused();
  await expectCurrentStep(form.progress, "Details");
  await reviewShot(page, "application-step1-errors", { target: form.section });

  await form.name.fill("R2-D2");
  await form.email.fill("not-an-email");
  await form.phone.fill("12");
  await form.continueButton.click();
  await expectFieldError(form.name, "Please enter your name using letters only.");
  await expectFieldError(form.email, "Please enter a valid email address.");
  await expectFieldError(form.phone, "Please enter a valid phone number.");

  // Fixing a field clears its error straight away.
  const candidate = newCandidate("Validation");
  await form.name.fill(candidate.name);
  await expect(form.name).not.toHaveAttribute("aria-invalid", "true");
  await form.email.fill(candidate.email);
  await form.phone.fill(candidate.phone);
  await form.continueButton.click();

  await expectCurrentStep(form.progress, "Role & CV");
  await expect(form.section.getByLabel("Position")).toHaveValue(job.title);
  await form.linkedIn.fill("https://example.com/profile");
  await form.continueButton.click();
  await expectFieldError(form.linkedIn, "Please enter a LinkedIn URL on linkedin.com.");
  await expect(form.section.locator("#apply-cv-error")).toHaveText("Please upload your CV.");

  await form.cvInput.setInputFiles({ name: "resume.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("not a pdf") });
  await expect(form.section.locator("#apply-cv-error")).toHaveText("CV must be a PDF file.");
  await form.linkedIn.fill("");
  await form.cvInput.setInputFiles(pdfUpload("resume.pdf"));
  await expect(form.section.locator("#apply-cv-error")).toHaveCount(0);
  await expect(uploadedFileNames(form.section)).toHaveText(["resume.pdf"]);
  await form.section.getByRole("button", { name: "Remove resume.pdf" }).click();
  await expect(uploadedFileNames(form.section)).toHaveCount(0);
  await form.cvInput.setInputFiles(pdfUpload("resume.pdf"));
  await form.continueButton.click();

  await expectCurrentStep(form.progress, "Review");
  const review = form.section.locator(".career-application-review");
  await expect(review).toContainText(candidate.name);
  await expect(review).toContainText(candidate.email);
  await expect(review).toContainText("resume.pdf");
  await form.submitButton.click();
  await expectFieldError(form.consent, "Please read and accept the privacy policy to continue.");

  // Going back keeps what was entered.
  await form.backButton.click();
  await expectCurrentStep(form.progress, "Role & CV");
  await expect(uploadedFileNames(form.section)).toHaveText(["resume.pdf"]);
  await form.backButton.click();
  await expect(form.name).toHaveValue(candidate.name);
});

test("a candidate applies with a CV and a supporting document, sees a reference and receives a confirmation email", async ({ page }) => {
  const candidate = newCandidate("Apply");
  await slowDownStorageUploads(page, 2500);
  await page.goto(`/careers/${job.id}`);
  const form = applicationForm(page);

  await form.name.fill(candidate.name);
  await form.email.fill(candidate.email);
  await form.phone.fill(candidate.phone);
  await reviewShot(page, "application-step1-details", { target: form.section });
  await form.continueButton.click();

  await expectCurrentStep(form.progress, "Role & CV");
  await form.portfolio.fill("https://portfolio.example.com/nadeesha");
  await form.cvInput.setInputFiles(pdfUpload("Nadeesha CV.pdf", 20_000));
  await form.supportingInput.setInputFiles(pdfUpload("GMP certificate.pdf", 6_000));
  await expect(uploadedFileNames(form.section)).toHaveText(["Nadeesha CV.pdf", "GMP certificate.pdf"]);
  await reviewShot(page, "application-step2-documents", { target: form.section });
  await form.continueButton.click();

  await expectCurrentStep(form.progress, "Review");
  await form.coverLetter.fill("I have four years of experience in sterile manufacturing.");
  await expect(form.section.getByText(/^57 \/ 5000 characters$/)).toBeVisible();
  await form.consent.check();
  await reviewShot(page, "application-step3-review", { target: form.section });
  await form.submitButton.click();

  const progress = form.section.getByRole("progressbar");
  await expect(progress).toBeVisible();
  await expect(form.section.getByRole("button", { name: "Cancel upload" })).toBeVisible();
  await expect(form.coverLetter).toBeDisabled();
  await reviewShot(page, "application-uploading", { target: form.section });

  await expect(form.section.getByRole("heading", { name: "Thank you for applying." })).toBeVisible({ timeout: 60_000 });
  await expect(form.section.getByRole("heading", { name: "Thank you for applying." })).toBeFocused();
  const reference = (await form.section.locator(".careers-success-reference strong").textContent()) ?? "";
  expect(reference).toMatch(/^APP-[0-9A-F]{8}$/);
  await expect(form.section).toContainText(`Your application for ${job.title} has been submitted successfully.`);
  await expect(form.section.getByRole("link", { name: "Browse more roles" })).toHaveAttribute("href", "/careers");
  await reviewShot(page, "application-success", { target: form.section });

  const mail = await waitForEmail({ to: candidate.email, subject: `Application received: ${job.title} (${reference})` });
  const body = decodeQuotedPrintable(mail.raw);
  expect(body).toContain(candidate.name);
  expect(body).toContain(reference);
});

test("applying twice for the same role shows the duplicate message", async ({ page }) => {
  const candidate = newCandidate("Duplicate");
  await page.goto(`/careers/${job.id}`);
  await completeApplication(page, candidate);

  await page.reload();
  const form = applicationForm(page);
  await form.name.fill(candidate.name);
  // Same address with different letter case is still the same candidate.
  await form.email.fill(candidate.email.toUpperCase());
  await form.phone.fill(candidate.phone);
  await form.continueButton.click();
  await form.cvInput.setInputFiles(pdfUpload("second-attempt.pdf"));
  await form.continueButton.click();
  await form.consent.check();
  await form.submitButton.click();

  await expect(form.alert).toHaveText(/You have already applied for this role/);
  await expect(form.section.getByRole("heading", { name: "Thank you for applying." })).toHaveCount(0);
  await expect(form.submitButton).toBeEnabled();
  await reviewShot(page, "application-duplicate", { target: form.section });
});
