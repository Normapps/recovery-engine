/**
 * POST /api/analyze-athlete
 *
 * Architecture for consistency:
 *   Score, breakdown, readiness_level, and the limiting dimension are all
 *   computed DETERMINISTICALLY server-side before Claude is called.
 *   Claude only writes the narrative: insight, recommendations, limiting_factor text.
 *   After the Claude response, all numeric fields are overwritten with our
 *   computed values — LLM drift on numbers is structurally impossible.
 *
 * Pipeline:
 *   1. Fetch athlete record from Supabase
 *   2. Compute breakdown (sleep/hrv/training/nutrition) with fixed formulas
 *   3. Derive score, readiness_level, and limiting dimension from breakdown
 *   4. Send to Claude with anchors — it writes language only
 *   5. Overwrite Claude's numbers with ours
 *   6. Save to Supabase and return
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getAthlete }               from "@/lib/api/getAthlete";
import { insertRecoveryScore }      from "@/lib/api/recoveryScores";
import { supabaseClient }           from "@/lib/supabaseClient";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScoreBreakdown {
  sleep:         number;  // 0–100
  hrv:           number;  // 0–100
  training_load: number;  // 0–100 (100 = fully rested, 0 = max load)
  nutrition:     number;  // 0–100
}

type ReadinessLevel = "low" | "moderate" | "high";

interface ComputedAnchors {
  score:           number;
  breakdown:       ScoreBreakdown;
  readiness_level: ReadinessLevel;
  limiting_dim:    keyof ScoreBreakdown;  // the dimension with the lowest score
}

interface ClaudeNarrativeResult {
  insight:         string;
  recommendations: string[];
  limiting_factor: string;
}

interface PipelineResult {
  user_id:          string;
  date:             string;
  score:            number;
  insight:          string;
  recommendations:  string[];
  breakdown:        ScoreBreakdown;
  readiness_level:  ReadinessLevel;
  limiting_factor:  string;
  score_record_id:  string;
}

// ─── Raw data extraction ──────────────────────────────────────────────────────

interface RawMetrics {
  sleepHours:    number | null;
  sleepQuality:  number | null;  // 1–5
  hrv:           number | null;  // ms
  rhr:           number | null;  // bpm
  bodyBattery:   number | null;  // 0–100
  calories:      number | null;
  protein:       number | null;  // grams
  hydration:     number | null;  // oz
  soreness:      number | null;  // 1–5
  energyLevel:   number | null;  // 1–5
  strengthMins:  number | null;
  cardioMins:    number | null;
  hasCore:       boolean;
  hasMobility:   boolean;
}

function extractMetrics(dailyEntry: Record<string, unknown> | null): RawMetrics {
  if (!dailyEntry) {
    return {
      sleepHours: null, sleepQuality: null, hrv: null, rhr: null,
      bodyBattery: null, calories: null, protein: null, hydration: null,
      soreness: null, energyLevel: null, strengthMins: null, cardioMins: null,
      hasCore: false, hasMobility: false,
    };
  }

  const sleep    = dailyEntry.sleep     as Record<string, unknown> | null;
  const nutrition= dailyEntry.nutrition as Record<string, unknown> | null;
  const training = dailyEntry.training  as Record<string, unknown> | null;

  return {
    sleepHours:   num(dailyEntry.sleep_hours)   ?? num(sleep?.duration),
    sleepQuality: num(dailyEntry.sleep_quality)  ?? num(sleep?.qualityRating),
    hrv:          num(dailyEntry.hrv)            ?? num(sleep?.hrv),
    rhr:          num(dailyEntry.resting_hr)     ?? num(sleep?.restingHR),
    bodyBattery:  num(dailyEntry.body_battery)   ?? num(sleep?.bodyBattery),
    calories:     num(dailyEntry.calories)       ?? num(nutrition?.calories),
    protein:      num(dailyEntry.protein_g)      ?? num(nutrition?.protein),
    hydration:    num(dailyEntry.hydration_oz)   ?? num(nutrition?.hydration),
    soreness:     num(dailyEntry.soreness),
    energyLevel:  num(dailyEntry.energyLevel)    ?? num(dailyEntry.energy_level),
    strengthMins: training?.strengthTraining ? (num(training.strengthDuration) ?? 0) : null,
    cardioMins:   training?.cardio           ? (num(training.cardioDuration)   ?? 0) : null,
    hasCore:      !!training?.coreWork,
    hasMobility:  !!training?.mobility,
  };
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseFloat(v as string);
  return isFinite(n) ? n : null;
}

// ─── Deterministic scoring ────────────────────────────────────────────────────
// All functions are pure. Same input → same output, every time.

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function piecewise(v: number, pts: ReadonlyArray<readonly [number, number]>): number {
  if (v <= pts[0][0]) return pts[0][1];
  if (v >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    if (v >= x0 && v <= x1) return y0 + ((v - x0) / (x1 - x0)) * (y1 - y0);
  }
  return pts[pts.length - 1][1];
}

/** Sleep duration → 0–100 */
function scoreSleepDuration(hours: number): number {
  return Math.round(piecewise(hours, [
    [0, 0], [5, 5], [6, 45], [7, 70], [9, 100], [10, 85], [12, 60],
  ] as const));
}

