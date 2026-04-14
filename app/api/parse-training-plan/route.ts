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

// ─── Constants ────────────────────────────────────────────────────────────────
const WEEK_DAYS: WeekDay[] = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
];

const VALID_TYPES     = new Set<TrainingType>(["strength","practice","game","recovery","cardio","off"]);
const VALID_INTENSITY = new Set<IntensityLevel>(["low","moderate","high"]);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function clampInt(v: unknown, max = 600): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? 0), 10);
  return isNaN(n) ? 0 : Math.min(Math.max(n, 0), max);
}

function clampFloat(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(n) || n <= 0 ? undefined : Math.min(n, 9999);
}

// Map Claude's richer "type" / "category" strings onto our TrainingType enum.
function resolveTrainingType(
  type: string,
  category: string,
): TrainingType {
  const t = type.toLowerCase().trim();
  const c = category.toLowerCase().trim();

  if (["off", "rest", "none"].includes(t))             return "off";
  if (["game", "race", "competition", "match"].includes(t)) return "game";
  if (["practice", "drill", "skills", "training"].includes(t)) return "practice";
  if (["recovery", "easy", "yoga", "mobility", "stretch", "walk"].includes(t)) return "recovery";
  if (["strength", "lift", "weights", "gym"].includes(t)) return "strength";
  if (["run","bike","swim","row","cardio","cycle","cross-train","hike"].includes(t)) return "cardio";

  // Fall through to category
  if (c === "cardio")   return "cardio";
  if (c === "strength") return "strength";
  if (c === "sport")    return "practice";
  if (c === "recovery") return "recovery";

  return "off";
}

// Validate + map one entry from Claude's richer schedule format → TrainingDay.
function validateEntry(raw: unknown): TrainingDay | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const day = String(r.day ?? "").trim();
  if (!WEEK_DAYS.includes(day as WeekDay)) return null;

  const rawIntensity = String(r.intensity ?? "").toLowerCase().trim();
  const intensity: IntensityLevel = VALID_INTENSITY.has(rawIntensity as IntensityLevel)
    ? (rawIntensity as IntensityLevel)
    : "low";

  // Resolve training_type from Claude's "type" + "category" fields
  const rawType     = String(r.type     ?? r.training_type ?? "off");
  const rawCategory = String(r.category ?? "");
  const training_type = resolveTrainingType(rawType, rawCategory);

  // Validate it's in our enum (resolveTrainingType always returns a valid value,
  // but guard for future safety)
  if (!VALID_TYPES.has(training_type)) return null;

  // duration_minutes (new field) takes priority over legacy duration
  const duration = clampInt(r.duration_minutes ?? r.duration);

  // distance_miles (new field) is already normalised; fall back to distance field
  const distance = clampFloat(r.distance_miles ?? r.distance);
  const distanceUnit: "mi" | "km" | undefined =
    r.distance_miles !== undefined && r.distance_miles !== null
      ? "mi"
      : typeof r.distanceUnit === "string" && r.distanceUnit.toLowerCase() === "km"
        ? "km"
        : distance !== undefined ? "mi" : undefined;

  const subtype = typeof r.subtype === "string" && r.subtype.trim()
    ? r.subtype.trim() : undefined;

  // Carry date/time into notes if present (not in TrainingDay schema, but useful)
  const datePart = r.date ? String(r.date) : null;
  const timePart = r.time ? String(r.time) : null;
  const notesRaw = r.notes ? String(r.notes) : null;
  const notesParts = [
    datePart && `Date: ${datePart}`,
    timePart && `Time: ${timePart}`,
    notesRaw,
  ].filter(Boolean);
  const notes = notesParts.length ? notesParts.join(" | ") : undefined;

  return {
    day:           day as WeekDay,
    training_type,
    duration,
    intensity,
    ...(notes      ? { notes }       : {}),
    ...(subtype    ? { subtype }     : {}),
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

// ─── Robust JSON extractor ───────────────────────────────────────────────────
// Claude sometimes wraps the response in explanation text or markdown fences.
// We try: strip fences → direct parse → find outermost { } (object) → find [ ] (array).
function extractClaudeJSON(text: string): { sport?: string; schedule?: unknown[]; rawArray?: unknown[] } {
  const stripped = text
    .replace(/```(?:json)?\r?\n?/g, "")
    .replace(/\r?\n?```/g, "")
    .trim();

  // Try direct parse as object { sport, schedule }
  try {
    const parsed = JSON.parse(stripped);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { sport: String(parsed.sport ?? ""), schedule: Array.isArray(parsed.schedule) ? parsed.schedule : [] };
    }
    if (Array.isArray(parsed)) return { rawArray: parsed };
  } catch { /* fall through */ }

  // Find outermost { ... }
  const objStart = stripped.indexOf("{");
  const objEnd   = stripped.lastIndexOf("}");
  if (objStart !== -1 && objEnd > objStart) {
    try {
      const parsed = JSON.parse(stripped.slice(objStart, objEnd + 1));
      if (parsed && !Array.isArray(parsed)) {
        return { sport: String(parsed.sport ?? ""), schedule: Array.isArray(parsed.schedule) ? parsed.schedule : [] };
      }
    } catch { /* fall through */ }
  }

  // Find outermost [ ... ]
  const arrStart = stripped.indexOf("[");
  const arrEnd   = stripped.lastIndexOf("]");
  if (arrStart !== -1 && arrEnd > arrStart) {
    const arr = JSON.parse(stripped.slice(arrStart, arrEnd + 1));
    if (Array.isArray(arr)) return { rawArray: arr };
  }

  throw new Error("No JSON found in Claude response");
}

