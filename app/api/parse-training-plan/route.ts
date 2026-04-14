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
// pdf-parse output can have excessive whitespace, page numbers, and headers.
// Strip noise before sending to Claude so the model sees cleaner training data.
function cleanText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")                        // normalise line endings
    .replace(/\f/g, "\n")                          // form feeds → newline
    .replace(/^\s*\d+\s*$/gm, "")                 // standalone page numbers
    .replace(/^.{0,60}page \d+.{0,30}$/gim, "")  // "Page 3 of 12" headers
    .replace(/[ \t]{2,}/g, " ")                   // collapse repeated spaces/tabs
    .replace(/\n{3,}/g, "\n\n")                   // collapse excessive blank lines
    .replace(/[^\x09\x0A\x20-\x7E\u00A0-\uFFFF]/g, " ") // strip control chars
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

// Parse duration strings Claude might emit as text instead of numbers.
// Handles: "2h", "1h 15min", "45 min", "90", "1:30", etc.
function parseDuration(v: unknown): number {
  if (typeof v === "number") return clampInt(v);
  if (v === null || v === undefined) return 0;
  const s = String(v).toLowerCase().trim();
  if (!s || s === "null" || s === "0") return 0;

  // "1h 30min" or "1h30m"
  const hm = s.match(/(\d+)\s*h(?:our)?s?\s*(\d+)?\s*m?i?n?/);
  if (hm) return clampInt(parseInt(hm[1]) * 60 + parseInt(hm[2] ?? "0"));

  // "2h"
  const h = s.match(/^(\d+)\s*h(?:our)?s?$/);
  if (h) return clampInt(parseInt(h[1]) * 60);

  // "45min" or "45 min"
  const m = s.match(/(\d+)\s*m(?:in)?/);
  if (m) return clampInt(parseInt(m[1]));

  // "1:30" → 90 min
  const colon = s.match(/^(\d+):(\d{2})$/);
  if (colon) return clampInt(parseInt(colon[1]) * 60 + parseInt(colon[2]));

  return clampInt(s);
}

// Resolve training_type from Claude's "type" + "category" strings.
// Accepts natural-language variations like "Run", "Lift", "Easy jog", etc.
function resolveTrainingType(type: string, category: string): TrainingType {
  const t = type.toLowerCase().trim();
  const c = category.toLowerCase().trim();

  if (/\boff\b|\brest\b|\bnone\b/.test(t))                           return "off";
  if (/\bgame\b|\brace\b|\bcompetition\b|\bmatch\b/.test(t))         return "game";
  if (/\bpractice\b|\bdrill\b|\bskills\b/.test(t))                   return "practice";
  if (/\brecovery\b|\byoga\b|\bmobility\b|\bstretch\b|\bwalk\b/.test(t)) return "recovery";
  if (/\bstrength\b|\blift\b|\bweights?\b|\bgym\b|\bpower\b/.test(t)) return "strength";
  if (/\brun\b|\bbike\b|\bswim\b|\brow\b|\bcardio\b|\bcycle\b|\bhike\b|\bspin\b/.test(t)) return "cardio";

  if (c === "cardio")   return "cardio";
  if (c === "strength") return "strength";
  if (c === "sport")    return "practice";
  if (c === "recovery") return "recovery";

  return "off";
}

// Derive category string from resolved TrainingType.
function categoryFromType(tt: TrainingType): string {
  if (tt === "cardio")   return "cardio";
  if (tt === "strength") return "strength";
  if (tt === "game" || tt === "practice") return "sport";
  return "recovery"; // off | recovery
}

// Infer intensity from type + subtype when Claude omits or gets it wrong.
function inferIntensity(tt: TrainingType, subtype: string): IntensityLevel {
  const s = subtype.toLowerCase();
  if (/interval|speed|tempo|threshold|sprint|fartlek|hill repeat|race|game/.test(s)) return "high";
  if (/long run|marathon pace|moderate|practice|threshold/.test(s))                  return "moderate";
  if (/easy|recovery|jog|walk|yoga|stretch|mobility/.test(s))                        return "low";
  // Fall back to type
  if (tt === "game")     return "high";
  if (tt === "strength") return "moderate";
  if (tt === "cardio")   return "moderate";
  if (tt === "practice") return "moderate";
  return "low";
}

