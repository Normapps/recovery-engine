import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { TrainingDay, WeekDay, TrainingType, IntensityLevel } from "@/lib/types";

const client = new Anthropic();

const WEEK_DAYS: WeekDay[] = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
];
const TRAINING_TYPES: TrainingType[] = [
  "strength", "practice", "game", "recovery", "cardio", "off",
];
const INTENSITY_LEVELS: IntensityLevel[] = ["low", "moderate", "high"];
const DISTANCE_UNITS = ["mi", "km"] as const;

function clampDuration(d: unknown): number {
  const n = typeof d === "number" ? d : parseInt(String(d ?? 0), 10);
  if (isNaN(n) || n < 0) return 0;
  return Math.min(Math.max(n, 0), 300);
}

function clampDistance(d: unknown): number | undefined {
  if (d === null || d === undefined || d === "") return undefined;
  const n = typeof d === "number" ? d : parseFloat(String(d));
  if (isNaN(n) || n <= 0) return undefined;
  return Math.min(n, 1000);
}

function validateDay(raw: unknown): TrainingDay | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const day           = r.day as string;
  const training_type = r.training_type as string;
  const intensity     = r.intensity as string;

  if (!WEEK_DAYS.includes(day as WeekDay)) return null;
  if (!TRAINING_TYPES.includes(training_type as TrainingType)) return null;
  if (!INTENSITY_LEVELS.includes(intensity as IntensityLevel)) return null;

  const distance     = clampDistance(r.distance);
  const rawUnit      = typeof r.distanceUnit === "string" ? r.distanceUnit.toLowerCase() : null;
  const distanceUnit = rawUnit && (DISTANCE_UNITS as readonly string[]).includes(rawUnit)
    ? (rawUnit as "mi" | "km")
    : (distance !== undefined ? "mi" : undefined);

  const subtypeRaw  = typeof r.subtype === "string" && r.subtype.trim() ? r.subtype.trim() : undefined;

  return {
    day:           day as WeekDay,
    training_type: training_type as TrainingType,
    duration:      clampDuration(r.duration),
    intensity:     intensity as IntensityLevel,
    notes:         typeof r.notes === "string" && r.notes ? r.notes : undefined,
    ...(subtypeRaw   !== undefined ? { subtype: subtypeRaw }       : {}),
    ...(distance     !== undefined ? { distance }                   : {}),
    ...(distanceUnit !== undefined ? { distanceUnit }               : {}),
  };
}

