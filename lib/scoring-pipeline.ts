/**
 * Recovery Scoring Pipeline — Authoritative Single Entry Point
 *
 * Consolidates all five scoring stages into one call.  Returns an output
 * shape that is EXACTLY compatible with what the UI expects:
 *
 *   {
 *     recovery_score,
 *     zone,
 *     recommendations,
 *     breakdown: { recovery_state, load_stress, injury_impact }
 *   }
 *
 * ─── Stage map ───────────────────────────────────────────────────────────────
 *
 *  Stage 1 │ Input normalization
 *           │ Raw athlete values → 0–100 per dimension
 *           │ lib/normalization.ts
 *           │
 *  Stage 2 │ Recovery State
 *           │ Multi-day sleep debt, ACWR, autonomic HRV/RHR trend
 *           │ lib/recovery-state.ts
 *           │  → produces:  breakdown.recovery_state  (0–100)
 *           │
 *  Stage 3 │ Load Stress
 *           │ Session AU, Foster monotony / strain
 *           │ lib/load-stress.ts
 *           │  → produces:  breakdown.load_stress  (0–100, 100 = minimal stress)
 *           │
 *  Stage 4 │ Final Score
 *           │ Weighted composite + bloodwork modifier + training-plan context
 *           │ lib/final-scorer.ts → computeFinalRecoveryScore
 *           │  → produces:  recovery_score (0–100),  zone (5-tier)
 *           │
 *  Stage 5 │ Recommendations
 *           │ 3 targeted modalities derived from full context
 *           │ lib/modality-recommendations.ts → unifiedRecoveryEngine
 *           │  → produces:  recommendations: [string, string, string]
 *           │
 *  Stage 6 │ Interpretation
 *           │ Raw dimension subscores → plain-English athlete insights
 *           │ lib/interpretation-engine.ts → interpretFromBreakdown
 *           │  → produces:  interpretation: { interpretations, primary_driver }
 *
 * ─── Field contract ───────────────────────────────────────────────────────────
 *
 *   recovery_score    — 0–100 authoritative final score (ring display)
 *   zone              — "optimal"|"high"|"moderate"|"low"|"critical"
 *   recommendations   — exactly 3 strings, one per modality category
 *   breakdown.recovery_state  — 0–100; 50 = neutral (no history), >50 = trending up
 *   breakdown.load_stress     — 0–100; 100 = no cumulative stress, 0 = overreaching
 *   breakdown.injury_impact   — 0–100; 100 = no injury, <100 = injury suppresses score
 *                               // UI TODO: wire in injury store when injury tracking exists
 *   interpretation.interpretations — string[] per weak dimension (most concerning first)
 *   interpretation.primary_driver  — single biggest negative contributor as noun phrase
 *
 * ─── Usage note ───────────────────────────────────────────────────────────────
 *
 *   // UI TODO: replace the dual computeFinalRecoveryScore + unifiedRecoveryEngine
 *   // calls in app/page.tsx and DailyLogForm.tsx with a single runScoringPipeline()
 *   // call; consume breakdown.recovery_state / load_stress / injury_impact in new
 *   // ScoreCard slots once the UI is ready.
 */

import type { DailyEntry, BloodworkPanel, TrainingDay, IntensityLevel } from "./types";
import type { RecoveryZone } from "./final-scorer";
import { clamp } from "./normalization";
import {
  computeComplianceModifier,
  type ComplianceTaskInput,
  type ComplianceResult,
} from "./compliance-engine";
import { computeRecoveryStateAdjustments } from "./recovery-state";
import { computeLoadStressResult }          from "./load-stress";
import { computeFinalRecoveryScore, getFinalZone } from "./final-scorer";
import {
  buildUnifiedInput,
  unifiedRecoveryEngine,
} from "./modality-recommendations";
import {
  interpretFromBreakdown,
  type InterpretationOutput,
} from "./interpretation-engine";
import {
  selectModalities,
  type ModalitySelectionInput,
  type ModalitySelectionOutput,
} from "./modality-selection-engine";

// ─── Readiness score ──────────────────────────────────────────────────────────

/**
 * Four-tier zone for the Readiness Score.
 *
 * Distinct from RecoveryZone — readiness reflects ability to perform today,
 * not internal physiological state.
 *
 * // UI TODO: surface readiness_zone as a secondary badge or progress bar
 * //          alongside the recovery ring once the design is ready.
 */
