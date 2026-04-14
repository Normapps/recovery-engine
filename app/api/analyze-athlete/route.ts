/**
 * POST /api/analyze-athlete
 *
 * Backend-only pipeline:
 *   1. Fetch athlete record from Supabase
 *   2. Build sport-aware system prompt + structured user prompt
 *   3. Send to Claude (model: claude-opus-4-6)
 *   4. Parse recovery score (0–100) + 3 recommendations from response
 *   5. Save result to Supabase recovery_scores table
 *   6. Return final result to caller
 *
 * NEVER called from the browser directly — API key stays server-side.
 * Use from server components, other API routes, or cron jobs.
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getAthlete }               from "@/lib/api/getAthlete";
import { insertRecoveryScore }      from "@/lib/api/recoveryScores";
import { supabaseClient }           from "@/lib/supabaseClient";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Recommendation {
  id:       string;
  name:     string;
  duration: number;
  reason:   string;
}

interface ClaudeAnalysisResult {
  score:           number;
  insight:         string;
  recommendations: Recommendation[];
}

interface PipelineResult {
  user_id:         string;
  date:            string;
  score:           number;
  insight:         string;
  recommendations: Recommendation[];
  score_record_id: string;
}

// ─── Athlete context builder ──────────────────────────────────────────────────

/**
 * Assembles the structured user-turn prompt from all available athlete data.
 * Everything the model needs to personalise output lives here.
 */
function buildAthletePrompt(
  athleteData: Record<string, unknown>,
  dailyEntry:  Record<string, unknown> | null,
  date:        string,
): string {
  const profile  = (athleteData.performance_profile ?? {}) as Record<string, unknown>;
  const sport    = (profile.primaryGoal  as string) ?? "General Fitness";
  const position = (profile.position    as string) ?? null;
  const goal     = (profile.priority    as string) ?? "Performance";
  const focus    = (profile.trainingFocus as string) ?? "Hybrid";
  const weeklyHours   = profile.weeklyHours    as number | null;
  const bodyWeightLbs = profile.bodyWeightLbs  as number | null;
  const eventDate     = profile.eventDate      as string | null;

  // Days until next race / game
  let eventCountdown = "";
  if (eventDate) {
    const days = Math.ceil((new Date(eventDate + "T12:00:00").getTime() - new Date(date + "T12:00:00").getTime()) / 86400000);
    if (days > 0) {
      eventCountdown =
        days <= 7  ? `RACE WEEK: ${days} days until event — taper and protect readiness at all costs.` :
        days <= 21 ? `TAPER PERIOD: ${days} days until event — reduce volume, sharpen intensity, prioritise sleep.` :
        `Next event: ${days} days out (${eventDate}).`;
    }
  }

  // Format daily entry fields that matter most
  const sleep        = (dailyEntry?.sleep_hours       as number | null) ?? (dailyEntry?.sleep as Record<string, unknown>)?.duration ?? null;
  const hrv          = (dailyEntry?.hrv               as number | null) ?? (dailyEntry?.sleep as Record<string, unknown>)?.hrv ?? null;
  const rhr          = (dailyEntry?.resting_hr        as number | null) ?? (dailyEntry?.sleep as Record<string, unknown>)?.restingHR ?? null;
  const sleepQuality = (dailyEntry?.sleep_quality     as number | null) ?? (dailyEntry?.sleep as Record<string, unknown>)?.qualityRating ?? null;
  const protein      = (dailyEntry?.protein_g         as number | null) ?? (dailyEntry?.nutrition as Record<string, unknown>)?.protein ?? null;
  const calories     = (dailyEntry?.calories          as number | null) ?? (dailyEntry?.nutrition as Record<string, unknown>)?.calories ?? null;
  const hydration    = (dailyEntry?.hydration_oz      as number | null) ?? (dailyEntry?.nutrition as Record<string, unknown>)?.hydration ?? null;
  const soreness     = (dailyEntry?.soreness          as number | null);
  const energyLevel  = (dailyEntry?.energyLevel       as number | null) ?? (dailyEntry?.energy_level as number | null);
  const bodyBattery  = (dailyEntry?.body_battery      as number | null) ?? (dailyEntry?.sleep as Record<string, unknown>)?.bodyBattery ?? null;

  const SORENESS_LABEL: Record<number, string> = { 1:"None (1/5)", 2:"Mild (2/5)", 3:"Moderate (3/5)", 4:"Significant (4/5)", 5:"Severe (5/5)" };
  const ENERGY_LABEL:   Record<number, string> = { 1:"Depleted (1/5)", 2:"Low (2/5)", 3:"Moderate (3/5)", 4:"Good (4/5)", 5:"Excellent (5/5)" };

  const lines: string[] = [
    `ANALYSIS DATE: ${date}`,
    ``,
    `ATHLETE PROFILE`,
    `  Sport:          ${sport}${position ? ` · ${position}` : ""}`,
    `  Training focus: ${focus}`,
    `  Goal priority:  ${goal}`,
    weeklyHours    ? `  Weekly volume:  ${weeklyHours} hrs/week` : "",
    bodyWeightLbs  ? `  Body weight:    ${bodyWeightLbs} lbs` : "",
    eventCountdown ? `  ${eventCountdown}` : "",
    ``,
    `TODAY'S PHYSIOLOGICAL DATA`,
    sleep        != null ? `  Sleep:          ${sleep}h` : "  Sleep:          not logged",
    sleepQuality != null ? `  Sleep quality:  ${sleepQuality}/5` : "",
    hrv          != null ? `  HRV:            ${hrv} ms` : "  HRV:            not logged",
    rhr          != null ? `  Resting HR:     ${rhr} bpm` : "",
    bodyBattery  != null ? `  Body battery:   ${bodyBattery}/100` : "",
    ``,
    `SUBJECTIVE FEEL`,
    soreness    != null ? `  Muscle soreness: ${SORENESS_LABEL[soreness]}` : "  Muscle soreness: not logged",
    energyLevel != null ? `  Energy level:    ${ENERGY_LABEL[energyLevel]}` : "  Energy level:    not logged",
    ``,
    `NUTRITION`,
    calories   != null ? `  Calories:   ${calories} kcal` : "  Calories:   not logged",
    protein    != null ? `  Protein:    ${protein}g` : "  Protein:    not logged",
    hydration  != null ? `  Hydration:  ${hydration} oz` : "  Hydration:  not logged",
  ].filter(l => l !== "");

  // Add training data if present
  const training = dailyEntry?.training as Record<string, unknown> | null;
  if (training) {
    lines.push("", "TRAINING LOAD");
    if (training.strengthTraining) lines.push(`  Strength training: ${training.strengthDuration ?? "?"}min`);
    if (training.cardio)           lines.push(`  Cardio:            ${training.cardioDuration ?? "?"}min`);
    if (training.coreWork)         lines.push(`  Core work:         yes`);
    if (training.mobility)         lines.push(`  Mobility:          yes`);
  }

  // Add recovery modalities if present
  const recovery = dailyEntry?.recovery as Record<string, unknown> | null;
  if (recovery) {
    const modalityList = Object.entries(recovery)
      .filter(([, v]) => v === true)
      .map(([k]) => k.replace(/([A-Z])/g, " $1").toLowerCase().trim())
      .join(", ");
    if (modalityList) lines.push("", `RECOVERY COMPLETED: ${modalityList}`);
  }

  return lines.join("\n");
}

