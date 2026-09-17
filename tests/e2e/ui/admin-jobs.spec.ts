import { colomboDate, createJob, jobSeed, newCandidate, retireJob, submitApplication, token } from "./helpers/data";
import { adminWorkspaceShot, confirmDialog } from "./helpers/admin";
import { expect, reviewShot, signInAsAdmin, test } from "./helpers/fixtures";
import { e2eEnv } from "../support/env";
import type { Locator, Page } from "@playwright/test";

function jobsPanel(page: Page) {
  const panel = page.getByRole("tabpanel");
  return {
    panel,
    search: panel.getByRole("searchbox", { name: "Search" }),
    status: panel.getByLabel("Status"),
    row: (title: string): Locator => panel.getByRole("list", { name: "Job postings" }).getByRole("listitem").filter({ has: page.getByRole("heading", { name: title, exact: true }) }),
    actions: (title: string): Locator => panel.getByRole("group", { name: `Actions for ${title}` }),
  };
}

const cleanup: string[] = [];

test.afterEach(async ({ adminCookie }) => {
  for (const slug of cleanup.splice(0)) await retireJob(adminCookie, slug);
});

test("a job goes from draft to published, edited, closed, archived, restored and deleted", async ({ page, context }) => {
  test.slow();
  await signInAsAdmin(context);
  await page.goto("/careers/admin?tab=jobs");
  const jobs = jobsPanel(page);
  const id = token();
  const title = `Regulatory Affairs Executive ${id}`;
  const slug = `regulatory-affairs-executive-${id}`;
  cleanup.push(slug);

  await jobs.panel.getByRole("button", { name: "Add job" }).click();
  const editor = page.getByRole("dialog", { name: "Add a job posting" });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("Job title")).toBeFocused();

  await editor.getByRole("button", { name: "Publish" }).click();
  await expect(editor.getByRole("alert")).toContainText("This job can't be published yet.");
  await expect(editor.getByLabel("Job title")).toHaveAttribute("aria-invalid", "true");
  await expect(editor.getByLabel("Description")).toHaveAttribute("aria-invalid", "true");
  await expect(editor.getByLabel("Responsibilities")).toHaveAttribute("aria-invalid", "true");
  await reviewShot(page, "admin-job-editor-errors");

  await editor.getByLabel("Job title").fill(title);
  await expect(editor.getByLabel("Job ID")).toHaveValue(slug);
  await expect(editor.getByText(`/careers/${slug}`)).toBeVisible();
  await editor.getByLabel("Department").fill("Regulatory Affairs");
  await editor.getByLabel("Location").fill("Colombo, Sri Lanka");
  await editor.getByLabel("Employment type").selectOption("Part-time");
  await editor.getByLabel("Experience").fill("3+ years preparing registration dossiers");
  const deadline = colomboDate(45);
  await editor.getByLabel("Application deadline").fill(deadline);
  await editor.getByLabel("Description").fill("Lead product registrations across export markets.\n\nWork closely with quality and production.");
  await editor.getByLabel("Responsibilities").fill("Compile registration dossiers\nTrack regulatory changes");
  await editor.getByLabel("Requirements").fill("BPharm degree\nExcellent written English");
  await editor.getByLabel("Qualifications").fill("Regulatory affairs certificate");
  await editor.getByLabel("Benefits").fill("Hybrid working\nProfessional membership fees");
  await expect(editor.getByText("One item per line · 2 items", { exact: false }).first()).toBeVisible();
  await reviewShot(page, "admin-job-editor");
  await editor.getByRole("button", { name: "Save as draft" }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByText(`“${title}” was saved as a draft.`)).toBeVisible();

  await jobs.search.fill(id);
  const row = jobs.row(title);
  await expect(row).toHaveCount(1);
  await expect(row.locator(".adm-badge").first()).toHaveText("Draft");
  await expect(row).toContainText("Regulatory Affairs · Colombo, Sri Lanka · Part-time · 3+ years preparing registration dossiers");
  await expect(row.getByText(slug)).toBeVisible();
  await expect(jobs.actions(title).getByRole("button", { name: "Delete" })).toBeVisible();
  const publicDraft = await page.request.get(`/careers/${slug}`);
  expect(publicDraft.status()).toBe(404);

  await jobs.actions(title).getByRole("button", { name: "Publish" }).click();
  await confirmDialog(page, "Publish this job?", "Publish");
  await expect(page.getByText("Job published. It is now visible on the careers site.")).toBeVisible();
  await expect(row.locator(".adm-badge").first()).toHaveText("Published");
  await expect(row.getByRole("link", { name: /View live/ })).toHaveAttribute("href", `/careers/${slug}`);
  await expect(jobs.actions(title).getByRole("button", { name: "Delete" })).toHaveCount(0);
  await adminWorkspaceShot(page, "admin-jobs-tab");

  const publicPage = await context.newPage();
  await publicPage.goto(`/careers/${slug}`);
  await expect(publicPage.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(publicPage.getByText("Regulatory affairs certificate")).toBeVisible();
  await expect(publicPage.getByText("Professional membership fees")).toBeVisible();
  await expect(publicPage.getByRole("complementary", { name: "Position summary" })).toContainText("3+ years preparing registration dossiers");
  await publicPage.goto(`/careers?q=${id}`);
  await expect(publicPage.locator("#open-positions").getByRole("heading", { name: title })).toBeVisible();

  const editedTitle = `Senior ${title}`;
  await jobs.actions(title).getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: `Edit “${title}”` });
  await expect(edit.getByText("This job is live on the careers site.")).toBeVisible();
  await expect(edit.getByLabel("Job ID")).toHaveAttribute("readonly", "");
  await expect(edit.getByLabel("Application deadline")).toHaveValue(deadline);
  await edit.getByLabel("Job title").fill(editedTitle);
  await edit.getByLabel("Benefits").fill("Hybrid working\nProfessional membership fees\nAnnual bonus");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByText(`Changes to “${editedTitle}” were saved.`)).toBeVisible();
  await publicPage.goto(`/careers/${slug}`);
  await expect(publicPage.getByRole("heading", { level: 1, name: editedTitle })).toBeVisible();
  await expect(publicPage.getByText("Annual bonus")).toBeVisible();

  const editedRow = jobs.row(editedTitle);
  await jobs.actions(editedTitle).getByRole("button", { name: "Close" }).click();
  await confirmDialog(page, "Close applications?", "Close job");
  await expect(editedRow.locator(".adm-badge").first()).toHaveText("Closed");
  const closedResponse = await publicPage.goto(`/careers/${slug}`);
  expect(closedResponse?.status()).toBe(404);
  await publicPage.goto(`/careers?q=${id}`);
  await expect(publicPage.locator("#open-positions").getByRole("heading", { name: editedTitle })).toHaveCount(0);
  await publicPage.close();

  await jobs.actions(editedTitle).getByRole("button", { name: "Archive" }).click();
  await confirmDialog(page, "Archive this job?", "Archive");
  await expect(page.getByText("Job archived.")).toBeVisible();
  await expect(editedRow).toHaveCount(0);

  await jobs.status.selectOption("archived");
  await expect(editedRow.locator(".adm-badge").first()).toHaveText("Archived");
  await expect(jobs.actions(editedTitle).getByRole("button", { name: "Edit" })).toHaveCount(0);
  await jobs.actions(editedTitle).getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("Job restored to drafts.")).toBeVisible();
  await expect(editedRow).toHaveCount(0);
  await jobs.status.selectOption("draft");
  await expect(editedRow.locator(".adm-badge").first()).toHaveText("Draft");

  await jobs.actions(editedTitle).getByRole("button", { name: "Delete" }).click();
  await confirmDialog(page, "Delete this job permanently?", "Delete job");
  await expect(page.getByText("Job deleted.")).toBeVisible();
  await jobs.status.selectOption("all");
  await expect(editedRow).toHaveCount(0);
  const gone = await page.request.get(`/api/admin/jobs/${slug}`);
  expect(gone.status()).toBe(404);
});

