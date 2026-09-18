import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminApp } from "@/components/careers/admin/admin-app";
import { Hero } from "@/components/hero";
import { SiteHeader } from "@/components/site-header";
import { getAdminFromCookies } from "@/lib/auth/require-admin";
import { isRecordId } from "@/lib/careers/server/ids";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Careers Admin",
  robots: { index: false, follow: false },
};

const ADMIN_TABS = new Set(["jobs", "applications", "talent", "users", "audit"]);

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readDeepLink(params: SearchParams) {
  const tab = single(params.tab);
  const application = single(params.application);
  const talent = single(params.talent);
  return {
    tab: tab && ADMIN_TABS.has(tab) ? tab : undefined,
    applicationId: application && isRecordId(application) ? application : undefined,
    talentId: talent && isRecordId(talent) ? talent : undefined,
  };
}

export default async function CareersAdminPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const link = readDeepLink(await searchParams);
  const user = await getAdminFromCookies();

  if (!user) {
    // Keep deep links (e.g. from HR notification emails) across the sign-in.
    const query = new URLSearchParams();
    if (link.tab) query.set("tab", link.tab);
    if (link.applicationId) query.set("application", link.applicationId);
    if (link.talentId) query.set("talent", link.talentId);
    const queryString = query.toString();
    const from = queryString ? `/careers/admin?${queryString}` : "/careers/admin";
    redirect(`/careers/admin/login?from=${encodeURIComponent(from)}`);
  }

  return (
    <main className="careers-admin-page">
      <SiteHeader />

      <Hero
        eyebrow="Careers Admin"
        heading="Manage jobs and review incoming applicants."
        description="A lightweight admin workspace for role publishing, updates, and CV review."
        className="careers-admin-hero"
      />

      <section className="careers-admin-section">
        <div className="careers-shell">
          <AdminApp
            currentUser={user}
            initialTab={link.tab}
            initialApplicationId={link.applicationId}
            initialTalentId={link.talentId}
          />
        </div>
      </section>
    </main>
  );
}
