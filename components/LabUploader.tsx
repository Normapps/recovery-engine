"use client";

import { useState, useCallback, useRef } from "react";
import { format } from "date-fns";
import {
  Upload, FileText, CheckCircle2, AlertTriangle,
  RefreshCw, Save, ChevronDown, ChevronRight,
  Zap, Dumbbell, Activity, Apple, Heart, type LucideIcon,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { analyzeBloodwork, getStatusColor, getStatusLabel } from "@/lib/bloodwork-engine";
import { generateSuggestions } from "@/lib/lab-suggestions";
import { emptyBloodworkPanel } from "@/lib/types";
import type { BloodworkPanel, BloodworkEntry } from "@/lib/types";

type Phase = "idle" | "uploading" | "done" | "error";
type Tab   = "concerns" | "strengths" | "suggestions";

export default function LabUploader({ onSaved }: { onSaved?: () => void }) {
  const [phase, setPhase]               = useState<Phase>("idle");
  const [panel, setPanel]               = useState<Partial<BloodworkPanel> | null>(null);
  const [count, setCount]               = useState(0);
  const [labName, setLabName]           = useState("");
  const [errorMsg, setErrorMsg]         = useState("");
  const [dragging, setDragging]         = useState(false);
  const [activeTab, setActiveTab]       = useState<Tab>("concerns");
  const [showAll, setShowAll]           = useState(false);
  const [showPaste, setShowPaste]       = useState(false);
  const [pasteText, setPasteText]       = useState("");
  const fileRef                         = useRef<HTMLInputElement>(null);
  const upsertBloodwork                 = useStore((s) => s.upsertBloodwork);

  // ── File processing ────────────────────────────────────────────────────
  const processFile = async (file: File) => {
    setPhase("uploading");
    setErrorMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res  = await fetch("/api/parse-labs", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? "Parse failed");
      if (!json.count || json.count === 0)
        throw new Error("No lab values found. Try a different file or paste the text manually.");
      setPanel(json.panel);
      setCount(json.count);
      setLabName(file.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " "));
      setPhase("done");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Upload failed");
      setPhase("error");
    }
  };

  const processText = async (text: string) => {
    if (!text.trim()) return;
    setPhase("uploading");
    setErrorMsg("");
    try {
      const fd = new FormData();
      fd.append("text", text.trim());
      const res  = await fetch("/api/parse-labs", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? "Parse failed");
      if (!json.count || json.count === 0)
        throw new Error("No lab values found in the pasted text.");
      setPanel(json.panel);
      setCount(json.count);
      setLabName("Pasted Lab Results");
      setPhase("done");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Parse failed");
      setPhase("error");
    }
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleSave = () => {
    if (!panel) return;
    const entry: BloodworkEntry = {
      id:       crypto.randomUUID(),
      date:     format(new Date(), "yyyy-MM-dd"),
      labName:  labName || "Lab Results",
      panel:    { ...emptyBloodworkPanel(), ...panel } as BloodworkPanel,
      notes:    "",
    };
    upsertBloodwork(entry);
    onSaved?.();
  };

  const reset = () => {
    setPhase("idle");
    setPanel(null);
    setCount(0);
    setErrorMsg("");
    setLabName("");
    setShowPaste(false);
    setPasteText("");
    if (fileRef.current) fileRef.current.value = "";
  };

  // ── IDLE / UPLOADING ───────────────────────────────────────────────────
  if (phase === "idle" || phase === "uploading") {
    return (
      <div className="flex flex-col gap-3">
        {/* Drop zone */}
        <div
          className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer select-none ${
            dragging
              ? "border-gold bg-gold/10"
              : "border-bg-border hover:border-gold/40 hover:bg-bg-elevated/50"
          } ${phase === "uploading" ? "pointer-events-none opacity-60" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => !showPaste && fileRef.current?.click()}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.csv,.txt"
            className="hidden"
            onChange={onFileChange}
          />

          {phase === "uploading" ? (
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
              <p className="text-sm text-text-secondary font-medium">Extracting lab values…</p>
              <p className="text-xs text-text-muted">Scanning for biomarkers</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gold/10 border border-gold/20 flex items-center justify-center">
                <Upload size={20} className="text-gold" />
              </div>
              <div>
                <p className="text-sm font-semibold text-text-primary">Drop your lab report here</p>
                <p className="text-xs text-text-muted mt-1">PDF, CSV, or plain text · Click to browse</p>
              </div>
              <div className="flex items-center gap-4 mt-1">
                {["PDF (text or scanned)", "CSV export", "Plain text"].map((label) => (
                  <span key={label} className="flex items-center gap-1 text-xs text-text-secondary">
                    <FileText size={10} /> {label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Paste text option */}
        {phase === "idle" && (
          <div>
            <button
              onClick={() => setShowPaste(!showPaste)}
              className="text-xs text-text-muted hover:text-gold transition-colors flex items-center gap-1.5 mx-auto"
            >
              <FileText size={11} />
              {showPaste ? "Hide" : "Or paste lab text directly"}
            </button>
            {showPaste && (
              <div className="mt-3 flex flex-col gap-2">
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder={"Paste your lab report text here…\n\nExample:\nTestosterone Total   620   ng/dL   300-1000\nVitamin D, 25-OH     42    ng/mL   30-100"}
                  rows={6}
                  className="w-full bg-bg-elevated border border-bg-border rounded-xl px-3 py-3 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-gold/40 font-mono resize-none"
                />
                <button
                  onClick={() => processText(pasteText)}
                  disabled={!pasteText.trim()}
                  className="self-end bg-gold text-bg-primary text-xs font-bold px-4 py-2 rounded-xl hover:bg-gold-light transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Parse Text
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── ERROR ──────────────────────────────────────────────────────────────
  if (phase === "error") {
    return (
      <div className="bg-bg-card border border-bg-border rounded-2xl p-5 flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <AlertTriangle size={16} className="text-recovery-low mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-text-primary">Could not extract lab values</p>
            <p className="text-xs text-text-muted mt-1">{errorMsg}</p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <button
            onClick={reset}
            className="flex items-center gap-2 text-xs text-gold font-semibold hover:text-gold-light transition-colors w-fit"
          >
            <RefreshCw size={12} /> Try another file
          </button>
          {!showPaste && (
            <button
              onClick={() => { reset(); setTimeout(() => setShowPaste(true), 50); }}
              className="flex items-center gap-2 text-xs text-text-muted hover:text-text-secondary transition-colors w-fit"
            >
              <FileText size={12} /> Paste lab text manually instead
            </button>
          )}
        </div>
        {/* Inline paste fallback */}
        {showPaste && (
          <div className="flex flex-col gap-2 border-t border-bg-border pt-4">
            <p className="text-xs text-text-muted">Copy and paste the lab values from your report:</p>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={"Testosterone Total   620   ng/dL\nVitamin D            42    ng/mL\nFerritin             65    ng/mL"}
              rows={5}
              className="w-full bg-bg-elevated border border-bg-border rounded-xl px-3 py-3 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-gold/40 font-mono resize-none"
            />
            <button
              onClick={() => processText(pasteText)}
              disabled={!pasteText.trim()}
              className="self-end bg-gold text-bg-primary text-xs font-bold px-4 py-2 rounded-xl hover:bg-gold-light transition-colors disabled:opacity-40"
            >
              Parse Text
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── DONE: full analysis ─────────────────────────────────────────────────
  if (phase === "done" && panel) {
    const fullPanel  = { ...emptyBloodworkPanel(), ...panel } as BloodworkPanel;
    const analysis   = analyzeBloodwork(fullPanel);
    const suggestions = generateSuggestions(analysis);

    const scoreColor =
      analysis.score >= 71 ? "#22C55E" :
      analysis.score >= 41 ? "#F59E0B" :
                             "#EF4444";
    const scoreLabel =
      analysis.score >= 71 ? "Good" :
      analysis.score >= 41 ? "Fair" : "Poor";

    const CIRC = 2 * Math.PI * 30;

    const TABS: { id: Tab; label: string; count?: number }[] = [
      { id: "concerns",    label: "Issues",      count: analysis.topConcerns.length },
      { id: "strengths",   label: "Optimal",     count: analysis.strengths.length   },
      { id: "suggestions", label: "Actions"                                          },
    ];

    return (
      <div className="flex flex-col gap-4 animate-fade-in">

        {/* ── Score card ─────────────────────────────────────────────── */}
        <div className="bg-bg-card border border-bg-border rounded-2xl p-5">
          <div className="flex items-center gap-4">

            {/* Circle */}
            <div className="relative shrink-0">
              <svg width="72" height="72" viewBox="0 0 72 72">
                <circle cx="36" cy="36" r="30" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
                <circle
                  cx="36" cy="36" r="30" fill="none"
                  stroke={scoreColor} strokeWidth="6"
                  strokeDasharray={CIRC}
                  strokeDashoffset={CIRC * (1 - analysis.score / 100)}
                  strokeLinecap="round"
                  transform="rotate(-90 36 36)"
                  style={{ transition: "stroke-dashoffset 0.8s ease" }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xl font-extrabold" style={{ color: scoreColor }}>
                  {analysis.score}
                </span>
              </div>
            </div>

            {/* Text */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-base font-bold text-text-primary">Biomarker Score</span>
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{ color: scoreColor, backgroundColor: `${scoreColor}20` }}
                >
                  {scoreLabel}
                </span>
              </div>
              <p className="text-xs text-text-muted">{count} markers extracted · {analysis.markerCount} scored</p>
              <div className="flex items-center gap-1.5 mt-2">
                <span
                  className="text-sm font-bold"
                  style={{ color: analysis.recoveryModifier >= 0 ? "#22C55E" : "#EF4444" }}
                >
                  {analysis.recoveryModifier >= 0 ? "+" : ""}{analysis.recoveryModifier} pts
                </span>
                <span className="text-xs text-text-muted">to daily recovery score</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2 shrink-0">
              <button
                onClick={handleSave}
                className="flex items-center gap-1.5 bg-gold text-bg-primary text-xs font-bold px-3.5 py-2 rounded-xl hover:bg-gold-light transition-colors"
              >
                <Save size={12} /> Save
              </button>
              <button
                onClick={reset}
                className="flex items-center justify-center gap-1.5 text-xs text-text-muted px-3.5 py-2 rounded-xl hover:text-text-secondary border border-bg-border transition-colors"
              >
                <RefreshCw size={11} /> New
              </button>
            </div>
          </div>

          {/* Recovery modifier bar */}
          <div className="mt-4 pt-4 border-t border-bg-border">
            <div className="flex justify-between text-xs text-text-secondary mb-1.5">
              <span>Recovery score impact</span>
              <span style={{ color: analysis.recoveryModifier >= 0 ? "#22C55E" : "#EF4444" }}>
                {analysis.recoveryModifier >= 0 ? "+" : ""}{analysis.recoveryModifier} / 12 pts
              </span>
            </div>
            <div className="relative h-1.5 bg-bg-elevated rounded-full overflow-hidden">
              {/* Center mark */}
              <div className="absolute left-1/2 top-0 bottom-0 w-px bg-bg-border" />
              {/* Modifier fill */}
              <div
                className="absolute top-0 h-full rounded-full transition-all"
                style={{
                  backgroundColor: analysis.recoveryModifier >= 0 ? "#22C55E" : "#EF4444",
                  left:  analysis.recoveryModifier >= 0 ? "50%" : `${50 + (analysis.recoveryModifier / 12) * 50}%`,
                  right: analysis.recoveryModifier < 0  ? "50%" : `${50 - (analysis.recoveryModifier / 12) * 50}%`,
                }}
              />
            </div>
          </div>
        </div>

        {/* ── Lab name ───────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-1">
          <p className="text-xs text-text-muted shrink-0">Lab name:</p>
          <input
            value={labName}
            onChange={(e) => setLabName(e.target.value)}
            placeholder="e.g. Quest Diagnostics"
            className="flex-1 bg-bg-elevated border border-bg-border rounded-xl px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-gold/40"
          />
        </div>

        {/* ── Tabs ───────────────────────────────────────────────────── */}
        <div className="flex bg-bg-elevated rounded-xl p-1 gap-1">
          {TABS.map(({ id, label, count: c }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex-1 text-xs font-semibold py-2 rounded-lg transition-all ${
                activeTab === id
                  ? "bg-bg-card text-text-primary shadow-sm"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {label}{c !== undefined ? ` (${c})` : ""}
            </button>
          ))}
        </div>

        {/* ── Tab: Concerns ──────────────────────────────────────────── */}
        {activeTab === "concerns" && (
          <div className="flex flex-col gap-2">
            {analysis.topConcerns.length === 0 ? (
              <EmptyState icon={<CheckCircle2 size={24} className="text-recovery-high" />}
                title="No concerns detected"
                sub="All scored markers are within a healthy range" />
            ) : (
              analysis.topConcerns.map((m) => <MarkerCard key={m.key} marker={m} />)
            )}
          </div>
        )}

        {/* ── Tab: Strengths ─────────────────────────────────────────── */}
        {activeTab === "strengths" && (
          <div className="flex flex-col gap-2">
            {analysis.strengths.length === 0 ? (
              <EmptyState title="No optimal markers yet" sub="Submit more labs to identify your strongest biomarkers" />
            ) : (
              analysis.strengths.map((m) => <MarkerCard key={m.key} marker={m} />)
            )}
          </div>
        )}

        {/* ── Tab: Suggestions ───────────────────────────────────────── */}
        {activeTab === "suggestions" && (
          <div className="flex flex-col gap-3">
            <SuggestionGroup icon={Dumbbell} title="Training"  color="#F59E0B" items={suggestions.training}  />
            <SuggestionGroup icon={Heart}    title="Recovery"  color="#22C55E" items={suggestions.recovery}  />
            <SuggestionGroup icon={Apple}    title="Nutrition" color="#3B82F6" items={suggestions.nutrition} />
            <SuggestionGroup icon={Activity} title="Follow-Up Labs" color="#8B5CF6" items={suggestions.followUp} />
          </div>
        )}

        {/* ── All markers toggle ─────────────────────────────────────── */}
        <button
          onClick={() => setShowAll(!showAll)}
          className="flex items-center gap-2 text-xs text-text-muted hover:text-text-secondary transition-colors"
        >
          {showAll ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {showAll ? "Hide" : "View"} all {analysis.markerCount} scored markers
        </button>
        {showAll && <AllMarkersGrid analysis={analysis} />}
      </div>
    );
  }

  return null;
}

// ─── Sub-components ────────────────────────────────────────────────────────

function MarkerCard({
  marker,
}: {
  marker: ReturnType<typeof analyzeBloodwork>["topConcerns"][0];
}) {
  const color       = getStatusColor(marker.status);
  const statusLabel = getStatusLabel(marker.status);
  return (
    <div className="bg-bg-card border border-bg-border rounded-xl p-3.5">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold text-text-primary">{marker.label}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold tabular-nums" style={{ color }}>
            {marker.value} {marker.unit}
          </span>
          <span
            className="text-2xs font-semibold px-1.5 py-0.5 rounded-md"
            style={{ backgroundColor: `${color}20`, color }}
          >
            {statusLabel}
          </span>
        </div>
      </div>
      <p className="text-xs text-text-secondary leading-relaxed">{marker.insight}</p>
      <p className="text-xs text-text-muted/70 mt-0.5">Optimal: {marker.optimal}</p>
    </div>
  );
}

function SuggestionGroup({
  icon: Icon, title, color, items,
}: {
  icon: LucideIcon;
  title: string;
  color: string;
  items: string[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="bg-bg-card border border-bg-border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon size={13} style={{ color }} />
        <span className="text-xs font-semibold text-text-primary uppercase tracking-wider">{title}</span>
      </div>
      <ul className="flex flex-col gap-2.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2">
            <Zap size={10} className="shrink-0 mt-0.5" style={{ color }} />
            <span className="text-xs text-text-secondary leading-relaxed">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AllMarkersGrid({
  analysis,
}: {
  analysis: ReturnType<typeof analyzeBloodwork>;
}) {
  const grouped = analysis.scoredMarkers.reduce<
    Record<string, typeof analysis.scoredMarkers>
  >((acc, m) => {
    if (!acc[m.category]) acc[m.category] = [];
    acc[m.category].push(m);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([cat, markers]) => (
        <div key={cat}>
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">{cat}</p>
          <div className="grid grid-cols-2 gap-2">
            {markers.map((m) => {
              const color = getStatusColor(m.status);
              return (
                <div key={m.key} className="bg-bg-elevated rounded-lg p-2.5">
                  <p className="text-xs text-text-secondary truncate">{m.label}</p>
                  <p className="text-xs font-bold mt-0.5 tabular-nums" style={{ color }}>
                    {m.value}{" "}
                    <span className="text-xs font-normal text-text-secondary">{m.unit}</span>
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  icon, title, sub,
}: {
  icon?: React.ReactNode;
  title: string;
  sub: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-8">
      {icon}
      <div className="text-center">
        <p className="text-sm font-semibold text-text-primary">{title}</p>
        <p className="text-xs text-text-muted mt-1">{sub}</p>
      </div>
    </div>
  );
}
