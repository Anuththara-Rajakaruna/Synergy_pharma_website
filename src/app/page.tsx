"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/site-header";

export default function Home() {
  const [isVisionOpen, setIsVisionOpen] = useState(false);

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

      <section className="hero" id="about">
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

      <section className="container section manufacture-showcase reveal-on-scroll" id="corporation">
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
              <h3>Sustainability</h3>
              <p>Adhere to strict environmental sustainability protocols.</p>
            </article>
            <article className="mission-item">
              <h3>Expertise</h3>
              <p>Foster local manufacturing and scientific expertise.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="container section split reveal-on-scroll" id="locations">
        <div>
          <p className="eyebrow">Global Network</p>
          <h2>Our Presence Worldwide.</h2>
          <p>
            Corporate headquarters in Colombo, Sri Lanka, with integrated operations and partnerships
            supporting multi-region product delivery and healthcare excellence globally.
          </p>
          <p className="muted">📍 Factory Road, Colombo 05, Sri Lanka</p>
        </div>
        <div className="map-placeholder" />
      </section>

      <footer className="container footer">
        <div className="brand footer-logo">
          <Image
            src="/logo.png"
            alt="Synergy Pharmaceuticals"
            width={140}
            height={40}
          />
        </div>
        <span>© {new Date().getFullYear()} Synergy Pharmaceuticals Corporation. All rights reserved.</span>
      </footer>

      {isVisionOpen ? (
        <div className="vision-modal-backdrop" onClick={() => setIsVisionOpen(false)} role="presentation">
          <div
            className="vision-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Synergy Vision"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="eyebrow">Our Vision</p>
            <h2>Advancing Human Health Through Precision</h2>
            <p>
              We are committed to delivering globally trusted pharmaceutical solutions built on
              quality, sustainability, and scientific excellence.
            </p>
            <ul>
              <li>Quality-first manufacturing standards</li>
              <li>Affordable medicine accessibility across regions</li>
              <li>Sustainable and innovation-led growth model</li>
            </ul>
            <button type="button" onClick={() => setIsVisionOpen(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
