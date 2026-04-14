/**
 * Interpretation Engine
 *
 * Translates raw dimension scores into human-readable, athlete-friendly
 * language with no numbers or percentages in the output.
 *
 * ─── Input contract ───────────────────────────────────────────────────────────
 *
 *  sleep_score       0–100   higher = better sleep quality / duration
 *  hrv_score         0–100   higher = better autonomic readiness
 *  rhr_score         0–100   higher = lower (healthier) resting heart rate
 *  nutrition_score   0–100   higher = better fuelling
 *  psychology_score  0–100   higher = better mood / mental energy
 *  load_today_score  0–100   higher = HEAVIER training load (inverted scale)
 *
 * ─── Output contract ──────────────────────────────────────────────────────────
 *
 *  interpretations   string[]  one plain-English sentence per weak dimension
 *  primary_driver    string    the single biggest negative contributor today
 *
 * ─── Design notes ─────────────────────────────────────────────────────────────
 *
 *  • No numbers or percentages are ever included in output strings.
 *  • Language is conversational and athlete-centric ("the body", "recovery",
 *    "fatigue"), not clinical.
 *  • When no dimension is below acceptable threshold, both fields carry
 *    a positive "all clear" message so the UI always has something to show.
 *  • load_today_score is the only inverted dimension: high value = high stress.
 *    Concern calculation handles this by measuring excess above a floor
 *    instead of deficit below a ceiling.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export interface InterpretationInput {
  /** Sleep quality / duration subscore (0–100, higher = better). */
  sleep_score:      number;
  /** Autonomic / HRV readiness subscore (0–100, higher = better). */
  hrv_score:        number;
  /** Resting-HR subscore (0–100, higher = lower / healthier RHR). */
  rhr_score:        number;
  /** Nutrition and fuelling subscore (0–100, higher = better). */
  nutrition_score:  number;
  /** Mood / mental-energy subscore (0–100, higher = better). */
  psychology_score: number;
  /**
   * Today's training load magnitude (0–100, higher = heavier load).
   * This is the ONLY inverted dimension — it measures stress, not readiness.
   */
  load_today_score: number;
}

export interface InterpretationOutput {
  /**
   * One plain-English sentence per weak dimension, ordered by severity
   * (most concerning first).  Empty array when all dimensions are healthy.
   */
  interpretations: string[];
  /**
   * The single biggest negative contributor today, expressed as a short
   * noun phrase suitable for display as a headline — e.g. "Sleep quality"
   * or "Training load".
   * When no limiter exists: a positive all-clear phrase is returned instead.
   */
  primary_driver: string;
}

// ─── Thresholds ───────────────────────────────────────────────────────────────

/**
 * Standard dimensions (lower score = worse):
 *   CRITICAL     < 40  — significant negative impact
 *   BELOW_OPT   40–64  — below acceptable, warrants attention
 *   ACCEPTABLE  ≥ 65   — no interpretation emitted
 *
 * Load dimension (higher score = worse):
 *   HIGH         > 75  — significant training stress
 *   MODERATE    55–75  — elevated but manageable
 *   ACCEPTABLE  ≤ 55   — no interpretation emitted
 */
const STANDARD_CRITICAL  = 40;
const STANDARD_FLOOR     = 65;   // below this → interpretation emitted
const LOAD_MODERATE_FLOOR = 55;  // above this → interpretation emitted
const LOAD_HIGH_CEILING  = 75;   // above this → high-load interpretation

// ─── Per-dimension rule definitions ──────────────────────────────────────────

interface DimensionRule {
  /** Key into InterpretationInput. */
  key: keyof InterpretationInput;
  /**
   * Short noun phrase used as the primary_driver label.
   * Must read naturally when surfaced as a standalone headline.
   */
  driverLabel: string;
  /**
   * Returns a plain-English interpretation string for the given score,
   * or null when the dimension is within acceptable range.
   */
  interpret: (score: number) => string | null;
  /**
   * Returns a normalised concern level in [0, 1].
   * Higher = more concerning = higher priority for primary_driver selection.
   * Comparisons use this value; it never appears in output strings.
   */
  concern: (score: number) => number;
}

