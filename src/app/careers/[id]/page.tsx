import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RevealOnScroll } from "@/components/reveal-on-scroll";
import { ScrollReveal } from "@/components/scroll-reveal";
import { SiteHeader } from "@/components/site-header";
import { ApplicationForm } from "@/components/careers/application-form";
import { getJobById, getPublishedJobs } from "@/lib/careers";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const job = await getJobById(id);
  if (!job) return { title: "Job Not Found — Synergy Pharma" };

  const description = job.description.slice(0, 155) + (job.description.length > 155 ? "…" : "");
  return {
    title: `${job.title} — Synergy Pharma Careers`,
    description,
    openGraph: {
      title: `${job.title} — Synergy Pharma Careers`,
      description,
      url: `https://synergypharma.lk/careers/${job.id}`,
      siteName: "Synergy Pharma",
      images: [{ url: "/logo.png", width: 200, height: 200, alt: "Synergy Pharma logo" }],
      type: "website",
    },
    twitter: {
      card: "summary",
      title: `${job.title} — Synergy Pharma Careers`,
      description,
      images: ["/logo.png"],
    },
  };
}

export default async function CareerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [job, allJobs] = await Promise.all([getJobById(id), getPublishedJobs()]);

  if (!job) {
    notFound();
  }

  const relatedJobs = allJobs
    .filter((j) => j.id !== job.id && j.department === job.department)
    .slice(0, 3);

  const employmentType = job.type === "Full-time" ? "FULL_TIME" : "INTERN";

  return (
    <main className="career-detail-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org/",
            "@type": "JobPosting",
            title: job.title,
            description: job.description,
            datePosted: new Date().toISOString().split("T")[0],
            employmentType,
            hiringOrganization: {
              "@type": "Organization",
              name: "Synergy Pharma",
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
          }),
        }}
      />
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
                <li aria-current="page" className="font-semibold text-[#2f5a73] truncate max-w-50">
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

            {/* Related jobs */}
            {relatedJobs.length > 0 && (
              <ScrollReveal className="career-detail-panel career-detail-panel-soft" delay={0.15}>
                <p className="inline-flex rounded-full border border-[#cde6f3] bg-white/85 px-3 py-1 text-[0.72rem] font-bold uppercase tracking-[0.16em] text-[#1075bd] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                  More Opportunities
                </p>
                <h2>Similar roles in {job.department}</h2>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.25rem" }}>
                  {relatedJobs.map((related) => (
                    <Link
                      key={related.id}
                      href={`/careers/${related.id}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "1rem",
                        padding: "1rem 1.25rem",
                        borderRadius: "1rem",
                        border: "1px solid #e0ecf5",
                        background: "#f7fbfd",
                        textDecoration: "none",
                        transition: "all 0.2s",
                      }}
                    >
                      <div>
                        <p style={{ fontWeight: 700, color: "#0a1f35", fontSize: "0.9rem", margin: 0 }}>{related.title}</p>
                        <p style={{ color: "#5f89a4", fontSize: "0.78rem", margin: "0.2rem 0 0" }}>{related.location}</p>
                      </div>
                      <span style={{
                        flexShrink: 0,
                        padding: "0.2rem 0.65rem",
                        borderRadius: "999px",
                        fontSize: "0.68rem",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                        background: "#e8f4fd",
                        color: "#1075bd",
                        border: "1px solid #c4dff0",
                      }}>
                        {related.type}
                      </span>
                    </Link>
                  ))}
                </div>
              </ScrollReveal>
            )}
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

      <section className="career-detail-application-zone" id="apply">
        <div className="careers-shell career-detail-shell career-detail-application-wrap">
          <ApplicationForm job={job} />
        </div>
      </section>
    </main>
  );
}