/** Sleep quality rating 1–5 → multiplier 0.60–1.00 */
function sleepQualityMultiplier(rating: number): number {
  return clamp(0.60 + (rating - 1) * 0.10, 0.60, 1.00);
}

/** HRV (ms) → 0–100 */
function scoreHRV(ms: number): number {
  return Math.round(piecewise(ms, [
    [0, 0], [20, 20], [30, 32], [45, 50], [60, 65], [80, 82], [100, 100],
  ] as const));
}

/** Resting HR (bpm) → 0–100 (lower is better) */
function scoreRHR(bpm: number): number {
  return Math.round(piecewise(bpm, [
    [35, 100], [50, 100], [55, 90], [60, 78], [65, 65], [70, 52], [80, 38], [100, 20],
  ] as const));
}

/** Protein (grams) → 0–100 */
function scoreProtein(g: number): number {
  return Math.round(piecewise(g, [
    [0, 10], [50, 25], [100, 55], [140, 85], [170, 100], [250, 100],
  ] as const));
}

/** Hydration (oz) → 0–100 */
function scoreHydration(oz: number): number {
  return Math.round(piecewise(oz, [
    [0, 5], [32, 25], [56, 50], [72, 72], [90, 100], [128, 100],
  ] as const));
}

/** Calories → 0–100. Wide optimal band accommodates endurance athletes. */
function scoreCalories(kcal: number): number {
  if (kcal < 1200) return Math.round(clamp((kcal / 1200) * 25, 0, 25));
  if (kcal < 1800) return Math.round(25 + ((kcal - 1200) / 600) * 40);
  if (kcal <= 5500) return 88;  // wide optimal band (covers Ironman, marathon)
  return Math.round(piecewise(kcal, [[5500, 88], [7000, 65], [9000, 40]] as const));
}

/**
 * Average available signals — used when some are missing.
 * Returns null if no values are present.
 */
