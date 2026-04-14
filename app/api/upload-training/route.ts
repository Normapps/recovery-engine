// Force Node.js runtime — required for Buffer APIs and pdfjs-dist.
// Must NOT run in Edge Runtime.
export const runtime = "nodejs";

import path from "path";
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { TrainingDay, WeekDay, TrainingType, IntensityLevel } from "@/lib/types";
import { upsertTrainingPlan } from "@/lib/supabase";

// ─── PDF text extraction ──────────────────────────────────────────────────────
// Uses pdfjs-dist (modern, actively maintained).
// pdf-parse bundles a very old pdf.js (v1.10.100) that fails on PDFs created
// by modern tools (Adobe, Google Docs, macOS Preview) with "bad XRef entry".
// pdfjs-dist v5 handles all current PDF variants correctly.
async function extractPDFText(buffer: Buffer): Promise<string> {
  // webpackIgnore tells webpack to emit a native import() rather than bundle
  // pdfjs-dist. Required because pdfjs-dist is ESM-only — webpack would otherwise
  // try to process it as CJS and corrupt internal Object.defineProperty calls.
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — magic comment not in TS type definitions
  const pdfjsLib = await import(/* webpackIgnore: true */ "pdfjs-dist/legacy/build/pdf.mjs");

  // Worker must point to the actual .mjs file on disk so pdfjs can spin it up.
  // process.cwd() is the project root at runtime in Next.js API routes.
  pdfjsLib.GlobalWorkerOptions.workerSrc = path.join(
    process.cwd(),
    "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"
  );

  const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const loadingTask = pdfjsLib.getDocument({
    data:             uint8,
    useWorkerFetch:   false,
    isEvalSupported:  false,
    useSystemFonts:   true,
  });

  const pdf = await loadingTask.promise;
  console.log("[pdf] pages:", pdf.numPages);

  const pageTexts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();

    // Group items into lines by Y coordinate (items on same Y = same line).
    // A gap of >2 units in Y means a new line.
    const lines: string[] = [];
    let currentY: number | null = null;
    let currentLine = "";

    for (const item of content.items) {
      if (!("str" in item) || !item.str) continue;
      // Transform array: [scaleX, skewX, skewY, scaleY, translateX, translateY]
      const y = Array.isArray(item.transform) ? (item.transform[5] as number) : null;

      if (currentY === null || y === null || Math.abs(y - currentY) > 2) {
        if (currentLine.trim()) lines.push(currentLine.trim());
        currentLine = item.str;
        currentY    = y;
      } else {
        currentLine += (item.str.startsWith(" ") ? "" : " ") + item.str;
      }
    }
    if (currentLine.trim()) lines.push(currentLine.trim());
    pageTexts.push(lines.join("\n"));
  }

  const text = pageTexts.join("\n");
  console.log("[pdf] chars:", text.length, "| lines:", text.split("\n").length);
  return text;
}

// ─── Text cleaning ─────────────────────────────────────────────────────────────
function cleanText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\f/g, "\n")
    .replace(/^\s*\d+\s*$/gm, "")
    .replace(/^.{0,60}page \d+.{0,30}$/gim, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[^\x09\x0A\x20-\x7E\u00A0-\uFFFF]/g, " ")
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

function parseDuration(v: unknown): number {
  if (typeof v === "number") return clampInt(v);
  if (v === null || v === undefined) return 0;
  const s = String(v).toLowerCase().trim();
  if (!s || s === "null" || s === "0") return 0;

  const hm = s.match(/(\d+)\s*h(?:our)?s?\s*(\d+)?\s*m?i?n?/);
  if (hm) return clampInt(parseInt(hm[1]) * 60 + parseInt(hm[2] ?? "0"));

  const h = s.match(/^(\d+)\s*h(?:our)?s?$/);
  if (h) return clampInt(parseInt(h[1]) * 60);

  const m = s.match(/(\d+)\s*m(?:in)?/);
  if (m) return clampInt(parseInt(m[1]));

  const colon = s.match(/^(\d+):(\d{2})$/);
  if (colon) return clampInt(parseInt(colon[1]) * 60 + parseInt(colon[2]));

  return clampInt(s);
}

