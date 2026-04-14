/**
 * Unified Recovery Engine
 *
 * Combines training schedule + physiology + bloodwork to:
 *  1. Adjust recovery score
 *  2. Recommend EXACTLY 3 modalities (circulation · tissue · nervous system)
 */

import type { TrainingType, IntensityLevel } from "./types";

// ─── Types ───────────────────────────────────────────────────────────────────

export type FatigueLevel  = "low" | "moderate" | "high";
export type HRVTrend      = "up"  | "down"     | "flat";
export type SorenessLevel = "low" | "moderate" | "high";
export type RecoveryStatus = "optimal" | "stable" | "caution" | "fatigued";

export interface TrainingContext {
  type:      TrainingType;
  duration:  number;
  intensity: IntensityLevel;
}

export interface UnifiedInput {
  recovery_score_base:  number;
  today_training:       TrainingContext;
  tomorrow_training:    TrainingContext;
  physiology: {
    hrv_trend:    HRVTrend;
    sleep_hours:  number;
  };
  soreness:  SorenessLevel;
  injury:    { active: boolean; area: string | null };
  bloodwork_modifier?: number;  // ±12 from analyzeBloodwork
  /**
   * Psychological readiness rating from the mood picker (1–5).
   * null = not logged today (treated as neutral — no adjustment applied).
   *
   * Behavioural effect on recommendations:
   *   ≤ 2 → bias circulation toward passive active recovery;
   *          route nervous system to the calming breathwork protocol
   *   ≥ 4 → no override — higher-intensity options remain available
   */
  psych_score?: number | null;
}

export interface ModalityRecommendation {
  id:       string;
  name:     string;
  duration: number;   // minutes
  reason:   string;
}

export interface UnifiedOutput {
  recovery_score:  number;
  status:          RecoveryStatus;
  training_impact: { today: string; tomorrow: string };
  recommended_modalities: ModalityRecommendation[];
  /** Plain text tuple — exactly 3 recommendation strings for API consumers / simpler callers. */
  recommendations: [string, string, string];
}

// ─── Score adjustment (Steps 1–4) ────────────────────────────────────────────

function computeScore(input: UnifiedInput): { score: number; todayDelta: number; tomorrowDelta: number } {
  let delta = 0;

  // Step 1 — today training load
  const { today_training: t, tomorrow_training: tm } = input;
  const todayIntensityDelta =
    t.intensity === "high"     ? -5 :
    t.intensity === "moderate" ? -3 : -1;
  const todayGameDelta = t.type === "game" ? -5 : 0;
  const todayDelta = todayIntensityDelta + todayGameDelta;
  delta += todayDelta;

  // Step 1 — tomorrow prediction
  const tomorrowDelta =
    (tm.type === "game" || tm.intensity === "high") ? -3 :
    (tm.type === "recovery" || tm.type === "off")   ? +2 : 0;
  delta += tomorrowDelta;

  // Step 2 — physiology
  const { hrv_trend, sleep_hours } = input.physiology;
  if (hrv_trend === "down")              delta -= 4;
  if (sleep_hours < 6)                   delta -= 5;
  else if (sleep_hours >= 7 && sleep_hours <= 9) delta += 3;

  // Step 3 — injury
  if (input.injury.active) delta -= 7;

  // Bloodwork modifier
  delta += (input.bloodwork_modifier ?? 0);

  const score = Math.max(0, Math.min(100, input.recovery_score_base + delta));
  return { score, todayDelta, tomorrowDelta };
}

function getStatus(score: number): RecoveryStatus {
  if (score >= 80) return "optimal";
  if (score >= 65) return "stable";
  if (score >= 45) return "caution";
  return "fatigued";
}

// ─── Training impact labels ───────────────────────────────────────────────────

const TYPE_LABEL: Record<TrainingType, string> = {
  strength: "Strength", practice: "Practice", game: "Game",
  recovery: "Recovery", cardio: "Cardio", off: "Rest",
};

function impactLabel(delta: number): string {
  if (delta === 0) return "No impact";
  return delta > 0 ? `+${delta} pts` : `${delta} pts`;
}

function todayImpactText(t: TrainingContext, todayDelta: number): string {
  if (t.type === "off") return "Rest day · no training load";
  return `${TYPE_LABEL[t.type]} · ${t.intensity} intensity · ${impactLabel(todayDelta)} to recovery`;
}

function tomorrowImpactText(tm: TrainingContext, tomorrowDelta: number): string {
  if (tm.type === "off") return "Rest day ahead · recovery boosted";
  return `${TYPE_LABEL[tm.type]} tomorrow · ${impactLabel(tomorrowDelta)} adjustment`;
}

// ─── Modality catalogue ───────────────────────────────────────────────────────

