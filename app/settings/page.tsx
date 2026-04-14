"use client";

import { useStore } from "@/lib/store";
import { EXAMPLE_MESSAGES } from "@/lib/coaching";
import type { CoachMode } from "@/lib/types";
import { ArrowLeft, Check } from "lucide-react";
import Link from "next/link";

const COACH_OPTIONS: Array<{
  mode: CoachMode;
  label: string;
  description: string;
  color: string;
}> = [
  {
    mode: "hardcore",
    label: "Hardcore",
    description: "High accountability. Aggressive. No excuses. David Goggins energy.",
    color: "#EF4444",
  },
  {
    mode: "balanced",
    label: "Balanced Coach",
    description: "Honest and supportive. Data-driven insights with practical guidance.",
    color: "#C9A227",
  },
  {
    mode: "recovery",
    label: "Recovery Focused",
    description: "Gentle and encouraging. Wellness-first perspective. Compassionate tone.",
    color: "#22C55E",
  },
];

export default function SettingsPage() {
  const coachingPrefs = useStore((s) => s.coachingPrefs);
  const setCoachingPrefs = useStore((s) => s.setCoachingPrefs);

  const handleModeSelect = (mode: CoachMode) => {
    setCoachingPrefs({ ...coachingPrefs, mode });
  };

  const exampleTier = "mid";

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/" className="text-text-muted hover:text-text-secondary transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-text-primary">Settings</h1>
          <p className="text-xs text-text-muted mt-0.5">Coaching preferences</p>
        </div>
      </div>

      {/* Coach mode selector */}
      <section>
        <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
          Coach Personality
        </h2>
        <div className="flex flex-col gap-3">
          {COACH_OPTIONS.map((option) => {
            const isActive = coachingPrefs.mode === option.mode;
            return (
              <button
                key={option.mode}
                onClick={() => handleModeSelect(option.mode)}
                className={`flex items-start gap-4 w-full text-left p-4 rounded-2xl border transition-all ${
                  isActive
                    ? "border-current bg-current/5"
                    : "border-bg-border bg-bg-card hover:border-text-muted"
                }`}
                style={isActive ? { borderColor: option.color, backgroundColor: `${option.color}10` } : {}}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="text-sm font-bold"
                      style={{ color: isActive ? option.color : "var(--text-primary)" }}
                    >
                      {option.label}
                    </span>
                    {isActive && (
                      <span
                        className="text-2xs font-semibold px-2 py-0.5 rounded-full"
                        style={{
                          backgroundColor: `${option.color}20`,
                          color: option.color,
                        }}
                      >
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-muted leading-relaxed">
                    {option.description}
                  </p>
                </div>
                <div
                  className={`mt-0.5 h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                    isActive ? "border-current" : "border-bg-border"
                  }`}
                  style={isActive ? { borderColor: option.color } : {}}
                >
                  {isActive && (
                    <Check size={10} style={{ color: option.color }} />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Preview */}
      <section>
        <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
          Message Preview — Moderate Recovery
        </h2>
        <div
          className="bg-bg-card border border-bg-border rounded-2xl p-5"
        >
          <div className="flex items-center gap-2 mb-3">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                backgroundColor: COACH_OPTIONS.find(
                  (o) => o.mode === coachingPrefs.mode
                )?.color,
              }}
            />
            <span
              className="text-2xs font-semibold uppercase tracking-widest"
              style={{
                color: COACH_OPTIONS.find((o) => o.mode === coachingPrefs.mode)
                  ?.color,
              }}
            >
              {COACH_OPTIONS.find((o) => o.mode === coachingPrefs.mode)?.label}
            </span>
          </div>
          <blockquote
            className="text-sm text-text-primary leading-relaxed"
            style={{
              borderLeft: `2px solid ${COACH_OPTIONS.find((o) => o.mode === coachingPrefs.mode)?.color}`,
              paddingLeft: "12px",
            }}
          >
            {EXAMPLE_MESSAGES[coachingPrefs.mode][exampleTier]}
          </blockquote>
        </div>
      </section>

      {/* About */}
      <section className="bg-bg-card border border-bg-border rounded-2xl p-4">
        <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
          About Recovery Engine
        </h2>
        <div className="flex flex-col gap-2">
          <InfoRow label="Version" value="0.1.0" />
          <InfoRow label="Score Algorithm" value="v1 (weighted model)" />
          <InfoRow label="Data Storage" value="Local device" />
          <InfoRow label="Supabase Sync" value="Not connected" />
        </div>
      </section>

      {/* Score weights info */}
      <section className="bg-bg-card border border-bg-border rounded-2xl p-4">
        <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
          Score Weights
        </h2>
        <div className="flex flex-col gap-3">
          <WeightRow label="Sleep Quality + Duration" weight={30} color="#818CF8" />
          <WeightRow label="HRV / Resting HR" weight={25} color="#22C55E" />
          <WeightRow label="Training Load Balance" weight={20} color="#F59E0B" />
          <WeightRow label="Nutrition" weight={20} color="#C9A227" />
          <WeightRow label="Recovery Modalities" weight={5} color="#EF4444" />
        </div>
        <p className="text-xs text-text-secondary mt-4 leading-relaxed">
          Blood lab results (when available within 90 days) modify the final score by up to ±12 points
          based on 41 biomarkers across hormones, metabolic health, inflammation, and nutrient status.
        </p>
      </section>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="text-xs text-text-secondary font-medium">{value}</span>
    </div>
  );
}

function WeightRow({ label, weight, color }: { label: string; weight: number; color: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between">
        <span className="text-xs text-text-secondary">{label}</span>
        <span className="text-xs font-bold" style={{ color }}>
          {weight}%
        </span>
      </div>
      <div className="h-1 bg-bg-border rounded-full overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${weight}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