function resolveTrainingType(type: string, category: string): TrainingType {
  const t = type.toLowerCase().trim();
  const c = category.toLowerCase().trim();

  if (/\boff\b|\brest\b|\bnone\b/.test(t))                               return "off";
  // Pre-game / activation must come before the game check so "Pre-Game Activation"
  // is not misclassified as a game.
  if (/pre.?game|pregame|\bactivation\b|\bwarm.?up\b/.test(t))          return "practice";
  if (/\bgame\b|\brace\b|\bcompetition\b|\bmatch\b/.test(t))             return "game";
  // "Training" is the standard soccer/team-sport session label.
  if (/\bpractice\b|\bdrill\b|\bskills\b|\btraining\b|\btactical\b|\btechnical\b/.test(t)) return "practice";
  if (/\brecovery\b|\byoga\b|\bmobility\b|\bstretch\b|\bwalk\b/.test(t)) return "recovery";
  if (/\bstrength\b|\blift\b|\bweights?\b|\bgym\b|\bpower\b/.test(t))    return "strength";
  if (/\brun\b|\bbike\b|\bswim\b|\brow\b|\bcardio\b|\bcycle\b|\bhike\b|\bspin\b|intervals?|sprints?|\bfartlek\b|\btempo\b|\bjog\b/.test(t)) return "cardio";

  if (c === "cardio")   return "cardio";
  if (c === "strength") return "strength";
  if (c === "sport")    return "practice";
  if (c === "recovery") return "recovery";

  return "off";
}

function inferIntensity(tt: TrainingType, subtype: string): IntensityLevel {
  const s = subtype.toLowerCase();
  // BUG-FIX #1 + #2: Check explicit low signals FIRST so "easy long run" and
  // "pre-game activation" are never misclassified by a later high/moderate rule.
  if (/pre.?game|pregame|\bactivation\b|\bwalkthrough\b|\bdeload\b/.test(s))         return "low";
  if (/\beasy\b|\blight\b|\bjog\b|\bwalk\b|\byoga\b|\bstretch\b|\bmobility\b|\brecovery\b|\bwarm.?up\b/.test(s)) return "low";
  // BUG-FIX #3: "hill repeats?" (plural) and remove "threshold" from HIGH —
  // threshold is comfortably-hard (moderate), not max-effort (high).
  if (/intervals?|speed\s*work|sprints?|\bfartlek\b|hill\s+repeats?|\brace\b|\bgames?\b|high\s*intensity|\bpressing\b|\bconditioning\b/.test(s)) return "high";
  // "tempo" belongs here (moderate-hard, below race pace).
  // "threshold" belongs here too — it is the lactate threshold pace, not sprint.
  if (/\btempo\b|\bthreshold\b|long\s+run|marathon\s+pace|\bmoderate\b|\bpractice\b|\btactical\b|\btechnical\b|\bpossession\b|\bfinishing\b|\btransition\b/.test(s)) return "moderate";
  // Type-based fallback
  if (tt === "game")     return "high";
  if (tt === "strength") return "moderate";
  if (tt === "cardio")   return "moderate";
  if (tt === "practice") return "moderate";
  return "low";
}

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
function validateEntry(raw: unknown): TrainingDay | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const day = String(r.day ?? "").trim();
  if (!WEEK_DAYS.includes(day as WeekDay)) return null;

  const rawType       = String(r.type ?? r.training_type ?? "Off");
  const rawCategory   = String(r.category ?? "");
  const training_type = resolveTrainingType(rawType, rawCategory);

  const subtype = typeof r.subtype === "string" && r.subtype.trim()
    ? r.subtype.trim() : undefined;

  const rawIntensity = String(r.intensity ?? "").toLowerCase().trim();
  const intensity: IntensityLevel = VALID_INTENSITY.has(rawIntensity as IntensityLevel)
    ? (rawIntensity as IntensityLevel)
    : inferIntensity(training_type, subtype ?? rawType);

  let duration = parseDuration(r.duration_minutes ?? r.duration);
  if (duration === 0 && training_type !== "off") {
    duration = defaultDuration(training_type, subtype ?? "");
  }

  // BUG-FIX #18: resolve unit BEFORE clamping distance so the conversion is
  // applied correctly. If Claude returns distance_miles, unit is always "mi".
  // If it returns distance + distanceUnit:"km", honour the "km" label.
  const rawUnit = typeof r.distanceUnit === "string"
    ? r.distanceUnit.toLowerCase()
    : null;
  const distanceUnit: "mi" | "km" | undefined =
    r.distance_miles !== undefined && r.distance_miles !== null ? "mi"
    : rawUnit === "km" ? "km"
    : (r.distance !== undefined && r.distance !== null) ? "mi"
    : undefined;
  const distance = clampFloat(r.distance_miles ?? r.distance);

  const datePart = r.date && String(r.date) !== "null" ? String(r.date) : null;
  const timePart = r.time && String(r.time) !== "null" ? String(r.time) : null;
  const notesRaw = r.notes ? String(r.notes) : null;
  const notesParts = [
    datePart && `Date: ${datePart}`,
    timePart && `Time: ${timePart}`,
    notesRaw,
  ].filter(Boolean);
  const notes = notesParts.length ? notesParts.join(" | ") : undefined;

  if (!VALID_TYPES.has(training_type)) return null;

  return {
    day: day as WeekDay,
    training_type,
    duration,
    intensity,
    ...(notes        ? { notes }        : {}),
    ...(subtype      ? { subtype }      : {}),
    ...(distance !== undefined ? { distance }     : {}),
    ...(distanceUnit            ? { distanceUnit } : {}),
  };
}

