import { readFile } from "node:fs/promises";
import { e2eEnv } from "../support/env";
import { colomboDate, createAccount, createJob, jobSeed, newCandidate, retireJob, submitApplication, token } from "./helpers/data";
import { adminWorkspaceShot, openAdminTab, recordRow } from "./helpers/admin";
import { expect, signInAsAdmin, test } from "./helpers/fixtures";
import type { Locator } from "@playwright/test";

function activityLog(panel: Locator) {
  const card = panel.locator("section.adm-panel").filter({ has: panel.page().getByRole("heading", { name: "Who did what, and when" }) });
  return {
    card,
    action: card.getByLabel("Action"),
    recordType: card.getByLabel("Record type"),
    from: card.getByLabel("From"),
    to: card.getByLabel("To"),
    rows: card.locator("tbody tr"),
  };
}

test("the activity log lists recent actions and filters by action, record and date", async ({ page, context, adminCookie }) => {
  const account = await createAccount(adminCookie, "hr", "Audit");
  await signInAsAdmin(context);
  const panel = await openAdminTab(page, "audit");
  const log = activityLog(panel);
  await expect(log.rows.first()).toBeVisible();
  await adminWorkspaceShot(page, "admin-activity-tab");

  await log.action.selectOption("user");
  const created = recordRow(log.card, `account for ${account.name}`);
  await expect(created).toHaveCount(1);
  await expect(created).toContainText("Created account");
  await expect(created).toContainText("user.create");
  await expect(created).toContainText(e2eEnv.adminEmail);
  const actions = await log.rows.locator("td:nth-child(3) .adm-mono").allTextContents();
  expect(actions.length).toBeGreaterThan(0);
  expect(actions.every((action) => action.startsWith("user."))).toBe(true);

  await created.getByRole("button", { name: /^History/ }).click();
  await expect(log.card.getByRole("list", { name: "Record filter" })).toContainText(`Showing history of team account ${account.id}`);
  await expect(log.rows).toHaveCount(1);
  await expect(log.recordType).toHaveValue("admin_user");
  await log.card.getByRole("button", { name: "Show all records" }).click();
  await expect(log.card.getByRole("list", { name: "Record filter" })).toHaveCount(0);

  await log.card.getByRole("button", { name: "Clear filters" }).click();
  await log.recordType.selectOption("job");
  await expect(log.rows.first()).toBeVisible();
  const jobActions = await log.rows.locator("td:nth-child(3) .adm-mono").allTextContents();
  expect(jobActions.every((action) => action.startsWith("job."))).toBe(true);

  await log.from.fill(colomboDate(0));
  await log.to.fill(colomboDate(-1));
  await expect(log.card.getByText("The end date must be on or after the start date.")).toBeVisible();
  await log.to.fill(colomboDate(0));
  await expect(log.card.getByText("The end date must be on or after the start date.")).toHaveCount(0);
  await expect(log.rows.first()).toBeVisible();
});

test("a candidate data export downloads a JSON file and is recorded", async ({ page, context, adminCookie }) => {
  const job = await createJob(adminCookie, jobSeed({ title: `Export Role ${token()}` }));
  try {
    const candidate = newCandidate("Export");
    await submitApplication(job.id, candidate);
    await signInAsAdmin(context);
    const panel = await openAdminTab(page, "audit");
    const card = panel.locator("section.adm-panel").filter({ has: panel.page().getByRole("heading", { name: "Candidate data access and portability" }) });
    const email = card.getByLabel("Candidate email address");
    const submit = card.getByRole("button", { name: "Download data (JSON)" });

    await email.fill("not-an-email");
    await submit.click();
    await expect(email).toHaveAttribute("aria-invalid", "true");

    await email.fill(`nobody.${token()}@example.com`);
    await submit.click();
    await expect(card.getByText(/No applications or talent pool profiles were found for/)).toBeVisible();

    await email.fill(candidate.email);
    const downloadPromise = page.waitForEvent("download");
    await submit.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^candidate-data-\d{4}-\d{2}-\d{2}\.json$/);
    const file = await download.path();
    const data = JSON.parse(await readFile(file, "utf8")) as { applications: { jobTitle?: string; email?: string }[] };
    expect(data.applications).toHaveLength(1);
    expect(JSON.stringify(data.applications[0])).toContain(job.title);
    await expect(card.getByText(/Downloaded candidate-data-.*1 application and 0 talent pool profiles/)).toBeVisible();

    const log = activityLog(panel);
    await log.action.selectOption("candidate");
    const exported = log.rows.filter({ hasText: "Exported candidate data (1 application, 0 talent profiles)" }).first();
    await expect(exported).toContainText(e2eEnv.adminEmail);
    await expect(exported).toContainText("candidate.export");
  } finally {
    await retireJob(adminCookie, job.id);
  }
});
