import Link from "next/link";
import { notFound } from "next/navigation";
import { RevealOnScroll } from "@/components/reveal-on-scroll";
import { ScrollReveal } from "@/components/scroll-reveal";
import { SiteHeader } from "@/components/site-header";
import { Hero } from "@/components/hero";
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

      <Hero
        eyebrow={job.department}
        heading={job.title}
        description={`${job.location} · ${job.type}`}
        className="careers-detail-hero"
        actions={
          <div className="careers-hero-actions">
            <a href="#apply" className="button-link">
              Apply Now
            </a>
          </div>
        }
      />

      <section className="career-detail-content reveal-on-scroll">
        <div className="careers-shell career-detail-layout">
          <div className="career-detail-main">
            <ScrollReveal className="career-detail-panel">
              <p className="eyebrow">Role Overview</p>
              <h2>Job Description</h2>
              <p>{job.description}</p>
            </ScrollReveal>

            <ScrollReveal className="career-detail-panel" delay={0.05}>
              <p className="eyebrow">Responsibilities</p>
              <h2>What you’ll lead</h2>
              <ul className="career-detail-list">
                {job.responsibilities.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </ScrollReveal>

            <ScrollReveal className="career-detail-panel" delay={0.1}>
              <p className="eyebrow">Requirements</p>
              <h2>What we’re looking for</h2>
              <ul className="career-detail-list">
                {job.requirements.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </ScrollReveal>

            <ApplicationForm job={job} />
          </div>

          <aside className="career-detail-sidebar">
            <div className="career-sticky-card">
              <p className="eyebrow">Position Summary</p>
              <h3>{job.title}</h3>
              <div className="career-sticky-meta">
                <span>{job.department}</span>
                <span>{job.location}</span>
                <span>{job.type}</span>
              </div>
              <a href="#apply" className="button-link career-sticky-button">
                Apply Now
              </a>
              <Link href="/careers" className="career-back-link">
                Back to careers
              </Link>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
