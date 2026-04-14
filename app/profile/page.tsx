"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Target } from "lucide-react";
import { useStore } from "@/lib/store";
import {
  PERFORMANCE_GOALS,
  GOAL_ARCHETYPE,
  type PerformanceGoal,
  type TrainingFocus,
  type PerformancePriority,
  type PerformanceProfile,
} from "@/lib/types";

const TRAINING_FOCUSES: TrainingFocus[] = ["Endurance", "Strength", "Hybrid"];

const PRIORITIES: PerformancePriority[] = ["Performance", "Recovery", "Longevity"];

const GOAL_ICONS: Record<PerformanceGoal, string> = {
  // Team sports
  "Soccer":              "⚽",
  "Basketball":          "🏀",
  "Football":            "🏈",
  "Baseball / Softball": "⚾",
  "Volleyball":          "🏐",
  "Hockey":              "🏒",
  "Rugby / Lacrosse":    "🏉",
  // Endurance
  "Marathon":            "🏃",
  "Half Marathon":       "🏃",
  "Trail Running":       "🏔️",
  "Triathlon":           "🏊",
  "Ironman":             "🔱",
  "Cycling Race":        "🚴",
  "Swimming":            "🏊",
  "Rowing":              "🚣",
  // Strength / Combat
  "Strength Training":   "🏋️",
  "Powerlifting":        "🏋️",
  "MMA / Combat Sports": "🥊",
  "CrossFit":            "🔥",
  "Rock Climbing":       "🧗",
  // Lifestyle
  "General Fitness":     "⚡",
  "Weekend Warrior":     "🎯",
  "Longevity":           "🌿",
};

/** Sport positions or disciplines relevant to each goal */
const GOAL_POSITIONS: Partial<Record<PerformanceGoal, string[]>> = {
  "Soccer":          ["Forward", "Midfielder", "Defender", "Goalkeeper", "Wing Back"],
  "Basketball":      ["Point Guard", "Shooting Guard", "Small Forward", "Power Forward", "Center"],
  "Football":        ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "DB", "K/P"],
  "Volleyball":      ["Setter", "Outside Hitter", "Middle Blocker", "Libero", "Opposite"],
  "Hockey":          ["Forward", "Defenseman", "Goalie"],
  "Rugby / Lacrosse":["Attack", "Midfield", "Defense", "Goalie"],
  "Triathlon":       ["Sprint", "Olympic", "70.3 / Half", "Ironman", "Open Water"],
  "Swimming":        ["Freestyle", "Backstroke", "Breaststroke", "Butterfly", "IM", "Open Water"],
  "Rowing":          ["Sweep", "Sculling", "Ergometer"],
  "Rock Climbing":   ["Sport", "Trad", "Boulder", "Gym"],
};

