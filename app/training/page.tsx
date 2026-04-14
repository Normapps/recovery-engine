"use client";

import { useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import {
  parseTrainingInput,
  planToText,
  getTodayDay,
  getTomorrowDay,
  getDayPlan,
  TYPE_COLOR,
  TYPE_LABEL,
  INTENSITY_LABEL,
  formatDuration,
} from "@/lib/training-engine";
import type { TrainingDay, WeekDay } from "@/lib/types";
import {
  ArrowLeft, Dumbbell, Edit3, Upload, ChevronRight, Clock, Flame, TrendingUp,
} from "lucide-react";

const WEEK_DAYS: WeekDay[] = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
];
const DAY_ABBR: Record<WeekDay, string> = {
  Monday: "M", Tuesday: "T", Wednesday: "W", Thursday: "T",
  Friday: "F", Saturday: "S", Sunday: "S",
};

// ─── Pill badge ───────────────────────────────────────────────────────────────

function TypeBadge({ day }: { day: TrainingDay }) {
  const color = TYPE_COLOR[day.training_type];
  return (
    <span
      className="text-2xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wide"
      style={{ backgroundColor: `${color}20`, color }}
    >
      {TYPE_LABEL[day.training_type]}
    </span>
  );
}

// ─── Today / Tomorrow card ────────────────────────────────────────────────────

