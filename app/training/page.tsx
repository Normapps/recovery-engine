"use client";

import { useEffect, useRef, useState } from "react";
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
import type { TrainingDay, TrainingPlan, WeekDay } from "@/lib/types";
import {
  ArrowLeft, Dumbbell, Edit3, Upload, Clock, Flame, TrendingUp, X, FileText, Info,
} from "lucide-react";

// ─── Training descriptions ────────────────────────────────────────────────────

interface SessionInfo {
  title:       string;
  description: string;
  tips:        string[];
}

const SESSION_INFO: Record<string, SessionInfo> = {
  // ── Subtypes ──
  "Long Run": {
    title:       "Long Run",
    description: "A steady aerobic effort at a comfortable, conversational pace. Builds your aerobic base, trains fat metabolism, and develops mental endurance for race day.",
    tips:        ["Keep pace easy — you should be able to hold a conversation", "Fuel every 45–60 min on runs over 90 min", "Follow with extra sleep and a protein-rich meal"],
  },
  "Tempo Run": {
    title:       "Tempo Run",
    description: "A comfortably hard effort held for 20–40 minutes. Raises your lactate threshold so you can sustain a faster pace before fatigue sets in.",
    tips:        ["Target ~80–85% max heart rate — 'comfortably hard'", "Warm up 10 min easy, cool down 10 min easy", "Avoid back-to-back tempo days — needs 48 h recovery"],
  },
  "Easy Run": {
    title:       "Easy Run",
    description: "A recovery-paced aerobic run. Maintains fitness without adding significant stress, promotes blood flow, and accelerates recovery from harder sessions.",
    tips:        ["Heart rate should stay under 70% max", "If you feel stiff, slow down — never force the pace", "Great day to focus on form: tall posture, light footfall"],
  },
  "Intervals": {
    title:       "Intervals",
    description: "Short, high-intensity efforts with recovery periods between. Develops speed, VO₂ max, and running economy more efficiently than any other workout.",
    tips:        ["Full recovery between reps — don't shortchange rest", "The last rep should feel as fast as the first", "Limit to once or twice per week — high CNS cost"],
  },
  "Hill Run": {
    title:       "Hill Run",
    description: "Running up inclines to build power, strength, and running economy. The incline forces better form and recruits muscles that flat running misses.",
    tips:        ["Drive knees high and pump arms on the way up", "Jog back down as your recovery — don't walk unless needed", "Hills double as speed work — treat them as high intensity"],
  },
  "Fartlek": {
    title:       "Fartlek",
    description: "Swedish for 'speed play' — unstructured surges mixed into an easy run. Develops speed and aerobic capacity in a low-pressure, flexible format.",
    tips:        ["Pick landmarks: sprint to the next lamp post, then recover", "No watch required — run by feel", "Good bridge between easy runs and structured intervals"],
  },
  "Recovery Run": {
    title:       "Recovery Run",
    description: "An intentionally slow run to flush metabolic waste and promote blood flow without adding training stress. The goal is active recovery, not fitness.",
    tips:        ["Genuinely slow — slower than you think", "15–30 min is enough; longer doesn't mean better", "Walk if you feel off — recovery is the priority"],
  },
  "Full Body": {
    title:       "Full Body Strength",
    description: "A compound lifting session targeting all major muscle groups. Builds total-body strength, corrects imbalances, and supports injury prevention.",
    tips:        ["Prioritise compound lifts: squat, hinge, push, pull", "Leave 1–2 reps in reserve — quality over fatigue", "Eat 20–40 g protein within 30–60 min post-session"],
  },
  "Upper Body": {
    title:       "Upper Body Strength",
    description: "Focused work on chest, shoulders, back, and arms. Builds the pulling and pushing strength that supports posture, power, and injury resilience.",
    tips:        ["Balance push-to-pull ratio (aim 1:1 or more pull)", "Control the eccentric (lowering) phase — 2–3 seconds", "Shoulder health: include external rotation and face-pulls"],
  },
  "Lower Body": {
    title:       "Lower Body Strength",
    description: "Squats, deadlifts, lunges, and hip work to build leg power, glute strength, and joint stability that translates directly to sport and running.",
    tips:        ["Brace your core before every heavy rep", "Single-leg work exposes and corrects imbalances", "Expect soreness 24–48 h later — plan easy days after"],
  },
  "Yoga": {
    title:       "Yoga",
    description: "A blend of mobility, breath work, and mindfulness. Reduces muscle tension, improves range of motion, and lowers cortisol — a powerful recovery tool.",
    tips:        ["Focus on breath — exhale into the stretch, never force", "Yin or restorative yoga is ideal after hard training blocks", "Morning yoga activates the body; evening yoga calms the CNS"],
  },
  "Mobility": {
    title:       "Mobility Session",
    description: "Active movement through full joint ranges of motion. Fixes restrictions that cause compensation patterns and injury, and keeps you moving well long-term.",
    tips:        ["Focus on your stiffest areas — hips, thoracic spine, ankles", "Hold positions 30–90 seconds to see lasting change", "Pair with foam rolling on sore or tight tissue"],
  },
  // ── Soccer / team sport subtypes ──
  "Pre-Game Activation": {
    title:       "Pre-Game Activation",
    description: "A low-intensity warm-up session the day before competition. Fires up the neuromuscular system, maintains sharpness, and primes the body without adding fatigue.",
    tips:        ["Keep it short — 30–45 min max", "Light technical work, dynamic stretching, finishing touches", "Focus on confidence and sharpness, not fitness"],
  },
  "Small-Sided Games": {
    title:       "Small-Sided Games",
    description: "Condensed-pitch matches (3v3, 4v4, 5v5) that develop decision-making, technical skill, and high-intensity effort in a game-realistic environment.",
    tips:        ["Intensity is naturally high — monitor total load", "Emphasise quick decisions under pressure", "More touches per player than full-sided — great for development"],
  },
  "Tactical Training": {
    title:       "Tactical Training",
    description: "Organised team shape work — defensive structure, pressing triggers, build-up patterns, and positional play. The brain works as hard as the body.",
    tips:        ["Walk-throughs first, then build to match speed", "Video review the day after to reinforce concepts", "Intensity is moderate — focus on execution, not effort"],
  },
  "Technical Training": {
    title:       "Technical Training",
    description: "Skill-focused work on passing, receiving, finishing, and individual technique. Builds the foundation that tactical systems are built on.",
    tips:        ["High reps at game speed — make it realistic", "Quality over quantity: stop and correct rather than rush", "Great session for younger or developing players"],
  },
  "Possession Play": {
    title:       "Possession Play",
    description: "Rondos, keep-away, and structured possession exercises that develop comfort under pressure, spacing, and team rhythm.",
    tips:        ["Keep the geometry — width and depth matter", "First touch quality determines everything else", "Defend hard when you lose it — the press is part of the drill"],
  },
  "Set Pieces": {
    title:       "Set Pieces",
    description: "Rehearsed corners, free kicks, throw-ins, and defensive organisation. Set pieces account for a significant percentage of goals at all levels.",
    tips:        ["Repetition is the point — run each routine 5–10 times", "Everyone needs to know their role and trigger", "Defensive set pieces are as important as attacking ones"],
  },
  "High Press Drills": {
    title:       "High Press Drills",
    description: "Coordinated high-intensity pressing patterns to win the ball high up the pitch. Demanding aerobically and tactically — requires total team buy-in.",
    tips:        ["Triggers matter — press on a cue, not randomly", "The first press sets the shape for teammates behind", "High physical cost — schedule adequate recovery after"],
  },
  "Conditioning": {
    title:       "Conditioning",
    description: "Fitness-focused work designed to build the aerobic and anaerobic capacity needed to compete at full intensity for 90 minutes.",
    tips:        ["Game-based conditioning (SSGs) > pure running for most players", "Track total distance and sprint count where possible", "Taper conditioning load in the 48–72 h before a game"],
  },
  "Walkthrough": {
    title:       "Walkthrough",
    description: "Low-intensity tactical review at walking pace. Reinforces shape, roles, and game plan without any physical stress the day before competition.",
    tips:        ["Purely mental — no one should break a sweat", "Use cones and visual aids to lock in positioning", "Short and sharp — 20–30 min is ideal"],
  },
  // ── Generic training types ──
  "strength": {
    title:       "Strength Training",
    description: "Resistance work to build muscle, increase force output, and protect joints. Essential for all athletes regardless of primary sport.",
    tips:        ["Progressive overload: add small amounts weekly", "Sleep is when you actually get stronger — prioritise 8 h", "Track your lifts so you know you're progressing"],
  },
  "cardio": {
    title:       "Cardio Session",
    description: "Aerobic training that elevates heart rate to improve cardiovascular fitness, endurance, and metabolic health.",
    tips:        ["Mix intensities through the week — not every session hard", "Nasal breathing during easy efforts signals the right zone", "Hydrate: 400–600 ml per hour of moderate exercise"],
  },
  "practice": {
    title:       "Practice / Drill",
    description: "Skill-focused training session. Reinforces technique, game patterns, and sport-specific movements at controlled intensity.",
    tips:        ["Mental focus matters as much as physical effort here", "Film yourself occasionally — you'll catch form cues you can't feel", "Cool down with light stretching to start the recovery process"],
  },
  "game": {
    title:       "Game / Race / Competition",
    description: "Full competitive effort. The culmination of your training week — give your best, manage effort intelligently, and recover well afterward.",
    tips:        ["Trust your training — don't try anything new on game day", "Sleep well the night before the night before (2 nights out matters most)", "Prioritise nutrition and sleep for the 48 h following competition"],
  },
  "recovery": {
    title:       "Recovery Day",
    description: "Active or passive recovery to let your body absorb the week's training load. Adaptations happen during rest — this day is doing real work.",
    tips:        ["Light movement is better than complete rest for most athletes", "Prioritise 8–9 h sleep — recovery happens predominantly overnight", "Hydrate, eat quality food, and limit alcohol"],
  },
  "off": {
    title:       "Rest Day",
    description: "Complete rest. Your body repairs muscle damage, restores glycogen, and consolidates neuromuscular adaptations from the week. Don't skip this.",
    tips:        ["Passive rest is valid — don't guilt-trip yourself into moving", "Use the time for meal prep, sleep, and mental decompression", "If you feel the urge to train, a gentle 20-min walk is the ceiling"],
  },
};

