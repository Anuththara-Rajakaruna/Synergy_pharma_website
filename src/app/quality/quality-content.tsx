"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { SiteHeader } from "@/components/site-header";
import { Hero } from "@/components/hero";
import { Button } from "@/components/button";
import { CapabilityCard } from "@/components/capability-card";
import {
  ChartNoAxesColumn,
  CheckCircle2,
  Globe2,
  Microscope,
  Settings2,
  Share2,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { ScrollReveal, ScrollRevealContainer, ScrollRevealItem } from "@/components/scroll-reveal";

const qualityHighlights = [
  {
    title: "100%",
    subtitle: "Independent QA Systems",
    detail: "Complete digitalization",
    accent: "blue",
    icon: Share2,
  },
  {
    title: "24/7",
    subtitle: "Advanced QC Laboratories",
    detail: "Chemistry & Micro",
    accent: "teal",
    icon: Microscope,
  },
  {
    title: "Global",
    subtitle: "Compliance Standards",
    detail: "USFDA,MHRA,EU-GMP",
    accent: "blue",
    icon: Globe2,
  },
  {
    title: "Digitalization",
    subtitle: "Quality Monitoring",
    detail: "BMS,EMS,DMS,LMS,PMS,LIMS,SAP",
    accent: "teal",
    icon: ChartNoAxesColumn,
  },
];

const ecosystemCards = [
  {
    title: "Quality Management System (QMS)",
    accent: "blue",
    icon: Settings2,
    points: [
      "Integrated Risk Management protocols",
      "Self Inspection",
      "Periodic Product Quality Reviews (PQR)",
      "Robust Change Management, Deviation & CAPA systems",
    ],
  },
  {
    title: "Quality Assurance (QA)",
    accent: "teal",
    icon: ShieldCheck,
    points: [
      "End-to-end process consistency audits",
      "Stringent Documentation and Data Integrity controls",
      "Supplier Qualification & Surveillance programs",
    ],
  },
];

const compliancePrinciples = [
  {
    title: "cGMP",
    description: "Current Good Manufacturing Practices adhered across all sites.",
  },
  {
    title: "USFDA ,  MHRA , EU-GMP",
    description: "Strict global regulatory compliance.",
  },
];

const trainingItems = [
  "Training the Trainers",
  "Continuous personnel certification programs",
  "Advanced analytical method validation training",
  "Data integrity and ethics workshops",
];

export function QualityPageContent() {
  const showcaseRef = useRef<HTMLElement | null>(null);
  const highlightsRef = useRef<HTMLElement | null>(null);
  const ecosystemRef = useRef<HTMLElement | null>(null);
  const capabilitiesRef = useRef<HTMLElement | null>(null);
  const complianceRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const sections = [showcaseRef, highlightsRef, ecosystemRef, capabilitiesRef, complianceRef];

    if (sections.every((ref) => !ref.current)) {
      return;
    }

    let rafId = 0;

    const updateSectionZooms = () => {
      rafId = 0;

      sections.forEach((ref) => {
        const section = ref.current;

        if (!section) {
          return;
        }

        const rect = section.getBoundingClientRect();
        const viewportHeight = window.innerHeight || 1;
        const startLine = viewportHeight * 0.88;
        const endLine = viewportHeight * 0.1;
        const rawProgress = (startLine - rect.top) / (startLine - endLine);
        const progress = Math.min(Math.max(rawProgress, 0), 1);

        section.style.setProperty("--quality-section-progress", progress.toFixed(4));
      });
    };

    const onScroll = () => {
      if (rafId) {
        return;
      }

      rafId = window.requestAnimationFrame(updateSectionZooms);
    };

    updateSectionZooms();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);

      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, []);

  return (
    <main className="qualityPage">
      <SiteHeader />

      <Hero
        eyebrow="Global Standards"
        heading="Quality Without Compromise"
        description="Setting the gold standard in pharmaceutical safety and regulatory excellence through unwavering precision and clinical integrity."
        className="quality-hero"
      />

      <section ref={showcaseRef} className="showcaseSection qualityZoomSection">
        <div className="showcaseContainer qualityZoomSurface">
          <div className="showcaseVisual">
            <div className="showcaseRadialGradient" />
            <div className="showcaseImageFrame">
              <Image
                src="/Quality_Philosophy.jpg"
                alt="Quality specialist in a pharmaceutical setting"
                width={520}
                height={640}
                className="showcaseImage"
              />
            </div>
          </div>

          <ScrollReveal className="showcaseContent" delay={0.2}>
            <p className="showcase-eyebrow">Quality Philosophy</p>
            <h2>
              From Design to Delivery, Quality
              is Right First Time and Every
              Time.
            </h2>
            <p className="showcase-subtitle">
              Our philosophy is embedded in every molecular structure we develop. We don&apos;t
              just inspect for quality; we engineer it into every phase of the pharmaceutical
              lifecycle.
            </p>
            <Button>Explore Quality Framework</Button>
          </ScrollReveal>
        </div>
      </section>

      <section ref={highlightsRef} className="highlightsSection qualityZoomSection">
        <div className="highlights-container qualityZoomSurface">
          <ScrollReveal className="highlights-header">
            <p className="highlights-eyebrow">Key Metrics</p>
            <h2>Quality Excellence Standards</h2>
            <p className="highlights-subtitle">
              Our commitment to quality is measured through rigorous metrics and continuous improvement initiatives.
            </p>
          </ScrollReveal>

          <ScrollRevealContainer staggerDelay={0.1} className="highlightsGrid">
            {qualityHighlights.map((item) => {
              const Icon = item.icon;

              return (
                <ScrollRevealItem
                  key={item.title}
                  className={`highlightStatCard accent${item.accent[0].toUpperCase()}${item.accent.slice(1)}`}
                >
                  <motion.div
                    className="facility-capabilityIcon"
                    animate={{ rotateY: 360 }}
                    transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
                  >
                    <motion.div
                      className="facility-capabilityAnimatedIcon"
                      animate={{ y: [0, -8, 0] }}
                      transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                    >
                      <Icon size={40} strokeWidth={2} />
                    </motion.div>
                  </motion.div>
                  <div className="highlightStatContent">
                    <h3>{item.title}</h3>
                    <p>{item.subtitle}</p>
                    <span className="highlightStatDivider" aria-hidden="true" />
                    <small>{item.detail}</small>
                  </div>
                </ScrollRevealItem>
              );
            })}
          </ScrollRevealContainer>
        </div>
      </section>

      <section ref={ecosystemRef} className="ecosystemSection qualityZoomSection">
        <div className="ecosystemContainer qualityZoomSurface">
          <ScrollReveal className="ecosystem-header">
            <p className="ecosystem-eyebrow">Management Framework</p>
            <h2>Quality Management Ecosystem</h2>
            <p className="ecosystem-subtitle">
              Our QMS is a living framework that evolves with global regulatory changes and
              scientific breakthroughs.
            </p>
          </ScrollReveal>

          <ScrollRevealContainer staggerDelay={0.1} className="ecosystemGrid">
            {ecosystemCards.map((card) => {
              const Icon = card.icon;

              return (
                <ScrollRevealItem
                  key={card.title}
                  className={`ecosystemCard accent${card.accent[0].toUpperCase()}${card.accent.slice(1)}`}
                >
                  <div className="ecosystemCardHeader">
                    <div className="corporate-value-icon-wrap">
                      <div className="corporate-value-blob-1" />
                      <div className="corporate-value-blob-2" />
                      <div className="corporate-value-glass">
                        <Icon size={18} strokeWidth={1.8} />
                      </div>
                    </div>
                    <h3>{card.title}</h3>
                  </div>

                  <ul className="ecosystemList">
                    {card.points.map((point) => (
                      <li key={point}>
                        <CheckCircle2 size={18} strokeWidth={2.1} />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </ScrollRevealItem>
              );
            })}
          </ScrollRevealContainer>
        </div>
      </section>

      <section className="laboratoryServicesSection qualityZoomSection">
        <div className="laboratory-container qualityZoomSurface">
          <ScrollReveal className="quality-header">
            <p className="quality-eyebrow">Laboratory Services</p>
            <h2>Quality Capability Centers</h2>
            <p className="quality-subtitle">
              State-of-the-art laboratory facilities supporting comprehensive quality control and analytical testing.
            </p>
          </ScrollReveal>

          <ScrollRevealContainer staggerDelay={0.12} className="laboratoryCardsGrid">
            {[
              {
                title: "Chemical Lab",
                description: "Equipped with advanced HPLC, GC, and MS technologies for comprehensive chemical analysis and reliable stability testing across pharmaceutical products.",
                label: "Instrumental Excellence",
                accent: "blue",
                image: "/Quality/Chem.jpg",
                imageAlt: "Chemistry instruments and laboratory glassware",
              },
              {
                title: "Microbiology Lab",
                description: "Specialized microbiological testing, including sterility testing, microbial limits testing, and environmental monitoring in controlled environments.",
                label: "Biological Integrity",
                accent: "teal",
                image: "/Quality/Micro.jpg",
                imageAlt: "Microbiology laboratory environment",
              },
              {
                title: "Digital Quality Systems",
                description: "Connected digital operations through BMS, EMS, DMS, LMS, PMS, LIMS, and SAP for smarter workflows, real-time visibility, and efficient decision-making.",
                label: "Automated Precision",
                accent: "teal",
                image: "/Quality/Digital.jpg",
                imageAlt: "Digital quality systems visualization",
              },
            ].map((card) => (
              <ScrollRevealItem key={card.title}>
                <CapabilityCard
                  title={card.title}
                  description={card.description}
                  label={card.label}
                  image={card.image}
                  imageAlt={card.imageAlt}
                  accent={card.accent as "blue" | "teal"}
                />
              </ScrollRevealItem>
            ))}
          </ScrollRevealContainer>
        </div>
      </section>

      <section ref={complianceRef} className="complianceFrameworkSection qualityZoomSection">
        <div className="compliance-container qualityZoomSurface">
          <ScrollReveal className="compliance-header">
            <p className="compliance-eyebrow">Regulatory Standards</p>
            <h2>Global Compliance Framework</h2>
            <p className="compliance-subtitle">
              We operate under a unified global compliance strategy that meets and exceeds the
              world&apos;s most rigorous health authority mandates.
            </p>
          </ScrollReveal>

          <ScrollRevealContainer staggerDelay={0.12} className="complianceFrameworkGrid">
            <ScrollRevealItem className="complianceFrameworkContent">
              <div className="compliancePrinciples">
                {compliancePrinciples.map((item) => (
                  <article key={item.title} className="compliancePrinciple">
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
                  </article>
                ))}
              </div>
            </ScrollRevealItem>

            <ScrollRevealItem className="trainingCard">
              <div className="trainingHeader">
                <div className="corporate-value-icon-wrap">
                  <div className="corporate-value-blob-1" />
                  <div className="corporate-value-blob-2" />
                  <div className="corporate-value-glass">
                    <ShieldCheck size={18} strokeWidth={1.8} />
                  </div>
                </div>
                <h3>Training & Qualification</h3>
              </div>

              <div className="trainingList">
                {trainingItems.map((item) => (
                  <div key={item} className="trainingItem">
                    <CheckCircle2 size={24} strokeWidth={2.1} className="trainingIcon" />
                    <p>{item}</p>
                  </div>
                ))}
              </div>
            </ScrollRevealItem>
          </ScrollRevealContainer>
        </div>
      </section>
    </main>
  );
}
