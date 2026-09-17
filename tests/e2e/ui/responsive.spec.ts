import { createJob, jobSeed, newCandidate, retireJob, submitApplication, token, type AdminJobDto, type Candidate } from "./helpers/data";
import { openAdminTab, recordRow } from "./helpers/admin";
import { expect, expectNoHorizontalOverflow, pdfUpload, signInAsAdmin, test } from "./helpers/fixtures";
import { applicationForm, expectCurrentStep } from "./helpers/public-forms";
import type { Locator, Page } from "@playwright/test";

// Layout checks at phone, tablet and desktop widths: the page never scrolls sideways and the
// main controls stay visible and inside the viewport.

const VIEWPORTS = [
  { width: 375, height: 812, label: "phone" },
  { width: 768, height: 1024, label: "tablet" },
  { width: 1440, height: 900, label: "desktop" },
] as const;

let job: AdminJobDto;
let candidate: Candidate;

test.beforeAll(async ({ adminCookie }) => {
  // A long title and location exercise wrapping in cards, summaries and tables.
  job = await createJob(
    adminCookie,
    jobSeed({
      title: `Senior Production Planning and Inventory Control Executive ${token()}`,
      department: "Production Planning & Inventory Control",
      location: "Biyagama Export Processing Zone, Western Province, Sri Lanka",
    })
  );
  candidate = newCandidate("Responsive");
  await submitApplication(job.id, candidate, { coverLetter: "Supplychainplanningandinventorycontrolspecialistwithlongwords ".repeat(3) });
});

test.afterAll(async ({ adminCookie }) => {
  if (job) await retireJob(adminCookie, job.id);
});

// The element's box once entrance animations (drawer slide-in, dialog zoom) have finished.
async function settledBox(locator: Locator): Promise<{ x: number; y: number; width: number; height: number } | null> {
  let previous = await locator.boundingBox();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const current = await locator.boundingBox();
    if (current && previous && current.x === previous.x && current.width === previous.width) return current;
    previous = current;
  }
  return previous;
}

