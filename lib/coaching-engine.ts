/**
 * Coaching Engine
 *
 * Generates structured, rule-based daily performance guidance across four
 * categories: training, recovery, nutrition, and rehab.
 *
 * Inputs come from the scoring pipeline output — no external API calls,
 * no UI side-effects.  Returns a plain typed object for any consumer to render.
 *
 * ─── Category drivers ────────────────────────────────────────────────────────
 *
 *   training   ← readiness_zone  (primary driver of today's load prescription)
 *   recovery   ← recovery_score  (physiological state)
 *               + primary_driver (most limiting dimension — used to personalise bullets)
 *   nutrition  ← load_today_score (fuelling demand)
 *               + nutrition_score (current nutrition status)
 *   rehab      ← injury_status.active + injury_status.severity
 *                Only populated when an active injury is present.
 *
 * ─── Output contract ─────────────────────────────────────────────────────────
 *
 *   summary   — 1–2 sentences, coaching tone, no numbers
 *   training  — 2–3 action bullets
 *   recovery  — 2–3 action bullets
 *   nutrition — 2–3 action bullets
 *   rehab     — 2–3 action bullets; EMPTY ARRAY when injury_status.active = false
 *
 * // UI TODO: render each category as a collapsible card or badge list
 * //          on the dashboard once a design for structured coaching output exists.
 */

import type { RecoveryZone } from "./final-scorer";
import type { ReadinessZone } from "./scoring-pipeline";
import type { TrainingType } from "./types";

// ─── Input ────────────────────────────────────────────────────────────────────

export interface CoachingEngineInput {
  recovery_score:   number;          // 0–100
  readiness_score:  number;          // 0–100
  zone:             RecoveryZone;    // recovery zone ("optimal"|"high"|"moderate"|"low"|"critical")
  readiness_zone:   ReadinessZone;   // performance zone ("high"|"ready"|"limited"|"not_ready")
  interpretations:  string[];        // plain-English sentences from InterpretationOutput
  primary_driver:   string;          // biggest limiter noun phrase from InterpretationOutput
  load_today_score: number;          // 0–100 (today's session load, normalised)
  /** Type of today's planned session — drives specific training bullets. */
  training_type?:   TrainingType;
  /** Athlete's current soreness level — selects recovery modalities. */
  soreness?:        "low" | "moderate" | "high";
  injury_status: {
    active:    boolean;
    severity?: number;               // 1–5; only relevant when active = true
  };
  nutrition_score:  number;          // 0–100 (from ScoreBreakdown.nutrition)
}

// ─── Output ───────────────────────────────────────────────────────────────────

