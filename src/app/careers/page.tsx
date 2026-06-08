import type { Metadata } from "next";
import Link from "next/link";
import { RevealOnScroll } from "@/components/reveal-on-scroll";
import { ScrollReveal, ScrollRevealContainer, ScrollRevealItem } from "@/components/scroll-reveal";
import { SiteHeader } from "@/components/site-header";
import { Hero } from "@/components/hero";
import { CareersListing } from "@/components/careers/careers-listing";
import { TalentPoolForm } from "@/components/careers/talent-pool-form";
import { getActiveJobs } from "@/lib/careers";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Careers at Synergy Pharmaceuticals | Join Our Team",
  description:
    "Explore open positions in pharmaceutical manufacturing, quality assurance, R&D, regulatory affairs, and more. Join Synergy Pharmaceuticals in Sri Lanka.",
  openGraph: {
    title: "Careers at Synergy Pharmaceuticals",
    description:
      "Explore open positions in pharmaceutical manufacturing, quality assurance, R&D, and more at Synergy Pharmaceuticals, Sri Lanka.",
    type: "website",
  },
};

export default async function CareersPage() {
  const jobs = await getActiveJobs();

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
            <a href="#open-positions" className="button-link">
              View Open Positions
            </a>
          </div>
        }
      />

      <section className="careers-jobs-section reveal-on-scroll" id="open-positions">
        <div>
          <ScrollReveal className="careers-header">
            <p className="careers-eyebrow">Open Positions</p>
            <h2>Explore current opportunities across the business.</h2>
            <p className="careers-subtitle">Search by role title, filter by department, and move into a detailed application flow.</p>
          </ScrollReveal>
        </div>
        <div className="careers-shell">
          <CareersListing initialJobs={jobs} />
        </div>
      </section>

      <section className="careers-talent-section reveal-on-scroll">
        <div className="careers-shell careers-talent-layout">
          <ScrollReveal className="careers-header careers-talent-copy">
            <p className="careers-eyebrow">Talent Pool</p>
            <h2>Share your CV even if the right opening is not live yet.</h2>
            <p className="careers-subtitle">
              We&apos;re always interested in connecting with professionals who care about pharmaceutical
              quality, manufacturing excellence, and sustainable healthcare growth.
            </p>
            <Link href="/careers/status" className="careers-status-link">
              Check application status →
            </Link>
          </ScrollReveal>

          <ScrollReveal className="careers-talent-card" delay={0.1}>
            <TalentPoolForm />
          </ScrollReveal>
        </div>
      </section>
    </main>
  );
}
