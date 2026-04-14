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

function clampDuration(d: unknown): number {
  const n = typeof d === "number" ? d : parseInt(String(d ?? 0), 10);
  if (isNaN(n) || n < 0) return 0;
  return Math.min(Math.max(n, 0), 300);
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

  return {
    day:           day as WeekDay,
    training_type: training_type as TrainingType,
    duration:      clampDuration(r.duration),
    intensity:     intensity as IntensityLevel,
    notes:         typeof r.notes === "string" && r.notes ? r.notes : undefined,
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
      // Use the direct-path import to avoid Next.js test-environment mock
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (
        buffer: Buffer
      ) => Promise<{ text: string }>;
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await pdfParse(buffer);
      rawText = result.text;
    } catch (err) {
      console.error("[parse-training-plan] PDF extraction failed:", err);
      return NextResponse.json(
        { error: "Failed to read PDF. Try exporting as CSV and uploading that instead." },
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
  const prompt = `You are a training schedule parser for athletes.

Extract a 7-day weekly training plan from the text below and return ONLY a valid JSON array of exactly 7 objects — one per day, Monday through Sunday.

Each object must have these fields:
- "day": one of "Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"
- "training_type": one of "strength","practice","game","recovery","cardio","off"
- "duration": integer minutes (0 for off days; estimate if not stated — typical session 45–120 min)
- "intensity": one of "low","moderate","high" ("low" for recovery/off, "moderate" for practice/cardio, "high" for games/heavy lifting)
- "notes": short optional string describing the session focus (omit if nothing useful to add)

Rules:
- Include ALL 7 days. Days not mentioned → training_type "off", duration 0, intensity "low"
- No markdown. No explanation. Return ONLY the raw JSON array.
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
