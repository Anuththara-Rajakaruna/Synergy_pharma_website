import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Hero } from "@/components/hero";
import { RevealOnScroll } from "@/components/reveal-on-scroll";
import { ScrollReveal } from "@/components/scroll-reveal";
import { SiteHeader } from "@/components/site-header";
import { ApplicationForm } from "@/components/careers/application-form";
import { deadlineLabel, formatDate } from "@/lib/careers/format";
import { getOpenJob, listRelatedOpenJobs } from "@/lib/careers/server/jobs";
import { serializeJsonLd } from "@/lib/json-ld";
import { logger } from "@/lib/logger";
import { buildMetadata } from "@/lib/metadata";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import type { Job, JobType } from "@/types/careers";
import "@/components/careers/careers-public.css";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

// generateMetadata and the page share one database lookup per request. Only open jobs are
// returned, so drafts, closed, expired and archived postings all 404.
const getJob = cache(getOpenJob);

const EMPLOYMENT_TYPES: Record<JobType, string> = {
  "Full-time": "FULL_TIME",
  "Part-time": "PART_TIME",
  Contract: "CONTRACTOR",
  Temporary: "TEMPORARY",
  Internship: "INTERN",
};

const badgeClass =
  "inline-flex rounded-full border border-[#cde6f3] bg-white/85 px-3 py-1 text-[0.72rem] font-bold uppercase tracking-[0.16em] text-[#1075bd] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]";

function summarize(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

// Paragraphs are separated by blank lines; single line breaks inside a paragraph are kept.
function descriptionParagraphs(text: string): string[] {
  return text
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// schema.org JobPosting.description accepts HTML; every job-provided value is escaped.
function jobPostingDescription(job: Job): string {
  const section = (heading: string, items: string[]) =>
    items.length > 0 ? `<h3>${heading}</h3><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "";
  return [
    ...descriptionParagraphs(job.description).map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`),
    section("Responsibilities", job.responsibilities),
    section("Requirements", job.requirements),
    section("Qualifications", job.qualifications),
    section("Benefits", job.benefits),
  ].join("");
}

function jobPostingJsonLd(job: Job) {
  return {
    "@context": "https://schema.org/",
    "@type": "JobPosting",
    title: job.title,
    description: jobPostingDescription(job),
    identifier: { "@type": "PropertyValue", name: SITE_NAME, value: job.id },
    datePosted: job.publishedAt ?? job.updatedAt,
    validThrough: job.applicationDeadline ?? undefined,
    employmentType: EMPLOYMENT_TYPES[job.type],
    directApply: true,
    url: `${SITE_URL}/careers/${job.id}`,
    hiringOrganization: {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}/logo.png`,
    },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: job.location,
        addressCountry: "LK",
      },
    },
    experienceRequirements: job.experience || undefined,
    educationRequirements: job.qualifications.length > 0 ? job.qualifications.join("; ") : undefined,
    jobBenefits: job.benefits.length > 0 ? job.benefits.join("; ") : undefined,
  };
}

async function loadRelatedJobs(job: Job): Promise<Job[]> {
  try {
    return await listRelatedOpenJobs(job.department, job.id, 3);
  } catch (err) {
    // Related roles are optional; the posting itself already loaded.
    logger.warn("careers.related_jobs_unavailable", { err });
    return [];
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return { title: `Job Not Found | ${SITE_NAME}`, robots: { index: false, follow: false } };

  return buildMetadata({
    title: `${job.title} | Careers at ${SITE_NAME}`,
    description: summarize(job.description, 155),
    path: `/careers/${job.id}`,
  });
}

export default async function CareerDetailPage({ params }: PageProps) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) notFound();

  const relatedJobs = await loadRelatedJobs(job);
  const deadline = deadlineLabel(job.applicationDeadline, new Date());
  const paragraphs = descriptionParagraphs(job.description);
  const listPanels = [
    { badge: "Responsibilities", heading: "What you'll lead", items: job.responsibilities },
    { badge: "Requirements", heading: "What we're looking for", items: job.requirements },
    { badge: "Qualifications", heading: "Qualifications", items: job.qualifications },
    { badge: "Benefits", heading: "What we offer", items: job.benefits },
  ].filter((panel) => panel.items.length > 0);

  return (
    <main className="career-detail-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jobPostingJsonLd(job)) }} />
      <SiteHeader />
      <RevealOnScroll />

      <Hero
        eyebrow={job.department}
        heading={job.title}
        description={summarize(job.description, 220)}
        className="careers-hero-section careers-detail-hero"
        breadcrumb={
          <nav aria-label="Breadcrumb" className="careers-hero-breadcrumb">
            <ol>
              <li>
                <Link href="/">Home</Link>
              </li>
              <li aria-hidden="true">/</li>
              <li>
                <Link href="/careers">Careers</Link>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page">{job.title}</li>
            </ol>
          </nav>
        }
        actions={
          <div className="careers-hero-actions">
            <a href="#apply" className="button-link">Apply Now</a>
            <Link href="/careers#open-positions" className="button-link-secondary">View All Roles</Link>
          </div>
        }
      />

      <section className="career-detail-content reveal-on-scroll">
        <div className="careers-shell career-detail-shell career-detail-reference-layout">
          <div className="career-detail-main-column">
            <ScrollReveal className="career-detail-panel career-detail-panel-soft">
              <p className={badgeClass}>Role Overview</p>
              <h2>Job Description</h2>
              <div className="careers-detail-description">
                {paragraphs.map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </div>
            </ScrollReveal>

            {listPanels.map((panel, panelIndex) => (
              <ScrollReveal key={panel.badge} className="career-detail-panel career-detail-panel-soft" delay={0.05 * (panelIndex + 1)}>
                <p className={badgeClass}>{panel.badge}</p>
                <h2>{panel.heading}</h2>
                <ul className="career-detail-list">
                  {panel.items.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </ScrollReveal>
            ))}

            {relatedJobs.length > 0 && (
              <ScrollReveal className="career-detail-panel career-detail-panel-soft" delay={0.05 * (listPanels.length + 1)}>
                <p className={badgeClass}>More Opportunities</p>
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
                      <div style={{ minWidth: 0 }}>
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

          <aside className="career-detail-summary-column" aria-label="Position summary">
            <ScrollReveal className="career-detail-summary-card" delay={0.12}>
              <div className="career-detail-side-card career-detail-side-card-primary">
                <p className={badgeClass}>Position Summary</p>
                <h3>{job.title}</h3>
                <div className="career-sticky-meta">
                  <span>{job.department}</span>
                  <span>{job.location}</span>
                  <span>{job.type}</span>
                </div>
                {job.experience || (deadline && job.applicationDeadline) ? (
                  <dl className="careers-summary-facts">
                    {job.experience ? (
                      <div>
                        <dt>Experience</dt>
                        <dd>{job.experience}</dd>
                      </div>
                    ) : null}
                    {deadline && job.applicationDeadline ? (
                      <div className={deadline.urgent ? "careers-fact-urgent" : undefined}>
                        <dt>Apply by</dt>
                        <dd>
                          <time dateTime={job.applicationDeadline}>{formatDate(job.applicationDeadline)}</time>
                          {deadline.urgent ? <span className="careers-summary-urgent-note">Closing soon</span> : null}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                ) : null}
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
