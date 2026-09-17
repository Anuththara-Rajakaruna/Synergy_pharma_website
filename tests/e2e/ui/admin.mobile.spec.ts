import { e2eEnv } from "../support/env";
import { createHrTalent, createJob, jobSeed, newCandidate, retireJob, submitApplication, token, type AdminJobDto, type Candidate } from "./helpers/data";
import { adminWorkspaceShot, drawerSection, openAdminTab, recordRow, toast } from "./helpers/admin";
import { expect, expectNoHorizontalOverflow, reviewShot, signInAsAdmin, test } from "./helpers/fixtures";

// The admin workspace on a phone (Pixel 7): cards instead of tables, full-screen drawers and
// dialogs that can be completed with touch input.

let job: AdminJobDto;
let applicant: Candidate;
let talent: Candidate;
const cleanup: string[] = [];

test.beforeAll(async ({ adminCookie }) => {
  job = await createJob(adminCookie, jobSeed({ title: `Mobile Admin Role ${token()}` }));
  applicant = newCandidate("MobileAdmin");
  await submitApplication(job.id, applicant, { coverLetter: "Reviewed on a phone.", supporting: 1 });
  talent = newCandidate("MobileTalentAdmin");
  await createHrTalent(adminCookie, talent, ["mobile-review"]);
});

test.afterAll(async ({ adminCookie }) => {
  for (const slug of [job?.id, ...cleanup]) if (slug) await retireJob(adminCookie, slug);
});

test("an administrator signs in on a phone and every tab fits the screen", async ({ page }) => {
  await page.goto("/careers/admin");
  await expect(page).toHaveURL(/\/careers\/admin\/login/);
  await reviewShot(page, "admin-login");
  await page.getByLabel("Email address").fill(e2eEnv.adminEmail);
  await page.getByLabel("Password", { exact: true }).fill(e2eEnv.adminPassword);
  await page.getByRole("button", { name: "Sign In" }).tap();
  await expect(page.getByRole("tab", { name: /Job Postings/ })).toHaveAttribute("aria-selected", "true");

  const tabs = [
    { id: "jobs", shot: "admin-jobs-tab", ready: /job/ },
    { id: "applications", shot: "admin-applications-tab", ready: /application/ },
    { id: "talent", shot: "admin-talent-tab", ready: /profile/ },
    { id: "users", shot: "admin-team-tab", ready: /account/ },
    { id: "audit", shot: "admin-activity-tab", ready: /entr/ },
  ] as const;
  for (const tab of tabs) {
    const panel = await openAdminTab(page, tab.id);
    await expect(panel.locator(".adm-results").first()).toHaveText(tab.ready);
    await expectNoHorizontalOverflow(page, `${tab.id} tab on a phone`);
    // Phones get record cards; the wide tables are hidden.
    if (tab.id !== "jobs") {
      await expect(panel.locator(".adm-only-mobile").first()).toBeVisible();
      await expect(panel.locator(".adm-table-wrap").first()).toBeHidden();
    }
    await adminWorkspaceShot(page, tab.shot);
  }
});

test("the application drawer is full screen and usable on a phone", async ({ page, context }) => {
  await signInAsAdmin(context);
  const panel = await openAdminTab(page, "applications");
  await panel.getByRole("searchbox", { name: "Search" }).fill(applicant.email);
  const card = recordRow(panel, applicant.email);
  await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: /View/ }).tap();

  const drawer = page.getByRole("dialog", { name: applicant.name });
  await expect(drawerSection(drawer, "Documents (2)")).toBeVisible();
  const viewport = page.viewportSize();
  await expect.poll(async () => Math.round((await drawer.boundingBox())?.width ?? 0)).toBe(viewport?.width);
  await expectNoHorizontalOverflow(page, "application drawer on a phone");
  await reviewShot(page, "admin-application-drawer");

  const status = drawerSection(drawer, "Status");
  await status.getByLabel("New status").selectOption("under_review");
  await status.getByRole("button", { name: "Update status" }).tap();
  await expect(toast(page, "Status changed to Under Review.")).toBeVisible();
  await expect(drawerSection(drawer, "Status history").getByRole("listitem").first()).toContainText("Under Review");
  await drawer.getByRole("button", { name: "Close" }).tap();
  await expect(drawer).toBeHidden();
});

test("the talent drawer and the job editor are usable on a phone", async ({ page, context }) => {
  await signInAsAdmin(context);
  const panel = await openAdminTab(page, "talent");
  await panel.getByRole("searchbox", { name: "Search" }).fill(talent.email);
  await recordRow(panel, talent.email).getByRole("button", { name: `View profile of ${talent.name}` }).tap();
  const drawer = page.getByRole("dialog", { name: talent.name });
  const notes = drawerSection(drawer, /^HR notes/);
  await notes.getByLabel("Add a note").fill("Called from the mobile workspace.");
  await notes.getByRole("button", { name: "Add note" }).tap();
  await expect(toast(page, "Note added.")).toBeVisible();
  await expectNoHorizontalOverflow(page, "talent drawer on a phone");
  await reviewShot(page, "admin-talent-drawer");
  await drawer.getByRole("button", { name: "Close" }).tap();

  const jobs = await openAdminTab(page, "jobs");
  await jobs.getByRole("button", { name: "Add job" }).tap();
  const editor = page.getByRole("dialog", { name: "Add a job posting" });
  await expect(editor.getByLabel("Job title")).toBeFocused();
  const title = `Mobile Draft ${token()}`;
  await editor.getByLabel("Job title").fill(title);
  cleanup.push((await editor.getByLabel("Job ID").inputValue()) || title.toLowerCase().replace(/\s+/g, "-"));
  await editor.getByLabel("Department").fill("IT");
  await editor.getByLabel("Location").fill("Colombo");
  await editor.getByLabel("Description").fill("Created from a phone.");
  await editor.getByLabel("Responsibilities").fill("Keep systems running");
  await editor.getByLabel("Requirements").fill("Networking basics");
  await expectNoHorizontalOverflow(page, "job editor on a phone");
  await reviewShot(page, "admin-job-editor");
  await editor.getByRole("button", { name: "Save as draft" }).tap();
  await expect(editor).toBeHidden();
  await expect(toast(page, `“${title}” was saved as a draft.`)).toBeVisible();
});
