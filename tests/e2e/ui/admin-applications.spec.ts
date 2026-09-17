import {
  archiveApplication,
  changeApplicationStatus,
  colomboDate,
  createJob,
  findApplication,
  inBatches,
  jobSeed,
  newCandidate,
  retireJob,
  submitApplication,
  token,
  type AdminJobDto,
  type Candidate,
} from "./helpers/data";
import { adminWorkspaceShot, confirmDialog, drawerSection, openAdminTab, recordRow, toast } from "./helpers/admin";
import { decodeQuotedPrintable, expect, reviewShot, signInAsAdmin, test, waitForEmail } from "./helpers/fixtures";
import type { Locator, Page } from "@playwright/test";

const APPLICANTS = 26;
let job: AdminJobDto;
let candidates: Candidate[] = [];
let shortlisted: Candidate;
let archived: Candidate;

test.beforeAll(async ({ adminCookie }) => {
  test.setTimeout(120_000);
  job = await createJob(adminCookie, jobSeed({ title: `Stability Analyst ${token()}` }));
  candidates = Array.from({ length: APPLICANTS }, () => newCandidate("List"));
  await inBatches(APPLICANTS, 6, (index) => submitApplication(job.id, candidates[index]));
  shortlisted = candidates[3];
  archived = candidates[7];
  await changeApplicationStatus(adminCookie, (await findApplication(adminCookie, shortlisted.email)).id, "submitted", "shortlisted");
  await archiveApplication(adminCookie, (await findApplication(adminCookie, archived.email)).id);
});

test.afterAll(async ({ adminCookie }) => {
  if (job) await retireJob(adminCookie, job.id);
});

function filters(panel: Locator) {
  return {
    search: panel.getByRole("searchbox", { name: "Search" }),
    status: panel.getByLabel("Status"),
    job: panel.getByLabel("Job"),
    from: panel.getByLabel("Submitted from"),
    to: panel.getByLabel("Submitted to"),
    archived: panel.getByLabel("Archived"),
    results: panel.locator(".adm-results"),
    pagination: panel.getByRole("navigation", { name: "Pagination" }),
  };
}

async function openApplication(page: Page, panel: Locator, candidate: Candidate): Promise<Locator> {
  await filters(panel).search.fill(candidate.email);
  const row = recordRow(panel, candidate.email);
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: /View/ }).click();
  const drawer = page.getByRole("dialog", { name: candidate.name });
  await expect(drawer).toBeVisible();
  return drawer;
}

