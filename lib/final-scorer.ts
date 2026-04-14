/**
 * Final Recovery Score — Authoritative Single-Pass Scorer
 *
 * INTERNAL MODULE. No UI component imports from here directly.
 * Output is always mapped to the existing RecoveryScore shape so all
 * existing UI field names (calculatedScore, breakdown, confidence, etc.)
 * remain unchanged.
 *
 * ─── Pipeline ────────────────────────────────────────────────────────────────
 *
 *  Stage 1 │ Subscore normalization
 *           │ Raw athlete inputs → 0–100 per dimension
 *           │ (lib/normalization.ts)
 *           │
 *  Stage 2 │ Recovery State adjustments
 *           │ Multi-day sleep debt, ACWR, load stress, autonomic trend
 *           │ (lib/recovery-state.ts + lib/load-stress.ts)
 *           │
 *  Stage 3 │ Weighted composite score
 *           │ sleep×0.30 + hrv×0.25 + training×0.20 + nutrition×0.15 + modalities×0.10
 *           │ (lib/recovery-engine.ts → computeRecoveryScore)
 *           │
 *  Stage 4 │ Bloodwork modifier
 *           │ ±12 pts from biomarker analysis
 *           │ (lib/bloodwork-engine.ts → analyzeBloodwork)
 *           │
 *  Stage 5 │ Training plan context
 *           │ Today intensity delta + tomorrow prediction delta
 *           │ (planned load, separate from logged training in DailyEntry)
 *           │
 *  Stage 6 │ Final clamp → recovery_score (0–100)
 *           │ Derive zone from score
 *           │
 *  Stage 7 │ Map to RecoveryScore (preserves all existing UI field names)
 *
 * ─── Field name contract ─────────────────────────────────────────────────────
 *
 *  recovery_score → RecoveryScore.calculatedScore   (UI: score ring)
 *  zone           → derived from getRecoveryTier()  (UI: tier color, coaching)
 *
 *  breakdown.sleep / .hrv / .training / .nutrition / .modalities / .bloodwork
 *                 → unchanged (UI: ScoreCard components)
 *
 *  confidence / dataCompleteness → unchanged
 */

import type { DailyEntry, RecoveryScore, ScoreBreakdown, BloodworkPanel, TrainingDay } from "./types";
import { computeRecoveryScore, getRecoveryTier } from "./recovery-engine";
import { analyzeBloodwork } from "./bloodwork-engine";
import { clamp } from "./normalization";

// ─── Internal types ───────────────────────────────────────────────────────────

/**
 * Five-tier recovery zone derived from recovery_score.
 * Maps to the existing "low" | "mid" | "high" UI tier system:
 *   optimal  → high    (≥ 85)
 *   high     → high    (71–84)
 *   moderate → mid     (50–70)
 *   low      → low     (30–49)
 *   critical → low     (< 30)
 *
 * Exported so downstream pipeline modules can reference the canonical type
 * without redeclaring it.
 */
export type RecoveryZone = "optimal" | "high" | "moderate" | "low" | "critical";

/** Internal representation of the final computed score before mapping to RecoveryScore. */
interface FinalScoreInternal {
  recovery_score: number;          // 0–100 authoritative final score
  zone:           RecoveryZone;    // five-tier classification
  breakdown:      ScoreBreakdown;  // per-dimension subscores (same shape as UI expects)
  stageDeltas: {
    bloodwork:      number;        // pts applied in Stage 4
    trainingPlan:   number;        // pts applied in Stage 5
  };
}

// ─── Stage 4 — Bloodwork modifier ────────────────────────────────────────────

interface BloodworkStageResult {
  delta:        number;   // signed pts (−12 … +12)
  bloodworkScore: number; // 0–100 subscore for breakdown.bloodwork
}

function applyBloodworkStage(
  base: number,
  bwPanel: BloodworkPanel | null | undefined,
): BloodworkStageResult {
  if (!bwPanel) return { delta: 0, bloodworkScore: 0 };

  const analysis = analyzeBloodwork(bwPanel);
  return {
    delta:         analysis.recoveryModifier,
    bloodworkScore: analysis.score,
  };
}

// ─── Stage 5 — Training plan context ─────────────────────────────────────────

/**
 * Adjustments from the planned training schedule.
 * Uses the plan's intensity / type, NOT the logged DailyEntry training data
 * (which is already handled by Stage 2–3).  These are predictive/contextual
 * signals layered on top of the measured score.
 */
interface TrainingPlanStageResult {
  delta:       number;   // signed pts
  todayDelta:  number;
  tomorrowDelta: number;
}

// Intensity-to-recovery-score modifiers (spec: low −5, moderate −10, high −20).
// Applied at 50% for recovery_score (softer than readiness — measured state vs. capacity).
const RECOVERY_LOAD_MODIFIER: Record<string, number> = {
  low:      -5,
  moderate: -10,
  high:     -20,
};

