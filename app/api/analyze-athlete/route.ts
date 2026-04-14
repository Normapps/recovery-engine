/**
 * POST /api/analyze-athlete
 *
 * Backend-only pipeline:
 *   1. Fetch athlete record from Supabase
 *   2. Build sport-aware system prompt + structured metrics prompt
 *   3. Send to Claude (model: claude-opus-4-6)
 *   4. Parse full analysis result (score, insight, breakdown, recommendations, readiness)
 *   5. Save result to Supabase recovery_scores table
 *   6. Return final result to caller
 *
 * NEVER called from the browser directly — API key stays server-side.
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
  training_load: number;  // 0–100
  nutrition:     number;  // 0–100
}

interface ClaudeAnalysisResult {
  score:            number;
  insight:          string;
  recommendations:  string[];
  breakdown:        ScoreBreakdown;
  readiness_level:  "low" | "moderate" | "high";
  limiting_factor:  string;
}

interface PipelineResult {
  user_id:          string;
  date:             string;
  score:            number;
  insight:          string;
  recommendations:  string[];
  breakdown:        ScoreBreakdown;
  readiness_level:  "low" | "moderate" | "high";
  limiting_factor:  string;
  score_record_id:  string;
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are an elite sports performance coach, data scientist, and recovery specialist.

Your job is to analyze athlete data and produce a Recovery Score (0–100) with clear, actionable recommendations.

ANALYSIS RULES

1. Evaluate all available data:
   - Sleep (hours + quality rating)
   - HRV (value + trend vs baseline)
   - Resting heart rate
   - Training load (today and recent history)
   - Nutrition (calories, protein, hydration)
   - Subjective feel (soreness rating 1–5, energy level 1–5)
   - Body battery (if available)

2. Adjust based on athlete profile:
   - Sport defines movement demands and recovery priorities:
     · Team sports (soccer, basketball, football, volleyball, hockey): lower-body bias, CNS fatigue from agility/acceleration, game-day protection
     · Endurance (marathon, triathlon, ironman, cycling, swimming, rowing, trail running): eccentric leg damage, glycogen depletion, aerobic base sensitivity
     · Strength (powerlifting, strength training): mechanical muscle damage, joint stress, CNS load from heavy compound lifts
     · Hybrid (CrossFit, MMA, rugby, rock climbing): total-body metabolic + structural stress combined
   - Goal priority defines TODAY'S decision bias:
     · Performance → aggressive recovery, maximise training adaptation
     · Recovery → conservative, protect the body over performance gains
     · Longevity → sustainable habits, avoid overreach at all costs
   - High training frequency (>10 hrs/week) → reduce load tolerance threshold
   - Active injury → lower score ceiling, prioritise targeted tissue and rest protocols
   - Race week (≤7 days to event): prioritise readiness, no new stress, maximum sleep
   - Taper period (8–21 days to event): reduce volume, sharpen intensity, protect HRV

3. Identify the single biggest limiting factor:
   - Sleep (duration or quality below threshold)
   - HRV (suppressed or declining trend)
   - Training load (accumulated fatigue, overreaching)
   - Nutrition (underfuelling, protein deficit, dehydration)
   - Subjective feel (high soreness, depleted energy)
   - Injury (acute or chronic)

4. Keep logic realistic:
   - Do NOT give scores above 85 unless sleep ≥7.5h, HRV is solid, load is appropriate, and nutrition is adequate
   - Do NOT give generic advice — tie every recommendation to the athlete's specific data
   - Do NOT overreact to single-data-point fluctuations
   - If data is missing, note it in the insight and score conservatively

SCORING GUIDELINES
  85–100 → high readiness: athlete is primed, training can be pushed
  70–84  → moderate readiness: train with purpose, manage load
  < 70   → low readiness: recovery takes priority over performance

RECOMMENDATION FORMAT — MARKETABILITY ENGINE
Every recommendation MUST follow: [What is happening to your body] → [The one action] → [What happens tomorrow]
Example: "Your legs are inflamed after yesterday's high-load session — spend 25 min in compression boots tonight — you'll wake up noticeably fresher for tomorrow's training."
Keep each recommendation under 40 words. Specific, not generic.

OUTPUT FORMAT
Return ONLY valid JSON. No markdown fences, no text outside the JSON object:
{
  "score": <integer 0–100>,
  "insight": "<1–2 sentence plain-English summary naming the top scoring driver AND top limiting factor>",
  "recommendations": [
    "<Marketability Engine recommendation 1>",
    "<Marketability Engine recommendation 2>",
    "<Marketability Engine recommendation 3>"
  ],
  "breakdown": {
    "sleep":         <0–100>,
    "hrv":           <0–100>,
    "training_load": <0–100>,
    "nutrition":     <0–100>
  },
  "readiness_level": "<low | moderate | high>",
  "limiting_factor": "<single biggest reason score is not higher>"
}`;
}

// ─── Athlete profile section ──────────────────────────────────────────────────

function buildProfileBlock(
  athleteData: Record<string, unknown>,
  date:        string,
): string {
  const profile  = (athleteData.performance_profile ?? {}) as Record<string, unknown>;
  const sport    = (profile.primaryGoal    as string) ?? "General Fitness";
  const position = (profile.position       as string) ?? null;
  const priority = (profile.priority       as string) ?? "Performance";
  const focus    = (profile.trainingFocus  as string) ?? "Hybrid";
  const weeklyHours   = profile.weeklyHours    as number | null;
  const bodyWeightLbs = profile.bodyWeightLbs  as number | null;
  const eventDate     = profile.eventDate      as string | null;

  // Event countdown
  let eventLine = "";
  if (eventDate) {
    const days = Math.ceil(
      (new Date(eventDate + "T12:00:00").getTime() - new Date(date + "T12:00:00").getTime()) / 86400000
    );
    eventLine =
      days <= 0  ? `Event date: ${eventDate} (past)` :
      days <= 7  ? `RACE WEEK — ${days} days to event (${eventDate})` :
      days <= 21 ? `TAPER PERIOD — ${days} days to event (${eventDate})` :
                   `Next event: ${eventDate} (${days} days out)`;
  }

  const lines = [
    `Sport:          ${sport}${position ? ` · ${position}` : ""}`,
    `Training focus: ${focus}`,
    `Goal priority:  ${priority}`,
    weeklyHours    ? `Weekly volume:  ${weeklyHours} hrs/week` : null,
    bodyWeightLbs  ? `Body weight:    ${bodyWeightLbs} lbs`    : null,
    eventLine      ? eventLine                                  : null,
  ].filter(Boolean).join("\n  ");

  return `ATHLETE PROFILE\n  ${lines}`;
}

// ─── Daily metrics section ────────────────────────────────────────────────────

function buildMetricsBlock(
  dailyEntry: Record<string, unknown> | null,
): string {
  if (!dailyEntry) {
    return "DAILY METRICS\n  No entry logged today — score conservatively.";
  }

  // Unwrap nested or flat shapes from Supabase
  const sleep    = dailyEntry.sleep    as Record<string, unknown> | null;
  const nutrition= dailyEntry.nutrition as Record<string, unknown> | null;
  const training = dailyEntry.training as Record<string, unknown> | null;
  const recovery = dailyEntry.recovery as Record<string, unknown> | null;

  const sleepHours   = (dailyEntry.sleep_hours    as number | null) ?? (sleep?.duration      as number | null);
  const sleepQuality = (dailyEntry.sleep_quality   as number | null) ?? (sleep?.qualityRating as number | null);
  const hrv          = (dailyEntry.hrv             as number | null) ?? (sleep?.hrv           as number | null);
  const rhr          = (dailyEntry.resting_hr      as number | null) ?? (sleep?.restingHR     as number | null);
  const bodyBattery  = (dailyEntry.body_battery    as number | null) ?? (sleep?.bodyBattery   as number | null);
  const calories     = (dailyEntry.calories        as number | null) ?? (nutrition?.calories  as number | null);
  const protein      = (dailyEntry.protein_g       as number | null) ?? (nutrition?.protein   as number | null);
  const hydration    = (dailyEntry.hydration_oz    as number | null) ?? (nutrition?.hydration as number | null);
  const soreness     = dailyEntry.soreness         as number | null;
  const energyLevel  = (dailyEntry.energyLevel     as number | null) ?? (dailyEntry.energy_level as number | null);

  const SORENESS_LABEL: Record<number, string> = { 1:"None",2:"Mild",3:"Moderate",4:"Significant",5:"Severe" };
  const ENERGY_LABEL:   Record<number, string> = { 1:"Depleted",2:"Low",3:"Moderate",4:"Good",5:"Excellent" };

  const sleepLines: string[] = [];
  if (sleepHours   != null) sleepLines.push(`Duration: ${sleepHours}h`);
  if (sleepQuality != null) sleepLines.push(`Quality: ${sleepQuality}/5`);
  if (hrv          != null) sleepLines.push(`HRV: ${hrv} ms`);
  if (rhr          != null) sleepLines.push(`Resting HR: ${rhr} bpm`);
  if (bodyBattery  != null) sleepLines.push(`Body battery: ${bodyBattery}/100`);

  const feelLines: string[] = [];
  if (soreness    != null) feelLines.push(`Muscle soreness: ${SORENESS_LABEL[soreness]} (${soreness}/5)`);
  if (energyLevel != null) feelLines.push(`Energy level: ${ENERGY_LABEL[energyLevel]} (${energyLevel}/5)`);

  const nutritionLines: string[] = [];
  if (calories  != null) nutritionLines.push(`Calories: ${calories} kcal`);
  if (protein   != null) nutritionLines.push(`Protein: ${protein}g`);
  if (hydration != null) nutritionLines.push(`Hydration: ${hydration} oz`);

  const trainingLines: string[] = [];
  if (training?.strengthTraining) trainingLines.push(`Strength: ${training.strengthDuration ?? "?"}min`);
  if (training?.cardio)           trainingLines.push(`Cardio: ${training.cardioDuration ?? "?"}min`);
  if (training?.coreWork)         trainingLines.push("Core work");
  if (training?.mobility)         trainingLines.push("Mobility");
  if (trainingLines.length === 0) trainingLines.push("Rest / no training logged");

  const modalityList = recovery
    ? Object.entries(recovery)
        .filter(([, v]) => v === true)
        .map(([k]) => k.replace(/([A-Z])/g, " $1").toLowerCase().trim())
        .join(", ")
    : "";

  const sections: string[] = [
    sleepLines.length     ? `Sleep\n    ${sleepLines.join(" · ")}`                : "Sleep\n    Not logged",
    feelLines.length      ? `Subjective feel\n    ${feelLines.join(" · ")}`       : "Subjective feel\n    Not logged",
    nutritionLines.length ? `Nutrition\n    ${nutritionLines.join(" · ")}`        : "Nutrition\n    Not logged",
    `Training\n    ${trainingLines.join(", ")}`,
    modalityList          ? `Recovery completed\n    ${modalityList}`             : "Recovery modalities\n    None logged",
  ];

  return `DAILY METRICS\n  ${sections.join("\n\n  ")}`;
}

// ─── Claude API call ──────────────────────────────────────────────────────────

async function callClaudeAnalysis(
  athleteData: Record<string, unknown>,
  dailyEntry:  Record<string, unknown> | null,
  date:        string,
): Promise<ClaudeAnalysisResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY ?? "";
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");

  const profile = buildProfileBlock(athleteData, date);
  const metrics = buildMetricsBlock(dailyEntry);

  const userPrompt = `${profile}\n\n${metrics}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-opus-4-6",
      max_tokens: 1200,
      system:     buildSystemPrompt(),
      messages:   [{ role: "user", content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }

  const raw  = await response.json();
  const text = (raw?.content?.[0]?.text ?? "") as string;

  // Strip markdown fences if present
  const cleaned = text.replace(/```(?:json)?\r?\n?/g, "").replace(/\r?\n?```/g, "").trim();
  const parsed  = JSON.parse(cleaned) as ClaudeAnalysisResult;

  // Validate required fields
  if (typeof parsed.score !== "number" || parsed.score < 0 || parsed.score > 100)
    throw new Error("Claude returned an invalid score.");
  if (!Array.isArray(parsed.recommendations) || parsed.recommendations.length < 3)
    throw new Error("Claude returned fewer than 3 recommendations.");
  if (!parsed.breakdown || typeof parsed.breakdown.sleep !== "number")
    throw new Error("Claude returned an invalid breakdown.");
  if (!["low","moderate","high"].includes(parsed.readiness_level))
    throw new Error("Claude returned an invalid readiness_level.");

  return parsed;
}

// ─── Fetch today's daily entry ────────────────────────────────────────────────

async function fetchTodayEntry(
  userId: string,
  date:   string,
): Promise<Record<string, unknown> | null> {
  if (!supabaseClient) return null;
  const { data } = await supabaseClient
    .from("daily_entries")
    .select("*")
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle();
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

    // Step 1: Fetch athlete record
    const athleteResult = await getAthlete(userId);
    if (!athleteResult.success)
      return NextResponse.json({ error: athleteResult.error.message }, { status: 404 });

    // Step 2: Fetch today's entry
    const dailyEntry = await fetchTodayEntry(userId, date);

    // Step 3: Send to Claude
    const analysis = await callClaudeAnalysis(
      athleteResult.data as unknown as Record<string, unknown>,
      dailyEntry,
      date,
    );

    // Step 4: Save to Supabase
    const saveResult = await insertRecoveryScore({
      user_id:         userId,
      date,
      score:           analysis.score,
      recommendations: analysis.recommendations as unknown as Parameters<typeof insertRecoveryScore>[0]["recommendations"],
      confidence:      dailyEntry ? "High" : "Low",
    });

    if (!saveResult.success)
      return NextResponse.json({ error: saveResult.error.message }, { status: 500 });

    // Step 5: Return full result
    const result: PipelineResult = {
      user_id:          userId,
      date,
      score:            analysis.score,
      insight:          analysis.insight,
      recommendations:  analysis.recommendations,
      breakdown:        analysis.breakdown,
      readiness_level:  analysis.readiness_level,
      limiting_factor:  analysis.limiting_factor,
      score_record_id:  saveResult.data.id,
    };

    return NextResponse.json({ success: true, data: result });

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error.";
    console.error("[analyze-athlete]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
