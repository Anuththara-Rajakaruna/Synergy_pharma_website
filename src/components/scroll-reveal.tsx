"use client";

import { motion, MotionProps } from "framer-motion";
import React, { ReactNode } from "react";

interface ScrollRevealProps extends Omit<MotionProps, "children"> {
  children: ReactNode;
  delay?: number;
  duration?: number;
  className?: string;
}

/**
 * ScrollReveal Component
 * Reusable wrapper for scroll-triggered animations
 * Provides fade-in + zoom-in effect when element enters viewport
 */
export function ScrollReveal({
  children,
  delay = 0,
  duration = 1.0,
  className = "",
  ...motionProps
}: ScrollRevealProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      whileInView={{ opacity: 1, scale: 1 }}
      transition={{
        duration,
        delay,
        ease: "easeOut",
      }}
      viewport={{ once: true, margin: "0px 0px -50px 0px" }}
      className={className}
      {...motionProps}
    >
      {children}
    </motion.div>
  );
}

/**
 * ScrollRevealContainer Component
 * Wrapper for staggering multiple ScrollReveal items
 * Use this to wrap multiple items for cascading animations
 */
interface ScrollRevealContainerProps {
  children: ReactNode;
  staggerDelay?: number;
  className?: string;
}

export function ScrollRevealContainer({
  children,
  staggerDelay = 0.1,
  className = "",
}: ScrollRevealContainerProps) {
  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "0px 0px -50px 0px" }}
      variants={{
        hidden: { opacity: 0 },
        visible: {
          opacity: 1,
          transition: {
            staggerChildren: staggerDelay,
            delayChildren: 0.2,
          },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * ScrollRevealItem Component
 * Use inside ScrollRevealContainer for staggered animations
 */
interface ScrollRevealItemProps {
  children: ReactNode;
  className?: string;
}

export function ScrollRevealItem({
  children,
  className = "",
}: ScrollRevealItemProps) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, scale: 0.9 },
        visible: {
          opacity: 1,
          scale: 1,
          transition: {
            duration: 1.0,
            ease: "easeOut",
          },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
