"use client";

import { ScrollReveal, ScrollRevealContainer, ScrollRevealItem } from "@/components/scroll-reveal";

import { SiteHeader } from "@/components/site-header";
import { Hero } from "@/components/hero";
import { RevealOnScroll } from "@/components/reveal-on-scroll";
import { CorporateVisionMission } from "@/components/corporate-vision-mission";

const leaders = [
  { role: "Chairman", name: "Mr.Ravi Wijeratne" },
  { role: "Managing Director", name: "Dr.Rohan Lalith Wijesundara" },
  { role: "Director", name: "Mr.Shahen Wijeratne" },
  { role: "Director", name: "Mr.Rahul Wijeratne" },
  { role: "Director", name: "Mr.Rishi Wijeratne" },
];

const aboutCards = [
  {
    title: "Mother Company Rank Holdings",
    description:
      "The parent group that provides strategic direction, long-term investment confidence, and diversified business strength across the Synergy ecosystem.",
    cta: "Explore the group",
    icon: "🏢",
    color: "#39b68c",
  },
  {
    title: "Synergy Pharmaceuticals",
    description:
      "Our pharmaceutical arm focused on high-quality manufacturing, trusted compliance, and scalable healthcare solutions for regional markets.",
    cta: "Learn more",
    icon: "💊",
    color: "#1e9f78",
  },
  {
    title: "Our Business",
    description:
      "A connected healthcare business model spanning manufacturing, diagnostics, and enterprise support to create dependable long-term value.",
    cta: "Learn more",
    icon: "📊",
    color: "#6d4cff",
  },
  {
    title: "Synergy Diagnostics",
    description:
      "A diagnostics-focused extension of the group, supporting faster insights, stronger care pathways, and a broader healthcare footprint.",
    cta: "Learn more",
    icon: "🔬",
    color: "#1366dc",
  },
  {
    title: "Global Operations",
    description:
      "Strategic supply chain and logistics network ensuring reliable delivery of healthcare solutions across regional and international markets.",
    cta: "Learn more",
    icon: "🌍",
    color: "#ff7f1f",
  },
];

export default function AboutPage() {
  return (
    <main className="about-page">
      <SiteHeader />
      <RevealOnScroll />

      <Hero
        eyebrow="About Synergy"
        heading="Trust Built. Precision Delivered."
        description="Synergy Pharmaceutical combines visionary leadership, responsible manufacturing, and quality-first operations to deliver healthcare solutions that matter across the region."
        className="about-hero-section"
      />

      <section className="leadership-section reveal-on-scroll" id="leadership">
        <div className="leadership-container">
          <ScrollReveal className="leadership-header">
            <p className="leadership-eyebrow">Organization</p>
            <h2>Leadership &amp; Vision</h2>
            <p className="leadership-subtitle">
              Our strategic leadership team drives long-term innovation, governance, and sustainable
              growth across all pharmaceutical operations.
            </p>
          </ScrollReveal>

          <ScrollRevealContainer staggerDelay={0.12} className="leaders">
            {leaders.map((leader) => (
              <ScrollRevealItem className="leader reveal-on-scroll" key={`${leader.role}-${leader.name}`}>
                <div className="avatar" />
                <p className="leader-role">{leader.role}</p>
                <h3>{leader.name}</h3>
              </ScrollRevealItem>
            ))}
          </ScrollRevealContainer>
        </div>
      </section>

      <section className="ecosystem-section reveal-on-scroll" id="about-businesses">
        <div className="ecosystem-container">
          <ScrollReveal className="corporation-header">
            <p className="corporation-eyebrow">Our Connected Businesses</p>
            <h2>Connected businesses shaping the Synergy story.</h2>
            <p className="corporation-subtitle">
              "A diversified portfolio of healthcare and pharmaceutical operations driving innovation and accessibility across the region."
            </p>
          </ScrollReveal>

          <ScrollRevealContainer staggerDelay={0.1} className="ecosystem-cards-grid">
            {aboutCards.map((card, index) => {
              const isFeatured = index === 0;

              return (
                <ScrollRevealItem
                  className={`ecosystem-card reveal-on-scroll ${isFeatured ? "featured" : "secondary"}`.trim()}
                  key={card.title}
                  style={isFeatured ? {
                    backgroundImage: `linear-gradient(135deg, rgba(5, 31, 66, 0.86) 0%, rgba(13, 58, 102, 0.82) 100%)`,
                  } : undefined}
                >
                  {isFeatured ? (
                    <div className="ecosystem-card-featured-body">
                      <span className="ecosystem-card-featured-icon" style={{ background: `${card.color}22`, color: card.color }}>
                        {card.icon}
                      </span>
                      <h3>{card.title}</h3>
                      <p>{card.description}</p>
                      <span className="ecosystem-card-featured-cta">
                        {card.cta}
                        <span aria-hidden="true">→</span>
                      </span>
                    </div>
                  ) : (
                    <>
                      <span className="ecosystem-card-icon" style={{ background: `${card.color}18`, color: card.color }}>
                        {card.icon}
                      </span>
                      <h3>{card.title}</h3>
                      <p>{card.description}</p>
                      <span className="ecosystem-card-cta" style={{ color: card.color }}>
                        {card.cta}
                        <span aria-hidden="true">→</span>
                      </span>
                    </>
                  )}
                </ScrollRevealItem>
              );
            })}
          </ScrollRevealContainer>
        </div>
      </section>

      <CorporateVisionMission className="corporate-values-about" />
    </main>
  );
}





