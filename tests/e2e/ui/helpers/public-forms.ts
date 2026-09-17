import type { Locator, Page, Route } from "@playwright/test";
import type { Candidate } from "./data";
import { expect, pdfUpload, reviewShot } from "./fixtures";

// Page-object style helpers for the public application and talent pool forms.

// Names of the files currently attached in a public form.
export function uploadedFileNames(scope: Locator): Locator {
  return scope.locator(".careers-upload-file-name");
}

export function applicationForm(page: Page) {
  const section = page.locator("#apply");
  return {
    section,
    progress: section.getByRole("list", { name: "Application progress" }),
    name: section.getByLabel("Full name"),
    email: section.getByLabel("Email"),
    phone: section.getByLabel("Phone"),
    linkedIn: section.getByLabel("LinkedIn profile URL"),
    portfolio: section.getByLabel("Portfolio / Website URL"),
    cvInput: section.locator("#apply-cv"),
    supportingInput: section.locator("#apply-supporting"),
    coverLetter: section.getByLabel("Cover letter"),
    consent: section.getByRole("checkbox", { name: /I have read and agree to the Privacy Policy/ }),
    continueButton: section.getByRole("button", { name: "Continue" }),
    backButton: section.getByRole("button", { name: "Back" }),
    submitButton: section.getByRole("button", { name: /Submit Application|Submitting/ }),
    alert: section.getByRole("alert"),
  };
}

export async function expectCurrentStep(progress: Locator, label: string): Promise<void> {
  await expect(progress.locator('[aria-current="step"]')).toContainText(label);
}

// The error message rendered for a form control, found through the control's aria-describedby.
export async function expectFieldError(control: Locator, message: string | RegExp): Promise<void> {
  await expect(control).toHaveAttribute("aria-invalid", "true");
  const describedBy = (await control.getAttribute("aria-describedby")) ?? "";
  const errorId = describedBy.split(" ").find((id) => id.endsWith("-error"));
  expect(errorId, "the control references its error message").toBeTruthy();
  await expect(control.page().locator(`[id="${errorId}"]`)).toHaveText(message);
}

// Delays browser uploads to object storage so the progress UI can be observed.
export async function slowDownStorageUploads(page: Page, delayMs: number): Promise<void> {
  await page.route(
    (url) => url.pathname.includes("/incoming/"),
    async (route: Route) => {
      if (route.request().method() === "PUT") await new Promise((resolve) => setTimeout(resolve, delayMs));
      await route.continue();
    }
  );
}

// Fills and submits the three-step application form; returns the reference shown on success.
export async function completeApplication(
  page: Page,
  candidate: Candidate,
  options: { coverLetter?: string; supportingName?: string; screenshots?: string } = {}
): Promise<string> {
  const form = applicationForm(page);
  await form.name.fill(candidate.name);
  await form.email.fill(candidate.email);
  await form.phone.fill(candidate.phone);
  if (options.screenshots) await reviewShot(page, `${options.screenshots}-step1-details`, { target: form.section });
  await form.continueButton.click();

  await expectCurrentStep(form.progress, "Role & CV");
  await form.linkedIn.fill("https://www.linkedin.com/in/ui-e2e-candidate");
  await form.cvInput.setInputFiles(pdfUpload(`CV ${candidate.name}.pdf`));
  await expect(uploadedFileNames(form.section)).toHaveText([`CV ${candidate.name}.pdf`]);
  if (options.supportingName) {
    await form.supportingInput.setInputFiles(pdfUpload(options.supportingName, 5000));
    await expect(uploadedFileNames(form.section)).toHaveText([`CV ${candidate.name}.pdf`, options.supportingName]);
  }
  if (options.screenshots) await reviewShot(page, `${options.screenshots}-step2-documents`, { target: form.section });
  await form.continueButton.click();

  await expectCurrentStep(form.progress, "Review");
  if (options.coverLetter) await form.coverLetter.fill(options.coverLetter);
  await form.consent.check();
  if (options.screenshots) await reviewShot(page, `${options.screenshots}-step3-review`, { target: form.section });
  await form.submitButton.click();

  const reference = form.section.locator(".careers-success-reference strong");
  await expect(form.section.getByRole("heading", { name: "Thank you for applying." })).toBeVisible({ timeout: 60_000 });
  await expect(reference).toHaveText(/^APP-[0-9A-F]{8}$/);
  if (options.screenshots) await reviewShot(page, `${options.screenshots}-success`, { target: form.section });
  return (await reference.textContent()) ?? "";
}

export function talentForm(page: Page) {
  const section = page.locator("#talent-pool");
  return {
    section,
    name: section.getByLabel("Full name"),
    email: section.getByLabel("Email"),
    phone: section.getByLabel("Phone"),
    area: section.getByLabel("Area of interest"),
    notes: section.getByLabel("Notes"),
    cvInput: section.locator("#talent-cv"),
    supportingInput: section.locator("#talent-supporting"),
    consent: section.getByRole("checkbox", { name: /I have read and agree to the Privacy Policy/ }),
    submit: section.getByRole("button", { name: /Submit to Talent Pool|Submitting/ }),
    alert: section.getByRole("alert"),
  };
}
