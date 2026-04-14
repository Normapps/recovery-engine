"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Target } from "lucide-react";
import { useStore } from "@/lib/store";
import {
  PERFORMANCE_GOALS,
  type PerformanceGoal,
  type TrainingFocus,
  type PerformancePriority,
  type PerformanceProfile,
} from "@/lib/types";

const TRAINING_FOCUSES: TrainingFocus[] = ["Endurance", "Strength", "Hybrid"];

const PRIORITIES: PerformancePriority[] = ["Performance", "Recovery", "Longevity"];

const GOAL_ICONS: Record<PerformanceGoal, string> = {
  "Marathon":            "🏃",
  "Half Marathon":       "🏃",
  "Triathlon":           "🏊",
  "Ironman":             "🔱",
  "Cycling Race":        "🚴",
  "Strength Training":   "🏋️",
  "Powerlifting":        "🏋️",
  "MMA / Combat Sports": "🥊",
  "General Fitness":     "⚡",
  "Longevity":           "🌿",
};

export default function ProfilePage() {
  const saved               = useStore((s) => s.performanceProfile);
  const setPerformanceProfile = useStore((s) => s.setPerformanceProfile);

  const [primaryGoal,    setPrimaryGoal]    = useState<PerformanceGoal | "">(saved?.primaryGoal ?? "");
  const [eventDate,      setEventDate]      = useState(saved?.eventDate ?? "");
  const [trainingFocus,  setTrainingFocus]  = useState<TrainingFocus | "">(saved?.trainingFocus ?? "");
  const [priority,       setPriority]       = useState<PerformancePriority | "">(saved?.priority ?? "");
  const [saved_ok,       setSavedOk]        = useState(false);

  function handleSave() {
    if (!primaryGoal) return;
    const profile: PerformanceProfile = {
      primaryGoal,
      eventDate:     eventDate   || null,
      trainingFocus: (trainingFocus as TrainingFocus) || null,
      priority:      (priority    as PerformancePriority) || null,
    };
    setPerformanceProfile(profile);
    setSavedOk(true);
    setTimeout(() => setSavedOk(false), 2000);
  }

  function handleClear() {
    setPerformanceProfile(null);
    setPrimaryGoal("");
    setEventDate("");
    setTrainingFocus("");
    setPriority("");
  }

  return (
    <div className="flex flex-col gap-6 animate-fade-in">

      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/" className="text-text-muted hover:text-text-secondary transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-text-primary">Performance Profile</h1>
          <p className="text-xs text-text-muted mt-0.5">Tailors AI prescriptions to your goal</p>
        </div>
      </div>

      {/* Info card */}
      <div className="bg-gold/5 border border-gold/20 rounded-2xl px-4 py-3 flex items-start gap-3">
        <Target size={14} className="text-gold mt-0.5 shrink-0" />
        <p className="text-xs text-text-secondary leading-relaxed">
          Your primary goal is passed to the AI when generating nutrition, recovery, and mobility prescriptions — so a marathon runner gets different carb targets and mobility focus than a powerlifter.
        </p>
      </div>

      {/* Primary goal */}
      <section>
        <h2 className="text-xs font-bold text-text-secondary uppercase tracking-widest mb-3">
          Primary Goal <span className="text-gold">*</span>
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {PERFORMANCE_GOALS.map((goal) => {
            const active = primaryGoal === goal;
            return (
              <button
                key={goal}
                onClick={() => setPrimaryGoal(goal)}
                className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all ${
                  active
                    ? "border-gold/60 bg-gold/10"
                    : "border-bg-border bg-bg-card hover:border-text-muted/40"
                }`}
              >
                <span className="text-base leading-none">{GOAL_ICONS[goal]}</span>
                <span
                  className={`text-xs font-semibold leading-tight ${
                    active ? "text-gold" : "text-text-secondary"
                  }`}
                >
                  {goal}
                </span>
                {active && (
                  <Check size={12} className="text-gold ml-auto shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Event date */}
      <section>
        <h2 className="text-xs font-bold text-text-muted uppercase tracking-widest mb-2">
          Event Date <span className="text-text-muted font-normal normal-case tracking-normal">(optional)</span>
        </h2>
        <input
          type="date"
          value={eventDate}
          onChange={(e) => setEventDate(e.target.value)}
          className="w-full bg-bg-card border border-bg-border rounded-xl px-4 py-3 text-sm text-text-primary focus:outline-none focus:border-gold/50 transition-colors"
        />
        {eventDate && (
          <p className="text-xs text-text-secondary mt-1.5 pl-1">
            The AI will factor proximity to your event when calibrating recommendations.
          </p>
        )}
      </section>

      {/* Training focus */}
      <section>
        <h2 className="text-xs font-bold text-text-secondary uppercase tracking-widest mb-3">
          Training Focus <span className="text-text-muted font-normal normal-case tracking-normal">(optional)</span>
        </h2>
        <div className="flex gap-2">
          {TRAINING_FOCUSES.map((focus) => {
            const active = trainingFocus === focus;
            return (
              <button
                key={focus}
                onClick={() => setTrainingFocus(active ? "" : focus)}
                className={`flex-1 py-2.5 rounded-xl border text-xs font-semibold transition-all ${
                  active
                    ? "border-gold/60 bg-gold/10 text-gold"
                    : "border-bg-border bg-bg-card text-text-secondary hover:border-text-muted/40"
                }`}
              >
                {focus}
              </button>
            );
          })}
        </div>
      </section>

      {/* Priority */}
      <section>
        <h2 className="text-xs font-bold text-text-secondary uppercase tracking-widest mb-3">
          Current Priority <span className="text-text-muted font-normal normal-case tracking-normal">(optional)</span>
        </h2>
        <div className="flex gap-2">
          {PRIORITIES.map((p) => {
            const active = priority === p;
            const color =
              p === "Performance" ? "#EF4444" :
              p === "Recovery"    ? "#22C55E" : "#818CF8";
            return (
              <button
                key={p}
                onClick={() => setPriority(active ? "" : p)}
                className={`flex-1 py-2.5 rounded-xl border text-xs font-semibold transition-all ${
                  active ? "" : "border-bg-border bg-bg-card text-text-secondary hover:border-text-muted/40"
                }`}
                style={active ? { borderColor: `${color}60`, backgroundColor: `${color}10`, color } : {}}
              >
                {p}
              </button>
            );
          })}
        </div>
      </section>

      {/* Current profile summary */}
      {saved && (
        <div className="bg-bg-card border border-bg-border rounded-2xl p-4">
          <p className="text-xs font-bold text-text-secondary uppercase tracking-widest mb-2">
            Active Profile
          </p>
          <div className="flex flex-col gap-1.5">
            <ProfileRow label="Goal"    value={`${GOAL_ICONS[saved.primaryGoal]} ${saved.primaryGoal}`} />
            {saved.trainingFocus && <ProfileRow label="Focus"   value={saved.trainingFocus} />}
            {saved.priority      && <ProfileRow label="Priority" value={saved.priority} />}
            {saved.eventDate     && <ProfileRow label="Event"   value={saved.eventDate} />}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={!primaryGoal}
          className={`flex-1 py-3.5 rounded-2xl text-sm font-bold uppercase tracking-wide transition-all flex items-center justify-center gap-2 ${
            primaryGoal
              ? "bg-gold text-bg-primary hover:bg-gold/90"
              : "bg-bg-card text-text-muted border border-bg-border cursor-not-allowed"
          }`}
        >
          {saved_ok ? (
            <>
              <Check size={15} />
              Saved
            </>
          ) : (
            "Save Profile"
          )}
        </button>
        {saved && (
          <button
            onClick={handleClear}
            className="px-4 py-3.5 rounded-2xl text-xs font-bold text-text-muted border border-bg-border hover:border-text-muted/40 transition-colors uppercase tracking-wide"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="text-xs font-semibold text-text-primary">{value}</span>
    </div>
  );
}
