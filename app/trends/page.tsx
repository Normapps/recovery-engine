"use client";

import { useState, useMemo, useEffect } from "react";
import { format, subDays, parseISO } from "date-fns";
import { useStore } from "@/lib/store";
import TrendChart from "@/components/charts/TrendChart";
import {
  computeTrendSummary, rollingAverage, generateInsights,
  BIOMARKER_REFS, type DailyPoint, type TrendDirection,
} from "@/lib/trend-engine";
import { analyzeBloodwork } from "@/lib/bloodwork-engine";
import {
  TrendingUp, TrendingDown, Minus, Lightbulb, Download,
  ChevronDown, Moon, Zap, Heart, FlaskConical, ArrowRight,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────

type TimeRange = "7d" | "30d" | "6m" | "1y" | "3y" | "5y";

const RANGE_CONFIG: Record<TimeRange, { days: number; label: string; tickFormat: string }> = {
  "7d":  { days: 7,    label: "7 Days",   tickFormat: "EEE" },
  "30d": { days: 30,   label: "30 Days",  tickFormat: "MMM d" },
  "6m":  { days: 182,  label: "6 Months", tickFormat: "MMM" },
  "1y":  { days: 365,  label: "1 Year",   tickFormat: "MMM yy" },
  "3y":  { days: 1095, label: "3 Years",  tickFormat: "MMM yy" },
  "5y":  { days: 1825, label: "5 Years",  tickFormat: "yyyy" },
};

// ─── Sub-components ────────────────────────────────────────────────────────

function TimeRangeSelector({ value, onChange }: { value: TimeRange; onChange: (r: TimeRange) => void }) {
  return (
    <div className="flex gap-1 bg-bg-elevated border border-bg-border rounded-xl p-1">
      {(Object.keys(RANGE_CONFIG) as TimeRange[]).map((r) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          className={`flex-1 py-2 rounded-lg text-xs font-semibold uppercase tracking-wide transition-all ${
            value === r
              ? "bg-gold text-bg-primary shadow-sm"
              : "text-text-secondary hover:text-text-primary hover:bg-bg-card"
          }`}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

function TrendBadge({ direction, changePercent }: { direction: TrendDirection; changePercent: number }) {
  const config = {
    improving: { color: "#22C55E", icon: <TrendingUp size={10} />, label: "↑ Improving" },
    declining:  { color: "#EF4444", icon: <TrendingDown size={10} />, label: "↓ Declining" },
    stable:     { color: "#C9A227", icon: <Minus size={10} />, label: "→ Stable" },
  }[direction];

  return (
    <span
      className="flex items-center gap-1 text-2xs font-semibold px-2 py-0.5 rounded-full"
      style={{ color: config.color, backgroundColor: `${config.color}15` }}
    >
      {config.icon}
      {config.label}
      {Math.abs(changePercent) > 1 && (
        <span className="opacity-70">{Math.abs(changePercent).toFixed(0)}%</span>
      )}
    </span>
  );
}

function InsightCard({ type, title, body }: { type: "warning" | "positive" | "info"; title: string; body: string }) {
  const colors = {
    warning:  { bg: "#EF444415", border: "#EF444430", dot: "#EF4444" },
    positive: { bg: "#22C55E15", border: "#22C55E30", dot: "#22C55E" },
    info:     { bg: "#818CF815", border: "#818CF830", dot: "#818CF8" },
  }[type];

  return (
    <div
      className="rounded-2xl p-4"
      style={{ backgroundColor: colors.bg, border: `1px solid ${colors.border}` }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: colors.dot }} />
        <span className="text-xs font-bold text-text-primary">{title}</span>
      </div>
      <p className="text-xs text-text-secondary leading-relaxed pl-3.5">{body}</p>
    </div>
  );
}

function StatPill({ label, value, unit }: { label: string; value: number | null; unit?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-text-secondary font-medium uppercase tracking-wider">{label}</span>
      <span className="text-base font-bold text-text-primary tabular-nums">
        {value !== null ? value.toFixed(value < 10 ? 1 : 0) : "—"}
        {value !== null && unit && <span className="text-xs text-text-muted font-normal ml-0.5">{unit}</span>}
      </span>
    </div>
  );
}

interface TrendCardProps {
  title: string;
  icon: React.ReactNode;
  color: string;
  children: React.ReactNode;
  insight?: string;
  direction?: TrendDirection;
  changePercent?: number;
  stats?: React.ReactNode;
  onOverlay?: () => void;
  overlayLabel?: string;
}

function TrendCard({ title, icon, color, children, insight, direction, changePercent, stats, onOverlay, overlayLabel }: TrendCardProps) {
  return (
    <div className="bg-bg-card border border-bg-border rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <span style={{ color }}>{icon}</span>
          <span className="text-sm font-bold text-text-primary">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          {direction !== undefined && changePercent !== undefined && (
            <TrendBadge direction={direction} changePercent={changePercent} />
          )}
          {onOverlay && (
            <button
              onClick={onOverlay}
              className="text-xs text-text-secondary border border-bg-border rounded-lg px-2.5 py-1 hover:border-text-muted hover:text-text-primary transition-colors"
            >
              {overlayLabel ?? "Overlay"}
            </button>
          )}
        </div>
      </div>
      {stats && <div className="flex gap-5 px-4 pb-3">{stats}</div>}
      <div className="px-2 pb-4">{children}</div>
      {insight && (
        <div className="flex items-start gap-2 px-4 pb-4 pt-1 border-t border-bg-border">
          <Lightbulb size={12} className="text-gold mt-0.5 shrink-0" />
          <p className="text-xs text-text-secondary leading-relaxed">{insight}</p>
        </div>
      )}
    </div>
  );
}

// ─── Biomarker trend panel ─────────────────────────────────────────────────

function BiomarkerTrendPanel({ bloodwork }: { bloodwork: { date: string; panel: Record<string, number | null> }[] }) {
  // This component receives the bloodwork store data
  const [selectedKey, setSelectedKey] = useState(BIOMARKER_REFS[0].key);
  const [open, setOpen] = useState(false);

  const selected = BIOMARKER_REFS.find((r) => r.key === selectedKey)!;

  return (
    <div className="bg-bg-card border border-bg-border rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <FlaskConical size={14} style={{ color: "#C9A227" }} />
          <span className="text-sm font-bold text-text-primary">Biomarker Trends</span>
        </div>
      </div>

      {/* Selector */}
      <div className="px-4 pb-3">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center justify-between w-full bg-bg-elevated border border-bg-border rounded-xl px-3 py-2.5"
        >
          <div>
            <span className="text-sm font-semibold text-text-primary">{selected.label}</span>
            <span className="text-xs text-text-secondary ml-2">{selected.unit} · {selected.category}</span>
          </div>
          <ChevronDown size={14} className={`text-text-muted transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <div className="mt-1 bg-bg-elevated border border-bg-border rounded-xl overflow-hidden shadow-xl z-10 relative max-h-64 overflow-y-auto">
            {BIOMARKER_REFS.map((ref) => (
              <button
                key={ref.key}
                onClick={() => { setSelectedKey(ref.key); setOpen(false); }}
                className={`w-full text-left flex items-center justify-between px-3 py-2.5 hover:bg-bg-card transition-colors border-b border-bg-border/50 last:border-0 ${selectedKey === ref.key ? "bg-gold/10" : ""}`}
              >
                <span className="text-sm text-text-primary">{ref.label}</span>
                <span className="text-xs text-text-secondary">{ref.unit}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Placeholder — will be replaced by BiomarkerChartContent */}
      <BiomarkerChartContent selectedRef={selected} bloodwork={bloodwork} />
    </div>
  );
}

function BiomarkerChartContent({
  selectedRef,
  bloodwork,
}: {
  selectedRef: typeof BIOMARKER_REFS[0];
  bloodwork: { date: string; panel: Record<string, number | null> }[];
}) {
  const dataPoints = bloodwork
    .filter((e) => e.panel[selectedRef.key] !== null && e.panel[selectedRef.key] !== undefined)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({
      date: e.date,
      [selectedRef.key]: e.panel[selectedRef.key] as number,
    }));

  const values = dataPoints.map((p) => p[selectedRef.key] as number);
  const trend = computeTrendSummary(values);

  const insight = dataPoints.length === 0
    ? null
    : `${selectedRef.label}: latest ${trend.latest?.toFixed(1)} ${selectedRef.unit}. Optimal range: ${selectedRef.optimalLow}–${selectedRef.optimalHigh} ${selectedRef.unit}.${
        trend.direction === "declining" ? " Trending lower — monitor closely." :
        trend.direction === "improving" ? " Trending in the right direction." : " Stable."
      }`;

  return (
    <>
      {dataPoints.length > 0 ? (
        <>
          <div className="flex gap-5 px-4 pb-3">
            <StatPill label="Latest" value={trend.latest} unit={selectedRef.unit} />
            <StatPill label="Min" value={trend.min} unit={selectedRef.unit} />
            <StatPill label="Max" value={trend.max} unit={selectedRef.unit} />
          </div>
          <div className="px-2 pb-4">
            <TrendChart
              data={dataPoints as { date: string; [key: string]: number | string | null | undefined }[]}
              series={[{ key: selectedRef.key, color: "#C9A227", label: selectedRef.label, dot: true }]}
              yDomain={[selectedRef.rangeLow, selectedRef.rangeHigh]}
              referenceRange={{ lo: selectedRef.rangeLow, hi: selectedRef.rangeHigh, color: "#6B7280" }}
              optimalRange={{ lo: selectedRef.optimalLow, hi: selectedRef.optimalHigh, color: "#22C55E" }}
              unit={selectedRef.unit}
              height={180}
            />
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 py-8 px-4">
          <p className="text-xs text-text-muted text-center">
            No {selectedRef.label} data yet. Add lab results to see trends.
          </p>
          <a href="/bloodwork" className="flex items-center gap-1 text-xs text-gold hover:underline">
            Add lab results <ArrowRight size={11} />
          </a>
        </div>
      )}
      {insight && (
        <div className="flex items-start gap-2 px-4 pb-4 pt-1 border-t border-bg-border">
          <Lightbulb size={12} className="text-gold mt-0.5 shrink-0" />
          <p className="text-xs text-text-secondary leading-relaxed">{insight}</p>
        </div>
      )}
    </>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────

export default function TrendsPage() {
  const [range, setRange] = useState<TimeRange>("30d");
  const [showHRVOverlay, setShowHRVOverlay] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const scores = useStore((s) => s.scores);
  const entries = useStore((s) => s.entries);
  const bloodwork = useStore((s) => s.bloodwork);
  const days = RANGE_CONFIG[range].days;

  // ── Build time-series ───────────────────────────────────────────────
  const chartData = useMemo(() => {
    const rows = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = subDays(now, i);
      const key = format(d, "yyyy-MM-dd");
      const score = scores[key];
      const entry = entries[key];
      if (score || entry) {
        const rawScore = score ? (score.adjustedScore ?? score.calculatedScore) : null;
        rows.push({
          date: key,
          score: rawScore,
          calculated: score?.calculatedScore ?? null,
          hrv: entry?.sleep?.hrv ?? null,
          rhr: entry?.sleep?.restingHR ?? null,
          sleep: entry?.sleep?.duration ?? null,
          protein: entry?.nutrition?.protein ?? null,
          bodyBattery: entry?.sleep?.bodyBattery ?? null,
        });
      }
    }
    return rows;
  }, [scores, entries, days]);

  // ── Rolling averages ────────────────────────────────────────────────
  const scoreValues = chartData.map((d) => d.score);
  const hrvValues = chartData.map((d) => d.hrv);
  const rhrValues = chartData.map((d) => d.rhr);
  const sleepValues = chartData.map((d) => d.sleep);

  const scoreRolling7 = rollingAverage(scoreValues, 7);
  const hrvRolling7 = rollingAverage(hrvValues, 7);

  const chartDataWithRolling = chartData.map((d, i) => ({
    ...d,
    scoreRolling: scoreRolling7[i],
    hrvRolling: hrvRolling7[i],
  }));

  // ── Trend summaries ─────────────────────────────────────────────────
  const scoreTrend = useMemo(() => computeTrendSummary(scoreValues), [scoreValues]);
  const hrvTrend = useMemo(() => computeTrendSummary(hrvValues), [hrvValues]);
  const rhrTrend = useMemo(() => computeTrendSummary(rhrValues), [rhrValues]);
  const sleepTrend = useMemo(() => computeTrendSummary(sleepValues), [sleepValues]);

  // ── Pattern insights ────────────────────────────────────────────────
  const insightPoints: DailyPoint[] = chartData.map((d) => ({
    date: d.date,
    score: d.score,
    hrv: d.hrv,
    rhr: d.rhr,
    sleep: d.sleep,
  }));
  const insights = useMemo(() => generateInsights(insightPoints), [insightPoints]);

  // ── Distribution ────────────────────────────────────────────────────
  const present = scoreValues.filter((v): v is number => v !== null);
  const low = present.filter((s) => s < 41).length;
  const mid = present.filter((s) => s >= 41 && s < 71).length;
  const high = present.filter((s) => s >= 71).length;

  // ── CSV export ──────────────────────────────────────────────────────
  const exportCSV = () => {
    const headers = "date,recovery_score,hrv_ms,resting_hr_bpm,sleep_hrs,protein_g";
    const rows = chartData.map((d) =>
      `${d.date},${d.score ?? ""},${d.hrv ?? ""},${d.rhr ?? ""},${d.sleep ?? ""},${d.protein ?? ""}`
    );
    const csv = [headers, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `recovery-data-${range}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasData = chartData.length > 0;

  if (!mounted) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
          <p className="text-xs text-text-muted">Loading trends...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 animate-fade-in pb-6">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Trends</h1>
          <p className="text-xs text-text-muted mt-0.5">{RANGE_CONFIG[range].label} · {present.length} data points</p>
        </div>
        <button
          onClick={exportCSV}
          className="flex items-center gap-1.5 text-xs text-text-muted border border-bg-border rounded-xl px-3 py-2 hover:border-text-muted transition-colors"
        >
          <Download size={12} /> Export CSV
        </button>
      </div>

      {/* ── Time range selector ──────────────────────────────────────── */}
      <TimeRangeSelector value={range} onChange={setRange} />

      {/* ── Top stat pills ───────────────────────────────────────────── */}
      {present.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "Avg Score", value: scoreTrend.avg7d, unit: "" },
            { label: "Avg HRV", value: hrvTrend.avg7d, unit: "ms" },
            { label: "Avg RHR", value: rhrTrend.avg7d, unit: "bpm" },
            { label: "Avg Sleep", value: sleepTrend.avg7d, unit: "h" },
          ].map((s) => (
            <div key={s.label} className="bg-bg-card border border-bg-border rounded-xl p-3">
              <p className="text-xs font-medium text-text-secondary uppercase tracking-wider truncate">{s.label}</p>
              <p className="text-lg font-bold text-text-primary mt-1 tabular-nums">
                {s.value !== null ? s.value.toFixed(s.unit === "h" ? 1 : 0) : "—"}
                {s.value !== null && s.unit && <span className="text-xs text-text-muted font-normal ml-0.5">{s.unit}</span>}
              </p>
            </div>
          ))}
        </div>
      )}

      {!hasData && (
        <div className="flex flex-col items-center gap-3 py-12">
          <p className="text-text-muted text-sm">No data in this time range.</p>
          <a href="/log" className="text-gold text-xs hover:underline flex items-center gap-1">Log today's data <ArrowRight size={11} /></a>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* RECOVERY SCORE */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {hasData && (
        <TrendCard
          title="Recovery Score"
          icon={<TrendingUp size={14} />}
          color="#C9A227"
          direction={scoreTrend.direction}
          changePercent={scoreTrend.changePercent}
          stats={<>
            <StatPill label="7-day avg" value={scoreTrend.avg7d} />
            <StatPill label="Peak" value={scoreTrend.max} />
            <StatPill label="Low" value={scoreTrend.min} />
          </>}
          insight={
            scoreTrend.direction === "declining"
              ? `Recovery trending down ${Math.abs(scoreTrend.changePercent).toFixed(0)}% — review sleep, nutrition, and training load.`
              : scoreTrend.direction === "improving"
              ? `Recovery improving ${scoreTrend.changePercent.toFixed(0)}% — excellent adaptation trend.`
              : `Recovery is stable around ${scoreTrend.avg7d?.toFixed(0)} over this period.`
          }
        >
          <TrendChart
            data={chartDataWithRolling}
            series={[
              { key: "score", color: "#C9A227", label: "Score" },
              { key: "scoreRolling", color: "#C9A22760", label: "7d Avg", dashed: true },
            ]}
            showReferences
            yDomain={[0, 100]}
            height={200}
          />
        </TrendCard>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* HRV */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {hasData && hrvValues.some((v) => v !== null) && (
        <TrendCard
          title="HRV"
          icon={<Zap size={14} />}
          color="#22C55E"
          direction={hrvTrend.direction}
          changePercent={hrvTrend.changePercent}
          onOverlay={() => setShowHRVOverlay(!showHRVOverlay)}
          overlayLabel={showHRVOverlay ? "HRV only" : "+ Sleep overlay"}
          stats={<>
            <StatPill label="7-day avg" value={hrvTrend.avg7d} unit="ms" />
            <StatPill label="Peak" value={hrvTrend.max} unit="ms" />
            <StatPill label="Latest" value={hrvTrend.latest} unit="ms" />
          </>}
          insight={
            hrvTrend.direction === "declining"
              ? `HRV has declined ${Math.abs(hrvTrend.changePercent).toFixed(0)}% — accumulating fatigue or under-recovery. Prioritize deep sleep and stress reduction.`
              : `HRV averaging ${hrvTrend.avg7d?.toFixed(0)} ms. ${(hrvTrend.avg7d ?? 0) < 40 ? "Below optimal — focus on recovery protocols." : "Solid baseline."}`
          }
        >
          <TrendChart
            data={chartDataWithRolling}
            series={showHRVOverlay
              ? [
                  { key: "hrv", color: "#22C55E", label: "HRV (ms)" },
                  { key: "sleep", color: "#818CF8", label: "Sleep (hrs)", dashed: true },
                ]
              : [
                  { key: "hrv", color: "#22C55E", label: "HRV (ms)" },
                  { key: "hrvRolling", color: "#22C55E60", label: "7d Avg", dashed: true },
                ]
            }
            height={200}
            unit={showHRVOverlay ? undefined : "ms"}
          />
        </TrendCard>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* SLEEP */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {hasData && sleepValues.some((v) => v !== null) && (
        <TrendCard
          title="Sleep Duration"
          icon={<Moon size={14} />}
          color="#818CF8"
          direction={sleepTrend.direction}
          changePercent={sleepTrend.changePercent}
          stats={<>
            <StatPill label="7-day avg" value={sleepTrend.avg7d} unit="h" />
            <StatPill label="Best" value={sleepTrend.max} unit="h" />
            <StatPill label="Worst" value={sleepTrend.min} unit="h" />
          </>}
          insight={
            (sleepTrend.avg7d ?? 0) < 7
              ? `Average sleep of ${sleepTrend.avg7d?.toFixed(1)}h is below the 7–9h athlete target. Each hour of sleep debt reduces next-day recovery capacity by ~10%.`
              : `Sleep averaging ${sleepTrend.avg7d?.toFixed(1)}h — ${(sleepTrend.avg7d ?? 0) >= 8 ? "excellent duration." : "meeting baseline, aim for 8h+ on hard training nights."}`
          }
        >
          <TrendChart
            data={chartData}
            series={[{ key: "sleep", color: "#818CF8", label: "Sleep (hrs)" }]}
            yDomain={[4, 12]}
            referenceRange={{ lo: 7, hi: 9, color: "#818CF8" }}
            height={200}
            unit="h"
          />
        </TrendCard>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* RESTING HEART RATE */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {hasData && rhrValues.some((v) => v !== null) && (
        <TrendCard
          title="Resting Heart Rate"
          icon={<Heart size={14} />}
          color="#EF4444"
          // For RHR, declining is actually improving
          direction={rhrTrend.direction === "declining" ? "improving" : rhrTrend.direction === "improving" ? "declining" : "stable"}
          changePercent={rhrTrend.changePercent}
          stats={<>
            <StatPill label="7-day avg" value={rhrTrend.avg7d} unit="bpm" />
            <StatPill label="Lowest" value={rhrTrend.min} unit="bpm" />
            <StatPill label="Latest" value={rhrTrend.latest} unit="bpm" />
          </>}
          insight={
            (rhrTrend.avg7d ?? 100) > 65
              ? `Average RHR of ${rhrTrend.avg7d?.toFixed(0)} bpm is elevated. Elevated RHR often signals insufficient recovery, dehydration, or illness onset.`
              : `RHR of ${rhrTrend.avg7d?.toFixed(0)} bpm indicates good cardiovascular fitness and recovery state.`
          }
        >
          <TrendChart
            data={chartData}
            series={[{ key: "rhr", color: "#EF4444", label: "RHR (bpm)" }]}
            referenceRange={{ lo: 45, hi: 65, color: "#22C55E" }}
            height={200}
            unit="bpm"
          />
        </TrendCard>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* PATTERN INSIGHTS */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {insights.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Lightbulb size={13} className="text-gold" />
            <h2 className="text-xs font-semibold text-gold uppercase tracking-wider">Trend Intelligence</h2>
          </div>
          {insights.map((insight, i) => (
            <InsightCard key={i} type={insight.type} title={insight.title} body={insight.body} />
          ))}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* RECOVERY DISTRIBUTION */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {present.length > 0 && (
        <div className="bg-bg-card border border-bg-border rounded-2xl p-4">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">Score Distribution</h3>
          <div className="flex flex-col gap-3">
            {[
              { label: "High  71–100", count: high, color: "#22C55E" },
              { label: "Mid   41–70",  count: mid,  color: "#F59E0B" },
              { label: "Low    0–40",  count: low,  color: "#EF4444" },
            ].map((bar) => (
              <div key={bar.label} className="flex items-center gap-3">
                <span className="text-xs text-text-secondary w-24 shrink-0 font-mono">{bar.label}</span>
                <div className="flex-1 h-2 bg-bg-border rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: present.length > 0 ? `${(bar.count / present.length) * 100}%` : "0%", backgroundColor: bar.color }}
                  />
                </div>
                <span className="text-xs text-text-secondary w-8 text-right tabular-nums shrink-0">
                  {present.length > 0 ? Math.round((bar.count / present.length) * 100) : 0}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* BIOMARKER TRENDS */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <BiomarkerTrendPanel
        bloodwork={bloodwork.map((e) => ({ date: e.date, panel: e.panel as unknown as Record<string, number | null> }))}
      />
    </div>
  );
}
