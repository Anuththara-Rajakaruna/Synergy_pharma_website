import { expect, expectRevealSectionsVisible, reviewShot, test } from "./helpers/fixtures";

// Every public page renders its content, reveals its animated sections and runs without console
// errors or Content-Security-Policy violations (scripts must carry the per-request nonce).

const PAGES = [
  { path: "/", name: "home", heading: /Driven by Collaboration/i },
  { path: "/about", name: "about", heading: /Trust Built/i },
  { path: "/facility", name: "facility", heading: /Reliable manufacturing/i },
  { path: "/quality", name: "quality", heading: /Quality Without Compromise/i },
  { path: "/products", name: "products", heading: /Driven by Quality/i },
  { path: "/contact", name: "contact", heading: /Contact Us/i },
  { path: "/privacy-policy", name: "privacy-policy", heading: /Privacy Policy/i },
  { path: "/careers", name: "careers", heading: /Join us in advancing pharmaceutical excellence/i },
] as const;

for (const entry of PAGES) {
  test(`${entry.path} renders visible content without console errors or CSP violations`, async ({ page, browserProblems }) => {
    const response = await page.goto(entry.path);
    expect(response?.status()).toBe(200);
    expect(response?.headers()["content-security-policy"]).toContain("nonce-");

    await expect(page.getByRole("heading", { level: 1, name: entry.heading })).toBeVisible();
    await expect(page.locator("header").first()).toBeVisible();
    await expect(page.locator("main")).toBeVisible();

    // Hydration marker: the client-side reveal script runs only if the nonce allowed the bundles.
    await expectRevealSectionsVisible(page);
    const mainText = (await page.locator("main").innerText()).trim();
    expect(mainText.length).toBeGreaterThan(200);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    expect(await browserProblems.list()).toEqual([]);
  });
}

test("the careers hero links jump to open roles and the talent pool", async ({ page }) => {
  await page.goto("/careers");
  await page.getByRole("link", { name: "View Open Roles" }).click();
  await expect(page).toHaveURL(/#open-positions$/);
  await expect(page.locator("#open-positions")).toBeInViewport();
  await page.getByRole("link", { name: "Join Talent Pool" }).first().click();
  await expect(page).toHaveURL(/#talent-pool$/);
  await expect(page.locator("#talent-pool")).toBeInViewport();
});

test("unknown pages render the not-found page", async ({ page }) => {
  const response = await page.goto(`/no-such-page-${Date.now()}`);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await reviewShot(page, "not-found");
});
