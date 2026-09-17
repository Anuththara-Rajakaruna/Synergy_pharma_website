import { api, login } from "../support/api";
import { e2eEnv } from "../support/env";
import { createAccount, letters, token } from "./helpers/data";
import { adminWorkspaceShot, confirmDialog, openAdminTab, recordRow, toast } from "./helpers/admin";
import { expect, reviewShot, signInAsAdmin, test } from "./helpers/fixtures";
import type { Locator, Page } from "@playwright/test";

async function readTemporaryPassword(page: Page, title: "Account created" | "Password reset"): Promise<{ dialog: Locator; password: string }> {
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog).toBeVisible();
  const field = dialog.getByLabel("Temporary password");
  await expect(field).toHaveValue(/^.{20}$/);
  return { dialog, password: await field.inputValue() };
}

test("an administrator adds a user and sees the temporary password exactly once", async ({ page, context }) => {
  await signInAsAdmin(context);
  const panel = await openAdminTab(page, "users");
  await adminWorkspaceShot(page, "admin-team-tab");
  const id = token();
  const email = `ui.team.${id}@synergypharma.lk`;
  const name = `Ishara ${letters(id)}`;

  await panel.getByRole("button", { name: "Add user" }).click();
  const add = page.getByRole("dialog", { name: "Add user" });
  await add.getByLabel("Work email address").fill(email);
  await add.getByLabel("Full name").fill("R2D2");
  await add.getByRole("button", { name: "Create account" }).click();
  await expect(add.getByLabel("Full name")).toHaveAttribute("aria-invalid", "true");
  await expect(add.getByText("Use letters only (spaces, apostrophes, full stops and hyphens are allowed).")).toBeVisible();

  await add.getByLabel("Full name").fill(name);
  await expect(add.getByLabel("Role")).toHaveValue("hr");
  await reviewShot(page, "admin-team-add-user");
  await add.getByRole("button", { name: "Create account" }).click();

  const { dialog, password } = await readTemporaryPassword(page, "Account created");
  await expect(dialog.getByText("This password is shown only once.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Copy password" })).toBeVisible();
  await reviewShot(page, "admin-team-temporary-password");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();

  const row = recordRow(panel, email);
  await expect(row).toContainText(name);
  await expect(row).toContainText("HR / Recruitment");
  await expect(row).toContainText("Temporary password");
  await expect(row).toContainText("Never");

  // The password shown works (and still has to be changed on first sign-in).
  const cookie = await login(email, password);
  const me = await api<{ user: { mustChangePassword: boolean } }>("GET", "/api/admin/me", { cookie });
  expect(me.body.user.mustChangePassword).toBe(true);

  // The same address cannot be added twice.
  await panel.getByRole("button", { name: "Add user" }).click();
  await add.getByLabel("Work email address").fill(email.toUpperCase());
  await add.getByLabel("Full name").fill(name);
  await add.getByRole("button", { name: "Create account" }).click();
  await expect(add.getByLabel("Work email address")).toHaveAttribute("aria-invalid", "true");
  await add.getByRole("button", { name: "Cancel" }).click();
});

test("editing accounts: role and active changes, protections on your own account, and password resets", async ({ page, context, adminCookie }) => {
  const account = await createAccount(adminCookie, "hr", "Edit");
  await signInAsAdmin(context);
  const panel = await openAdminTab(page, "users");

  // Administrators cannot change their own role or deactivate themselves.
  const selfRow = recordRow(panel, e2eEnv.adminEmail);
  await selfRow.getByRole("button", { name: /^Edit/ }).click();
  const selfDialog = page.getByRole("dialog", { name: "Edit your account" });
  await expect(selfDialog.getByLabel("Role")).toBeDisabled();
  await expect(selfDialog.getByRole("checkbox", { name: "Account is active" })).toBeDisabled();
  await expect(selfDialog.getByText("You can't change your own role. Ask another administrator.")).toBeVisible();
  await expect(selfDialog.getByText("You can't deactivate your own account.")).toBeVisible();
  await expect(selfDialog.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await expect(selfRow.getByRole("button", { name: /Reset password/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(selfDialog).toBeHidden();

  const row = recordRow(panel, account.email);
  await row.getByRole("button", { name: `Edit ${account.name}` }).click();
  const edit = page.getByRole("dialog", { name: "Edit account" });
  await edit.getByLabel("Full name").fill("");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit.getByLabel("Full name")).toHaveAttribute("aria-invalid", "true");
  await edit.getByLabel("Full name").fill(account.name);

  await edit.getByLabel("Role").selectOption("admin");
  await edit.getByRole("checkbox", { name: "Account is active" }).uncheck();
  await expect(edit.getByText(`Deactivating signs ${account.name} out of every device immediately.`)).toBeVisible();
  await reviewShot(page, "admin-team-edit-user");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(toast(page, `${account.name}'s account was deactivated and signed out of every device.`)).toBeVisible();
  await expect(row).toContainText("Administrator");
  await expect(row).toContainText("Inactive");
  const inactiveLogin = await api("POST", "/api/admin/login", { json: { email: account.email, password: account.temporaryPassword } });
  expect(inactiveLogin.status).toBe(401);

  await row.getByRole("button", { name: `Edit ${account.name}` }).click();
  await edit.getByRole("checkbox", { name: "Account is active" }).check();
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(toast(page, `${account.name}'s account was reactivated.`)).toBeVisible();
  await expect(row).toContainText("Active");

  await row.getByRole("button", { name: `Reset password for ${account.name}` }).click();
  await confirmDialog(page, "Reset this password?", "Reset password");
  const { dialog, password } = await readTemporaryPassword(page, "Password reset");
  expect(password).not.toBe(account.temporaryPassword);
  await expect(dialog.getByText("Their previous password no longer works")).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(row).toContainText("Temporary password");

  const newLogin = await api("POST", "/api/admin/login", { json: { email: account.email, password } });
  expect(newLogin.status).toBe(200);
});