export type ReadinessZone = "high" | "ready" | "limited" | "not_ready";

/** Per-factor breakdown of what moved the readiness score up or down. */
export interface ReadinessBreakdown {
  base:           number;   // recovery_score starting point
  load:           number;   // today's session deduction (−5 / −10 / −20)
  tomorrow:       number;   // predictive penalty (−5 or 0)
  soreness:       number;   // soreness deduction (−3 / −6 / −10)
  hrv:            number;   // HRV trend bonus/penalty (+5 / 0 / −8)
  sleep:          number;   // sleep trend bonus/penalty (+3 / 0 / −5)
  /** Human-readable label for today's load source ("Low session −5", etc.) */
  load_label:     string;
}

/** Internal input shape for computeReadinessScore — not exported. */
interface ReadinessInput {
  recovery_score:      number;  // 0–100 base
  load_today_score:    number;  // 0–100 (sessionLoadAU → normalised, kept for compat)
  load_tomorrow_score: number;  // 0–100 (tomorrowPlan AU → normalised, kept for compat)
  /** Intensity of today's planned session — drives the primary readiness deduction. */
  intensity_today?:    IntensityLevel;
  /** Intensity of tomorrow's planned session — drives the predictive -5 penalty. */
  intensity_tomorrow?: IntensityLevel;
  /** True when tomorrow is a game/race (applies predictive penalty regardless of intensity). */
  tomorrow_is_game?:   boolean;
  injury: {
    active:   boolean;
    severity: number;  // 1–5; only used when active = true
    soreness: number;  // 1–5; applied independently of injury.active
  };
  trends: {
    hrv_trend:   "up" | "stable" | "down";
    sleep_trend: "stable" | "volatile";
  };
}

// ─── Load modifier constants ──────────────────────────────────────────────────

/** Readiness deduction per today's session intensity (spec: low −5, mod −10, high −20). */
const READINESS_LOAD_MODIFIER: Record<IntensityLevel, number> = {
  low:      -5,
  moderate: -10,
  high:     -20,
};

/**
 * Accumulated fatigue penalty from multiple high-load days this week.
 *
 * Athletes running 3–4 high-intensity sessions per week accumulate systemic
 * fatigue that is not fully captured by today's single-session modifier.
 *
 * Returns:
 *   −10  when 5+ days in the week are high intensity  (overreaching territory)
 *   −5   when 3–4 days are high intensity             (significant cumulative load)
 *   0    otherwise                                      (normal load profile)
 */
function computeAccumulatedFatigue(weeklySchedule?: TrainingDay[]): number {
  if (!weeklySchedule || weeklySchedule.length === 0) return 0;
  const highDays = weeklySchedule.filter(
    (d) => d.training_type !== "off" && d.intensity === "high"
  ).length;
  if (highDays >= 5) return -10;
  if (highDays >= 3) return -5;
  return 0;
}

/**
 * Compute the Readiness Score from a structured input.
 *
 * Readiness represents the athlete's capacity to perform today — distinct from
 * Recovery Score, which reflects internal physiological state.
 *
 * Deduction / bonus sources (in application order):
 *   1. Load stress  — combined today (60%) + tomorrow (40%) load
 *   2. Injury       — active injury severity and present soreness
 *   3. Trend signal — HRV direction and sleep consistency
 *
 * All deductions and bonuses operate on the recovery_score baseline.
 * Result is clamped to [0, 100] and assigned a four-tier zone.
 */
