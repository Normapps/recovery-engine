/**
 * Trend Intelligence Engine
 *
 * Computes rolling averages, trend direction, and pattern-based insights
 * from time-series recovery data.
 */

export type TrendDirection = "improving" | "declining" | "stable";

export interface TrendSummary {
  direction: TrendDirection;
  changePercent: number;   // % change from first half to second half of window
  avg7d: number | null;
  avg30d: number | null;
  latest: number | null;
  min: number | null;
  max: number | null;
}

export interface TrendInsight {
  type: "warning" | "positive" | "info";
  title: string;
  body: string;
}

// ─── Rolling average ───────────────────────────────────────────────────────

export function rollingAverage(values: (number | null)[], window: number): (number | null)[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1).filter((v): v is number => v !== null);
    return slice.length > 0 ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
  });
}

// ─── Trend summary ─────────────────────────────────────────────────────────

export function computeTrendSummary(values: (number | null)[]): TrendSummary {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) {
    return { direction: "stable", changePercent: 0, avg7d: null, avg30d: null, latest: null, min: null, max: null };
  }

  const latest = present[present.length - 1];
  const min = Math.min(...present);
  const max = Math.max(...present);

  const last7 = present.slice(-7).filter((v) => v !== null);
  const last30 = present.slice(-30).filter((v) => v !== null);
  const avg7d = last7.length > 0 ? last7.reduce((a, b) => a + b, 0) / last7.length : null;
  const avg30d = last30.length > 0 ? last30.reduce((a, b) => a + b, 0) / last30.length : null;

  // Trend: compare first half vs second half
  const half = Math.floor(present.length / 2);
  if (half < 2) {
    return { direction: "stable", changePercent: 0, avg7d, avg30d, latest, min, max };
  }

  const firstHalfAvg = present.slice(0, half).reduce((a, b) => a + b, 0) / half;
  const secondHalfAvg = present.slice(half).reduce((a, b) => a + b, 0) / (present.length - half);
  const changePercent = firstHalfAvg > 0 ? ((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100 : 0;

  const direction: TrendDirection =
    changePercent > 4 ? "improving" :
    changePercent < -4 ? "declining" :
    "stable";

  return { direction, changePercent, avg7d, avg30d, latest, min, max };
}

// ─── Pattern-based insights ────────────────────────────────────────────────

export interface DailyPoint {
  date: string;
  score: number | null;
  hrv: number | null;
  rhr: number | null;
  sleep: number | null;
}

export function generateInsights(points: DailyPoint[]): TrendInsight[] {
  const insights: TrendInsight[] = [];
  if (points.length < 5) return insights;

  const recent = points.slice(-14);

  const hrvValues = recent.map((p) => p.hrv).filter((v): v is number => v !== null);
  const rhrValues = recent.map((p) => p.rhr).filter((v): v is number => v !== null);
  const sleepValues = recent.map((p) => p.sleep).filter((v): v is number => v !== null);
  const scoreValues = recent.map((p) => p.score).filter((v): v is number => v !== null);

  // ── Pattern 1: HRV declining + RHR rising = fatigue signal ──────────
  if (hrvValues.length >= 5 && rhrValues.length >= 5) {
    const hrvTrend = computeTrendSummary(hrvValues);
    const rhrTrend = computeTrendSummary(rhrValues);
    if (hrvTrend.direction === "declining" && rhrTrend.direction === "improving") {
      insights.push({
        type: "warning",
        title: "Fatigue Signal Detected",
        body: `HRV has dropped ${Math.abs(hrvTrend.changePercent).toFixed(0)}% while resting HR rose ${rhrTrend.changePercent.toFixed(0)}% over the past 14 days — a classic autonomic fatigue pattern. Consider a recovery day.`,
      });
    }
  }

  // ── Pattern 2: Sleep + Recovery both declining = under-recovery ──────
  if (sleepValues.length >= 5 && scoreValues.length >= 5) {
    const sleepTrend = computeTrendSummary(sleepValues);
    const scoreTrend = computeTrendSummary(scoreValues);
    if (sleepTrend.direction === "declining" && scoreTrend.direction === "declining") {
      insights.push({
        type: "warning",
        title: "Under-Recovery Pattern",
        body: `Sleep duration and recovery scores are both declining. Average sleep is ${sleepTrend.avg7d?.toFixed(1)}h over the past week. Prioritize 8h+ for 3–5 consecutive nights.`,
      });
    }
  }

  // ── Pattern 3: HRV improving + high scores = peak readiness ─────────
  if (hrvValues.length >= 5 && scoreValues.length >= 5) {
    const hrvTrend = computeTrendSummary(hrvValues);
    const scoreTrend = computeTrendSummary(scoreValues);
    const latestScore = scoreTrend.latest ?? 0;
    if (hrvTrend.direction === "improving" && latestScore >= 75) {
      insights.push({
        type: "positive",
        title: "Peak Readiness Window",
        body: `HRV has been trending up ${hrvTrend.changePercent.toFixed(0)}% with a current recovery score of ${latestScore}. This is an optimal window for high-intensity training or performance testing.`,
      });
    }
  }

  // ── Pattern 4: Consistent low sleep ─────────────────────────────────
  if (sleepValues.length >= 5) {
    const avgSleep = sleepValues.reduce((a, b) => a + b, 0) / sleepValues.length;
    if (avgSleep < 7) {
      insights.push({
        type: "warning",
        title: "Chronic Sleep Debt",
        body: `Average sleep over the past ${sleepValues.length} days is ${avgSleep.toFixed(1)}h — below the 7–9h athlete recommendation. Sleep debt compounds and will blunt training adaptations.`,
      });
    }
  }

  // ── Pattern 5: Recovery scores stable and high ───────────────────────
  if (scoreValues.length >= 7) {
    const scoreTrend = computeTrendSummary(scoreValues);
    if (scoreTrend.direction === "stable" && (scoreTrend.avg7d ?? 0) >= 70) {
      insights.push({
        type: "positive",
        title: "Consistent High Recovery",
        body: `Recovery scores have been stable around ${scoreTrend.avg7d?.toFixed(0)} for the past week — excellent baseline. Your training load and recovery balance is dialed in.`,
      });
    }
  }

  // ── Pattern 6: HRV low absolute even if stable ───────────────────────
  if (hrvValues.length >= 3) {
    const avgHRV = hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length;
    if (avgHRV < 40) {
      insights.push({
        type: "warning",
        title: "Low HRV Baseline",
        body: `Average HRV is ${avgHRV.toFixed(0)} ms — below the 50+ ms zone associated with strong recovery capacity. Focus on sleep quality, stress reduction, and parasympathetic activation (cold exposure, breathwork).`,
      });
    }
  }

  return insights.slice(0, 4); // max 4 insights
}

// ─── Biomarker reference ranges for chart bands ───────────────────────────

export interface BiomarkerRef {
  key: string;
  label: string;
  unit: string;
  rangeLow: number;
  rangeHigh: number;
  optimalLow: number;
  optimalHigh: number;
  category: string;
}

export const BIOMARKER_REFS: BiomarkerRef[] = [
  { key: "testosteroneTotal", label: "Testosterone", unit: "ng/dL", rangeLow: 200, rangeHigh: 1200, optimalLow: 600, optimalHigh: 1000, category: "Hormones" },
  { key: "cortisolAM", label: "Cortisol AM", unit: "μg/dL", rangeLow: 4, rangeHigh: 24, optimalLow: 10, optimalHigh: 18, category: "Hormones" },
  { key: "igf1", label: "IGF-1", unit: "ng/mL", rangeLow: 50, rangeHigh: 350, optimalLow: 150, optimalHigh: 250, category: "Hormones" },
  { key: "dheas", label: "DHEA-S", unit: "μg/dL", rangeLow: 50, rangeHigh: 600, optimalLow: 200, optimalHigh: 400, category: "Hormones" },
  { key: "hsCRP", label: "hs-CRP", unit: "mg/L", rangeLow: 0, rangeHigh: 10, optimalLow: 0, optimalHigh: 0.5, category: "Inflammation" },
  { key: "ferritin", label: "Ferritin", unit: "ng/mL", rangeLow: 10, rangeHigh: 300, optimalLow: 80, optimalHigh: 150, category: "Iron" },
  { key: "vitaminD", label: "Vitamin D", unit: "ng/mL", rangeLow: 0, rangeHigh: 100, optimalLow: 50, optimalHigh: 80, category: "Micronutrients" },
  { key: "creatineKinase", label: "Creatine Kinase", unit: "U/L", rangeLow: 0, rangeHigh: 2000, optimalLow: 0, optimalHigh: 200, category: "Muscle Damage" },
  { key: "hemoglobin", label: "Hemoglobin", unit: "g/dL", rangeLow: 10, rangeHigh: 20, optimalLow: 14.5, optimalHigh: 17.5, category: "Oxygen Delivery" },
  { key: "tsh", label: "TSH", unit: "mIU/L", rangeLow: 0, rangeHigh: 5, optimalLow: 0.5, optimalHigh: 2.0, category: "Thyroid" },
  { key: "freeT3", label: "Free T3", unit: "pg/mL", rangeLow: 1.5, rangeHigh: 5, optimalLow: 3.2, optimalHigh: 4.2, category: "Thyroid" },
  { key: "glucoseFasting", label: "Fasting Glucose", unit: "mg/dL", rangeLow: 60, rangeHigh: 130, optimalLow: 72, optimalHigh: 90, category: "Glucose" },
  { key: "insulin", label: "Fasting Insulin", unit: "μIU/mL", rangeLow: 0, rangeHigh: 30, optimalLow: 0, optimalHigh: 5, category: "Glucose" },
  { key: "vitaminB12", label: "Vitamin B12", unit: "pg/mL", rangeLow: 100, rangeHigh: 1200, optimalLow: 400, optimalHigh: 900, category: "Micronutrients" },
  { key: "zinc", label: "Zinc", unit: "μg/dL", rangeLow: 50, rangeHigh: 160, optimalLow: 85, optimalHigh: 120, category: "Micronutrients" },
  { key: "magnesium", label: "Magnesium", unit: "mg/dL", rangeLow: 1.5, rangeHigh: 3.0, optimalLow: 2.1, optimalHigh: 2.5, category: "Electrolytes" },
  { key: "omega3Index", label: "Omega-3 Index", unit: "%", rangeLow: 2, rangeHigh: 14, optimalLow: 8, optimalHigh: 12, category: "Fatty Acids" },
  { key: "homocysteine", label: "Homocysteine", unit: "μmol/L", rangeLow: 3, rangeHigh: 25, optimalLow: 3, optimalHigh: 8, category: "Vascular" },
  { key: "totalCholesterol", label: "Total Cholesterol", unit: "mg/dL", rangeLow: 100, rangeHigh: 300, optimalLow: 160, optimalHigh: 200, category: "Lipids" },
  { key: "hdl", label: "HDL", unit: "mg/dL", rangeLow: 20, rangeHigh: 120, optimalLow: 55, optimalHigh: 120, category: "Lipids" },
  { key: "triglycerides", label: "Triglycerides", unit: "mg/dL", rangeLow: 30, rangeHigh: 300, optimalLow: 30, optimalHigh: 100, category: "Lipids" },
];
