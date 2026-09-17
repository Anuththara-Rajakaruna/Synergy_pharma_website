import type { Locator, Page } from "@playwright/test";
import { expect, reviewShot } from "./fixtures";

// Helpers for the careers admin workspace.

export async function openAdminTab(page: Page, tab: "jobs" | "applications" | "talent" | "users" | "audit"): Promise<Locator> {
  await page.goto(`/careers/admin?tab=${tab}`);
  const labels = { jobs: "Job Postings", applications: "Applications", talent: "Talent Pool", users: "Team", audit: "Activity Log" } as const;
  await expect(page.getByRole("tab", { name: new RegExp(labels[tab]) })).toHaveAttribute("aria-selected", "true");
  return page.getByRole("tabpanel");
}

export function toast(page: Page, text: string | RegExp): Locator {
  return page.locator("[data-admin-toasts]").getByText(text);
}

export async function confirmDialog(page: Page, title: string, button: string): Promise<void> {
  const dialog = page.getByRole("alertdialog", { name: title });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: button, exact: true }).click();
  await expect(dialog).toBeHidden();
}

// A section of a detail drawer, found by its heading.
export function drawerSection(drawer: Locator, heading: string | RegExp): Locator {
  const name = typeof heading === "string" ? { name: heading, exact: true } : { name: heading };
  return drawer.locator("section.adm-section").filter({ has: drawer.page().getByRole("heading", name) });
}

// The desktop table row (or phone card) that mentions `text`.
export function recordRow(panel: Locator, text: string): Locator {
  return panel.locator("tbody tr, li.adm-record-card").filter({ hasText: text }).filter({ visible: true });
}

// Review screenshot of the admin workspace: the viewport scrolled so the tab bar sits just below
// the site header, showing the active panel's heading, filters and first records.
export async function adminWorkspaceShot(page: Page, name: string): Promise<void> {
  await page.getByRole("tabpanel").locator(".adm-skeleton-list").first().waitFor({ state: "detached" }).catch(() => undefined);
  await page.getByRole("tablist", { name: "Admin sections" }).evaluate((element) => {
    window.scrollTo({ top: element.getBoundingClientRect().top + window.scrollY - 96, behavior: "instant" });
  });
  await reviewShot(page, name);
}
