"use client";

import { useState, useRef } from "react";
import { useStore } from "@/lib/store";
import { mergeWearableSleep } from "@/lib/wearable-parser";
import type { ParsedWearableDay, WearableSource } from "@/lib/wearable-parser";
import type { DailyEntry, RecoveryScore } from "@/lib/types";
import { computeFinalRecoveryScore } from "@/lib/final-scorer";
import {
  Upload, CheckCircle2, AlertCircle, Loader2, Watch, ArrowLeft,
  Smartphone, Activity, ChevronDown, ChevronRight,
} from "lucide-react";
import Link from "next/link";

const SOURCE_INFO: Record<WearableSource, { label: string; icon: React.ReactNode; color: string; instructions: string }> = {
  garmin: {
    label: "Garmin Connect",
    icon: <Watch size={16} />,
    color: "#1DC0CF",
    instructions: "Export from Garmin Connect: More → Health Stats → Export CSV. Also supports Activities CSV and Sleep CSV exports.",
  },
  whoop: {
    label: "WHOOP",
    icon: <Activity size={16} />,
    color: "#00D4FF",
    instructions: 'Export from WHOOP app: More → My Data → Download My Data. Use the "journal.csv" file.',
  },
  oura: {
    label: "Oura Ring",
    icon: <Smartphone size={16} />,
    color: "#7C6AF7",
    instructions: "Export from Oura app: Profile → Data Export. Supports sleep.json, readiness.json, or CSV exports.",
  },
  apple_health: {
    label: "Apple Health",
    icon: <Smartphone size={16} />,
    color: "#FF2D55",
    instructions: "Export from Health app: Profile → Export All Health Data. Then unzip and use the export.xml file, or use a third-party CSV export app.",
  },
  unknown: {
    label: "Unknown Device",
    icon: <Activity size={16} />,
    color: "#6B7280",
    instructions: "File format not recognized. Supported: Garmin, WHOOP, Oura, Apple Health.",
  },
};

