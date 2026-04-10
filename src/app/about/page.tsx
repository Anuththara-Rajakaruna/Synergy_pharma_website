"use client";

import Image from "next/image";
import { ScrollReveal, ScrollRevealContainer, ScrollRevealItem } from "@/components/scroll-reveal";

import { SiteHeader } from "@/components/site-header";
import { Hero } from "@/components/hero";
import { RevealOnScroll } from "@/components/reveal-on-scroll";

const leaders = [
  { role: "Chairman", name: "Mr.Ravi Wijeratne" },
  { role: "Managing Director", name: "Dr.Rohan Lalith Wijesundara" },
  { role: "Director", name: "Mr.Rishi Wijeratne" },
  { role: "Director", name: "Mr.Rahul Wijeratne" },
];

const aboutCards = [
  {
    title: "Mother Company Rank Holdings",
    description:
      "The parent group that provides strategic direction, long-term investment confidence, and diversified business strength across the Synergy ecosystem.",
    cta: "Explore the group",
    image: "/rank1.png",
  },
  {
    title: "Synergy Pharmaceuticals",
    description:
      "Our pharmaceutical arm focused on high-quality manufacturing, trusted compliance, and scalable healthcare solutions for regional markets.",
    cta: "View operations",
    image: "/company.png",
  },
  {
    title: "Our Business",
    description:
      "A connected healthcare business model spanning manufacturing, diagnostics, and enterprise support to create dependable long-term value.",
    cta: "See our model",
    image: "/lab.png",
  },
  {
    title: "Synergy Diagnostics",
    description:
      "A diagnostics-focused extension of the group, supporting faster insights, stronger care pathways, and a broader healthcare footprint.",
    cta: "Discover diagnostics",
    image: "/diagonastic.png",
  },
  {
    title: "Global Operations",
    description:
      "Strategic supply chain and logistics network ensuring reliable delivery of healthcare solutions across regional and international markets.",
    cta: "Learn more",
    image: "/operations.png",
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
          <ScrollReveal className="ecosystem-header">
            <p className="ecosystem-eyebrow">Our Ecosystem</p>
            <h2>Connected businesses shaping the Synergy story.</h2>
            <p className="ecosystem-subtitle">
              A diversified portfolio of healthcare and pharmaceutical operations driving innovation and accessibility across the region.
            </p>
          </ScrollReveal>

          <ScrollRevealContainer staggerDelay={0.1} className="ecosystem-cards-grid">
            {aboutCards.map((card, index) => {
              const isFeatured = index === 0;
              const iconMap: { [key: string]: string } = {
                "Mother Company Rank Holdings": "🏢",
                "Synergy Pharmaceuticals": "💊",
                "Our Business": "📊",
                "Synergy Diagnostics": "🔬",
                "Global Operations": "🌍",
              };

              return (
                <ScrollRevealItem
                  className={`ecosystem-card reveal-on-scroll ${isFeatured ? "featured" : "secondary"}`.trim()}
                  key={card.title}
                >
                  {isFeatured && (
                    <div>
                      <h3>{card.title}</h3>
                      <p>{card.description}</p>
                      <span className="ecosystem-card-featured-cta">
                        {card.cta}
                        <span aria-hidden="true">→</span>
                      </span>
                    </div>
                  )}
                  {!isFeatured && (
                    <>
                      <h3>
                        <span className="ecosystem-card-icon">{iconMap[card.title] || "✓"}</span>
                        {card.title}
                      </h3>
                      <p>{card.description}</p>
                    </>
                  )}
                </ScrollRevealItem>
              );
            })}
          </ScrollRevealContainer>
        </div>
      </section>

      <ScrollReveal
        className="container section mission-band reveal-on-scroll mission-animate"
      >
        <div className="vision-panel about-vision-panel">
          <p className="eyebrow">Vision</p>
          <blockquote>
            &ldquo;Becoming the beacon of healthcare in the region through sustainable, global-standard medicine.&rdquo;
          </blockquote>
        </div>
        <div className="mission-panel">
          <p className="eyebrow">Our Mission</p>
          <ScrollRevealContainer staggerDelay={0.1} className="mission-grid">
            <article className="mission-item">
              <ScrollRevealItem>
                <h3>Accessibility</h3>
                <p>Deliver high-quality affordable medicine to global markets.</p>
              </ScrollRevealItem>
            </article>
            <article className="mission-item">
              <ScrollRevealItem>
                <h3>Quality</h3>
                <p>Maintain rigorous GMP compliance and transparent processes.</p>
              </ScrollRevealItem>
            </article>
            <article className="mission-item">
              <ScrollRevealItem>
                <h3>Innovation</h3>
                <p>Invest in advanced manufacturing and research partnerships.</p>
              </ScrollRevealItem>
            </article>
            <article className="mission-item">
              <ScrollRevealItem>
                <h3>Responsibility</h3>
                <p>Build sustainable operations that uplift communities and care delivery.</p>
              </ScrollRevealItem>
            </article>
          </ScrollRevealContainer>
        </div>
      </ScrollReveal>
    </main>
  );
}





