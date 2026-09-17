import { createAccount, createActiveAccount, token } from "./helpers/data";
import { expect, reviewShot, signInAsAdmin, signInAsHr, test } from "./helpers/fixtures";
import type { Page } from "@playwright/test";

function loginForm(page: Page) {
  return {
    email: page.getByLabel("Email address"),
    password: page.getByLabel("Password", { exact: true }),
    submit: page.getByRole("button", { name: /Sign In|Signing in/ }),
    alert: page.locator("#login-error"),
  };
}

test("the sign-in form validates input and rejects wrong credentials", async ({ page, adminCookie }) => {
  const account = await createActiveAccount(adminCookie, "hr", "WrongPassword");
  await page.goto("/careers/admin/login");
  await expect(page.getByRole("heading", { level: 1, name: "Admin Portal" })).toBeVisible();
  await reviewShot(page, "admin-login");
  const form = loginForm(page);
  await expect(form.email).toHaveAttribute("autocomplete", "username");
  await expect(form.password).toHaveAttribute("autocomplete", "current-password");

  await form.submit.click();
  await expect(page.locator("#login-email-error")).toHaveText("Enter your email address.");
  await expect(page.locator("#login-password-error")).toHaveText("Enter your password.");
  await expect(form.email).toBeFocused();

  await form.email.fill(account.email);
  await form.password.fill(`${account.password}-wrong`);
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(form.password).toHaveAttribute("type", "text");
  await form.submit.click();
  await expect(form.alert).toHaveText("Invalid email or password.");
  await expect(form.password).toHaveValue("");
  await expect(form.password).toBeFocused();
  await expect(page).toHaveURL(/\/careers\/admin\/login$/);
  await reviewShot(page, "admin-login-error");

  // Unknown accounts get exactly the same message.
  await form.email.fill(`nobody.${token()}@synergypharma.lk`);
  await form.password.fill("Some-Password-123!");
  await form.submit.click();
  await expect(form.alert).toHaveText("Invalid email or password.");
});

test("signing in returns to the admin page requested before sign-in, and signing out ends the session", async ({ page, adminCookie }) => {
  const account = await createActiveAccount(adminCookie, "hr", "Redirect");
  await page.goto("/careers/admin?tab=talent");
  await expect(page).toHaveURL(/\/careers\/admin\/login\?from=/);
  expect(new URL(page.url()).searchParams.get("from")).toBe("/careers/admin?tab=talent");

  const form = loginForm(page);
  await form.email.fill(account.email);
  await form.password.fill(account.password);
  await form.submit.click();

  await expect(page).toHaveURL(/\/careers\/admin\?tab=talent$/);
  await expect(page.getByRole("tab", { name: /Talent Pool/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".adm-user-name")).toHaveText(account.name);
  await expect(page.locator(".adm-user-role")).toHaveText("HR / Recruitment");

  // A signed-in user opening the login page goes straight to the target.
  await page.goto("/careers/admin/login?from=%2Fcareers%2Fadmin%3Ftab%3Dapplications");
  await expect(page).toHaveURL(/\/careers\/admin\?tab=applications$/);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/careers\/admin\/login$/);
  await page.goto("/careers/admin");
  await expect(page).toHaveURL(/\/careers\/admin\/login\?from=%2Fcareers%2Fadmin$/);
  const me = await page.request.get("/api/admin/me");
  expect(me.status()).toBe(401);
});

test("an external redirect target is ignored after sign-in", async ({ page, adminCookie }) => {
  const account = await createActiveAccount(adminCookie, "hr", "OpenRedirect");
  await page.goto("/careers/admin/login?from=%2F%2Fevil.example.com%2Fcareers%2Fadmin");
  const form = loginForm(page);
  await form.email.fill(account.email);
  await form.password.fill(account.password);
  await form.submit.click();
  await expect(page).toHaveURL(/\/careers\/admin$/);
});

