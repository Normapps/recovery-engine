"use client";

import { useState } from "react";
import { format } from "date-fns";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { analyzeBloodwork, getStatusColor, getStatusLabel } from "@/lib/bloodwork-engine";
import LabUploader from "@/components/LabUploader";
import {
  ArrowLeft, PlusCircle, ChevronDown, ChevronRight,
  FlaskConical, TrendingUp, AlertTriangle, CheckCircle2, Trash2,
} from "lucide-react";

export default function BloodworkPage() {
  const bloodwork       = useStore((s) => s.bloodwork);
  const deleteBloodwork = useStore((s) => s.deleteBloodwork);
  const [showUploader, setShowUploader]       = useState(bloodwork.length === 0);
  const [expandedId, setExpandedId]           = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    deleteBloodwork(id);
    setExpandedId(null);
    setPendingDeleteId(null);
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-in">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-text-muted hover:text-text-secondary transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-text-primary">Lab Results</h1>
            <p className="text-xs text-text-muted mt-0.5">Upload a PDF or CSV to analyze biomarkers</p>
          </div>
        </div>
        {!showUploader && bloodwork.length > 0 && (
          <button
            onClick={() => setShowUploader(true)}
            className="flex items-center gap-1.5 text-gold border border-gold/40 rounded-xl px-3 py-2 text-xs font-semibold hover:bg-gold/10 transition-colors"
          >
            <PlusCircle size={14} /> Add New
          </button>
        )}
      </div>

      {/* ── Uploader ────────────────────────────────────────────────────── */}
      {showUploader && (
        <div>
          {bloodwork.length > 0 && (
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-text-primary">New Lab Entry</h2>
              <button
                onClick={() => setShowUploader(false)}
                className="text-xs text-text-muted hover:text-text-secondary transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
          <LabUploader onSaved={() => setShowUploader(false)} />
        </div>
      )}

      {/* ── History ─────────────────────────────────────────────────────── */}
      {bloodwork.length > 0 && !showUploader && (
        <div className="flex flex-col gap-4">
          {bloodwork.map((entry) => {
            const analysis      = analyzeBloodwork(entry.panel);
            const isExpanded    = expandedId === entry.id;
            const dateFormatted = format(new Date(entry.date + "T12:00:00"), "MMM d, yyyy");
            const scoreColor    =
              analysis.score >= 71 ? "#22C55E" :
              analysis.score >= 41 ? "#F59E0B" : "#EF4444";

            return (
              <div
                key={entry.id}
                className="bg-bg-card border border-bg-border rounded-2xl overflow-hidden"
              >
                {/* Summary row */}
                <button
                  className="w-full flex items-center gap-4 px-5 py-4 hover:bg-bg-elevated/50 transition-colors"
                  onClick={() => {
                    setExpandedId(isExpanded ? null : entry.id);
                    if (isExpanded) setPendingDeleteId(null);
                  }}
                >
                  <div
                    className="h-10 w-10 rounded-full flex items-center justify-center shrink-0"
                    style={{
                      backgroundColor: `${scoreColor}20`,
                      border: `2px solid ${scoreColor}40`,
                    }}
                  >
                    <span className="text-sm font-bold" style={{ color: scoreColor }}>
                      {analysis.score}
                    </span>
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-semibold text-text-primary">{dateFormatted}</p>
                    <p className="text-xs text-text-muted">
                      {entry.labName || "Lab results"} · {analysis.markerCount} markers
                      {analysis.recoveryModifier !== 0 && (
                        <span
                          className={analysis.recoveryModifier > 0 ? " text-recovery-high" : " text-recovery-low"}
                        >
                          {" "}· {analysis.recoveryModifier > 0 ? "+" : ""}
                          {analysis.recoveryModifier} pts to recovery
                        </span>
                      )}
                    </p>
                  </div>
                  {isExpanded
                    ? <ChevronDown size={16} className="text-text-muted shrink-0" />
                    : <ChevronRight size={16} className="text-text-muted shrink-0" />
                  }
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-bg-border px-5 pb-5 space-y-5 mt-1">

                    {/* Score bar */}
                    <div className="flex items-center gap-3 pt-4">
                      <div className="flex-1">
                        <div className="flex justify-between mb-1.5">
                          <span className="text-xs text-text-muted">Biomarker Score</span>
                          <span className="text-xs font-bold text-text-primary">{analysis.score}/100</span>
                        </div>
                        <div className="h-2 bg-bg-border rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${analysis.score}%`, backgroundColor: scoreColor }}
                          />
                        </div>
                      </div>
                      <div className="text-center shrink-0">
                        <p
                          className="text-xs font-semibold"
                          style={{ color: analysis.recoveryModifier >= 0 ? "#22C55E" : "#EF4444" }}
                        >
                          {analysis.recoveryModifier >= 0 ? "+" : ""}{analysis.recoveryModifier} pts
                        </p>
                        <p className="text-2xs text-text-muted">modifier</p>
                      </div>
                    </div>

                    {/* Priority areas */}
                    {analysis.topConcerns.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <AlertTriangle size={13} className="text-recovery-low" />
                          <span className="text-xs font-semibold text-text-primary uppercase tracking-wider">
                            Priority Areas
                          </span>
                        </div>
                        <div className="flex flex-col gap-2">
                          {analysis.topConcerns.slice(0, 5).map((m) => (
                            <MarkerRow key={m.key} marker={m} />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Optimal markers */}
                    {analysis.strengths.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <CheckCircle2 size={13} className="text-recovery-high" />
                          <span className="text-xs font-semibold text-text-primary uppercase tracking-wider">
                            Optimal Markers
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {analysis.strengths.slice(0, 8).map((m) => (
                            <span
                              key={m.key}
                              className="text-2xs px-2 py-1 rounded-lg border"
                              style={{
                                borderColor: "#22C55E40",
                                color: "#22C55E",
                                backgroundColor: "#22C55E10",
                              }}
                            >
                              {m.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <AllMarkersView analysis={analysis} />

                    {entry.notes && (
                      <div className="bg-bg-elevated rounded-xl p-3">
                        <p className="text-2xs text-text-muted uppercase tracking-wider mb-1">Notes</p>
                        <p className="text-xs text-text-secondary">{entry.notes}</p>
                      </div>
                    )}

                    {/* ── Delete ───────────────────────────────────────── */}
                    {pendingDeleteId === entry.id ? (
                      <div className="flex items-center gap-3 pt-1">
                        <p className="flex-1 text-xs text-text-muted">
                          Remove this report permanently?
                        </p>
                        <button
                          onClick={() => setPendingDeleteId(null)}
                          className="text-xs text-text-muted hover:text-text-secondary transition-colors px-2 py-1.5"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleDelete(entry.id)}
                          className="flex items-center gap-1.5 text-xs font-semibold text-recovery-low bg-recovery-low/10 border border-recovery-low/30 rounded-xl px-3 py-1.5 hover:bg-recovery-low/20 transition-colors"
                        >
                          <Trash2 size={12} />
                          Delete
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setPendingDeleteId(entry.id)}
                        className="flex items-center gap-1.5 text-xs text-text-muted hover:text-recovery-low transition-colors self-start pt-1"
                      >
                        <Trash2 size={13} />
                        Delete report
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Empty state ─────────────────────────────────────────────────── */}
      {bloodwork.length === 0 && !showUploader && (
        <div className="flex flex-col items-center gap-4 py-12">
          <FlaskConical size={40} className="text-text-muted" />
          <div className="text-center">
            <p className="text-sm font-semibold text-text-primary">No lab results yet</p>
            <p className="text-xs text-text-muted mt-1">
              Upload a blood test PDF or CSV to get a biomarker recovery score
            </p>
          </div>
          <button
            onClick={() => setShowUploader(true)}
            className="py-3 px-6 rounded-2xl bg-gold text-bg-primary text-sm font-bold hover:bg-gold-light transition-colors"
          >
            Upload Lab Results
          </button>
        </div>
      )}

      {/* ── Info card ───────────────────────────────────────────────────── */}
      <section className="bg-bg-card border border-bg-border rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp size={14} className="text-text-muted" />
          <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            How Bloodwork Affects Your Score
          </h2>
        </div>
        <p className="text-xs text-text-secondary leading-relaxed">
          Blood results from the last 90 days automatically modify your daily recovery score by up to
          <span className="text-recovery-high font-semibold"> +12 pts</span> (optimal biomarkers) or
          <span className="text-recovery-low font-semibold"> −12 pts</span> (deficiencies / imbalances).
          Upload any PDF, CSV, or scanned image — lab values are extracted automatically.
        </p>
      </section>
    </div>
  );
}

// ─── Marker row (history view) ────────────────────────────────────────────

function MarkerRow({
  marker,
}: {
  marker: ReturnType<typeof analyzeBloodwork>["topConcerns"][0];
}) {
  const color       = getStatusColor(marker.status);
  const statusLabel = getStatusLabel(marker.status);
  return (
    <div className="bg-bg-elevated rounded-xl p-3">
      <div className="flex items-center justify-between mb-1">
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
      <p className="text-2xs text-text-muted leading-relaxed">{marker.insight}</p>
      <p className="text-2xs text-text-muted/60 mt-0.5">Optimal: {marker.optimal}</p>
    </div>
  );
}

// ─── All markers grouped view (history) ───────────────────────────────────

function AllMarkersView({
  analysis,
}: {
  analysis: ReturnType<typeof analyzeBloodwork>;
}) {
  const [open, setOpen] = useState(false);

  const grouped = analysis.scoredMarkers.reduce<
    Record<string, typeof analysis.scoredMarkers>
  >((acc, m) => {
    if (!acc[m.category]) acc[m.category] = [];
    acc[m.category].push(m);
    return acc;
  }, {});

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-xs text-text-muted hover:text-text-secondary transition-colors"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {open ? "Hide" : "Show"} all {analysis.markerCount} markers
      </button>
      {open && (
        <div className="mt-3 space-y-4">
          {Object.entries(grouped).map(([category, markers]) => (
            <div key={category}>
              <p className="text-2xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                {category}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {markers.map((m) => {
                  const color = getStatusColor(m.status);
                  return (
                    <div key={m.key} className="bg-bg-elevated rounded-lg p-2.5">
                      <p className="text-2xs text-text-muted truncate">{m.label}</p>
                      <p className="text-xs font-bold mt-0.5 tabular-nums" style={{ color }}>
                        {m.value}{" "}
                        <span className="text-2xs font-normal text-text-muted">{m.unit}</span>
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
