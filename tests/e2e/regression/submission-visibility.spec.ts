import { expect, test, type Page } from "@playwright/test";
import { api, clientIp, loginAsAdmin, pdfBytes, readMailbox, uniqueSuffix, uploadFiles } from "../support/api";
import { e2eEnv } from "../support/env";

// Regression: submissions reported success on the public site but never reached the admin portal.
// Cause 1: a hidden "website" honeypot input was filled by browser autofill, and the API answered
// with a fake success without storing anything. Cause 2: admin lists only loaded once, so records
// submitted while HR had the portal open did not appear until a manual reload.

type CreatedJob = { job: { id: string; title: string } };

async function createOpenJob(adminCookie: string, suffix: string) {
  const slug = `regression-role-${suffix}`;
  const created = await api<CreatedJob>("POST", "/api/admin/jobs", {
    cookie: adminCookie,
    json: {
      slug,
      title: `Regression Role ${suffix}`,
      department: "Quality Control",
      location: "Bingiriya, Sri Lanka",
      type: "Full-time",
      experience: "",
      description: "Role used by the submission visibility regression test.",
      responsibilities: ["Review batch records"],
      requirements: ["Degree in Chemistry"],
      qualifications: [],
      benefits: [],
      applicationDeadline: null,
      status: "published",
    },
  });
  expect(created.status, created.text).toBe(201);
  return created.body.job;
}

// Adds a per-test client IP to same-origin API calls only (the direct-to-storage PUT must keep
// the browser's own headers so the bucket's CORS rules apply unchanged).
async function routeWithDistinctClientIp(page: Page) {
  const ip = clientIp();
  await page.route("**/api/**", (route) => route.continue({ headers: { ...route.request().headers(), [e2eEnv.clientIpHeader]: ip } }));
}

async function signInToAdmin(page: Page, tab: "applications" | "talent") {
  await routeWithDistinctClientIp(page);
  await page.goto(`/careers/admin/login?from=${encodeURIComponent(`/careers/admin?tab=${tab}`)}`);
  await page.getByLabel("Email address").fill(e2eEnv.adminEmail);
  await page.getByLabel("Password", { exact: true }).fill(e2eEnv.adminPassword);
  await Promise.all([page.waitForURL(/\/careers\/admin\?tab=/), page.getByRole("button", { name: /sign in/i }).click()]);
  await expect(page.getByRole("tab", { selected: true })).toContainText(tab === "applications" ? "Applications" : "Talent Pool");
}