// Soft assertions: one clipped control should not hide problems with the rest of the page.
async function expectInsideViewport(page: Page, locator: Locator, what: string): Promise<void> {
  await expect(locator, what).toBeVisible();
  const box = await settledBox(locator);
  const width = page.viewportSize()?.width ?? 0;
  expect(box, what).not.toBeNull();
  if (!box) return;
  expect.soft(box.x, `${what} starts inside the viewport`).toBeGreaterThanOrEqual(-1);
  expect.soft(box.x + box.width, `${what} ends inside the viewport (${width}px wide)`).toBeLessThanOrEqual(width + 1);
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.label} ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("public careers pages and forms fit the screen", async ({ page }) => {
      await page.goto(`/careers?q=${encodeURIComponent(job.title)}`);
      await expectNoHorizontalOverflow(page, "careers listing");
      await expectInsideViewport(page, page.getByRole("searchbox", { name: "Search roles" }), "search box");
      await expectInsideViewport(page, page.locator("#open-positions").getByRole("heading", { name: job.title }), "job card title");
      await expectInsideViewport(page, page.locator("#talent-pool").getByRole("button", { name: "Submit to Talent Pool" }), "talent pool submit");

      await page.goto(`/careers/${job.id}`);
      await expectNoHorizontalOverflow(page, "job detail");
      await expectInsideViewport(page, page.getByRole("link", { name: "Apply Now" }).first(), "Apply Now");

      const form = applicationForm(page);
      await form.section.scrollIntoViewIfNeeded();
      await expectInsideViewport(page, form.progress, "application progress");
      await form.name.fill(candidate.name);
      await form.email.fill(`ui.responsive.${token()}@example.com`);
      await form.phone.fill(candidate.phone);
      await form.continueButton.click();
      await expectCurrentStep(form.progress, "Role & CV");
      await form.cvInput.setInputFiles(pdfUpload("A very long curriculum vitae file name for layout checks 2026.pdf"));
      await expectNoHorizontalOverflow(page, "application step 2 with a CV");
      await expectInsideViewport(page, form.continueButton, "Continue button");
      await form.continueButton.click();
      await expectCurrentStep(form.progress, "Review");
      await expectNoHorizontalOverflow(page, "application review step");
      await expectInsideViewport(page, form.submitButton, "Submit button");

      await page.goto("/contact");
      await expectNoHorizontalOverflow(page, "contact page");
      await expectInsideViewport(page, page.getByRole("button", { name: "Send Message" }), "Send Message");

      await page.goto("/careers/admin/login");
      await expectNoHorizontalOverflow(page, "admin login");
      await expectInsideViewport(page, page.getByRole("button", { name: "Sign In" }), "Sign In");
    });

    test("admin tabs, dialogs and drawers fit the screen", async ({ page, context }) => {
      test.slow();
      await signInAsAdmin(context);

      const jobs = await openAdminTab(page, "jobs");
      await jobs.getByRole("searchbox", { name: "Search" }).fill(job.id);
      await expect(jobs.getByRole("heading", { name: job.title })).toBeVisible();
      await expectNoHorizontalOverflow(page, "jobs tab");
      await expectInsideViewport(page, jobs.getByRole("button", { name: "Add job" }), "Add job");
      await expectInsideViewport(page, jobs.getByRole("group", { name: `Actions for ${job.title}` }).getByRole("button", { name: "Edit" }), "Edit job");

      await jobs.getByRole("button", { name: "Add job" }).click();
      const editor = page.getByRole("dialog", { name: "Add a job posting" });
      await expectInsideViewport(page, editor, "job editor dialog");
      await expectInsideViewport(page, editor.getByLabel("Job title"), "job title field");
      await editor.getByRole("button", { name: "Publish" }).scrollIntoViewIfNeeded();
      await expectInsideViewport(page, editor.getByRole("button", { name: "Publish" }), "Publish button");
      await page.keyboard.press("Escape");
      await expect(editor).toBeHidden();

      const applications = await openAdminTab(page, "applications");
      await applications.getByRole("searchbox", { name: "Search" }).fill(candidate.email);
      const row = recordRow(applications, candidate.email);
      await expect(row).toHaveCount(1);
      await expectNoHorizontalOverflow(page, "applications tab");
      // Row actions must be reachable, if necessary by scrolling a table container sideways.
      await row.getByRole("button", { name: /View/ }).scrollIntoViewIfNeeded();
      await expectInsideViewport(page, row.getByRole("button", { name: /View/ }), "application View button");
      await row.getByRole("button", { name: /View/ }).click();
      const drawer = page.getByRole("dialog", { name: candidate.name });
      await expect(drawer.getByText("Cover letter")).toBeVisible();
      await expectInsideViewport(page, drawer, "application drawer");
      await expectInsideViewport(page, drawer.getByRole("button", { name: "Close" }), "drawer close button");
      await expectInsideViewport(page, drawer.getByRole("button", { name: "Archive" }), "drawer Archive button");
      await expectNoHorizontalOverflow(page, "application drawer");
      if (viewport.width < 640) {
        const box = await settledBox(drawer);
        expect(box?.width, "the drawer is full width on phones").toBeGreaterThanOrEqual(viewport.width - 1);
      }
      await page.keyboard.press("Escape");

      const talent = await openAdminTab(page, "talent");
      await expect(talent.locator(".adm-results")).toHaveText(/profile/);
      await expectNoHorizontalOverflow(page, "talent tab");
      await expectInsideViewport(page, talent.getByRole("button", { name: "Add candidate" }), "Add candidate");
      await expectInsideViewport(page, talent.getByLabel("Profile status"), "Profile status filter");
      const viewProfile = talent.getByRole("button", { name: /View profile of/ }).filter({ visible: true }).first();
      await viewProfile.scrollIntoViewIfNeeded();
      await expectInsideViewport(page, viewProfile, "talent View profile button");
      await talent.getByRole("button", { name: "Add candidate" }).click();
      const add = page.getByRole("dialog", { name: "Add a candidate" });
      await expectInsideViewport(page, add, "add candidate dialog");
      await page.keyboard.press("Escape");
      await expect(add).toBeHidden();

      const users = await openAdminTab(page, "users");
      await expect(users.locator(".adm-results")).toHaveText(/account/);
      await expectNoHorizontalOverflow(page, "team tab");
      const editUser = users.getByRole("button", { name: /^Edit/ }).filter({ visible: true }).first();
      await editUser.scrollIntoViewIfNeeded();
      await expectInsideViewport(page, editUser, "team Edit button");
      await expectInsideViewport(page, users.getByRole("button", { name: "Add user" }), "Add user");

      const audit = await openAdminTab(page, "audit");
      await expect(audit.locator(".adm-results").first()).toHaveText(/entr/);
      await expectNoHorizontalOverflow(page, "activity tab");
      await expectInsideViewport(page, audit.getByLabel("Action"), "Action filter");
      await expectInsideViewport(page, audit.getByRole("button", { name: "Download data (JSON)" }), "candidate export button");
    });
  });
}
