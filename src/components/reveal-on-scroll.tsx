"use client";

import { useEffect } from "react";

export function RevealOnScroll() {
  useEffect(() => {
    const elements = Array.from(document.querySelectorAll(".reveal-on-scroll"));

    if (!elements.length) {
      return;
    }

    // Mark elements as JS-controlled so CSS can apply the hidden-then-reveal animation.
    // Without this attribute the elements are visible by default (no-JS / CSP fallback).
    elements.forEach((el) => el.setAttribute("data-reveal", "pending"));

    // Force-reveal all elements after 800 ms in case the observer fires late.
    const fallbackTimer = setTimeout(() => {
      elements.forEach((el) => {
        el.setAttribute("data-reveal", "visible");
        el.classList.add("is-visible");
      });
    }, 800);

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.setAttribute("data-reveal", "visible");
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.05 }
    );

    elements.forEach((element) => observer.observe(element));

    return () => {
      observer.disconnect();
      clearTimeout(fallbackTimer);
    };
  }, []);

  return null;
}