function fillMissingDays(days: TrainingDay[]): TrainingDay[] {
  // BUG-FIX #13: deduplicate first — keep the LAST entry for each day
  // (later entries are assumed to be more specific / override earlier ones).
  const dedupMap = new Map<WeekDay, TrainingDay>();
  for (const d of days) dedupMap.set(d.day, d);

  const all: TrainingDay[] = Array.from(dedupMap.values());
  for (const day of WEEK_DAYS) {
    if (!dedupMap.has(day))
      all.push({ day, training_type: "off", duration: 0, intensity: "low" });
  }
  all.sort((a, b) => WEEK_DAYS.indexOf(a.day) - WEEK_DAYS.indexOf(b.day));
  return all;
}

// ─── Robust JSON extractor ────────────────────────────────────────────────────
function extractClaudeJSON(text: string): { sport?: string; schedule?: unknown[]; rawArray?: unknown[] } {
  const stripped = text
    .replace(/```(?:json)?\r?\n?/g, "")
    .replace(/\r?\n?```/g, "")
    .trim();

  try {
    const parsed = JSON.parse(stripped);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { sport: String(parsed.sport ?? ""), schedule: Array.isArray(parsed.schedule) ? parsed.schedule : [] };
    }
    if (Array.isArray(parsed)) return { rawArray: parsed };
  } catch { /* fall through */ }

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

  const arrStart = stripped.indexOf("[");
  const arrEnd   = stripped.lastIndexOf("]");
  if (arrStart !== -1 && arrEnd > arrStart) {
    const arr = JSON.parse(stripped.slice(arrStart, arrEnd + 1));
    if (Array.isArray(arr)) return { rawArray: arr };
  }

  throw new Error("No JSON found in Claude response");
}

// ─── Sport normalisation ──────────────────────────────────────────────────────
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

// ─── Regex-based training plan parser (no API key required) ──────────────────
// Handles the most common PDF/CSV formats:
//   "Monday - Easy Run 5 miles"
//   "Tue: Strength 45 min"
//   "Wed – Tempo 6mi @ threshold"
//   "Thursday  rest"
//   "Sat: Long Run 10 miles easy"

const DAY_PATTERN = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/i;

const DAY_MAP: Record<string, WeekDay> = {
  monday: "Monday", mon: "Monday",
  tuesday: "Tuesday", tue: "Tuesday",
  wednesday: "Wednesday", wed: "Wednesday",
  thursday: "Thursday", thu: "Thursday",
  friday: "Friday", fri: "Friday",
  saturday: "Saturday", sat: "Saturday",
  sunday: "Sunday", sun: "Sunday",
};

