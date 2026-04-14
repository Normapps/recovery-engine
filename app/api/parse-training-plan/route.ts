// Force Node.js runtime — required for Buffer APIs.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { TrainingDay, WeekDay, TrainingType, IntensityLevel } from "@/lib/types";

// Client is intentionally created inside the POST handler so the API key
// guard fires before the SDK constructor runs.

// ─── PDF text extraction ──────────────────────────────────────────────────────
// Uses pdf-parse v1 (battle-tested CJS library).
// Required via lib path to avoid Next.js dev-mode test check in index.js.
async function extractPDFText(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require("pdf-parse/lib/pdf-parse") as (
    buf: Buffer
  ) => Promise<{ text: string; numpages: number }>;

  const result = await pdfParse(buffer);
  console.log("[pdf] pages:", result.numpages, "| chars:", result.text.length);
  return result.text;
}

// ─── Text cleaning ─────────────────────────────────────────────────────────────
// pdf-parse output can have excessive whitespace and odd spacing.
// Normalise before sending to Claude so the model gets cleaner input.
function cleanText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")          // normalise line endings
    .replace(/[ \t]{2,}/g, " ")      // collapse repeated spaces/tabs
    .replace(/\n{3,}/g, "\n\n")      // collapse excessive blank lines
    .trim();
}

// ─── Validation helpers ────────────────────────────────────────────────────────
const WEEK_DAYS: WeekDay[] = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
];
const VALID_TYPES    = new Set<string>(["strength","practice","game","recovery","cardio","off"]);
const VALID_INTENSITY = new Set<string>(["low","moderate","high"]);
const VALID_UNITS    = new Set<string>(["mi","km"]);

function clampInt(v: unknown, max = 300): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? 0), 10);
  return isNaN(n) ? 0 : Math.min(Math.max(n, 0), max);
}

function clampFloat(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(n) || n <= 0 ? undefined : Math.min(n, 9999);
}

function validateDay(raw: unknown): TrainingDay | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const day           = String(r.day ?? "");
  const training_type = String(r.training_type ?? "");
  const intensity     = String(r.intensity ?? "");

  if (!WEEK_DAYS.includes(day as WeekDay))     return null;
  if (!VALID_TYPES.has(training_type))         return null;
  if (!VALID_INTENSITY.has(intensity))         return null;

  const distance     = clampFloat(r.distance);
  const rawUnit      = typeof r.distanceUnit === "string" ? r.distanceUnit.toLowerCase() : null;
  const distanceUnit = rawUnit && VALID_UNITS.has(rawUnit)
    ? (rawUnit as "mi" | "km")
    : (distance !== undefined ? "mi" : undefined);
  const subtype = typeof r.subtype === "string" && r.subtype.trim()
    ? r.subtype.trim() : undefined;

  return {
    day:           day as WeekDay,
    training_type: training_type as TrainingType,
    duration:      clampInt(r.duration),
    intensity:     intensity as IntensityLevel,
    ...(r.notes    ? { notes: String(r.notes) }   : {}),
    ...(subtype    ? { subtype }                   : {}),
    ...(distance   !== undefined ? { distance }    : {}),
    ...(distanceUnit             ? { distanceUnit } : {}),
  };
}

function fillMissingDays(days: TrainingDay[]): TrainingDay[] {
  const seen = new Set(days.map((d) => d.day));
  const all  = [...days];
  for (const day of WEEK_DAYS) {
    if (!seen.has(day))
      all.push({ day, training_type: "off", duration: 0, intensity: "low" });
  }
  all.sort((a, b) => WEEK_DAYS.indexOf(a.day) - WEEK_DAYS.indexOf(b.day));
  return all;
}

// ─── Robust JSON array extractor ─────────────────────────────────────────────
// Claude sometimes wraps JSON in explanation text or markdown.
// This finds the first [...] block regardless of surrounding content.
function extractJSONArray(text: string): unknown[] {
  // Strip markdown fences
  const stripped = text
    .replace(/^```(?:json)?\r?\n?/m, "")
    .replace(/\r?\n?```$/m, "")
    .trim();

  // Try direct parse first
  try {
    const parsed = JSON.parse(stripped);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* fall through */ }

  // Find the outermost [...] block
  const start = stripped.indexOf("[");
  const end   = stripped.lastIndexOf("]");
  if (start !== -1 && end > start) {
    const arr = JSON.parse(stripped.slice(start, end + 1));
    if (Array.isArray(arr)) return arr;
  }

  throw new Error("No JSON array found in Claude response");
}