test("applications can be filtered by job, search, status, date and archive state, and paginated", async ({ page, context }) => {
  await signInAsAdmin(context);
  const panel = await openAdminTab(page, "applications");
  const f = filters(panel);

  await f.job.selectOption(job.id);
  await expect(f.results).toHaveText(`${APPLICANTS - 1} applications match your filters`);
  await expect(panel.locator("tbody tr")).toHaveCount(APPLICANTS - 1);
  await expect(f.pagination).toContainText(`${APPLICANTS - 1} applications`);
  await expect(f.pagination.getByRole("button", { name: "Next" })).toHaveCount(0);
  const exportHref = await panel.getByRole("link", { name: "Export CSV" }).getAttribute("href");
  expect(exportHref).toBe(`/api/admin/applications/export?job=${job.id}`);
  const csv = await page.request.get(exportHref ?? "");
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const csvLines = (await csv.text()).trim().split("\r\n");
  expect(csvLines[0]).toContain("Reference");
  expect(csvLines).toHaveLength(APPLICANTS);
  await adminWorkspaceShot(page, "admin-applications-tab");

  await f.archived.selectOption("include");
  await expect(f.results).toHaveText(`${APPLICANTS} applications match your filters`);
  await expect(f.pagination).toContainText(`${APPLICANTS} applications · Page 1 of 2`);
  await expect(panel.locator("tbody tr")).toHaveCount(25);
  await f.pagination.getByRole("button", { name: "Next" }).click();
  await expect(f.pagination).toContainText("Page 2 of 2");
  await expect(panel.locator("tbody tr")).toHaveCount(1);
  await f.pagination.getByRole("button", { name: "Previous" }).click();
  await expect(panel.locator("tbody tr")).toHaveCount(25);

  await f.archived.selectOption("only");
  await expect(panel.locator("tbody tr")).toHaveCount(1);
  await expect(recordRow(panel, archived.email).getByText("Archived", { exact: true })).toBeVisible();
  await f.archived.selectOption("exclude");

  await f.status.selectOption("shortlisted");
  await expect(panel.locator("tbody tr")).toHaveCount(1);
  await expect(recordRow(panel, shortlisted.email)).toContainText("Shortlisted");
  await f.status.selectOption("");

  await f.search.fill(candidates[11].email);
  await expect(panel.locator("tbody tr")).toHaveCount(1);
  await expect(recordRow(panel, candidates[11].email)).toContainText(candidates[11].name);
  await f.search.fill("");

  await f.from.fill(colomboDate(1));
  await expect(panel.getByText("No applications match your filters.")).toBeVisible();
  await f.from.fill(colomboDate(0));
  await f.to.fill(colomboDate(0));
  await expect(panel.locator("tbody tr")).toHaveCount(APPLICANTS - 1);
  await f.to.fill(colomboDate(-1));
  await expect(panel.getByText("The end date must be on or after the start date.")).toBeVisible();

  await panel.getByRole("button", { name: "Clear filters" }).click();
  await expect(f.job).toHaveValue("");
  await expect(f.from).toHaveValue("");

  // The applicant count on a job row opens this list filtered by that job.
  await page.getByRole("tab", { name: /Job Postings/ }).click();
  const jobsPanel = page.getByRole("tabpanel");
  await jobsPanel.getByRole("searchbox", { name: "Search" }).fill(job.id);
  await jobsPanel.getByRole("button", { name: `View ${APPLICANTS} applications for ${job.title}` }).click();
  await expect(page.getByRole("tab", { name: /Applications/ })).toHaveAttribute("aria-selected", "true");
  await expect(filters(page.getByRole("tabpanel")).job).toHaveValue(job.id);
  await expect(filters(page.getByRole("tabpanel")).results).toHaveText(`${APPLICANTS - 1} applications match your filters`);
});

