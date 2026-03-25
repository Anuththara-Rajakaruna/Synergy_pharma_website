"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";

import { SiteHeader } from "@/components/site-header";

const leaders = [
  { role: "Chairman", name: "Mr.Ravi Wijeratne" },
  { role: "Managing Director", name: "Dr.Rohan Lalith Wijesundara" },
  { role: "Director", name: "Mr.Rishi Wijeratne" },
  { role: "Director", name: "Mr.Rahul Wijeratne" },
];

const aboutCards = [
  {
    title: "Mother Company Rank Holdings",
    description:
      "The parent group that provides strategic direction, long-term investment confidence, and diversified business strength across the Synergy ecosystem.",
    cta: "Explore the group",
    image: "/rank1.png",
  },
  {
    title: "Synergy Pharmaceuticals",
    description:
      "Our pharmaceutical arm focused on high-quality manufacturing, trusted compliance, and scalable healthcare solutions for regional markets.",
    cta: "View operations",
    image: "/company.png",
  },
  {
    title: "Our Business",
    description:
      "A connected healthcare business model spanning manufacturing, diagnostics, and enterprise support to create dependable long-term value.",
    cta: "See our model",
    image: "/lab.png",
  },
  {
    title: "Synergy Diagnostics",
    description:
      "A diagnostics-focused extension of the group, supporting faster insights, stronger care pathways, and a broader healthcare footprint.",
    cta: "Discover diagnostics",
    image: "/diagonastic.png",
  },
];

export default function AboutPage() {
  const heroRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const hero = heroRef.current;

    let rafId = 0;
    const updateHeroSize = () => {
      rafId = 0;
      const scrollY = window.scrollY || 0;

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
      hero.style.setProperty("--about-hero-hide", progress.toFixed(4));
      hero.style.setProperty("--about-hero-content-shift", `${(progress * 34).toFixed(2)}px`);
      hero.style.setProperty("--about-hero-content-opacity", `${(1 - progress * 0.24).toFixed(4)}`);
      hero.style.backgroundPosition = `center ${(100 - progress * 20).toFixed(2)}%`;
      hero.style.backgroundSize = `${(135 + progress * 10).toFixed(2)}%`;
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

  return (
    <main className="about-page">
      <SiteHeader />

      <section
        ref={heroRef}
        className="hero about-hero"
        id="about"
        style={{
          backgroundImage: 'url("/manufacturing-showcase-v2.jpg")',
          backgroundPosition: "center 100%",
          backgroundSize: "135%",
        }}
      >
        <div className="hero-overlay" />
        <div className="hero-content hero-shell about-hero-content">
          <p className="eyebrow about-hero-kicker">About Synergy</p>
          <h1 className="about-hero-title">
            Built on trust,
            <br />
            driven by precision.
          </h1>
          <p className="hero-copy about-hero-copy">
            <span className="about-hero-copy-line about-hero-copy-line-1">
              Synergy Pharmaceutical combines visionary leadership, responsible manufacturing, and
            </span>
            <span className="about-hero-copy-line about-hero-copy-line-2">
              quality-first operations to deliver healthcare solutions that matter across the region.
            </span>
          </p>
        </div>
      </section>

      <section className="container section leadership-page-section" id="leadership">
        <p className="eyebrow">Organization</p>
        <h1>Leadership &amp; Vision</h1>
        <p className="showcase-copy capabilities-intro">
          Our strategic leadership team drives long-term innovation, governance, and sustainable
          growth across all pharmaceutical operations.
        </p>

        <div className="leaders">
          {leaders.map((leader) => (
            <article className="leader" key={`${leader.role}-${leader.name}`}>
              <div className="avatar" />
              <p className="leader-role">{leader.role}</p>
              <h3>{leader.name}</h3>
            </article>
          ))}
        </div>
      </section>

      <section className="container section" id="about-businesses">
        <p className="eyebrow">Our Ecosystem</p>
        <h2>Connected businesses shaping the Synergy story.</h2>
        <div className="about-cards">
          {aboutCards.map((card, index) => {
            const isImageLeft = index === 0 || index === 2;
            const isRankCard = card.title === "Mother Company Rank Holdings";

            return (
              <article
                className={`card about-card ${isImageLeft ? "about-card-reverse" : ""}`.trim()}
                key={card.title}
              >
                <div className="about-card-body">
                  <div className="about-card-copy">
                    <h3>{card.title}</h3>
                    <p>{card.description}</p>
                    <span className="about-card-link">
                      {card.cta}
                      <span aria-hidden="true">→</span>
                    </span>
                  </div>
                  <div className={`about-card-image ${isRankCard ? "about-card-image-rank" : ""}`.trim()}>
                    <Image
                      src={card.image}
                      alt={card.title}
                      fill
                      className={`showcase-photo ${isRankCard ? "about-card-image-rank-photo" : ""}`.trim()}
                      sizes="(max-width: 900px) 100vw, 34vw"
                    />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="container section mission-band" id="about-vision-mission">
        <div className="vision-panel about-vision-panel">
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
    </main>
  );
}





