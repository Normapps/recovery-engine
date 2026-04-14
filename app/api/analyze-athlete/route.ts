/**
 * POST /api/analyze-athlete
 *
 * Backend-only pipeline:
 *   1. Fetch athlete record from Supabase
 *   2. Send data to Claude API
 *   3. Parse recovery score (0–100) + recommendations from response
 *   4. Save result back to Supabase recovery_scores table
 *   5. Return final result to caller
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
  recommendations: Recommendation[];
  summary:         string;
}

interface PipelineResult {
  user_id:         string;
  date:            string;
  score:           number;
  recommendations: Recommendation[];
  summary:         string;
  score_record_id: string;
}

// ─── Claude API call ──────────────────────────────────────────────────────────

async function callClaudeAnalysis(
  athleteData: Record<string, unknown>,
  dailyEntry:  Record<string, unknown> | null,
): Promise<ClaudeAnalysisResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY ?? "";

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set.");
  }

  const prompt = `You are an elite sports recovery scientist. Analyze this athlete's data and return a JSON object.

ATHLETE PROFILE:
${JSON.stringify(athleteData, null, 2)}

TODAY'S ENTRY:
${dailyEntry ? JSON.stringify(dailyEntry, null, 2) : "No daily entry logged yet."}

Return ONLY valid JSON in this exact structure — no markdown, no prose:
{
  "score": <integer 0–100>,
  "summary": "<1–2 sentence plain-English explanation of the score>",
  "recommendations": [
    { "id": "<slug>", "name": "<modality name>", "duration": <minutes>, "reason": "<benefit-outcome reason>" },
    { "id": "<slug>", "name": "<modality name>", "duration": <minutes>, "reason": "<benefit-outcome reason>" },
    { "id": "<slug>", "name": "<modality name>", "duration": <minutes>, "reason": "<benefit-outcome reason>" }
  ]
}

Rules:
- score reflects sleep, HRV, training load, nutrition, and psychology data
- always return exactly 3 recommendations (circulation · tissue · nervous system)
- reason must answer: what does this do for the athlete tomorrow?`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-opus-4-5",
      max_tokens: 1024,
      messages:   [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }

  const raw      = await response.json();
  const text     = raw?.content?.[0]?.text ?? "";

  // Strip markdown fences if present
  const cleaned  = text.replace(/```(?:json)?\r?\n?/g, "").replace(/\r?\n?```/g, "").trim();
  const parsed   = JSON.parse(cleaned) as ClaudeAnalysisResult;

  // Validate
  if (typeof parsed.score !== "number" || parsed.score < 0 || parsed.score > 100) {
    throw new Error("Claude returned an invalid score.");
  }
  if (!Array.isArray(parsed.recommendations) || parsed.recommendations.length === 0) {
    throw new Error("Claude returned no recommendations.");
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
      recommendations: analysis.recommendations,
      summary:         analysis.summary,
      score_record_id: saveResult.data.id,
    };

    return NextResponse.json({ success: true, data: result });

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error.";
    console.error("[analyze-athlete]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
