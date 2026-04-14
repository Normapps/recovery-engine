/**
 * Data Normalization Layer
 *
 * Converts raw athlete inputs into normalized 0–100 scores.
 * All functions are pure with no side-effects.
 *
 * Usage: import specific normalizers into scoring engines.
 * Do NOT import UI components or store state here.
 */

// ─── Math primitives ──────────────────────────────────────────────────────────

/** Clamp value to [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Map value from one linear range to another and clamp.
 * e.g. lerp(6.5, 6, 7, 45, 70) → maps 6.5h sleep into the 45–70 score band.
 */
export function lerp(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  if (inMax === inMin) return outMin;
  const t = (value - inMin) / (inMax - inMin);
  return clamp(outMin + t * (outMax - outMin), Math.min(outMin, outMax), Math.max(outMin, outMax));
}

/**
 * Piecewise-linear normalization.
 * breakpoints: ordered array of [rawValue, normalizedScore] pairs.
 * Values outside the range are clamped to the first/last score.
 */
export function piecewise(
  value: number,
  breakpoints: ReadonlyArray<readonly [number, number]>,
): number {
  if (breakpoints.length === 0) return 50;
  if (value <= breakpoints[0][0]) return breakpoints[0][1];
  if (value >= breakpoints[breakpoints.length - 1][0])
    return breakpoints[breakpoints.length - 1][1];

  for (let i = 0; i < breakpoints.length - 1; i++) {
    const [x0, y0] = breakpoints[i];
    const [x1, y1] = breakpoints[i + 1];
    if (value >= x0 && value <= x1) {
      return lerp(value, x0, x1, y0, y1);
    }
  }
  return breakpoints[breakpoints.length - 1][1];
}

/** Round to nearest integer and clamp to [0, 100]. */
export function finalize(value: number): number {
  return Math.round(clamp(value, 0, 100));
}

// ─── Sleep ────────────────────────────────────────────────────────────────────

/**
 * Normalize sleep duration (hours) → 0–100.
 *
 * Optimal band: 7–9h = 100
 * Slight penalty for oversleeping (>9h), progressive penalty for short sleep.
 */
export function normSleepDuration(hours: number): number {
  return finalize(
    piecewise(hours, [
      [0,   0 ],
      [5,   5 ],   // < 5h: severe deficit
      [6,   45],   // 5–6h: poor
      [7,   70],   // 6–7h: suboptimal
      [7,   100],  // 7–9h: optimal plateau
      [9,   100],
      [10,  85],   // slight oversleep penalty
      [12,  60],   // significant oversleep
    ] as const),
  );
}

/**
 * Normalize sleep quality rating (1–5) → multiplier (0.60–1.00).
 * Applied as a multiplier on the duration score, not a standalone 0–100.
 */
export function normSleepQualityMultiplier(rating: number): number {
  // 1 → 0.60, 5 → 1.00  (linear)
  return clamp(0.60 + (rating - 1) * 0.10, 0.60, 1.00);
}

// ─── Cardiovascular readiness ─────────────────────────────────────────────────

/**
 * Normalize HRV (ms) → 0–100.
 * Higher HRV = better parasympathetic recovery.
 * Athlete reference ranges: <25ms poor, 25–40ms fair, 40–60ms moderate, 60–80ms good, 80+ excellent.
 */
export function normHRV(ms: number): number {
  return finalize(
    piecewise(ms, [
      [0,   0 ],
      [20,  20],
      [25,  25],
      [40,  45],
      [60,  65],
      [80,  85],
      [100, 100],
    ] as const),
  );
}

/**
 * Normalize resting heart rate (bpm) → 0–100.
 * Lower RHR = better cardiovascular fitness (inverse scale).
 * <50 bpm = elite; >80 bpm = poor recovery state.
 */
export function normRestingHR(bpm: number): number {
  return finalize(
    piecewise(bpm, [
      [35,  100],  // elite/overtrained — still excellent
      [50,  100],
      [55,  90 ],
      [60,  78 ],
      [65,  65 ],
      [70,  52 ],
      [80,  38 ],
      [100, 20 ],
      [120, 10 ],
    ] as const),
  );
}