// ─── System prompt builder ────────────────────────────────────────────────────

/**
 * Builds the Claude system prompt.
 * Embeds all static reasoning rules here so the user turn stays factual.
 */
function buildSystemPrompt(): string {
  return `You are an elite sports recovery scientist and performance coach.

YOUR ROLE
You analyze athlete physiology + training data to produce a daily recovery score and three actionable recovery protocols. Your output directly determines what an athlete does for recovery today.

SCORING FRAMEWORK
Score reflects five weighted dimensions:
  Sleep & HRV          40%  (sleep hours, quality, HRV, resting HR, body battery)
  Training load        20%  (session type, duration, intensity, cumulative fatigue)
  Nutrition            20%  (calorie adequacy, protein, hydration)
  Subjective feel      15%  (muscle soreness rating, energy level)
  Recovery modalities   5%  (modalities completed today)

PERSONALIZATION RULES — YOU MUST APPLY ALL OF THESE
1. SPORT defines movement demands:
   - Team sports (soccer, basketball, etc.): lower-body bias, game-day protection, CNS fatigue
   - Endurance (marathon, triathlon, ironman): aerobic base, eccentric leg damage, glycogen depletion
   - Strength (powerlifting, weightlifting): mechanical muscle damage, CNS load, joint stress
   - Hybrid (CrossFit, MMA, rugby): total-body fatigue, metabolic + structural stress combined

2. GOAL PRIORITY defines today's decision bias:
   - Performance → aggressive recovery to maximise training adaptation
   - Recovery → conservative; protect the body over performance gains
   - Longevity → sustainable habits; avoid overreach

3. TRAINING LOAD defines fatigue context:
   - High load + low score = mandatory passive recovery (compression, ice bath, sleep)
   - High load + high score = active recovery appropriate
   - Low load (rest/off day) + low score = sleep and nutrition are the levers

4. SUBJECTIVE FEEL overrides objective signals when soreness ≥ 4/5 or energy ≤ 2/5:
   - Soreness ≥ 4: always include a cold/compression circulation protocol
   - Energy ≤ 2: nervous system is taxed — breathwork + sleep protocol is mandatory

5. INJURY STATUS: if injury data present, include a targeted tissue work recommendation.

6. EVENT COUNTDOWN:
   - Race week (≤7 days): prioritise readiness, zero new stress, maximum sleep
   - Taper period (8–21 days): reduce volume, sharpen intensity, prioritise sleep quality

RECOMMENDATION FORMAT — MARKETABILITY ENGINE
Every reason MUST follow: [Body state right now] → [ONE action] → [Tomorrow's benefit]
Example: "Your CNS is taxed from today's game load — 25 minutes in compression boots right now
pumps recovery fluid through your legs — you'll start tomorrow's training significantly fresher."

Always return exactly 3 recommendations covering:
  1. CIRCULATION  — blood flow, inflammation, fluid dynamics (compression, ice bath, active recovery, contrast)
  2. TISSUE WORK  — mechanical repair (foam rolling, myofascial release)
  3. NERVOUS SYSTEM — CNS and parasympathetic recovery (breathwork, sleep protocol)

OUTPUT FORMAT
Return ONLY valid JSON — no markdown fences, no prose outside the JSON object:
{
  "score": <integer 0–100>,
  "insight": "<2–3 sentence plain-English explanation that names the top scoring driver AND top limiting factor>",
  "recommendations": [
    { "id": "circulation",    "name": "<modality name>", "duration": <minutes>, "reason": "<Marketability Engine reason>" },
    { "id": "tissue_work",   "name": "<modality name>", "duration": <minutes>, "reason": "<Marketability Engine reason>" },
    { "id": "nervous_system","name": "<modality name>", "duration": <minutes>, "reason": "<Marketability Engine reason>" }
  ]
}`;
}

