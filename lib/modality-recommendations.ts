/**
 * Unified Recovery Engine
 *
 * Combines training schedule + physiology + bloodwork to:
 *  1. Adjust recovery score
 *  2. Recommend EXACTLY 3 modalities (circulation · tissue · nervous system)
 */

import type { TrainingType, IntensityLevel, AthleteArchetype } from "./types";

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
  /**
   * Athlete archetype — drives sport-specific recommendation framing.
   * null = generic framing (no sport context available).
   */
  archetype?: AthleteArchetype | null;
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
      return "10 minutes of cold water flushes inflammation out of your legs — you'll be back to full training capacity 24 hours faster than passive rest alone.";
    case "Compression Boots":
      return "25 minutes in compression boots pumps recovery fluid through your legs — you'll wake up tomorrow with noticeably less soreness and more spring in your step.";
    case "Active Recovery":
      return "20 minutes of easy movement accelerates lactate clearance — your legs will feel fresher for tomorrow's session than if you rest completely.";
    case "Myofascial Release":
      return "12 minutes rolling out the tight spots breaks up tissue adhesions — you'll have more range of motion and less pain in your very next session.";
    case "Foam Rolling":
      return "12 minutes of foam rolling restores tissue length and reduces next-day stiffness — your first reps tomorrow will feel significantly smoother and more controlled.";
    case "Breathwork":
      return "10 minutes of controlled breathing drops your heart rate and cortisol — you'll fall asleep faster tonight and wake up measurably more recovered.";
    case "Sleep Protocol":
      return "Going to bed earlier gives your body more repair cycles — every extra hour of sleep is worth 10+ points on tomorrow's recovery score.";
    case "Sauna":
      return "20 minutes in the sauna triggers heat-shock proteins that repair damaged muscle tissue — you'll feel the difference in your next session and reduce injury risk over time.";
    case "Contrast Therapy":
      return "Alternating hot and cold pumps blood in and out of tired muscle tissue — you'll clear soreness up to 30% faster than passive rest alone.";
    case "Mobility Flow":
      return "15 minutes of mobility work restores joint range after loading — you'll move better tomorrow and lower your long-term injury risk with every session you do this.";
    default:
      return "Complete today's protocol — consistent recovery work compounds into higher baseline scores and better performance week over week.";
  }
}

// ─── Sport-specific context phrases ─────────────────────────────────────────

function sportContext(archetype: AthleteArchetype | null | undefined): {
  legs: string;
  nextSession: string;
  performanceWord: string;
} {
  switch (archetype) {
    case "team_sport":
      return { legs: "your legs", nextSession: "next match", performanceWord: "on the pitch" };
    case "endurance":
      return { legs: "your legs", nextSession: "next long session", performanceWord: "on the road" };
    case "strength":
      return { legs: "your muscles", nextSession: "next lifting session", performanceWord: "under the bar" };
    case "hybrid":
      return { legs: "your body", nextSession: "next training block", performanceWord: "in the gym" };
    case "weekend_warrior":
      return { legs: "your body", nextSession: "next activity", performanceWord: "out there" };
    default:
      return { legs: "your legs", nextSession: "tomorrow's session", performanceWord: "at your next session" };
  }
}

// ─── Category selectors ──────────────────────────────────────────────────────