const DIMENSIONS: DimensionRule[] = [
  // ── Sleep ──────────────────────────────────────────────────────────────────
  {
    key:         "sleep_score",
    driverLabel: "Sleep quality",
    interpret(score) {
      if (score < STANDARD_CRITICAL)
        return "Sleep was well below optimal — the body hasn't had enough time to repair";
      if (score < STANDARD_FLOOR)
        return "Sleep was below optimal — some fatigue may be carrying over into the day";
      return null;
    },
    concern: (score) => Math.max(0, STANDARD_FLOOR - score) / STANDARD_FLOOR,
  },

  // ── HRV / autonomic readiness ───────────────────────────────────────────────
  {
    key:         "hrv_score",
    driverLabel: "HRV and nervous system recovery",
    interpret(score) {
      if (score < STANDARD_CRITICAL)
        return "The nervous system is under significant stress — recovery is lagging behind training";
      if (score < STANDARD_FLOOR)
        return "Recovery is trending downward — the body is still working to adapt";
      return null;
    },
    concern: (score) => Math.max(0, STANDARD_FLOOR - score) / STANDARD_FLOOR,
  },

  // ── Resting heart rate ─────────────────────────────────────────────────────
  {
    key:         "rhr_score",
    driverLabel: "Elevated resting heart rate",
    interpret(score) {
      if (score < STANDARD_CRITICAL)
        return "Resting heart rate is markedly elevated — a clear sign of accumulated stress";
      if (score < STANDARD_FLOOR)
        return "Heart rate is above baseline — residual fatigue from recent sessions is present";
      return null;
    },
    concern: (score) => Math.max(0, STANDARD_FLOOR - score) / STANDARD_FLOOR,
  },

  // ── Nutrition ──────────────────────────────────────────────────────────────
  {
    key:         "nutrition_score",
    driverLabel: "Nutrition and fuelling",
    interpret(score) {
      if (score < STANDARD_CRITICAL)
        return "Fuelling has been insufficient — recovery will be limited without adequate nutrition";
      if (score < STANDARD_FLOOR)
        return "Nutrition was below target — prioritising protein and hydration will accelerate recovery";
      return null;
    },
    concern: (score) => Math.max(0, STANDARD_FLOOR - score) / STANDARD_FLOOR,
  },

  // ── Psychology / mood ──────────────────────────────────────────────────────
  {
    key:         "psychology_score",
    driverLabel: "Mental fatigue and mood",
    interpret(score) {
      if (score < STANDARD_CRITICAL)
        return "Mental fatigue or low mood is present — this is a genuine performance signal, not just mindset";
      if (score < STANDARD_FLOOR)
        return "Energy and motivation are lower than usual — worth tracking if this pattern continues";
      return null;
    },
    concern: (score) => Math.max(0, STANDARD_FLOOR - score) / STANDARD_FLOOR,
  },

  // ── Training load today (inverted: higher score = more stress) ─────────────
  {
    key:         "load_today_score",
    driverLabel: "Training load",
    interpret(score) {
      if (score > LOAD_HIGH_CEILING)
        return "Training load is high today — the body will need deliberate recovery to absorb this session";
      if (score > LOAD_MODERATE_FLOOR)
        return "Training load is elevated today — recovery protocols will help manage accumulated fatigue";
      return null;
    },
    // Concern: excess above the moderate floor, normalised to [0, 1]
    concern: (score) => Math.max(0, score - LOAD_MODERATE_FLOOR) / (100 - LOAD_MODERATE_FLOOR),
  },
];

// ─── Engine ───────────────────────────────────────────────────────────────────

