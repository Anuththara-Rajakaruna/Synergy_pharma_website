"use client";

import { SiteHeader } from "@/components/site-header";
import Image from "next/image";
import { CapabilityCard } from "@/components/capability-card";
import { useEffect, useRef } from "react";
import { FlaskConical, Pill, Microscope, ArrowRight } from "lucide-react";

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

      <section className="product-hero">
        <img src="/left-grad.svg" alt="" className="gradient-decorator gradient-decorator-left" />
        <img src="/right-grad.svg" alt="" className="gradient-decorator gradient-decorator-right" />
        <div className="container product-hero-content">
          <p className="hero-eyebrow">Our Products</p>
          <h1>Pharmaceutical Products Designed for Quality, Safety, and Accessibility</h1>
          <p>
            We deliver a portfolio of APIs and finished-dose medicines built to global standards,
            with stringent GMP compliance and heir-to-market supply reliability.
          </p>
        </div>
      </section>

      <br></br>

      <section ref={highlightRef} className="product-highlight product-highlight-zoom">
        <div className="highlight-container">
          <div className="highlight-header">
            <p className="highlight-eyebrow">Product Overview</p>
            <h2>Reliable Pharmaceutical Products for Safer Global Care</h2>
            <p className="highlight-subtitle">
              Leveraging advanced chemical engineering and rigorous stability protocols to deliver
              clinical excellence to healthcare providers worldwide.
            </p>
          </div>

          <div className="highlight-layout">
            <div className="highlight-image-card">
              <Image
                src="/facility_1.png"
                alt="Certified pharmaceutical facility"
                width={400}
                height={500}
                className="facility-image"
              />
              <p className="facility-label">CERTIFIED OPERATIONS</p>
            </div>

            <div className="highlight-buttons">
              <button className="btn-primary">Request Catalogue</button>
              <button className="btn-secondary">Technical Specs</button>
            </div>
          </div>
        </div>
      </section>

      <section ref={overviewRef} className="product-overview product-section-zoom">
        <div className="product-section-surface">
          <div className="overview-container">
            <div className="overview-header">
              <p className="overview-eyebrow">Manufacturing Capabilities</p>
              <h2>Capabilities & Formulations</h2>
              <p className="overview-subtitle">
                Our manufacturing platform supports precision pharmaceutical production designed for stability, efficacy, and patient compliance.
              </p>
            </div>

            <div className="capabilities-grid">
              <div className="capability-card">
                <div className="capability-icon">
                  <FlaskConical size={24} />
                </div>
                <h3>R&amp;D Laboratory</h3>
                <p>
                  Advancing pharmaceutical innovation through formulation research, process
                  development, and product optimization.
                </p>
              </div>
              <div className="capability-card">
                <div className="capability-icon">
                  <Pill size={24} />
                </div>
                <h3>Oral Solid Dosage Forms</h3>
                <p>
                  Specialized in tablet and capsule manufacturing under controlled pharmaceutical
                  processing systems.
                </p>
                <ul className="capability-list">
                  <li>Dry Granulation</li>
                  <li>Aqueous Film Coating</li>
                  <li>Direct Compression</li>
                </ul>
              </div>
              <div className="capability-card">
                <div className="capability-icon">
                  <Microscope size={24} />
                </div>
                <h3>Bio-Equivalent Engineering</h3>
                <p>
                  Supporting therapeutic consistency through formulation precision and validated
                  pharmaceutical technologies.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section ref={portfolioRef} className="current-portfolio product-section-zoom">
        <div className="product-section-surface">
          <div className="portfolio-container">
            <div className="portfolio-header">
              <div className="portfolio-content">
                <p className="portfolio-eyebrow">Product Lineup</p>
                <h2>Current Portfolio</h2>
                <p className="portfolio-subtitle">Commercialized pharmaceutical solutions across key therapeutic areas.</p>
              </div>
              <button className="portfolio-cta">
                View Full Directory
                <ArrowRight size={16} />
              </button>
            </div>

            <div className="portfolio-grid">
              {[
                {
                  title: "Cetirizine",
                  description: "Essential medications for allergy relief and histamine management.",
                  label: "Antihistamine",
                  accent: "blue",
                  image: "/Cetrizine.png",
                  imageAlt: "Cetirizine medication",
                },
                {
                  title: "Levetiracetam",
                  description: "Comprehensive anticonvulsant formulation for neurological support.",
                  label: "Antiepileptic",
                  accent: "teal",
                  image: "/Levetiracetam.png",
                  imageAlt: "Levetiracetam medication",
                },
                {
                  title: "Pregablin",
                  description: "Neuropathic pain management and neurological disorder treatment.",
                  label: "Neuropathic Agent",
                  accent: "blue",
                  image: "/Pregablin.png",
                  imageAlt: "Pregablin medication",
                },
              ].map((product) => (
                <CapabilityCard
                  key={product.title}
                  title={product.title}
                  description={product.description}
                  label={product.label}
                  image={product.image}
                  imageAlt={product.imageAlt}
                  accent={product.accent as "blue" | "teal"}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      <br></br>
      <br></br>

      <section ref={qualityRef} className="quality-section product-section-zoom">
        <div className="product-section-surface">
          <div className="quality-container">
            <div className="quality-header">
              <p className="quality-eyebrow">Quality Assurance</p>
              <h2>Our Quality Commitment</h2>
              <p className="quality-subtitle">
                Every batch undergoes rigorous stability studies under varying climatic zones to
                ensure the final product exceeds GMP standards. We don&apos;t just follow
                guidelines; we define the precision that healthcare providers rely on.
              </p>
            </div>

            <div className="quality-grid">
              <div className="quality-left">
                <div className="quality-details">
                  <div>
                    <h4>Stability Studies</h4>
                    <p>
                      Conducted in ICH-compliant chambers for real-time and accelerated shelf-life
                      verification.
                    </p>
                  </div>

                  <div>
                    <h4>In-Process QC</h4>
                    <p>
                      Multi-stage testing including content uniformity, dissolution rates, and
                      microbial limits.
                    </p>
                  </div>
                </div>
              </div>

              <div className="quality-right">
                <div className="quality-card">
                  <div className="icon-box">🛡️</div>
                  <div>
                    <small>CERTIFICATION</small>
                    <h3>FDA & GMP Standard Compliance</h3>
                  </div>
                </div>

                <div className="quality-card">
                  <div className="icon-box">📦</div>
                  <div>
                    <small>SUPPLY CHAIN</small>
                    <h3>Secured Cold-Chain Logistics</h3>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section ref={futureRef} className="future-horizons product-section-zoom">
        <div className="product-section-surface">
          <div className="future-container">
            <div className="future-header">
              <p className="future-eyebrow">Strategic Growth</p>
              <h2>Future Horizons</h2>
              <p className="future-subtitle">
                Expanding our therapeutic footprint with advanced biological and oncology solutions.
              </p>
            </div>

            <div className="future-grid">
              <div className="future-card">
                <h3>Expansion 2026</h3>
                <p>Oncology & Complex Generics</p>
                <p>
                  Developing highly potent active ingredients for targeted chemotherapy and
                  immuno-modulators.
                </p>
                <small>Phase II Testing</small>
              </div>

              <div className="future-card">
                <h3>Technical Roadmap</h3>
                <p>Injectables & Sterile Solutions</p>
                <p>
                  Inaugurating a state-of-the-art sterile fill-finish facility for lyophilized vials
                  and pre-filled syringes.
                </p>
                <small>Construction Phase</small>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
