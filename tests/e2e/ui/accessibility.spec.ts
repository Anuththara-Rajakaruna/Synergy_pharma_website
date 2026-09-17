import { createJob, jobSeed, newCandidate, retireJob, submitApplication, token, type AdminJobDto, type Candidate } from "./helpers/data";
import { openAdminTab, recordRow } from "./helpers/admin";
import { expect, pdfUpload, signInAsAdmin, test } from "./helpers/fixtures";
import { applicationForm, talentForm } from "./helpers/public-forms";
import type { Locator, Page } from "@playwright/test";

// Accessibility smoke checks: every form control has an accessible name, and dialogs keep
// keyboard focus inside, close with Escape and hand focus back to the control that opened them.

let job: AdminJobDto;
let draft: AdminJobDto;
let candidate: Candidate;

test.beforeAll(async ({ adminCookie }) => {
  job = await createJob(adminCookie, jobSeed({ title: `Accessible Role ${token()}` }));
  draft = await createJob(adminCookie, jobSeed({ title: `Accessible Draft ${token()}` }), "draft");
  candidate = newCandidate("A11y");
  await submitApplication(job.id, candidate);
});

test.afterAll(async ({ adminCookie }) => {
  if (job) await retireJob(adminCookie, job.id);
  if (draft) await retireJob(adminCookie, draft.id);
});

// Lists the controls in `scope` without an accessible name (label, aria-label or aria-labelledby).
async function expectLabelledControls(scope: Locator, what: string): Promise<void> {
  await expect(scope).toBeVisible();
  const problems = await scope.evaluate((root) => {
    const text = (element: Element | null) => (element?.textContent ?? "").replace(/\s+/g, " ").trim();
    const unnamed: string[] = [];
    let checked = 0;
    for (const control of Array.from(root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea"))) {
      if ((control instanceof HTMLInputElement && control.type === "hidden") || control.hidden || control.closest("[aria-hidden='true']")) continue;
      checked += 1;
      const fromLabels = Array.from(control.labels ?? []).map((label) => text(label)).join(" ");
      const fromAria = control.getAttribute("aria-label") ?? "";
      const fromLabelledBy = (control.getAttribute("aria-labelledby") ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => text(document.getElementById(id)))
        .join(" ");
      if (!`${fromLabels}${fromAria}${fromLabelledBy}`.trim()) {
        unnamed.push(`${control.tagName.toLowerCase()}[name=${control.getAttribute("name") ?? ""}][id=${control.id}]`);
      }
    }
    return { unnamed, checked };
  });
  expect(problems.checked, `${what}: form controls found`).toBeGreaterThan(0);
  expect(problems.unnamed, `${what}: controls without an accessible name`).toEqual([]);
}

async function focusIsInside(dialog: Locator): Promise<boolean> {
  return dialog.evaluate((element) => element.contains(document.activeElement));
}

// Tabs through the dialog (forwards and backwards) and checks focus never leaves it.
async function expectFocusTrapped(page: Page, dialog: Locator, presses = 10): Promise<void> {
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let index = 0; index < presses; index += 1) {
      await page.keyboard.press(key);
      expect(await focusIsInside(dialog), `focus stays in the dialog after ${index + 1} x ${key}`).toBe(true);
    }
  }
}

test("public form controls all have accessible names", async ({ page }) => {
  await page.goto(`/careers/${job.id}`);
  const form = applicationForm(page);
  await expectLabelledControls(form.section, "application step 1");
  await form.name.fill(candidate.name);
  await form.email.fill(`ui.a11y.${token()}@example.com`);
  await form.phone.fill(candidate.phone);
  await form.continueButton.click();
  await expectLabelledControls(form.section, "application step 2");
  await form.cvInput.setInputFiles(pdfUpload("a11y.pdf"));
  await form.continueButton.click();
  await expectLabelledControls(form.section, "application step 3");

  await page.goto("/careers");
  await expectLabelledControls(page.getByRole("search", { name: "Filter open positions" }), "careers filters");
  await expectLabelledControls(talentForm(page).section.locator("form"), "talent pool form");

  await page.goto("/contact");
  await expectLabelledControls(page.locator("form.contact-form"), "contact form");

  await page.goto("/careers/admin/login");
  await expectLabelledControls(page.locator("form"), "admin sign-in form");
});

