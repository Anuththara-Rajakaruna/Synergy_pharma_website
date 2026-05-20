"use client";

import {
  motion,
  useMotionValue,
  useSpring,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { useEffect, type ReactElement } from "react";

type MoleculeFn = () => ReactElement;

const SQRT3_HALF = Math.sqrt(3) / 2;

const hexPoints = (r: number) => {
  const h = (r * SQRT3_HALF).toFixed(2);
  return `0,${-r} ${h},${-r / 2} ${h},${r / 2} 0,${r} ${-h},${r / 2} ${-h},${-r / 2}`;
};

const seededFloat = (i: number, salt: number, scale: number, offset = 0) => {
  const raw = ((Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453) % 1 + 1) % 1;
  // Round to 3 decimals so SSR and client serialize identical strings (avoids hydration drift)
  return Math.round((offset + raw * scale) * 1000) / 1000;
};

// === Far hex grid (lowest opacity, slowest motion) ===
const farHexes = Array.from({ length: 18 }, (_, i) => ({
  cx: seededFloat(i, 1, 1920),
  cy: seededFloat(i, 2, 1080),
  r: 38 + seededFloat(i, 3, 22),
  o: 0.18 + seededFloat(i, 4, 0.12),
  dur: 14 + seededFloat(i, 5, 6),
  delay: seededFloat(i, 6, 5),
  drift: 8 + seededFloat(i, 7, 10),
}));

// === Mid hex grid (slightly larger, more visible) ===
const midHexes = Array.from({ length: 11 }, (_, i) => ({
  cx: seededFloat(i, 8, 1920),
  cy: seededFloat(i, 9, 1080),
  r: 55 + seededFloat(i, 10, 25),
  o: 0.25 + seededFloat(i, 11, 0.15),
  dur: 11 + seededFloat(i, 12, 5),
  delay: seededFloat(i, 13, 4),
  drift: 14 + seededFloat(i, 14, 10),
}));

// === Main molecular hexagons (front layer) ===
const MAIN_HEX_R = 140;

const mainHexagons = [
  { id: "cetirizine", cx: 320, cy: 320, label: "Cetirizine" },
  { id: "levetiracetam", cx: 960, cy: 720, label: "Levetiracetam" },
  { id: "pregabalin", cx: 1600, cy: 380, label: "Pregabalin" },
];

// === Connecting paths between main hexagons ===
const connectionPaths = [
  {
    id: "c1",
    d: "M 320,320 Q 660,540 960,720",
    dur: 5.5,
    particleCount: 3,
  },
  {
    id: "c2",
    d: "M 960,720 Q 1320,560 1600,380",
    dur: 6.2,
    particleCount: 3,
  },
  {
    id: "c3",
    d: "M 320,320 Q 940,180 1600,380",
    dur: 7.0,
    particleCount: 2,
  },
];

// === Ambient mid-layer particles (depth-of-field, soft blur) ===
const midParticles = Array.from({ length: 14 }, (_, i) => ({
  cx: seededFloat(i, 21, 1920),
  cy: seededFloat(i, 22, 1080),
  r: 1.4 + seededFloat(i, 23, 2),
  dur: 10 + seededFloat(i, 24, 6),
  delay: seededFloat(i, 25, 6),
  drift: 24 + seededFloat(i, 26, 18),
  blur: seededFloat(i, 27, 1) > 0.5 ? "url(#dof-blur)" : undefined,
}));

// === Foreground crisp particles ===
const hudParticles = Array.from({ length: 10 }, (_, i) => ({
  cx: seededFloat(i, 31, 1920),
  cy: seededFloat(i, 32, 1080),
  r: 1 + seededFloat(i, 33, 1.4),
  dur: 6 + seededFloat(i, 34, 4),
  delay: seededFloat(i, 35, 5),
  drift: 12 + seededFloat(i, 36, 14),
}));

// === Indicator pulses (HUD micro-animations near corners) ===
const indicators = [
  { cx: 110, cy: 110, delay: 0 },
  { cx: 1810, cy: 110, delay: 1.2 },
  { cx: 110, cy: 970, delay: 2.1 },
  { cx: 1810, cy: 970, delay: 0.6 },
];

function MoleculeCetirizine() {
  return (
    <g
      fill="none"
      stroke="rgba(178, 234, 255, 0.85)"
      strokeWidth="1.6"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <polygon points={hexPoints(22)} transform="translate(-58, -18)" />
      <polygon points={hexPoints(20)} transform="translate(-18, 30)" />
      <polygon points={hexPoints(22)} transform="translate(28, -8)" />
      <line x1="-38" y1="-10" x2="-20" y2="-2" />
      <line x1="-2" y1="14" x2="14" y2="2" />
      <line x1="46" y1="0" x2="62" y2="16" />
      <line x1="62" y1="16" x2="78" y2="10" />
      <line x1="78" y1="10" x2="92" y2="26" />
      <circle r="3.6" cx="-84" cy="-32" fill="url(#atom-blue)" />
      <circle r="3" cx="-58" cy="-44" fill="url(#atom-cyan)" />
      <circle r="3.4" cx="92" cy="26" fill="url(#atom-cyan)" />
      <circle r="3" cx="28" cy="-32" fill="url(#atom-blue)" />
      <circle r="2.6" cx="-18" cy="56" fill="url(#atom-cyan)" />
    </g>
  );
}

function MoleculeLevetiracetam() {
  return (
    <g
      fill="none"
      stroke="rgba(178, 234, 255, 0.85)"
      strokeWidth="1.6"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <polygon points="0,-32 30,-10 19,26 -19,26 -30,-10" />
      <line x1="-34" y1="-14" x2="-52" y2="-26" />
      <line x1="20" y1="29" x2="38" y2="48" />
      <line x1="38" y1="48" x2="60" y2="42" />
      <line x1="30" y1="-12" x2="50" y2="-26" />
      <line x1="50" y1="-26" x2="50" y2="-48" />
      <line x1="50" y1="-26" x2="72" y2="-14" />
      <circle r="3.6" cx="-52" cy="-26" fill="url(#atom-pink)" />
      <circle r="3.4" cx="50" cy="-48" fill="url(#atom-cyan)" />
      <circle r="3" cx="72" cy="-14" fill="url(#atom-blue)" />
      <circle r="3" cx="60" cy="42" fill="url(#atom-cyan)" />
    </g>
  );
}

function MoleculePregabalin() {
  return (
    <g
      fill="none"
      stroke="rgba(178, 234, 255, 0.85)"
      strokeWidth="1.6"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <line x1="-62" y1="20" x2="-42" y2="8" />
      <line x1="-42" y1="8" x2="-22" y2="20" />
      <line x1="-22" y1="20" x2="-2" y2="8" />
      <line x1="-2" y1="8" x2="20" y2="20" />
      <line x1="20" y1="20" x2="40" y2="8" />
      <line x1="-42" y1="8" x2="-52" y2="-14" />
      <line x1="-22" y1="20" x2="-16" y2="42" />
      <line x1="20" y1="20" x2="34" y2="42" />
      <line x1="40" y1="8" x2="54" y2="-8" />
      <line x1="40" y1="8" x2="54" y2="26" />
      <circle r="3" cx="-62" cy="20" fill="url(#atom-cyan)" />
      <circle r="3" cx="-52" cy="-14" fill="url(#atom-blue)" />
      <circle r="3.4" cx="34" cy="42" fill="url(#atom-blue)" />
      <circle r="3.4" cx="54" cy="-8" fill="url(#atom-cyan)" />
      <circle r="2.8" cx="54" cy="26" fill="url(#atom-pink)" />
    </g>
  );
}

const molecules: Record<string, MoleculeFn> = {
  cetirizine: MoleculeCetirizine,
  levetiracetam: MoleculeLevetiracetam,
  pregabalin: MoleculePregabalin,
};

type LayerProps = {
  x: MotionValue<number>;
  y: MotionValue<number>;
  reducedMotion: boolean;
};

function FarLayer({ x, y, reducedMotion }: LayerProps) {
  return (
    <motion.g style={{ x, y }}>
      {farHexes.map((h, i) => (
        <motion.g
          key={`far-${i}`}
          initial={{ opacity: 0 }}
          animate={
            reducedMotion
              ? { opacity: h.o, x: h.cx, y: h.cy }
              : {
                  opacity: [h.o * 0.55, h.o, h.o * 0.55],
                  x: h.cx,
                  y: [h.cy, h.cy - h.drift, h.cy],
                }
          }
          transition={
            reducedMotion
              ? { duration: 0.8 }
              : {
                  duration: h.dur,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: h.delay,
                }
          }
        >
          <polygon
            points={hexPoints(h.r)}
            fill="none"
            stroke="rgba(150, 215, 255, 1)"
            strokeWidth="1.2"
          />
        </motion.g>
      ))}
    </motion.g>
  );
}

function MidLayer({ x, y, reducedMotion }: LayerProps) {
  return (
    <motion.g style={{ x, y }}>
      {midHexes.map((h, i) => (
        <motion.g
          key={`mid-${i}`}
          initial={{ opacity: 0 }}
          animate={
            reducedMotion
              ? { opacity: h.o, x: h.cx, y: h.cy }
              : {
                  opacity: [h.o * 0.6, h.o, h.o * 0.6],
                  x: h.cx,
                  y: [h.cy, h.cy - h.drift, h.cy],
                  rotate: [0, 6, 0],
                }
          }
          transition={
            reducedMotion
              ? { duration: 0.8 }
              : {
                  duration: h.dur,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: h.delay,
                }
          }
        >
          <polygon
            points={hexPoints(h.r)}
            fill="rgba(60, 170, 220, 0.06)"
            stroke="rgba(170, 230, 255, 1)"
            strokeWidth="1.3"
          />
        </motion.g>
      ))}
      {midParticles.map((p, i) => (
        <motion.circle
          key={`midp-${i}`}
          r={p.r}
          fill="rgba(180, 230, 255, 0.85)"
          filter={p.blur}
          initial={{ cx: p.cx, cy: p.cy, opacity: 0 }}
          animate={
            reducedMotion
              ? { cx: p.cx, cy: p.cy, opacity: 0.45 }
              : {
                  cx: p.cx,
                  cy: [p.cy, p.cy - p.drift, p.cy],
                  opacity: [0.18, 0.8, 0.18],
                }
          }
          transition={
            reducedMotion
              ? { duration: 0.8 }
              : {
                  duration: p.dur,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: p.delay,
                }
          }
        />
      ))}
    </motion.g>
  );
}

function NearLayer({ x, y, reducedMotion }: LayerProps) {
  return (
    <motion.g style={{ x, y }}>
      {/* connection paths */}
      <g fill="none" stroke="rgba(140, 220, 255, 0.85)" strokeWidth="1.4" strokeDasharray="3 8">
        {connectionPaths.map((p, i) => (
          <motion.path
            key={p.id}
            d={p.d}
            initial={{ pathLength: 0, opacity: 0 }}
            animate={
              reducedMotion
                ? { pathLength: 1, opacity: 0.55 }
                : { pathLength: 1, opacity: [0.35, 0.7, 0.35] }
            }
            transition={
              reducedMotion
                ? { duration: 0.8 }
                : { duration: 9 + i, repeat: Infinity, ease: "easeInOut", delay: i * 0.8 }
            }
          />
        ))}
      </g>

      {/* travelling particles along each connection */}
      {!reducedMotion &&
        connectionPaths.flatMap((p) =>
          Array.from({ length: p.particleCount }, (_, idx) => (
            <circle key={`${p.id}-tp-${idx}`} r={2.4} fill="url(#travel-glow)" filter="url(#travel-glow-filter)">
              <animateMotion
                dur={`${p.dur}s`}
                repeatCount="indefinite"
                path={p.d}
                begin={`${(idx * p.dur) / p.particleCount}s`}
              />
            </circle>
          ))
        )}

      {/* main molecular hexagons */}
      {mainHexagons.map((h, idx) => {
        const Molecule = molecules[h.id];
        return (
          <g key={h.id} transform={`translate(${h.cx} ${h.cy})`}>
            <motion.g
              initial={{ opacity: 0 }}
              animate={
                reducedMotion
                  ? { opacity: 1 }
                  : { opacity: 1, y: [0, -6, 0] }
              }
              transition={
                reducedMotion
                  ? { duration: 1.2 }
                  : {
                      opacity: { duration: 1.4, delay: idx * 0.35 },
                      y: { duration: 9 + idx * 1.4, repeat: Infinity, ease: "easeInOut", delay: idx * 0.6 },
                    }
              }
            >
              {/* outer halo */}
              <motion.polygon
                points={hexPoints(MAIN_HEX_R + 22)}
                fill="rgba(90, 200, 240, 0.18)"
                animate={reducedMotion ? { opacity: 0.7 } : { opacity: [0.55, 1, 0.55] }}
                transition={
                  reducedMotion
                    ? { duration: 0.8 }
                    : { duration: 5 + idx * 0.7, repeat: Infinity, ease: "easeInOut" }
                }
              />
              {/* glass hex shell */}
              <polygon
                points={hexPoints(MAIN_HEX_R)}
                fill="url(#hex-glass)"
                stroke="rgba(170, 235, 255, 0.95)"
                strokeWidth="2"
                filter="url(#hex-soft-glow)"
              />
              {/* inner accent ring */}
              <polygon
                points={hexPoints(MAIN_HEX_R - 16)}
                fill="none"
                stroke="rgba(190, 240, 255, 0.45)"
                strokeWidth="1"
                strokeDasharray="3 5"
              />
              {/* slowly rotating molecule with 3D-feel rotateY */}
              <motion.g
                style={{ transformOrigin: "0px 0px" }}
                animate={reducedMotion ? undefined : { rotate: 360 }}
                transition={
                  reducedMotion
                    ? undefined
                    : { duration: 80, repeat: Infinity, ease: "linear" }
                }
              >
                <motion.g
                  filter="url(#atom-glow)"
                  animate={reducedMotion ? undefined : { scaleX: [1, 0.62, 1] }}
                  transition={
                    reducedMotion
                      ? undefined
                      : { duration: 14 + idx * 2, repeat: Infinity, ease: "easeInOut" }
                  }
                  style={{ transformOrigin: "0px 0px" }}
                >
                  <Molecule />
                </motion.g>
              </motion.g>
              {/* pulsing connection node where paths meet */}
              <motion.circle
                r={4}
                cx={0}
                cy={-MAIN_HEX_R + 2}
                fill="rgba(190, 240, 255, 0.85)"
                filter="url(#travel-glow-filter)"
                animate={reducedMotion ? { opacity: 0.5 } : { opacity: [0.3, 1, 0.3], scale: [0.8, 1.3, 0.8] }}
                transition={
                  reducedMotion
                    ? { duration: 0.8 }
                    : { duration: 3.2, repeat: Infinity, ease: "easeInOut", delay: idx * 0.7 }
                }
              />
              <text
                y={MAIN_HEX_R + 32}
                textAnchor="middle"
                fill="rgba(195, 235, 255, 0.55)"
                fontSize="12"
                fontWeight={600}
                letterSpacing="4"
              >
                {h.label.toUpperCase()}
              </text>
            </motion.g>
          </g>
        );
      })}
    </motion.g>
  );
}

function HudLayer({ x, y, reducedMotion }: LayerProps) {
  return (
    <motion.g style={{ x, y }}>
      {/* drifting scan line */}
      {!reducedMotion && (
        <motion.g
          animate={{ y: [-200, 1280] }}
          transition={{ duration: 22, repeat: Infinity, ease: "linear" }}
        >
          <rect x="0" y="0" width="1920" height="2" fill="url(#scan-line)" />
        </motion.g>
      )}

      {/* corner brackets — top-left */}
      <g stroke="rgba(160, 225, 255, 0.65)" strokeWidth="1.4" fill="none">
        <path d="M 40,40 L 40,80 M 40,40 L 80,40" />
        <path d="M 1880,40 L 1880,80 M 1880,40 L 1840,40" />
        <path d="M 40,1040 L 40,1000 M 40,1040 L 80,1040" />
        <path d="M 1880,1040 L 1880,1000 M 1880,1040 L 1840,1040" />
      </g>

      {/* indicator pulses */}
      {indicators.map((d, i) => (
        <g key={`ind-${i}`} transform={`translate(${d.cx} ${d.cy})`}>
          <motion.circle
            r="2.5"
            fill="rgba(170, 235, 255, 0.9)"
            animate={reducedMotion ? { opacity: 0.6 } : { opacity: [0.25, 1, 0.25] }}
            transition={
              reducedMotion
                ? { duration: 0.8 }
                : { duration: 2.4, repeat: Infinity, ease: "easeInOut", delay: d.delay }
            }
          />
          <motion.circle
            r="6"
            fill="none"
            stroke="rgba(170, 235, 255, 0.55)"
            strokeWidth="0.8"
            animate={reducedMotion ? { opacity: 0 } : { opacity: [0.5, 0, 0.5], scale: [1, 2.6, 1] }}
            transition={
              reducedMotion
                ? { duration: 0.8 }
                : { duration: 3.2, repeat: Infinity, ease: "easeInOut", delay: d.delay }
            }
          />
        </g>
      ))}

      {/* crisp foreground particles */}
      {hudParticles.map((p, i) => (
        <motion.circle
          key={`hudp-${i}`}
          r={p.r}
          fill="rgba(220, 245, 255, 0.95)"
          initial={{ cx: p.cx, cy: p.cy, opacity: 0 }}
          animate={
            reducedMotion
              ? { cx: p.cx, cy: p.cy, opacity: 0.6 }
              : {
                  cx: p.cx,
                  cy: [p.cy, p.cy - p.drift, p.cy],
                  opacity: [0.2, 0.9, 0.2],
                }
          }
          transition={
            reducedMotion
              ? { duration: 0.8 }
              : {
                  duration: p.dur,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: p.delay,
                }
          }
        />
      ))}
    </motion.g>
  );
}

export function ProductBackground() {
  const reducedMotion = useReducedMotion() ?? false;

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const smoothMouseX = useSpring(mouseX, { stiffness: 32, damping: 22, mass: 0.5 });
  const smoothMouseY = useSpring(mouseY, { stiffness: 32, damping: 22, mass: 0.5 });

  const { scrollYProgress } = useScroll();
  const scrollZoom = useTransform(scrollYProgress, [0, 1], [1, 1.08]);
  const scrollFade = useTransform(scrollYProgress, [0, 0.05, 1], [0.55, 1, 1]);

  // Per-layer parallax transforms (far -> hud, increasing sensitivity)
  const farX = useTransform(smoothMouseX, [-1, 1], [-6, 6]);
  const farY = useTransform(smoothMouseY, [-1, 1], [-4, 4]);
  const midX = useTransform(smoothMouseX, [-1, 1], [-16, 16]);
  const midY = useTransform(smoothMouseY, [-1, 1], [-12, 12]);
  const nearX = useTransform(smoothMouseX, [-1, 1], [-30, 30]);
  const nearY = useTransform(smoothMouseY, [-1, 1], [-22, 22]);
  const hudX = useTransform(smoothMouseX, [-1, 1], [-44, 44]);
  const hudY = useTransform(smoothMouseY, [-1, 1], [-32, 32]);

  useEffect(() => {
    if (reducedMotion) return;

    let raf = 0;
    let nx = 0;
    let ny = 0;
    let scheduled = false;

    const flush = () => {
      mouseX.set(nx);
      mouseY.set(ny);
      scheduled = false;
    };

    const onMove = (e: MouseEvent) => {
      nx = (e.clientX / window.innerWidth) * 2 - 1;
      ny = (e.clientY / window.innerHeight) * 2 - 1;
      if (!scheduled) {
        scheduled = true;
        raf = requestAnimationFrame(flush);
      }
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [mouseX, mouseY, reducedMotion]);

  return (
    <div className="product-background" aria-hidden="true">
      <motion.div className="product-background-zoom" style={{ scale: scrollZoom, opacity: scrollFade }}>
        <svg
          viewBox="0 0 1920 1080"
          preserveAspectRatio="xMidYMid slice"
          xmlns="http://www.w3.org/2000/svg"
          role="presentation"
        >
          <defs>
            <radialGradient id="atom-blue" cx="35%" cy="35%" r="65%">
              <stop offset="0%" stopColor="#e3f4ff" />
              <stop offset="55%" stopColor="#3a93cc" />
              <stop offset="100%" stopColor="#0a324d" />
            </radialGradient>
            <radialGradient id="atom-cyan" cx="35%" cy="35%" r="65%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="55%" stopColor="#62d7ec" />
              <stop offset="100%" stopColor="#0a4859" />
            </radialGradient>
            <radialGradient id="atom-pink" cx="35%" cy="35%" r="65%">
              <stop offset="0%" stopColor="#ffe5ee" />
              <stop offset="55%" stopColor="#e07eaa" />
              <stop offset="100%" stopColor="#4e1c33" />
            </radialGradient>
            <linearGradient id="hex-glass" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="rgba(140, 230, 255, 0.42)" />
              <stop offset="60%" stopColor="rgba(70, 175, 230, 0.18)" />
              <stop offset="100%" stopColor="rgba(20, 80, 120, 0.08)" />
            </linearGradient>
            <radialGradient id="travel-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="40%" stopColor="#9ce4ff" />
              <stop offset="100%" stopColor="rgba(120, 210, 245, 0)" />
            </radialGradient>
            <linearGradient id="scan-line" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgba(160, 220, 255, 0)" />
              <stop offset="35%" stopColor="rgba(160, 220, 255, 0.16)" />
              <stop offset="65%" stopColor="rgba(160, 220, 255, 0.16)" />
              <stop offset="100%" stopColor="rgba(160, 220, 255, 0)" />
            </linearGradient>

            <filter id="hex-soft-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4.5" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="atom-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="travel-glow-filter" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="2.4" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="dof-blur" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="1.6" />
            </filter>
          </defs>

          <FarLayer x={farX} y={farY} reducedMotion={reducedMotion} />
          <MidLayer x={midX} y={midY} reducedMotion={reducedMotion} />
          <NearLayer x={nearX} y={nearY} reducedMotion={reducedMotion} />
          <HudLayer x={hudX} y={hudY} reducedMotion={reducedMotion} />
        </svg>
      </motion.div>
    </div>
  );
}