test("jobs with applications cannot be deleted, only archived", async ({ page, context, adminCookie }) => {
  const seed = jobSeed({ title: `Warehouse Supervisor ${token()}` });
  const job = await createJob(adminCookie, seed);
  cleanup.push(job.id);
  await submitApplication(job.id, newCandidate("DeleteRule"));
  await signInAsAdmin(context);
  await page.goto("/careers/admin");
  const jobs = jobsPanel(page);
  await jobs.search.fill(seed.title);
  const row = jobs.row(seed.title);
  await expect(row.getByRole("button", { name: `View 1 application for ${seed.title}` })).toBeVisible();

  await jobs.actions(seed.title).getByRole("button", { name: "Archive" }).click();
  await confirmDialog(page, "Archive this job?", "Archive");
  await jobs.status.selectOption("archived");
  await expect(row.locator(".adm-badge").first()).toHaveText("Archived");
  await expect(jobs.actions(seed.title).getByRole("button", { name: "Restore" })).toBeVisible();
  await expect(jobs.actions(seed.title).getByRole("button", { name: "Delete" })).toHaveCount(0);

  // The server enforces the same rule for anyone calling the API directly.
  const response = await page.request.delete(`/api/admin/jobs/${job.id}`, { headers: { origin: e2eEnv.baseUrl } });
  expect(response.status()).toBe(409);
  expect(((await response.json()) as { code: string }).code).toBe("job_has_applications");
});

test("closing the job editor with unsaved changes asks for confirmation", async ({ page, context }) => {
  await signInAsAdmin(context);
  await page.goto("/careers/admin");
  await page.getByRole("tabpanel").getByRole("button", { name: "Add job" }).click();
  const editor = page.getByRole("dialog", { name: "Add a job posting" });
  await editor.getByLabel("Job title").fill("Unsaved role");

  await page.keyboard.press("Escape");
  const discard = page.getByRole("alertdialog", { name: "Discard unsaved changes?" });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "Keep editing" }).click();
  await expect(discard).toBeHidden();
  await expect(editor.getByLabel("Job title")).toHaveValue("Unsaved role");

  await editor.getByRole("button", { name: "Cancel" }).click();
  await discard.getByRole("button", { name: "Discard changes" }).click();
  await expect(editor).toBeHidden();

  // A past deadline blocks publishing in the editor itself.
  await page.getByRole("tabpanel").getByRole("button", { name: "Add job" }).click();
  await editor.getByLabel("Application deadline").fill(colomboDate(-2));
  await expect(editor.getByText(/This date has already passed/)).toBeVisible();
  await editor.getByRole("button", { name: "Publish" }).click();
  await expect(editor.getByText("The application deadline has passed. Choose a future date or clear the deadline.")).toBeVisible();
});
