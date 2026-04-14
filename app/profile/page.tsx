"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ChevronDown, ChevronUp } from "lucide-react";
import { useStore } from "@/lib/store";
import { upsertPerformanceProfile } from "@/lib/supabase";
import {
  PERFORMANCE_GOALS,
  GOAL_ARCHETYPE,
  type PerformanceGoal,
  type TrainingFocus,
  type PerformancePriority,
  type PerformanceProfile,
  type Sex,
  type ExperienceLevel,
  type TrainingIntensity,
  type EventImportance,
} from "@/lib/types";

// ─── Design tokens ────────────────────────────────────────────────────────────

const CARD = "bg-bg-card border border-bg-border rounded-2xl p-5";
const SECTION_LABEL = "text-xs font-bold text-text-secondary uppercase tracking-widest mb-3";
const INPUT_WRAP = "flex items-center gap-2 bg-bg-elevated border border-bg-border rounded-xl px-3 py-2.5";
const INPUT_BASE = "flex-1 bg-transparent text-sm text-text-primary outline-none placeholder-text-muted tabular-nums";
const FIELD_LABEL = "text-xs text-text-muted font-medium block mb-1.5";

// ─── Pill button ──────────────────────────────────────────────────────────────

function Pill({
  label,
  active,
  onClick,
  color,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-2.5 rounded-xl border text-xs font-semibold transition-all ${
        active ? "" : "border-bg-border bg-bg-elevated text-text-secondary hover:border-text-muted/40"
      }`}
      style={
        active
          ? { borderColor: `${color ?? "#F59E0B"}60`, backgroundColor: `${color ?? "#F59E0B"}12`, color: color ?? "#F59E0B" }
          : {}
      }
    >
      {label}
    </button>
  );
}

// ─── Number field ─────────────────────────────────────────────────────────────

function NumField({
  label,
  value,
  onChange,
  unit,
  placeholder,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  unit?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div>
      <label className={FIELD_LABEL}>{label}</label>
      <div className={INPUT_WRAP}>
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
          className={INPUT_BASE}
        />
        {unit && <span className="text-xs text-text-muted shrink-0">{unit}</span>}
      </div>
    </div>
  );
}

// ─── Toggle row ───────────────────────────────────────────────────────────────

function ToggleRow({
  label,
  sublabel,
  value,
  onChange,
}: {
  label: string;
  sublabel?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`flex items-center justify-between w-full px-4 py-3 rounded-xl border transition-colors ${
        value ? "border-gold/50 bg-gold/8" : "border-bg-border bg-bg-elevated hover:border-text-muted/40"
      }`}
    >
      <div>
        <span className={`text-sm font-medium ${value ? "text-gold" : "text-text-secondary"}`}>{label}</span>
        {sublabel && <p className="text-xs text-text-muted mt-0.5">{sublabel}</p>}
      </div>
      <div className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${value ? "bg-gold" : "bg-bg-border"}`}>
        <div className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${value ? "translate-x-5" : "translate-x-1"}`} />
      </div>
    </button>
  );
}

// ─── Collapsible card ─────────────────────────────────────────────────────────

function SectionCard({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={CARD}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full mb-0"
      >
        <span className="text-sm font-bold text-text-primary">{title}</span>
        {open ? <ChevronUp size={15} className="text-text-muted" /> : <ChevronDown size={15} className="text-text-muted" />}
      </button>
      {open && <div className="mt-4 flex flex-col gap-4">{children}</div>}
    </div>
  );
}

// ─── Goal icons + position options ───────────────────────────────────────────

const GOAL_ICONS: Record<PerformanceGoal, string> = {
  "Soccer":"⚽","Basketball":"🏀","Football":"🏈","Baseball / Softball":"⚾",
  "Volleyball":"🏐","Hockey":"🏒","Rugby / Lacrosse":"🏉",
  "Marathon":"🏃","Half Marathon":"🏃","Trail Running":"🏔️",
  "Triathlon":"🏊","Ironman":"🔱","Cycling Race":"🚴","Swimming":"🏊","Rowing":"🚣",
  "Strength Training":"🏋️","Powerlifting":"🏋️","MMA / Combat Sports":"🥊",
  "CrossFit":"🔥","Rock Climbing":"🧗",
  "General Fitness":"⚡","Weekend Warrior":"🎯","Longevity":"🌿",
};

const GOAL_POSITIONS: Partial<Record<PerformanceGoal, string[]>> = {
  "Soccer":           ["Forward","Midfielder","Defender","Goalkeeper","Wing Back"],
  "Basketball":       ["Point Guard","Shooting Guard","Small Forward","Power Forward","Center"],
  "Football":         ["QB","RB","WR","TE","OL","DL","LB","DB","K/P"],
  "Volleyball":       ["Setter","Outside Hitter","Middle Blocker","Libero","Opposite"],
  "Hockey":           ["Forward","Defenseman","Goalie"],
  "Rugby / Lacrosse": ["Attack","Midfield","Defense","Goalie"],
  "Triathlon":        ["Sprint","Olympic","70.3 / Half","Ironman","Open Water"],
  "Swimming":         ["Freestyle","Backstroke","Breaststroke","Butterfly","IM","Open Water"],
  "Rowing":           ["Sweep","Sculling","Ergometer"],
  "Rock Climbing":    ["Sport","Trad","Boulder","Gym"],
};

const GOAL_GROUPS: Array<{ label: string; goals: PerformanceGoal[] }> = [
  { label: "Team Sports",      goals: ["Soccer","Basketball","Football","Baseball / Softball","Volleyball","Hockey","Rugby / Lacrosse"] },
  { label: "Endurance",        goals: ["Marathon","Half Marathon","Trail Running","Triathlon","Ironman","Cycling Race","Swimming","Rowing"] },
  { label: "Strength & Combat",goals: ["Strength Training","Powerlifting","MMA / Combat Sports","CrossFit","Rock Climbing"] },
  { label: "Lifestyle",        goals: ["General Fitness","Weekend Warrior","Longevity"] },
];

// ─── Severity slider ──────────────────────────────────────────────────────────

function SeveritySlider({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  const labels = ["", "Minor", "Mild", "Moderate", "Significant", "Severe"];
  const colors = ["", "#22C55E", "#84CC16", "#F59E0B", "#EF4444", "#DC2626"];
  const v = value ?? 1;
  return (
    <div>
      <label className={FIELD_LABEL}>Severity</label>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2 rounded-xl border text-xs font-bold transition-all ${
              v === n ? "" : "border-bg-border bg-bg-elevated"
            }`}
            style={v === n ? { borderColor: `${colors[n]}60`, backgroundColor: `${colors[n]}15`, color: colors[n] } : { color: "#6B7280" }}
          >
            <span>{n}</span>
            <span className="text-[9px] uppercase tracking-wide opacity-80">{labels[n]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Hours slider ─────────────────────────────────────────────────────────────

function HoursSlider({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  const v = value ?? 5;
  return (
    <div>
      <label className={FIELD_LABEL}>
        Training Hours per Week
        <span className="ml-2 text-gold font-bold">{v}h</span>
      </label>
      <input
        type="range"
        min={1}
        max={30}
        step={0.5}
        value={v}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-gold"
      />
      <div className="flex justify-between text-[10px] text-text-muted mt-1">
        <span>1h</span><span>5h</span><span>10h</span><span>15h</span><span>20h</span><span>30h</span>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const saved               = useStore((s) => s.performanceProfile);
  const setPerformanceProfile = useStore((s) => s.setPerformanceProfile);

  // Sport & goal
  const [primaryGoal,   setPrimaryGoal]   = useState<PerformanceGoal | "">(saved?.primaryGoal ?? "");
  const [trainingFocus, setTrainingFocus] = useState<TrainingFocus | "">(saved?.trainingFocus ?? "");
  const [priority,      setPriority]      = useState<PerformancePriority | "">(saved?.priority ?? "");
  const [position,      setPosition]      = useState(saved?.position ?? "");

  // Athlete basics
  const [age,             setAge]             = useState<number | null>(saved?.age            ?? null);
  const [sex,             setSex]             = useState<Sex | "">(saved?.sex                 ?? "");
  const [heightIn,        setHeightIn]        = useState<number | null>(saved?.heightIn       ?? null);
  const [bodyWeightLbs,   setBodyWeightLbs]   = useState<number | null>(saved?.bodyWeightLbs  ?? null);
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel | "">(saved?.experienceLevel ?? "");

  // Training profile
  const [weeklyHours,         setWeeklyHours]         = useState<number | null>(saved?.weeklyHours        ?? null);
  const [trainingDaysPerWeek, setTrainingDaysPerWeek] = useState<number | null>(saved?.trainingDaysPerWeek ?? null);
  const [trainingIntensity,   setTrainingIntensity]   = useState<TrainingIntensity | "">(saved?.trainingIntensity ?? "");

  // Injury
  const [injuryActive,   setInjuryActive]   = useState(saved?.injuryActive   ?? false);
  const [injuryBodyPart, setInjuryBodyPart] = useState(saved?.injuryBodyPart ?? "");
  const [injurySeverity, setInjurySeverity] = useState<number | null>(saved?.injurySeverity ?? null);
  const [injuryNotes,    setInjuryNotes]    = useState(saved?.injuryNotes    ?? "");

  // Event
  const [eventTraining,   setEventTraining]   = useState(saved?.eventTraining   ?? false);
  const [eventType,       setEventType]       = useState(saved?.eventType       ?? "");
  const [eventDate,       setEventDate]       = useState(saved?.eventDate       ?? "");
  const [eventImportance, setEventImportance] = useState<EventImportance | "">(saved?.eventImportance ?? "");

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const positionOptions = primaryGoal ? (GOAL_POSITIONS[primaryGoal as PerformanceGoal] ?? []) : [];

  async function handleSave() {
    if (!primaryGoal) return;
    setSaveState("saving");

    const profile: PerformanceProfile = {
      primaryGoal:        primaryGoal as PerformanceGoal,
      trainingFocus:      (trainingFocus as TrainingFocus) || null,
      priority:           (priority     as PerformancePriority) || null,
      position:           position      || null,
      age:                age,
      sex:                (sex          as Sex) || null,
      heightIn,
      bodyWeightLbs,
      experienceLevel:    (experienceLevel   as ExperienceLevel)   || null,
      weeklyHours,
      trainingDaysPerWeek,
      trainingIntensity:  (trainingIntensity as TrainingIntensity) || null,
      injuryActive,
      injuryBodyPart:     injuryActive ? (injuryBodyPart || null) : null,
      injurySeverity:     injuryActive ? (injurySeverity)         : null,
      injuryNotes:        injuryActive ? (injuryNotes || null)    : null,
      eventTraining,
      eventType:          eventTraining ? (eventType || null)      : null,
      eventDate:          eventTraining ? (eventDate || null)      : null,
      eventImportance:    eventTraining ? ((eventImportance as EventImportance) || null) : null,
    };

    setPerformanceProfile(profile);

    // Fire-and-forget to Supabase (no-ops when not configured)
    const userId = "local"; // replace with auth user ID when auth is wired
    const result = await upsertPerformanceProfile(userId, profile);
    setSaveState(result.error ? "error" : "saved");
    setTimeout(() => setSaveState("idle"), 2500);
  }

  return (
    <div className="flex flex-col gap-4 pb-10 animate-fade-in">

      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/" className="text-text-muted hover:text-text-secondary transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-text-primary">Athlete Profile</h1>
          <p className="text-xs text-text-muted mt-0.5">Personalizes your recovery score and AI recommendations</p>
        </div>
      </div>

      {/* ── 1. Athlete Basics ─────────────────────────────────────────────── */}
      <SectionCard title="Athlete Basics">
        <div className="grid grid-cols-2 gap-3">
          <NumField label="Age" value={age} onChange={setAge} unit="yrs" placeholder="28" min={13} max={90} />
          <NumField label="Height" value={heightIn} onChange={setHeightIn} unit="in" placeholder="70" min={48} max={96} />
          <NumField label="Weight" value={bodyWeightLbs} onChange={setBodyWeightLbs} unit="lbs" placeholder="175" min={80} max={400} />
        </div>

        <div>
          <p className={SECTION_LABEL}>Sex</p>
          <div className="flex gap-2">
            {(["male","female","other"] as Sex[]).map((s) => (
              <Pill key={s} label={s.charAt(0).toUpperCase() + s.slice(1)} active={sex === s} onClick={() => setSex(sex === s ? "" : s)} />
            ))}
          </div>
        </div>

        <div>
          <p className={SECTION_LABEL}>Experience Level</p>
          <div className="flex gap-2">
            {(["beginner","intermediate","advanced"] as ExperienceLevel[]).map((e) => (
              <Pill key={e} label={e.charAt(0).toUpperCase() + e.slice(1)} active={experienceLevel === e} onClick={() => setExperienceLevel(experienceLevel === e ? "" : e)} />
            ))}
          </div>
        </div>
      </SectionCard>

      {/* ── 2. Sport & Goal ───────────────────────────────────────────────── */}
      <SectionCard title="Sport & Goal">
        {GOAL_GROUPS.map(({ label, goals }) => (
          <div key={label}>
            <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">{label}</p>
            <div className="grid grid-cols-2 gap-1.5">
              {goals.map((goal) => {
                const active = primaryGoal === goal;
                return (
                  <button
                    key={goal}
                    onClick={() => { setPrimaryGoal(goal); setPosition(""); }}
                    className={`flex items-center gap-2 p-3 rounded-xl border text-left transition-all ${
                      active ? "border-gold/60 bg-gold/10" : "border-bg-border bg-bg-elevated hover:border-text-muted/40"
                    }`}
                  >
                    <span className="text-sm leading-none">{GOAL_ICONS[goal]}</span>
                    <span className={`text-xs font-semibold leading-tight flex-1 ${active ? "text-gold" : "text-text-secondary"}`}>{goal}</span>
                    {active && <Check size={11} className="text-gold shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {positionOptions.length > 0 && (
          <div>
            <p className={SECTION_LABEL}>Position / Discipline</p>
            <div className="flex flex-wrap gap-1.5">
              {positionOptions.map((pos) => (
                <button
                  key={pos}
                  onClick={() => setPosition(position === pos ? "" : pos)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                    position === pos
                      ? "border-gold/50 bg-gold/10 text-gold"
                      : "border-bg-border bg-bg-elevated text-text-secondary hover:border-text-muted/40"
                  }`}
                >
                  {pos}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className={SECTION_LABEL}>Training Type</p>
          <div className="flex gap-2">
            {(["Endurance","Strength","Hybrid"] as TrainingFocus[]).map((f) => (
              <Pill key={f} label={f} active={trainingFocus === f} onClick={() => setTrainingFocus(trainingFocus === f ? "" : f)} />
            ))}
          </div>
        </div>

        <div>
          <p className={SECTION_LABEL}>Current Focus</p>
          <div className="flex gap-2">
            {([
              { v: "Performance", color: "#EF4444" },
              { v: "Recovery",    color: "#22C55E" },
              { v: "Longevity",   color: "#818CF8" },
            ] as { v: PerformancePriority; color: string }[]).map(({ v, color }) => (
              <Pill key={v} label={v} active={priority === v} color={color} onClick={() => setPriority(priority === v ? "" : v)} />
            ))}
          </div>
        </div>
      </SectionCard>

      {/* ── 3. Training Profile ───────────────────────────────────────────── */}
      <SectionCard title="Training Profile">
        <div>
          <p className={SECTION_LABEL}>Training Days per Week</p>
          <div className="flex gap-1.5">
            {[1,2,3,4,5,6,7].map((d) => (
              <button
                key={d}
                onClick={() => setTrainingDaysPerWeek(trainingDaysPerWeek === d ? null : d)}
                className={`flex-1 py-2.5 rounded-xl border text-xs font-bold transition-all ${
                  trainingDaysPerWeek === d
                    ? "border-gold/60 bg-gold/12 text-gold"
                    : "border-bg-border bg-bg-elevated text-text-secondary hover:border-text-muted/40"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        <HoursSlider value={weeklyHours} onChange={setWeeklyHours} />

        <div>
          <p className={SECTION_LABEL}>Typical Training Intensity</p>
          <div className="flex gap-2">
            {(["low","moderate","high"] as TrainingIntensity[]).map((i) => {
              const color = i === "high" ? "#EF4444" : i === "moderate" ? "#F59E0B" : "#22C55E";
              return (
                <Pill key={i} label={i.charAt(0).toUpperCase() + i.slice(1)} active={trainingIntensity === i} color={color}
                  onClick={() => setTrainingIntensity(trainingIntensity === i ? "" : i)} />
              );
            })}
          </div>
        </div>
      </SectionCard>

      {/* ── 4. Injury Status ──────────────────────────────────────────────── */}
      <SectionCard title="Injury Status">
        <ToggleRow
          label="Currently dealing with an injury"
          sublabel="Activating this lowers your score ceiling and prioritises tissue recovery"
          value={injuryActive}
          onChange={setInjuryActive}
        />

        {injuryActive && (
          <>
            <div>
              <label className={FIELD_LABEL}>Affected Body Part</label>
              <div className={INPUT_WRAP}>
                <input
                  type="text"
                  value={injuryBodyPart}
                  placeholder="e.g. Left hamstring, right knee"
                  onChange={(e) => setInjuryBodyPart(e.target.value)}
                  className={INPUT_BASE}
                />
              </div>
            </div>

            <SeveritySlider value={injurySeverity} onChange={setInjurySeverity} />

            <div>
              <label className={FIELD_LABEL}>Notes</label>
              <textarea
                value={injuryNotes}
                placeholder="Any context — when it happened, what aggravates it, current treatment..."
                onChange={(e) => setInjuryNotes(e.target.value)}
                rows={3}
                className="w-full bg-bg-elevated border border-bg-border rounded-xl px-3 py-2.5 text-sm text-text-primary outline-none placeholder-text-muted resize-none focus:border-text-muted/40 transition-colors"
              />
            </div>
          </>
        )}
      </SectionCard>

      {/* ── 5. Event ──────────────────────────────────────────────────────── */}
      <SectionCard title="Event" defaultOpen={false}>
        <ToggleRow
          label="Training for a specific event"
          sublabel="Enables race-week and taper period recommendations"
          value={eventTraining}
          onChange={setEventTraining}
        />

        {eventTraining && (
          <>
            <div>
              <label className={FIELD_LABEL}>Event Name</label>
              <div className={INPUT_WRAP}>
                <input
                  type="text"
                  value={eventType}
                  placeholder="e.g. Ironman 70.3 Austin, Boston Marathon"
                  onChange={(e) => setEventType(e.target.value)}
                  className={INPUT_BASE}
                />
              </div>
            </div>

            <div>
              <label className={FIELD_LABEL}>Event Date</label>
              <input
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                className="w-full bg-bg-elevated border border-bg-border rounded-xl px-3 py-2.5 text-sm text-text-primary outline-none focus:border-text-muted/40 transition-colors"
              />
              {eventDate && (() => {
                const days = Math.ceil((new Date(eventDate + "T12:00:00").getTime() - Date.now()) / 86400000);
                if (days <= 0) return null;
                return <p className="text-xs text-text-secondary mt-1.5 pl-1">{days} days out</p>;
              })()}
            </div>

            <div>
              <p className={SECTION_LABEL}>Priority</p>
              <div className="flex gap-2">
                {([
                  { v: "A", label: "A — Priority", color: "#EF4444" },
                  { v: "B", label: "B — Tune-up",  color: "#F59E0B" },
                  { v: "C", label: "C — Fun",       color: "#22C55E" },
                ] as { v: EventImportance; label: string; color: string }[]).map(({ v, label, color }) => (
                  <Pill key={v} label={label} active={eventImportance === v} color={color}
                    onClick={() => setEventImportance(eventImportance === v ? "" : v)} />
                ))}
              </div>
            </div>
          </>
        )}
      </SectionCard>

      {/* ── Save ──────────────────────────────────────────────────────────── */}
      <button
        onClick={handleSave}
        disabled={!primaryGoal || saveState === "saving"}
        className={`w-full py-4 rounded-2xl text-sm font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${
          !primaryGoal
            ? "bg-bg-card text-text-muted border border-bg-border cursor-not-allowed"
            : saveState === "saved"
            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
            : saveState === "error"
            ? "bg-red-500/20 text-red-400 border border-red-500/40"
            : "bg-gold text-bg-primary hover:bg-gold/90 active:scale-[0.98]"
        } disabled:opacity-60`}
      >
        {saveState === "saving" ? "Saving..." :
         saveState === "saved"  ? <><Check size={15} /> Saved</> :
         saveState === "error"  ? "Error — try again" :
         "Save Profile"}
      </button>

      {!primaryGoal && (
        <p className="text-center text-xs text-text-muted">Select a sport or goal to enable save</p>
      )}
    </div>
  );
}
