"use client";

import { useState } from "react";
import { format } from "date-fns";
import { useStore, useLatestBloodwork } from "@/lib/store";
import { computeFinalRecoveryScore } from "@/lib/final-scorer";
import { getTodayDay, getTomorrowDay, getDayPlan } from "@/lib/training-engine";
import type { DailyEntry, SleepData, NutritionData, TrainingData, RecoveryModalities } from "@/lib/types";
import { Moon, Zap, Dumbbell, Droplets, Flame, Wind } from "lucide-react";
import { useRouter } from "next/navigation";

// ─── Reusable field components ────────────────────────────────────────────────

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="text-text-secondary">{icon}</span>
      <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider">{title}</h3>
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  placeholder,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-2xs text-text-muted uppercase tracking-wider">{label}</label>
      <div className="flex items-center gap-2 bg-bg-elevated border border-bg-border rounded-xl px-3 py-2.5">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value ?? ""}
          placeholder={placeholder ?? "—"}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === "" ? null : parseFloat(v));
          }}
          className="flex-1 bg-transparent text-sm text-text-primary outline-none placeholder-text-muted tabular-nums"
        />
        {unit && (
          <span className="text-xs text-text-muted shrink-0">{unit}</span>
        )}
      </div>
    </div>
  );
}

function RatingInput({
  label,
  value,
  onChange,
  max = 5,
}: {
  label: string;
  value: number | null;
  onChange: (v: number) => void;
  max?: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-2xs text-text-muted uppercase tracking-wider">{label}</label>
      <div className="flex gap-2">
        {Array.from({ length: max }, (_, i) => i + 1).map((v) => (
          <button
            key={v}
            onClick={() => onChange(v)}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-colors ${
              value === v
                ? "border-gold text-gold bg-gold/10"
                : "border-bg-border text-text-muted hover:border-text-muted"
            }`}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({
  label,
  value,
  onChange,
  sublabel,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  sublabel?: string;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`flex items-center justify-between w-full px-4 py-3 rounded-xl border transition-colors ${
        value
          ? "border-gold/60 bg-gold/8"
          : "border-bg-border bg-bg-elevated hover:border-text-muted"
      }`}
    >
      <div className="flex flex-col items-start gap-0.5">
        <span className={`text-sm font-medium ${value ? "text-gold" : "text-text-secondary"}`}>
          {label}
        </span>
        {sublabel && (
          <span className="text-2xs text-text-muted">{sublabel}</span>
        )}
      </div>
      {/* Toggle pill */}
      <div
        className={`relative w-10 h-6 rounded-full transition-colors ${
          value ? "bg-gold" : "bg-bg-border"
        }`}
      >
        <div
          className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            value ? "translate-x-5" : "translate-x-1"
          }`}
        />
      </div>
    </button>
  );
}

// ─── Main form ────────────────────────────────────────────────────────────────

export default function DailyLogForm() {
  const upsertEntry     = useStore((s) => s.upsertEntry);
  const upsertScore     = useStore((s) => s.upsertScore);
  const existingEntry   = useStore((s) => s.todayEntry);
  const entries         = useStore((s) => s.entries);
  const trainingPlan    = useStore((s) => s.trainingPlan);
  const latestBloodwork = useLatestBloodwork(90);
  const router = useRouter();

  const today = format(new Date(), "yyyy-MM-dd");

  const [sleep, setSleep] = useState<SleepData>(
    existingEntry?.sleep ?? {
      duration: null,
      qualityRating: null,
      hrv: null,
      restingHR: null,
      bodyBattery: null,
    }
  );

  const [nutrition, setNutrition] = useState<NutritionData>(
    existingEntry?.nutrition ?? {
      calories: null,
      protein: null,
      hydration: null,
      notes: "",
    }
  );

  const [training, setTraining] = useState<TrainingData>(
    existingEntry?.training ?? {
      strengthTraining: false,
      strengthDuration: null,
      cardio: false,
      cardioDuration: null,
      coreWork: false,
      mobility: false,
    }
  );

  const [recovery, setRecovery] = useState<RecoveryModalities>(
    existingEntry?.recovery ?? {
      iceBath: false,
      sauna: false,
      compression: false,
      massage: false,
    }
  );

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    setSubmitting(true);
    const entry: DailyEntry = {
      id: existingEntry?.id ?? crypto.randomUUID(),
      date: today,
      sleep,
      nutrition,
      training,
      recovery,
      createdAt: existingEntry?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Run full pipeline: normalization → recovery state → bloodwork → training plan
    const history = Object.values(entries).sort((a, b) => b.date.localeCompare(a.date));
    const todayPlan    = trainingPlan ? getDayPlan(trainingPlan, getTodayDay())    : null;
    const tomorrowPlan = trainingPlan ? getDayPlan(trainingPlan, getTomorrowDay()) : null;
    const score = computeFinalRecoveryScore(
      entry,
      history,
      latestBloodwork?.panel ?? null,
      todayPlan,
      tomorrowPlan,
    );

    upsertEntry(entry);
    upsertScore(score);

    setSubmitting(false);
    setSubmitted(true);
    setTimeout(() => router.push("/"), 800);
  };

  return (
    <div className="flex flex-col gap-6 pb-8 animate-fade-in">
      {/* ── Sleep ── */}
      <section className="bg-bg-card border border-bg-border rounded-2xl p-5">
        <SectionHeader icon={<Moon size={16} />} title="Sleep" />
        <div className="grid grid-cols-2 gap-4">
          <NumberInput
            label="Duration"
            value={sleep.duration}
            onChange={(v) => setSleep({ ...sleep, duration: v })}
            min={0}
            max={16}
            step={0.5}
            unit="hrs"
            placeholder="7.5"
          />
          <NumberInput
            label="Resting HR"
            value={sleep.restingHR}
            onChange={(v) => setSleep({ ...sleep, restingHR: v })}
            min={30}
            max={120}
            unit="bpm"
            placeholder="52"
          />
          <NumberInput
            label="HRV"
            value={sleep.hrv}
            onChange={(v) => setSleep({ ...sleep, hrv: v })}
            min={0}
            max={200}
            unit="ms"
            placeholder="65"
          />
          <NumberInput
            label="Body Battery"
            value={sleep.bodyBattery}
            onChange={(v) => setSleep({ ...sleep, bodyBattery: v })}
            min={0}
            max={100}
            placeholder="optional"
          />
        </div>
        <div className="mt-4">
          <RatingInput
            label="Sleep Quality"
            value={sleep.qualityRating}
            onChange={(v) => setSleep({ ...sleep, qualityRating: v })}
          />
        </div>
      </section>

      {/* ── Nutrition ── */}
      <section className="bg-bg-card border border-bg-border rounded-2xl p-5">
        <SectionHeader icon={<Droplets size={16} />} title="Nutrition" />
        <div className="grid grid-cols-2 gap-4">
          <NumberInput
            label="Calories"
            value={nutrition.calories}
            onChange={(v) => setNutrition({ ...nutrition, calories: v })}
            min={0}
            unit="kcal"
            placeholder="2400"
          />
          <NumberInput
            label="Protein"
            value={nutrition.protein}
            onChange={(v) => setNutrition({ ...nutrition, protein: v })}
            min={0}
            unit="g"
            placeholder="160"
          />
          <div className="col-span-2">
            <NumberInput
              label="Hydration"
              value={nutrition.hydration}
              onChange={(v) => setNutrition({ ...nutrition, hydration: v })}
              min={0}
              unit="oz"
              placeholder="80"
            />
          </div>
        </div>
      </section>

      {/* ── Training ── */}
      <section className="bg-bg-card border border-bg-border rounded-2xl p-5">
        <SectionHeader icon={<Dumbbell size={16} />} title="Training" />
        <div className="flex flex-col gap-3">
          <Toggle
            label="Strength Training"
            value={training.strengthTraining}
            onChange={(v) => setTraining({ ...training, strengthTraining: v })}
          />
          {training.strengthTraining && (
            <NumberInput
              label="Duration"
              value={training.strengthDuration}
              onChange={(v) => setTraining({ ...training, strengthDuration: v })}
              min={0}
              max={300}
              unit="min"
              placeholder="45"
            />
          )}
          <Toggle
            label="Cardio"
            value={training.cardio}
            onChange={(v) => setTraining({ ...training, cardio: v })}
          />
          {training.cardio && (
            <NumberInput
              label="Duration"
              value={training.cardioDuration}
              onChange={(v) => setTraining({ ...training, cardioDuration: v })}
              min={0}
              max={300}
              unit="min"
              placeholder="30"
            />
          )}
          <Toggle
            label="Core Work"
            value={training.coreWork}
            onChange={(v) => setTraining({ ...training, coreWork: v })}
          />
          <Toggle
            label="Mobility / Stretching"
            value={training.mobility}
            onChange={(v) => setTraining({ ...training, mobility: v })}
          />
        </div>
      </section>

      {/* ── Recovery ── */}
      <section className="bg-bg-card border border-bg-border rounded-2xl p-5">
        <SectionHeader icon={<Wind size={16} />} title="Recovery Modalities" />
        <div className="flex flex-col gap-3">
          <Toggle
            label="Ice Bath"
            value={recovery.iceBath}
            onChange={(v) => setRecovery({ ...recovery, iceBath: v })}
          />
          <Toggle
            label="Sauna"
            value={recovery.sauna}
            onChange={(v) => setRecovery({ ...recovery, sauna: v })}
          />
          <Toggle
            label="Compression (Normatec)"
            value={recovery.compression}
            onChange={(v) => setRecovery({ ...recovery, compression: v })}
          />
          <Toggle
            label="Massage / Manual Therapy"
            value={recovery.massage}
            onChange={(v) => setRecovery({ ...recovery, massage: v })}
          />
        </div>
      </section>

      {/* ── Submit ── */}
      <button
        onClick={handleSubmit}
        disabled={submitting || submitted}
        className={`w-full py-4 rounded-2xl text-sm font-bold uppercase tracking-wider transition-all ${
          submitted
            ? "bg-recovery-high/20 text-recovery-high border border-recovery-high/40"
            : "bg-gold text-bg-primary hover:bg-gold-light active:scale-98"
        } disabled:opacity-60`}
      >
        {submitted ? "Score Calculated" : submitting ? "Calculating..." : "Calculate Recovery Score"}
      </button>
    </div>
  );
}