function computeReadinessScore(input: ReadinessInput): {
  readiness_score:    number;
  readiness_zone:     ReadinessZone;
  readiness_breakdown: ReadinessBreakdown;
} {
  let readiness = input.recovery_score;

  // ── Step 2: Load stress ────────────────────────────────────────────────────
  let load_delta  = 0;
  let load_label  = "";
  if (input.intensity_today) {
    load_delta  = READINESS_LOAD_MODIFIER[input.intensity_today];
    const label = input.intensity_today.charAt(0).toUpperCase() + input.intensity_today.slice(1);
    load_label  = `${label} session`;
  } else {
    const combined_load =
      input.load_today_score * 0.6 + input.load_tomorrow_score * 0.4;
    if      (combined_load > 75) load_delta = -25;
    else if (combined_load > 50) load_delta = -15;
    else if (combined_load > 30) load_delta = -8;
    else                         load_delta = -3;
    load_label = combined_load > 30 ? "Training load" : "Rest day";
  }
  readiness += load_delta;

  // Predictive penalty: hard or game day tomorrow → conserve today.
  let tomorrow_delta = 0;
  if (input.intensity_tomorrow === "high" || input.tomorrow_is_game === true) {
    tomorrow_delta = -5;
    readiness -= 5;
  }

  // ── Step 3a: Injury severity (conditional on injury.active) ───────────────
  if (input.injury.active) {
    const sev = input.injury.severity;
    if      (sev >= 4) readiness -= 20;
    else if (sev === 3) readiness -= 10;
    else               readiness -= 5;
  }

  // ── Step 3b: Soreness (always applied, regardless of injury.active) ───────
  //   1–2 → mild     → -3
  //   3   → moderate → -6
  //   4–5 → high     → -10
  let soreness_delta = 0;
  const sor = input.injury.soreness;
  if      (sor >= 4) { soreness_delta = -10; readiness -= 10; }
  else if (sor >= 3) { soreness_delta = -6;  readiness -= 6;  }
  else if (sor >= 1) { soreness_delta = -3;  readiness -= 3;  }

  // ── Step 4: Trend bonus/penalty ───────────────────────────────────────────
  let hrv_delta   = 0;
  let sleep_delta = 0;

  if      (input.trends.hrv_trend === "up")   { hrv_delta =  5; readiness += 5; }
  else if (input.trends.hrv_trend === "down") { hrv_delta = -8; readiness -= 8; }

  if      (input.trends.sleep_trend === "stable")   { sleep_delta =  3; readiness += 3; }
  else if (input.trends.sleep_trend === "volatile") { sleep_delta = -5; readiness -= 5; }

  // ── Step 5: Clamp ─────────────────────────────────────────────────────────
  const readiness_score = Math.max(0, Math.min(100, Math.round(readiness)));

  // ── Step 6: Zone ──────────────────────────────────────────────────────────
  const readiness_zone: ReadinessZone =
    readiness_score >= 85 ? "high"      :
    readiness_score >= 70 ? "ready"     :
    readiness_score >= 50 ? "limited"   : "not_ready";

  const readiness_breakdown: ReadinessBreakdown = {
    base:       input.recovery_score,
    load:       load_delta,
    tomorrow:   tomorrow_delta,
    soreness:   soreness_delta,
    hrv:        hrv_delta,
    sleep:      sleep_delta,
    load_label,
  };

  return { readiness_score, readiness_zone, readiness_breakdown };
}

// ─── Output contract ──────────────────────────────────────────────────────────

export interface ScoringPipelineBreakdown {
  /**
   * Multi-day physiological state score (0–100).
   *
   * Derived from the combined signed adjustments produced by the Recovery State
   * stage (sleep debt, ACWR, autonomic HRV/RHR trend).
   *
   *   50  — neutral (no history, all adjustments are zero)
   *   >50 — positive trend (sleeping well, good ACWR, HRV improving)
   *   <50 — accumulated fatigue or autonomic suppression
   *
   * Each adjustment point maps linearly to one score point so the value is
   * directly interpretable by coaches and athletes.
   */
  recovery_state: number;

  /**
   * Cumulative load stress score (0–100).
   *
   * Inverted from the Foster strain stress score so that higher = better:
   *   100 — minimal accumulated load, athlete is well-rested
   *   50  — moderate weekly strain (active training block)
   *   0   — overreaching territory (strain > 8 000 AU)
   */
  load_stress: number;

  /**
   * Injury impact score (0–100).
   *
   *   100 — no active injury; score is unaffected
   *   <100 — injury present; score is suppressed proportionally
   *
   * NOTE: injury tracking is not yet implemented. This field always returns 100
   * until an injury store and assessment flow are added.
   *
   * // UI TODO: add injury toggle / severity input to DailyLogForm and
   * //          thread the resulting impact value through here.
   */
  injury_impact: number;
}

export interface ScoringPipelineOutput {
  /** Authoritative final score (0–100). Maps to the score ring. */
  recovery_score: number;

