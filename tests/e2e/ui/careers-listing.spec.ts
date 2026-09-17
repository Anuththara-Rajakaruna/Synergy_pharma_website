import { colomboDate, createJob, jobSeed, retireJob, token, type AdminJobDto } from "./helpers/data";
import { expect, reviewShot, test } from "./helpers/fixtures";
import type { Page } from "@playwright/test";

// The listing filters open roles in the browser and mirrors every filter in the query string.
// Other suites add jobs to the same database, so each scenario narrows the list with a unique
// search token first and only asserts on the jobs created here.

const run = token();
const LAB = `Dept ${run} Lab`;
const PLANT = `Dept ${run} Plant`;
const KANDY = `Kandy ${run}`;
const GALLE = `Galle ${run}`;

let alpha: AdminJobDto;
let charlie: AdminJobDto;
let bravo: AdminJobDto;

test.beforeAll(async ({ adminCookie }) => {
  // Created oldest to newest: Alpha, Charlie, Bravo (the default order is newest first).
  alpha = await createJob(
    adminCookie,
    jobSeed({ title: `Alpha Formulation Chemist ${run}`, department: LAB, location: KANDY, type: "Full-time", applicationDeadline: colomboDate(20) })
  );
  charlie = await createJob(
    adminCookie,
    jobSeed({
      title: `Charlie Validation Engineer ${run}`,
      department: LAB,
      location: GALLE,
      type: "Contract",
      experience: "3+ years in validation",
      applicationDeadline: colomboDate(3),
    })
  );
  bravo = await createJob(
    adminCookie,
    jobSeed({ title: `Bravo Packaging Intern ${run}`, department: PLANT, location: GALLE, type: "Internship", experience: "", applicationDeadline: null })
  );
});

test.afterAll(async ({ adminCookie }) => {
  for (const job of [alpha, charlie, bravo]) {
    if (job) await retireJob(adminCookie, job.id);
  }
});

const listing = (page: Page) => page.locator("#open-positions");
const cardTitles = (page: Page) => listing(page).locator("h3").filter({ hasText: run });
const searchBox = (page: Page) => page.getByRole("searchbox", { name: "Search roles" });

async function expectTitles(page: Page, titles: string[]): Promise<void> {
  await expect(cardTitles(page)).toHaveText(titles);
}

function params(page: Page): URLSearchParams {
  return new URL(page.url()).searchParams;
}

test("search, department, type, location and sort filters update the results and the URL", async ({ page }) => {
  await page.goto("/careers");
  await searchBox(page).fill(run);
  await expect.poll(() => params(page).get("q")).toBe(run);
  await expectTitles(page, [bravo.title, charlie.title, alpha.title]);
  // "3 open roles" when this run's jobs happen to be the only open ones.
  await expect(listing(page).getByRole("status")).toHaveText(/^(Showing 3 of \d+ open roles|3 open roles)$/);
  await reviewShot(page, "careers-listing-search", { target: listing(page) });

  await page.getByLabel("Department").selectOption(LAB);
  await expect.poll(() => params(page).get("dept")).toBe(LAB);
  await expectTitles(page, [charlie.title, alpha.title]);

  await page.getByLabel("Job type").selectOption("Contract");
  await expect.poll(() => params(page).get("type")).toBe("Contract");
  await expectTitles(page, [charlie.title]);

  await page.getByRole("button", { name: "Clear Filters" }).click();
  await expect.poll(() => page.url()).not.toContain("?");
  await expect(searchBox(page)).toHaveValue("");
  await expect(listing(page).getByRole("status")).toHaveText(/^\d+ open roles?$/);

  await searchBox(page).fill(run);
  await page.getByLabel("Location").selectOption(GALLE);
  await expect.poll(() => params(page).get("loc")).toBe(GALLE);
  await expectTitles(page, [bravo.title, charlie.title]);

  await page.getByLabel("Location").selectOption("");
  await page.getByLabel("Sort").selectOption("az");
  await expect.poll(() => params(page).get("sort")).toBe("az");
  await expectTitles(page, [alpha.title, bravo.title, charlie.title]);

  await page.getByLabel("Sort").selectOption("closing");
  await expect.poll(() => params(page).get("sort")).toBe("closing");
  await expectTitles(page, [charlie.title, alpha.title, bravo.title]);

  await page.getByLabel("Sort").selectOption("newest");
  await expect.poll(() => params(page).has("sort")).toBe(false);
  await expectTitles(page, [bravo.title, charlie.title, alpha.title]);
});