/**
 * Normalize Garmin body battery (0–100) → 0–100.
 * Already on scale; clamp only to guard against out-of-range device readings.
 */
export function normBodyBattery(value: number): number {
  return finalize(value);
}

// ─── Nutrition ────────────────────────────────────────────────────────────────

/**
 * Normalize daily protein intake (grams) → 0–100.
 * Baseline target: ~160g for an 80kg athlete at 1g/lb lean mass.
 */
export function normProtein(grams: number): number {
  return finalize(
    piecewise(grams, [
      [0,   10],
      [50,  25],
      [70,  35],
      [100, 55],
      [130, 75],
      [160, 100],
      [220, 100],  // surplus does not penalize
    ] as const),
  );
}

/**
 * Normalize daily hydration (oz) → 0–100.
 * Optimal: 90–100 oz/day for a 180lb athlete in training.
 */
export function normHydration(oz: number): number {
  return finalize(
    piecewise(oz, [
      [0,  5 ],
      [24, 20],
      [40, 35],
      [56, 55],
      [72, 75],
      [90, 100],
      [128, 100],  // no penalty for extra hydration within reason
    ] as const),
  );
}

/**
 * Normalize daily caloric intake (kcal) → 0–100.
 * Severe undereating and gross overeating both penalize recovery.
 */
export function normCalories(kcal: number): number {
  // Non-monotonic: optimal band 1800–3500, penalties on both sides
  if (kcal < 1200)                         return finalize(lerp(kcal, 0, 1200, 0, 30));
  if (kcal >= 1200 && kcal < 1500)        return finalize(lerp(kcal, 1200, 1500, 30, 50));
  if (kcal >= 1500 && kcal < 1800)        return finalize(lerp(kcal, 1500, 1800, 50, 65));
  if (kcal >= 1800 && kcal <= 3500)       return 85;   // flat optimal band
  if (kcal > 3500  && kcal <= 4500)       return finalize(lerp(kcal, 3500, 4500, 85, 65));
  return finalize(lerp(kcal, 4500, 6000, 65, 40));     // surplus excess
}

// ─── Training load ────────────────────────────────────────────────────────────

/**
 * Normalize strength training volume (minutes) → 0–50 load units.
 * Capped at 90 min (beyond that, diminishing returns → same load ceiling).
 */
export function normStrengthLoad(minutes: number): number {
  return clamp((minutes / 90) * 50, 0, 50);
}

/**
 * Normalize cardio volume (minutes) → 0–35 load units.
 * Capped at 60 min steady-state equivalent.
 */
export function normCardioLoad(minutes: number): number {
  return clamp((minutes / 60) * 35, 0, 35);
}

/**
 * Normalize recovery modality count (0–4) → 0–1 capacity multiplier.
 * 0 modalities = 0.40 base (rest alone), each adds +0.15, max ~0.85.
 */
export function normRecoveryCapacity(modalityCount: number): number {
  return clamp(0.40 + modalityCount * 0.15, 0, 1);
}

/**
 * Normalize modality count → standalone subscore (0–100).
 * Used for the modalities breakdown card.
 */
export function normModalitiesScore(modalityCount: number): number {
  return finalize(
    piecewise(modalityCount, [
      [0, 30],
      [1, 50],
      [2, 65],
      [3, 80],
      [4, 100],
    ] as const),
  );
}

// ─── Composite helpers ────────────────────────────────────────────────────────

/**
 * Weighted average of an array of [score, weight] pairs.
 * Skips entries where score is null/undefined.
 */
export function weightedAverage(
  components: ReadonlyArray<{ score: number; weight: number }>,
): number {
  const valid = components.filter((c) => Number.isFinite(c.score));
  if (valid.length === 0) return 50;
  const totalWeight = valid.reduce((s, c) => s + c.weight, 0);
  const weightedSum  = valid.reduce((s, c) => s + c.score * c.weight, 0);
  return finalize(weightedSum / totalWeight);
}

/**
 * Simple average of a non-empty array of scores.
 * Returns 50 (neutral baseline) if the array is empty.
 */
export function simpleAverage(scores: number[]): number {
  if (scores.length === 0) return 50;
  return finalize(scores.reduce((a, b) => a + b, 0) / scores.length);
}
