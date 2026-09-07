import type { Metadata } from "next";
import { RevealOnScroll } from "@/components/reveal-on-scroll";
import { SiteHeader } from "@/components/site-header";
import { Hero } from "@/components/hero";
import { CareersAdminClient } from "@/components/careers/careers-admin-client";
import { getJobs } from "@/lib/careers";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Careers Admin",
  robots: { index: false, follow: false },
};

export default async function CareersAdminPage() {
  const jobs = await getJobs();

  return (
    <main className="careers-admin-page">
      <SiteHeader />
      <RevealOnScroll />

      <Hero
        eyebrow="Careers Admin"
        heading="Manage jobs and review incoming applicants."
        description="A lightweight admin workspace for role publishing, updates, and CV review."
        className="careers-admin-hero"
      />

      <section className="careers-admin-section reveal-on-scroll">
        <div className="careers-shell">
          <CareersAdminClient initialJobs={jobs} />
        </div>
      </section>
    </main>
  );
}
