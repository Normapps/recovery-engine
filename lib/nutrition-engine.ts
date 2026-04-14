/**
 * Nutrition Engine
 *
 * Generates context-driven nutrition recommendations — 2–3 concise action
 * bullets — based on training load, recovery state, readiness, and injury status.
 *
 * Deliberately non-clinical: no gram counts, no calorie numbers.
 * All output is athlete-friendly language.
 *
 * ─── Decision flow ────────────────────────────────────────────────────────────
 *
 *   Step 1 │ Classify training load, recovery state, readiness state
 *   Step 2 │ Determine primary goal (performance / recovery / repair / sustain)
 *   Step 3 │ Select 2–3 bullets from goal-specific pool
 *           │ Apply secondary modifiers (HRV trend, psychology, tomorrow's load)
 *
 * // UI TODO: render the nutrition string array in the Today's Plan nutrition
 * //          card or a dedicated nutrition recommendations module when ready.
 */

import type { IntensityLevel } from "./types";
import type { HRVTrend }       from "./modality-recommendations";

// ─── Input ────────────────────────────────────────────────────────────────────

export interface TrainingContext {
  intensity: IntensityLevel;   // "low" | "moderate" | "high"
  duration:  number;           // minutes; 0 = rest / off day
  type:      string;           // "strength" | "cardio" | "game" | "off" | etc.
}

export interface NutritionEngineInput {
  recovery_score:    number;          // 0–100
  readiness_score:   number;          // 0–100
  training_today:    TrainingContext | null;
  training_tomorrow: TrainingContext | null;
  sleep_score:       number;          // 0–100
  hrv_trend:         HRVTrend;        // "up" | "flat" | "down"
  psychology_score:  number | null;   // 1–5 mood rating; null = not logged
  injury_status: {
    active:    boolean;
    severity?: number;                // 1–5; only relevant when active = true
  };
}

// ─── Output ───────────────────────────────────────────────────────────────────

export interface NutritionOutput {
  /** Exactly 2–3 concise, athlete-friendly action bullets. */
  nutrition: string[];
}

// ─── Step 1 — Classify ────────────────────────────────────────────────────────

type LoadLevel      = "high" | "moderate" | "low";
type StateLevel     = "high" | "moderate" | "low";
type PrimaryGoal    = "performance" | "recovery" | "repair" | "sustain";

function classifyLoad(training: TrainingContext | null): LoadLevel {
  if (!training || training.type === "off" || training.duration === 0) return "low";
  if (training.intensity === "high" || training.duration > 75)          return "high";
  if (training.intensity === "moderate" && training.duration >= 30)     return "moderate";
  return "low";
}

function classifyState(score: number): StateLevel {
  if (score >= 75) return "high";
  if (score >= 50) return "moderate";
  return "low";
}

// ─── Step 2 — Determine primary goal ─────────────────────────────────────────
//
// Priority order (highest → lowest):
//   1. Active injury  → repair  (tissue support is non-negotiable)
//   2. Low recovery   → recovery (physiological debt must be addressed first)
//   3. High load + high/moderate readiness → performance
//   4. Default        → sustain  (maintenance — no strong signal either way)

function determinePrimaryGoal(
  load:     LoadLevel,
  recovery: StateLevel,
  readiness: StateLevel,
  injury:   boolean,
): PrimaryGoal {
  if (injury)                                           return "repair";
  if (recovery === "low")                               return "recovery";
  if (load === "high" && readiness !== "low")           return "performance";
  if (load === "moderate" && recovery === "high")       return "performance";
  return "sustain";
}

// ─── Step 3 — Build bullets ───────────────────────────────────────────────────
//
// Each goal has a core pool of 3 bullets; the function picks 2 to start, then
// optionally adds a 3rd from secondary modifiers (tomorrow's load, HRV trend,
// mood signal).  Result is always 2–3 bullets.

const BULLETS: Record<PrimaryGoal, [string, string, string]> = {
  performance: [
    "Fuel with carbohydrates before your session for sustained energy output",
    "Prioritise protein within 30 minutes of finishing training to accelerate repair",
    "Increase fluid intake throughout the day — high-output sessions increase losses",
  ],
  recovery: [
    "Prioritise protein across all meals to support muscle repair and immune function",
    "Focus on balanced, whole-food meals — now is not the time to under-fuel",
    "Stay consistently hydrated, especially if sleep quality was compromised",
  ],
  repair: [
    "Prioritise protein intake to provide the building blocks for tissue repair",
    "Maintain consistent hydration — injured tissue heals faster when well-hydrated",
    "Avoid under-fueling during recovery; a caloric deficit slows healing",
  ],
  sustain: [
    "Maintain balanced meals with a quality protein source at each eating occasion",
    "Keep carbohydrate intake moderate and time it around any activity",
    "Stay consistently hydrated throughout the day",
  ],
};