export default function ProfilePage() {
  const saved               = useStore((s) => s.performanceProfile);
  const setPerformanceProfile = useStore((s) => s.setPerformanceProfile);

  const [primaryGoal,    setPrimaryGoal]    = useState<PerformanceGoal | "">(saved?.primaryGoal ?? "");
  const [eventDate,      setEventDate]      = useState(saved?.eventDate ?? "");
  const [trainingFocus,  setTrainingFocus]  = useState<TrainingFocus | "">(saved?.trainingFocus ?? "");
  const [priority,       setPriority]       = useState<PerformancePriority | "">(saved?.priority ?? "");
  const [position,       setPosition]       = useState<string>(saved?.position ?? "");
  const [weeklyHours,    setWeeklyHours]    = useState<string>(saved?.weeklyHours?.toString() ?? "");
  const [bodyWeightLbs,  setBodyWeightLbs]  = useState<string>(saved?.bodyWeightLbs?.toString() ?? "");
  const [saved_ok,       setSavedOk]        = useState(false);

  // Group goals by archetype category for cleaner UI
  const TEAM_SPORTS:  PerformanceGoal[] = ["Soccer","Basketball","Football","Baseball / Softball","Volleyball","Hockey","Rugby / Lacrosse"];
  const ENDURANCE:    PerformanceGoal[] = ["Marathon","Half Marathon","Trail Running","Triathlon","Ironman","Cycling Race","Swimming","Rowing"];
  const STRENGTH:     PerformanceGoal[] = ["Strength Training","Powerlifting","MMA / Combat Sports","CrossFit","Rock Climbing"];
  const LIFESTYLE:    PerformanceGoal[] = ["General Fitness","Weekend Warrior","Longevity"];

  const positionOptions = primaryGoal ? (GOAL_POSITIONS[primaryGoal as PerformanceGoal] ?? []) : [];

  function handleSave() {
    if (!primaryGoal) return;
    const profile: PerformanceProfile = {
      primaryGoal,
      eventDate:      eventDate          || null,
      trainingFocus:  (trainingFocus as TrainingFocus) || null,
      priority:       (priority    as PerformancePriority) || null,
      position:       position           || null,
      weeklyHours:    weeklyHours        ? parseFloat(weeklyHours)   : null,
      bodyWeightLbs:  bodyWeightLbs      ? parseFloat(bodyWeightLbs) : null,
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
    setPosition("");
    setWeeklyHours("");
    setBodyWeightLbs("");
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

      {/* Primary goal — grouped by category */}
      <section>
        <h2 className="text-xs font-bold text-text-secondary uppercase tracking-widest mb-3">
          Your Sport / Goal <span className="text-gold">*</span>
        </h2>

        {[
          { label: "Team Sports",  goals: TEAM_SPORTS  },
          { label: "Endurance",    goals: ENDURANCE    },
          { label: "Strength & Combat", goals: STRENGTH },
          { label: "Lifestyle",    goals: LIFESTYLE    },
        ].map(({ label, goals }) => (
          <div key={label} className="mb-4">
            <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">{label}</p>
            <div className="grid grid-cols-2 gap-1.5">
              {goals.map((goal) => {
                const active = primaryGoal === goal;
                return (
                  <button
                    key={goal}
                    onClick={() => { setPrimaryGoal(goal); setPosition(""); }}
                    className={`flex items-center gap-2 p-3 rounded-xl border text-left transition-all ${
                      active
                        ? "border-gold/60 bg-gold/10"
                        : "border-bg-border bg-bg-card hover:border-text-muted/40"
                    }`}
                  >
                    <span className="text-base leading-none">{GOAL_ICONS[goal]}</span>
                    <span className={`text-xs font-semibold leading-tight flex-1 ${active ? "text-gold" : "text-text-secondary"}`}>
                      {goal}
                    </span>
                    {active && <Check size={11} className="text-gold shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      {/* Position / Discipline (conditional) */}
      {positionOptions.length > 0 && (
        <section>
          <h2 className="text-xs font-bold text-text-secondary uppercase tracking-widest mb-3">
            Position / Discipline <span className="text-text-muted font-normal normal-case tracking-normal">(optional)</span>
          </h2>
          <div className="flex flex-wrap gap-2">
            {positionOptions.map((pos) => {
              const active = position === pos;
              return (
                <button
                  key={pos}
                  onClick={() => setPosition(active ? "" : pos)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                    active
                      ? "border-gold/60 bg-gold/10 text-gold"
                      : "border-bg-border bg-bg-card text-text-secondary hover:border-text-muted/40"
                  }`}
                >
                  {pos}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Event date */}
      <section>
        <h2 className="text-xs font-bold text-text-muted uppercase tracking-widest mb-2">
          Next Race / Event / Season Start <span className="text-text-muted font-normal normal-case tracking-normal">(optional)</span>
        </h2>
        <input
          type="date"
          value={eventDate}
          onChange={(e) => setEventDate(e.target.value)}
          className="w-full bg-bg-card border border-bg-border rounded-xl px-4 py-3 text-sm text-text-primary focus:outline-none focus:border-gold/50 transition-colors"
        />
        {eventDate && (
          <p className="text-xs text-text-secondary mt-1.5 pl-1">
            Your dashboard will show a countdown — and the AI calibrates taper recommendations as you get closer.
          </p>
        )}
      </section>

      {/* Training volume + body weight */}
      <section>
        <h2 className="text-xs font-bold text-text-secondary uppercase tracking-widest mb-3">
          Training Volume <span className="text-text-muted font-normal normal-case tracking-normal">(optional — improves nutrition targets)</span>
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-text-muted font-medium block mb-1.5">Weekly Hours</label>
            <div className="flex items-center gap-2 bg-bg-elevated border border-bg-border rounded-xl px-3 py-2.5">
              <input
                type="number"
                min={1}
                max={40}
                step={0.5}
                value={weeklyHours}
                placeholder="8"
                onChange={(e) => setWeeklyHours(e.target.value)}
                className="flex-1 bg-transparent text-sm text-text-primary outline-none placeholder-text-muted tabular-nums"
              />
              <span className="text-xs text-text-muted shrink-0">hrs/wk</span>
            </div>
          </div>
          <div>
            <label className="text-xs text-text-muted font-medium block mb-1.5">Body Weight</label>
            <div className="flex items-center gap-2 bg-bg-elevated border border-bg-border rounded-xl px-3 py-2.5">
              <input
                type="number"
                min={80}
                max={400}
                step={1}
                value={bodyWeightLbs}
                placeholder="175"
                onChange={(e) => setBodyWeightLbs(e.target.value)}
                className="flex-1 bg-transparent text-sm text-text-primary outline-none placeholder-text-muted tabular-nums"
              />
              <span className="text-xs text-text-muted shrink-0">lbs</span>
            </div>
          </div>
        </div>
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
            <ProfileRow label="Sport / Goal" value={`${GOAL_ICONS[saved.primaryGoal]} ${saved.primaryGoal}`} />
            {saved.position       && <ProfileRow label="Position"    value={saved.position} />}
            {saved.trainingFocus  && <ProfileRow label="Focus"       value={saved.trainingFocus} />}
            {saved.priority       && <ProfileRow label="Priority"    value={saved.priority} />}
            {saved.weeklyHours    && <ProfileRow label="Volume"      value={`${saved.weeklyHours} hrs/wk`} />}
            {saved.bodyWeightLbs  && <ProfileRow label="Body Weight" value={`${saved.bodyWeightLbs} lbs`} />}
            {saved.eventDate      && (
              <ProfileRow
                label="Next Event"
                value={(() => {
                  const days = Math.ceil((new Date(saved.eventDate + "T12:00:00").getTime() - Date.now()) / 86400000);
                  return days > 0 ? `${saved.eventDate} (${days}d away)` : saved.eventDate;
                })()}
              />
            )}
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