function fillMissingDays(days: TrainingDay[]): TrainingDay[] {
  const daySet = new Set(days.map((d) => d.day));
  const filled = [...days];
  for (const day of WEEK_DAYS) {
    if (!daySet.has(day)) {
      filled.push({ day, training_type: "off", duration: 0, intensity: "low" });
    }
  }
  filled.sort((a, b) => WEEK_DAYS.indexOf(a.day) - WEEK_DAYS.indexOf(b.day));
  return filled;
}

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart form data." }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  const fileName = file.name.toLowerCase();
  const mimeType = file.type;
  let rawText = "";

  // ── Extract text ────────────────────────────────────────────────────────────
  if (
    fileName.endsWith(".csv") ||
    mimeType === "text/csv" ||
    mimeType === "application/csv" ||
    mimeType === "text/plain"
  ) {
    rawText = await file.text();
  } else if (fileName.endsWith(".pdf") || mimeType === "application/pdf") {
    try {
      // pdf-parse v1 — classic function API: pdf(buffer) → { text, numpages, ... }
      // Require via lib path to avoid Next.js test-environment trigger in index.js
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdf = require("pdf-parse/lib/pdf-parse") as (
        buffer: Buffer
      ) => Promise<{ text: string; numpages: number }>;

      const buffer = Buffer.from(await file.arrayBuffer());
      const data   = await pdf(buffer);
      const text   = data.text;

      console.log("[parse-training-plan] Extracted PDF text:", text.slice(0, 500));

      if (!text.trim()) {
        return NextResponse.json(
          { error: "Unable to read PDF. Please upload a text-based PDF." },
          { status: 422 }
        );
      }

      rawText = text;
    } catch (err) {
      console.error("[parse-training-plan] PDF extraction failed:", err);
      return NextResponse.json(
        { error: "Unable to read PDF. Please upload a text-based PDF." },
        { status: 422 }
      );
    }
  } else {
    return NextResponse.json(
      { error: "Unsupported file type. Upload a PDF or CSV." },
      { status: 415 }
    );
  }

  if (!rawText.trim()) {
    return NextResponse.json(
      { error: "No text could be extracted from the file." },
      { status: 422 }
    );
  }

  // ── Parse with Claude ───────────────────────────────────────────────────────
  const prompt = `You are a structured training schedule parser for athletes.

Extract a 7-day weekly training plan from the text below. Return ONLY a valid JSON array of exactly 7 objects — one per day, Monday through Sunday. No markdown, no explanation.

Each object must have these fields:

REQUIRED:
- "day": one of "Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"
- "training_type": category — one of "strength","practice","game","recovery","cardio","off"
  · Run/Bike/Swim/Row → "cardio"
  · Lift/Weights/Gym → "strength"
  · Team session/Drill → "practice"
  · Competition/Race/Match → "game"
  · Yoga/Stretch/Mobility/Easy → "recovery"
  · Rest/Nothing → "off"
- "duration": integer minutes (0 for off days; estimate if unstated — typical: strength 60, cardio 45, practice 90, game 120)
- "intensity": one of "low","moderate","high"
  · Easy Run / Jog / Walk / Yoga → "low"
  · Long Run / Tempo / Threshold / Moderate cardio / Practice → "moderate"
  · Intervals / Sprints / Race / Heavy lift / Game → "high"

OPTIONAL (omit when not applicable or unknown):
- "subtype": specific session variant — examples:
    cardio    → "Easy Run" | "Tempo Run" | "Long Run" | "Intervals" | "Fartlek" | "Hill Run" | "Progression Run" | "Bike" | "Swim" | "Row"
    strength  → "Upper Body" | "Lower Body" | "Full Body" | "Power" | "Core" | "Push Day" | "Pull Day"
    practice  → "Drills" | "Skill Work" | "Scrimmage" | "Tactics"
    recovery  → "Yoga" | "Mobility" | "Stretching" | "Active Recovery" | "Walk"
    game      → "Race" | "Tournament" | "Scrimmage"
- "distance": numeric distance value (omit for time-based sessions)
- "distanceUnit": "mi" or "km" (required if distance is set; default "mi")

Rules:
- ALL 7 days must be present. Days not mentioned → training_type "off", duration 0, intensity "low"
- Return ONLY the raw JSON array.
- Cap duration at 300 minutes.

Text to parse:
${rawText.slice(0, 8000)}`;

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const content = message.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected Claude response type");
    }

    // Strip markdown fences if present
    let jsonText = content.text.trim();
    jsonText = jsonText.replace(/^```(?:json)?\r?\n?/, "").replace(/\r?\n?```$/, "").trim();

    const rawArray = JSON.parse(jsonText);
    if (!Array.isArray(rawArray)) throw new Error("Claude did not return an array");

    const validDays: TrainingDay[] = [];
    for (const item of rawArray) {
      const validated = validateDay(item);
      if (validated) validDays.push(validated);
    }

    if (validDays.length === 0) {
      throw new Error("No valid days in Claude response");
    }

    const allDays = fillMissingDays(validDays);
    return NextResponse.json({ days: allDays });
  } catch (err) {
    console.error("[parse-training-plan] Claude parse error:", err);
    return NextResponse.json(
      { error: "Could not parse a training schedule from the file. Check the format and try again." },
      { status: 422 }
    );
  }
}