  /**
   * Five-tier zone classification.
   * Maps to the existing three-tier UI system via zoneToTier():
   *   "optimal" | "high"  → "high"   (green)
   *   "moderate"          → "mid"    (amber)
   *   "low" | "critical"  → "low"    (red)
   *
   * // UI TODO: expose zone-level labels ("Optimal", "Peak", etc.) in the
   * //          score ring subtitle once the design is ready.
   */
  zone: RecoveryZone;

  /**
   * Exactly 3 recommendation strings, one per modality category:
   *   [0] Circulation
   *   [1] Tissue work
   *   [2] Nervous system
   *
   * Format: "<Name> · <duration> — <reason>"
   * Compatible with the existing UI recommendation card rendering.
   */
  recommendations: [string, string, string];

  /** Per-dimension subscores for breakdown display. */
  breakdown: ScoringPipelineBreakdown;

  /**
   * Human-readable interpretation of the day's recovery picture.
   *
   *   interpretations  — one plain-English sentence per weak dimension,
   *                       ordered most-concerning first.  Always non-empty
   *                       (carries an all-clear message when all is well).
   *   primary_driver   — the single biggest negative contributor today,
   *                       as a short noun phrase ("Sleep quality", "HRV and
   *                       nervous system recovery", etc.).  Returns a
   *                       positive phrase when no limiter is present.
   *
   * Produced by Stage 6 of the pipeline (lib/interpretation-engine.ts).
   * No numbers or percentages are ever included in these strings.
   */
  interpretation: InterpretationOutput;

  /**
   * Readiness score (0–100) — the athlete's ability to perform TODAY.
   *
   * Distinct from recovery_score:
   *   recovery_score   = internal physiological state (how recovered the body is)
   *   readiness_score  = ability to perform (recovery minus load, injury, and trend risk)
   *
   * Computed by computeReadinessScore() in this file (Stage 7).
   * Inputs: recovery_score, today + tomorrow load, soreness, HRV trend, sleep trend.
   *
   * // UI TODO: surface readiness_score as a secondary metric — e.g. a smaller
   * //          sub-ring, a badge, or a row in the Score Breakdown section —
   * //          once the design direction for readiness display is confirmed.
   */
  readiness_score: number;

  /**
   * Four-tier zone derived from readiness_score:
   *   "high"      ≥ 85 — peak performance window
   *   "ready"     70–84 — good to train at planned intensity
   *   "limited"   50–69 — reduce load or modify session
   *   "not_ready" < 50  — avoid structured training; prioritise recovery
   */
  readiness_zone: ReadinessZone;

  /**
   * Compliance metrics derived from yesterday's plan-task completion.
   *
   *   compliance_score    — 0–100; percentage of yesterday's tasks completed
   *   compliance_modifier — −8 | 0 | +5; applied to both recovery and readiness
   *
   * compliance_score = 100 and compliance_modifier = 0 when no tasks were
   * logged yesterday (neutral — no penalty for missing data).
   */
  compliance: ComplianceResult;

  /**
   * Contextual modality selection — Stage 9.
   *
   * Produced by selectModalities() in lib/modality-selection-engine.ts.
   *
   *   primary    — the single most important modality for today's context
   *   supporting — 1–2 complementary modalities from different focus categories
   *   meta       — classification labels (primary_focus, recovery_state, etc.)
   *
   * IDs in primary and supporting will never appear in previousModalities
   * (the no-repeat guarantee).  Callers that render modality cards should
   * prefer this output over the unifiedRecoveryEngine recommendations when
   * they need the structured primary/supporting split.
   */
  modality_selection: ModalitySelectionOutput;
}

// ─── Dashboard readiness helper (exported) ───────────────────────────────────

/**
 * Compute readiness using data that is already available on the dashboard
 * without running the full pipeline (no history required).
 *
 * Called by DashboardContent in app/page.tsx alongside the stored
 * recovery_score so both rings can be rendered without an extra store round-trip.
 *
 * @param recovery_score      Display score (0–100, psych-delta already applied)
 * @param load_today_score    Today's session load normalised to 0–100
 * @param load_tomorrow_score Tomorrow's planned load normalised to 0–100
 * @param soreness            Derived soreness level from unifiedInput
 * @param hrv_score           breakdown.hrv subscore (0–100)
 * @param sleep_quality       1–5 from todayEntry, null = unknown (treated as neutral)
 */
