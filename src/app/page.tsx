"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { SiteHeader } from "@/components/site-header";

export default function Home() {
  const [isVisionOpen, setIsVisionOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const heroRef = useRef<HTMLElement | null>(null);
  const corporationRef = useRef<HTMLElement | null>(null);

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
      const width = window.innerWidth || 0;
      const startRatio = width <= 640 ? 0.74 : width <= 900 ? 0.82 : 0.92;
      const endRatio = width <= 640 ? 0.34 : width <= 900 ? 0.42 : 0.46;
      const startMinHeight = window.innerHeight * startRatio;
      const endMinHeight = window.innerHeight * endRatio;
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

      <section ref={heroRef} className={`hero ${isScrolled ? "hero-compact" : ""}`} id="about">
        <div className="hero-frame" aria-hidden>
          <span className="hero-light" />
        </div>
        <div className="hero-overlay" />
        <div className="hero-content hero-shell reveal-on-scroll is-visible">
          <p className="eyebrow">Precision Healthcare Manufacturing</p>
          <h1>Advancing <br></br>
            human health through precision.</h1>
          <p className="hero-copy">
            Delivering high-quality, affordable medicines manufactured in Sri Lanka for the global
            healthcare economy.
          </p>
          <button type="button" onClick={() => setIsVisionOpen(true)}>
            Explore our vision
          </button>
        </div>
      </section>

      <section ref={corporationRef} className="container section manufacture-showcase reveal-on-scroll corporation-shrink" id="corporation">
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
        <div className="showcase-content">
          <p className="eyebrow">About The Corporation</p>
          <h2>Excellence in Sri Lankan Manufacturing.</h2>
          <p className="showcase-copy">
            Synergy Pharmaceutical is a premier manufacturer specializing in a wide range of
            pharmaceutical products. Our expansive facility is built to exceed international quality
            standards, ensuring medicine accessibility for all.
          </p>
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
      </section>

      <section className="container section mission-band reveal-on-scroll" id="quality">
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
      </section>

      <section className="container section split reveal-on-scroll" id="locations">
        <div>
          <p className="eyebrow">Contact</p>
          <h2>Global standards, local commitment.</h2>
          <p>
            From our production campus in Sri Lanka, we support healthcare institutions across the
            region with dependable manufacturing and distribution capabilities.
          </p>
        </div>
        <div>
          <p className="eyebrow">Head Office</p>
          <h3>Synergy Pharmaceuticals</h3>
          <p>
            10.5-acre pharma campus, Sri Lanka<br />
            Mon - Fri: 8:30 AM - 5:30 PM<br />
            info@synergypharma.lk
          </p>
        </div>
      </section>
    </main>
  );
}