// Default duration when Claude returns null/0 for a non-off day.
const DEFAULT_DURATION: Record<string, number> = {
  "long run": 110, "tempo run": 50, "intervals": 55, "easy run": 35,
  "hill run": 50,  "fartlek": 50,   "full body": 50, "upper body": 45,
  "yoga": 30,      "recovery": 30,  "practice": 80,  "game": 120,
  "strength": 50,  "cardio": 40,    "run": 40,        "off": 0,
};
function defaultDuration(tt: TrainingType, subtype: string): number {
  const s = subtype.toLowerCase();
  for (const [key, val] of Object.entries(DEFAULT_DURATION)) {
    if (s.includes(key)) return val;
  }
  return DEFAULT_DURATION[tt] ?? 0;
}

// ─── Entry validation & normalisation ─────────────────────────────────────────
// Every required field is guaranteed to be present and valid.
// Missing fields are inferred rather than causing the entry to be dropped.
function validateEntry(raw: unknown): TrainingDay | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  // day is the only field we can't recover without — discard if missing/invalid
  const day = String(r.day ?? "").trim();
  if (!WEEK_DAYS.includes(day as WeekDay)) return null;

  // Resolve type (required)
  const rawType     = String(r.type ?? r.training_type ?? "Off");
  const rawCategory = String(r.category ?? "");
  const training_type = resolveTrainingType(rawType, rawCategory);

  // Subtype (optional but used for inference below)
  const subtype = typeof r.subtype === "string" && r.subtype.trim()
    ? r.subtype.trim() : undefined;

  // Intensity — infer if absent or invalid
  const rawIntensity = String(r.intensity ?? "").toLowerCase().trim();
  const intensity: IntensityLevel = VALID_INTENSITY.has(rawIntensity as IntensityLevel)
    ? (rawIntensity as IntensityLevel)
    : inferIntensity(training_type, subtype ?? rawType);

  // Duration — parse text forms ("2h", "45 min") and fill default if still 0
  let duration = parseDuration(r.duration_minutes ?? r.duration);
  if (duration === 0 && training_type !== "off") {
    duration = defaultDuration(training_type, subtype ?? "");
  }

  // Distance — normalise to miles
  const distance = clampFloat(r.distance_miles ?? r.distance);
  const distanceUnit: "mi" | "km" | undefined =
    r.distance_miles !== undefined && r.distance_miles !== null ? "mi"
    : typeof r.distanceUnit === "string" && r.distanceUnit.toLowerCase() === "km" ? "km"
    : distance !== undefined ? "mi" : undefined;

  // Date/time → notes (TrainingDay has no dedicated fields for these)
  const datePart = r.date && String(r.date) !== "null" ? String(r.date) : null;
  const timePart = r.time && String(r.time) !== "null" ? String(r.time) : null;
  const notesRaw = r.notes ? String(r.notes) : null;
  const notesParts = [
    datePart && `Date: ${datePart}`,
    timePart && `Time: ${timePart}`,
    notesRaw,
  ].filter(Boolean);
  const notes = notesParts.length ? notesParts.join(" | ") : undefined;

  // Validate training_type is in enum (resolveTrainingType always returns valid)
  if (!VALID_TYPES.has(training_type)) return null;

  return {
    day:           day as WeekDay,
    training_type,
    duration,
    intensity,
    ...(notes      ? { notes }        : {}),
    ...(subtype    ? { subtype }      : {}),
    ...(distance !== undefined ? { distance }     : {}),
    ...(distanceUnit           ? { distanceUnit } : {}),
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
const SYSTEM_PROMPT = `You are a training-plan parser. You output ONLY valid JSON — no markdown fences, no prose, no explanation. If you are uncertain about a field, make your best inference rather than omitting it.`;

function buildPrompt(text: string, today: string): string {
  return `Today's date is ${today}. Parse the training document below into this exact JSON structure:

{
  "sport": "<running|cycling|swimming|soccer|strength|triathlon|hybrid>",
  "schedule": [
    {
      "day":              "<Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday>",
      "date":             "<YYYY-MM-DD or null>",
      "time":             "<HH:MM or null>",
      "type":             "<Run|Strength|Game|Practice|Recovery|Off>",
      "subtype":          "<Long Run|Tempo Run|Easy Run|Intervals|Hill Run|Fartlek|Full Body|Upper Body|Yoga|null>",
      "category":         "<cardio|strength|sport|recovery>",
      "duration_minutes": <integer — MUST be a number, not a string>,
      "distance_miles":   <number or null — always in miles>,
      "intensity":        "<low|moderate|high>"
    }
  ]
}

━━━ SPORT DETECTION ━━━
running/marathon/5K/10K/half marathon → "running"
cycling/bike/criterium/velodrome → "cycling"
swimming/swim/triathlon → "triathlon"
soccer/football → "soccer"
weights/lifting/powerlifting → "strength"
mixed/cross-training → "hybrid"

━━━ TYPE + CATEGORY MAPPING ━━━
"Run 5 miles" / "Easy jog" / "Bike 30 min"  → type:"Run",      category:"cardio"
"Strength 45 min" / "Gym" / "Lift"           → type:"Strength", category:"strength"
"Practice 1h 15min" / "Drill" / "Skills"     → type:"Practice", category:"sport"
"Game 2h" / "Match" / "Race" / "Competition" → type:"Game",     category:"sport"
"Yoga" / "Stretch" / "Easy" / "Mobility"     → type:"Recovery", category:"recovery"
"Rest" / "Off" / (blank)                     → type:"Off",      category:"recovery"

━━━ INTENSITY ━━━
low      → Easy, jog, walk, yoga, active recovery, rest
moderate → Tempo, long run, marathon pace, practice, threshold, steady
high     → Intervals, speed work, race, heavy lift, game, sprint, fartlek

━━━ DURATION ━━━
Parse any format: "2h" = 120, "1h 15min" = 75, "45 min" = 45, "1:30" = 90.
If not stated, use these defaults:
Easy run: 35 | Tempo: 50 | Long run: 110 | Intervals: 55 | Strength: 50
Practice: 80 | Game: 120 | Recovery: 30 | Off: 0

━━━ DISTANCE ━━━
Always convert to miles (1 km = 0.621 mi). Null if not mentioned.
"Run 5 miles" → 5.0  |  "10K run" → 6.21  |  "20 km bike" → 12.4

━━━ RULES ━━━
1. Output ALL 7 days (Mon–Sun). Days not in document → type:"Off", category:"recovery", duration_minutes:0, intensity:"low"
2. Multi-week plan: extract the FIRST full week, or the week containing today (${today}) if dates are visible
3. Multiple sessions on one day: use the primary (harder/longer) session
4. Every entry MUST have day, type, category, intensity — infer if needed, never omit
5. duration_minutes must be an integer (not a string, not null for active days)
6. Return ONLY the JSON object — nothing else

━━━ MESSY INPUT EXAMPLES ━━━
"Mon - Run 5 miles"              → day:Monday, type:Run, subtype:Easy Run, category:cardio, distance_miles:5, duration_minutes:40, intensity:low
"Tue: Strength 45 min"           → day:Tuesday, type:Strength, category:strength, duration_minutes:45, intensity:moderate
"Wed – Tempo 6mi @ threshold"    → day:Wednesday, type:Run, subtype:Tempo Run, category:cardio, distance_miles:6, duration_minutes:50, intensity:high
"Thu  rest"                      → day:Thursday, type:Off, category:recovery, duration_minutes:0, intensity:low
"Fri: Practice 1h 15min"         → day:Friday, type:Practice, category:sport, duration_minutes:75, intensity:moderate
"Sat: Game 2h high"              → day:Saturday, type:Game, category:sport, duration_minutes:120, intensity:high
"Sun Long Run 20 miles easy"     → day:Sunday, type:Run, subtype:Long Run, category:cardio, distance_miles:20, duration_minutes:110, intensity:low

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
      max_tokens: 4096,
      system:     SYSTEM_PROMPT,
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

    // Log sample for debugging
    console.log("[result] sport:", sport, "| days:", allDays.length);
    allDays.slice(0, 3).forEach(d =>
      console.log(`  ${d.day}: ${d.training_type} | ${d.intensity} | ${d.duration}min${d.distance ? ` | ${d.distance}mi` : ""}`)
    );

    return NextResponse.json({ sport, days: allDays });

  } catch (err) {
    console.error("[claude] Parse error:", err, "\nRaw:", claudeRaw);
    return NextResponse.json(
      { error: "AI could not interpret the training schedule. Try a simpler format or paste the text manually." },
      { status: 422 }
    );
  }
}
