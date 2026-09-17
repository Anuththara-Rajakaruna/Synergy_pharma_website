import { createHrTalent, createJob, jobSeed, newCandidate, retireJob, submitTalentProfile, token, type AdminJobDto } from "./helpers/data";
import { adminWorkspaceShot, drawerSection, openAdminTab, recordRow, toast } from "./helpers/admin";
import { expect, pdfUpload, reviewShot, signInAsAdmin, test } from "./helpers/fixtures";
import type { Locator, Page } from "@playwright/test";

let job: AdminJobDto;

test.beforeAll(async ({ adminCookie }) => {
  job = await createJob(adminCookie, jobSeed({ title: `QC Chemist ${token()}`, department: "Quality Control" }));
});

test.afterAll(async ({ adminCookie }) => {
  if (job) await retireJob(adminCookie, job.id);
});

async function chooseFiles(page: Page, button: Locator, files: ReturnType<typeof pdfUpload>[]): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await button.click();
  await (await chooser).setFiles(files);
}

test("HR adds a candidate with documents, edits tags and notes, considers them for a job and archives the profile", async ({ page, context }) => {
  test.slow();
  const candidate = newCandidate("AddTalent");
  await signInAsAdmin(context);
  const panel = await openAdminTab(page, "talent");

  await panel.getByRole("button", { name: "Add candidate" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a candidate" });
  await expect(dialog.getByLabel("Full name")).toBeFocused();
  await dialog.getByRole("button", { name: "Add candidate" }).click();
  await expect(dialog.locator(".adm-form-error")).toHaveText("Please fix the highlighted fields.");
  await expect(dialog.getByLabel("Full name")).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByLabel("Email address")).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByText("Confirm that the candidate agreed to be kept on file.")).toBeVisible();

  await dialog.getByLabel("Full name").fill(candidate.name);
  await dialog.getByLabel("Email address").fill(candidate.email);
  await dialog.getByLabel("Phone number").fill(candidate.phone);
  await dialog.getByLabel("Area of interest").fill("Quality Control");
  const tags = dialog.getByLabel("Tags", { exact: true });
  await tags.fill("hplc");
  await tags.press("Enter");
  await tags.fill("GMP");
  await tags.press("Enter");
  await expect(dialog.getByRole("list", { name: "Selected tags" }).getByRole("listitem")).toHaveText(["hplc", "gmp"]);
  await chooseFiles(page, dialog.getByRole("button", { name: /Choose CV/ }), [pdfUpload("Referral CV.pdf", 12_000)]);
  await chooseFiles(page, dialog.getByRole("button", { name: /Add documents/ }), [pdfUpload("Degree certificate.pdf", 5_000)]);
  await expect(dialog.getByRole("list", { name: "Selected CV" })).toContainText("Referral CV.pdf");
  await expect(dialog.getByRole("list", { name: "Selected supporting documents" })).toContainText("Degree certificate.pdf");
  await dialog.getByLabel("HR note").fill("Referred by the QC manager.");
  await dialog.getByRole("checkbox", { name: /The candidate agreed/ }).check();
  await reviewShot(page, "admin-talent-add-dialog");
  await dialog.getByRole("button", { name: "Add candidate" }).click();

  await expect(toast(page, `${candidate.name} was added to the talent pool.`)).toBeVisible({ timeout: 30_000 });
  const drawer = page.getByRole("dialog", { name: candidate.name });
  await expect(drawer).toBeVisible();
  await expect(drawer.locator(".adm-drawer-subtitle")).toContainText("Added by HR");
  await expect(drawerSection(drawer, "Profile")).toContainText(candidate.email);
  const documents = drawerSection(drawer, "Documents (2)");
  await expect(documents.getByRole("link", { name: /Download/ })).toHaveCount(2);
  const cvHref = (await documents.getByRole("link", { name: /Referral CV\.pdf/ }).getAttribute("href")) ?? "";
  expect((await page.request.get(cvHref, { maxRedirects: 0 })).status()).toBe(302);
  await expect(drawerSection(drawer, "HR notes (1)")).toContainText("Referred by the QC manager.");

  const tagsSection = drawerSection(drawer, "Tags");
  const profileTags = tagsSection.getByLabel("Profile tags", { exact: true });
  await profileTags.fill("stability");
  await profileTags.press("Enter");
  await tagsSection.getByRole("button", { name: "Save tags" }).click();
  await expect(toast(page, "Tags saved.")).toBeVisible();
  await expect(tagsSection.getByRole("button", { name: "Save tags" })).toHaveCount(0);
  await expect(tagsSection.getByRole("listitem")).toHaveText(["hplc", "gmp", "stability"]);

  const notes = drawerSection(drawer, /^HR notes/);
  await notes.getByLabel("Add a note").fill("Available from next month.");
  await notes.getByRole("button", { name: "Add note" }).click();
  await expect(toast(page, "Note added.")).toBeVisible();
  await expect(drawerSection(drawer, "HR notes (2)")).toContainText("Available from next month.");
  await reviewShot(page, "admin-talent-drawer");

  await drawer.getByRole("button", { name: "Consider for a job" }).click();
  const consider = page.getByRole("dialog", { name: "Consider for a job" });
  await consider.getByLabel("Job").selectOption(job.id);
  await consider.getByLabel("Note for the application").fill("Strong HPLC skills for this role.");
  await consider.getByRole("button", { name: "Create application" }).click();
  await expect(toast(page, `Application created for ${job.title}.`)).toBeVisible();
  const applications = drawerSection(drawer, "Applications (1)");
  await expect(applications).toContainText(job.title);

  await applications.getByRole("button", { name: `Open application for ${job.title}` }).click();
  await expect(page.getByRole("tab", { name: /Applications/ })).toHaveAttribute("aria-selected", "true");
  const application = page.getByRole("dialog", { name: candidate.name });
  await expect(drawerSection(application, "Candidate")).toContainText("Added from the talent pool");
  await expect(drawerSection(application, "HR notes (1)")).toContainText("Strong HPLC skills for this role.");
  await expect(drawerSection(application, "Documents (2)")).toBeVisible();
  await page.keyboard.press("Escape");

  const talent = await openAdminTab(page, "talent");
  await talent.getByRole("searchbox", { name: "Search" }).fill(candidate.email);
  await recordRow(talent, candidate.email).getByRole("button", { name: `View profile of ${candidate.name}` }).click();
  const profile = page.getByRole("dialog", { name: candidate.name });
  await profile.getByRole("button", { name: "Archive" }).click();
  const archive = page.getByRole("dialog", { name: "Archive this profile?" });
  await archive.getByLabel("Reason").fill("Accepted an offer elsewhere.");
  await archive.getByRole("button", { name: "Archive profile" }).click();
  await expect(toast(page, "Profile archived.")).toBeVisible();
  await expect(profile.getByRole("button", { name: "Restore profile" })).toBeVisible();
  await expect(profile.getByRole("button", { name: "Delete permanently" })).toBeVisible();
  await expect(profile.getByRole("button", { name: "Consider for a job" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await expect(recordRow(talent, candidate.email)).toHaveCount(0);
  await talent.getByLabel("Profile status").selectOption("only");
  await expect(recordRow(talent, candidate.email).getByText("Archived", { exact: true })).toBeVisible();
});

test("the talent pool list filters by search, tag, source and area", async ({ page, context, adminCookie }) => {
  const selfSubmitted = newCandidate("TalentFilter");
  await submitTalentProfile(selfSubmitted, "Microbiology");
  const tagged = newCandidate("TalentTag");
  const uniqueTag = `lims-${token()}`;
  await createHrTalent(adminCookie, tagged, [uniqueTag, "sterile"]);
  await signInAsAdmin(context);
  const panel = await openAdminTab(page, "talent");
  await adminWorkspaceShot(page, "admin-talent-tab");

  await panel.getByRole("searchbox", { name: "Search" }).fill(selfSubmitted.email);
  const row = recordRow(panel, selfSubmitted.email);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Website submission");
  await expect(row).toContainText("Microbiology");

  await panel.getByLabel("Source").selectOption("hr_added");
  await expect(panel.getByText("No candidates match your filters.")).toBeVisible();
  await panel.getByLabel("Source").selectOption("self_submitted");
  await expect(row).toHaveCount(1);
  await panel.getByLabel("Area of interest", { exact: true }).selectOption("Warehouse");
  await expect(row).toHaveCount(0);

  await panel.getByRole("search", { name: "Filter the talent pool" }).getByRole("button", { name: "Clear filters" }).click();
  await panel.getByLabel("Tag", { exact: true }).selectOption(uniqueTag);
  await expect(panel.locator("tbody tr")).toHaveCount(1);
  await expect(recordRow(panel, tagged.email)).toContainText(uniqueTag);
  await expect(recordRow(panel, tagged.email)).toContainText("Added by HR");

  await panel.getByRole("search", { name: "Filter the talent pool" }).getByRole("button", { name: "Clear filters" }).click();
  await expect(panel.getByRole("searchbox", { name: "Search" })).toHaveValue("");
  await expect(panel.getByLabel("Source")).toHaveValue("");
});
