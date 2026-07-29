"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { SiteHeader } from "@/components/site-header";
import { Hero } from "@/components/hero";
import { ScrollReveal } from "@/components/scroll-reveal";
import { RankHoldings } from "@/components/rank-holdings";

export default function Home() {
  const corporationRef = useRef<HTMLElement | null>(null);
  const missionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const section = corporationRef.current;

    if (!section) {
      return;
    }

    let rafId = 0;

    const updateCorporationSize = () => {
      rafId = 0;
      const rect = section.getBoundingClientRect();
      const viewportHeight = window.innerHeight || 1;
      const startLine = viewportHeight * 0.8;
      const endLine = viewportHeight * 0.18;
      const rawProgress = (startLine - rect.top) / (startLine - endLine);
      const progress = Math.min(Math.max(rawProgress, 0), 1);

      section.style.setProperty("--corporation-progress", progress.toFixed(4));
    };

    const onScroll = () => {
      if (rafId) {
        return;
      }

      rafId = window.requestAnimationFrame(updateCorporationSize);
    };

    updateCorporationSize();
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

  useEffect(() => {
    const section = missionRef.current;

    if (!section) {
      return;
    }

    let rafId = 0;

    const updateMissionSize = () => {
      rafId = 0;
      const rect = section.getBoundingClientRect();
      const viewportHeight = window.innerHeight || 1;
      const startLine = viewportHeight * 0.86;
      const endLine = viewportHeight * 0.2;
      const rawProgress = (startLine - rect.top) / (startLine - endLine);
      const progress = Math.min(Math.max(rawProgress, 0), 1);

      section.style.setProperty("--mission-progress", progress.toFixed(4));
    };

    const onScroll = () => {
      if (rafId) {
        return;
      }

      rafId = window.requestAnimationFrame(updateMissionSize);
    };

    updateMissionSize();
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

  useEffect(() => {
    const elements = document.querySelectorAll(".reveal-on-scroll");

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.16 }
    );

    elements.forEach((element) => observer.observe(element));

    return () => observer.disconnect();
  }, []);

  return (
    <main className="landing-page">
      <SiteHeader />

      <Hero
        eyebrow="Synergy Pharmaceuticals"
        heading={
          <>
            <span className="hero-heading-line">
              Driven by Collaboration.
            </span>
            <span className="hero-heading-line">Focused on Care.</span>
          </>
        }
        description="Delivering high-quality, affordable medicines manufactured in Sri Lanka for the global healthcare economy."
        className="home-hero"
      />

      <section ref={corporationRef} className="corporation-section reveal-on-scroll corporation-shrink" id="corporation">
        <div className="corporation-container">
          <ScrollReveal className="corporation-header">
            <p className="corporation-eyebrow">ABOUT THE CORPORATION</p>
            <h2>Where Sri Lankan Manufacturing Meets Global Excellence</h2>
            <p className="corporation-subtitle">
              Synergy Pharmaceuticals is a trusted manufacturer of a diverse range of finished pharmaceutical products. With an advanced facility built to meet and exceed global quality standards, we are committed to making high-quality medicines accessible to all.
            </p>
          </ScrollReveal>

          <ScrollReveal className="corporation-content" delay={0.2}>
            <div className="showcase-media">
              <div className="showcase-image">
                <Image
                  src="/manufacturing-showcase-v2.jpg"
                  alt="Synergy manufacturing campus"
                  fill
                  className="showcase-photo"
                  sizes="(max-width: 900px) 100vw, 45vw"
                />
              </div>
              <article className="scope-card">
                <p className="scope-label">CERTIFICATIONS</p>
                <p className="scope-copy">
Sri Lankan NMRA-GMP<br />EU-GMP (Q4 2026)                </p>
              </article>
            </div>
            <div className="showcase-metrics">
              <div className="metric-card">
                <strong>10.5</strong>
                <span>ACRES CAMPUS</span>
              </div>
              <div className="metric-card">
                <strong>4</strong>
                <span>MANUFACTURING BLOCKS</span>
              </div>
              <div className="metric-card">
                <strong>1</strong>
                <span>R&D CENTRE</span>
              </div>
              {/* <div className="metric-card">
                <strong>CERTIFICATIONS</strong>
                <span>Sri Lankan NMRA-GMP<br />EU-GMP (Q4 2026)</span>
              </div> */}
            </div>
          </ScrollReveal>
        </div>
      </section>

      <section ref={missionRef} className="rh-wrapper reveal-on-scroll" id="quality">
        <RankHoldings />
      </section>

    </main>
  );
}
