"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { SiteHeader } from "@/components/site-header";
import { Hero } from "@/components/hero";
import { ScrollReveal } from "@/components/scroll-reveal";
import { CorporateVisionMission } from "@/components/corporate-vision-mission";

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
        eyebrow="Precision Healthcare Manufacturing"
        heading="Advancing human health through precision."
        description="Delivering high-quality, affordable medicines manufactured in Sri Lanka for the global healthcare economy."
        className="home-hero"
      />

      <section ref={corporationRef} className="corporation-section reveal-on-scroll corporation-shrink" id="corporation">
        <div className="corporation-container">
          <ScrollReveal className="corporation-header">
            <p className="corporation-eyebrow">About The Corporation</p>
            <h2>Excellence in Sri Lankan Manufacturing.</h2>
            <p className="corporation-subtitle">
              Synergy Pharmaceutical is a premier manufacturer specializing in a wide range of
              pharmaceutical products. Our expansive facility is built to exceed international quality
              standards, ensuring medicine accessibility for all.
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
                <p className="scope-label">Facility Scope</p>
                <p className="scope-copy">
                  A 10.5-acre state-of-the-art pharmaceutical campus designed for scale and safety.
                </p>
              </article>
            </div>
            <div className="showcase-metrics">
              <div>
                <strong>10.5</strong>
                <span>Acre Campus</span>
              </div>
              <div>
                <strong>Global</strong>
                <span>Certifications</span>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>

      <section ref={missionRef} className="mission-section reveal-on-scroll mission-animate" id="quality">
        <CorporateVisionMission />
      </section>

    </main>
  );
}
