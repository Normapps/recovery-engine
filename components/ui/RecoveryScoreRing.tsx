"use client";

import { useEffect, useRef, useState } from "react";
import { getScoreColor } from "@/lib/recovery-engine";
import type { ConfidenceLevel } from "@/lib/types";

// ─── Color palettes ───────────────────────────────────────────────────────────
// Both variants use the same green / amber / red zone logic.
// "muted"  → softer tones (Recovery ring)
// "vivid"  → more saturated tones (Readiness ring)

const SCORE_COLORS = {
  muted: {
    high: "#4ADE80",  // green-400  — softer green
    mid:  "#FCD34D",  // amber-300  — softer amber
    low:  "#F87171",  // red-400    — softer red
  },
  vivid: {
    high: "#22C55E",  // green-500  — bright, clean green (legible glow source)
    mid:  "#F59E0B",  // amber-500  — bright amber
    low:  "#EF4444",  // red-500    — bright red
  },
} as const;

function getVariantColor(score: number, variant: "muted" | "vivid"): string {
  const palette = SCORE_COLORS[variant];
  if (score >= 71) return palette.high;
  if (score >= 41) return palette.mid;
  return palette.low;
}

interface Props {
  score: number;
  confidence: ConfidenceLevel;
  size?: number;
  strokeWidth?: number;
  animated?: boolean;
  label?: string;
  colorVariant?: "muted" | "vivid";
}

export default function RecoveryScoreRing({
  score,
  confidence,
  size = 220,
  strokeWidth = 14,
  animated = true,
  label = "Recovery",
  colorVariant,
}: Props) {
  const [displayScore, setDisplayScore] = useState(animated ? 0 : score);
  const [progress, setProgress] = useState(0);
  const animRef = useRef<number | null>(null);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const color = colorVariant ? getVariantColor(score, colorVariant) : getScoreColor(score);

  // Animate number and ring on mount / score change
  useEffect(() => {
    if (!animated) {
      setDisplayScore(score);
      setProgress(score / 100);
      return;
    }

    const duration = 900;
    const startTime = performance.now();
    const startScore = 0;

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayScore(Math.round(startScore + (score - startScore) * eased));
      setProgress(eased * (score / 100));
      if (t < 1) animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [score, animated]);

  const strokeDashoffset = circumference * (1 - progress);

  const confidenceColor =
    confidence === "High"
      ? "#22C55E"
      : confidence === "Medium"
      ? "#F59E0B"
      : "#EF4444";

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          className="rotate-[-90deg]"
          style={{ display: "block" }}
        >
          {/* Track ring */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#1E2D3D"
            strokeWidth={strokeWidth}
          />
          {/* Progress ring */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            style={{
              filter: colorVariant === "vivid"
                // Two-layer glow: tight full-opacity edge + medium outer ambient.
                // First layer (3px, no alpha) = crisp stroke highlight.
                // Second layer (10px, 60% opacity) = controlled outer spread.
                // contrast(1.1) sharpens the arc; brightness(1.05) lifts the vivid tone.
                // NOTE: inner highlight and arc-tip marker would require additional SVG
                //       elements (inner circle + endpoint circle); leaving as future TODO.
                ? `drop-shadow(0 0 3px ${color}) drop-shadow(0 0 10px ${color}99) contrast(1.1) brightness(1.05)`
                : `drop-shadow(0 0 8px ${color}55)`,
              transition: animated ? "none" : "stroke-dashoffset 0.3s ease",
            }}
          />
        </svg>

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="font-bold text-text-primary leading-none tabular-nums"
            style={{ fontSize: size * 0.27, color }}
          >
            {displayScore}
          </span>
          <span
            className="text-text-secondary uppercase tracking-widest mt-1"
            style={{ fontSize: size * 0.065 }}
          >
            {label}
          </span>
        </div>
      </div>

      {/* Confidence badge */}
      <div className="flex items-center gap-2">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: confidenceColor }}
        />
        <span className="text-xs text-text-secondary uppercase tracking-widest">
          {confidence} Confidence
        </span>
      </div>
    </div>
  );
}