test("a new user must replace the temporary password before using the portal", async ({ page, adminCookie }) => {
  const account = await createAccount(adminCookie, "hr", "FirstLogin");
  await page.goto("/careers/admin/login");
  const form = loginForm(page);
  await form.email.fill(account.email);
  await form.password.fill(account.temporaryPassword);
  await form.submit.click();

  const dialog = page.getByRole("dialog", { name: "Set a new password" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("heading", { name: "Change your password to continue" })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Close" })).toHaveCount(0);
  await reviewShot(page, "admin-forced-password-change");

  // Escape does not dismiss a forced change.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();

  const newPassword = `Fresh-${token()}-Passw0rd!`;
  await dialog.getByLabel("Temporary password").fill(account.temporaryPassword);
  await dialog.getByLabel("New password", { exact: true }).fill("short");
  await dialog.getByLabel("Confirm new password").fill("different");
  await dialog.getByRole("button", { name: "Change password" }).click();
  await expect(dialog.getByText("Password must be at least 12 characters.")).toBeVisible();
  await expect(dialog.getByText("The passwords don't match.")).toBeVisible();

  await dialog.getByLabel("Temporary password").fill("Not-The-Temporary-Password-1");
  await dialog.getByLabel("New password", { exact: true }).fill(newPassword);
  await dialog.getByLabel("Confirm new password").fill(newPassword);
  await expect(dialog.getByText(/^Strength: /)).toBeVisible();
  await dialog.getByRole("button", { name: "Change password" }).click();
  await expect(dialog.getByLabel("Temporary password")).toHaveAttribute("aria-invalid", "true");
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Temporary password").fill(account.temporaryPassword);
  await dialog.getByRole("button", { name: "Change password" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Your password was changed.")).toBeVisible();
  await expect(page.getByRole("tab", { name: /Job Postings/ })).toHaveAttribute("aria-selected", "true");

  // The new password works for the next sign-in; the temporary one no longer does.
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/careers\/admin\/login$/);
  // Sign-out is a full page load: wait for it to finish so typing is not lost to hydration.
  await page.waitForLoadState("networkidle");
  await form.email.fill(account.email);
  await form.password.fill(account.temporaryPassword);
  await form.submit.click();
  await expect(form.alert).toHaveText("Invalid email or password.");
  await form.password.fill(newPassword);
  await form.submit.click();
  await expect(page).toHaveURL(/\/careers\/admin$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("HR users do not see the Team and Activity Log tabs", async ({ page, context }) => {
  await signInAsHr(context);
  await page.goto("/careers/admin?tab=users");
  const tabs = page.getByRole("tablist", { name: "Admin sections" }).getByRole("tab");
  await expect(tabs).toHaveCount(3);
  await expect(tabs.nth(0)).toContainText("Job Postings");
  await expect(tabs.nth(1)).toContainText("Applications");
  await expect(tabs.nth(2)).toContainText("Talent Pool");
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: /Team|Activity Log/ })).toHaveCount(0);

  const users = await page.request.get("/api/admin/users");
  expect(users.status()).toBe(403);
});

test("administrators see all five tabs and the tab is kept in the URL", async ({ page, context }) => {
  await signInAsAdmin(context);
  await page.goto("/careers/admin");
  const tabs = page.getByRole("tablist", { name: "Admin sections" }).getByRole("tab");
  await expect(tabs).toHaveCount(5);
  await page.getByRole("tab", { name: /Activity Log/ }).click();
  await expect(page).toHaveURL(/tab=audit/);
  await expect(page.getByRole("heading", { name: "Who did what, and when" })).toBeVisible();

  // Arrow keys move between tabs.
  await page.getByRole("tab", { name: /Activity Log/ }).press("ArrowLeft");
  await expect(page.getByRole("tab", { name: /Team/ })).toBeFocused();
  await expect(page).toHaveURL(/tab=users/);
  await page.reload();
  await expect(page.getByRole("tab", { name: /Team/ })).toHaveAttribute("aria-selected", "true");
});

test("forms submitted before JavaScript loads never put credentials or personal data in the URL", async ({ browser, baseURL }) => {
  // Without hydration the browser submits the form itself. A GET would append the password (or a
  // visitor's details) to the URL, where browser history and access logs keep it.
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  const navigations: string[] = [];
  page.on("request", (request) => {
    if (request.isNavigationRequest()) navigations.push(request.url());
  });
  const secret = `No-Js-${token()}-Passw0rd!`;
  try {
    await page.goto("/careers/admin/login");
    await page.locator("#login-email").fill("no-js@synergypharma.lk");
    await page.locator("#login-password").fill(secret);
    await page.locator("form").getByRole("button", { name: "Sign In" }).click();
    await page.waitForLoadState("load");

    await page.goto("/contact");
    await page.locator('input[name="fullName"]').fill("Nimal Perera");
    await page.locator('input[name="email"]').fill("nimal.no-js@example.lk");
    await page.locator("form.contact-form").locator('button[type="submit"]').click();
    await page.waitForLoadState("load");

    for (const url of navigations) {
      expect(new URL(url).search, url).toBe("");
      expect(url).not.toContain("Passw0rd");
    }
    expect(page.url()).not.toContain("nimal");
  } finally {
    await context.close();
  }
});
