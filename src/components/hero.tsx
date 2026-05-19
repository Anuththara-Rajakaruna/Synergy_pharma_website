"use client";

import React, { useEffect, useRef } from "react";
import Image from "next/image";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import "./hero.css";

export interface HeroProps {
  eyebrow: string;
  heading: string | React.ReactNode;
  description: string | React.ReactNode;
  actions?: React.ReactNode;
  showGradients?: boolean;
  className?: string;
  leftGradientSrc?: string;
  rightGradientSrc?: string;
}

export const Hero: React.FC<HeroProps> = ({
  eyebrow,
  heading,
  description,
  actions,
  showGradients = true,
  className = "",
  leftGradientSrc = "/left-grad.svg",
  rightGradientSrc = "/right-grad.svg",
}) => {
  const sectionRef = useRef<HTMLElement | null>(null);
  const backgroundRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);

    const section = sectionRef.current;
    const background = backgroundRef.current;
    const overlay = overlayRef.current;

    if (!section || !background || !overlay) {
      return;
    }

    const lenis = new Lenis({
      lerp: 0.08,
      smoothWheel: true,
    });

    const raf = (time: number) => {
      lenis.raf(time * 1000);
    };

    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);

    const context = gsap.context(() => {
      gsap
        .timeline({
          scrollTrigger: {
            trigger: section,
            start: "top top",
            /*
              Slightly longer scroll-out (2.75 → 3.0) so the gentler
              zoom still feels deliberate rather than rushed.
            */
            end: () => `+=${Math.round(window.innerHeight * 3.0)}`,
            /*
              Scrub bumped 1.8 → 2.2 — the camera now eases into
              every keyframe rather than tracking the wheel 1:1,
              giving the parallax a more premium, controlled glide.
            */
            scrub: 2.2,
            pin: section.classList.contains("home-hero"),
            anticipatePin: 1,
          },
        })
        .fromTo(
          background,
          {
            scale: 1,
            yPercent: 0,
          },
          {
            /*
              Zoom depth reduced ~36%:
                scale  3.5 → 2.6   (depth 2.5 → 1.6)
                xPan     6 → 4
                yPan    30 → 18
              Same direction of motion, just a calmer push-in.
            */
            scale: 2.6,
            xPercent: 4,
            yPercent: 18,
            ease: "none",
            force3D: true,
          },
          0
        )
        .to(
          overlay,
          {
            /*
              Foreground / overlay scales less aggressively too
              (4.7 → 3.4) so the gradient sweep feels in-step with
              the toned-down background instead of racing ahead.
            */
            scale: 3.4,
            xPercent: 3,
            opacity: 0.5,
            ease: "none",
            force3D: true,
          },
          0
        )
        .to(
          section,
          {
            /*
              CSS-var keyframes mirror the .hero-background-layer
              keyframes above so the cutout image-in-text stays
              pixel-locked to the image-in-layer through the whole
              (now gentler) scroll.
            */
            "--hero-bg-scale": 2.6,
            "--hero-bg-pan-x": 4,
            "--hero-bg-pan-y": 18,
            /*
              Tint fades to 0 by scroll end so the cutout becomes a
              fully transparent window onto the image at max zoom.
            */
            "--hero-tint-alpha": 0,
            ease: "none",
          },
          0
        );
    }, section);

    return () => {
      context.revert();
      gsap.ticker.remove(raf);
      lenis.destroy();
    };
  }, []);

  return (
    <section ref={sectionRef} className={`hero ${className}`}>
      <div ref={backgroundRef} className="hero-background-layer" aria-hidden="true" />
      <div ref={overlayRef} className="hero-foreground-layer" aria-hidden="true" />
      {showGradients && (
        <>
          <Image
            src={leftGradientSrc}
            alt=""
            width={1200}
            height={1200}
            aria-hidden="true"
            className="gradient-decorator gradient-decorator-left"
          />
          <Image
            src={rightGradientSrc}
            alt=""
            width={1200}
            height={1200}
            aria-hidden="true"
            className="gradient-decorator gradient-decorator-right"
          />
        </>
      )}
      <div className="container hero-content">
        <p className="hero-eyebrow">{eyebrow}</p>
        <h1 className="hero-cutout-heading">{heading}</h1>
        <p>{description}</p>
        {actions}
      </div>
    </section>
  );
};