function applyTrainingPlanStage(
  todayPlan:    TrainingDay | null | undefined,
  tomorrowPlan: TrainingDay | null | undefined,
): TrainingPlanStageResult {
  let todayDelta = 0;
  let tomorrowDelta = 0;

  if (todayPlan && todayPlan.training_type !== "off") {
    // Today's load taxes the recovery score based on session intensity.
    // Applied at 50 % here — the other 50 % is reflected through the
    // training subscore that the DailyEntry already captures.
    todayDelta += Math.round((RECOVERY_LOAD_MODIFIER[todayPlan.intensity] ?? -5) * 0.5);
    // Game day carries an additional systemic stress tax (travel, contact, adrenaline)
    if (todayPlan.training_type === "game") todayDelta -= 5;
  }

  if (tomorrowPlan) {
    // Tomorrow's demand is a predictive signal: hard day ahead → conserve today
    if (tomorrowPlan.training_type === "game" || tomorrowPlan.intensity === "high") {
      tomorrowDelta = -5;   // conserve — hard day ahead (spec: -5)
    } else if (tomorrowPlan.training_type === "recovery" || tomorrowPlan.training_type === "off") {
      tomorrowDelta = +2;   // recover freely — easy day ahead
    }
  }

  return { delta: todayDelta + tomorrowDelta, todayDelta, tomorrowDelta };
}

// ─── Zone derivation ──────────────────────────────────────────────────────────

function deriveZone(score: number): RecoveryZone {
  if (score >= 85) return "optimal";
  if (score >= 71) return "high";
  if (score >= 50) return "moderate";
  if (score >= 30) return "low";
  return "critical";
}

/**
 * Map internal RecoveryZone to the three-tier string used by getRecoveryTier().
 * Preserves UI compatibility — callers using getRecoveryTier() see the same values.
 */
export function zoneToTier(zone: RecoveryZone): ReturnType<typeof getRecoveryTier> {
  if (zone === "optimal" || zone === "high") return "high";
  if (zone === "moderate")                   return "mid";
  return "low";
}

// ─── Core pipeline ────────────────────────────────────────────────────────────

function runPipeline(
  stageThreeScore: RecoveryScore,
  bwPanel?:        BloodworkPanel | null,
  todayPlan?:      TrainingDay | null,
  tomorrowPlan?:   TrainingDay | null,
): FinalScoreInternal {
  const base = stageThreeScore.calculatedScore;

  // Stage 4 — bloodwork
  const bw = applyBloodworkStage(base, bwPanel);

  // Stage 5 — training plan context
  const tp = applyTrainingPlanStage(todayPlan, tomorrowPlan);

  // Stage 6 — clamp to valid range
  const recovery_score = clamp(base + bw.delta + tp.delta, 0, 100);
  const zone           = deriveZone(recovery_score);

  // Propagate bloodwork subscore into breakdown
  const breakdown: ScoreBreakdown = {
    ...stageThreeScore.breakdown,
    ...(bwPanel ? { bloodwork: bw.bloodworkScore } : {}),
  };

  return {
    recovery_score,
    zone,
    breakdown,
    stageDeltas: { bloodwork: bw.delta, trainingPlan: tp.delta },
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * computeFinalRecoveryScore
 *
 * Single entry point for the complete scoring pipeline (Stages 1–7).
 * Returns a RecoveryScore whose calculatedScore is the fully-adjusted
 * recovery_score.  All existing UI field names are preserved.
 *
 * @param entry        Today's logged DailyEntry
 * @param history      Prior entries, most-recent first (enables Recovery State)
 * @param bwPanel      Optional bloodwork panel (Stage 4 modifier)
 * @param todayPlan    Optional training plan day for today (Stage 5)
 * @param tomorrowPlan Optional training plan day for tomorrow (Stage 5)
 */
export function computeFinalRecoveryScore(
  entry:        DailyEntry,
  history:      DailyEntry[]      = [],
  bwPanel?:     BloodworkPanel | null,
  todayPlan?:   TrainingDay | null,
  tomorrowPlan?: TrainingDay | null,
): RecoveryScore {
  // Stages 1–3: normalization + recovery state + weighted composite
  const stage3 = computeRecoveryScore(entry, history);

  // Stages 4–6: bloodwork + training plan + final clamp + zone
  const final  = runPipeline(stage3, bwPanel, todayPlan, tomorrowPlan);

  // Stage 7: map internal FinalScoreInternal → RecoveryScore (UI contract unchanged)
  return {
    ...stage3,
    calculatedScore: final.recovery_score,   // recovery_score → calculatedScore
    breakdown:       final.breakdown,        // enriched with bloodwork subscore
  };
}

/**
 * getFinalZone
 *
 * Derives the RecoveryZone from a final score without running the full pipeline.
 * Use when you already have a computed score and only need the zone classification.
 *
 * zone → existing UI tier mapping:
 *   "optimal" | "high"  → getRecoveryTier() = "high"
 *   "moderate"          → getRecoveryTier() = "mid"
 *   "low" | "critical"  → getRecoveryTier() = "low"
 */
export function getFinalZone(score: number): RecoveryZone {
  return deriveZone(score);
}