export function computeDashboardReadiness(params: {
  recovery_score:       number;
  load_today_score:     number;
  load_tomorrow_score:  number;
  soreness:             "low" | "moderate" | "high";
  hrv_score:            number;
  sleep_quality:        number | null;
  /** Intensity of today's planned session from the uploaded training plan. */
  intensity_today?:     IntensityLevel;
  /** Intensity of tomorrow's planned session from the uploaded training plan. */
  intensity_tomorrow?:  IntensityLevel;
  /** True when tomorrow is a scheduled game or race. */
  tomorrow_is_game?:    boolean;
}): { readiness_score: number; readiness_zone: ReadinessZone; readiness_breakdown: ReadinessBreakdown } {
  const sorenessToNum: Record<"low" | "moderate" | "high", number> = {
    low: 1, moderate: 3, high: 5,
  };

  const hrv_trend: "up" | "stable" | "down" =
    params.hrv_score >= 70 ? "up" :
    params.hrv_score < 45  ? "down" : "stable";

  const sleep_trend: "stable" | "volatile" =
    (params.sleep_quality ?? 3) >= 3 ? "stable" : "volatile";

  return computeReadinessScore({
    recovery_score:      params.recovery_score,
    load_today_score:    params.load_today_score,
    load_tomorrow_score: params.load_tomorrow_score,
    // When the training plan provides explicit intensity, use it.
    // This gives the more accurate −5/−10/−20 deduction rather than the AU fallback.
    intensity_today:     params.intensity_today,
    intensity_tomorrow:  params.intensity_tomorrow,
    tomorrow_is_game:    params.tomorrow_is_game,
    injury: {
      active:   false,
      severity: 0,
      soreness: sorenessToNum[params.soreness],
    },
    trends: { hrv_trend, sleep_trend },
  });
}


// ─── Stage 2 helper — Recovery State → 0–100 subscore ────────────────────────

/**
 * Normalise the signed adjustment vector from the Recovery State stage into a
 * single 0–100 subscore.
 *
 * Adjustment ranges:
 *   sleepAdj:    −25 … +10  (sleep debt penalty / trend bonus)
 *   trainingAdj: −20 … +5   (ACWR / load-stress blend)
 *   hrvAdj:      −10 … +8   (autonomic HRV & RHR trend)
 *   combined:    −55 … +23
 *
 * Mapping: neutral (combined = 0, no history) → 50.
 * Each adjustment point equals one score point so the value is intuitive.
 * Clamped to [0, 100]; maximum negative (−55) clamps to 0 before reaching it.
 */
function recoveryStateToScore(
  sleepAdj:    number,
  trainingAdj: number,
  hrvAdj:      number,
): number {
  const combined = sleepAdj + trainingAdj + hrvAdj;
  // 50 = neutral baseline; combined shifts the score symmetrically
  return clamp(Math.round(50 + combined), 0, 100);
}

// ─── Stage 3 helper — Load Stress → 0–100 subscore ───────────────────────────

/**
 * Convert the Foster strain stress score (0–100, higher = more stress) into a
 * recovery-friendly subscore (0–100, higher = less stress = better).
 */
function loadStressToScore(stressScore: number): number {
  return clamp(100 - Math.round(stressScore), 0, 100);
}

// ─── Stage 6 helper — Session load AU derivation ─────────────────────────────

/**
 * Multipliers that map intensity level to a perceived-effort scalar.
 *
 * Based on Foster's session-RPE method (session load = duration × RPE):
 *   low      → RPE ~3  (easy / recovery)
 *   moderate → RPE ~5  (comfortable working effort)
 *   high     → RPE ~8  (hard / race-pace / game)
 *
 * Reference thresholds in interpretFromBreakdown:
 *   ~300 AU = moderate session | 600+ AU = heavy session (saturates at 100).
 *
 * Examples:
 *   90 min moderate = 450 AU (load_today_score ≈ 75 — elevated)
 *   90 min high     = 720 AU → capped → load_today_score = 100
 *   60 min low      = 180 AU (load_today_score = 30 — acceptable)
 */
const INTENSITY_AU_MULTIPLIER: Record<IntensityLevel, number> = {
  low:      3,
  moderate: 5,
  high:     8,
};