function DayCard({
  label,
  day,
  primary = false,
}: {
  label: string;
  day: TrainingDay;
  primary?: boolean;
}) {
  const color = TYPE_COLOR[day.training_type];

  return (
    <div
      className={`rounded-2xl p-5 flex flex-col gap-3 ${
        primary ? "bg-bg-card border-2" : "bg-bg-card border border-bg-border"
      }`}
      style={primary ? { borderColor: `${color}60` } : {}}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-text-muted uppercase tracking-widest">
          {label} · {day.day}
        </span>
        <TypeBadge day={day} />
      </div>

      {day.training_type === "off" ? (
        <p className="text-sm text-text-muted">Rest day — no training scheduled.</p>
      ) : (
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Clock size={13} className="text-text-muted" />
            <span className="text-sm font-semibold text-text-primary">
              {formatDuration(day.duration)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Flame size={13} className="text-text-muted" />
            <span className="text-sm font-semibold text-text-primary capitalize">
              {INTENSITY_LABEL[day.intensity]}
            </span>
          </div>
        </div>
      )}

      {/* Intensity bar */}
      {day.training_type !== "off" && (
        <div className="h-1 w-full rounded-full bg-bg-border overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: day.intensity === "high" ? "90%" : day.intensity === "moderate" ? "55%" : "25%",
              backgroundColor: color,
            }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Weekly overview strip ────────────────────────────────────────────────────

function WeekStrip({
  schedule,
  todayDay,
}: {
  schedule: TrainingDay[];
  todayDay: WeekDay;
}) {
  return (
    <div className="grid grid-cols-7 gap-1">
      {schedule.map((d) => {
        const color   = TYPE_COLOR[d.training_type];
        const isToday = d.day === todayDay;
        return (
          <div key={d.day} className="flex flex-col items-center gap-1.5">
            <span
              className={`text-2xs font-bold uppercase ${
                isToday ? "text-gold" : "text-text-muted"
              }`}
            >
              {DAY_ABBR[d.day]}
            </span>
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{
                backgroundColor: `${color}20`,
                border: isToday ? `2px solid ${color}` : `1px solid ${color}30`,
              }}
            >
              <span className="text-2xs font-bold" style={{ color }}>
                {d.training_type === "off" ? "—" : TYPE_LABEL[d.training_type][0]}
              </span>
            </div>
            {d.training_type !== "off" && (
              <span className="text-2xs text-text-muted tabular-nums">
                {formatDuration(d.duration)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Input editor ─────────────────────────────────────────────────────────────

const PLACEHOLDER = `Monday - Strength 90min
Tuesday - Practice 60min
Wednesday - Off
Thursday - Practice 75min
Friday - Strength 60min
Saturday - Game
Sunday - Recovery 30min`;

function PlanEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (text: string) => void;
  onCancel?: () => void;
}) {
  const [text, setText] = useState(initial);

  return (
    <div className="flex flex-col gap-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={PLACEHOLDER}
        rows={8}
        className="w-full rounded-2xl bg-bg-elevated border border-bg-border text-sm text-text-primary p-4 resize-none focus:outline-none focus:border-gold/50 font-mono leading-relaxed placeholder:text-text-muted/50"
      />
      <div className="flex gap-2">
        <button
          onClick={() => onSave(text)}
          disabled={!text.trim()}
          className="flex-1 py-3 rounded-2xl bg-gold text-bg-primary text-sm font-bold uppercase tracking-wider hover:bg-gold-light transition-colors disabled:opacity-40"
        >
          Parse &amp; Save
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            className="px-5 py-3 rounded-2xl border border-bg-border text-sm text-text-muted hover:text-text-secondary transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function TrainingPage() {
  const trainingPlan   = useStore((s) => s.trainingPlan);
  const setTrainingPlan = useStore((s) => s.setTrainingPlan);
  const [editing, setEditing] = useState(false);

  const todayDay    = getTodayDay();
  const tomorrowDay = getTomorrowDay();

  function handleSave(text: string) {
    // Read the current plan directly from the Zustand store rather than the
    // render-closure capture of `trainingPlan`.  This guarantees we always
    // merge against the latest persisted state even if a concurrent update
    // (e.g. from another tab sharing the same localStorage) changed it between
    // the last render and the moment the user clicked "Parse & Save".
    const latestPlan = useStore.getState().trainingPlan;
    const plan = parseTrainingInput(text, latestPlan);
    setTrainingPlan(plan);
    setEditing(false);
  }

  // ── Empty state ──────────────────────────────────────────────────────────
  if (!trainingPlan && !editing) {
    return (
      <div className="flex flex-col gap-6 animate-fade-in">
        <Header />

        <div className="flex flex-col items-center gap-4 py-12">
          <div className="w-16 h-16 rounded-2xl bg-bg-card border border-bg-border flex items-center justify-center">
            <Dumbbell size={28} className="text-text-muted" />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-text-primary">No training plan yet</p>
            <p className="text-xs text-text-muted mt-1">
              Paste your weekly schedule to get started
            </p>
          </div>
          <button
            onClick={() => setEditing(true)}
            className="py-3 px-6 rounded-2xl bg-gold text-bg-primary text-sm font-bold uppercase tracking-wider hover:bg-gold-light transition-colors"
          >
            Add Training Plan
          </button>
        </div>

        <TrainingScoreInfo />
      </div>
    );
  }

  // ── Editor state ─────────────────────────────────────────────────────────
  if (editing) {
    return (
      <div className="flex flex-col gap-6 animate-fade-in">
        <Header />
        <div>
          <h2 className="text-xs font-bold text-text-muted uppercase tracking-widest mb-3">
            {trainingPlan ? "Edit Plan" : "New Plan"}
          </h2>
          <p className="text-xs text-text-muted mb-4">
            Enter one day per line. Format: <span className="text-text-secondary font-mono">Day - Type Duration</span>
          </p>
          <PlanEditor
            initial={trainingPlan ? planToText(trainingPlan) : ""}
            onSave={handleSave}
            onCancel={trainingPlan ? () => setEditing(false) : undefined}
          />
        </div>
      </div>
    );
  }

  // ── Plan view ────────────────────────────────────────────────────────────
  const todayPlan    = getDayPlan(trainingPlan!, todayDay);
  const tomorrowPlan = getDayPlan(trainingPlan!, tomorrowDay);

  return (
    <div className="flex flex-col gap-6 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-text-muted hover:text-text-secondary transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-text-primary">Training</h1>
            <p className="text-xs text-text-muted mt-0.5">Weekly plan</p>
          </div>
        </div>
        <button
          onClick={() => setEditing(true)}
          className="flex items-center gap-1.5 text-gold border border-gold/40 rounded-xl px-3 py-2 text-xs font-bold hover:bg-gold/10 transition-colors"
        >
          <Edit3 size={12} /> Edit
        </button>
      </div>

      {/* Info card */}
      <TrainingScoreInfo />

      {/* Weekly strip */}
      <section>
        <h2 className="text-xs font-bold text-text-muted uppercase tracking-widest mb-3">
          This Week
        </h2>
        <div className="bg-bg-card border border-bg-border rounded-2xl p-4">
          <WeekStrip schedule={trainingPlan!.weeklySchedule} todayDay={todayDay} />
        </div>
      </section>

      {/* Today */}
      {todayPlan && (
        <section>
          <h2 className="text-xs font-bold text-text-muted uppercase tracking-widest mb-3">
            Today
          </h2>
          <DayCard label="Today" day={todayPlan} primary />
        </section>
      )}

      {/* Tomorrow */}
      {tomorrowPlan && (
        <section>
          <h2 className="text-xs font-bold text-text-muted uppercase tracking-widest mb-3">
            Tomorrow
          </h2>
          <DayCard label="Tomorrow" day={tomorrowPlan} />
        </section>
      )}

      {/* Full schedule list */}
      <section>
        <h2 className="text-xs font-bold text-text-muted uppercase tracking-widest mb-3">
          Full Schedule
        </h2>
        <div className="bg-bg-card border border-bg-border rounded-2xl overflow-hidden divide-y divide-bg-border">
          {trainingPlan!.weeklySchedule.map((d) => {
            const color   = TYPE_COLOR[d.training_type];
            const isToday = d.day === todayDay;
            return (
              <div
                key={d.day}
                className={`flex items-center gap-4 px-5 py-3.5 ${
                  isToday ? "bg-bg-elevated/60" : ""
                }`}
              >
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span
                  className={`w-24 text-xs font-semibold ${
                    isToday ? "text-gold" : "text-text-secondary"
                  }`}
                >
                  {d.day.slice(0, 3)}{isToday && <span className="text-2xs ml-1 text-gold/70">TODAY</span>}
                </span>
                <span className="flex-1 text-sm font-semibold text-text-primary">
                  {TYPE_LABEL[d.training_type]}
                </span>
                <span className="text-xs text-text-muted tabular-nums">
                  {formatDuration(d.duration)}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={() => setEditing(true)}
          className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-bg-border bg-bg-card text-sm font-semibold text-text-secondary hover:border-text-muted/40 transition-colors"
        >
          <Edit3 size={14} /> Edit Plan
        </button>
        <button
          onClick={() => { setTrainingPlan(null); }}
          className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-bg-border bg-bg-card text-sm font-semibold text-text-muted hover:text-text-secondary transition-colors"
        >
          <Upload size={14} /> Replace
        </button>
      </div>

    </div>
  );
}

// ─── Training → Recovery info card ───────────────────────────────────────────

const INFO = {
  title: "Training → Recovery Score",
  lines: [
    "Your plan adjusts your daily recovery score in real time.",
    "High intensity or game days reduce the score by up to 10 pts.",
    "Rest and recovery days ahead add up to +2 pts as a boost.",
    "The score reflects what your body needs — not just what you did.",
  ],
};

function TrainingScoreInfo() {
  return (
    <section className="bg-bg-card border border-bg-border rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp size={14} className="text-text-muted" />
        <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
          {INFO.title}
        </h2>
      </div>
      <ul className="flex flex-col gap-1.5">
        {INFO.lines.map((line, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-1.5 w-1 h-1 rounded-full bg-gold/60 shrink-0" />
            <span className="text-xs text-text-secondary leading-relaxed">{line}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Header() {
  return (
    <div className="flex items-center gap-3">
      <Link href="/" className="text-text-muted hover:text-text-secondary transition-colors">
        <ArrowLeft size={20} />
      </Link>
      <div>
        <h1 className="text-xl font-bold text-text-primary">Training</h1>
        <p className="text-xs text-text-muted mt-0.5">Weekly plan</p>
      </div>
    </div>
  );
}
