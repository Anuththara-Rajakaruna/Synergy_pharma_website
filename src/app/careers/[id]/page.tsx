import Link from "next/link";
import { notFound } from "next/navigation";
import { RevealOnScroll } from "@/components/reveal-on-scroll";
import { ScrollReveal } from "@/components/scroll-reveal";
import { SiteHeader } from "@/components/site-header";
import { ApplicationForm } from "@/components/careers/application-form";
import { getJobById } from "@/lib/careers";

export const dynamic = "force-dynamic";

export default async function CareerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJobById(id);

  if (!job) {
    notFound();
  }

  return (
    <main className="career-detail-page">
      <SiteHeader />
      <RevealOnScroll />

      <section className="career-detail-top">
        <div className="careers-shell career-detail-shell">
          <ScrollReveal className="career-detail-banner">
            <div className="career-detail-banner-copy">
              <Link href="/careers" className="career-detail-breadcrumb">
                Careers / Open Roles
              </Link>
              <p className="career-detail-kicker">{job.department}</p>
              <h1>{job.title}</h1>
              <p className="career-detail-lead">
                {job.description}
              </p>
            </div>

            <div className="career-detail-banner-meta">
              <div className="career-detail-meta-card">
                <span>Department</span>
                <strong>{job.department}</strong>
              </div>
              <div className="career-detail-meta-card">
                <span>Location</span>
                <strong>{job.location}</strong>
              </div>
              <div className="career-detail-meta-card">
                <span>Type</span>
                <strong>{job.type}</strong>
              </div>
              <a href="#apply" className="button-link career-detail-banner-cta">
                Apply Now
              </a>
            </div>
          </ScrollReveal>
        </div>
      </section>

      <section className="career-detail-content reveal-on-scroll">
        <div className="careers-shell career-detail-shell career-detail-layout-v2">
          <div className="career-detail-main-v2">
            <ScrollReveal className="career-detail-feature-card">
              <p className="eyebrow">Role Snapshot</p>
              <h2>Where this role fits</h2>
              <p>
                This position contributes directly to the operational discipline, scientific quality,
                and long-term healthcare standards that define Synergy Pharma&apos;s manufacturing and
                development environment.
              </p>
            </ScrollReveal>

            <div className="career-detail-sections-grid">
              <ScrollReveal className="career-detail-panel career-detail-panel-soft" delay={0.05}>
                <p className="eyebrow">Responsibilities</p>
                <h2>What you&apos;ll lead</h2>
                <ul className="career-detail-list">
                  {job.responsibilities.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </ScrollReveal>

              <ScrollReveal className="career-detail-panel career-detail-panel-soft" delay={0.1}>
                <p className="eyebrow">Requirements</p>
                <h2>What we&apos;re looking for</h2>
                <ul className="career-detail-list">
                  {job.requirements.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </ScrollReveal>
            </div>

            <ScrollReveal className="career-detail-side-card career-detail-expectations-card" delay={0.15}>
              <p className="eyebrow">What to Expect</p>
              <ul className="career-detail-mini-list">
                <li>Structured onboarding into a regulated pharmaceutical environment.</li>
                <li>Close collaboration with quality, manufacturing, and technical teams.</li>
                <li>Practical exposure to standards that shape dependable healthcare delivery.</li>
              </ul>
            </ScrollReveal>
          </div>

          <aside className="career-detail-sidebar-v2">
            <ScrollReveal className="career-detail-side-stack" delay={0.15}>
              <div className="career-detail-side-card career-detail-side-card-primary">
                <p className="eyebrow">Position Summary</p>
                <h3>{job.title}</h3>
                <div className="career-sticky-meta">
                  <span>{job.department}</span>
                  <span>{job.location}</span>
                  <span>{job.type}</span>
                </div>
                <a href="#apply" className="button-link career-sticky-button">
                  Start Application
                </a>
                <Link href="/careers" className="career-back-link">
                  Back to careers
                </Link>
              </div>
            </ScrollReveal>
          </aside>
        </div>
      </section>

      <section className="career-detail-application-zone">
        <div className="careers-shell career-detail-shell">
          <ApplicationForm job={job} />
        </div>
      </section>
    </main>
  );
}