// Simulates HR switching back to the browser tab that has the admin portal open.
async function returnToAdminTab(page: Page) {
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

test.describe("submissions reach the admin portal", () => {
  test("API submissions that include a stray website field are stored, not silently dropped", async () => {
    const suffix = uniqueSuffix();
    const adminCookie = await loginAsAdmin();
    const job = await createOpenJob(adminCookie, suffix);
    const ip = clientIp();

    const application = await uploadFiles("application", [{ kind: "cv", name: "cv.pdf", bytes: pdfBytes() }], { ip });
    const applied = await api<{ reference: string }>("POST", "/api/apply", {
      ip,
      json: {
        jobId: job.id,
        name: "Kavindi Senanayake",
        email: `kavindi.${suffix}@example.com`,
        phone: "+94 77 555 0101",
        coverLetter: "",
        linkedIn: "",
        portfolio: "",
        consentGiven: true,
        uploads: { cv: application.ids[0], supporting: [] },
        // What an autofilled honeypot used to send.
        website: "https://example.com",
      },
    });
    expect(applied.status, applied.text).toBe(201);
    const listed = await api<{ items: { reference: string }[] }>("GET", `/api/admin/applications?q=${encodeURIComponent(applied.body.reference)}`, {
      cookie: adminCookie,
    });
    expect(listed.body.items.map((item) => item.reference)).toContain(applied.body.reference);

    const talent = await uploadFiles("talent_pool", [{ kind: "cv", name: "cv.pdf", bytes: pdfBytes() }], { ip });
    const joined = await api<{ reference: string }>("POST", "/api/talent-pool", {
      ip,
      json: {
        name: "Ishara Fernando",
        email: `ishara.${suffix}@example.com`,
        phone: "0771234567",
        areaOfInterest: "Quality Control",
        notes: "",
        consentGiven: true,
        uploads: { cv: talent.ids[0], supporting: [] },
        website: "https://example.com",
      },
    });
    expect(joined.status, joined.text).toBe(201);
    const pool = await api<{ items: { email: string }[] }>("GET", `/api/admin/talent-pool?q=${encodeURIComponent(`ishara.${suffix}`)}`, {
      cookie: adminCookie,
    });
    expect(pool.body.items.map((item) => item.email)).toContain(`ishara.${suffix}@example.com`);

    const subject = `Regression contact ${suffix}`;
    const contact = await api("POST", "/api/contact", {
      ip,
      json: { fullName: "Ruwan Silva", company: "", email: `ruwan.${suffix}@example.com`, phone: "", subject, message: "Hello", website: "https://example.com" },
    });
    expect(contact.status, contact.text).toBe(202);
    const mails = await readMailbox((mail) => mail.raw.includes(suffix));
    expect(mails.length, "contact message email was delivered").toBeGreaterThan(0);
  });

  test("an application submitted through the public form appears in an already open admin portal", async ({ browser }) => {
    const suffix = uniqueSuffix();
    const job = await createOpenJob(await loginAsAdmin(), suffix);

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await signInToAdmin(adminPage, "applications");

    const candidateContext = await browser.newContext();
    const candidatePage = await candidateContext.newPage();
    await routeWithDistinctClientIp(candidatePage);
    await candidatePage.goto(`/careers/${job.id}#apply`);

    const form = candidatePage.locator("#apply");
    await form.getByLabel("Full name").fill("Tharushi Wickramasinghe");
    await form.getByLabel("Email").fill(`tharushi.${suffix}@example.com`);
    await form.getByLabel("Phone").fill("+94 71 234 5678");
    await form.getByRole("button", { name: "Continue" }).click();
    await form.locator('input[type="file"]').first().setInputFiles({ name: "Tharushi CV.pdf", mimeType: "application/pdf", buffer: pdfBytes(20_000) });
    await form.getByRole("button", { name: "Continue" }).click();
    await form.getByLabel(/I have read/i).check();
    await form.getByRole("button", { name: "Submit Application" }).click();

    const reference = (await candidatePage.locator(".careers-success-reference strong").textContent({ timeout: 60_000 }))?.trim() ?? "";
    expect(reference).toMatch(/^APP-[0-9A-F]{8}$/);

    // No reload: the open admin list must pick the new record up on its own.
    await returnToAdminTab(adminPage);
    await expect(adminPage.getByText(reference).first()).toBeVisible({ timeout: 45_000 });

    await adminContext.close();
    await candidateContext.close();
  });

  test("a talent pool profile submitted through the public form appears in an already open admin portal", async ({ browser }) => {
    const suffix = uniqueSuffix();
    const email = `nimesha.${suffix}@example.com`;

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await signInToAdmin(adminPage, "talent");

    const candidateContext = await browser.newContext();
    const candidatePage = await candidateContext.newPage();
    await routeWithDistinctClientIp(candidatePage);
    await candidatePage.goto("/careers#talent-pool");

    const form = candidatePage.locator("#talent-pool");
    await form.getByLabel("Full name").fill("Nimesha Rathnayake");
    await form.getByLabel("Email").fill(email);
    await form.getByLabel("Phone").fill("+94 77 765 4321");
    await form.getByLabel("Area of interest").selectOption("Quality Control");
    await form.locator('input[type="file"]').first().setInputFiles({ name: "Nimesha CV.pdf", mimeType: "application/pdf", buffer: pdfBytes(20_000) });
    await form.getByLabel(/I have read/i).check();
    await form.getByRole("button", { name: /submit|join/i }).click();
    await expect(form.locator(".careers-success-reference")).toBeVisible({ timeout: 60_000 });

    await returnToAdminTab(adminPage);
    await expect(adminPage.getByText(email).first()).toBeVisible({ timeout: 45_000 });

    await adminContext.close();
    await candidateContext.close();
  });
});
