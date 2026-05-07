import Link from "next/link";
import { RevealOnScroll } from "@/components/reveal-on-scroll";
import { ScrollReveal } from "@/components/scroll-reveal";
import { SiteHeader } from "@/components/site-header";
import { Hero } from "@/components/hero";
import { CareersListing } from "@/components/careers/careers-listing";
import { TalentPoolForm } from "@/components/careers/talent-pool-form";
import { getJobs } from "@/lib/careers";

export const dynamic = "force-dynamic";

export default async function CareersPage() {
  const jobs = await getJobs();

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

      {/* <section className="careers-culture-section reveal-on-scroll">
        <div className="careers-shell">
          <ScrollReveal className="careers-section-heading">
            <p className="careers-eyebrow">Company Culture</p>
            <h2>Purpose-driven work, built on discipline and growth.</h2>
            <p>
              At Synergy Pharma, we combine pharmaceutical rigor with a collaborative culture that
              supports learning, accountability, and long-term impact.
            </p>
          </ScrollReveal>

          <ScrollRevealContainer staggerDelay={0.1} className="careers-culture-grid">
            <ScrollRevealItem className="careers-culture-card">
              <h3>GMP Compliance</h3>
              <p>Quality is embedded into our daily decisions, documentation, and manufacturing standards.</p>
            </ScrollRevealItem>
            <ScrollRevealItem className="careers-culture-card">
              <h3>Innovation</h3>
              <p>We keep improving systems, processes, and scientific capability across the organization.</p>
            </ScrollRevealItem>
            <ScrollRevealItem className="careers-culture-card">
              <h3>Employee Development</h3>
              <p>Training, mentorship, and cross-functional exposure help our teams keep progressing.</p>
            </ScrollRevealItem>
          </ScrollRevealContainer>
        </div>
      </section> */}
{/* 
      <section className="careers-benefits-section reveal-on-scroll">
        <div className="careers-shell">
          <ScrollReveal className="careers-section-heading">
            <p className="careers-eyebrow">Benefits</p>
            <h2>Support that helps people do their best work.</h2>
          </ScrollReveal>

          <ScrollRevealContainer staggerDelay={0.1} className="careers-benefits-grid">
            {benefits.map((benefit) => (
              <ScrollRevealItem key={benefit.title}>
                <article className="career-benefit-card">
                  <h3>{benefit.title}</h3>
                  <p>{benefit.description}</p>
                </article>
              </ScrollRevealItem>
            ))}
          </ScrollRevealContainer>
        </div>
      </section> */}

      <section className="careers-jobs-section reveal-on-scroll" id="open-positions">
        <div className="careers-shell">
          <ScrollReveal className="careers-section-heading">
            <p className="careers-eyebrow">Open Positions</p>
            <h2>Explore current opportunities across the business.</h2>
            <p>Search by role title, filter by department, and move into a detailed application flow.</p>
          </ScrollReveal>

          <CareersListing initialJobs={jobs} />
        </div>
      </section>

      <section className="careers-talent-section reveal-on-scroll">
        <div className="careers-shell careers-talent-layout">
          <ScrollReveal className="careers-talent-copy">
            <p className="careers-eyebrow">Talent Pool</p>
            <h2>Share your CV even if the right opening is not live yet.</h2>
            <p>
              We’re always interested in connecting with professionals who care about pharmaceutical
              quality, manufacturing excellence, and sustainable healthcare growth.
            </p>
            <Link href="/careers/admin" className="careers-admin-link">
              Open admin tools
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