// Distance patterns: "5 miles", "10km", "6mi", "10K"
// mi(?!n) — negative lookahead prevents matching "min" as "mi"
const DISTANCE_RE = /(\d+\.?\d*)\s*(miles?|km|mi(?!n)|k\b)/i;
// Duration patterns: "45 min", "1h 30min", "2h", "1:30"
const DURATION_RE = /(\d+)\s*h(?:our)?s?\s*(\d+)?\s*m?i?n?|(\d+)\s*m(?:in(?:utes?)?)?|(\d+):(\d{2})/i;

// Subtype keyword → subtype label
const SUBTYPE_MAP: [RegExp, string][] = [
  // Running subtypes
  [/long\s*run/i,           "Long Run"],
  [/tempo/i,                "Tempo Run"],
  [/interval|speed\s*work/i,"Intervals"],
  [/hill/i,                 "Hill Run"],
  [/fartlek/i,              "Fartlek"],
  [/easy\s*run|easy\s*jog/i,"Easy Run"],
  [/recovery\s*run/i,       "Recovery Run"],
  // Strength subtypes
  [/full\s*body/i,          "Full Body"],
  [/upper\s*body/i,         "Upper Body"],
  [/lower\s*body/i,         "Lower Body"],
  // Recovery / mobility
  [/yoga/i,                 "Yoga"],
  [/mobility|stretch/i,     "Mobility"],
  // Soccer / team sport subtypes
  [/pre.?game|activation/i, "Pre-Game Activation"],
  [/small\s*sided|ssg/i,    "Small-Sided Games"],
  [/tactical|shape|positional/i, "Tactical Training"],
  [/technical|finishing|passing/i, "Technical Training"],
  [/possession/i,           "Possession Play"],
  [/set\s*piece/i,          "Set Pieces"],
  [/pressing|press/i,       "High Press Drills"],
  [/conditioning/i,         "Conditioning"],
  [/walkthrough/i,          "Walkthrough"],
];

function detectSubtype(text: string): string | undefined {
  for (const [re, label] of SUBTYPE_MAP) {
    if (re.test(text)) return label;
  }
  return undefined;
}

function parseDurationFromLine(text: string): number {
  const m = text.match(/(\d+)\s*h(?:our)?s?\s*(\d+)?\s*m?i?n?/i);
  if (m) return clampInt(parseInt(m[1]) * 60 + parseInt(m[2] ?? "0"));

  const h = text.match(/(\d+)\s*h(?:our)?s?(?!\w)/i);
  if (h) return clampInt(parseInt(h[1]) * 60);

  const mn = text.match(/(\d+)\s*m(?:in(?:utes?)?)?(?!\w)/i);
  if (mn) return clampInt(parseInt(mn[1]));

  const colon = text.match(/(\d+):(\d{2})/);
  if (colon) return clampInt(parseInt(colon[1]) * 60 + parseInt(colon[2]));

  return 0;
}

function parseDistanceFromLine(text: string): { distance: number; unit: "mi" | "km" } | undefined {
  const m = text.match(/(\d+\.?\d*)\s*(miles?|km|mi(?!n)|k\b)/i);
  if (!m) return undefined;
  const val  = parseFloat(m[1]);
  const unit = /km|k\b/i.test(m[2]) ? "km" : "mi";
  // convert km to miles
  const miles = unit === "km" ? val * 0.621 : val;
  return { distance: parseFloat(miles.toFixed(2)), unit: "mi" };
}

function detectSportFromText(text: string): string {
  const t = text.toLowerCase();
  if (/swim|triathlon/i.test(t))      return "triathlon";
  if (/soccer|football/i.test(t))     return "soccer";
  if (/cycling|bike|criterium/i.test(t)) return "cycling";
  if (/lift|weightlift|powerlifting/i.test(t)) return "strength";
  if (/run|jog|marathon|5k|10k/i.test(t))  return "running";
  return "running";
}