export default function ImportPage() {
  const upsertEntry = useStore((s) => s.upsertEntry);
  const upsertScore = useStore((s) => s.upsertScore);
  const existingEntries = useStore((s) => s.entries);

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ source: WearableSource; days: ParsedWearableDay[]; errors: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const handleFile = async (file: File) => {
    setUploading(true);
    setError(null);
    setResult(null);
    setImported(false);

    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/parse-wearable", { method: "POST", body: fd });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      if (data.count === 0) {
        setError("No daily records found in this file. Check the format and try again.");
      } else {
        setResult({ source: data.source, days: data.days, errors: data.errors });
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setUploading(false);
    }
  };

  const handleImport = () => {
    if (!result) return;

    for (const day of result.days) {
      const existing = existingEntries[day.date];
      const mergedSleep = mergeWearableSleep(existing?.sleep ?? {}, day.sleep);

      const entry: DailyEntry = {
        id: existing?.id ?? crypto.randomUUID(),
        date: day.date,
        sleep: mergedSleep,
        nutrition: existing?.nutrition ?? { calories: null, protein: null, hydration: null, notes: "" },
        training: {
          strengthTraining: day.training.strengthTraining ?? existing?.training.strengthTraining ?? false,
          strengthDuration: day.training.strengthDuration ?? existing?.training.strengthDuration ?? null,
          cardio: day.training.cardio ?? existing?.training.cardio ?? false,
          cardioDuration: day.training.cardioDuration ?? existing?.training.cardioDuration ?? null,
          coreWork: day.training.coreWork ?? existing?.training.coreWork ?? false,
          mobility: day.training.mobility ?? existing?.training.mobility ?? false,
        },
        recovery: existing?.recovery ?? { iceBath: false, sauna: false, compression: false, massage: false },
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // History must only include entries that predate this day (no future data leakage)
      const history = Object.values(existingEntries)
        .filter((e) => e.date < day.date)
        .sort((a, b) => b.date.localeCompare(a.date));
      const score: RecoveryScore = computeFinalRecoveryScore(entry, history);
      upsertEntry(entry);
      upsertScore(score);
    }

    setImported(true);
  };

  const sourceInfo = result ? SOURCE_INFO[result.source] : null;

  return (
    <div className="flex flex-col gap-6 animate-fade-in pb-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/" className="text-text-muted hover:text-text-secondary transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-text-primary">Import Wearable Data</h1>
          <p className="text-xs text-text-muted mt-0.5">Sync Garmin, WHOOP, Oura, Apple Health</p>
        </div>
      </div>

      {/* Device cards */}
      <div className="grid grid-cols-2 gap-3">
        {(["garmin", "whoop", "oura", "apple_health"] as WearableSource[]).map((src) => {
          const info = SOURCE_INFO[src];
          return (
            <div
              key={src}
              className="bg-bg-card border border-bg-border rounded-2xl p-3.5 flex flex-col gap-2"
            >
              <div className="flex items-center gap-2">
                <span style={{ color: info.color }}>{info.icon}</span>
                <span className="text-xs font-semibold text-text-primary">{info.label}</span>
              </div>
              <p className="text-2xs text-text-muted leading-relaxed">{info.instructions}</p>
            </div>
          );
        })}
      </div>

      {/* Upload zone */}
      <div
        className="bg-bg-card border-2 border-dashed border-bg-border rounded-2xl p-8 flex flex-col items-center gap-4 cursor-pointer hover:border-gold/40 transition-colors"
        onClick={() => fileRef.current?.click()}
      >
        <div className="h-12 w-12 rounded-2xl bg-gold/10 flex items-center justify-center">
          {uploading ? (
            <Loader2 size={22} className="text-gold animate-spin" />
          ) : (
            <Upload size={22} className="text-gold" />
          )}
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold text-text-primary">
            {uploading ? "Parsing your data..." : "Upload export file"}
          </p>
          <p className="text-xs text-text-muted mt-1">CSV, JSON, or XML — drop or click to browse</p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.json,.xml,text/csv,application/json,text/xml,application/xml"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-3 bg-recovery-low/10 border border-recovery-low/30 rounded-2xl p-4">
          <AlertCircle size={16} className="text-recovery-low mt-0.5 shrink-0" />
          <p className="text-sm text-recovery-low">{error}</p>
        </div>
      )}

      {/* Parse result */}
      {result && !imported && (
        <div className="flex flex-col gap-4">
          {/* Summary */}
          <div className="bg-bg-card border border-bg-border rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <span style={{ color: sourceInfo?.color }}>{sourceInfo?.icon}</span>
              <span className="text-sm font-semibold text-text-primary">{sourceInfo?.label} detected</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-bg-elevated rounded-xl p-3">
                <p className="text-2xs text-text-muted uppercase tracking-wider">Days found</p>
                <p className="text-2xl font-bold text-text-primary mt-1">{result.days.length}</p>
              </div>
              <div className="bg-bg-elevated rounded-xl p-3">
                <p className="text-2xs text-text-muted uppercase tracking-wider">Date range</p>
                <p className="text-sm font-bold text-text-primary mt-1">
                  {result.days.length > 0 ? (
                    <>
                      {result.days[result.days.length - 1]?.date?.slice(5)}<br />
                      <span className="text-text-muted font-normal">→ {result.days[0]?.date?.slice(5)}</span>
                    </>
                  ) : "—"}
                </p>
              </div>
            </div>
            {result.errors.length > 0 && (
              <div className="mt-3 pt-3 border-t border-bg-border">
                <p className="text-2xs text-text-muted uppercase tracking-wider mb-1.5">{result.errors.length} parse warnings</p>
                {result.errors.slice(0, 3).map((e, i) => (
                  <p key={i} className="text-2xs text-text-muted">• {e}</p>
                ))}
              </div>
            )}
          </div>

          {/* Preview toggle */}
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="flex items-center justify-between bg-bg-card border border-bg-border rounded-2xl p-4"
          >
            <span className="text-sm font-semibold text-text-primary">Preview data</span>
            {showPreview ? <ChevronDown size={16} className="text-text-muted" /> : <ChevronRight size={16} className="text-text-muted" />}
          </button>

          {showPreview && (
            <div className="bg-bg-card border border-bg-border rounded-2xl overflow-hidden">
              <div className="grid grid-cols-4 gap-2 px-4 py-2 border-b border-bg-border">
                {["Date", "HRV", "RHR", "Sleep"].map((h) => (
                  <span key={h} className="text-2xs text-text-muted uppercase tracking-wider">{h}</span>
                ))}
              </div>
              <div className="max-h-64 overflow-y-auto">
                {result.days.slice(0, 30).map((day) => (
                  <div key={day.date} className="grid grid-cols-4 gap-2 px-4 py-2.5 border-b border-bg-border/50 last:border-0">
                    <span className="text-xs text-text-secondary">{day.date.slice(5)}</span>
                    <span className="text-xs text-text-primary tabular-nums">{day.sleep.hrv ?? "—"}</span>
                    <span className="text-xs text-text-primary tabular-nums">{day.sleep.restingHR ?? "—"}</span>
                    <span className="text-xs text-text-primary tabular-nums">{day.sleep.duration ? `${day.sleep.duration}h` : "—"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Import button */}
          <button
            onClick={handleImport}
            className="w-full py-4 rounded-2xl bg-gold text-bg-primary text-sm font-bold uppercase tracking-wider hover:bg-gold-light transition-colors"
          >
            Import {result.days.length} Days into Recovery Engine
          </button>
          <p className="text-2xs text-text-muted text-center px-4">
            Existing manually-entered values will be preserved. Wearable data fills in missing fields only.
          </p>
        </div>
      )}

      {/* Success */}
      {imported && (
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="h-16 w-16 rounded-full bg-recovery-high/15 flex items-center justify-center">
            <CheckCircle2 size={32} className="text-recovery-high" />
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-text-primary">Import complete</p>
            <p className="text-sm text-text-muted mt-1">{result?.days.length} days synced to your history</p>
          </div>
          <div className="flex gap-3">
            <Link
              href="/trends"
              className="px-4 py-2.5 rounded-xl bg-gold text-bg-primary text-sm font-bold hover:bg-gold-light transition-colors"
            >
              View Trends
            </Link>
            <button
              onClick={() => { setResult(null); setImported(false); setError(null); }}
              className="px-4 py-2.5 rounded-xl border border-bg-border text-sm text-text-secondary hover:border-text-muted transition-colors"
            >
              Import More
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