/**
 * interpretRecovery
 *
 * Core interpretation function. Maps raw dimension scores to human-readable
 * insights and identifies the single biggest negative contributor.
 *
 * @param input  — dimension scores (see InterpretationInput)
 * @returns       — plain-English interpretations + primary driver label
 */
export function interpretRecovery(input: InterpretationInput): InterpretationOutput {
  // ── Evaluate each dimension ────────────────────────────────────────────────

  interface Evaluated {
    rule:         DimensionRule;
    score:        number;
    interpretation: string | null;
    concern:      number;
  }

  const evaluated: Evaluated[] = DIMENSIONS.map((rule) => {
    const score = input[rule.key];
    return {
      rule,
      score,
      interpretation: rule.interpret(score),
      concern:        rule.concern(score),
    };
  });

  // ── Collect interpretations, most concerning first ─────────────────────────

  const withInterpretation = evaluated
    .filter((e) => e.interpretation !== null)
    .sort((a, b) => b.concern - a.concern);

  const interpretations = withInterpretation.map((e) => e.interpretation as string);

  // ── Identify primary driver ────────────────────────────────────────────────

  // Primary driver = the evaluated dimension with the highest concern level.
  // When multiple dimensions tie, the first one in DIMENSIONS order wins
  // (sleep > hrv > rhr > nutrition > psychology > load — reflects relative
  //  physiological priority for recovery).

  const topConcern = evaluated.reduce<Evaluated | null>((best, current) => {
    if (!best) return current;
    return current.concern > best.concern ? current : best;
  }, null);

  const primary_driver: string =
    topConcern && topConcern.concern > 0
      ? topConcern.rule.driverLabel
      : "Recovery is on track — no significant limiters today";

  // ── All-clear when no dimension is weak ───────────────────────────────────

  if (interpretations.length === 0) {
    interpretations.push(
      "All systems are showing strong recovery indicators — the body is primed to perform",
    );
  }

  return { interpretations, primary_driver };
}

// ─── Convenience adapter ──────────────────────────────────────────────────────

/**
 * interpretFromBreakdown
 *
 * Convenience wrapper that builds an InterpretationInput from the score
 * breakdown fields already present in the app's existing data structures,
 * so callers don't need to rename fields manually.
 *
 * Mapping:
 *   breakdown.sleep      → sleep_score
 *   breakdown.hrv        → hrv_score  (used as both HRV and RHR proxy when
 *                                       rhr is unavailable separately)
 *   breakdown.nutrition  → nutrition_score
 *   moodRating           → psychology_score  (1–5 scale auto-normalised)
 *   sessionLoadAU        → load_today_score  (raw AU → 0–100 via soft cap)
 *
 * @param breakdown      — ScoreBreakdown from the recovery engine
 * @param rhrScore       — explicit RHR subscore (pass breakdown.hrv if absent)
 * @param moodRating     — 1–5 mood rating from moodLog (null = unknown → 75)
 * @param sessionLoadAU  — today's session load in arbitrary units (0 = rest)
 */
export function interpretFromBreakdown(
  breakdown:    { sleep: number; hrv: number; nutrition: number },
  rhrScore:     number,
  moodRating:   number | null,
  sessionLoadAU: number,
): InterpretationOutput {
  // Normalise 1–5 mood rating to 0–100
  const psychology_score =
    moodRating !== null
      ? Math.round(((moodRating - 1) / 4) * 100)
      : 75;  // neutral fallback when no mood logged

  // Soft-cap session load AU to 0–100.
  // Reference: ~300 AU ≈ moderate session, 600+ AU ≈ heavy session.
  // Anything above 600 AU saturates at 100.
  const load_today_score = Math.min(100, Math.round((sessionLoadAU / 600) * 100));

  return interpretRecovery({
    sleep_score:      breakdown.sleep,
    hrv_score:        breakdown.hrv,
    rhr_score:        rhrScore,
    nutrition_score:  breakdown.nutrition,
    psychology_score,
    load_today_score,
  });
}