function avg(values: Array<number | null>): number | null {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

// ─── Breakdown computation ────────────────────────────────────────────────────

function computeBreakdown(m: RawMetrics): ScoreBreakdown {
  // ── Sleep subscore ──────────────────────────────────────────────
  let sleepScore: number;
  if (m.sleepHours != null) {
    const base = scoreSleepDuration(m.sleepHours);
    const mult = m.sleepQuality != null ? sleepQualityMultiplier(m.sleepQuality) : 0.85;
    sleepScore = Math.round(base * mult);
  } else {
    // No sleep data — conservative neutral (missing data should cost something)
    sleepScore = 50;
  }

  // ── HRV subscore ────────────────────────────────────────────────
  const hrvSignals: Array<number | null> = [
    m.hrv        != null ? scoreHRV(m.hrv)       : null,
    m.rhr        != null ? scoreRHR(m.rhr)        : null,
    m.bodyBattery != null ? m.bodyBattery         : null,
  ];
  const hrvScore = Math.round(avg(hrvSignals) ?? 50);

  // ── Training load subscore ──────────────────────────────────────
  // Load units → load score (inverse: more load = lower score)
  const strengthUnits = m.strengthMins != null ? clamp((m.strengthMins / 90) * 50, 0, 50) : 0;
  const cardioUnits   = m.cardioMins   != null ? clamp((m.cardioMins   / 60) * 35, 0, 35) : 0;
  const coreUnits     = m.hasCore      ? 10 : 0;
  const totalUnits    = strengthUnits + cardioUnits + coreUnits;
  // 0 units = 100 (full rest); 100 units = 30 (very high load)
  const trainingScore = Math.round(piecewise(totalUnits, [
    [0, 100], [20, 88], [40, 75], [60, 60], [80, 45], [100, 30],
  ] as const));

  // ── Nutrition subscore ──────────────────────────────────────────
  const nutritionSignals: Array<number | null> = [
    m.protein   != null ? scoreProtein(m.protein)     : null,
    m.hydration != null ? scoreHydration(m.hydration) : null,
    m.calories  != null ? scoreCalories(m.calories)   : null,
  ];
  const nutritionScore = Math.round(avg(nutritionSignals) ?? 50);

  return {
    sleep:         clamp(sleepScore,     0, 100),
    hrv:           clamp(hrvScore,       0, 100),
    training_load: clamp(trainingScore,  0, 100),
    nutrition:     clamp(nutritionScore, 0, 100),
  };
}

// ─── Final score ──────────────────────────────────────────────────────────────

/** Weights must sum to 1.0 */
const WEIGHTS = { sleep: 0.30, hrv: 0.25, training_load: 0.25, nutrition: 0.20 } as const;

function computeScore(bd: ScoreBreakdown, m: RawMetrics): number {
  let score =
    bd.sleep         * WEIGHTS.sleep         +
    bd.hrv           * WEIGHTS.hrv           +
    bd.training_load * WEIGHTS.training_load +
    bd.nutrition     * WEIGHTS.nutrition;

  // Soreness penalty: 1–5 scale. 4=−6, 5=−12.
  if (m.soreness != null && m.soreness >= 4) {
    score -= (m.soreness - 3) * 6;
  }

  // Energy penalty: 1–5 scale. 1=−8, 2=−4.
  if (m.energyLevel != null && m.energyLevel <= 2) {
    score -= (3 - m.energyLevel) * 4;
  }

  return Math.round(clamp(score, 0, 100));
}

function scoreToReadiness(score: number): ReadinessLevel {
  if (score >= 85) return "high";
  if (score >= 70) return "moderate";
  return "low";
}

/** Returns the breakdown dimension with the lowest score. */
function findLimitingDim(bd: ScoreBreakdown): keyof ScoreBreakdown {
  return (Object.keys(bd) as Array<keyof ScoreBreakdown>)
    .reduce((a, b) => bd[a] <= bd[b] ? a : b);
}

/** Human-readable label for the limiting dimension. */
const DIM_LABEL: Record<keyof ScoreBreakdown, string> = {
  sleep:         "sleep",
  hrv:           "HRV / cardiovascular recovery",
  training_load: "training load",
  nutrition:     "nutrition",
};

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(anchors: ComputedAnchors): string {
  const dimLabel = DIM_LABEL[anchors.limiting_dim];

  return `You are an elite sports performance coach and recovery specialist.

The recovery score, breakdown, and readiness level for this athlete have already been computed
by a deterministic scoring engine. Your job is to write the narrative that explains them.

COMPUTED VALUES (do not change these — they appear verbatim in your JSON output):
  Score:           ${anchors.score}
  Readiness:       ${anchors.readiness_level}
  Breakdown:
    sleep          ${anchors.breakdown.sleep}
    hrv            ${anchors.breakdown.hrv}
    training_load  ${anchors.breakdown.training_load}
    nutrition      ${anchors.breakdown.nutrition}
  Limiting factor: ${dimLabel} (scored ${anchors.breakdown[anchors.limiting_dim]} — the lowest dimension)

YOUR TASK
Write three things:

1. insight (1–2 sentences)
   - Name the highest-scoring dimension as the driver
   - Name ${dimLabel} (scored ${anchors.breakdown[anchors.limiting_dim]}) as the limiting factor
   - Be specific and direct. No filler phrases like "based on your data" or "it seems".

2. recommendations (exactly 3 strings)
   - Recommendation 1: MUST directly address ${dimLabel} (the limiting factor)
   - Recommendations 2 and 3: address the next-lowest dimensions or complementary recovery
   - Format every recommendation as: [body state] — [one action] — [tomorrow's benefit]
   - Under 40 words each. Specific to the athlete's sport and today's data.

3. limiting_factor (one concise sentence)
   - Explain WHY ${dimLabel} (${anchors.breakdown[anchors.limiting_dim]}/100) is limiting recovery today
   - Reference the actual data point (e.g. "6.1 hours of sleep", "HRV of 38ms")

OUTPUT FORMAT
Return ONLY valid JSON. No markdown, no text outside the object:
{
  "score": ${anchors.score},
  "insight": "<your insight text>",
  "recommendations": ["<rec 1 targets ${dimLabel}>", "<rec 2>", "<rec 3>"],
  "breakdown": {
    "sleep":         ${anchors.breakdown.sleep},
    "hrv":           ${anchors.breakdown.hrv},
    "training_load": ${anchors.breakdown.training_load},
    "nutrition":     ${anchors.breakdown.nutrition}
  },
  "readiness_level": "${anchors.readiness_level}",
  "limiting_factor": "<your limiting_factor sentence>"
}`;
}

// ─── Profile block ────────────────────────────────────────────────────────────

function buildProfileBlock(athleteData: Record<string, unknown>, date: string): string {
  const profile       = (athleteData.performance_profile ?? {}) as Record<string, unknown>;
  const sport         = (profile.primaryGoal    as string) ?? "General Fitness";
  const position      = (profile.position       as string) ?? null;
  const priority      = (profile.priority       as string) ?? "Performance";
  const focus         = (profile.trainingFocus  as string) ?? "Hybrid";
  const weeklyHours   = profile.weeklyHours     as number | null;
  const bodyWeightLbs = profile.bodyWeightLbs   as number | null;
  const eventDate     = profile.eventDate       as string | null;

  let eventLine = "";
  if (eventDate) {
    const days = Math.ceil(
      (new Date(eventDate + "T12:00:00").getTime() - new Date(date + "T12:00:00").getTime()) / 86400000
    );
    eventLine =
      days <= 0  ? `Event: ${eventDate} (past)` :
      days <= 7  ? `RACE WEEK — ${days} days to event` :
      days <= 21 ? `TAPER — ${days} days to event` :
                   `Next event: ${days} days out (${eventDate})`;
  }

  return [
    "ATHLETE PROFILE",
    `  Sport:    ${sport}${position ? ` · ${position}` : ""}`,
    `  Priority: ${priority} · ${focus}`,
    weeklyHours    ? `  Volume:   ${weeklyHours} hrs/week` : "",
    bodyWeightLbs  ? `  Weight:   ${bodyWeightLbs} lbs`   : "",
    eventLine      ? `  ${eventLine}`                      : "",
  ].filter(Boolean).join("\n");
}

// ─── Metrics block ────────────────────────────────────────────────────────────

function buildMetricsBlock(m: RawMetrics, bd: ScoreBreakdown): string {
  const SORENESS = ["", "None", "Mild", "Moderate", "Significant", "Severe"];
  const ENERGY   = ["", "Depleted", "Low", "Moderate", "Good", "Excellent"];

  return [
    "DAILY METRICS",
    `  Sleep:         ${m.sleepHours    != null ? `${m.sleepHours}h`       : "not logged"} · quality ${m.sleepQuality ?? "?"}/5 → score ${bd.sleep}`,
    `  HRV:           ${m.hrv          != null ? `${m.hrv}ms`             : "not logged"} · RHR ${m.rhr ?? "?"}bpm · battery ${m.bodyBattery ?? "?"} → score ${bd.hrv}`,
    `  Soreness:      ${m.soreness     != null ? `${SORENESS[m.soreness]} (${m.soreness}/5)` : "not logged"}`,
    `  Energy:        ${m.energyLevel  != null ? `${ENERGY[m.energyLevel]} (${m.energyLevel}/5)` : "not logged"}`,
    `  Nutrition:     cal ${m.calories ?? "?"}kcal · protein ${m.protein ?? "?"}g · hydration ${m.hydration ?? "?"}oz → score ${bd.nutrition}`,
    `  Training load: strength ${m.strengthMins ?? 0}min · cardio ${m.cardioMins ?? 0}min → score ${bd.training_load}`,
  ].join("\n");
}

// ─── Claude call ──────────────────────────────────────────────────────────────

async function callClaudeNarrative(
  athleteData: Record<string, unknown>,
  m:           RawMetrics,
  bd:          ScoreBreakdown,
  anchors:     ComputedAnchors,
  date:        string,
): Promise<ClaudeNarrativeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY ?? "";
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");

  const profile    = buildProfileBlock(athleteData, date);
  const metricsBlk = buildMetricsBlock(m, bd);
  const userPrompt = `${profile}\n\n${metricsBlk}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-opus-4-6",
      max_tokens: 1000,
      system:     buildSystemPrompt(anchors),
      messages:   [{ role: "user", content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }

  const raw  = await response.json();
  const text = (raw?.content?.[0]?.text ?? "") as string;
  const cleaned = text.replace(/```(?:json)?\r?\n?/g, "").replace(/\r?\n?```/g, "").trim();
  const parsed  = JSON.parse(cleaned);

  if (!parsed.insight        || typeof parsed.insight !== "string") throw new Error("Claude: missing insight");
  if (!Array.isArray(parsed.recommendations) || parsed.recommendations.length < 3) throw new Error("Claude: missing recommendations");
  if (!parsed.limiting_factor || typeof parsed.limiting_factor !== "string") throw new Error("Claude: missing limiting_factor");

  return {
    insight:         parsed.insight        as string,
    recommendations: parsed.recommendations as string[],
    limiting_factor: parsed.limiting_factor as string,
  };
}

// ─── Fetch today's entry ──────────────────────────────────────────────────────

async function fetchTodayEntry(userId: string, date: string): Promise<Record<string, unknown> | null> {
  if (!supabaseClient) return null;
  const { data } = await supabaseClient
    .from("daily_entries").select("*")
    .eq("user_id", userId).eq("date", date).maybeSingle();
  return data ?? null;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body   = await req.json();
    const userId = (body.user_id ?? "") as string;
    const date   = (body.date ?? new Date().toISOString().slice(0, 10)) as string;

    if (!userId)
      return NextResponse.json({ error: "user_id is required." }, { status: 400 });

    // ── Step 1: Fetch athlete ────────────────────────────────────────────────
    const athleteResult = await getAthlete(userId);
    if (!athleteResult.success)
      return NextResponse.json({ error: athleteResult.error.message }, { status: 404 });

    // ── Step 2: Fetch today's entry ──────────────────────────────────────────
    const dailyEntry = await fetchTodayEntry(userId, date);

    // ── Step 3: Compute anchors deterministically ────────────────────────────
    const m       = extractMetrics(dailyEntry);
    const bd      = computeBreakdown(m);
    const score   = computeScore(bd, m);
    const anchors: ComputedAnchors = {
      score,
      breakdown:       bd,
      readiness_level: scoreToReadiness(score),
      limiting_dim:    findLimitingDim(bd),
    };

    // ── Step 4: Ask Claude for narrative only ────────────────────────────────
    const narrative = await callClaudeNarrative(
      athleteResult.data as unknown as Record<string, unknown>,
      m, bd, anchors, date,
    );

    // ── Step 5: Assemble final result — numbers are ours, language is Claude's ─
    const final = {
      score:           anchors.score,           // deterministic
      insight:         narrative.insight,
      recommendations: narrative.recommendations,
      breakdown:       anchors.breakdown,       // deterministic
      readiness_level: anchors.readiness_level, // derived from score
      limiting_factor: narrative.limiting_factor,
    };

    // ── Step 6: Save to Supabase ─────────────────────────────────────────────
    const saveResult = await insertRecoveryScore({
      user_id:         userId,
      date,
      score:           final.score,
      recommendations: final.recommendations as unknown as Parameters<typeof insertRecoveryScore>[0]["recommendations"],
      confidence:      dailyEntry ? "High" : "Low",
    });

    if (!saveResult.success)
      return NextResponse.json({ error: saveResult.error.message }, { status: 500 });

    // ── Step 7: Return ───────────────────────────────────────────────────────
    const result: PipelineResult = {
      user_id:          userId,
      date,
      ...final,
      score_record_id:  saveResult.data.id,
    };

    return NextResponse.json({ success: true, data: result });

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error.";
    console.error("[analyze-athlete]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