export interface CoachingOutput {
  coaching: {
    /** 1–2 sentences. Coaching tone. No numbers. */
    summary:   string;
    /** Training load prescription — 2–3 direct action phrases. */
    training:  string[];
    /** Recovery protocol for today — 2–3 direct action phrases. */
    recovery:  string[];
    /** Nutrition priorities — 2–3 direct action phrases. */
    nutrition: string[];
    /**
     * Injury management actions — 2–3 direct action phrases.
     * Empty array when injury_status.active = false.
     */
    rehab:     string[];
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** True when primary_driver string mentions the given keyword (case-insensitive). */
function driverIncludes(driver: string, keyword: string): boolean {
  return driver.toLowerCase().includes(keyword.toLowerCase());
}

// ─── Category builders ────────────────────────────────────────────────────────

function buildSummary(
  readiness_zone: ReadinessZone,
  zone:           RecoveryZone,
): string {
  if (readiness_zone === "high") {
    return zone === "optimal" || zone === "high"
      ? "Your body is primed and ready — this is a performance window. Execute with full intent today."
      : "Readiness is strong even with moderate recovery. Train with confidence and recover well tonight.";
  }
  if (readiness_zone === "ready") {
    return "You are ready to train at planned intensity. Stay controlled and finish strong.";
  }
  if (readiness_zone === "limited") {
    return "Your capacity is reduced today. Train conservatively, prioritise recovery, and protect tomorrow.";
  }
  // not_ready
  return "Your body needs rest more than stimulus today. Full recovery is the highest-value action right now.";
}

function buildTraining(
  readiness_zone: ReadinessZone,
  training_type?: TrainingType,
): string[] {
  // Session-type prefix gives specific context before the generic prescription.
  // Returns undefined when type is off, unknown, or not provided.
  const sessionLabel = (() => {
    if (!training_type || training_type === "off") return null;
    if (training_type === "cardio")   return "cardio";
    if (training_type === "strength") return "lifting";
    if (training_type === "game")     return "competition";
    if (training_type === "practice") return "practice";
    if (training_type === "recovery") return "recovery session";
    return null;
  })();

  switch (readiness_zone) {
    case "high":
      return [
        sessionLabel
          ? `Execute your ${sessionLabel} at full intensity — the body is primed`
          : "Execute your planned session at full intensity",
        training_type === "strength"
          ? "Push to working-set maxes — neural drive and force output are elevated"
          : training_type === "cardio"
          ? "Target your fastest sustainable pace; speed and power are accessible today"
          : "Prioritise power or speed work — your system can handle the stimulus",
        "Add accessory volume if time allows; recovery reserves are strong",
      ];

    case "ready":
      return [
        sessionLabel
          ? `Complete your ${sessionLabel} at planned load`
          : "Complete your planned session at intended load",
        "Maintain consistent effort — avoid chasing personal records today",
        "Finish all working sets and movements; no extra volume needed",
      ];

    case "limited":
      return [
        sessionLabel === "competition"
          ? "Compete, but manage output — do not push beyond what your body signals"
          : sessionLabel
          ? `Reduce ${sessionLabel} volume by 20–30% and stay conservative`
          : "Reduce session volume by 20–30% from your plan",
        "Keep intensity below 75% of max effort throughout",
        "Stop early if form breaks down or fatigue exceeds expected levels",
      ];

    case "not_ready":
      return [
        "Skip structured training today — the cost exceeds the benefit",
        "Light walking or gentle mobility work only — no loading, no sets",
        "Rest is the highest-value training stimulus your body can receive right now",
      ];
  }
}

function buildRecovery(
  recovery_score: number,
  primary_driver: string,
  soreness:       "low" | "moderate" | "high" = "low",
  load_today_score: number = 0,
): string[] {
  const bullets: string[] = [];

  // ── Modality 1: soreness-driven (tissue work) ─────────────────────────────
  // High soreness → aggressive passive modality; moderate → rolling + cold;
  // low → maintain state.
  if (soreness === "high") {
    bullets.push("Ice bath for 10–12 minutes to reduce systemic inflammation and soreness");
  } else if (soreness === "moderate") {
    bullets.push("Foam roll quads, hamstrings, and calves — hold 15 seconds on each tight spot");
  } else {
    // Low soreness
    if (load_today_score > 60) {
      bullets.push("Compression boots or sleeves for 20 minutes post-training to limit delayed soreness");
    } else {
      bullets.push("Compression or light stretching post-training to maintain your current state");
    }
  }

  // ── Modality 2: load-driven (circulation / recovery depth) ────────────────
  // High load today → active circulatory support; moderate → sleep-first;
  // low → minimum viable intervention.
  if (load_today_score > 70) {
    bullets.push("Elevate legs for 15 minutes post-session to accelerate venous return");
  } else if (load_today_score > 40) {
    bullets.push("Target 8–9 hours of sleep tonight — recovery demand is elevated");
  } else {
    bullets.push("Keep sleep timing consistent — sleep quality drives recovery more than modalities");
  }

  // ── Personalisation bullet: primary driver gap ────────────────────────────
  // Only added when recovery is not already optimal (avoids redundant bullets).
  if (bullets.length < 3 && recovery_score < 80) {
    if (driverIncludes(primary_driver, "hrv") || driverIncludes(primary_driver, "nervous")) {
      bullets.push("Do 10 minutes of box breathing before bed to calm the autonomic nervous system");
    } else if (driverIncludes(primary_driver, "sleep")) {
      bullets.push("Avoid caffeine after 1 pm and dim lights two hours before bed");
    } else if (driverIncludes(primary_driver, "training") || driverIncludes(primary_driver, "load")) {
      bullets.push("Limit cognitive stressors this evening — mental load delays recovery");
    } else if (recovery_score < 50) {
      bullets.push("Full rest tonight — no late-night screens, alcohol, or stimulants");
    }
  }

  return bullets.slice(0, 3);
}

function buildNutrition(
  load_today_score: number,
  nutrition_score:  number,
): string[] {
  const bullets: string[] = [];

  // Load-driven carb and calorie guidance
  if (load_today_score > 70) {
    bullets.push("Add 60–80g of carbohydrates in the 90-minute window before training");
    bullets.push("Consume 40–50g of protein within 30 minutes of finishing your session");
    bullets.push("Hydrate to at least 90–100oz of water today — sweat losses are high");
  } else if (load_today_score > 40) {
    bullets.push("Hit your daily protein target before the end of the day");
    bullets.push("Add carbohydrates around training windows — not all day");
    bullets.push("Stay hydrated — target 70–80oz of water minimum");
  } else {
    // Low or rest-day load
    bullets.push("Keep calories at maintenance — avoid overeating on a low-output day");
    bullets.push("Prioritise protein to preserve muscle and support repair");
    bullets.push("Minimise refined carbs and opt for complex sources like rice or sweet potato");
  }

  // Nutrition-score gap flag (replaces one bullet if score is low)
  if (nutrition_score < 60 && bullets.length === 3) {
    // Swap last bullet for the most actionable fix
    bullets[2] = "Log your meals today — your nutrition data has gaps that are affecting your score";
  }

  return bullets.slice(0, 3);
}

function buildRehab(injury_status: CoachingEngineInput["injury_status"]): string[] {
  if (!injury_status.active) return [];

  const severity = injury_status.severity ?? 1;

  if (severity >= 4) {
    return [
      "Avoid loading the injured area entirely today",
      "Do not perform any movement that reproduces pain above 2/10",
      "Consult your physio or medical staff before returning to full training",
    ];
  }
  if (severity === 3) {
    return [
      "Reduce load through the injured area by at least 50%",
      "Add targeted mobility work around the affected joint to maintain range",
      "Stop immediately if pain exceeds 4/10 during any movement",
    ];
  }
  // Severity 1–2
  return [
    "Keep the injured area warm and mobile — avoid prolonged immobility",
    "Avoid explosive or ballistic movements that stress the affected tissue",
    "Apply ice for 10 minutes post-activity if soreness increases",
  ];
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * generateCoachingReport
 *
 * Produces structured daily coaching guidance from scoring pipeline output.
 *
 * @param input  CoachingEngineInput — sourced directly from ScoringPipelineOutput
 *               fields plus injury_status (not yet wired to a store).
 *
 * @returns      CoachingOutput — plain object; no side-effects.
 *
 * Usage example (future wiring):
 *
 *   const pipelineResult = runScoringPipeline(entry, history, bwPanel, ...);
 *   const { coaching } = generateCoachingReport({
 *     recovery_score:   pipelineResult.recovery_score,
 *     readiness_score:  pipelineResult.readiness_score,
 *     zone:             pipelineResult.zone,
 *     readiness_zone:   pipelineResult.readiness_zone,
 *     interpretations:  pipelineResult.interpretation.interpretations,
 *     primary_driver:   pipelineResult.interpretation.primary_driver,
 *     load_today_score: loadTodayScore,     // from deriveSessionLoadAU → normalised
 *     injury_status:    { active: false },  // from future injury store
 *     nutrition_score:  pipelineResult.breakdown.nutrition,  // ScoreBreakdown.nutrition
 *   });
 *
 * // UI TODO: wire generateCoachingReport() into DashboardContent and pass
 * //          coaching output to a new CoachingCard component for display.
 */
export function generateCoachingReport(input: CoachingEngineInput): CoachingOutput {
  const summary   = buildSummary(input.readiness_zone, input.zone);
  const training  = buildTraining(input.readiness_zone, input.training_type);
  const recovery  = buildRecovery(
    input.recovery_score,
    input.primary_driver,
    input.soreness ?? "low",
    input.load_today_score,
  );
  const nutrition = buildNutrition(input.load_today_score, input.nutrition_score);
  const rehab     = buildRehab(input.injury_status);

  return {
    coaching: {
      summary,
      training,
      recovery,
      nutrition,
      rehab,
    },
  };
}
