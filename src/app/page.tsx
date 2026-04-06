"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { SiteHeader } from "@/components/site-header";

export default function Home() {
  const [isVisionOpen, setIsVisionOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const heroRef = useRef<HTMLElement | null>(null);
  const corporationRef = useRef<HTMLElement | null>(null);
  const missionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const hero = heroRef.current;

    let rafId = 0;
    const updateHeroSize = () => {
      rafId = 0;
      const scrollY = window.scrollY || 0;
      setIsScrolled(scrollY > 24);

      if (!hero) {
        return;
      }

      const rawProgress = Math.min(scrollY / 240, 1);
      const progress = 1 - Math.pow(1 - rawProgress, 2.8);
      const startMinHeight = window.innerHeight * 1.1;
      const endMinHeight = 350;
      const minHeight = startMinHeight - (startMinHeight - endMinHeight) * progress;
      hero.style.setProperty("--hero-min-h", `${minHeight.toFixed(2)}px`);
    };

    const onScroll = () => {
      if (rafId) {
        return;
      }

      rafId = window.requestAnimationFrame(updateHeroSize);
    };

    updateHeroSize();
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

  useEffect(() => {
    if (!isVisionOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsVisionOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isVisionOpen]);

  return (
    <main className="landing-page">
      <SiteHeader />

      <section className="home-hero">
        <img src="/left-grad.svg" alt="" className="gradient-decorator gradient-decorator-left" />
        <img src="/right-grad.svg" alt="" className="gradient-decorator gradient-decorator-right" />
        <div className="container home-hero-content">
          <p className="hero-eyebrow">Precision Healthcare Manufacturing</p>
          <h1>Advancing human health through precision.</h1>
          <p>
            Delivering high-quality, affordable medicines manufactured in Sri Lanka for the global
            healthcare economy.
          </p>
        </div>
      </section>

      <section ref={corporationRef} className="corporation-section reveal-on-scroll corporation-shrink" id="corporation">
        <div className="corporation-container">
          <div className="corporation-header">
            <p className="corporation-eyebrow">About The Corporation</p>
            <h2>Excellence in Sri Lankan Manufacturing.</h2>
            <p className="corporation-subtitle">
              Synergy Pharmaceutical is a premier manufacturer specializing in a wide range of
              pharmaceutical products. Our expansive facility is built to exceed international quality
              standards, ensuring medicine accessibility for all.
            </p>
          </div>

          <div className="corporation-content">
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
          </div>
        </div>
      </section>

      <section ref={missionRef} className="mission-section reveal-on-scroll mission-animate" id="quality">
        <div className="mission-container">
          <div className="mission-header">
            <p className="mission-eyebrow">Strategic Direction</p>
            <h2>Vision & Mission</h2>
            <p className="mission-subtitle">
              Guided by our commitment to excellence and sustainable healthcare innovation.
            </p>
          </div>

          <div className="mission-content">
            <div className="vision-panel">
              <p className="eyebrow">Vision</p>
              <blockquote>
                &ldquo;Becoming the beacon of healthcare in the region through sustainable, global-standard medicine.&rdquo;
              </blockquote>
            </div>
            <div className="mission-panel">
              <p className="eyebrow">Our Mission</p>
              <div className="mission-grid">
                <article className="mission-item">
                  <h3>Accessibility</h3>
                  <p>Deliver high-quality affordable medicine to global markets.</p>
                </article>
                <article className="mission-item">
                  <h3>Quality</h3>
                  <p>Maintain rigorous GMP compliance and transparent processes.</p>
                </article>
                <article className="mission-item">
                  <h3>Innovation</h3>
                  <p>Invest in advanced manufacturing and research partnerships.</p>
                </article>
                <article className="mission-item">
                  <h3>Responsibility</h3>
                  <p>Build sustainable operations that uplift communities and care delivery.</p>
                </article>
              </div>
            </div>
          </div>
        </div>
      </section>

    </main>
  );
}