const CATALOGUE: Record<string, { name: string; duration: number }> = {
  active_recovery:    { name: "Active Recovery",    duration: 20 },
  mobility_flow:      { name: "Mobility Flow",       duration: 15 },
  foam_rolling:       { name: "Foam Rolling",        duration: 12 },
  myofascial_release: { name: "Myofascial Release",  duration: 12 },
  compression_boots:  { name: "Compression Boots",   duration: 25 },
  ice_bath:           { name: "Ice Bath",            duration: 12 },
  sauna:              { name: "Sauna",               duration: 20 },
  contrast_therapy:   { name: "Contrast Therapy",    duration: 20 },
  breathwork:         { name: "Breathwork",          duration: 10 },
  sleep_protocol:     { name: "Sleep Protocol",      duration: 480 },
};

function pick(id: string, reason: string): ModalityRecommendation {
  const meta = CATALOGUE[id];
  return { id, name: meta.name, duration: meta.duration, reason };
}

// ─── Recommendation helper ────────────────────────────────────────────────────

/**
 * Returns the default prescriptive reason string for a given modality.
 * Context-sensitive reasons (e.g. game-day, HRV declining) are applied
 * inline in the category selectors below and override these defaults.
 */
export function getRecommendation(modalityName: string): string {
  switch (modalityName) {
    case "Ice Bath":
      return "Submerge legs to the waist for 10 minutes to reduce quad and hamstring inflammation.";
    case "Compression Boots":
      return "Strap on compression boots for 25 minutes to push blood back up from your calves.";
    case "Active Recovery":
      return "Walk or cycle lightly for 20 minutes to clear lactate without stressing your legs.";
    case "Myofascial Release":
      return "Foam roll quads, hamstrings, and calves, pausing 15 seconds on each sore spot.";
    case "Foam Rolling":
      return "Roll quads, IT band, and upper back for 90 seconds per area to restore tissue length.";
    case "Breathwork":
      return "Lie on your back and use 4-4-4-4 box breathing for 10 minutes before sleep.";
    case "Sleep Protocol":
      return "Set a target bedtime two hours earlier and keep your room cool and dark all night.";
    case "Sauna":
      return "Sit in the sauna for 20 minutes at 170–190°F to trigger heat-shock protein production.";
    case "Contrast Therapy":
      return "Alternate 3 minutes hot and 1 minute cold, repeating four times from feet to hips.";
    case "Mobility Flow":
      return "Perform 5 slow hip circles and thoracic rotations per side, holding each end range 3 seconds.";
    default:
      return "Follow your coach's protocol today to support structured recovery and avoid accumulated fatigue.";
  }
}

// ─── Category selectors ──────────────────────────────────────────────────────

function pickCirculation(input: UnifiedInput, score: number): ModalityRecommendation {
  const { today_training: t, soreness } = input;

  // High load or game → prioritise circulation recovery (takes priority over psych signal)
  if (t.type === "game" || (t.intensity === "high" && score < 70)) {
    return pick("compression_boots",
      "Strap on compression boots for 25 minutes post-session to flush lactic acid from your legs.");
  }
  if (soreness === "high") {
    return pick("ice_bath",
      "Submerge legs to the waist for 10 minutes to reduce quad and hamstring inflammation.");
  }
  // Low psych readiness → steer toward passive, low-demand active recovery
  if (input.psych_score != null && input.psych_score <= 2) {
    return pick("active_recovery",
      "Walk or cycle lightly for 20 minutes to clear lactate without stressing your legs.");
  }
  if (score >= 75) {
    return pick("active_recovery",
      "Walk or cycle lightly for 20 minutes to clear lactate without stressing your legs.");
  }
  return pick("compression_boots",
    "Strap on compression boots for 25 minutes to push blood back up from your calves.");
}

function pickTissueWork(input: UnifiedInput, used: Set<string>): ModalityRecommendation {
  const { soreness, injury } = input;

  // Rule: myofascial only when soreness or injury present
  if ((soreness !== "low" || injury.active) && !used.has("myofascial_release")) {
    const area = injury.active && injury.area ? ` Spend extra time on the ${injury.area}.` : "";
    return pick("myofascial_release",
      `Foam roll quads, hamstrings, and calves, pausing 15 seconds on each sore spot.${area}`);
  }
  return pick("foam_rolling",
    "Roll quads, IT band, and upper back for 90 seconds per area to restore tissue length.");
}

