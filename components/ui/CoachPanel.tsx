"use client";

import type { CoachMode } from "@/lib/types";

interface Props {
  message: string;
  mode: CoachMode;
}

const MODE_META: Record<CoachMode, { label: string; color: string }> = {
  hardcore: { label: "Hardcore Mode", color: "#EF4444" },
  balanced: { label: "Balanced Coach", color: "#C9A227" },
  recovery: { label: "Recovery Focused", color: "#22C55E" },
};

export default function CoachPanel({ message, mode }: Props) {
  const meta = MODE_META[mode];

  return (
    <div className="bg-bg-card border border-bg-border rounded-2xl p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: meta.color }}
        />
        <span
          className="text-2xs font-semibold uppercase tracking-widest"
          style={{ color: meta.color }}
        >
          {meta.label}
        </span>
      </div>

      <blockquote
        className="text-sm text-text-primary leading-relaxed font-normal"
        style={{ borderLeft: `2px solid ${meta.color}`, paddingLeft: "12px" }}
      >
        {message}
      </blockquote>
    </div>
  );
}
