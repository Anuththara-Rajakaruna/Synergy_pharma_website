"use client";

import { SiteHeader } from "@/components/site-header";
import { Hero } from "@/components/hero";
import { ScrollReveal, ScrollRevealContainer, ScrollRevealItem } from "@/components/scroll-reveal";
import { motion } from "framer-motion";
import Image from "next/image";
import { CapabilityCard } from "@/components/capability-card";
import { useEffect, useRef } from "react";
import { FlaskConical, Pill, Microscope, ArrowRight, ShieldCheck, Package } from "lucide-react";

export default function ProductsPage() {
  const highlightRef = useRef<HTMLElement | null>(null);
  const overviewRef = useRef<HTMLElement | null>(null);
  const portfolioRef = useRef<HTMLElement | null>(null);
  const qualityRef = useRef<HTMLElement | null>(null);
  const futureRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const sections = [
      { ref: highlightRef, variable: "--product-highlight-progress" },
      { ref: overviewRef, variable: "--product-section-progress" },
      { ref: portfolioRef, variable: "--product-section-progress" },
      { ref: qualityRef, variable: "--product-section-progress" },
      { ref: futureRef, variable: "--product-section-progress" },
    ];

    if (sections.every(({ ref }) => !ref.current)) {
      return;
    }

    let rafId = 0;

    const updateSectionZooms = () => {
      rafId = 0;

      sections.forEach(({ ref, variable }) => {
        const section = ref.current;

        if (!section) {
          return;
        }

        const rect = section.getBoundingClientRect();
        const viewportHeight = window.innerHeight || 1;
        const startLine = viewportHeight * 0.88;
        const endLine = viewportHeight * 0.08;
        const rawProgress = (startLine - rect.top) / (startLine - endLine);
        const progress = Math.min(Math.max(rawProgress, 0), 1);

        section.style.setProperty(variable, progress.toFixed(4));
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
    <main className="product-page">
      <SiteHeader />

      <Hero
        eyebrow="Our Products"
        heading="Driven by Quality, Defined by Trust"
        description="We deliver a portfolio of APIs and finished-dose medicines built to global standards, with stringent GMP compliance and heir-to-market supply reliability."
        className="product-hero"
      />

      <section ref={highlightRef} className="product-highlight product-highlight-zoom">
        <div className="highlight-container">
          <ScrollReveal>
            <div className="showcaseContent">
              <p className="eyebrow">Product Overview</p>
              <h2>Reliable Pharmaceutical Products for Safer Global Care</h2>
              <p className="highlight-subtitle">
                Leveraging advanced chemical engineering and rigorous stability protocols to deliver
                clinical excellence to healthcare providers worldwide.
              </p>
              <p className="facility-label">CERTIFIED OPERATIONS</p>
            </div>
          </ScrollReveal>

          <ScrollReveal delay={0.2}>
            <div className="highlight-layout">
              <div className="highlight-image-card">
                <div className="highlight-image-frame">
                  <Image
                    src="/Overview.png"
                    alt="Certified pharmaceutical facility"
                    width={400}
                    height={400}
                    className="facility-image"
                  />
                </div>
              </div>

              <div className="highlight-content">
                {/* <div className="highlight-buttons">
                <button className="btn-primary">Request Catalogue</button>
                <button className="btn-secondary">Technical Specs</button>
              </div> */}
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>

      <section ref={overviewRef} className="product-overview product-section-zoom">
        <div className="product-section-surface">
          <div className="overview-container">
            <ScrollReveal>
              <div className="capabilities-header">
                <p className="eyebrow">Manufacturing Capabilities</p>
                <h2>Capabilities & Formulations</h2>
                <p className="capabilities-subtitle">
                  Our manufacturing platform supports precision pharmaceutical production designed for stability, efficacy, and patient compliance.
                </p>
              </div>
            </ScrollReveal>

            <ScrollRevealContainer staggerDelay={0.1} className="capabilities-grid">
              <ScrollRevealItem>
                <div className="capability-card">
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
                      <FlaskConical size={40} strokeWidth={2} />
                    </motion.div>
                  </motion.div>
                  <h3 className="facility-capabilityCardTitle">R&amp;D Laboratory</h3>
                  <p className="facility-capabilityCardDescription">
                    Advancing pharmaceutical innovation through formulation research, process
                    development, and product optimization.
                  </p>
                </div>
              </ScrollRevealItem>
              <ScrollRevealItem>
                <div className="capability-card">
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
                      <Pill size={40} strokeWidth={2} />
                    </motion.div>
                  </motion.div>
                  <h3 className="facility-capabilityCardTitle">Oral Solid Dosage Forms</h3>
                  <p className="facility-capabilityCardDescription">
                    Specialized in tablet and capsule manufacturing under controlled pharmaceutical
                    processing systems.
                  </p>
                  <ul className="capability-list">
                    <li>Dry Granulation</li>
                    <li>Aqueous Film Coating</li>
                    <li>Direct Compression</li>
                  </ul>
                </div>
              </ScrollRevealItem>
              <ScrollRevealItem>
                <div className="capability-card">
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
                      <Microscope size={40} strokeWidth={2} />
                    </motion.div>
                  </motion.div>
                  <h3 className="facility-capabilityCardTitle">Bio-Equivalent Engineering</h3>
                  <p className="facility-capabilityCardDescription">
                    Supporting therapeutic consistency through formulation precision and validated
                    pharmaceutical technologies.
                  </p>
                </div>
              </ScrollRevealItem>
            </ScrollRevealContainer>
          </div>
        </div>
      </section>

      <section ref={portfolioRef} className="current-portfolio product-section-zoom">
        <div className="product-section-surface">
          <div className="portfolio-container">
            <ScrollReveal>
              <div className="portfolio-header">
                <p className="eyebrow">Product Lineup</p>
                <h2>Current Portfolio</h2>
                <p className="portfolio-subtitle">Commercialized pharmaceutical solutions across key therapeutic areas.</p>
              </div>
            </ScrollReveal>
            <ScrollReveal delay={0.15}>
              <div className="portfolio-header-action">
                <button className="portfolio-cta">
                  View Full Directory
                  <ArrowRight size={16} />
                </button>
              </div>
            </ScrollReveal>

            <ScrollRevealContainer staggerDelay={0.12} className="portfolio-grid">
              {[
                {
                  title: "Cetirizine",
                  description: "Essential medications for allergy relief and histamine management.",
                  label: "Antihistamine",
                  accent: "blue",
                  image: "/Products/Cetirizine.jpg",
                  imageAlt: "Cetirizine medication",
                },
                {
                  title: "Levetiracetam",
                  description: "Comprehensive anticonvulsant formulation for neurological support.",
                  label: "Antiepileptic",
                  accent: "teal",
                  image: "/Products/Levetiracetam.jpg",
                  imageAlt: "Levetiracetam medication",
                },
                {
                  title: "Pregabalin",
                  description: "Neuropathic pain management and neurological disorder treatment.",
                  label: "Neuropathic Agent",
                  accent: "blue",
                  image: "/Products/Pregabalin.jpg",
                  imageAlt: "Pregablin medication",
                },
              ].map((product) => (
                <ScrollRevealItem key={product.title}>
                  <CapabilityCard
                    title={product.title}
                    description={product.description}
                    label={product.label}
                    image={product.image}
                    imageAlt={product.imageAlt}
                    accent={product.accent as "blue" | "teal"}
                  />
                </ScrollRevealItem>
              ))}
            </ScrollRevealContainer>
          </div>
        </div>
      </section>

      <section ref={qualityRef} className="quality-section product-section-zoom">
        <div className="product-section-surface">
          <div className="quality-container">
            <ScrollReveal>
              <div className="quality-header">
                <p className="eyebrow">Quality Assurance</p>
                <h2>Our Quality Commitment</h2>
                <p className="quality-subtitle">
                  Every batch undergoes rigorous stability studies under varying climatic zones to
                  ensure the final product exceeds GMP standards. We don&apos;t just follow
                  guidelines; we define the precision that healthcare providers rely on.
                </p>
              </div>
            </ScrollReveal>

            <ScrollRevealContainer staggerDelay={0.1} className="quality-grid">
              <ScrollRevealItem>
                <div className="quality-left">
                  <div className="quality-details">
                    <div>
                      <h4 className="facility-capabilityCardTitle">Stability Studies</h4>
                      <p className="facility-capabilityCardDescription">
                        Conducted in ICH-compliant chambers for real-time and accelerated shelf-life
                        verification.
                      </p>
                    </div>

                    <div>
                      <h4 className="facility-capabilityCardTitle">In-Process QC</h4>
                      <p className="facility-capabilityCardDescription">
                        Multi-stage testing including content uniformity, dissolution rates, and
                        microbial limits.
                      </p>
                    </div>
                  </div>
                </div>
              </ScrollRevealItem>

              <ScrollRevealItem>
                <div className="quality-right">
                  <div className="quality-card">
                    <div className="corporate-value-icon-wrap">
                      <div className="corporate-value-blob-1" />
                      <div className="corporate-value-blob-2" />
                      <div className="corporate-value-glass">
                        <ShieldCheck size={22} strokeWidth={1.8} />
                      </div>
                    </div>
                    <div>
                      <small>CERTIFICATION</small>
                      <h3 className="facility-capabilityCardTitle">FDA & GMP Standard Compliance</h3>
                    </div>
                  </div>

                  <div className="quality-card">
                    <div className="corporate-value-icon-wrap">
                      <div className="corporate-value-blob-1" />
                      <div className="corporate-value-blob-2" />
                      <div className="corporate-value-glass">
                        <Package size={22} strokeWidth={1.8} />
                      </div>
                    </div>
                    <div>
                      <small>SUPPLY CHAIN</small>
                      <h3 className="facility-capabilityCardTitle">Secured Cold-Chain Logistics</h3>
                    </div>
                  </div>
                </div>
              </ScrollRevealItem>
            </ScrollRevealContainer>
          </div>
        </div>
      </section>

      <section ref={futureRef} className="future-horizons product-section-zoom">
        <div className="product-section-surface">
          <div className="future-container">
            <ScrollReveal>
              <div className="future-header">
                <p className="eyebrow">Strategic Growth</p>
                <h2>Future Horizons</h2>
                <p className="future-subtitle">
                  Expanding our therapeutic footprint with advanced biological and oncology solutions.
                </p>
              </div>
            </ScrollReveal>

            <ScrollRevealContainer staggerDelay={0.15} className="future-grid">
              <ScrollRevealItem>
                <div className="future-card future-card-oncology">
                  <h3>Expansion 2026</h3>
                  <p>Oncology & Complex Generics</p>
                  <p>
                    Developing highly potent active ingredients for targeted chemotherapy and
                    immuno-modulators.
                  </p>
                  <small>Phase II Testing</small>
                </div>
              </ScrollRevealItem>

              <ScrollRevealItem>
                <div className="future-card future-card-injectables">
                  <h3>Technical Roadmap</h3>
                  <p>Injectables & Sterile Solutions</p>
                  <p>
                    Inaugurating a state-of-the-art sterile fill-finish facility for lyophilized vials
                    and pre-filled syringes.
                  </p>
                  <small>Construction Phase</small>
                </div>
              </ScrollRevealItem>
            </ScrollRevealContainer>
          </div>
        </div>
      </section>
    </main>
  );
}
