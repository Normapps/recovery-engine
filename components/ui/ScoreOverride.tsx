"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { getScoreColor } from "@/lib/recovery-engine";
import { format } from "date-fns";

interface Props {
  date?: string;
  calculatedScore: number;
  adjustedScore: number | null;
}

export default function ScoreOverride({ date, calculatedScore, adjustedScore }: Props) {
  const setAdjustedScore = useStore((s) => s.setAdjustedScore);
  const [value, setValue] = useState(adjustedScore ?? calculatedScore);
  const [active, setActive] = useState(adjustedScore !== null);

  const targetDate = date ?? format(new Date(), "yyyy-MM-dd");
  const delta = value - calculatedScore;
  const color = getScoreColor(value);

  const handleToggle = () => {
    if (active) {
      setActive(false);
      setAdjustedScore(targetDate, null);
      setValue(calculatedScore);
    } else {
      setActive(true);
    }
  };

  const handleCommit = () => {
    if (active) setAdjustedScore(targetDate, value);
  };

  return (
    <div className="bg-bg-card border border-bg-border rounded-2xl p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
          Manual Override
        </span>
        <button
          onClick={handleToggle}
          className={`text-2xs font-semibold px-3 py-1 rounded-full border transition-colors ${
            active
              ? "border-gold text-gold"
              : "border-bg-border text-text-muted hover:border-text-muted"
          }`}
        >
          {active ? "Override Active" : "Enable Override"}
        </button>
      </div>

      {active && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-2xs text-text-muted">
              Algorithm: <span className="text-text-secondary">{calculatedScore}</span>
            </span>
            <span className="text-2xs text-text-muted">
              Your Score:{" "}
              <span className="font-bold tabular-nums" style={{ color }}>
                {value}
              </span>
            </span>
            {delta !== 0 && (
              <span
                className={`text-2xs font-semibold ${delta > 0 ? "text-recovery-high" : "text-recovery-low"}`}
              >
                {delta > 0 ? "+" : ""}
                {delta}
              </span>
            )}
          </div>

          <input
            type="range"
            min={0}
            max={100}
            value={value}
            onChange={(e) => setValue(parseInt(e.target.value))}
            onMouseUp={handleCommit}
            onTouchEnd={handleCommit}
            className="w-full accent-gold h-1 rounded-full bg-bg-border cursor-pointer"
            style={{ accentColor: color }}
          />

          <div className="flex justify-between text-2xs text-text-muted">
            <span>0</span>
            <span>50</span>
            <span>100</span>
          </div>
        </div>
      )}
    </div>
  );
}
