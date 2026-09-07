import type { Metadata } from "next";
import { Suspense } from "react";
import { RevealOnScroll } from "@/components/reveal-on-scroll";
import { ScrollReveal } from "@/components/scroll-reveal";
import { SiteHeader } from "@/components/site-header";
import { Hero } from "@/components/hero";
import { CareersListing } from "@/components/careers/careers-listing";
import { TalentPoolForm } from "@/components/careers/talent-pool-form";
import { getPublishedJobs } from "@/lib/careers";
import { buildMetadata } from "@/lib/metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = buildMetadata({
  title: "Careers | Synergy Pharmaceutical Corporation",
  description:
    "Join Synergy Pharmaceutical Corporation and advance human health through precision pharmaceutical manufacturing. Explore open roles across Quality, R&D, Manufacturing, and more.",
  path: "/careers",
});

const benefits = [
  {
    icon: (
      <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 00-.491 6.347A48.62 48.62 0 0112 20.904a48.62 48.62 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.636 50.636 0 00-2.658-.813A59.906 59.906 0 0112 3.493a59.903 59.903 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
      </svg>
    ),
    title: "Growth & Learning",
    description: "Structured development programmes, professional certifications, and access to industry conferences to accelerate your career.",
  },
  {
    icon: (
      <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
      </svg>
    ),
    title: "Meaningful Work",
    description: "Every role at Synergy Pharma contributes directly to improving patient health across Sri Lanka and global markets.",
  },
  {
    icon: (
      <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
      </svg>
    ),
    title: "Collaborative Culture",
    description: "Work alongside multidisciplinary teams of scientists, pharmacists, engineers, and quality experts who challenge each other to excel.",
  },
  {
    icon: (
      <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    title: "Competitive Package",
    description: "Market-leading salary, comprehensive health coverage, performance bonuses, and retirement benefits that reward your contribution.",
  },
];

const hiringSteps = [
  { number: "01", title: "Apply Online", description: "Submit your CV and cover letter through our careers portal in minutes." },
  { number: "02", title: "CV Screening", description: "Our HR team reviews every application and responds within 5–7 business days." },
  { number: "03", title: "Interviews", description: "Selected candidates meet with the hiring manager and relevant team members." },
  { number: "04", title: "Offer & Onboarding", description: "Successful candidates receive a formal offer and a structured onboarding programme." },
];

export default async function CareersPage() {
  const jobs = await getPublishedJobs();

  const departmentCount = new Set(jobs.map((j) => j.department)).size;
  const locationCount = new Set(jobs.map((j) => j.location)).size;

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

      {/* Stats bar */}
      <section className="reveal-on-scroll" style={{ padding: "2.5rem 0 2rem" }}>
        <div className="careers-shell">
          <div className="careers-stats-grid" style={{
            background: "rgba(255,255,255,0.7)",
            backdropFilter: "blur(16px)",
            borderRadius: "1.5rem",
            border: "1px solid rgba(255,255,255,0.8)",
            padding: "1.5rem",
            boxShadow: "0 16px 40px rgba(17,58,83,0.08)",
          }}>
            {[
              { value: jobs.length, label: "Open Roles" },
              { value: departmentCount, label: departmentCount === 1 ? "Department" : "Departments" },
              { value: locationCount, label: locationCount === 1 ? "Location" : "Locations" },
            ].map((stat) => (
              <div key={stat.label} style={{ textAlign: "center", padding: "0.5rem 0" }}>
                <p style={{ fontSize: "clamp(1.8rem, 4vw, 2.6rem)", fontWeight: 900, color: "#055f7c", lineHeight: 1, margin: 0 }}>
                  {stat.value}
                </p>
                <p style={{ fontSize: "0.78rem", fontWeight: 600, color: "#6b8fa8", textTransform: "uppercase", letterSpacing: "0.12em", marginTop: "0.35rem" }}>
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="careers-jobs-section reveal-on-scroll" id="open-positions">
        <div>
          <ScrollReveal className="careers-header">
            <p className="careers-eyebrow">Open Positions</p>
            <h2>Explore current opportunities across the business.</h2>
            <p className="careers-subtitle">Search by role title, filter by department, and move into a detailed application flow.</p>
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
            <CareersListing initialJobs={jobs} />
          </Suspense>
        </div>
      </section>

      {/* Benefits / Why Join Us */}
      <section className="careers-benefits-section reveal-on-scroll">
        <div className="careers-shell">
          <ScrollReveal className="careers-header">
            <p className="careers-eyebrow">Why Join Us</p>
            <h2>More than a job — a mission-driven career.</h2>
            <p className="careers-subtitle">We invest in our people because they are the foundation of our quality and our growth.</p>
          </ScrollReveal>
          <div className="careers-benefits-grid">
            {benefits.map((benefit) => (
              <ScrollReveal key={benefit.title} className="career-benefit-card">
                <div style={{
                  width: "2.75rem",
                  height: "2.75rem",
                  borderRadius: "0.875rem",
                  background: "linear-gradient(135deg, #e8f4fd, #d0eaf8)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#1075bd",
                  marginBottom: "1rem",
                }}>
                  {benefit.icon}
                </div>
                <h3>{benefit.title}</h3>
                <p>{benefit.description}</p>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* Hiring Process Timeline */}
      <section className="careers-hiring-section reveal-on-scroll">
        <div className="careers-shell">
          <ScrollReveal className="careers-header">
            <p className="careers-eyebrow">Hiring Process</p>
            <h2>What to expect when you apply.</h2>
            <p className="careers-subtitle">We keep our process transparent, respectful of your time, and focused on finding the right mutual fit.</p>
          </ScrollReveal>

          <div className="careers-hiring-grid">
            {hiringSteps.map((step, index) => (
              <ScrollReveal
                key={step.number}
                delay={index * 0.08}
                style={{
                  background: "rgba(255,255,255,0.85)",
                  backdropFilter: "blur(12px)",
                  borderRadius: "1.5rem",
                  border: "1px solid rgba(200,225,240,0.7)",
                  padding: "1.75rem 1.5rem",
                  boxShadow: "0 12px 30px rgba(17,58,83,0.07)",
                  position: "relative",
                }}
              >
                <div style={{
                  fontSize: "2.5rem",
                  fontWeight: 900,
                  color: "rgba(16,117,189,0.12)",
                  lineHeight: 1,
                  marginBottom: "0.75rem",
                  fontVariantNumeric: "tabular-nums",
                }}>
                  {step.number}
                </div>
                <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "#0a1f35", marginBottom: "0.5rem" }}>{step.title}</h3>
                <p style={{ fontSize: "0.875rem", color: "#4d6578", lineHeight: 1.6, margin: 0 }}>{step.description}</p>

                {index < hiringSteps.length - 1 && (
                  <div style={{
                    position: "absolute",
                    right: "-0.85rem",
                    top: "50%",
                    transform: "translateY(-50%)",
                    zIndex: 1,
                    color: "#9db8c8",
                  }}>
                    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </div>
                )}
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      <section className="careers-talent-section reveal-on-scroll" id="talent-pool">
        <div className="careers-shell careers-talent-layout">
          <ScrollReveal className="careers-header careers-talent-copy">
            <p className="careers-eyebrow">Talent Pool</p>
            <h2>Share your CV even if the right opening is not live yet.</h2>
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
