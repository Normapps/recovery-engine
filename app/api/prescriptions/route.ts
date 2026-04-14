import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import type { AIPrescriptionInput, AIPrescriptionOutput } from "@/lib/ai-prescriptions";

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildPrompt(input: AIPrescriptionInput): string {
  const tomorrow = input.tomorrowTraining
    ? `${input.tomorrowTraining.type.toUpperCase()} · ${input.tomorrowTraining.intensity} intensity · ${input.tomorrowTraining.duration} min`
    : "REST / OFF DAY";

  const today = input.todayTraining
    ? `${input.todayTraining.type.toUpperCase()} · ${input.todayTraining.intensity} intensity`
    : "Rest day";

  const sleep = [
    input.sleepHours !== null ? `${input.sleepHours}h` : null,
    input.sleepQuality !== null ? `quality ${input.sleepQuality}/5` : null,
  ].filter(Boolean).join(", ") || "not logged";

  const physiology = [
    input.hrv       !== null ? `HRV ${input.hrv}ms`       : null,
    input.restingHR !== null ? `RHR ${input.restingHR}bpm` : null,
  ].filter(Boolean).join(" · ") || "unavailable";

  const psychLine = input.psychScore !== null
    ? `${input.psychScore}/5`
    : "not logged";

  const bloodworkLine = input.bloodworkFlags?.length
    ? input.bloodworkFlags.join(", ")
    : "none flagged";

  const performanceProfile = input.performanceProfile
    ? [
        `Goal: ${input.performanceProfile.primaryGoal}`,
        input.performanceProfile.trainingFocus ? `Focus: ${input.performanceProfile.trainingFocus}` : null,
        input.performanceProfile.priority ? `Priority: ${input.performanceProfile.priority}` : null,
        input.performanceProfile.eventDate ? `Event date: ${input.performanceProfile.eventDate}` : null,
      ].filter(Boolean).join(" · ")
    : "not set";

  return `You are a high-performance sports coach and recovery specialist. Generate a precise, prescriptive protocol for TODAY based on this athlete's data.

TOMORROW'S TRAINING (primary anchor — design everything around this):
${tomorrow}

TODAY'S TRAINING: ${today}
RECOVERY SCORE: ${input.recoveryScore}/100
PSYCHOLOGICAL READINESS: ${psychLine}
SLEEP: ${sleep}
PHYSIOLOGY: ${physiology}
SORENESS: ${input.soreness}
BLOODWORK FLAGS: ${bloodworkLine}
PERFORMANCE PROFILE: ${performanceProfile}

COACHING RULES:
- Write like a coach giving direct, specific instructions — not a doctor
- Anchor everything on preparing the athlete for TOMORROW's training
- Every prescription must include specifics: exact grams, exact durations, exact movements with reps/holds, named body parts
- No vague advice — never say "eat well", "do some stretching", "recover properly"
- Plain language; no medical jargon; athlete-friendly tone
- If tomorrow is lower body → bias mobility and recovery toward hips, glutes, hamstrings, calves, ankles
- If tomorrow is upper body → target shoulders, thoracic spine, lats, pecs
- If tomorrow is game/field → prioritize neural freshness, hydration/electrolytes, tissue readiness
- If tomorrow is rest → reduce fueling, emphasize restoration
- If soreness is high → elevate protein target and prioritize tissue work in recovery and mobility
- Use the athlete's performance profile goal to tailor specificity (e.g. marathon runner vs powerlifter get different carb targets and mobility focus)

Return ONLY valid JSON (no markdown, no code fences) exactly matching this schema:
{
  "nutrition": {
    "summary": "one sentence for the card — max 15 words, verb-first, specific",
    "overview": "2–3 sentences: what to prioritize today and why given tomorrow's training",
    "protein": "total daily grams · timing windows (pre/post/evening) · 3–4 specific food examples with gram amounts",
    "carbs": "total daily grams · when to load (pre-tomorrow, post-today, etc.) · 3–4 specific food examples with gram amounts",
    "hydration": "total oz target · hourly schedule · electrolyte guidance if relevant",
    "micronutrients": "1–2 specific priorities with food sources and brief rationale",
    "coaching_note": "one direct coaching insight athletes can act on immediately"
  },
  "recovery": {
    "summary": "one sentence for the card — max 15 words, verb-first, specific",
    "overview": "2–3 sentences: recovery priority today and how it sets up tomorrow",
    "primary_modality": "modality name · exact duration · target body area · step-by-step protocol (2–3 sentences)",
    "secondary_modality": "modality name · exact duration · target body area · step-by-step protocol (2–3 sentences)",
    "timing": "sequence and timing for both modalities (e.g. ice bath at 6pm then breathwork before bed)",
    "coaching_note": "one direct coaching insight athletes can act on immediately"
  },
  "mobility": {
    "summary": "one sentence for the card — max 15 words, verb-first, specific",
    "overview": "2–3 sentences: which areas to target today and why given tomorrow's training",
    "movement_1": "movement name — sets × reps or hold duration — target area — key execution cue",
    "movement_2": "movement name — sets × reps or hold duration — target area — key execution cue",
    "movement_3": "movement name — sets × reps or hold duration — target area — key execution cue",
    "structure": "total session time · order of movements · when to perform (pre-sleep, post-training, morning, etc.)",
    "coaching_note": "one direct coaching insight athletes can act on immediately"
  }
}`;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!client) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 503 },
    );
  }

  let input: AIPrescriptionInput;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1800,
      messages: [{ role: "user", content: buildPrompt(input) }],
    });

    const block = message.content[0];
    if (block.type !== "text") throw new Error("Unexpected response type");

    // Extract JSON — Claude sometimes wraps output in ```json ... ``` despite the prompt
    const jsonMatch = block.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON object found in response");

    const parsed: AIPrescriptionOutput = JSON.parse(jsonMatch[0]);

    // Minimal shape validation
    if (!parsed.nutrition || !parsed.recovery || !parsed.mobility) {
      throw new Error("Response missing required top-level keys");
    }

    return NextResponse.json(parsed);
  } catch (err) {
    console.error("[prescriptions] generation failed:", err);
    return NextResponse.json(
      { error: "Generation failed", detail: String(err) },
      { status: 500 },
    );
  }
}
