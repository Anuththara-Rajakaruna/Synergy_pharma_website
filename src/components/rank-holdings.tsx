"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Pill,
  Building2,
  Hotel,
  Zap,
  Home,
  Leaf,
  Container,
  ChevronRight,
} from "lucide-react";

const industries = [
  {
    id: "pharmaceutical",
    label: "Pharmaceutical",
    icon: Pill,
    image: "/manufacturing-showcase-v2.jpg",
    heading: "Healthcare & Pharma",
    description:
      "Delivering trusted healthcare and pharmaceutical solutions focused on quality, innovation, and patient well-being.",
  },
  {
    id: "infrastructure",
    label: "Infrastructure Development",
    icon: Building2,
    image: "https://images.unsplash.com/photo-1541888946425-d81bb19240f5?w=800&q=80",
    heading: "Infrastructure Development",
    description:
      "Developing modern infrastructure projects that support economic growth and long-term sustainability.",
  },
  {
    id: "hospitality",
    label: "Hospitality & Entertainment",
    icon: Hotel,
    image: "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=800&q=80",
    heading: "Hospitality & Entertainment",
    description:
      "Creating premium hospitality and entertainment experiences through innovation and service excellence.",
  },
  {
    id: "energy",
    label: "Power, Energy & Property",
    icon: Zap,
    image: "https://images.unsplash.com/photo-1466611653911-95081537e5b7?w=800&q=80",
    heading: "Power, Energy & Property",
    description:
      "Investing in sustainable energy and property solutions for future-ready development.",
  },
  {
    id: "realestate",
    label: "Real Estate Development",
    icon: Home,
    image: "https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=800&q=80",
    heading: "Real Estate Development",
    description:
      "Building modern residential and commercial spaces designed for evolving communities.",
  },
  {
    id: "agribusiness",
    label: "Agribusiness",
    icon: Leaf,
    image: "https://images.unsplash.com/photo-1464226184884-fa280b87c399?w=800&q=80",
    heading: "Agribusiness",
    description:
      "Supporting agricultural innovation and sustainable farming solutions across regional markets.",
  },
  {
    id: "container",
    label: "Container Terminal Services",
    icon: Container,
    image: "https://images.unsplash.com/photo-1578575437130-527eed3abbec?w=800&q=80",
    heading: "Container Terminal Services",
    description:
      "Providing efficient logistics and container terminal operations enabling global trade connectivity.",
  },
];

export function RankHoldings() {
  const [activeId, setActiveId] = useState("pharmaceutical");
  const [isPaused, setIsPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const active = industries.find((i) => i.id === activeId)!;
  const activeIndex = industries.findIndex((i) => i.id === activeId);

  const advance = useCallback(() => {
    setActiveId(prev => {
      const idx = industries.findIndex(i => i.id === prev);
      return industries[(idx + 1) % industries.length].id;
    });
  }, []);

  useEffect(() => {
    if (isPaused) return;
    timerRef.current = setInterval(advance, 3000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isPaused, advance]);

  const handleManualSelect = (id: string) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setActiveId(id);
    if (!isPaused) {
      timerRef.current = setInterval(advance, 3000);
    }
  };

  return (
    <section
      className="rh-section"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* Background orbs */}
      <div className="rh-orb rh-orb--tr" />
      <div className="rh-orb rh-orb--bl" />

      <div className="rh-container">
        {/* ── Header ── */}
        <motion.div
          className="rh-header"
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65 }}
          viewport={{ once: true }}
        >
          <span className="rh-eyebrow">The Rank Holdings Network</span>
          <h2 className="rh-heading">
            A Diversified Group Powering Growth<br className="rh-br" /> Across Industries
          </h2>
          <p className="rh-description">
            Through innovation, strategic investments, and operational excellence,
            Rank Holdings drives sustainable growth across multiple industries with
            a strong and expanding global presence.
          </p>
        </motion.div>

        {/* ── 3-Column Layout ── */}
        <div className="rh-layout">

          {/* LEFT — Industry Menu */}
          <motion.nav
            className="rh-menu"
            initial={{ opacity: 0, x: -32 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
            viewport={{ once: true }}
            aria-label="Industries"
          >
            {industries.map((industry, i) => {
              const Icon = industry.icon;
              const isActive = activeId === industry.id;
              return (
                <motion.button
                  key={industry.id}
                  className={`rh-item${isActive ? " rh-item--active" : ""}`}
                  onClick={() => handleManualSelect(industry.id)}
                  initial={{ opacity: 0, x: -16 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.4, delay: 0.08 * i }}
                  viewport={{ once: true }}
                  whileHover={{ x: isActive ? 0 : 4 }}
                >
                  {isActive && (
                    <motion.span
                      className="rh-item-bar"
                      layoutId="activeBar"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    />
                  )}
                  <span className="rh-item-icon">
                    <Icon size={15} strokeWidth={2.1} />
                  </span>
                  <span className="rh-item-label">{industry.label}</span>
                  <motion.span
                    className="rh-item-arrow"
                    animate={{ opacity: isActive ? 1 : 0, x: isActive ? 0 : -6 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ChevronRight size={13} />
                  </motion.span>
                </motion.button>
              );
            })}
          </motion.nav>

          {/* CENTER — Pentagon */}
          <div className="rh-center">
            <motion.div
              className="rh-float"
              animate={{ y: [0, -14, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
            >
              {/* Glow behind */}
              <div className="rh-glow" />

              {/* Pentagon border ring */}
              <div className="rh-pentagon-ring">
                <div className="rh-pentagon-clip">
                  <AnimatePresence mode="wait">
                    <motion.img
                      key={active.id}
                      src={active.image}
                      alt={active.label}
                      className="rh-pentagon-img"
                      initial={{ opacity: 0, scale: 1.1 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.92 }}
                      transition={{ duration: 0.5, ease: "easeInOut" }}
                    />
                  </AnimatePresence>
                  {/* Overlay shimmer */}
                  <div className="rh-pentagon-shimmer" />
                </div>
              </div>
            </motion.div>

            {/* Dot indicators */}
            <div className="rh-dots">
              {industries.map((ind) => (
                <button
                  key={ind.id}
                  className={`rh-dot${activeId === ind.id ? " rh-dot--active" : ""}`}
                  onClick={() => handleManualSelect(ind.id)}
                  aria-label={ind.label}
                />
              ))}
            </div>
          </div>

          {/* RIGHT — Dynamic Content */}
          <div className="rh-right">
            <AnimatePresence mode="wait">
              <motion.div
                key={active.id}
                className="rh-card"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.38 }}
              >
                <div className="rh-card-top-bar" />

                <p className="rh-card-index">
                  {String(activeIndex + 1).padStart(2, "0")} / {String(industries.length).padStart(2, "0")}
                </p>

                <h3 className="rh-card-heading">{active.heading}</h3>
                <p className="rh-card-desc">{active.description}</p>

              </motion.div>
            </AnimatePresence>

          </div>

        </div>
      </div>
    </section>
  );
}
