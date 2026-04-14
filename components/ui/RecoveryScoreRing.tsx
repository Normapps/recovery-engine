"use client";

import { useEffect, useRef, useState } from "react";
import { getScoreColor } from "@/lib/recovery-engine";
import type { ConfidenceLevel } from "@/lib/types";

interface Props {
  score: number;
  confidence: ConfidenceLevel;
  size?: number;
  strokeWidth?: number;
  animated?: boolean;
}

export default function RecoveryScoreRing({
  score,
  confidence,
  size = 220,
  strokeWidth = 14,
  animated = true,
}: Props) {
  const [displayScore, setDisplayScore] = useState(animated ? 0 : score);
  const [progress, setProgress] = useState(0);
  const animRef = useRef<number | null>(null);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const color = getScoreColor(score);

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
              filter: `drop-shadow(0 0 8px ${color}55)`,
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
            Recovery
          </span>
        </div>
      </div>

      {/* Confidence badge */}
      <div className="flex items-center gap-2">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: confidenceColor }}
        />
        <span className="text-2xs text-text-muted uppercase tracking-widest">
          {confidence} Confidence
        </span>
      </div>
    </div>
  );
}