/** Secondary modifier bullets — appended as the optional third bullet. */
const MODIFIER_BULLETS = {
  tomorrow_high:  "Load carbohydrates tonight to top up glycogen for tomorrow's session",
  hrv_down:       "Support nervous system recovery with magnesium-rich foods like leafy greens or pumpkin seeds",
  low_mood:       "Prioritise regular meal timing today — stable blood sugar directly supports mood and focus",
  sleep_low:      "Avoid heavy meals in the two hours before bed — they disrupt sleep quality and slow overnight repair",
};

function buildBullets(
  goal:              PrimaryGoal,
  tomorrowLoad:      LoadLevel,
  hrv_trend:         HRVTrend,
  psychology_score:  number | null,
  sleep_score:       number,
): string[] {
  // Always include the first two core bullets for the goal
  const [b1, b2, b3] = BULLETS[goal];
  const bullets: string[] = [b1, b2];

  // Determine whether a secondary modifier is more relevant than b3
  let modifier: string | null = null;

  if (tomorrowLoad === "high") {
    // Pre-loading for tomorrow is the highest-value third bullet
    modifier = MODIFIER_BULLETS.tomorrow_high;
  } else if (hrv_trend === "down") {
    // Nervous system under stress — micronutrient nudge
    modifier = MODIFIER_BULLETS.hrv_down;
  } else if (psychology_score !== null && psychology_score <= 2) {
    // Low mood — blood sugar stability is the fastest dietary intervention
    modifier = MODIFIER_BULLETS.low_mood;
  } else if (sleep_score < 55) {
    // Poor sleep — protect overnight recovery window
    modifier = MODIFIER_BULLETS.sleep_low;
  }

  // Add either the modifier or the core third bullet
  bullets.push(modifier ?? b3);

  return bullets; // always exactly 3
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * generateNutritionRecommendations
 *
 * Classifies athlete context, determines primary goal, and returns 2–3
 * concise, actionable nutrition bullets.
 *
 * @param input  NutritionEngineInput — sourced from scoring pipeline output
 *               and the athlete's daily entry.
 *
 * @returns      NutritionOutput — { nutrition: string[] }, length 2–3.
 *
 * Example (future wiring in DashboardContent):
 *
 *   const { nutrition } = generateNutritionRecommendations({
 *     recovery_score:    displayScore,
 *     readiness_score:   readinessScore,
 *     training_today:    todayPlan  ? { intensity: todayPlan.intensity,  duration: todayPlan.duration,  type: todayPlan.training_type  } : null,
 *     training_tomorrow: tomorrowPlan ? { intensity: tomorrowPlan.intensity, duration: tomorrowPlan.duration, type: tomorrowPlan.training_type } : null,
 *     sleep_score:       breakdown.sleep,
 *     hrv_trend:         breakdown.hrv >= 70 ? "up" : breakdown.hrv < 45 ? "down" : "flat",
 *     psychology_score:  todayMood,
 *     injury_status:     { active: false },
 *   });
 *
 * // UI TODO: pass nutrition string array to the nutrition card / modal
 * //          in Today's Plan section once the display contract is confirmed.
 */
export function generateNutritionRecommendations(
  input: NutritionEngineInput,
): NutritionOutput {
  // Step 1 — Classify
  const load         = classifyLoad(input.training_today);
  const recoveryState = classifyState(input.recovery_score);
  const readinessState = classifyState(input.readiness_score);
  const tomorrowLoad  = classifyLoad(input.training_tomorrow);

  // Step 2 — Primary goal
  const goal = determinePrimaryGoal(
    load,
    recoveryState,
    readinessState,
    input.injury_status.active,
  );

  // Step 3 — Build bullets
  const nutrition = buildBullets(
    goal,
    tomorrowLoad,
    input.hrv_trend,
    input.psychology_score,
    input.sleep_score,
  );

  return { nutrition };
}
