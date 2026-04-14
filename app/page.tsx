"use client";

import React, { useEffect, useState } from "react";
import { format } from "date-fns";
import Link from "next/link";
import { useStore, useLatestBloodwork } from "@/lib/store";
import { getEffectiveScore } from "@/lib/recovery-engine";
import { generateCoachMessage } from "@/lib/coaching";
import { generateSeedData } from "@/lib/seed-data";
import RecoveryScoreRing from "@/components/ui/RecoveryScoreRing";
import ScoreOverride from "@/components/ui/ScoreOverride";
import {
  Moon, Zap, Dumbbell, Utensils, FlaskConical,
  ChevronRight, TrendingUp, PlusCircle, X, Check,
} from "lucide-react";
import { analyzeBloodwork } from "@/lib/bloodwork-engine";
import {
  unifiedRecoveryEngine,
  buildUnifiedInput,
  type ModalityRecommendation,
} from "@/lib/modality-recommendations";
import { upsertDailyCheckin, upsertPlanTasks } from "@/lib/supabase";
import { type PlanTaskItem, type PlanCategory } from "@/lib/types";
import { generateDailyPlan, type DailyPlan } from "@/lib/daily-plan";
import { generatePlanDetails, type PlanSection, type NutritionSection, type PlanDetails } from "@/lib/plan-details";
import {
  generateAIPrescriptions,
  type AIPrescriptionOutput,
  type AIRecoveryProtocol,
  type AIMobilityProtocol,
  type AINutritionProtocol,
} from "@/lib/ai-prescriptions";
import { computeDashboardReadiness } from "@/lib/scoring-pipeline";
import {
  getTodayDay, getTomorrowDay, getDayPlan, TYPE_COLOR, TYPE_LABEL,
} from "@/lib/training-engine";
import type { RecoveryScore, DailyEntry, TrainingPlan } from "@/lib/types";

// ─── Breakdown card ──────────────────────────────────────────────────────