function buildDayEntry(day: WeekDay, activityText: string): TrainingDay {
  const training_type = resolveTrainingType(activityText, "");
  const subtype       = detectSubtype(activityText);
  const dist          = parseDistanceFromLine(activityText);
  let   duration      = parseDurationFromLine(activityText);
  if (duration === 0 && training_type !== "off") {
    duration = defaultDuration(training_type, subtype ?? "");
  }
  const intensity = inferIntensity(training_type, subtype ?? activityText);
  return {
    day,
    training_type,
    duration,
    intensity,
    ...(subtype ? { subtype }                                      : {}),
    ...(dist    ? { distance: dist.distance, distanceUnit: dist.unit } : {}),
  };
}

function regexParsePlan(text: string): TrainingDay[] {
  const found = new Map<WeekDay, TrainingDay>();

  // ── Strategy A: split on day-name boundaries ──────────────────────────────
  // Handles both "one day per line" AND "all days on one long line" formats.
  // Split the entire text into segments at every day-name occurrence.
  // e.g. "Monday - Run 5mi Tuesday - Strength" → ["Monday - Run 5mi ", "Tuesday - Strength"]
  const DAY_GLOBAL = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/gi;
  const segments: Array<{ day: WeekDay; text: string }> = [];
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  let lastDay: WeekDay | null = null;

  while ((match = DAY_GLOBAL.exec(text)) !== null) {
    const day = DAY_MAP[match[1].toLowerCase()];
    if (!day) continue;
    if (lastDay !== null) {
      segments.push({ day: lastDay, text: text.slice(lastIndex, match.index) });
    }
    lastDay   = day;
    lastIndex = match.index + match[0].length;
  }
  if (lastDay !== null) {
    segments.push({ day: lastDay, text: text.slice(lastIndex) });
  }

  for (const { day, text: seg } of segments) {
    // Strip leading separators (-, –, :, whitespace) from the activity portion
    const activity = seg.replace(/^[\s\-–:\u2013\u2014]+/, "").trim();
    // If activity is empty, skip — Strategy B handles day-only lines
    if (!activity) continue;
    // BUG-FIX #10: allow a later segment to OVERRIDE an earlier one for the same
    // day, so duplicate day entries keep the last (most specific) occurrence.
    // Only skip if the existing entry was a genuine non-off parse.
    const existing = found.get(day);
    if (existing && existing.training_type !== "off") continue;
    found.set(day, buildDayEntry(day, activity));
  }

  // ── Strategy B: line-by-line peek-ahead ───────────────────────────────────
  // Catches formats where the day name is alone on one line and the activity
  // description is on the following line(s):
  //   "Monday"          "Monday:"
  //   "  Easy Run 5mi"  "  Strength 45 min"
  if (found.size < 4) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      const dayMatch = lines[i].match(DAY_PATTERN);
      if (!dayMatch) continue;
      const day = DAY_MAP[dayMatch[1].toLowerCase()];
      if (!day || found.has(day)) continue;

      // Activity text: everything on this line after the day name, OR the next line
      const inline = lines[i]
        .slice(dayMatch.index! + dayMatch[1].length)
        .replace(/^[\s\-–:\u2013\u2014]+/, "")
        .trim();

      let activity = inline;
      if (!activity && i + 1 < lines.length && !DAY_PATTERN.test(lines[i + 1])) {
        // Next line doesn't start a new day — use it as the activity
        activity = lines[i + 1];
      }

      if (!activity) continue;
      found.set(day, buildDayEntry(day, activity));
    }
  }

  // BUG-FIX #12: sort by calendar order before returning — Map preserves insertion
  // order which is arbitrary (depends on which strategy found each day first).
  return Array.from(found.values()).sort(
    (a, b) => WEEK_DAYS.indexOf(a.day) - WEEK_DAYS.indexOf(b.day)
  );
}

