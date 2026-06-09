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
        <div className="portfolio-header">
          <ScrollReveal className="career-detail-header">
            <nav aria-label="Breadcrumb" className="mb-4">
              <ol className="flex items-center gap-2 text-[0.78rem] text-[#5f89a4]">
                <li>
                  <Link href="/" className="hover:text-[#1075bd] transition-colors">Home</Link>
                </li>
                <li aria-hidden="true" className="text-[#9db8c8]">/</li>
                <li>
                  <Link href="/careers" className="hover:text-[#1075bd] transition-colors">Careers</Link>
                </li>
                <li aria-hidden="true" className="text-[#9db8c8]">/</li>
                <li aria-current="page" className="font-semibold text-[#2f5a73] truncate max-w-[200px]">
                  {job.title}
                </li>
              </ol>
            </nav>
            <h1 className="portfolio-header h2">{job.title}</h1>
            <p className="portfolio-subtitle">{job.description}</p>
          </ScrollReveal>
        </div>
      </section>

      <section className="career-detail-content reveal-on-scroll">
        <div className="careers-shell career-detail-shell career-detail-reference-layout">
          <div className="career-detail-main-column">
            <ScrollReveal className="career-detail-panel career-detail-panel-soft">
              <p className="inline-flex rounded-full border border-[#cde6f3] bg-white/85 px-3 py-1 text-[0.72rem] font-bold uppercase tracking-[0.16em] text-[#1075bd] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                Role Overview
              </p>
              <h2>Job Description</h2>
              <p>{job.description}</p>
            </ScrollReveal>

            <ScrollReveal className="career-detail-panel career-detail-panel-soft" delay={0.05}>
              <p className="inline-flex rounded-full border border-[#cde6f3] bg-white/85 px-3 py-1 text-[0.72rem] font-bold uppercase tracking-[0.16em] text-[#1075bd] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                Responsibilities
              </p>
              <h2>What you&apos;ll lead</h2>
              <ul className="career-detail-list">
                {job.responsibilities.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </ScrollReveal>

            <ScrollReveal className="career-detail-panel career-detail-panel-soft" delay={0.1}>
              <p className="inline-flex rounded-full border border-[#cde6f3] bg-white/85 px-3 py-1 text-[0.72rem] font-bold uppercase tracking-[0.16em] text-[#1075bd] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                Requirements
              </p>
              <h2>What we&apos;re looking for</h2>
              <ul className="career-detail-list">
                {job.requirements.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </ScrollReveal>
          </div>

          <aside className="career-detail-summary-column">
            <ScrollReveal className="career-detail-summary-card" delay={0.12}>
              <div className="career-detail-side-card career-detail-side-card-primary">
                <p className="inline-flex rounded-full border border-[#cde6f3] bg-white/85 px-3 py-1 text-[0.72rem] font-bold uppercase tracking-[0.16em] text-[#1075bd] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                  Position Summary
                </p>
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
            </ScrollReveal>
          </aside>
        </div>
      </section>

      <section className="career-detail-application-zone">
        <div className="careers-shell career-detail-shell career-detail-application-wrap">
          <ApplicationForm job={job} />
        </div>
      </section>
    </main>
  );
}
