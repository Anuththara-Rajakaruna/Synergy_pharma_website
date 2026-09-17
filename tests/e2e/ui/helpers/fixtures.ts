import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test as base, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { clientIp as randomClientIp, loginAsAdmin, pdfBytes } from "../../support/api";
import { e2eEnv } from "../../support/env";

export { expect };

type BrowserProblems = {
  // Console errors, uncaught exceptions and Content-Security-Policy violations seen by the page.
  list: () => Promise<string[]>;
};

type UiFixtures = {
  // The client address this test presents to the site's rate limiter.
  clientIp: string;
  browserProblems: BrowserProblems;
};

type UiWorkerFixtures = {
  // Session cookie of the shared admin account, for API-level test setup.
  adminCookie: string;
};

function isSiteApiRequest(url: URL): boolean {
  return url.origin === new URL(e2eEnv.baseUrl).origin && url.pathname.startsWith("/api/");
}

export const test = base.extend<UiFixtures, UiWorkerFixtures>({
  clientIp: async ({}, provide) => {
    await provide(randomClientIp());
  },

  // Same-origin API calls from the browser carry this test's client IP header. Requests to object
  // storage are left untouched (its CORS policy only allows the content-type request header).
  context: async ({ context, clientIp }, provide) => {
    await context.route(isSiteApiRequest, async (route) => {
      const headers = { ...(await route.request().allHeaders()), [e2eEnv.clientIpHeader]: clientIp };
      await route.continue({ headers });
    });
    await provide(context);
  },

  browserProblems: async ({ page }, provide) => {
    const problems: string[] = [];
    await page.addInitScript(() => {
      const store: string[] = [];
      Object.defineProperty(window, "__e2eCspViolations", { value: store });
      document.addEventListener("securitypolicyviolation", (event) => {
        store.push(`CSP violation: ${event.violatedDirective} blocked ${event.blockedURI || "inline"}`);
      });
    });
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(`console error: ${message.text()}`);
    });
    page.on("pageerror", (error) => problems.push(`uncaught: ${error.message}`));
    await provide({
      list: async () => {
        const violations = await page
          .evaluate(() => {
            const value: unknown = Reflect.get(window, "__e2eCspViolations");
            return Array.isArray(value) ? value.map(String) : [];
          })
          .catch(() => []);
        return [...problems, ...violations];
      },
    });
  },

  adminCookie: [
    async ({}, provide) => {
      await provide(await loginAsAdmin());
    },
    { scope: "worker" },
  ],
});

// Signs the browser context in through the login API (the session cookie lands in the context).
export async function signIn(context: BrowserContext, email: string, password: string): Promise<void> {
  const response = await context.request.post(`${e2eEnv.baseUrl}/api/admin/login`, {
    data: { email, password },
    headers: { origin: e2eEnv.baseUrl, [e2eEnv.clientIpHeader]: randomClientIp() },
  });
  if (response.status() !== 200) throw new Error(`Browser sign-in failed for ${email}: ${response.status()} ${await response.text()}`);
}

export function signInAsAdmin(context: BrowserContext): Promise<void> {
  return signIn(context, e2eEnv.adminEmail, e2eEnv.adminPassword);
}

export function signInAsHr(context: BrowserContext): Promise<void> {
  return signIn(context, e2eEnv.hrEmail, e2eEnv.hrPassword);
}

// A PDF for <input type=file>, built in memory.
export function pdfUpload(name: string, sizeBytes = 8000): { name: string; mimeType: string; buffer: Buffer } {
  return { name, mimeType: "application/pdf", buffer: pdfBytes(sizeBytes, name) };
}

// Review screenshots for humans (not assertions). Written to E2E_REVIEW_SCREENSHOT_DIR, or
// test-results/e2e-review-screenshots, as "<project>--<name>.png".
export async function reviewShot(page: Page, name: string, options: { fullPage?: boolean; target?: Locator } = {}): Promise<void> {
  const directory = path.resolve(process.env.E2E_REVIEW_SCREENSHOT_DIR ?? "test-results/e2e-review-screenshots");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${test.info().project.name}--${name}.png`);
  // Let entrance animations settle so the shot shows the resting state.
  await page.waitForTimeout(400);
  if (options.target) await options.target.screenshot({ path: file, animations: "disabled" });
  else await page.screenshot({ path: file, fullPage: options.fullPage ?? false, animations: "disabled" });
}

// The page never scrolls sideways: wide content must scroll inside its own container.
export async function expectNoHorizontalOverflow(page: Page, context: string): Promise<void> {
  const size = await page.evaluate(() => ({
    scrollWidth: document.scrollingElement?.scrollWidth ?? document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    offenders: Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.right > window.innerWidth + 1;
      })
      .slice(0, 5)
      .map((element) => `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 60)} right=${Math.round(element.getBoundingClientRect().right)}`),
  }));
  expect(
    size.scrollWidth,
    `${context}: page is ${size.scrollWidth}px wide in a ${size.innerWidth}px viewport. Elements past the edge: ${size.offenders.join(" | ")}`
  ).toBeLessThanOrEqual(size.innerWidth + 1);
}

// Scrolls every reveal-on-scroll section into view and checks each one ends up visible.
export async function expectRevealSectionsVisible(page: Page): Promise<number> {
  const sections = page.locator(".reveal-on-scroll");
  const count = await sections.count();
  for (let index = 0; index < count; index += 1) {
    const section = sections.nth(index);
    await section.scrollIntoViewIfNeeded();
    await expect(section).toHaveClass(/\bis-visible\b/);
    await expect.poll(async () => Number(await section.evaluate((element) => getComputedStyle(element).opacity))).toBeGreaterThan(0.95);
  }
  return count;
}

type MailIndexEntry = { n: number; at: string; from: string; to: string[]; subject: string };
export type CapturedMail = MailIndexEntry & { raw: string };

// Waits for a message captured by the SMTP sink. Only matching messages are read from disk.
export async function waitForEmail(match: { to: string; subject: string | RegExp }, timeoutMs = 30_000): Promise<CapturedMail> {
  const started = Date.now();
  const recipient = match.to.toLowerCase();
  for (;;) {
    const index = await readFile(path.join(e2eEnv.mailboxDir, "index.ndjson"), "utf8").catch(() => "");
    const found = index
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as MailIndexEntry)
      .find(
        (entry) =>
          entry.to.some((address) => address.toLowerCase() === recipient) &&
          (typeof match.subject === "string" ? entry.subject.includes(match.subject) : match.subject.test(entry.subject))
      );
    if (found) {
      const raw = await readFile(path.join(e2eEnv.mailboxDir, `${found.n}.eml`), "utf8").catch(() => "");
      return { ...found, raw };
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`No email to ${match.to} with subject ${String(match.subject)} within ${timeoutMs} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

// Quoted-printable bodies break long lines with "=\n"; this joins them for text assertions.
export function decodeQuotedPrintable(raw: string): string {
  return raw
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}
