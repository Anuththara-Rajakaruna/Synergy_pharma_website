"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/site-header";

export default function CareersAdminError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    console.error(error);
  }, [error]);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await fetch("/api/admin/logout", { method: "POST", credentials: "same-origin", cache: "no-store" });
    } catch {
      // Go to the sign-in page either way; a session that could not be ended server-side still
      // expires after the idle timeout.
    } finally {
      router.replace("/careers/admin/login");
    }
  }

  return (
    <main className="careers-admin-page">
      <SiteHeader />
      <section className="careers-admin-section" style={{ paddingTop: "clamp(7rem, 12vw, 9rem)" }}>
        <div className="careers-shell">
          <div className="careers-admin-card mx-auto max-w-xl text-center" role="alert">
            <div
              className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl shadow-[0_12px_28px_rgba(192,57,43,0.25)]"
              style={{ background: "linear-gradient(135deg, #c0392b, #e74c3c)" }}
            >
              <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m9.303 3.376c.866 1.5-.217 3.374-1.948 3.374H4.645c-1.73 0-2.813-1.874-1.948-3.374L10.051 3.378c.866-1.5 3.032-1.5 3.898 0L21.303 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
            </div>
            <p className="mb-2 text-[0.72rem] font-bold uppercase tracking-[0.18em] text-[#c0392b]">Admin workspace unavailable</p>
            <h1 className="text-[1.4rem] font-bold leading-snug text-[#0a1f35]">We couldn&apos;t load the careers admin.</h1>
            <p className="mx-auto mt-3 max-w-md text-[0.95rem] leading-relaxed text-[#4d6578]">
              This is usually temporary, for example while the database is briefly unreachable. Try again in a moment.
            </p>
            {error.digest ? (
              <p className="mt-3 text-[0.8rem] text-[#6b8fa8]">
                Reference: <code className="font-mono text-[#42677f]">{error.digest}</code>
              </p>
            ) : null}

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => retry()}
                className="h-11 rounded-2xl bg-[#1075bd] px-6 text-[0.76rem] font-bold uppercase tracking-[0.16em] text-white shadow-[0_12px_28px_rgba(16,117,189,0.28)] transition-colors hover:bg-[#0c68a7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1075bd]"
                style={{ marginTop: 0 }}
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                disabled={signingOut}
                className="h-11 rounded-2xl border border-[#d0e4f0] bg-white px-6 text-[0.76rem] font-bold uppercase tracking-[0.12em] text-[#42677f] transition-colors hover:bg-[#f0f7fb] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1075bd]"
                style={{ marginTop: 0, boxShadow: "none" }}
              >
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