// ─── Sport detection ──────────────────────────────────────────────────────────
function normaliseSport(raw: string | undefined): string {
  if (!raw) return "running";
  const s = raw.toLowerCase();
  if (s.includes("soccer") || s.includes("football"))  return "soccer";
  if (s.includes("cycling") || s.includes("bike"))     return "cycling";
  if (s.includes("swim"))                               return "swimming";
  if (s.includes("strength") || s.includes("lifting")) return "strength";
  if (s.includes("triathlon") || s.includes("hybrid")) return "hybrid";
  if (s.includes("running") || s.includes("marathon") || s.includes("run")) return "running";
  return s.trim() || "running";
}

// ─── Claude prompt ─────────────────────────────────────────────────────────────
function buildPrompt(text: string, today: string): string {
  return `You are an expert training plan parser for athletes. Today's date is ${today}.

Analyse the training document below and:
1. Identify the primary sport
2. Extract ONE week of training — the current week if dates are visible, otherwise the first full week

The document may be a multi-week marathon/race plan, team practice schedule, strength program, or mixed plan.

Return ONLY a valid JSON object (no markdown, no explanation):
{
  "sport": "<one of: running, cycling, swimming, soccer, strength, triathlon, hybrid>",
  "schedule": [
    {
      "day":            "<Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday>",
      "date":           "<YYYY-MM-DD or null>",
      "time":           "<HH:MM or null>",
      "type":           "<Run|Strength|Game|Practice|Recovery|Off>",
      "subtype":        "<Long Run|Tempo Run|Easy Run|Intervals|Hill Run|Fartlek|Full Body|Upper Body|Yoga|null>",
      "category":       "<cardio|strength|sport|recovery>",
      "duration_minutes": <integer or null>,
      "distance_miles": <number or null>,
      "intensity":      "<low|moderate|high>"
    }
  ]
}

Sport detection keywords:
- running/marathon/5K/10K/half → "running"
- cycling/bike/criterium → "cycling"
- swimming/swim → "swimming"
- soccer/football → "soccer"
- weights/lifting/powerlifting → "strength"
- triathlon/ironman → "triathlon"
- mixed/cross-training → "hybrid"

Type rules:
- Run/Bike/Swim/Row → "Run" (category: "cardio")
- Weights/Gym/Lift → "Strength" (category: "strength")
- Team practice/Drill/Skills → "Practice" (category: "sport")
- Race/Game/Competition → "Game" (category: "sport")
- Easy jog/Yoga/Stretch/Mobility → "Recovery" (category: "recovery")
- Rest/Off/Nothing → "Off" (category: "recovery")

Intensity rules:
- Easy/jog/walk/yoga/active recovery → "low"
- Tempo/threshold/long run/practice/moderate → "moderate"
- Intervals/speed/race/heavy lift/game → "high"

Duration defaults (use when not stated):
- Easy run: 35 min | Tempo run: 50 min | Long run: 105 min
- Intervals: 55 min | Strength: 50 min | Practice: 80 min | Game: 120 min | Recovery: 30 min | Off: 0

Rules:
- ALL 7 days must appear in schedule. Missing days → type "Off", duration_minutes 0, intensity "low"
- Multi-week plan: extract FIRST week or the week matching today's date (${today})
- Multiple sessions on one day: pick the primary (longer/harder) session
- distance_miles: always convert to miles (1 km = 0.621 mi); null if unknown
- Return ONLY the JSON object — no other text

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
    const parsed    = extractClaudeJSON(claudeRaw);
    const rawItems  = parsed.schedule ?? parsed.rawArray ?? [];
    const sport     = normaliseSport(parsed.sport);

    console.log("[claude] Detected sport:", sport, "| Raw entries:", rawItems.length);

    const validDays = rawItems
      .map(validateEntry)
      .filter((d): d is TrainingDay => d !== null);

    if (validDays.length === 0) {
      console.error("[claude] No valid days. Raw response:", claudeRaw);
      throw new Error("No valid training days extracted");
    }

    const allDays = fillMissingDays(validDays);
    console.log("[result] sport:", sport, "| days:", allDays.length);
    return NextResponse.json({ sport, days: allDays });

  } catch (err) {
    console.error("[claude] Parse error:", err, "\nRaw:", claudeRaw);
    return NextResponse.json(
      { error: "AI could not interpret the training schedule. Try a simpler format or paste the text manually." },
      { status: 422 }
    );
  }
}
