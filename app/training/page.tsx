"use client";

import { useRef, useState } from "react";
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
  ArrowLeft, Dumbbell, Edit3, Upload, Clock, Flame, TrendingUp, X, FileText,
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

// ─── Plan uploader ─────────────────────────────────────────────────────────────

type UploadState = "idle" | "dragging" | "processing" | "error";

function PlanUploader({
  onParsed,
  onCancel,
}: {
  onParsed: (days: TrainingDay[]) => void;
  onCancel: () => void;
}) {
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [errorMsg, setErrorMsg]       = useState<string>("");
  const [fileName, setFileName]       = useState<string>("");
  const inputRef                      = useRef<HTMLInputElement>(null);

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

      const res = await fetch("/api/upload-training", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      console.log("UPLOAD RESPONSE:", data);

      if (!res.ok || !data.success) {
        throw new Error(data.error ?? "Upload failed.");
      }

      // Upload confirmed — file received and buffer valid.
      // Parsing will be wired in the next step.
      setUploadState("idle");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      setErrorMsg(msg);
      setUploadState("error");
    }
  }

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

  const todayDay    = getTodayDay();
  const tomorrowDay = getTomorrowDay();

  function handleSave(text: string) {
    const latestPlan = useStore.getState().trainingPlan;
    const plan = parseTrainingInput(text, latestPlan);
    setTrainingPlan(plan);
    setEditing(false);
  }

  function handleUploadedPlan(days: TrainingDay[]) {
    // Sort Mon-Sun (should already be sorted by API, but enforce here too)
    const sorted = [...days].sort(
      (a, b) => WEEK_DAYS.indexOf(a.day) - WEEK_DAYS.indexOf(b.day)
    );

    const now = new Date().toISOString();
    const plan: TrainingPlan = {
      id:             crypto.randomUUID(),
      name:           "Uploaded Plan",
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
                  {d.subtype ?? TYPE_LABEL[d.training_type]}
                </span>
                <span className="text-xs text-text-muted tabular-nums">
                  {d.distance !== undefined
                    ? `${d.distance} ${d.distanceUnit ?? "mi"}`
                    : formatDuration(d.duration)}
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
          onClick={() => setUploading(true)}
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