test("admin forms, filters and dialogs label every control", async ({ page, context }) => {
  await signInAsAdmin(context);
  const jobs = await openAdminTab(page, "jobs");
  await expectLabelledControls(jobs.getByRole("search"), "job filters");
  await jobs.getByRole("button", { name: "Add job" }).click();
  await expectLabelledControls(page.getByRole("dialog", { name: "Add a job posting" }), "job editor");
  await page.keyboard.press("Escape");

  const applications = await openAdminTab(page, "applications");
  await expectLabelledControls(applications.getByRole("search"), "application filters");
  await applications.getByRole("searchbox", { name: "Search" }).fill(candidate.email);
  await recordRow(applications, candidate.email).getByRole("button", { name: /View/ }).click();
  const drawer = page.getByRole("dialog", { name: candidate.name });
  await expect(drawer.getByLabel("New status")).toBeVisible();
  await expectLabelledControls(drawer, "application drawer");
  await page.keyboard.press("Escape");

  const talent = await openAdminTab(page, "talent");
  await expectLabelledControls(talent.getByRole("search"), "talent filters");
  await talent.getByRole("button", { name: "Add candidate" }).click();
  await expectLabelledControls(page.getByRole("dialog", { name: "Add a candidate" }), "add candidate dialog");
  await page.keyboard.press("Escape");

  const users = await openAdminTab(page, "users");
  await users.getByRole("button", { name: "Add user" }).click();
  await expectLabelledControls(page.getByRole("dialog", { name: "Add user" }), "add user dialog");
  await page.keyboard.press("Escape");

  const audit = await openAdminTab(page, "audit");
  await expectLabelledControls(audit, "activity log and data export");
});

test("modal dialogs trap focus, close with Escape and restore focus", async ({ page, context }) => {
  await signInAsAdmin(context);
  const jobs = await openAdminTab(page, "jobs");
  const addJob = jobs.getByRole("button", { name: "Add job" });
  await addJob.click();
  const editor = page.getByRole("dialog", { name: "Add a job posting" });
  await expect(editor).toHaveAttribute("aria-modal", "true");
  await expect(editor.getByLabel("Job title")).toBeFocused();
  await expectFocusTrapped(page, editor);
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
  await expect(addJob).toBeFocused();

  // Confirmation dialogs behave the same way.
  await jobs.getByRole("searchbox", { name: "Search" }).fill(draft.id);
  // Wait for the filtered list so the row is not re-rendered while the dialog is open.
  await expect(jobs.locator(".adm-results")).toHaveText(/^1 job /);
  const publish = jobs.getByRole("group", { name: `Actions for ${draft.title}` }).getByRole("button", { name: "Publish" });
  await publish.click();
  const confirm = page.getByRole("alertdialog", { name: "Publish this job?" });
  await expect(confirm.getByRole("button", { name: "Publish" })).toBeFocused();
  await expectFocusTrapped(page, confirm, 4);
  await page.keyboard.press("Escape");
  await expect(confirm).toBeHidden();
  await expect(publish).toBeFocused();
  await expect(jobs.getByRole("heading", { name: draft.title }).locator("xpath=..")).toContainText("Draft");
});

test("the detail drawer traps focus, closes with Escape and restores focus", async ({ page, context }) => {
  await signInAsAdmin(context);
  const applications = await openAdminTab(page, "applications");
  await applications.getByRole("searchbox", { name: "Search" }).fill(candidate.email);
  await expect(applications.locator(".adm-results")).toHaveText(/^1 application /);
  const view = recordRow(applications, candidate.email).getByRole("button", { name: /View/ });
  await view.click();
  const drawer = page.getByRole("dialog", { name: candidate.name });
  await expect(drawer.getByLabel("New status")).toBeVisible();
  await expectFocusTrapped(page, drawer, 14);

  // Escape inside a nested dialog closes only that dialog.
  await drawer.getByRole("button", { name: "Archive" }).click();
  const archive = page.getByRole("dialog", { name: "Archive this application?" });
  await expect(archive).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(archive).toBeHidden();
  await expect(drawer).toBeVisible();
  expect(await focusIsInside(drawer)).toBe(true);

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(view).toBeFocused();
});