/**
 * Estimate today's session load in Arbitrary Units from available plan + entry data.
 *
 * Priority:
 *   1. Training plan day (todayPlan) — uses structured duration + intensity.
 *   2. DailyEntry training fields    — sums logged strength + cardio durations
 *                                      at a moderate effort assumption.
 *   3. Zero when no training data is present.
 */
function deriveSessionLoadAU(
  todayPlan: TrainingDay | null | undefined,
  entry:     DailyEntry,
): number {
  // Prefer structured plan data when available
  if (todayPlan && todayPlan.training_type !== "off" && todayPlan.duration > 0) {
    return todayPlan.duration * INTENSITY_AU_MULTIPLIER[todayPlan.intensity];
  }

  // Fall back to logged training entry (assume moderate effort)
  const strengthAU = entry.training.strengthTraining
    ? (entry.training.strengthDuration ?? 45) * INTENSITY_AU_MULTIPLIER.moderate
    : 0;
  const cardioAU = entry.training.cardio
    ? (entry.training.cardioDuration ?? 30) * INTENSITY_AU_MULTIPLIER.moderate
    : 0;

  return strengthAU + cardioAU;
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

/**
 * runScoringPipeline
 *
 * Single entry point for the complete 5-stage scoring pipeline.
 * Stages 1–4 produce recovery_score + zone + breakdown subscores.
 * Stage 5 produces the 3-string recommendation tuple.
 *
 * All intermediate data is discarded; only the final ScoringPipelineOutput
 * is returned.
 *
 * @param entry          Today's logged DailyEntry (required)
 * @param history        Prior entries, most-recent first (enables Stages 2 & 3)
 * @param bwPanel        Latest bloodwork panel (Stage 4 modifier, ±12 pts)
 * @param todayPlan      Planned training for today  (Stage 4 & 5 context)
 * @param tomorrowPlan   Planned training for tomorrow (Stage 4 & 5 context)
 * @param moodRating     Optional 1–5 mood rating from moodLog (null = unknown → neutral)
 * @param yesterdayTasks       Yesterday's plan-task checklist for compliance calculation.
 *                             Pass an empty array or omit to treat as neutral (modifier = 0).
 * @param previousModalities   IDs of modalities used in recent sessions (most-recent first).
 *                             Passed to selectModalities() to enforce the no-repeat guarantee.
 *                             Pass an empty array or omit to allow any modality.
 */
export function runScoringPipeline(
  entry:                DailyEntry,
  history:              DailyEntry[]           = [],
  bwPanel?:             BloodworkPanel | null,
  todayPlan?:           TrainingDay | null,
  tomorrowPlan?:        TrainingDay | null,
  moodRating?:          number | null,
  yesterdayTasks?:      ComplianceTaskInput[],
  previousModalities?:  string[],
  /**
   * Full weekly schedule from the active training plan.
   * Used to compute accumulated fatigue from multiple high-load days.
   * Pass `trainingPlan?.weeklySchedule` at the call site.
   * Omit (or pass undefined) for neutral behaviour — no accumulated fatigue.
   */
  weeklySchedule?:      TrainingDay[],
): ScoringPipelineOutput {

  // ── Stage 2: Recovery State ──────────────────────────────────────────────
  // Computes multi-day adjustments: sleep debt, ACWR, autonomic HRV/RHR trend.
  // Returns zero adjustments when history is empty (safe single-day fallback).
  const { sleepAdj, trainingAdj, hrvAdj } = computeRecoveryStateAdjustments(
    entry,
    history,
  );
  const recovery_state = recoveryStateToScore(sleepAdj, trainingAdj, hrvAdj);

  // ── Stage 3: Load Stress ─────────────────────────────────────────────────
  // Computes Foster session AU, weekly monotony, and strain.
  // Returns score=0 / adjustment=0 when history is empty.
  const loadResult  = computeLoadStressResult(history);
  const load_stress = loadStressToScore(loadResult.stressScore);

  // ── Stage 4: Final Score ─────────────────────────────────────────────────
  // Runs the full 7-stage internal pipeline:
  //   normalization → recovery state → weighted composite →
  //   bloodwork modifier → training-plan context → clamp → zone
  // The bloodwork modifier and training-plan deltas are applied here only
  // (not re-applied in Stage 5) to avoid double-counting.
  const finalScore     = computeFinalRecoveryScore(
    entry,
    history,
    bwPanel,
    todayPlan,
    tomorrowPlan,
  );
  const recovery_score = finalScore.calculatedScore;
  const zone           = getFinalZone(recovery_score);

  // ── Stage 5: Recommendations ─────────────────────────────────────────────
  // Selects exactly 3 modalities (circulation · tissue · nervous system)
  // using the full physiological + training-plan context.
  // bloodwork_modifier is passed as 0 because it is already baked into
  // recovery_score from Stage 4 — passing it again would double-count it.
  const unifiedInput = buildUnifiedInput(
    recovery_score,
    finalScore.breakdown,
    entry,
    todayPlan,
    tomorrowPlan,
    bwPanel,
    0,   // bloodwork already applied in Stage 4
  );
  const unified = unifiedRecoveryEngine(unifiedInput);

  // ── Injury impact ────────────────────────────────────────────────────────
  // No injury tracking exists yet; field reserved for future wiring.
  // // UI TODO: add injury store (active: boolean, severity: 0–3, area: string)
  // //          and thread it through here as:
  // //          injury_impact = clamp(100 - severity * 25, 0, 100)
  const injury_impact = 100;

  // ── Stage 6: Interpretation ───────────────────────────────────────────────
  // Translates raw dimension subscores into human-readable, athlete-friendly
  // language.  No numbers or percentages are included in the output strings.
  //
  // Input mapping:
  //   sleep_score      ← breakdown.sleep
  //   hrv_score        ← breakdown.hrv
  //   rhr_score        ← breakdown.hrv  (proxy; ScoreBreakdown has no separate RHR field)
  //   nutrition_score  ← breakdown.nutrition
  //   psychology_score ← moodRating (1–5, auto-normalised) or neutral fallback (75)
  //   load_today_score ← sessionLoadAU (AU → 0–100 via soft cap at 600 AU)
  const sessionLoadAU = deriveSessionLoadAU(todayPlan, entry);
  const interpretation = interpretFromBreakdown(
    finalScore.breakdown,
    finalScore.breakdown.hrv,   // rhrScore proxy
    moodRating ?? null,
    sessionLoadAU,
  );

  // ── Stage 7: Readiness Score ─────────────────────────────────────────────
  // Derives the athlete's ability to perform TODAY from recovery_score plus
  // load, injury, and short-term trend signals.
  //
  // load_today_score / load_tomorrow_score: AU normalised via soft cap at
  // 600 AU (≈ 90 min high-intensity = max stress).  Scores above 600 clamp
  // to 100 rather than exceeding it.
  //
  // Soreness: mapped from the SorenessLevel derived by buildUnifiedInput():
  //   "low"      → 1 (mild deduction:    -3)
  //   "moderate" → 3 (moderate deduction: -6)
  //   "high"     → 5 (high deduction:    -10)
  //
  // Injury: no injury store yet; injury.active = false, severity = 0.
  //   // BACKEND TODO: when an injury store is added, pass real values here.
  //   //   injury_active   ← injuryStore.active
  //   //   injury_severity ← injuryStore.severity  (1–5)
  //
  // HRV trend: derived from breakdown.hrv subscore (same thresholds as
  //   buildUnifiedInput for consistency).
  //
  // Sleep trend: derived from sleepAdj — a negative sleep adjustment of
  //   more than 3 pts signals sleep volatility or compounding debt.
  const AU_SOFT_CAP = 600;
  const load_today_score    = Math.min(100, Math.round((sessionLoadAU / AU_SOFT_CAP) * 100));

  const tomorrowLoadAU =
    tomorrowPlan && tomorrowPlan.training_type !== "off" && tomorrowPlan.duration > 0
      ? tomorrowPlan.duration * INTENSITY_AU_MULTIPLIER[tomorrowPlan.intensity]
      : 0;
  const load_tomorrow_score = Math.min(100, Math.round((tomorrowLoadAU / AU_SOFT_CAP) * 100));

  const sorenessToNum: Record<typeof unifiedInput.soreness, number> = {
    low: 1, moderate: 3, high: 5,
  };

  const hrv_trend: "up" | "stable" | "down" =
    finalScore.breakdown.hrv >= 70 ? "up" :
    finalScore.breakdown.hrv < 45  ? "down" : "stable";

  const sleep_trend: "stable" | "volatile" = sleepAdj >= -3 ? "stable" : "volatile";

  const { readiness_score: rawReadinessScore, readiness_zone: rawReadinessZone } =
    computeReadinessScore({
      recovery_score,
      load_today_score,
      load_tomorrow_score,
      // Intensity-based deductions (spec: low −5 / moderate −10 / high −20).
      // Defined when a training plan exists; undefined → falls back to AU thresholds.
      intensity_today:    todayPlan?.training_type !== "off" ? todayPlan?.intensity : undefined,
      intensity_tomorrow: tomorrowPlan?.training_type !== "off" ? tomorrowPlan?.intensity : undefined,
      tomorrow_is_game:   tomorrowPlan?.training_type === "game",
      injury: {
        active:   false,
        severity: 0,
        soreness: sorenessToNum[unifiedInput.soreness],
      },
      trends: { hrv_trend, sleep_trend },
    });

  // ── Accumulated fatigue ───────────────────────────────────────────────────
  //
  // Multiple high-intensity days in the same week compound systemic fatigue
  // beyond what a single-session modifier captures.
  //
  // Penalty: −5 (3–4 high days) | −10 (5+ high days) | 0 (otherwise).
  // Applied to both recovery_score and readiness_score before compliance so
  // the downstream pipeline sees the true load-adjusted baseline.
  const fatiguePenalty = computeAccumulatedFatigue(weeklySchedule);

  // ── Stage 8: Compliance modifier ─────────────────────────────────────────
  //
  // Yesterday's plan-task completion is factored in as a behavioural signal.
  // Athletes who follow their prescribed protocol recover better; those who
  // skip multiple pillars carry a measurable (though modest) penalty.
  //
  // Modifier range: −8 … +5 pts.  Applied after all physiological stages so
  // it nudges but never overrides the biological signal.
  //
  // When no tasks were logged yesterday, computeComplianceModifier() returns
  // modifier = 0 (neutral) so the pipeline remains stable without task data.
  const compliance = computeComplianceModifier(yesterdayTasks ?? []);
  const { compliance_modifier } = compliance;

  const recovery_score_final  = clamp(recovery_score  + fatiguePenalty + compliance_modifier, 0, 100);
  const readiness_score_final = clamp(rawReadinessScore + fatiguePenalty + compliance_modifier, 0, 100);

  // Re-derive zone from the compliance-adjusted recovery score
  const zone_final = getFinalZone(recovery_score_final);

  // Re-derive readiness zone from the compliance-adjusted readiness score
  const readiness_zone_final: ReadinessZone =
    readiness_score_final >= 85 ? "high"      :
    readiness_score_final >= 70 ? "ready"     :
    readiness_score_final >= 50 ? "limited"   : "not_ready";

  // ── Stage 9: Dynamic modality selection ──────────────────────────────────
  //
  // Runs after all score adjustments (including compliance) so the selection
  // reflects the true end-state of the athlete's readiness.
  //
  // Soreness: treat unifiedInput.soreness as boolean — any level above "low"
  //   counts as a positive soreness signal for the selection engine.
  //
  // Fatigue: derived from the HRV trend computed in Stage 7 — "down" means
  //   the autonomic nervous system is under stress, which is the primary
  //   physiological correlate of fatigue in this pipeline.
  //
  // Load: pass load_today_score (0–100) directly — matches the engine's
  //   expected normalised 0–100 range.
  const selectionInput: ModalitySelectionInput = {
    recovery_score:      recovery_score_final,
    readiness_score:     readiness_score_final,
    load_today:          load_today_score,
    soreness:            unifiedInput.soreness !== "low",
    fatigue:             hrv_trend === "down",
    injury:              false,  // // BACKEND TODO: thread injury store when available
    previous_modalities: previousModalities ?? [],
  };
  const modality_selection = selectModalities(selectionInput);

  return {
    recovery_score:  recovery_score_final,
    zone:            zone_final,
    recommendations: unified.recommendations,
    breakdown: {
      recovery_state,
      load_stress,
      injury_impact,
    },
    interpretation,
    readiness_score:    readiness_score_final,
    readiness_zone:     readiness_zone_final,
    compliance,
    modality_selection,
  };
}