function pickCirculation(input: UnifiedInput, score: number): ModalityRecommendation {
  const { today_training: t, soreness, archetype } = input;
  const ctx = sportContext(archetype);

  // High load or game → prioritise circulation recovery (takes priority over psych signal)
  if (t.type === "game" || (t.intensity === "high" && score < 70)) {
    return pick("compression_boots",
      `25 minutes in compression boots right now pushes recovery fluid through ${ctx.legs} — you'll start tomorrow significantly fresher and reduce soreness before it sets in.`);
  }
  if (soreness === "high") {
    return pick("ice_bath",
      `10 minutes of cold water right now flushes the inflammation out of ${ctx.legs} — you'll recover a full day faster and get back to full capacity for ${ctx.nextSession}.`);
  }
  // Low psych readiness → steer toward passive, low-demand active recovery
  if (input.psych_score != null && input.psych_score <= 2) {
    return pick("active_recovery",
      `20 minutes of easy movement clears fatigue without adding stress — your body and mind both reset faster with light activity than complete rest. You'll show up more ready ${ctx.performanceWord}.`);
  }
  if (score >= 75) {
    return pick("active_recovery",
      `20 minutes of light movement keeps blood flowing without adding training load — ${ctx.legs} will feel ready and responsive for ${ctx.nextSession}.`);
  }
  return pick("compression_boots",
    `25 minutes in compression boots pumps recovery fluid through ${ctx.legs} — you'll wake up tomorrow with noticeably less soreness and more spring in your step.`);
}

function pickTissueWork(input: UnifiedInput, used: Set<string>): ModalityRecommendation {
  const { soreness, injury, archetype } = input;
  const ctx = sportContext(archetype);

  // Rule: myofascial only when soreness or injury present
  if ((soreness !== "low" || injury.active) && !used.has("myofascial_release")) {
    const area = injury.active && injury.area
      ? ` Give extra time to the ${injury.area} — consistent work here is what prevents this from becoming a longer-term setback.`
      : "";
    return pick("myofascial_release",
      `12 minutes rolling out the tight spots breaks up tissue adhesions — you'll have more range of motion and less pain ${ctx.performanceWord}.${area}`);
  }

  // Sport-specific foam rolling framing
  const rollingReason =
    archetype === "team_sport"   ? "12 minutes of foam rolling restores tissue length in your hips and quads — you'll move faster and change direction more fluidly at your next session." :
    archetype === "endurance"    ? "12 minutes of foam rolling unlocks your calves, hamstrings, and IT band — your stride mechanics improve and injury risk drops with every session you do this." :
    archetype === "strength"     ? "12 minutes of foam rolling restores tissue density and reduces next-day stiffness — your first working sets tomorrow will feel significantly more controlled." :
    "12 minutes of foam rolling restores tissue length and reduces next-day stiffness — your first reps tomorrow will feel significantly smoother and more controlled.";

  return pick("foam_rolling", rollingReason);
}

function pickNervousSystem(input: UnifiedInput, score: number, used: Set<string>): ModalityRecommendation {
  const { physiology: { sleep_hours, hrv_trend }, archetype } = input;

  // Low recovery → prioritise sleep (takes priority over psych signal)
  if (score < 45 || sleep_hours < 6) {
    return pick("sleep_protocol",
      sleep_hours < 6
        ? `You logged ${sleep_hours.toFixed(1)}h last night — 8 hours tonight is worth more to your performance than any protocol or supplement. Set a bedtime now and stay off screens 60 minutes before.`
        : "Your score needs maximum repair time tonight — go to bed two hours earlier and keep your room below 68°F. You'll gain 10+ recovery points by tomorrow morning.");
  }
  // Low psych readiness → nervous system calming before HRV or score threshold
  // Uses an extended exhale (4-4-8) which is clinically more effective for acute stress
  if (input.psych_score != null && input.psych_score <= 2) {
    return pick("breathwork",
      "10 minutes of slow breathing resets your nervous system and lowers cortisol — you'll feel noticeably calmer within minutes and sleep deeper tonight, which shows up directly in tomorrow's score.");
  }
  // HRV declining or nervous system stressed → breathwork
  if (hrv_trend === "down" || score < 65) {
    return pick("breathwork",
      "10 minutes of controlled breathing lowers your heart rate and cortisol right now — you'll fall asleep faster tonight and wake up measurably more recovered tomorrow.");
  }

  // Sport-specific breathwork framing
  const breathworkReason =
    archetype === "team_sport"   ? "10 minutes of box breathing before sleep sharpens mental readiness and lowers resting HR — you'll feel more composed and decisive in your next match." :
    archetype === "endurance"    ? "10 minutes of diaphragmatic breathing improves oxygen efficiency and drops cortisol — your aerobic base recovers faster and you'll pace better in tomorrow's session." :
    archetype === "strength"     ? "10 minutes of breathing work resets your nervous system post-lifting — you'll sleep deeper and wake up with less residual tension in your prime movers." :
    "10 minutes of box breathing before sleep shifts your nervous system into full recovery mode — you'll get more repair done in the same hours of sleep and wake up with a higher score.";

  return pick("breathwork", breathworkReason);
}

