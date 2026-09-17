import { createJob, jobSeed, letters, newCandidate, retireJob, token, type AdminJobDto } from "./helpers/data";
import { expect, expectNoHorizontalOverflow, pdfUpload, reviewShot, test, waitForEmail } from "./helpers/fixtures";
import { completeApplication, talentForm, uploadedFileNames } from "./helpers/public-forms";

// Phone (Pixel 7) journeys through the public careers site, with review screenshots.

let job: AdminJobDto;

test.beforeAll(async ({ adminCookie }) => {
  job = await createJob(adminCookie, jobSeed({ title: `Packaging Technologist ${token()}`, department: "Packaging Development", location: "Pannala" }));
});

test.afterAll(async ({ adminCookie }) => {
  if (job) await retireJob(adminCookie, job.id);
});

test("the mobile menu, careers listing and job detail work on a phone", async ({ page }) => {
  await page.goto("/");
  const menuButton = page.getByRole("button", { name: "Open navigation menu" });
  await menuButton.tap();
  await expect(page.getByRole("button", { name: "Close navigation menu" })).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: /Careers/i }).tap();
  await expect(page).toHaveURL(/\/careers$/);
  await expect(page.getByRole("heading", { level: 1, name: /Join us in advancing/ })).toBeVisible();
  await expectNoHorizontalOverflow(page, "careers on a phone");

  const search = page.getByRole("searchbox", { name: "Search roles" });
  await search.scrollIntoViewIfNeeded();
  await search.fill(job.id.replace("ui-e2e-", ""));
  await expect(page.locator("#open-positions").getByRole("heading", { name: job.title })).toBeVisible();
  await reviewShot(page, "careers-listing", { target: page.locator("#open-positions") });

  await page.getByRole("link", { name: `View details for ${job.title}` }).tap();
  await expect(page.getByRole("heading", { level: 1, name: job.title })).toBeVisible();
  await expectNoHorizontalOverflow(page, "job detail on a phone");
  await reviewShot(page, "job-detail");
  await reviewShot(page, "job-detail-full", { fullPage: true });
  // The hero and the sticky position summary both link to the form.
  await page.getByRole("link", { name: "Apply Now" }).first().tap();
  await expect(page.getByRole("heading", { name: "Submit your application in three quick steps." })).toBeInViewport();
});

test("a candidate applies for a job from a phone", async ({ page }) => {
  const candidate = newCandidate("Mobile");
  await page.goto(`/careers/${job.id}#apply`);
  const reference = await completeApplication(page, candidate, {
    coverLetter: "Applying from my phone.",
    supportingName: "Packaging certificate.pdf",
    screenshots: "application",
  });
  await expectNoHorizontalOverflow(page, "application success on a phone");
  await waitForEmail({ to: candidate.email, subject: `Application received: ${job.title} (${reference})` });
});

test("the talent pool form works on a phone", async ({ page }) => {
  const candidate = newCandidate("MobileTalent");
  await page.goto("/careers#talent-pool");
  const form = talentForm(page);
  await form.submit.scrollIntoViewIfNeeded();
  await form.submit.tap();
  await expect(form.name).toBeFocused();
  await reviewShot(page, "talent-pool-form-errors", { target: form.section });

  await form.name.fill(candidate.name);
  await form.email.fill(candidate.email);
  await form.phone.fill(candidate.phone);
  await form.area.selectOption("Warehouse");
  await form.cvInput.setInputFiles(pdfUpload("Mobile CV.pdf"));
  await expect(uploadedFileNames(form.section)).toHaveText(["Mobile CV.pdf"]);
  await form.consent.check();
  await reviewShot(page, "talent-pool-form", { target: form.section });
  await expectNoHorizontalOverflow(page, "talent pool form on a phone");
  await form.submit.tap();
  await expect(form.section.getByRole("heading", { name: "Thank you for joining our talent pool." })).toBeVisible({ timeout: 60_000 });
  await reviewShot(page, "talent-pool-form-success", { target: form.section });
});

test("the contact form works on a phone", async ({ page }) => {
  await page.goto("/contact");
  const form = page.locator("form.contact-form");
  await form.getByRole("button", { name: "Send Message" }).tap();
  await expect(form.getByRole("alert")).toBeVisible();
  await reviewShot(page, "contact-form-errors", { target: form });

  await form.getByLabel("Full Name").fill(`Dilani ${letters()}`);
  await form.getByLabel("Email Address").fill(`ui.mobile.contact.${token()}@example.com`);
  await form.getByLabel("Subject").fill(`Mobile enquiry ${token()}`);
  await form.getByLabel("Message").fill("Do you supply hospital pharmacies directly?");
  await form.getByRole("button", { name: "Send Message" }).tap();
  await expect(form.getByRole("status")).toHaveText(/Thank you for reaching out/);
  await expectNoHorizontalOverflow(page, "contact page on a phone");
  await reviewShot(page, "contact-form", { target: form });
});