function pickNervousSystem(input: UnifiedInput, score: number, used: Set<string>): ModalityRecommendation {
  const { physiology: { sleep_hours, hrv_trend } } = input;

  // Low recovery → prioritise sleep (takes priority over psych signal)
  if (score < 45 || sleep_hours < 6) {
    return pick("sleep_protocol",
      sleep_hours < 6
        ? `You logged ${sleep_hours.toFixed(1)}h — sleep eight hours tonight and stay off screens one hour before bed.`
        : "Set a bedtime two hours earlier and keep your room below 68°F for deeper sleep tonight.");
  }
  // Low psych readiness → nervous system calming before HRV or score threshold
  // Uses an extended exhale (4-4-8) which is clinically more effective for acute stress
  if (input.psych_score != null && input.psych_score <= 2) {
    return pick("breathwork",
      "Lie on your back and breathe in 4 counts, hold 4, exhale 8 — repeat for 10 minutes.");
  }
  // HRV declining or nervous system stressed → breathwork
  if (hrv_trend === "down" || score < 65) {
    return pick("breathwork",
      "Lie on your back and breathe in 4 counts, hold 4, exhale 8 — repeat for 10 minutes.");
  }
  return pick("breathwork",
    "Lie on your back and use 4-4-4-4 box breathing for 10 minutes before sleep.");
}

// ─── Summary builder ─────────────────────────────────────────────────────────

function buildSummary(input: UnifiedInput, score: number, status: RecoveryStatus): string {
  if (status === "fatigued")
    return `Score of ${score} signals high fatigue. Prioritise sleep and passive recovery — avoid adding load.`;
  if (status === "caution")
    return `Score of ${score} — body is under stress. Keep sessions controlled and recovery deliberate.`;
  if (input.today_training.type === "game")
    return `Game day protocol active. Prioritise circulation and nervous system recovery post-competition.`;
  if (status === "optimal")
    return `Recovery score is strong at ${score}. Focused protocol maintains your edge for tomorrow.`;
  return `Score of ${score} — targeted protocol will keep you primed for tomorrow's training.`;
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function unifiedRecoveryEngine(input: UnifiedInput): UnifiedOutput {
  const { score, todayDelta, tomorrowDelta } = computeScore(input);
  const status = getStatus(score);

  const circulation   = pickCirculation(input, score);
  const used          = new Set([circulation.id]);
  const tissueWork    = pickTissueWork(input, used);
  used.add(tissueWork.id);
  const nervousSystem = pickNervousSystem(input, score, used);

  /**
   * Build the plain-text recommendation tuple.
   * Format: "<Name> · <duration> — <reason>"
   * Exactly 3 strings, always, matching the 3 modality slots (circulation · tissue · nervous system).
   */
  function fmt(m: ModalityRecommendation): string {
    const dur = m.duration >= 60 ? `${m.duration / 60}h` : `${m.duration} min`;
    return `${m.name} · ${dur} — ${m.reason}`;
  }

  return {
    recovery_score: score,
    status,
    training_impact: {
      today:    todayImpactText(input.today_training, todayDelta),
      tomorrow: tomorrowImpactText(input.tomorrow_training, tomorrowDelta),
    },
    recommended_modalities: [circulation, tissueWork, nervousSystem],
    recommendations: [fmt(circulation), fmt(tissueWork), fmt(nervousSystem)],
  };
}

// ─── Derive input from app state ─────────────────────────────────────────────

import type { DailyEntry, ScoreBreakdown, BloodworkPanel, TrainingDay } from "./types";

const OFF_TRAINING: TrainingContext = { type: "off", duration: 0, intensity: "low" };

function trainingDayToContext(day: TrainingDay | undefined): TrainingContext {
  if (!day) return OFF_TRAINING;
  return { type: day.training_type, duration: day.duration, intensity: day.intensity };
}

export function buildUnifiedInput(
  baseScore:         number,
  breakdown:         ScoreBreakdown,
  entry:             DailyEntry,
  todayPlan?:        TrainingDay | null,
  tomorrowPlan?:     TrainingDay | null,
  bwPanel?:          BloodworkPanel | null,
  bloodworkModifier?: number,
  moodRating?:       number | null,
): UnifiedInput {
  const hrv_trend: HRVTrend =
    breakdown.hrv >= 70 ? "up" :
    breakdown.hrv < 45  ? "down" : "flat";

  // Soreness: CK from bloodwork or inferred from training load
  const ck = bwPanel?.creatineKinase ?? null;
  const soreness: SorenessLevel =
    ck != null && ck > 300                    ? "high" :
    ck != null && ck > 200                    ? "moderate" :
    (todayPlan?.intensity === "high" || todayPlan?.training_type === "game") ? "moderate" : "low";

  return {
    recovery_score_base:  baseScore,
    today_training:       trainingDayToContext(todayPlan ?? undefined),
    tomorrow_training:    trainingDayToContext(tomorrowPlan ?? undefined),
    physiology: {
      hrv_trend,
      sleep_hours: entry.sleep.duration ?? 7,
    },
    soreness,
    injury: { active: false, area: null },
    bloodwork_modifier: bloodworkModifier ?? 0,
    psych_score: moodRating ?? null,
  };
}
