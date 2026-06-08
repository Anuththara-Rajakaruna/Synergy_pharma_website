import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RevealOnScroll } from "@/components/reveal-on-scroll";
import { ScrollReveal } from "@/components/scroll-reveal";
import { SiteHeader } from "@/components/site-header";
import { ApplicationForm } from "@/components/careers/application-form";
import { JobShareButtons } from "@/components/careers/job-share-buttons";
import { JobViewTracker } from "@/components/careers/job-view-tracker";
import { getJobById } from "@/lib/careers";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const job = await getJobById(id);

  if (!job) {
    return { title: "Job Not Found | Synergy Pharmaceuticals" };
  }

  return {
    title: `${job.title} | Careers at Synergy Pharmaceuticals`,
    description: job.description,
    openGraph: {
      title: `${job.title} — Synergy Pharmaceuticals`,
      description: job.description,
      type: "website",
    },
  };
}

export default async function CareerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJobById(id);

  if (!job) {
    notFound();
  }

  const jobPosting = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: job.description,
    responsibilities: job.responsibilities.join(" "),
    qualifications: job.requirements.join(" "),
    hiringOrganization: {
      "@type": "Organization",
      name: "Synergy Pharmaceuticals",
      sameAs: "https://synergypharma.lk",
    },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: job.location,
        addressCountry: "LK",
      },
    },
    employmentType: job.type === "Internship" ? "INTERN" : "FULL_TIME",
    occupationalCategory: job.department,
    datePosted: new Date().toISOString().split("T")[0],
  };

  return (
    <main className="career-detail-page">
      <SiteHeader />
      <RevealOnScroll />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jobPosting) }}
      />
      <JobViewTracker jobId={job.id} />

      <section className="career-detail-top">
        <div className="portfolio-header">
          <ScrollReveal className="career-detail-header">
            <nav className="career-breadcrumb" aria-label="Breadcrumb">
              <Link href="/">Home</Link>
              <span aria-hidden="true">›</span>
              <Link href="/careers">Careers</Link>
              <span aria-hidden="true">›</span>
              <span aria-current="page">{job.title}</span>
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
              <p className="inline-flex rounded-full border border-[#cde6f3] bg-white/85 px-3 py-1 text-[0.72rem] font-bold uppercase tracking-[0.16em] text-[#1075bd] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-300 group-hover:border-[#a8d4ec] group-hover:bg-[#f7fbfe]">
Role Overview</p>
              <h2>Job Description</h2>
              <p>{job.description}</p>
            </ScrollReveal>

            <ScrollReveal className="career-detail-panel career-detail-panel-soft" delay={0.05}>
              <p className="inline-flex rounded-full border border-[#cde6f3] bg-white/85 px-3 py-1 text-[0.72rem] font-bold uppercase tracking-[0.16em] text-[#1075bd] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-300 group-hover:border-[#a8d4ec] group-hover:bg-[#f7fbfe]">
Responsibilities</p>
              <h2>What you&apos;ll lead</h2>
              <ul className="career-detail-list">
                {job.responsibilities.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </ScrollReveal>

            <ScrollReveal className="career-detail-panel career-detail-panel-soft" delay={0.1}>
              <p className="inline-flex rounded-full border border-[#cde6f3] bg-white/85 px-3 py-1 text-[0.72rem] font-bold uppercase tracking-[0.16em] text-[#1075bd] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-300 group-hover:border-[#a8d4ec] group-hover:bg-[#f7fbfe]">
Requirements</p>
              <h2>What we&apos;re looking for</h2>
              <p className="career-requirements-label">Essential</p>
              <ul className="career-detail-list">
                {job.requirements.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              {job.preferredRequirements && job.preferredRequirements.length > 0 && (
                <>
                  <p className="career-requirements-label career-requirements-label-preferred">Preferred / Nice to have</p>
                  <ul className="career-detail-list career-detail-list-preferred">
                    {job.preferredRequirements.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              )}
            </ScrollReveal>
          </div>

          <aside className="career-detail-summary-column">
            <ScrollReveal className="career-detail-summary-card" delay={0.12}>
              <div className="career-detail-side-card career-detail-side-card-primary">
                <p className="inline-flex rounded-full border border-[#cde6f3] bg-white/85 px-3 py-1 text-[0.72rem] font-bold uppercase tracking-[0.16em] text-[#1075bd] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-300 group-hover:border-[#a8d4ec] group-hover:bg-[#f7fbfe]">
Position Summary</p>
                <h3>{job.title}</h3>
                <div className="career-sticky-meta">
                  <span>{job.department}</span>
                  <span>{job.location}</span>
                  <span>{job.type}</span>
                  {job.salary && <span>{job.salary}</span>}
                  {job.closingDate && (
                    <span>
                      Closes {new Date(job.closingDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                    </span>
                  )}
                </div>
                <a href="#apply" className="button-link career-sticky-button">
                  Apply Now
                </a>
                <Link href="/careers" className="career-back-link">
                  Back to careers
                </Link>
              </div>
            </ScrollReveal>
            <JobShareButtons
              title={job.title}
              url={`${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/careers/${job.id}`}
            />
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