// ─── Claude API call ──────────────────────────────────────────────────────────

async function callClaudeAnalysis(
  athleteData: Record<string, unknown>,
  dailyEntry:  Record<string, unknown> | null,
  date:        string,
): Promise<ClaudeAnalysisResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY ?? "";

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set.");
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt   = buildAthletePrompt(athleteData, dailyEntry, date);

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
      system:     systemPrompt,
      messages:   [{ role: "user", content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }

  const raw   = await response.json();
  const text  = (raw?.content?.[0]?.text ?? "") as string;

  // Strip markdown fences if present
  const cleaned = text.replace(/```(?:json)?\r?\n?/g, "").replace(/\r?\n?```/g, "").trim();
  const parsed  = JSON.parse(cleaned) as ClaudeAnalysisResult;

  // Validate required fields
  if (typeof parsed.score !== "number" || parsed.score < 0 || parsed.score > 100) {
    throw new Error("Claude returned an invalid score.");
  }
  if (!Array.isArray(parsed.recommendations) || parsed.recommendations.length < 3) {
    throw new Error("Claude returned fewer than 3 recommendations.");
  }

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
    const body    = await req.json();
    const userId: string = body.user_id ?? "";
    const date:   string = body.date    ?? new Date().toISOString().slice(0, 10);

    if (!userId) {
      return NextResponse.json({ error: "user_id is required." }, { status: 400 });
    }

    // ── Step 1: Fetch athlete ────────────────────────────────────────────────
    const athleteResult = await getAthlete(userId);
    if (!athleteResult.success) {
      return NextResponse.json({ error: athleteResult.error.message }, { status: 404 });
    }

    // ── Step 2: Fetch today's daily entry ────────────────────────────────────
    const dailyEntry = await fetchTodayEntry(userId, date);

    // ── Step 3: Send to Claude ───────────────────────────────────────────────
    const analysis = await callClaudeAnalysis(
      athleteResult.data as unknown as Record<string, unknown>,
      dailyEntry,
      date,
    );

    // ── Step 4: Save to Supabase ─────────────────────────────────────────────
    const saveResult = await insertRecoveryScore({
      user_id:         userId,
      date,
      score:           analysis.score,
      recommendations: analysis.recommendations,
      confidence:      dailyEntry ? "High" : "Low",
    });

    if (!saveResult.success) {
      return NextResponse.json({ error: saveResult.error.message }, { status: 500 });
    }

    // ── Step 5: Return result ────────────────────────────────────────────────
    const result: PipelineResult = {
      user_id:         userId,
      date,
      score:           analysis.score,
      insight:         analysis.insight,
      recommendations: analysis.recommendations,
      score_record_id: saveResult.data.id,
    };

    return NextResponse.json({ success: true, data: result });

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error.";
    console.error("[analyze-athlete]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