// ─── Claude prompt ─────────────────────────────────────────────────────────────
function buildPrompt(text: string, today: string): string {
  return `You are an expert training plan parser for athletes. Today's date is ${today}.

Analyse the training document below and extract ONE week of training — the current week if dates are visible, otherwise the first full week in the document.

The document may be:
- A multi-week marathon or race training plan (tables, columns, or lists)
- A weekly team practice schedule
- A strength and conditioning program
- A mix of running, cross-training, and rest days

Return ONLY a valid JSON array of exactly 7 objects (Monday through Sunday). No markdown, no explanation, no extra text — just the raw JSON array.

Each object requires these fields:
  "day"          — one of: "Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"
  "training_type"— one of: "strength","practice","game","recovery","cardio","off"
                   • Run/Bike/Swim/Row/Cardio → "cardio"
                   • Weights/Gym/Lift → "strength"
                   • Team practice/Drill/Skills → "practice"
                   • Race/Competition/Game/Match → "game"
                   • Easy/Yoga/Stretch/Mobility/Active recovery → "recovery"
                   • Rest/Off/Nothing → "off"
  "duration"     — integer minutes (estimate if not stated; 0 for rest days)
                   typical defaults: easy run 30-45, long run 90-120, tempo 45-60,
                   strength 45-60, practice 75-90, game 120, recovery 30
  "intensity"    — one of: "low","moderate","high"
                   • Easy/recovery run/jog/yoga/walk → "low"
                   • Tempo/threshold/long run/moderate effort/practice → "moderate"
                   • Intervals/speed work/race/heavy lift/game → "high"

Optional fields (include when the document has this info):
  "subtype"      — specific session label, e.g. "Long Run","Tempo Run","Intervals",
                   "Easy Run","Hill Run","Fartlek","Full Body","Upper Body","Yoga"
  "distance"     — numeric value (miles or km)
  "distanceUnit" — "mi" or "km"

Rules:
- ALL 7 days must be present. Days with no session → training_type "off", duration 0, intensity "low"
- If the document is a multi-week plan, extract the FIRST week or the week matching today's date
- If a day lists multiple sessions, pick the primary one
- Return ONLY the JSON array — no other text

Document:
${text.slice(0, 12000)}`;
}

// ─── POST handler ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // 1. Parse form data
  let formData: FormData;
  try { formData = await req.formData(); }
  catch {
    return NextResponse.json({ error: "Invalid multipart form data." }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  const fileName = file.name.toLowerCase();
  const mimeType = file.type;
  let rawText = "";

  // 2. Extract text
  if (fileName.endsWith(".csv") || mimeType.includes("csv") || mimeType.includes("text/plain")) {
    rawText = await file.text();
    console.log("[upload] CSV text length:", rawText.length);

  } else if (fileName.endsWith(".pdf") || mimeType.includes("pdf")) {
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      rawText = await extractPDFText(buffer);
    } catch (err) {
      console.error("[upload] PDF extraction error:", err);
      return NextResponse.json(
        { error: "Could not read the PDF. Make sure it is a text-based PDF, not a scanned image." },
        { status: 422 }
      );
    }

  } else {
    return NextResponse.json(
      { error: "Unsupported file type. Upload a PDF or CSV." },
      { status: 415 }
    );
  }

  // 3. Clean and validate extracted text
  rawText = cleanText(rawText);
  console.log("[upload] Extracted text preview:\n", rawText.slice(0, 600));

  if (rawText.trim().length < 20) {
    return NextResponse.json(
      { error: "Could not extract readable text from the file. Make sure it is a text-based PDF." },
      { status: 422 }
    );
  }

  // 4. Send to Claude
  // Debug: log whether the key loaded from .env.local
  console.log("ENV KEY:", process.env.ANTHROPIC_API_KEY
    ? `sk-ant-...${process.env.ANTHROPIC_API_KEY.slice(-4)}`
    : undefined);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ ANTHROPIC_API_KEY NOT FOUND");
    return NextResponse.json(
      { error: "Server misconfiguration: missing ANTHROPIC_API_KEY." },
      { status: 500 }
    );
  }

  // Create client here (inside handler) so the guard above runs first.
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const today  = new Date().toISOString().split("T")[0];
  const prompt = buildPrompt(rawText, today);

  let claudeRaw = "";
  try {
    const message = await client.messages.create({
      model:      "claude-sonnet-4-6",
      max_tokens: 2048,
      messages:   [{ role: "user", content: prompt }],
    });

    const content = message.content[0];
    if (content.type !== "text") throw new Error("Unexpected Claude response type");
    claudeRaw = content.text;
    console.log("[claude] Raw response:\n", claudeRaw.slice(0, 800));

  } catch (err) {
    console.error("[claude] API error:", err);
    return NextResponse.json(
      { error: "AI parsing failed. Please try again." },
      { status: 502 }
    );
  }

  // 5. Parse and validate Claude's JSON
  try {
    const rawArray  = extractJSONArray(claudeRaw);
    const validDays = rawArray
      .map(validateDay)
      .filter((d): d is TrainingDay => d !== null);

    if (validDays.length === 0) {
      console.error("[claude] No valid days. Raw response:", claudeRaw);
      throw new Error("No valid training days extracted");
    }

    const allDays = fillMissingDays(validDays);
    console.log("[result] Returning", allDays.length, "days");
    return NextResponse.json({ days: allDays });

  } catch (err) {
    console.error("[claude] Parse error:", err, "\nRaw:", claudeRaw);
    return NextResponse.json(
      { error: "AI could not interpret the training schedule. Try a simpler format or paste the text manually." },
      { status: 422 }
    );
  }
}