function getSessionInfo(day: TrainingDay): SessionInfo {
  // BUG-FIX #20: subtype → training_type → generic fallback that matches the
  // actual training category rather than hardcoding "cardio" for everything.
  return (
    SESSION_INFO[day.subtype ?? ""] ??
    SESSION_INFO[day.training_type] ??
    SESSION_INFO["cardio"]   // genuine last resort — only hits for unknown types
  );
}

// ─── Session detail modal ─────────────────────────────────────────────────────

function SessionModal({ day, onClose }: { day: TrainingDay; onClose: () => void }) {
  const info    = getSessionInfo(day);
  const color   = TYPE_COLOR[day.training_type];
  const label   = day.subtype ?? TYPE_LABEL[day.training_type];

  // Close on backdrop click or Escape key
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-bg-card border border-bg-border rounded-t-3xl p-6 pb-8 shadow-2xl animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center"
              style={{ backgroundColor: `${color}20` }}
            >
              <Flame size={18} style={{ color }} />
            </div>
            <div>
              <p className="text-xs text-text-muted font-semibold uppercase tracking-widest">{day.day}</p>
              <h3 className="text-base font-bold text-text-primary">{info.title}</h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-secondary transition-colors mt-1"
          >
            <X size={18} />
          </button>
        </div>

        {/* Badges */}
        <div className="flex gap-2 mb-4">
          <span
            className="text-2xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide"
            style={{ backgroundColor: `${color}20`, color }}
          >
            {label}
          </span>
          <span className="text-2xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide bg-bg-elevated text-text-muted">
            {INTENSITY_LABEL[day.intensity]}
          </span>
          {day.duration > 0 && (
            <span className="text-2xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide bg-bg-elevated text-text-muted">
              {formatDuration(day.duration)}
            </span>
          )}
          {day.distance !== undefined && (
            <span className="text-2xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide bg-bg-elevated text-text-muted">
              {day.distance} {day.distanceUnit ?? "mi"}
            </span>
          )}
        </div>

        {/* Description */}
        <p className="text-sm text-text-secondary leading-relaxed mb-5">
          {info.description}
        </p>

        {/* Tips */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-bold text-text-secondary uppercase tracking-widest mb-1">Tips</p>
          {info.tips.map((tip, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <div
                className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                style={{ backgroundColor: color }}
              />
              <p className="text-xs text-text-secondary leading-relaxed">{tip}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

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
  // Prefer subtype (e.g. "Tempo Run") over generic label (e.g. "Cardio")
  const label = day.subtype ?? TYPE_LABEL[day.training_type];
  return (
    <span
      className="text-2xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wide"
      style={{ backgroundColor: `${color}20`, color }}
    >
      {label}
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
        <div className="flex items-center gap-6 flex-wrap">
          {/* Distance (when available) OR duration */}
          <div className="flex items-center gap-2">
            <Clock size={13} className="text-text-muted" />
            <span className="text-sm font-semibold text-text-primary">
              {day.distance !== undefined
                ? `${day.distance} ${day.distanceUnit ?? "mi"}`
                : formatDuration(day.duration)}
            </span>
          </div>
          {/* Show duration alongside distance when both present */}
          {day.distance !== undefined && day.duration > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-text-muted">{formatDuration(day.duration)}</span>
            </div>
          )}
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
                {d.training_type === "off" ? "—" : (d.subtype ?? TYPE_LABEL[d.training_type])[0]}
              </span>
            </div>
            {d.training_type !== "off" && (
              <span className="text-xs text-text-secondary tabular-nums">
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

// ─── Plan uploader ─────────────────────────────────────────────────────────────

type UploadState = "idle" | "dragging" | "processing" | "error";

function PlanUploader({
  onParsed,
  onCancel,
}: {
  onParsed: (days: TrainingDay[], sport?: string) => void;
  onCancel: () => void;
}) {
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [errorMsg, setErrorMsg]       = useState<string>("");
  const [fileName, setFileName]       = useState<string>("");
  const inputRef    = useRef<HTMLInputElement>(null);
  // Keep a stable ref to uploadFile so the window listeners always call
  // the latest closure without needing to re-register on every render.
  const uploadRef   = useRef<(file: File) => void>(() => {});

  // ── Shared upload function ─────────────────────────────────────────────────
  async function uploadFile(file: File) {
    const name = file.name.toLowerCase();
    if (!name.endsWith(".pdf") && !name.endsWith(".csv")) {
      setErrorMsg("Only PDF and CSV files are supported.");
      setUploadState("error");
      return;
    }

    setFileName(file.name);
    setUploadState("processing");
    setErrorMsg("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      console.log("Uploading:", file.name, file.type, file.size);

      const res = await fetch("/api/upload-training", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      console.log("UPLOAD RESPONSE:", data);

      if (!res.ok) {
        throw new Error(data.error ?? "Upload failed.");
      }

      const days  = data.plan?.days ?? data.days;
      const sport = data.plan?.sport ?? data.sport ?? undefined;
      if (!Array.isArray(days) || days.length === 0) {
        throw new Error("No training days could be parsed from the file.");
      }

      console.log("Parsed days:", days.length, "| sport:", sport);
      onParsed(days as TrainingDay[], sport);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      setErrorMsg(msg);
      setUploadState("error");
    }
  }

  // Keep the ref in sync so window listeners always call the latest uploadFile
  uploadRef.current = uploadFile;

  // ── Global window-level drag listeners ────────────────────────────────────
  // Bypasses all z-index / pointer-events / component-nesting issues.
  // Active only while PlanUploader is mounted.
  useEffect(() => {
    function onWindowDragOver(e: DragEvent) {
      e.preventDefault();
    }

    function onWindowDrop(e: DragEvent) {
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      console.log("FILE DROPPED:", file);
      if (file) uploadRef.current(file);
    }

    window.addEventListener("dragover", onWindowDragOver);
    window.addEventListener("drop",     onWindowDrop);

    return () => {
      window.removeEventListener("dragover", onWindowDragOver);
      window.removeEventListener("drop",     onWindowDrop);
    };
  }, []); // register once on mount, clean up on unmount

  // ── Drag-and-drop handlers ─────────────────────────────────────────────────
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setUploadState("dragging");
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    console.log("DROP EVENT FIRED");

    setUploadState("idle");

    const file = e.dataTransfer.files[0];
    console.log("FILE DROPPED:", file);

    if (!file) return;
    uploadFile(file);
  }

  function handleDragLeave(e: React.DragEvent) {
    // Only reset when the drag actually leaves the drop zone itself,
    // not when it enters a child element inside it.
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setUploadState("idle");
    }
  }

  // ── Click / input fallback ─────────────────────────────────────────────────
  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
  }

  const isProcessing = uploadState === "processing";

  return (
    <div className="flex flex-col gap-4">
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !isProcessing && inputRef.current?.click()}
        style={{ zIndex: 10, pointerEvents: "auto" }}
        className={`
          relative flex flex-col items-center justify-center gap-3
          rounded-2xl border-2 border-dashed p-10 cursor-pointer
          transition-all duration-200
          ${uploadState === "dragging"
            ? "border-gold/60 bg-gold/5"
            : uploadState === "error"
            ? "border-recovery-low/50 bg-recovery-low/5 cursor-default"
            : isProcessing
            ? "border-bg-border bg-bg-elevated cursor-wait"
            : "border-bg-border bg-bg-elevated hover:border-gold/30 hover:bg-bg-card"}
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.csv"
          className="hidden"
          onChange={handleFileInput}
          disabled={isProcessing}
        />

        {/* pointer-events-none on all inner content so they never intercept drag events */}
        {isProcessing ? (
          <div className="pointer-events-none flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-bg-card border border-bg-border flex items-center justify-center animate-pulse">
              <FileText size={20} className="text-text-muted" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-text-primary">Parsing plan…</p>
              <p className="text-xs text-text-muted mt-1">{fileName}</p>
            </div>
          </div>
        ) : uploadState === "error" ? (
          <div className="pointer-events-none flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-recovery-low/10 border border-recovery-low/30 flex items-center justify-center">
              <X size={20} className="text-recovery-low" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-recovery-low">Upload failed</p>
              <p className="text-xs text-text-muted mt-1">{errorMsg}</p>
            </div>
            {/* "Try again" needs pointer events restored for clicking */}
            <button
              style={{ pointerEvents: "auto" }}
              onClick={(e) => { e.stopPropagation(); setUploadState("idle"); setErrorMsg(""); }}
              className="text-xs text-gold hover:text-gold-light transition-colors"
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="pointer-events-none flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-bg-card border border-bg-border flex items-center justify-center">
              <Upload size={20} className={uploadState === "dragging" ? "text-gold" : "text-text-muted"} />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-text-primary">
                {uploadState === "dragging" ? "Drop to upload" : "Drop your plan here"}
              </p>
              <p className="text-xs text-text-muted mt-1">PDF or CSV · click to browse</p>
            </div>
          </div>
        )}
      </div>

      {/* Cancel */}
      <button
        onClick={onCancel}
        disabled={isProcessing}
        className="py-3 rounded-2xl border border-bg-border text-sm text-text-muted hover:text-text-secondary transition-colors disabled:opacity-40"
      >
        Cancel
      </button>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function TrainingPage() {
  const trainingPlan    = useStore((s) => s.trainingPlan);
  const setTrainingPlan = useStore((s) => s.setTrainingPlan);
  const [editing,   setEditing]   = useState(false);
  const [uploading, setUploading] = useState(false);

  const [selectedDay, setSelectedDay] = useState<TrainingDay | null>(null);

  const todayDay    = getTodayDay();
  const tomorrowDay = getTomorrowDay();

  function handleSave(text: string) {
    const latestPlan = useStore.getState().trainingPlan;
    const plan = parseTrainingInput(text, latestPlan);
    setTrainingPlan(plan);
    setEditing(false);
  }

  function handleUploadedPlan(days: TrainingDay[], sport?: string) {
    // Sort Mon-Sun (should already be sorted by API, but enforce here too)
    const sorted = [...days].sort(
      (a, b) => WEEK_DAYS.indexOf(a.day) - WEEK_DAYS.indexOf(b.day)
    );

    // Build a human-readable plan name from the detected sport
    const sportLabel = sport
      ? sport.charAt(0).toUpperCase() + sport.slice(1) + " Training Plan"
      : "Uploaded Training Plan";

    const now = new Date().toISOString();
    const plan: TrainingPlan = {
      id:             crypto.randomUUID(),
      name:           sportLabel,
      sport,                          // preserve detected sport throughout app
      rawInput:       JSON.stringify(sorted),
      weeklySchedule: sorted,
      createdAt:      now,
      updatedAt:      now,
    };

    setTrainingPlan(plan);
    setUploading(false);
  }

  // ── Empty state ──────────────────────────────────────────────────────────
  if (!trainingPlan && !editing && !uploading) {
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
              Enter your weekly schedule or upload a PDF / CSV
            </p>
          </div>
          <div className="flex flex-col gap-2 w-full max-w-xs">
            <button
              onClick={() => setEditing(true)}
              className="py-3 px-6 rounded-2xl bg-gold text-bg-primary text-sm font-bold uppercase tracking-wider hover:bg-gold-light transition-colors"
            >
              Add Training Plan
            </button>
            <button
              onClick={() => setUploading(true)}
              className="py-3 px-6 rounded-2xl border border-bg-border bg-bg-card text-sm font-semibold text-text-secondary hover:border-text-muted/40 transition-colors flex items-center justify-center gap-2"
            >
              <Upload size={14} /> Upload PDF or CSV
            </button>
          </div>
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

  // ── Upload state ─────────────────────────────────────────────────────────
  if (uploading) {
    return (
      <div className="flex flex-col gap-6 animate-fade-in">
        <Header />
        <div>
          <h2 className="text-xs font-bold text-text-muted uppercase tracking-widest mb-3">
            Upload Training Plan
          </h2>
          <p className="text-xs text-text-muted mb-4">
            Upload a PDF or CSV containing your weekly schedule. Claude will parse it automatically.
          </p>
          <PlanUploader
            onParsed={handleUploadedPlan}
            onCancel={() => setUploading(false)}
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

      {/* Session detail modal */}
      {selectedDay && (
        <SessionModal day={selectedDay} onClose={() => setSelectedDay(null)} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-text-muted hover:text-text-secondary transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-text-primary">Training</h1>
            <p className="text-xs text-text-muted mt-0.5">
              {trainingPlan?.name ?? "Weekly plan"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setUploading(true)}
            className="flex items-center gap-1.5 bg-gold text-bg-primary rounded-xl px-3 py-2 text-xs font-bold hover:bg-gold-light transition-colors"
          >
            <Upload size={12} /> Upload Training Plan
          </button>
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 text-gold border border-gold/40 rounded-xl px-3 py-2 text-xs font-bold hover:bg-gold/10 transition-colors"
          >
            <Edit3 size={12} /> Edit
          </button>
        </div>
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

            // Build the metric string: "10 miles · 110 min" or "10 miles" or "45 min"
            const distStr = d.distance !== undefined
              ? `${d.distance} ${d.distanceUnit === "km" ? "km" : "miles"}`
              : null;
            const durStr = d.duration > 0 ? formatDuration(d.duration) : null;
            const metric = d.training_type === "off"
              ? "Rest"
              : distStr && durStr
                ? `${distStr} · ${durStr}`
                : distStr ?? durStr ?? "—";

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
                {/* Full day name */}
                <span
                  className={`w-28 text-xs font-semibold shrink-0 ${
                    isToday ? "text-gold" : "text-text-secondary"
                  }`}
                >
                  {d.day}
                  {isToday && <span className="text-2xs ml-1 text-gold/70">TODAY</span>}
                </span>
                {/* Subtype or type label — tappable to open detail modal */}
                <button
                  onClick={() => setSelectedDay(d)}
                  className="flex-1 flex items-center gap-1.5 text-sm font-semibold text-text-primary hover:text-gold transition-colors text-left group"
                >
                  {d.subtype ?? TYPE_LABEL[d.training_type]}
                  <Info size={11} className="text-text-muted/50 group-hover:text-gold/70 transition-colors shrink-0" />
                </button>
                {/* Distance / duration */}
                <span className="text-xs text-text-muted tabular-nums text-right">
                  {metric}
                </span>
              </div>
            );
          })}
        </div>
      </section>


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
