import type { Metadata } from "next";
import { redirect, unstable_rethrow } from "next/navigation";
import { LoginForm } from "@/components/careers/admin/login-form";
import { getAdminFromCookies } from "@/lib/auth/require-admin";
import { hasControlCharacters } from "@/lib/careers/validation";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin Sign In",
  robots: { index: false, follow: false },
};

const DEFAULT_REDIRECT = "/careers/admin";

// Only admin pages on this site are valid post-login destinations; anything else (other hosts,
// protocol-relative URLs, the login page itself) falls back to the dashboard.
function sanitizeRedirectTarget(raw: string | string[] | undefined): string {
  if (typeof raw !== "string" || raw.length > 2000 || hasControlCharacters(raw)) return DEFAULT_REDIRECT;
  if (!raw.startsWith("/careers/admin") || raw.includes("\\")) return DEFAULT_REDIRECT;
  let url: URL;
  try {
    url = new URL(raw, "https://admin.invalid");
  } catch {
    return DEFAULT_REDIRECT;
  }
  if (url.origin !== "https://admin.invalid") return DEFAULT_REDIRECT;
  const path = url.pathname;
  if (path !== "/careers/admin" && !path.startsWith("/careers/admin/")) return DEFAULT_REDIRECT;
  if (path === "/careers/admin/login" || path.startsWith("/careers/admin/login/")) return DEFAULT_REDIRECT;
  return `${path}${url.search}`;
}

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const redirectTo = sanitizeRedirectTarget((await searchParams).from);

  let signedIn = false;
  try {
    signedIn = (await getAdminFromCookies()) !== null;
  } catch (err) {
    unstable_rethrow(err);
    // Still show the form when the session store is unreachable; the login API reports the outage.
    logger.error("admin.login_page.session_check_failed", { err });
  }
  if (signedIn) redirect(redirectTo);

  return <LoginForm redirectTo={redirectTo} />;
}
