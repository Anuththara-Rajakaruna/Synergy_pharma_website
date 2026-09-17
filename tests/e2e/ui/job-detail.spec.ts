import { createJob, jobSeed, retireJob, token, type AdminJobDto, type JobSeed } from "./helpers/data";
import { expect, reviewShot, test } from "./helpers/fixtures";

const seed: JobSeed = jobSeed({
  title: `Microbiology Analyst ${token()}`,
  department: "Microbiology",
  location: "Pannala, Sri Lanka",
  type: "Contract",
  experience: "1-3 years in a microbiology laboratory",
  description: "You will run environmental monitoring programmes.\n\nYou will also support sterility testing and investigations.",
  responsibilities: ["Perform microbial limit tests", "Maintain laboratory records"],
  requirements: ["BSc in Microbiology", "Aseptic technique"],
  qualifications: ["ISO 17025 awareness training"],
  benefits: ["Transport allowance", "Annual health check"],
});
let published: AdminJobDto;
let draft: AdminJobDto;

test.beforeAll(async ({ adminCookie }) => {
  published = await createJob(adminCookie, seed, "published");
  draft = await createJob(adminCookie, jobSeed({ title: `Draft Only Role ${token()}` }), "draft");
});

test.afterAll(async ({ adminCookie }) => {
  if (published) await retireJob(adminCookie, published.id);
  if (draft) await retireJob(adminCookie, draft.id);
});

test("a published job shows its description, lists, summary facts and structured data", async ({ page, browserProblems }) => {
  const response = await page.goto(`/careers/${published.id}`);
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(new RegExp(seed.title));

  await expect(page.getByRole("heading", { level: 1, name: seed.title })).toBeVisible();
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumb.getByRole("link", { name: "Careers" })).toHaveAttribute("href", "/careers");

  const description = page.locator(".careers-detail-description p");
  await expect(description).toHaveText(["You will run environmental monitoring programmes.", "You will also support sterility testing and investigations."]);

  for (const [badge, items] of [
    ["Responsibilities", seed.responsibilities],
    ["Requirements", seed.requirements],
    ["Qualifications", seed.qualifications],
    ["Benefits", seed.benefits],
  ] as const) {
    const panel = page.locator(".career-detail-panel").filter({ has: page.getByText(badge, { exact: true }) });
    await expect(panel.getByRole("listitem")).toHaveText([...items]);
  }

  const summary = page.getByRole("complementary", { name: "Position summary" });
  await expect(summary.getByRole("heading", { name: seed.title })).toBeVisible();
  await expect(summary).toContainText(seed.department);
  await expect(summary).toContainText(seed.location);
  await expect(summary).toContainText("Contract");
  await expect(summary.locator("dt", { hasText: "Experience" }).locator("xpath=following-sibling::dd[1]")).toHaveText(seed.experience);
  await expect(summary.locator("dt", { hasText: "Apply by" }).locator("xpath=following-sibling::dd[1]")).toHaveText(/\d{1,2} \w+ \d{4}/);

  const jsonLd = await page.locator('script[type="application/ld+json"]').evaluateAll((scripts) => scripts.map((script) => script.textContent ?? ""));
  const posting = jsonLd.map((text) => JSON.parse(text) as Record<string, unknown>).find((data) => data["@type"] === "JobPosting");
  expect(posting).toMatchObject({ title: seed.title, employmentType: "CONTRACTOR", directApply: true });
  expect(String(posting?.validThrough)).toMatch(/^\d{4}-\d{2}-\d{2}T/);

  await summary.getByRole("link", { name: "Apply Now" }).click();
  await expect(page).toHaveURL(/#apply$/);
  await expect(page.getByRole("heading", { name: "Submit your application in three quick steps." })).toBeInViewport();
  await reviewShot(page, "job-detail", { fullPage: true });
  expect(await browserProblems.list()).toEqual([]);
});

test("an unknown job id returns the not-found page", async ({ page }) => {
  const response = await page.goto(`/careers/ui-e2e-missing-${token()}`);
  expect(response?.status()).toBe(404);
  await expect(page).toHaveTitle(/Job Not Found/);
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(/apply/i);
  await expect(page.locator("#apply")).toHaveCount(0);
});

test("a draft job is not public", async ({ page }) => {
  const response = await page.goto(`/careers/${draft.id}`);
  expect(response?.status()).toBe(404);
  await expect(page.getByText(draft.title)).toHaveCount(0);

  await page.goto(`/careers?q=${encodeURIComponent(draft.title)}`);
  await expect(page.locator("#open-positions").getByRole("heading", { name: draft.title })).toHaveCount(0);
});
