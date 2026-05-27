"use client";

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import "./hero.css";

type HeroMaskMetrics = {
  sectionWidth: number;
  sectionHeight: number;
  headingLeft: number;
  headingTop: number;
  headingWidth: number;
  headingHeight: number;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
};

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
  const isHomeHero = className.split(/\s+/).includes("home-hero");
  const maskId = useId().replace(/:/g, "");
  const sectionRef = useRef<HTMLElement | null>(null);
  const backgroundRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const textMaskRef = useRef<SVGSVGElement | null>(null);
  const [maskMetrics, setMaskMetrics] = useState<HeroMaskMetrics | null>(null);

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
      const timeline = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: "top top",
          end: () => `+=${Math.round(window.innerHeight * 3.0)}`,
          scrub: 2.2,
          pin: section.classList.contains("home-hero"),
          anticipatePin: 1,
        },
      });

      timeline.fromTo(
        background,
        {
          scale: 1,
          yPercent: 0,
        },
        {
          scale: 2.6,
          xPercent: 4,
          yPercent: 18,
          ease: "none",
          force3D: true,
        },
        0
      );

      if (!section.classList.contains("home-hero")) {
        timeline.to(
          overlay,
          {
            scale: 3.4,
            xPercent: 3,
            opacity: 0.5,
            ease: "none",
            force3D: true,
          },
          0
        );
      }

      timeline.to(
        section,
        {
          "--hero-bg-scale": 2.6,
          "--hero-bg-pan-x": 4,
          "--hero-bg-pan-y": 18,
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

  useLayoutEffect(() => {
    const section = sectionRef.current;
    const headingElement = headingRef.current;
    const backgroundElement = backgroundRef.current;

    if (!section || !headingElement || !backgroundElement || !isHomeHero) {
      return;
    }

    const rectToObject = (rect: DOMRect) => ({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    });

    const syncHomeHeroMask = () => {
      const sectionRect = section.getBoundingClientRect();
      const headingRect = headingElement.getBoundingClientRect();
      const headingStyles = window.getComputedStyle(headingElement);
      const nextMetrics = {
        sectionWidth: sectionRect.width,
        sectionHeight: sectionRect.height,
        headingLeft: headingRect.left - sectionRect.left,
        headingTop: headingRect.top - sectionRect.top,
        headingWidth: headingRect.width,
        headingHeight: headingRect.height,
        fontFamily: headingStyles.fontFamily,
        fontSize: headingStyles.fontSize,
        fontWeight: headingStyles.fontWeight,
        lineHeight: headingStyles.lineHeight,
        letterSpacing: headingStyles.letterSpacing,
      };

      setMaskMetrics((current) => {
        if (
          current &&
          Math.abs(current.sectionWidth - nextMetrics.sectionWidth) < 0.5 &&
          Math.abs(current.sectionHeight - nextMetrics.sectionHeight) < 0.5 &&
          Math.abs(current.headingLeft - nextMetrics.headingLeft) < 0.5 &&
          Math.abs(current.headingTop - nextMetrics.headingTop) < 0.5 &&
          Math.abs(current.headingWidth - nextMetrics.headingWidth) < 0.5 &&
          Math.abs(current.headingHeight - nextMetrics.headingHeight) < 0.5 &&
          current.fontFamily === nextMetrics.fontFamily &&
          current.fontSize === nextMetrics.fontSize &&
          current.fontWeight === nextMetrics.fontWeight &&
          current.lineHeight === nextMetrics.lineHeight &&
          current.letterSpacing === nextMetrics.letterSpacing
        ) {
          return current;
        }

        return nextMetrics;
      });

      const backgroundStyles = window.getComputedStyle(backgroundElement);
      const textMaskElement = textMaskRef.current;
      const textMaskStyles = textMaskElement ? window.getComputedStyle(textMaskElement) : null;

      console.log("[hero-debug]", {
        background: {
          backgroundPosition: backgroundStyles.backgroundPosition,
          backgroundSize: backgroundStyles.backgroundSize,
          transform: backgroundStyles.transform,
          rect: rectToObject(backgroundElement.getBoundingClientRect()),
        },
        mask: textMaskStyles && textMaskElement
          ? {
              backgroundPosition: textMaskStyles.backgroundPosition,
              backgroundSize: textMaskStyles.backgroundSize,
              transform: textMaskStyles.transform,
              rect: rectToObject(textMaskElement.getBoundingClientRect()),
            }
          : null,
      });
    };

    syncHomeHeroMask();

    const fonts = document.fonts;
    if (fonts) {
      fonts.ready.then(() => {
        syncHomeHeroMask();
      });
    }

    const resizeObserver = new ResizeObserver(() => {
      syncHomeHeroMask();
    });

    resizeObserver.observe(section);
    resizeObserver.observe(headingElement);
    window.addEventListener("resize", syncHomeHeroMask);
    window.addEventListener("scroll", syncHomeHeroMask, { passive: true });

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncHomeHeroMask);
      window.removeEventListener("scroll", syncHomeHeroMask);
    };
  }, [isHomeHero]);

  return (
    <section ref={sectionRef} className={`hero ${className}`}>
      <div ref={backgroundRef} className="hero-background-layer hero-background" aria-hidden="true" />
      <div ref={overlayRef} className="hero-foreground-layer" aria-hidden="true" />
      {isHomeHero && maskMetrics && (
        <svg
          ref={textMaskRef}
          className="hero-text-mask"
          aria-hidden="true"
          viewBox={`0 0 ${maskMetrics.sectionWidth} ${maskMetrics.sectionHeight}`}
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id={`${maskId}-overlay`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#020f1c" stopOpacity="0.68" />
              <stop offset="42%" stopColor="#022d45" stopOpacity="0.42" />
              <stop offset="100%" stopColor="#bbe7e8" stopOpacity="0.12" />
            </linearGradient>
            <radialGradient id={`${maskId}-highlight`} cx="52%" cy="45%" r="24%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.08" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${maskId}-shade`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#010912" stopOpacity="0.08" />
              <stop offset="100%" stopColor="#010c16" stopOpacity="0.56" />
            </linearGradient>
            <mask id={`${maskId}-cutout`}>
              <rect width="100%" height="100%" fill="white" />
              <foreignObject x="0" y="0" width={maskMetrics.sectionWidth} height={maskMetrics.sectionHeight}>
                <div className="hero-mask-foreign-root">
                  <div
                    className="hero-mask-heading"
                    style={{
                      left: `${maskMetrics.headingLeft}px`,
                      top: `${maskMetrics.headingTop}px`,
                      width: `${maskMetrics.headingWidth}px`,
                      height: `${maskMetrics.headingHeight}px`,
                      fontFamily: maskMetrics.fontFamily,
                      fontSize: maskMetrics.fontSize,
                      fontWeight: maskMetrics.fontWeight,
                      lineHeight: maskMetrics.lineHeight,
                      letterSpacing: maskMetrics.letterSpacing,
                    }}
                  >
                    {heading}
                  </div>
                </div>
              </foreignObject>
            </mask>
          </defs>
          <g mask={`url(#${maskId}-cutout)`}>
            <rect width="100%" height="100%" fill={`url(#${maskId}-overlay)`} />
            <rect width="100%" height="100%" fill={`url(#${maskId}-shade)`} />
            <rect width="100%" height="100%" fill={`url(#${maskId}-highlight)`} />
          </g>
        </svg>
      )}
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
        <h1 ref={headingRef} className="hero-cutout-heading">{heading}</h1>
        <p>{description}</p>
        {actions}
      </div>
    </section>
  );
};