test("filters in the URL are applied on load and unknown values are ignored", async ({ page }) => {
  const query = new URLSearchParams({ q: run, dept: PLANT, sort: "az" });
  await page.goto(`/careers?${query.toString()}`);
  await expect(searchBox(page)).toHaveValue(run);
  await expect(page.getByLabel("Department")).toHaveValue(PLANT);
  await expect(page.getByLabel("Sort")).toHaveValue("az");
  await expectTitles(page, [bravo.title]);

  const bogus = new URLSearchParams({ q: run, dept: "No Such Department", type: "Gig", loc: "Atlantis", sort: "random" });
  await page.goto(`/careers?${bogus.toString()}`);
  await expect(page.getByLabel("Department")).toHaveValue("");
  await expect(page.getByLabel("Job type")).toHaveValue("");
  await expect(page.getByLabel("Sort")).toHaveValue("newest");
  await expectTitles(page, [bravo.title, charlie.title, alpha.title]);
});

test("a search without matches shows the empty state and Clear Filters restores the list", async ({ page }) => {
  await page.goto(`/careers?q=${run}-no-such-role`);
  const empty = listing(page).getByRole("heading", { name: "No jobs found" });
  await expect(empty).toBeVisible();
  await expect(listing(page).getByRole("status")).toHaveText(/^Showing 0 of \d+ open roles?$/);
  await reviewShot(page, "careers-listing-empty", { target: listing(page) });

  await listing(page).getByRole("button", { name: "Clear Filters" }).last().click();
  await expect(empty).toBeHidden();
  await expect.poll(() => page.url()).not.toContain("q=");
  await expect(cardTitles(page)).toHaveCount(3);
});

test("job cards show department, location, type, experience, deadline and posted pills", async ({ page }) => {
  await page.goto(`/careers?q=${run}`);
  const card = (title: string) => listing(page).locator("div.group").filter({ has: page.getByRole("heading", { name: title }) });

  const urgent = card(charlie.title);
  await expect(urgent.getByText(LAB, { exact: true })).toBeVisible();
  const details = urgent.getByRole("list", { name: "Role details" });
  await expect(details.getByRole("listitem")).toHaveText([GALLE, "Contract", /Experience: 3\+ years in validation/, /Apply by \d{1,2} \w+ \d{4}/]);
  const deadlinePill = details.getByRole("listitem").filter({ hasText: "Apply by" });
  await expect(deadlinePill).toContainText("(closing soon)");
  await expect(deadlinePill).toHaveClass(/bg-\[#fff7e6\]/);
  await expect(urgent.getByText("Posted today")).toBeVisible();

  const calm = card(alpha.title).getByRole("list", { name: "Role details" }).getByRole("listitem").filter({ hasText: "Apply by" });
  await expect(calm).not.toContainText("closing soon");
  await expect(calm).not.toHaveClass(/bg-\[#fff7e6\]/);

  // No deadline and no experience: only location and type.
  await expect(card(bravo.title).getByRole("list", { name: "Role details" }).getByRole("listitem")).toHaveText([GALLE, "Internship"]);
  await reviewShot(page, "careers-listing-cards", { target: listing(page) });

  await card(charlie.title).getByRole("link", { name: `View details for ${charlie.title}` }).click();
  await expect(page).toHaveURL(new RegExp(`/careers/${charlie.id}$`));
  await expect(page.getByRole("heading", { level: 1, name: charlie.title })).toBeVisible();
});