// ─── Summary builder ─────────────────────────────────────────────────────────

function buildSummary(input: UnifiedInput, score: number, status: RecoveryStatus): string {
  if (status === "fatigued")
    return `Score of ${score} — your body is in repair mode. Sleep and passive recovery are your highest-leverage moves right now. Adding training load will slow you down, not speed you up.`;
  if (status === "caution")
    return `Score of ${score} — you're carrying fatigue. Keep today's session controlled and your recovery deliberate. Tonight's choices directly determine tomorrow's score.`;
  if (input.today_training.type === "game")
    return `Game day protocol active. The work you do in the next 4 hours determines how fast you bounce back — prioritise circulation and nervous system recovery now.`;
  if (status === "optimal")
    return `Recovery score is strong at ${score} — your body is primed and ready. Today's protocol locks in that edge and sets you up to perform at this level again tomorrow.`;
  return `Score of ${score} — follow the protocol below and you'll be in a stronger position for tomorrow's training. Consistency is what turns a good day into a great week.`;
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

import type { DailyEntry, ScoreBreakdown, BloodworkPanel, TrainingDay, PerformanceProfile } from "./types";
import { GOAL_ARCHETYPE } from "./types";

const OFF_TRAINING: TrainingContext = { type: "off", duration: 0, intensity: "low" };

function trainingDayToContext(day: TrainingDay | undefined): TrainingContext {
  if (!day) return OFF_TRAINING;
  return { type: day.training_type, duration: day.duration, intensity: day.intensity };
}

/**
 * Convert a 1–5 soreness rating from the daily log into a SorenessLevel.
 *   1–2 → low       (none / mild)
 *   3   → moderate  (noticeable)
 *   4–5 → high      (significant / severe)
 */
function ratingToSoreness(rating: number): SorenessLevel {
  if (rating >= 4) return "high";
  if (rating >= 3) return "moderate";
  return "low";
}

export function buildUnifiedInput(
  baseScore:          number,
  breakdown:          ScoreBreakdown,
  entry:              DailyEntry,
  todayPlan?:         TrainingDay | null,
  tomorrowPlan?:      TrainingDay | null,
  bwPanel?:           BloodworkPanel | null,
  bloodworkModifier?: number,
  moodRating?:        number | null,
  performanceProfile?: PerformanceProfile | null,
): UnifiedInput {
  const hrv_trend: HRVTrend =
    breakdown.hrv >= 70 ? "up" :
    breakdown.hrv < 45  ? "down" : "flat";

  // Soreness: prefer direct user input (daily log 1–5 scale) — most accurate signal.
  // Fall back to CK biomarker if available, then default to "low".
  // Do NOT infer from training intensity — the intensity is already captured by the
  // readiness load-modifier (−5/−10/−20). Adding soreness on top would double-count.
  let soreness: SorenessLevel = "low";
  if (entry.soreness != null) {
    soreness = ratingToSoreness(entry.soreness);
  } else {
    const ck = bwPanel?.creatineKinase ?? null;
    soreness =
      ck != null && ck > 300 ? "high" :
      ck != null && ck > 200 ? "moderate" : "low";
  }

  // Energy level → psych_score bridge: if mood isn't logged but energy is, use that
  const effectivePsych =
    moodRating != null ? moodRating :
    entry.energyLevel  != null ? entry.energyLevel : null;

  // Resolve archetype from performance profile
  const archetype = performanceProfile?.primaryGoal
    ? GOAL_ARCHETYPE[performanceProfile.primaryGoal]
    : null;

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
    psych_score: effectivePsych,
    archetype,
  };
}
