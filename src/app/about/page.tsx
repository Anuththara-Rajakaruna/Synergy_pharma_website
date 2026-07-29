"use client";

import { motion } from "framer-motion";
import { ScrollReveal, ScrollRevealContainer, ScrollRevealItem } from "@/components/scroll-reveal";

import { SiteHeader } from "@/components/site-header";
import { Hero } from "@/components/hero";
import { RevealOnScroll } from "@/components/reveal-on-scroll";
import { CorporateVisionMission } from "@/components/corporate-vision-mission";
import { Building2, Pill, BarChart3, Microscope, Globe } from "lucide-react";

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
    icon: Building2,
  },
  {
    title: "Synergy Pharmaceuticals",
    description:
      "Our pharmaceutical arm focused on high-quality manufacturing, trusted compliance, and scalable healthcare solutions for regional markets.",
    icon: Pill,
  },
  {
    title: "Our Business",
    description:
      "A connected healthcare business model spanning manufacturing, diagnostics, and enterprise support to create dependable long-term value.",
    icon: BarChart3,
  },
  {
    title: "Synergy Diagnostics",
    description:
      "A diagnostics-focused extension of the group, supporting faster insights, stronger care pathways, and a broader healthcare footprint.",
    icon: Microscope,
  },
  {
    title: "Global Operations",
    description:
      "Strategic supply chain and logistics network ensuring reliable delivery of healthcare solutions across regional and international markets.",
    icon: Globe,
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
        description="Synergy Pharmaceuticals combines visionary leadership, responsible manufacturing, and quality-first operations to deliver healthcare solutions that matter across the region."
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
              const Icon = card.icon;

              return (
                <ScrollRevealItem
                  className={`ecosystem-card reveal-on-scroll ${isFeatured ? "featured" : "secondary"}`.trim()}
                  key={card.title}
                >
                  {isFeatured ? (
                    <div className="ecosystem-card-featured-body">
                      <motion.span
                        className="ecosystem-card-featured-icon"
                        animate={{ rotateY: 360 }}
                        transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
                      >
                        <motion.span
                          className="ecosystem-card-icon-animated"
                          animate={{ y: [0, -8, 0] }}
                          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                        >
                          <Icon size={28} strokeWidth={2.5} aria-hidden="true" />
                        </motion.span>
                      </motion.span>
                      <h3>{card.title}</h3>
                      <p>{card.description}</p>
                    </div>
                  ) : (
                    <>
                      <motion.span
                        className="ecosystem-card-icon"
                        animate={{ rotateY: 360 }}
                        transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
                      >
                        <motion.span
                          className="ecosystem-card-icon-animated"
                          animate={{ y: [0, -8, 0] }}
                          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                        >
                          <Icon size={24} strokeWidth={2.5} aria-hidden="true" />
                        </motion.span>
                      </motion.span>
                      <h3>{card.title}</h3>
                      <p>{card.description}</p>
                    </>
                  )}
                  <div className="ecosystem-card-accent" />
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