// ─── POST handler ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // ── Step 1: Parse form data ──────────────────────────────────────────────
  let formData: FormData;
  try { formData = await req.formData(); }
  catch {
    return NextResponse.json({ error: "Invalid multipart form data." }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  // ── Step 2: Extract text from PDF or CSV ────────────────────────────────
  const fileName = file.name.toLowerCase();
  const mimeType = file.type;
  let rawText = "";

  if (fileName.endsWith(".csv") || mimeType.includes("csv") || mimeType.includes("text/plain")) {
    rawText = await file.text();
    console.log("[upload] CSV/text length:", rawText.length);

  } else if (fileName.endsWith(".pdf") || mimeType.includes("pdf")) {
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      rawText = await extractPDFText(buffer);
    } catch (err) {
      console.error("[upload] PDF extraction error:", err instanceof Error ? err.message : err);
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

  // ── Step 3: Clean and validate extracted text ────────────────────────────
  rawText = cleanText(rawText);
  console.log("[upload] Extracted text preview:\n", rawText.slice(0, 600));

  if (rawText.trim().length < 20) {
    return NextResponse.json(
      { error: "Unable to read PDF content. Make sure it is a text-based PDF, not a scanned image." },
      { status: 422 }
    );
  }

  // ── Step 4: Regex parse (no API key needed) ──────────────────────────────
  const regexDays  = regexParsePlan(rawText);
  const activeDays = regexDays.filter(d => d.training_type !== "off").length;
  console.log("[regex] Found", regexDays.length, "days,", activeDays, "active");

  let sport  = detectSportFromText(rawText);
  let allDays: TrainingDay[];

  // If regex found a solid plan (≥4 active days), use it directly — no API key needed
  if (activeDays >= 4) {
    console.log("[regex] Good plan — skipping Claude");
    allDays = fillMissingDays(regexDays);

  } else {
    // ── Step 5: Claude fallback (better accuracy for unusual formats) ──────
    console.log("[regex] Weak result — trying Claude");

    if (!process.env.ANTHROPIC_API_KEY) {
      // Return whatever regex found, even if partial
      if (regexDays.length > 0) {
        console.log("[regex] No API key — returning partial regex result");
        allDays = fillMissingDays(regexDays);
      } else {
        return NextResponse.json(
          { error: "Could not parse the training plan. Make sure each day is on its own line (e.g. 'Monday - Easy Run 5 miles')." },
          { status: 422 }
        );
      }
    } else {
      // Claude available — use it for the full parse
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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
        // Fall back to regex result if Claude fails
        if (regexDays.length > 0) {
          allDays = fillMissingDays(regexDays);
          console.log("[fallback] Using regex result after Claude failure");
          return finalResponse(sport, allDays);
        }
        return NextResponse.json(
          { error: "Unable to parse training plan. Please try again." },
          { status: 502 }
        );
      }

      try {
        const parsed   = extractClaudeJSON(claudeRaw);
        const rawItems = parsed.schedule ?? parsed.rawArray ?? [];
        sport          = normaliseSport(parsed.sport) || sport;
        const validDays = rawItems
          .map(validateEntry)
          .filter((d): d is TrainingDay => d !== null);

        if (validDays.length === 0) throw new Error("No valid days from Claude");
        allDays = fillMissingDays(validDays);
        console.log("[claude] sport:", sport, "| days:", allDays.length);
      } catch (err) {
        console.error("[claude] Parse error:", err);
        // Fall back to regex if Claude response was unparseable
        if (regexDays.length > 0) {
          allDays = fillMissingDays(regexDays);
          console.log("[fallback] Using regex result after Claude parse error");
        } else {
          return NextResponse.json(
            { error: "Unable to parse training plan. Try a simpler format or paste the text manually." },
            { status: 422 }
          );
        }
      }
    }
  }

  return finalResponse(sport, allDays);
}

async function finalResponse(sport: string, allDays: TrainingDay[]): Promise<NextResponse> {
  // Log sample
  allDays.slice(0, 3).forEach(d =>
    console.log(`  ${d.day}: ${d.training_type} | ${d.intensity} | ${d.duration}min${d.distance ? ` | ${d.distance}mi` : ""}`)
  );

  // Persist to Supabase (no-ops when not configured)
  await upsertTrainingPlan({
    user_id:    null,
    sport,
    schedule:   allDays,
    created_at: new Date().toISOString(),
  });

  return NextResponse.json({ success: true, plan: { sport, days: allDays } });
}