test("the application drawer shows documents and supports status changes, notes, talent pool and archiving", async ({ page, context }) => {
  test.slow();
  const candidate = newCandidate("Drawer");
  const { reference } = await submitApplication(job.id, candidate, { coverLetter: "I led stability studies for\nthree product launches.", supporting: 1 });
  await signInAsAdmin(context);
  const panel = await openAdminTab(page, "applications");
  const drawer = await openApplication(page, panel, candidate);
  await expect(page).toHaveURL(/application=[a-f0-9]{24}/);

  await expect(drawer.getByText(reference)).toBeVisible();
  const candidateSection = drawerSection(drawer, "Candidate");
  await expect(candidateSection.getByRole("link", { name: candidate.email })).toHaveAttribute("href", /^mailto:/);
  await expect(candidateSection).toContainText(job.title);
  await expect(drawerSection(drawer, "Cover letter")).toContainText("I led stability studies for\nthree product launches.");
  const documents = drawerSection(drawer, "Documents (2)");
  const downloads = documents.getByRole("link", { name: /^Download / });
  await expect(downloads).toHaveCount(2);
  await reviewShot(page, "admin-application-drawer");

  // Download links redirect to a short-lived storage URL that serves the PDF.
  const href = (await downloads.first().getAttribute("href")) ?? "";
  expect(href).toMatch(/^\/api\/admin\/documents\/[a-f0-9]{24}$/);
  const redirect = await page.request.get(href, { maxRedirects: 0 });
  expect(redirect.status()).toBe(302);
  const location = redirect.headers()["location"] ?? "";
  const stored = await page.request.get(location);
  expect(stored.status()).toBe(200);
  expect(stored.headers()["content-type"]).toBe("application/pdf");
  expect((await stored.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  const downloadPromise = page.waitForEvent("download");
  await downloads.first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  await download.delete();

  const status = drawerSection(drawer, "Status");
  await status.getByLabel("New status").selectOption("interview");
  await status.getByLabel("Internal note").fill("Panel interview booked for Monday.");
  await status.getByRole("checkbox", { name: "Email the candidate about this update" }).check();
  await status.getByLabel("Message to the candidate").fill("Please bring your original certificates.");
  await status.getByRole("button", { name: "Update status" }).click();
  await expect(toast(page, "Status changed to Interview. The candidate will be emailed.")).toBeVisible();
  await expect(drawer.locator(".adm-drawer-subtitle")).toContainText("Interview");

  const history = drawerSection(drawer, "Status history").getByRole("listitem");
  await expect(history).toHaveCount(2);
  await expect(history.first()).toContainText("Submitted → changed to Interview");
  await expect(history.first()).toContainText("Panel interview booked for Monday.");
  await expect(history.first()).toContainText("Candidate emailed");
  await expect(history.last()).toContainText("Application received as Submitted");

  const mail = await waitForEmail({ to: candidate.email, subject: `Interview invitation: ${job.title} (${reference})` });
  expect(decodeQuotedPrintable(mail.raw)).toContain("Please bring your original certificates.");

  const notes = drawerSection(drawer, /^HR notes/);
  await notes.getByLabel("Add a note").fill("Strong analytical background.");
  await notes.getByRole("button", { name: "Add note" }).click();
  await expect(toast(page, "Note added.")).toBeVisible();
  await expect(drawerSection(drawer, "HR notes (1)").locator(".adm-note")).toContainText("Strong analytical background.");

  await drawer.getByRole("button", { name: "Move to talent pool" }).click();
  const move = page.getByRole("dialog", { name: "Move to talent pool" });
  const tags = move.getByLabel("Tags", { exact: true });
  await tags.fill("stability");
  await tags.press("Enter");
  await tags.fill("hplc");
  await tags.press("Enter");
  await expect(move.getByRole("list", { name: "Selected tags" }).getByRole("listitem")).toHaveText(["stability", "hplc"]);
  await move.getByLabel("Note for the talent profile").fill("Consider for future QC roles.");
  await move.getByRole("button", { name: "Add to talent pool" }).click();
  await expect(move.getByText("A new talent profile was created")).toBeVisible();
  await move.getByRole("button", { name: "Done" }).click();
  await expect(drawer.locator(".adm-drawer-subtitle")).toContainText("In talent pool");
  await expect(candidateSection.getByRole("link", { name: "Open talent profile" })).toBeVisible();

  await drawer.getByRole("button", { name: "Archive" }).click();
  const archive = page.getByRole("dialog", { name: "Archive this application?" });
  await archive.getByLabel("Reason").fill("Position filled internally.");
  await archive.getByRole("button", { name: "Archive" }).click();
  await expect(toast(page, `Application ${reference} was archived.`)).toBeVisible();
  await expect(drawer.getByText("Reason: Position filled internally.")).toBeVisible();
  await expect(status.getByText("Restore this application to change its status.")).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Delete permanently" })).toBeVisible();
  await reviewShot(page, "admin-application-drawer-archived");

  await drawer.getByRole("button", { name: "Restore" }).click();
  await confirmDialog(page, "Restore this application?", "Restore");
  await expect(toast(page, `Application ${reference} was restored.`)).toBeVisible();
  await expect(status.getByLabel("New status")).toBeVisible();
  await expect(drawerSection(drawer, "Emails").getByRole("listitem")).not.toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(page).not.toHaveURL(/application=/);
  await expect(recordRow(panel, candidate.email)).toContainText("Interview");
});
