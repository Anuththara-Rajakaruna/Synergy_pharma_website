"use client";

import Image from "next/image";
import { SiteHeader } from "@/components/site-header";
import { Hero } from "@/components/hero";
import { Button } from "@/components/button";
import { CapabilityCard } from "@/components/capability-card";
import {
  ChartNoAxesColumn,
  CheckCircle2,
  FlaskConical,
  Globe2,
  Microscope,
  Settings2,
  Share2,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useRef } from "react";

const qualityHighlights = [
  {
    title: "100%",
    subtitle: "Independent QA Systems",
    detail: "Autonomous Oversight",
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
    detail: "CGMP, USP, PH.EUR",
    accent: "blue",
    icon: Globe2,
  },
  {
    title: "Digital",
    subtitle: "Quality Monitoring",
    detail: "EDMS & LMS Integration",
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
      "Periodic Product Quality Reviews (PQR)",
      "Robust CAPA (Corrective and Preventive Action) systems",
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

const qualityCapabilityCards = [
  {
    title: "Chemistry Section",
    description:
      "Equipped with HPLC, GC, and MS for precise molecular characterization and stability testing.",
    label: "Instrumental Excellence",
    accent: "blue",
    icon: FlaskConical,
    image: "/Chemistry.png",
    imageAlt: "Chemistry instruments and laboratory glassware",
  },
  {
    title: "Microbiology Section",
    description:
      "Specialized sterility testing, microbial limits, and environmental monitoring in Class A environments.",
    label: "Biological Integrity",
    accent: "teal",
    icon: Microscope,
    image: "/Microbiology.png",
    imageAlt: "Microbiology laboratory environment",
  },
  {
    title: "Digital Quality Systems",
    description:
      "Paperless documentation via eDMS, real-time LMS training tracking, and AI-driven automation.",
    label: "Automated Precision",
    accent: "teal",
    icon: ChartNoAxesColumn,
    image: "/Digital_Quality.png",
    imageAlt: "Digital quality systems visualization",
  },
];

const compliancePrinciples = [
  {
    title: "cGMP",
    description: "Current Good Manufacturing Practices adhered across all sites.",
  },
  {
    title: "USP / Ph.Eur",
    description: "Strict pharmacopoeial compliance for all chemical entities.",
  },
];

const trainingItems = [
  "Continuous personnel certification programs",
  "Advanced analytical method validation training",
  "Data integrity and ethics workshops",
];

export default function QualityPage() {
  const showcaseRef = useRef<HTMLElement | null>(null);
  const highlightsRef = useRef<HTMLElement | null>(null);
  const ecosystemRef = useRef<HTMLElement | null>(null);
  const capabilitiesRef = useRef<HTMLElement | null>(null);
  const complianceRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const sections = [
      showcaseRef,
      highlightsRef,
      ecosystemRef,
      capabilitiesRef,
      complianceRef,
    ];

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
            <div className="showcaseWaveBackground" aria-hidden="true" />
            <div className="showcaseRadialGradient" />
            <div className="showcaseImageFrame">
              <Image
                src="/quality-doctor.png"
                alt="Quality specialist in a pharmaceutical setting"
                width={520}
                height={640}
                className="showcaseImage"
              />
            </div>
          </div>

          <div className="showcaseContent">
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
          </div>
        </div>
      </section>

      <section ref={highlightsRef} className="highlightsSection qualityZoomSection">
        <div className="highlights-container qualityZoomSurface">
          <div className="highlights-header">
            <p className="highlights-eyebrow">Key Metrics</p>
            <h2>Quality Excellence Standards</h2>
            <p className="highlights-subtitle">
              Our commitment to quality is measured through rigorous metrics and continuous improvement initiatives.
            </p>
          </div>

          <div className="highlightsGrid">
            {qualityHighlights.map((item) => {
              const Icon = item.icon;

              return (
                <article
                  key={item.title}
                  className={`highlightStatCard accent${item.accent[0].toUpperCase()}${item.accent.slice(1)}`}
                >
                  <div className="highlightStatIcon">
                    <Icon size={28} strokeWidth={2.2} />
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.subtitle}</p>
                  <small>{item.detail}</small>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section ref={ecosystemRef} className="ecosystemSection qualityZoomSection">
        <div className="ecosystemContainer qualityZoomSurface">
          <div className="ecosystem-header">
            <p className="ecosystem-eyebrow">Management Framework</p>
            <h2>Quality Management Ecosystem</h2>
            <p className="ecosystem-subtitle">
              Our QMS is a living framework that evolves with global regulatory changes and
              scientific breakthroughs.
            </p>
          </div>

          <div className="ecosystemGrid">
            {ecosystemCards.map((card) => {
              const Icon = card.icon;

              return (
                <article
                  key={card.title}
                  className={`ecosystemCard accent${card.accent[0].toUpperCase()}${card.accent.slice(1)}`}
                >
                  <div className="ecosystemCardHeader">
                    <div className="ecosystemCardIcon">
                      <Icon size={24} strokeWidth={2.2} />
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
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="laboratoryServicesSection qualityZoomSection">
        <div className="laboratory-container qualityZoomSurface">
          <div className="quality-header">
            <p className="quality-eyebrow">Laboratory Services</p>
            <h2>Quality Capability Centers</h2>
            <p className="quality-subtitle">
              State-of-the-art laboratory facilities supporting comprehensive quality control and analytical testing.
            </p>
          </div>

          <div className="laboratoryCardsGrid">
            {[
              {
                title: "Chemistry Section",
                description: "Equipped with HPLC, GC, and MS for precise molecular characterization and stability testing.",
                label: "Instrumental Excellence",
                accent: "blue",
                image: "/Chemistry.png",
                imageAlt: "Chemistry instruments and laboratory glassware",
              },
              {
                title: "Microbiology Section",
                description: "Specialized sterility testing, microbial limits, and environmental monitoring in Class A environments.",
                label: "Biological Integrity",
                accent: "teal",
                image: "/Microbiology.png",
                imageAlt: "Microbiology laboratory environment",
              },
              {
                title: "Digital Quality Systems",
                description: "Paperless documentation via eDMS, real-time LMS training tracking, and AI-driven automation.",
                label: "Automated Precision",
                accent: "teal",
                image: "/Digital_Quality.png",
                imageAlt: "Digital quality systems visualization",
              },
            ].map((card) => (
              <CapabilityCard
                key={card.title}
                title={card.title}
                description={card.description}
                label={card.label}
                image={card.image}
                imageAlt={card.imageAlt}
                accent={card.accent as "blue" | "teal"}
              />
            ))}
          </div>
        </div>
      </section>

      {/* <section ref={capabilitiesRef} className="capabilitiesSection qualityZoomSection">
        <div className="capabilities-container qualityZoomSurface">
          <div className="capabilities-header">
            <p className="capabilities-eyebrow">Laboratory Services</p>
            <h2>Quality Capability Centers</h2>
            <p className="capabilities-subtitle">
              State-of-the-art laboratory facilities supporting comprehensive quality control and analytical testing.
            </p>
          </div>

          <div className="capabilitiesGrid">
            {qualityCapabilityCards.map((card) => {
              const Icon = card.icon;

              return (
                <article
                  key={card.title}
                  className={`capabilityShowcaseCard accent${card.accent[0].toUpperCase()}${card.accent.slice(1)}`}
                >
                  <div className="capabilityShowcaseMedia">
                    <Image
                      src={card.image}
                      alt={card.imageAlt}
                      width={520}
                      height={320}
                      className="capabilityShowcaseImage"
                    />
                  </div>

                  <div className="capabilityShowcaseBody">
                    <div className="capabilityShowcaseHeading">
                      <div className="capabilityShowcaseIcon">
                        <Icon size={22} strokeWidth={2.2} />
                      </div>
                      <h3>{card.title}</h3>
                    </div>

                    <p>{card.description}</p>
                    <small>{card.label}</small>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section> */}

      <section ref={complianceRef} className="complianceFrameworkSection qualityZoomSection">
        <div className="compliance-container qualityZoomSurface">
          <div className="compliance-header">
            <p className="compliance-eyebrow">Regulatory Standards</p>
            <h2>Global Compliance Framework</h2>
            <p className="compliance-subtitle">
              We operate under a unified global compliance strategy that meets and exceeds the
              world&apos;s most rigorous health authority mandates.
            </p>
          </div>

          <div className="complianceFrameworkGrid">
            <div className="complianceFrameworkContent">
              <div className="compliancePrinciples">
                {compliancePrinciples.map((item) => (
                  <article key={item.title} className="compliancePrinciple">
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
                  </article>
                ))}
              </div>
            </div>

            <aside className="trainingCard">
              <div className="trainingHeader">
                <div className="trainingIcon">
                  <ShieldCheck size={22} strokeWidth={2.1} />
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
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
}
