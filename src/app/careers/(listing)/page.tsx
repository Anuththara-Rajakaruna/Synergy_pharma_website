import type { Metadata } from "next";
import { Suspense } from "react";
import { RevealOnScroll } from "@/components/reveal-on-scroll";
import { ScrollReveal } from "@/components/scroll-reveal";
import { SiteHeader } from "@/components/site-header";
import { Hero } from "@/components/hero";
import { CareersListing } from "@/components/careers/careers-listing";
import { TalentPoolForm } from "@/components/careers/talent-pool-form";
import { listStaticOpenJobs } from "@/lib/careers/static-jobs";
import { logger } from "@/lib/logger";
import { buildMetadata } from "@/lib/metadata";
import type { Job } from "@/types/careers";

export const dynamic = "force-dynamic";

export const metadata: Metadata = buildMetadata({
  title: "Careers | Synergy Pharmaceutical Corporation",
  description:
    "Join Synergy Pharmaceutical Corporation and advance human health through precision pharmaceutical manufacturing. Explore open roles across Quality, R&D, Manufacturing, and more.",
  path: "/careers",
});

// A database outage must not take down the whole page: the hero and talent pool form still
// render, and the listing shows an inline retry card.
async function loadOpenJobs(): Promise<{ jobs: Job[]; loadError: boolean; renderedAt: string }> {
  const renderedAt = new Date().toISOString();
  try {
    return { jobs: await listStaticOpenJobs(), loadError: false, renderedAt };
  } catch (err) {
    logger.error("careers.jobs_unavailable", { err });
    return { jobs: [], loadError: true, renderedAt };
  }
}

export default async function CareersPage() {
  const { jobs, loadError, renderedAt } = await loadOpenJobs();

  return (
    <main className="careers-page">
      <SiteHeader />
      <RevealOnScroll />

      <Hero
        eyebrow="Careers at Synergy Pharma"
        heading="Join us in advancing pharmaceutical excellence."
        description="Build your next chapter with teams committed to quality, science, and responsible healthcare manufacturing."
        className="careers-hero-section"
        actions={
          <div className="careers-hero-actions">
            <a href="#open-positions" className="button-link">View Open Roles</a>
            <a href="#talent-pool" className="button-link-secondary">Join Talent Pool</a>
          </div>
        }
      />

      <section className="careers-jobs-section reveal-on-scroll" id="open-positions">
        <div>
          <ScrollReveal className="careers-header">
            <p className="careers-eyebrow">Open Positions</p>
            <h2>Explore current opportunities across the business.</h2>
            <p className="careers-subtitle">Search roles by title or keyword, filter by department, and move into a detailed application flow.</p>
          </ScrollReveal>
        </div>
        <div className="careers-shell">
          <Suspense
            fallback={
              <div className="space-y-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="animate-pulse rounded-[28px] border border-[#e0ebf3] bg-white px-6 py-5 shadow-[0_16px_34px_rgba(17,58,83,0.08)]"
                    style={{ height: "120px" }}
                  />
                ))}
              </div>
            }
          >
            <CareersListing initialJobs={jobs} loadError={loadError} renderedAt={renderedAt} />
          </Suspense>
        </div>
      </section>

      <section className="careers-talent-section reveal-on-scroll" id="talent-pool">
        <div className="careers-shell careers-talent-layout">
          <ScrollReveal className="careers-header careers-talent-copy">
            <p className="careers-eyebrow">Talent Pool</p>
            <h2>Share your resume even if the right opening is not live yet.</h2>
            <p className="careers-subtitle">
              We&apos;re always interested in connecting with professionals who care about pharmaceutical
              quality, manufacturing excellence, and sustainable healthcare growth.
            </p>
          </ScrollReveal>

          <ScrollReveal className="careers-talent-card" delay={0.1}>
            <TalentPoolForm />
          </ScrollReveal>
        </div>
      </section>
    </main>
  );
}