function ScoreCard({
  icon,
  label,
  score,
  details,
  fullWidth = false,
}: {
  icon: React.ReactNode;
  label: string;
  score: number;
  details: string[];
  fullWidth?: boolean;
}) {
  const color =
    score >= 71 ? "#22C55E" : score >= 41 ? "#F59E0B" : "#EF4444";

  return (
    <div
      className={`bg-bg-card border border-bg-border rounded-2xl p-4 flex flex-col gap-3 ${
        fullWidth ? "col-span-2" : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-text-muted">{icon}</span>
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
            {label}
          </span>
        </div>
        <span className="text-2xl font-extrabold tabular-nums" style={{ color }}>
          {Math.round(score)}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1 w-full rounded-full bg-bg-border overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${score}%`, backgroundColor: color }}
        />
      </div>

      {/* Stats */}
      <div className="flex flex-col gap-0.5">
        {details.map((d, i) => (
          <span key={i} className="text-xs text-text-muted leading-relaxed">
            {d}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Mood picker ──────────────────────────────────────────────────────────

const MOOD_EMOJI = ["😔", "😕", "😐", "🙂", "😄"] as const;

function MoodPicker({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number) => void;
}) {
  return (
    <div className="bg-bg-card border border-bg-border rounded-2xl px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold text-text-secondary uppercase tracking-widest">
          How do you feel today?
        </p>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-text-secondary">low</span>
          <span className="text-xs text-text-secondary mx-1">·</span>
          <span className="text-xs text-text-secondary">great</span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        {[1, 2, 3, 4, 5].map((n) => {
          const active = value === n;
          return (
            <button
              key={n}
              onClick={() => onChange(n)}
              className={`flex-1 flex flex-col items-center gap-1.5 py-2.5 rounded-xl transition-all ${
                active
                  ? "bg-gold/15 border border-gold/50"
                  : "bg-bg-elevated border border-bg-border hover:border-text-muted/30"
              }`}
            >
              <span className="text-xl leading-none">{MOOD_EMOJI[n - 1]}</span>
              <span
                className={`text-xs font-bold tabular-nums ${
                  active ? "text-gold" : "text-text-secondary"
                }`}
              >
                {n}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Modality recommendation card ────────────────────────────────────────

function ModalityCard({ rec }: { rec: ModalityRecommendation }) {
  const durationLabel = rec.duration >= 60
    ? `${rec.duration / 60}h`
    : `${rec.duration} min`;

  return (
    <div className="bg-bg-card border border-bg-border rounded-2xl px-5 py-4 flex flex-col gap-2">
      <div className="flex items-center gap-4">
        <div className="w-9 h-9 rounded-xl bg-gold/10 border border-gold/20 flex items-center justify-center shrink-0">
          <Zap size={16} className="text-gold" />
        </div>
        <span className="flex-1 text-sm font-semibold text-text-primary">{rec.name}</span>
        <span className="text-xs font-bold text-gold tabular-nums shrink-0">{durationLabel}</span>
      </div>
      <p className="text-xs text-text-muted leading-relaxed pl-[52px]">{rec.reason}</p>
    </div>
  );
}

// ─── Today's Plan — detail modal ─────────────────────────────────────────

function PlanDetailModal({
  section,
  onClose,
}: {
  section:  PlanSection | null;
  onClose:  () => void;
}) {
  useEffect(() => {
    if (!section) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [section, onClose]);

  if (!section) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-bg-card border border-bg-border rounded-t-3xl p-6 flex flex-col gap-5 max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-bold text-text-primary">{section.title}</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary shrink-0 mt-0.5">
            <X size={18} />
          </button>
        </div>

        {/* Overview */}
        <div>
          <p className="text-xs font-bold text-text-secondary uppercase tracking-widest mb-1.5">Overview</p>
          <p className="text-sm text-text-primary leading-relaxed">{section.overview}</p>
        </div>

        <div className="h-px bg-bg-border" />

        {/* Instructions */}
        <div>
          <p className="text-xs font-bold text-text-secondary uppercase tracking-widest mb-2.5">Instructions</p>
          <ul className="flex flex-col gap-2.5">
            {section.instructions.map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="text-gold font-bold text-xs mt-0.5 shrink-0 tabular-nums w-4">{i + 1}</span>
                <p className="text-xs text-text-primary leading-relaxed">{step}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="h-px bg-bg-border" />

        {/* Structure */}
        <div>
          <p className="text-xs font-bold text-text-secondary uppercase tracking-widest mb-1.5">Structure</p>
          <p className="text-xs font-mono bg-bg-elevated border border-bg-border rounded-xl px-3 py-2.5 text-text-secondary leading-relaxed">
            {section.structure}
          </p>
        </div>

        <div className="h-px bg-bg-border" />

        {/* Coaching note */}
        <div>
          <p className="text-xs font-bold text-text-secondary uppercase tracking-widest mb-1.5">Coach's Note</p>
          <p className="text-xs text-gold leading-relaxed">{section.coachingNote}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Today's Plan — nutrition detail modal ───────────────────────────────

function NutritionDetailModal({
  section,
  onClose,
}: {
  section: NutritionSection | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!section) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [section, onClose]);

  if (!section) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-bg-card border border-bg-border rounded-t-3xl p-6 flex flex-col gap-5 max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-bold text-text-primary">{section.title}</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary shrink-0 mt-0.5">
            <X size={18} />
          </button>
        </div>

        {/* Overview */}
        <div>
          <p className="text-xs font-bold text-text-secondary uppercase tracking-widest mb-1.5">Overview</p>
          <p className="text-sm text-text-primary leading-relaxed">{section.overview}</p>
        </div>

        <div className="h-px bg-bg-border" />

        {/* Protein */}
        <div>
          <p className="text-xs font-bold text-text-secondary uppercase tracking-widest mb-2">Protein Target</p>
          <div className="flex items-baseline gap-2 mb-1.5">
            <span className="text-xl font-extrabold text-gold tabular-nums">{section.protein.totalGrams}g</span>
            <span className="text-xs text-text-muted">daily · {section.protein.perMeal}g per meal</span>
          </div>
          <p className="text-xs text-text-primary leading-relaxed mb-2">{section.protein.guidance}</p>
          <ul className="flex flex-col gap-1">
            {section.protein.foods.map((f, i) => (
              <li key={i} className="text-xs text-text-muted leading-relaxed flex items-start gap-2">
                <span className="text-gold mt-0.5 shrink-0">·</span>
                {f}
              </li>
            ))}
          </ul>
        </div>

        <div className="h-px bg-bg-border" />

        {/* Carbs */}
        <div>
          <p className="text-xs font-bold text-text-secondary uppercase tracking-widest mb-2">Carbohydrates</p>
          <div className="flex items-baseline gap-2 mb-1.5">
            <span className="text-xl font-extrabold text-gold tabular-nums">{section.carbs.totalGrams}g</span>
            <span className="text-xs text-text-muted">daily</span>
          </div>
          <p className="text-xs text-text-primary leading-relaxed mb-2">{section.carbs.timing}</p>
          <ul className="flex flex-col gap-1">
            {section.carbs.foods.map((f, i) => (
              <li key={i} className="text-xs text-text-muted leading-relaxed flex items-start gap-2">
                <span className="text-gold mt-0.5 shrink-0">·</span>
                {f}
              </li>
            ))}
          </ul>
        </div>

        <div className="h-px bg-bg-border" />

        {/* Hydration */}
        <div>
          <p className="text-xs font-bold text-text-secondary uppercase tracking-widest mb-2">Hydration</p>
          <div className="flex items-baseline gap-2 mb-1.5">
            <span className="text-xl font-extrabold text-gold tabular-nums">{section.hydration.totalOz}oz</span>
            <span className="text-xs text-text-muted">target today</span>
          </div>
          <p className="text-xs text-text-primary leading-relaxed">{section.hydration.schedule}</p>
        </div>

        {/* Micronutrients (optional) */}
        {section.micronutrients && (
          <>
            <div className="h-px bg-bg-border" />
            <div>
              <p className="text-xs font-bold text-text-secondary uppercase tracking-widest mb-2">Micronutrients</p>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {section.micronutrients.focus.map((m, i) => (
                  <span key={i} className="text-2xs font-bold px-2 py-0.5 rounded-full bg-gold/10 border border-gold/20 text-gold">
                    {m}
                  </span>
                ))}
              </div>
              <p className="text-xs text-text-muted leading-relaxed">{section.micronutrients.note}</p>
            </div>
          </>
        )}

        <div className="h-px bg-bg-border" />

        {/* Coaching note */}
        <div>
          <p className="text-xs font-bold text-text-secondary uppercase tracking-widest mb-1.5">Coach's Note</p>
          <p className="text-xs text-gold leading-relaxed">{section.coachingNote}</p>
        </div>
      </div>
    </div>
  );
}

// ─── AI modals (shared shell) ────────────────────────────────────────────

function AIModalShell({
  title,
  onClose,
  children,
}: {
  title:   string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-bg-card border border-bg-border rounded-t-3xl p-6 flex flex-col gap-5 max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-bold text-text-primary">{title}</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary shrink-0 mt-0.5">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AISectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-bold text-text-secondary uppercase tracking-widest mb-1.5">
      {children}
    </p>
  );
}

function AIDivider() {
  return <div className="h-px bg-bg-border" />;
}

// ─── AI Recovery modal ────────────────────────────────────────────────────

function AIRecoveryModal({
  protocol,
  onClose,
}: {
  protocol: AIRecoveryProtocol | null;
  onClose:  () => void;
}) {
  if (!protocol) return null;
  return (
    <AIModalShell title="Today's Recovery" onClose={onClose}>
      <div>
        <AISectionLabel>Overview</AISectionLabel>
        <p className="text-sm text-text-primary leading-relaxed">{protocol.overview}</p>
      </div>
      <AIDivider />
      <div>
        <AISectionLabel>Primary Modality</AISectionLabel>
        <p className="text-xs text-text-primary leading-relaxed">{protocol.primary_modality}</p>
      </div>
      <AIDivider />
      <div>
        <AISectionLabel>Secondary Modality</AISectionLabel>
        <p className="text-xs text-text-primary leading-relaxed">{protocol.secondary_modality}</p>
      </div>
      <AIDivider />
      <div>
        <AISectionLabel>Timing</AISectionLabel>
        <p className="text-xs font-mono bg-bg-elevated border border-bg-border rounded-xl px-3 py-2.5 text-text-secondary leading-relaxed">
          {protocol.timing}
        </p>
      </div>
      <AIDivider />
      <div>
        <AISectionLabel>Coach's Note</AISectionLabel>
        <p className="text-xs text-gold leading-relaxed">{protocol.coaching_note}</p>
      </div>
    </AIModalShell>
  );
}

// ─── AI Mobility modal ────────────────────────────────────────────────────

function AIMobilityModal({
  protocol,
  onClose,
}: {
  protocol: AIMobilityProtocol | null;
  onClose:  () => void;
}) {
  if (!protocol) return null;
  const movements = [protocol.movement_1, protocol.movement_2, protocol.movement_3];
  return (
    <AIModalShell title="Today's Mobility" onClose={onClose}>
      <div>
        <AISectionLabel>Overview</AISectionLabel>
        <p className="text-sm text-text-primary leading-relaxed">{protocol.overview}</p>
      </div>
      <AIDivider />
      <div>
        <AISectionLabel>Movements</AISectionLabel>
        <ul className="flex flex-col gap-2.5">
          {movements.map((m, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="text-gold font-bold text-xs mt-0.5 shrink-0 tabular-nums w-4">{i + 1}</span>
              <p className="text-xs text-text-primary leading-relaxed">{m}</p>
            </li>
          ))}
        </ul>
      </div>
      <AIDivider />
      <div>
        <AISectionLabel>Structure</AISectionLabel>
        <p className="text-xs font-mono bg-bg-elevated border border-bg-border rounded-xl px-3 py-2.5 text-text-secondary leading-relaxed">
          {protocol.structure}
        </p>
      </div>
      <AIDivider />
      <div>
        <AISectionLabel>Coach's Note</AISectionLabel>
        <p className="text-xs text-gold leading-relaxed">{protocol.coaching_note}</p>
      </div>
    </AIModalShell>
  );
}

// ─── AI Nutrition modal ───────────────────────────────────────────────────

function AINutritionModal({
  protocol,
  onClose,
}: {
  protocol: AINutritionProtocol | null;
  onClose:  () => void;
}) {
  if (!protocol) return null;
  return (
    <AIModalShell title="Today's Nutrition" onClose={onClose}>
      <div>
        <AISectionLabel>Overview</AISectionLabel>
        <p className="text-sm text-text-primary leading-relaxed">{protocol.overview}</p>
      </div>
      <AIDivider />
      <div>
        <AISectionLabel>Protein</AISectionLabel>
        <p className="text-xs text-text-primary leading-relaxed">{protocol.protein}</p>
      </div>
      <AIDivider />
      <div>
        <AISectionLabel>Carbohydrates</AISectionLabel>
        <p className="text-xs text-text-primary leading-relaxed">{protocol.carbs}</p>
      </div>
      <AIDivider />
      <div>
        <AISectionLabel>Hydration</AISectionLabel>
        <p className="text-xs text-text-primary leading-relaxed">{protocol.hydration}</p>
      </div>
      <AIDivider />
      <div>
        <AISectionLabel>Micronutrients</AISectionLabel>
        <p className="text-xs text-text-primary leading-relaxed">{protocol.micronutrients}</p>
      </div>
      <AIDivider />
      <div>
        <AISectionLabel>Coach's Note</AISectionLabel>
        <p className="text-xs text-gold leading-relaxed">{protocol.coaching_note}</p>
      </div>
    </AIModalShell>
  );
}

// ─── Execution overlay ────────────────────────────────────────────────────────

// Timing constants (ms) — shared between component and hook
const EXEC_FADE_IN  = 400;
const EXEC_HOLD     = 1400;
const EXEC_FADE_OUT = 600;
const EXEC_TOTAL    = EXEC_FADE_IN + EXEC_HOLD + EXEC_FADE_OUT;

/**
 * ExecutionOverlay
 *
 * Centered fixed overlay that appears when the athlete completes every task
 * in Today's Plan. No background blocking — pointer-events-none throughout.
 *
 * Lifecycle:
 *   visible=true → scale+fade in (400 ms) → hold (1 400 ms) → scale+fade out (600 ms)
 *
 * The once-per-day gate lives in useExecutionToast (unchanged).
 */
function ExecutionToast({ visible }: { visible: boolean }) {
  const [phase, setPhase] = useState<"hidden" | "in" | "hold" | "out">("hidden");

  useEffect(() => {
    if (!visible) return;
    setPhase("in");
    const holdTimer = setTimeout(() => setPhase("hold"), EXEC_FADE_IN);
    const outTimer  = setTimeout(() => setPhase("out"),  EXEC_FADE_IN + EXEC_HOLD);
    const hideTimer = setTimeout(() => setPhase("hidden"), EXEC_TOTAL);
    return () => {
      clearTimeout(holdTimer);
      clearTimeout(outTimer);
      clearTimeout(hideTimer);
    };
  }, [visible]);

  if (phase === "hidden") return null;

  const animClass =
    phase === "in"   ? `animate-[executionIn_${EXEC_FADE_IN}ms_cubic-bezier(0.34,1.2,0.64,1)_forwards]` :
    phase === "hold" ? ""                                                                                   :
                       `animate-[executionOut_${EXEC_FADE_OUT}ms_ease-in_forwards]`;

  return (
    <div
      aria-live="polite"
      className={`fixed top-1/2 left-1/2 z-50 pointer-events-none ${animClass}`}
      style={{ transform: "translate(-50%, -50%)" }}
    >
      <div className="flex flex-col items-center gap-3 px-10 py-8">
        {/* Checkmark with glow */}
        <div
          className="w-14 h-14 rounded-full border border-emerald-500/40 bg-emerald-950/60 backdrop-blur-sm flex items-center justify-center"
          style={{ boxShadow: "0 0 24px 4px rgba(52,211,153,0.25), 0 0 6px 1px rgba(52,211,153,0.4)" }}
        >
          <Check size={26} strokeWidth={2.5} className="text-emerald-400" />
        </div>

        {/* Label */}
        <p
          className="text-sm font-semibold text-emerald-300 tracking-widest uppercase whitespace-nowrap"
          style={{ textShadow: "0 0 12px rgba(52,211,153,0.5)" }}
        >
          You executed today.
        </p>
      </div>
    </div>
  );
}

/**
 * useExecutionToast
 *
 * Watches the plan-task list and fires the overlay exactly once per calendar
 * day the moment all tasks are completed.
 *
 * @param tasks   Current day's PlanTaskItem array (empty array = no-op)
 * @param dateKey YYYY-MM-DD key for today — resets the gate on a new day
 */
function useExecutionToast(tasks: PlanTaskItem[], dateKey: string): boolean {
  const [toastVisible, setToastVisible] = useState(false);
  const firedDateRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (tasks.length === 0) return;
    if (firedDateRef.current === dateKey) return;
    if (!tasks.every((t) => t.completed)) return;

    firedDateRef.current = dateKey;
    setToastVisible(true);

    const reset = setTimeout(() => setToastVisible(false), EXEC_TOTAL + 100);
    return () => clearTimeout(reset);
  }, [tasks, dateKey]);

  return toastVisible;
}

// ─── Plan task helpers ───────────────────────────────────────────────────────

/**
 * Synthesises 3 concise, checkable action items from the structured nutrition
 * section (which has no `instructions` array unlike the other PlanSections).
 */
function getNutritionTaskTexts(n: NutritionSection): string[] {
  return [
    `Hit ${n.protein.totalGrams}g protein (${n.protein.perMeal}g per meal)`,
    `Hydrate to ${n.hydration.totalOz}oz today`,
    n.micronutrients
      ? `Focus on ${n.micronutrients.focus.slice(0, 2).join(" and ")}`
      : "Time carbs around your training window",
  ];
}

/**
 * Builds a fresh PlanTaskItem[] from planDetails for the given date.
 * All items start as incomplete — callers should merge against stored state
 * to preserve completion.
 */
function buildPlanTasks(
  date:           string,
  details:        PlanDetails,
  nutritionTexts: string[],
  injuryActive =  false,
): PlanTaskItem[] {
  const cats: Array<{ key: PlanCategory; instructions: string[] }> = [
    { key: "training",  instructions: details.training.instructions },
    { key: "recovery",  instructions: details.recovery.instructions },
    { key: "mobility",  instructions: details.mobility.instructions },
    { key: "nutrition", instructions: nutritionTexts },
  ];

  if (injuryActive) {
    cats.push({
      key: "rehab",
      instructions: [
        "Complete prescribed rehabilitation exercises",
        "Apply ice or compression to the injured area for 15 minutes",
        "Check in with your physiotherapist if pain increases",
      ],
    });
  }

  const items: PlanTaskItem[] = [];
  for (const { key, instructions } of cats) {
    instructions.forEach((text, i) => {
      items.push({ id: `${date}-${key}-${i}`, text, category: key, completed: false });
    });
  }
  return items;
}

// ─── Today's Plan card ───────────────────────────────────────────────────

const PLAN_SECTIONS: Array<{
  key:   keyof DailyPlan;
  label: string;
  icon:  React.ReactNode;
}> = [
  { key: "training",  label: "Training",  icon: <Dumbbell   size={12} /> },
  { key: "recovery",  label: "Recovery",  icon: <Zap        size={12} /> },
  { key: "mobility",  label: "Mobility",  icon: <TrendingUp size={12} /> },
  { key: "nutrition", label: "Nutrition", icon: <Utensils   size={12} /> },
];

function TodaysPlanCard({
  plan,
  details,
  tasks,
  onToggle,
}: {
  plan:     DailyPlan;
  details:  PlanDetails;
  tasks:    PlanTaskItem[];
  onToggle: (taskId: string) => void;
}) {
  const [openKey, setOpenKey] = useState<keyof DailyPlan | null>(null);
  const nonNutritionSection = openKey && openKey !== "nutrition"
    ? details[openKey] as PlanSection
    : null;
  const nutritionSection = openKey === "nutrition" ? details.nutrition : null;

  return (
    <>
      <div className="bg-bg-card border border-bg-border rounded-2xl p-4 flex flex-col gap-3">
        <p className="text-xs font-bold text-text-muted uppercase tracking-widest">
          Today's Plan
        </p>
        {PLAN_SECTIONS.map(({ key, label, icon }, i) => {
          const sectionTasks = tasks.filter((t) => t.category === key);
          const allDone = sectionTasks.length > 0 && sectionTasks.every((t) => t.completed);
          return (
            <div key={key}>
              {i > 0 && <div className="h-px bg-bg-border mb-3" />}

              {/* Section header — tapping opens the detail modal */}
              <button
                className="w-full text-left group mb-2"
                onClick={() => setOpenKey(key)}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className={`transition-colors ${allDone ? "text-emerald-400/60" : "text-text-muted"}`}>
                      {icon}
                    </span>
                    <span className={`text-xs font-semibold uppercase tracking-wider transition-colors ${
                      allDone ? "text-emerald-400/70" : "text-text-secondary"
                    }`}>
                      {label}
                    </span>
                    {allDone && (
                      <Check size={10} strokeWidth={3} className="text-emerald-400/70" />
                    )}
                  </div>
                  <ChevronRight size={12} className="text-text-muted shrink-0 group-hover:text-text-secondary transition-colors" />
                </div>
              </button>

              {/* Per-instruction checklist */}
              <div className="flex flex-col gap-1 pl-[19px]">
                {sectionTasks.length > 0
                  ? sectionTasks.map((task) => (
                      <button
                        key={task.id}
                        onClick={() => onToggle(task.id)}
                        className="w-full text-left flex items-start gap-2.5 py-0.5 group/task"
                      >
                        {/* Circular checkbox */}
                        <div className={`mt-0.5 w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 transition-all duration-200 ${
                          task.completed
                            ? "border-emerald-500/50 bg-emerald-500/20"
                            : "border-white/20 group-hover/task:border-white/35"
                        }`}>
                          {task.completed && (
                            <Check size={8} strokeWidth={3} className="text-emerald-400" />
                          )}
                        </div>
                        {/* Task text */}
                        <span className={`text-xs leading-relaxed transition-all duration-200 ${
                          task.completed
                            ? "text-text-muted opacity-40 line-through decoration-text-muted/30"
                            : "text-text-primary"
                        }`}>
                          {task.text}
                        </span>
                      </button>
                    ))
                  : /* Fallback while tasks load */
                    <p className="text-xs text-text-primary leading-relaxed">{plan[key]}</p>
                }
              </div>
            </div>
          );
        })}
      </div>
      <PlanDetailModal section={nonNutritionSection} onClose={() => setOpenKey(null)} />
      <NutritionDetailModal section={nutritionSection} onClose={() => setOpenKey(null)} />
    </>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────

export default function Dashboard() {
  const todayScore        = useStore((s) => s.todayScore);
  const todayEntry        = useStore((s) => s.todayEntry);
  const coachingPrefs     = useStore((s) => s.coachingPrefs);
  const upsertEntry       = useStore((s) => s.upsertEntry);
  const upsertScore       = useStore((s) => s.upsertScore);
  const scores            = useStore((s) => s.scores);
  const trainingPlan      = useStore((s) => s.trainingPlan);
  const moodLog           = useStore((s) => s.moodLog);
  const setMood           = useStore((s) => s.setMood);
  const latestBloodwork   = useLatestBloodwork(90);
  const performanceProfile = useStore((s) => s.performanceProfile);

  useEffect(() => {
    if (Object.keys(scores).length === 0) {
      const { entries, scores: seedScores } = generateSeedData();
      Object.values(entries).forEach((e) => upsertEntry(e));
      Object.values(seedScores).forEach((s) => upsertScore(s));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const today    = format(new Date(), "EEEE, MMMM d").toUpperCase();
  const todayKey = format(new Date(), "yyyy-MM-dd");

  if (!todayScore || !todayEntry) {
    return <EmptyState today={today} />;
  }

  return <DashboardContent
    todayScore={todayScore}
    todayEntry={todayEntry}
    coachMode={coachingPrefs.mode}
    today={today}
    latestBloodwork={latestBloodwork}
    trainingPlan={trainingPlan}
    todayMood={moodLog[todayKey] ?? null}
    performanceProfile={performanceProfile}
    onMoodChange={(v) => {
      setMood(todayKey, v);
      upsertDailyCheckin(todayKey, v); // fire-and-forget; no-ops when Supabase not configured
    }}
  />;
}

function DashboardContent({
  todayScore,
  todayEntry,
  coachMode,
  today,
  latestBloodwork,
  trainingPlan,
  todayMood,
  performanceProfile,
  onMoodChange,
}: {
  todayScore:          RecoveryScore;
  todayEntry:          DailyEntry;
  coachMode:           "hardcore" | "balanced" | "recovery";
  today:               string;
  latestBloodwork:     ReturnType<typeof useLatestBloodwork>;
  trainingPlan:        TrainingPlan | null;
  todayMood:           number | null;
  performanceProfile:  import("@/lib/types").PerformanceProfile | null;
  onMoodChange:        (v: number) => void;
}) {
  const { breakdown, confidence } = todayScore;
  const dateKey = todayScore.date; // YYYY-MM-DD

  // ── Plan task checklist ───────────────────────────────────────────────────
  const planTaskLog    = useStore((s) => s.planTaskLog);
  const setPlanTaskLog = useStore((s) => s.setPlanTaskLog);
  const togglePlanTask = useStore((s) => s.togglePlanTask);
  const storedPlanTasks = planTaskLog[dateKey] ?? null;

  // ── Labs analysis ─────────────────────────────────────────────────────
  const bwAnalysis = latestBloodwork ? analyzeBloodwork(latestBloodwork.panel) : null;

  // ── Training plan context ─────────────────────────────────────────────
  const todayDay    = getTodayDay();
  const tomorrowDay = getTomorrowDay();
  const todayPlan    = trainingPlan ? getDayPlan(trainingPlan, todayDay)    : null;
  const tomorrowPlan = trainingPlan ? getDayPlan(trainingPlan, tomorrowDay) : null;

  // ── Ring score — use the stored authoritative score (stages 1–7 already applied) ───
  const score = getEffectiveScore(todayScore);

  // ── Psych delta — mood readiness signal layered on top of the physiological score ──
  // Formula: (moodRating - 3) × 7  →  range −14 to +14 pts
  //   1 → −14  (athlete feels poor — score suppressed)
  //   3 →   0  (neutral — no adjustment)
  //   5 → +14  (athlete feels great — score boosted)
  // Applied to display and recommendations only; the stored calculatedScore is unchanged.
  const psychDelta   = todayMood !== null ? (todayMood - 3) * 7 : 0;
  const displayScore = Math.max(0, Math.min(100, Math.round(score + psychDelta)));

  // ── Unified recovery engine — used only for modality recommendations + impact text ──
  // Pass bloodwork_modifier: 0 because the base score already includes the bloodwork delta
  // from computeFinalRecoveryScore; applying it again here would double-count it.
  // Pass todayMood so the engine can bias modality selection based on psych readiness.
  const unifiedInput = buildUnifiedInput(
    displayScore,
    breakdown,
    todayEntry,
    todayPlan,
    tomorrowPlan,
    latestBloodwork?.panel ?? null,
    0,
    todayMood,
    performanceProfile,
  );
  const unified = unifiedRecoveryEngine(unifiedInput);

  // ── Readiness score — ability to perform TODAY ───────────────────────────
  // Derived from displayScore + load, soreness, HRV trend, and sleep quality.
  // Uses data already present in DashboardContent; no extra store read needed.
  const AU_SOFT_CAP  = 600;
  const AU_MULT: Record<string, number> = { low: 3, moderate: 5, high: 8 };
  const todayAU    = todayPlan    && todayPlan.training_type    !== "off" ? todayPlan.duration    * AU_MULT[todayPlan.intensity]    : 0;
  const tomorrowAU = tomorrowPlan && tomorrowPlan.training_type !== "off" ? tomorrowPlan.duration * AU_MULT[tomorrowPlan.intensity] : 0;

  const {
    readiness_score:     readinessScore,
    readiness_breakdown: rdBreakdown,
  } = computeDashboardReadiness({
    recovery_score:      displayScore,
    load_today_score:    Math.min(100, Math.round((todayAU    / AU_SOFT_CAP) * 100)),
    load_tomorrow_score: Math.min(100, Math.round((tomorrowAU / AU_SOFT_CAP) * 100)),
    soreness:            unifiedInput.soreness,
    hrv_score:           breakdown.hrv,
    sleep_quality:       todayEntry.sleep.qualityRating ?? null,
    // Pass intensity directly from the training plan so the scorer uses the
    // precise −5/−10/−20 deduction rather than the AU-based fallback.
    intensity_today:    todayPlan    && todayPlan.training_type    !== "off" ? todayPlan.intensity    : undefined,
    intensity_tomorrow: tomorrowPlan && tomorrowPlan.training_type !== "off" ? tomorrowPlan.intensity : undefined,
    tomorrow_is_game:   tomorrowPlan?.training_type === "game",
  });

  const coachMessage   = generateCoachMessage(todayScore, coachMode);
  const dailyPlan      = generateDailyPlan(displayScore, todayMood, todayPlan ?? null, todayEntry);
  const planDetails    = generatePlanDetails(displayScore, todayMood, todayPlan ?? null, todayEntry);
  const recommendations = unified.recommended_modalities;
  const recSummary      = unified.training_impact;

  // ── Plan task sync ────────────────────────────────────────────────────────
  // Build nutrition task texts outside the effect so they can be used as a
  // stable dependency key (string primitives compare by value in useEffect).
  const nutritionTaskTexts = getNutritionTaskTexts(planDetails.nutrition);

  // Stable hash of the current instruction set — changes only when the score
  // tier or mood tier shifts, not on every render.
  const planDetailsKey = [
    ...planDetails.training.instructions,
    ...planDetails.recovery.instructions,
    ...planDetails.mobility.instructions,
    ...nutritionTaskTexts,
  ].join("\u0000");

  // Sync stored tasks with freshly generated instructions; preserve completion.
  useEffect(() => {
    const fresh = buildPlanTasks(dateKey, planDetails, nutritionTaskTexts, false);
    if (!storedPlanTasks) {
      setPlanTaskLog(dateKey, fresh);
      return;
    }
    const storedKey = storedPlanTasks.map((t) => t.text).join("\u0000");
    const freshKey  = fresh.map((t) => t.text).join("\u0000");
    if (storedKey === freshKey) return; // texts unchanged — no update needed
    // Instructions changed (score tier shift) — merge completion where IDs match
    const merged = fresh.map((t) => {
      const stored = storedPlanTasks.find((s) => s.id === t.id);
      return stored ? { ...t, completed: stored.completed } : t;
    });
    setPlanTaskLog(dateKey, merged);
  // planDetailsKey changes only when instruction content actually changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey, planDetailsKey]);

  // Toggle handler — updates store + fires Supabase as fire-and-forget
  const handleTogglePlanTask = (taskId: string) => {
    togglePlanTask(dateKey, taskId);
    const current = planTaskLog[dateKey] ?? [];
    const updated = current.map((t) =>
      t.id === taskId ? { ...t, completed: !t.completed } : t
    );
    upsertPlanTasks(dateKey, updated);
  };

  // ── Execution toast — fires once on the day all tasks are completed ───────
  const executionToastVisible = useExecutionToast(storedPlanTasks ?? [], dateKey);

  // ── Sleep card details ────────────────────────────────────────────────
  const sleepDetails = [
    todayEntry.sleep.duration   ? `${todayEntry.sleep.duration}h sleep` : null,
    todayEntry.sleep.hrv        ? `${todayEntry.sleep.hrv} HRV` : null,
    todayEntry.sleep.restingHR  ? `${todayEntry.sleep.restingHR} RHR` : null,
    todayEntry.sleep.qualityRating ? `Quality ${todayEntry.sleep.qualityRating}/5` : null,
    todayEntry.energyLevel != null ? `Energy ${todayEntry.energyLevel}/5` : null,
  ].filter(Boolean) as string[];

  // ── Feel context (soreness + energy) ─────────────────────────────────────
  const SORENESS_LABEL: Record<number, string> = { 1:"None", 2:"Mild", 3:"Moderate", 4:"Significant", 5:"Severe" };
  const ENERGY_LABEL:   Record<number, string> = { 1:"Depleted", 2:"Low", 3:"Moderate", 4:"Good", 5:"Excellent" };
  const sorenessText  = todayEntry.soreness    != null ? `${SORENESS_LABEL[todayEntry.soreness]} soreness`   : null;
  const energyText    = todayEntry.energyLevel != null ? `${ENERGY_LABEL[todayEntry.energyLevel]} energy`    : null;

  // ── Readiness breakdown details ───────────────────────────────────────
  // ── Readiness breakdown — built directly from the scorer's own deltas ────
  // These numbers ARE the computation, not a re-derivation, so they always match.
  const readinessDetails: string[] = [];
  readinessDetails.push(`Base recovery: ${rdBreakdown.base}`);
  readinessDetails.push(
    `${rdBreakdown.load_label}: ${rdBreakdown.load >= 0 ? "+" : ""}${rdBreakdown.load}`
  );
  if (rdBreakdown.tomorrow !== 0)
    readinessDetails.push(`Hard/game day tomorrow: ${rdBreakdown.tomorrow}`);
  if (rdBreakdown.soreness !== 0)
    readinessDetails.push(
      `Muscle soreness: ${rdBreakdown.soreness >= 0 ? "+" : ""}${rdBreakdown.soreness}`
    );
  if (rdBreakdown.hrv !== 0)
    readinessDetails.push(
      `HRV trend: ${rdBreakdown.hrv >= 0 ? "+" : ""}${rdBreakdown.hrv}`
    );
  readinessDetails.push(
    `Sleep quality: ${rdBreakdown.sleep >= 0 ? "+" : ""}${rdBreakdown.sleep}`
  );

  // ── Training card details ─────────────────────────────────────────────
  const trainingDetails: string[] = [];
  if (todayEntry.training.strengthTraining)
    trainingDetails.push(`Strength ${todayEntry.training.strengthDuration ?? "?"}min`);
  if (todayEntry.training.cardio)
    trainingDetails.push(`Cardio ${todayEntry.training.cardioDuration ?? "?"}min`);
  if (todayEntry.training.coreWork) trainingDetails.push("Core work");
  if (todayEntry.training.mobility) trainingDetails.push("Mobility");
  if (trainingDetails.length === 0) trainingDetails.push("Rest day");

  // ── Nutrition card details ────────────────────────────────────────────
  const nutritionDetails = [
    todayEntry.nutrition.calories ? `${todayEntry.nutrition.calories} kcal` : null,
    todayEntry.nutrition.protein  ? `${todayEntry.nutrition.protein}g protein` : null,
    todayEntry.nutrition.hydration ? `${todayEntry.nutrition.hydration}oz water` : null,
  ].filter(Boolean) as string[];

  // ── Labs card details ─────────────────────────────────────────────────
  const labsScore  = bwAnalysis?.score ?? 0;
  const labsDetails = bwAnalysis
    ? [
        `Latest: ${format(new Date(latestBloodwork!.date + "T12:00:00"), "M/d/yyyy")}`,
        `${bwAnalysis.markerCount} markers · ${bwAnalysis.recoveryModifier >= 0 ? "+" : ""}${bwAnalysis.recoveryModifier} pts to recovery`,
      ]
    : ["No labs uploaded", "Impact: 0 pts"];

  // ── Coach label ───────────────────────────────────────────────────────
  const modeLabelMap = {
    hardcore: "HARDCORE COACH",
    balanced: "BALANCED COACH",
    recovery: "RECOVERY COACH",
  };
  const modeColor = {
    hardcore: "#EF4444",
    balanced: "#F59E0B",
    recovery: "#22C55E",
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-in">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">
            {performanceProfile?.primaryGoal ?? "Recovery Engine"}
          </h1>
          <p className="text-xs text-text-muted mt-0.5 uppercase tracking-wider">
            {performanceProfile?.position
              ? `${performanceProfile.position} · ${today}`
              : today}
          </p>
        </div>
        <Link
          href="/log"
          className="flex items-center gap-1.5 text-gold border border-gold/40 rounded-xl px-3 py-2 text-xs font-bold hover:bg-gold/10 transition-colors uppercase tracking-wide"
        >
          <PlusCircle size={13} />
          Update
        </Link>
      </div>

      {/* ── Race / Event Countdown ──────────────────────────────────────── */}
      {performanceProfile?.eventDate && (() => {
        const daysUntil = Math.ceil(
          (new Date(performanceProfile.eventDate + "T12:00:00").getTime() - Date.now()) / 86400000
        );
        if (daysUntil < 0) return null; // event passed
        const isImminient = daysUntil <= 7;
        const isTaper     = daysUntil <= 21 && daysUntil > 7;
        const urgencyColor = isImminient ? "#EF4444" : isTaper ? "#F59E0B" : "#F59E0B";
        return (
          <div
            className="rounded-2xl border px-4 py-3 flex items-center justify-between"
            style={{ borderColor: `${urgencyColor}30`, backgroundColor: `${urgencyColor}08` }}
          >
            <div>
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: urgencyColor }}>
                {isImminient ? "🏁 Race Week" : isTaper ? "📉 Taper Period" : "🎯 Next Event"}
              </p>
              <p className="text-xs text-text-muted mt-0.5">
                {format(new Date(performanceProfile.eventDate + "T12:00:00"), "MMMM d, yyyy")}
              </p>
            </div>
            <div className="text-right">
              <span className="text-2xl font-extrabold tabular-nums" style={{ color: urgencyColor }}>
                {daysUntil}
              </span>
              <p className="text-xs text-text-muted">days out</p>
            </div>
          </div>
        );
      })()}

      {/* ── Score rings ─────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
        <RecoveryScoreRing score={displayScore}   confidence={confidence} size={200} animated         label="Recovery"  colorVariant="muted" />
        <RecoveryScoreRing score={readinessScore} confidence={confidence} size={200} animated={false} label="Readiness" colorVariant="muted" />
      </div>

      {/* ── Override ────────────────────────────────────────────────────── */}
      <ScoreOverride
        date={todayScore.date}
        calculatedScore={todayScore.calculatedScore}
        adjustedScore={todayScore.adjustedScore}
      />

      {/* ── Coach message ───────────────────────────────────────────────── */}
      <div className="bg-bg-card border border-bg-border rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <span
            className="h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: modeColor[coachMode] }}
          />
          <span
            className="text-xs font-bold uppercase tracking-widest"
            style={{ color: modeColor[coachMode] }}
          >
            {modeLabelMap[coachMode]}
          </span>
        </div>
        <p className="text-sm text-text-primary leading-relaxed font-medium">
          {coachMessage}
        </p>
      </div>

      {/* ── Today's Plan ────────────────────────────────────────────────── */}
      <TodaysPlanCard
        plan={dailyPlan}
        details={planDetails}
        tasks={storedPlanTasks ?? []}
        onToggle={handleTogglePlanTask}
      />

      {/* ── Score breakdown ─────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-bold text-text-secondary uppercase tracking-widest mb-3">
          What's Driving Your Score
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <ScoreCard
            icon={<Moon size={13} />}
            label="Sleep"
            score={breakdown.sleep}
            details={sleepDetails.length ? sleepDetails : ["No data"]}
          />
          <ScoreCard
            icon={<Zap size={13} />}
            label="Readiness"
            score={readinessScore}
            details={readinessDetails}
          />
          <ScoreCard
            icon={<Dumbbell size={13} />}
            label="Training"
            score={breakdown.training}
            details={trainingDetails}
          />
          <ScoreCard
            icon={<Utensils size={13} />}
            label="Nutrition"
            score={breakdown.nutrition}
            details={nutritionDetails.length ? nutritionDetails : ["No data"]}
          />
          <ScoreCard
            icon={<FlaskConical size={13} />}
            label="Labs"
            score={labsScore}
            details={labsDetails}
            fullWidth
          />
        </div>
      </div>

      {/* ── Mood ─────────────────────────────────────────────────────────── */}
      <MoodPicker value={todayMood} onChange={onMoodChange} />

      {/* ── Soreness + Energy context pills ─────────────────────────────── */}
      {(sorenessText || energyText) && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-text-muted">Today:</span>
          {sorenessText && (
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
              todayEntry.soreness! >= 4
                ? "border-red-500/30 bg-red-500/10 text-red-400"
                : todayEntry.soreness! >= 3
                ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
            }`}>
              {sorenessText}
            </span>
          )}
          {energyText && (
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
              todayEntry.energyLevel! <= 2
                ? "border-red-500/30 bg-red-500/10 text-red-400"
                : todayEntry.energyLevel! <= 3
                ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
            }`}>
              {energyText}
            </span>
          )}
        </div>
      )}

      {/* ── Training impact ──────────────────────────────────────────────── */}
      {trainingPlan && (
        <div className="bg-bg-card border border-bg-border rounded-2xl p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 mb-1">
            <Dumbbell size={13} className="text-text-secondary" />
            <span className="text-xs font-bold text-text-secondary uppercase tracking-widest">
              How Training Affects Your Score
            </span>
          </div>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <p className="text-xs text-text-secondary font-medium uppercase tracking-wider mb-0.5">Today</p>
              <p className="text-xs text-text-secondary">{recSummary.today}</p>
            </div>
            {todayPlan && (
              <span
                className="text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0"
                style={{
                  backgroundColor: `${TYPE_COLOR[todayPlan.training_type]}20`,
                  color: TYPE_COLOR[todayPlan.training_type],
                }}
              >
                {TYPE_LABEL[todayPlan.training_type]}
              </span>
            )}
          </div>
          <div className="h-px bg-bg-border" />
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <p className="text-xs text-text-secondary font-medium uppercase tracking-wider mb-0.5">Tomorrow</p>
              <p className="text-xs text-text-secondary">{recSummary.tomorrow}</p>
            </div>
            {tomorrowPlan && (
              <span
                className="text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0"
                style={{
                  backgroundColor: `${TYPE_COLOR[tomorrowPlan.training_type]}20`,
                  color: TYPE_COLOR[tomorrowPlan.training_type],
                }}
              >
                {TYPE_LABEL[tomorrowPlan.training_type]}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Recovery modalities ─────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-xs font-bold text-text-secondary uppercase tracking-widest">
            What To Do Right Now
          </h2>
          <span className="text-xs font-bold text-gold uppercase tracking-wider">
            Personalized
          </span>
        </div>
        <div className="flex flex-col gap-2">
          {recommendations.map((rec) => (
            <ModalityCard key={rec.id} rec={rec} />
          ))}
        </div>
      </div>

      {/* ── Quick links ─────────────────────────────────────────────────── */}
      <Link
        href="/trends"
        className="flex items-center justify-between bg-bg-card border border-bg-border rounded-2xl p-4 hover:border-text-muted/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-bg-elevated flex items-center justify-center">
            <TrendingUp size={16} className="text-text-secondary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-text-primary">View Trends</p>
            <p className="text-xs text-text-muted mt-0.5">30-day history and insights</p>
          </div>
        </div>
        <ChevronRight size={16} className="text-text-muted" />
      </Link>

      <Link
        href="/bloodwork"
        className="flex items-center justify-between bg-bg-card border border-bg-border rounded-2xl p-4 hover:border-text-muted/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-bg-elevated flex items-center justify-center">
            <FlaskConical size={16} className="text-text-secondary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-text-primary">
              {latestBloodwork ? "Blood Lab Results" : "Add Lab Results"}
            </p>
            <p className="text-xs text-text-muted mt-0.5">
              {latestBloodwork
                ? `Last tested ${format(new Date(latestBloodwork.date + "T12:00:00"), "M/d/yyyy")}`
                : "Upload blood tests to improve score accuracy"}
            </p>
          </div>
        </div>
        <ChevronRight size={16} className="text-text-muted" />
      </Link>

      {/* ── Execution toast ─────────────────────────────────────────────── */}
      <ExecutionToast visible={executionToastVisible} />

    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────

function EmptyState({ today }: { today: string }) {
  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Recovery Engine</h1>
          <p className="text-xs text-text-muted mt-0.5 uppercase tracking-wider">{today}</p>
        </div>
        <Link
          href="/log"
          className="flex items-center gap-1.5 text-gold border border-gold/40 rounded-xl px-3 py-2 text-xs font-bold hover:bg-gold/10 transition-colors uppercase tracking-wide"
        >
          <PlusCircle size={13} />
          Update
        </Link>
      </div>

      <div className="flex justify-center py-10">
        <div className="flex flex-col items-center gap-4">
          <div className="h-52 w-52 rounded-full border-2 border-dashed border-bg-border flex items-center justify-center">
            <span className="text-6xl font-bold text-text-muted/30">—</span>
          </div>
          <p className="text-xs text-text-muted uppercase tracking-widest">No Data Today</p>
        </div>
      </div>

      <Link
        href="/log"
        className="w-full py-4 rounded-2xl bg-gold text-bg-primary text-sm font-bold uppercase tracking-wider text-center hover:bg-gold-light transition-colors block"
      >
        Log Today's Data
      </Link>
    </div>
  );
}
