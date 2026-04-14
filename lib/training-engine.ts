/**
 * Training Plan Engine
 *
 * Parses free-text training schedules into structured weekly plans.
 * Handles formats like:
 *   "Monday - Strength 90min"
 *   "Tue: Practice (60 minutes)"
 *   "Wed: Off"
 *   "Thursday — Game night"
 *   "Friday - Run 15 miles"
 *   "Saturday – Bike 1h high"
 */

import { format, addDays } from "date-fns";
import type { TrainingDay, TrainingPlan, TrainingType, IntensityLevel, WeekDay } from "./types";

// ─── Day name normalisation ───────────────────────────────────────────────────

const DAY_MAP: Record<string, WeekDay> = {
  mon: "Monday", monday: "Monday",
  tue: "Tuesday", tues: "Tuesday", tuesday: "Tuesday",
  wed: "Wednesday", weds: "Wednesday", wednesday: "Wednesday",
  thu: "Thursday", thur: "Thursday", thurs: "Thursday", thursday: "Thursday",
  fri: "Friday", friday: "Friday",
  sat: "Saturday", saturday: "Saturday",
  sun: "Sunday", sunday: "Sunday",
};

const ORDERED_DAYS: WeekDay[] = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
];

// ─── Training type detection ──────────────────────────────────────────────────

/**
 * TYPE_KEYWORDS ordering matters — first match wins.
 * "cardio" must appear BEFORE "recovery" so that "easy run" is recognised as
 * cardio rather than recovery (recovery has "easy" in its keyword list).
 */
const TYPE_KEYWORDS: Array<{ type: TrainingType; keywords: string[] }> = [
  { type: "game",
    keywords: ["game", "match", "competition", "tournament", "meet", "race"] },
  // cardio: run/bike/swim/row/walk/hike, generic "cardio", and common run subtypes
  { type: "cardio",
    keywords: ["run", "runs", "running", "jog", "jogging",
               "bike", "biking", "cycle", "cycling",
               "swim", "swimming",
               "row", "rowing",
               "walk", "walking",
               "hike", "hiking",
               "cardio",
               // run subtypes — allow planToText output to roundtrip correctly
               "tempo", "intervals", "fartlek", "long run", "easy run",
               "progression run", "hills"] },
  { type: "practice",
    keywords: ["practice", "drill", "skill", "team", "session", "training"] },
  { type: "strength",
    keywords: ["strength", "lift", "weights", "gym", "squat", "bench", "deadlift", "resistance",
               "upper body", "lower body", "full body", "power", "core"] },
  { type: "recovery",
    keywords: ["recovery", "rest", "easy", "light", "yoga", "stretch", "mobility", "active recovery"] },
  { type: "off",
    keywords: ["off", "rest day", "no training", "none", "—", "-"] },
];

function detectTrainingType(line: string): TrainingType {
  const lower = line.toLowerCase();
  for (const { type, keywords } of TYPE_KEYWORDS) {
    if (keywords.some((k) => lower.includes(k))) return type;
  }
  return "off";
}

// ─── Duration extraction ──────────────────────────────────────────────────────

function extractDuration(line: string): number {
  // "90min", "90 min", "1.5h", "1h30", "60 minutes"
  const hourMin = line.match(/(\d+)h\s*(\d+)/i);
  if (hourMin) return parseInt(hourMin[1]) * 60 + parseInt(hourMin[2]);

  const hours = line.match(/(\d+(?:\.\d+)?)\s*h(?:ours?)?(?!\w)/i);
  if (hours) return Math.round(parseFloat(hours[1]) * 60);

  const mins = line.match(/(\d+)\s*min(?:utes?)?/i);
  if (mins) return parseInt(mins[1]);

  return 0; // caller applies default
}

const DEFAULT_DURATION: Record<TrainingType, number> = {
  strength: 60,
  practice: 90,
  game:     120,
  cardio:   45,
  recovery: 30,
  off:      0,
};

// ─── Intensity inference ──────────────────────────────────────────────────────

function inferIntensity(type: TrainingType, line: string): IntensityLevel {
  const lower = line.toLowerCase();
  // High intensity markers
  if (
    lower.includes("high")     ||
    lower.includes("heavy")    ||
    lower.includes("hard")     ||
    lower.includes("max")      ||
    lower.includes("interval") ||
    lower.includes("sprint")   ||
    lower.includes("race")
  ) return "high";
  // Moderate — tempo sits between easy and max effort
  if (lower.includes("tempo") || lower.includes("threshold") || lower.includes("fartlek")) return "moderate";
  // Low intensity markers
  if (
    lower.includes("low")      ||
    lower.includes("easy")     ||
    lower.includes("light")    ||
    lower.includes("recovery") ||
    lower.includes("jog")      ||
    lower.includes("long run")  // long runs are typically easy/moderate pace
  ) return "low";
  if (type === "game")                       return "high";
  if (type === "recovery" || type === "off") return "low";
  return "moderate";
}

// ─── Cardio activity + distance extraction ────────────────────────────────────

/**
 * Maps keyword patterns to a canonical activity label.
 * The label is stored in TrainingDay.notes so the schedule can display
 * "Run · 15 mi" rather than just the generic "Cardio" badge.
 */
const CARDIO_ACTIVITY_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:run|runs|running)\b/i,        "Run"],
  [/\b(?:jog|jogging)\b/i,             "Run"],   // jog → "Run" label
  [/\b(?:bike|biking|cycling?|cycle)\b/i, "Bike"],
  [/\b(?:swim|swimming)\b/i,           "Swim"],
  [/\b(?:row|rowing)\b/i,              "Row"],
  [/\b(?:walk|walking)\b/i,            "Walk"],
  [/\b(?:hike|hiking)\b/i,             "Hike"],
];

function extractCardioActivity(rest: string): string | null {
  for (const [pattern, label] of CARDIO_ACTIVITY_PATTERNS) {
    if (pattern.test(rest)) return label;
  }
  return null; // generic "cardio" keyword, no specific activity
}

/**
 * Extract a distance notation and return it in normalised form.
 * Returns null when no distance is present (time-based workout).
 *
 * Recognised formats:
 *   "15 miles", "5 mile", "5k", "10km", "half marathon", "marathon"
 */
function extractDistance(rest: string): string | null {
  // "15 miles", "15 mile", "15 mi" — but NOT "15 min" (the (?!\w) guard stops "min")
  const miles = rest.match(/(\d+(?:\.\d+)?)\s*mi(?:les?)?(?!\w)/i);
  if (miles) return `${miles[1]} mi`;

  const km = rest.match(/(\d+(?:\.\d+)?)\s*k(?:m|ilometers?)?(?!\w)/i);
  if (km) return `${km[1]} km`;

  if (/half[\s-]?marathon/i.test(rest)) return "13.1 mi";
  if (/\bmarathon\b/i.test(rest))       return "26.2 mi";

  return null;
}

/**
 * Build the notes string for a cardio entry.
 *
 * Format:
 *   activity only    → "Run"
 *   activity+distance → "Run 15 mi"
 *   distance only    → "15 mi"   (generic "cardio" keyword)
 *
 * The notes string is designed to roundtrip through planToText → parseTrainingInput.
 */
function buildCardioNotes(rest: string): string | undefined {
  const activity = extractCardioActivity(rest);
  const distance = extractDistance(rest);

  if (activity && distance) return `${activity} ${distance}`;
  if (activity)             return activity;
  if (distance)             return distance;
  return undefined; // pure "cardio" keyword, no extra context
}

// ─── Structured distance extraction ──────────────────────────────────────────

/** Returns a numeric distance and its unit, or null for time-based sessions. */
function extractDistanceNumeric(
  text: string
): { distance: number; distanceUnit: "mi" | "km" } | null {
  const miles = text.match(/(\d+(?:\.\d+)?)\s*mi(?:les?)?(?!\w)/i);
  if (miles) return { distance: parseFloat(miles[1]), distanceUnit: "mi" };

  const km = text.match(/(\d+(?:\.\d+)?)\s*k(?:m|ilometers?)?(?!\w)/i);
  if (km) return { distance: parseFloat(km[1]), distanceUnit: "km" };

  if (/half[\s-]?marathon/i.test(text)) return { distance: 13.1, distanceUnit: "mi" };
  if (/\bmarathon\b/i.test(text))       return { distance: 26.2, distanceUnit: "mi" };

  return null;
}

// ─── Subtype inference ────────────────────────────────────────────────────────

/**
 * Infers a human-readable sub-classification within the training type.
 *
 * Examples:
 *   cardio + "tempo run 45min"   → "Tempo Run"
 *   cardio + "long run 15 mi"    → "Long Run"
 *   cardio + "easy jog"          → "Easy Run"
 *   cardio + "interval 800s"     → "Intervals"
 *   cardio + "bike 1h"           → "Bike"
 *   strength + "upper body"      → "Upper Body"
 *   strength + "lower body 45"   → "Lower Body"
 *   recovery + "yoga"            → "Yoga"
 *   recovery + "active recovery" → "Active Recovery"
 */
function inferSubtype(type: TrainingType, line: string): string | undefined {
  switch (type) {
    case "cardio": {
      // Check variant first, then fall back to activity label
      if (/\bintervals?\b|\b800s?\b|\b400s?\b|\brepeat/i.test(line))   return "Intervals";
      if (/\btempo\b|\bthreshold\b/i.test(line))                        return "Tempo Run";
      if (/\blong\s*run\b/i.test(line))                                 return "Long Run";
      if (/\bprogression\b/i.test(line))                                return "Progression Run";
      if (/\bfartlek\b/i.test(line))                                    return "Fartlek";
      if (/\bhills?\b/i.test(line))                                     return "Hill Run";
      if (/\beasy\s*run\b|\brecovery\s*run\b/i.test(line))             return "Easy Run";
      if (/\beasy\b|\bjog\b/i.test(line))                               return "Easy Run";
      // Activity-level subtypes when no variant found
      const activity = extractCardioActivity(line);
      return activity ?? undefined; // "Run", "Bike", "Swim", "Row", "Walk", "Hike"
    }

    case "strength": {
      if (/\bfull[\s-]?body\b/i.test(line))                            return "Full Body";
      if (/\bupper[\s-]?body\b|\bupper\b/i.test(line))                 return "Upper Body";
      if (/\blower[\s-]?body\b|\blower\b|\blegs?\b/i.test(line))       return "Lower Body";
      if (/\bpower\b|\bolympic\b|\bclean\b|\bsnatch\b/i.test(line))    return "Power";
      if (/\bcore\b|\babs?\b/i.test(line))                             return "Core";
      if (/\bpull[\s-]?day\b/i.test(line))                             return "Pull Day";
      if (/\bpush[\s-]?day\b/i.test(line))                             return "Push Day";
      return undefined;
    }

    case "practice": {
      if (/\bscrimmage\b/i.test(line))                                  return "Scrimmage";
      if (/\bdrills?\b/i.test(line))                                    return "Drills";
      if (/\bskill\b/i.test(line))                                      return "Skill Work";
      if (/\btactics?\b|\bfilm\b/i.test(line))                          return "Tactics";
      return undefined;
    }

    case "recovery": {
      if (/\byoga\b/i.test(line))                                       return "Yoga";
      if (/\bactive\s*recovery\b/i.test(line))                         return "Active Recovery";
      if (/\bmobilit/i.test(line))                                      return "Mobility";
      if (/\bstretch/i.test(line))                                      return "Stretching";
      if (/\bwalk\b/i.test(line))                                       return "Walk";
      if (/\bswim\b/i.test(line))                                       return "Easy Swim";
      return undefined;
    }

    case "game": {
      if (/\bscrimmage\b/i.test(line))                                  return "Scrimmage";
      if (/\btournament\b/i.test(line))                                 return "Tournament";
      if (/\brace\b|\bmeet\b/i.test(line))                             return "Race";
      return undefined;
    }

    default:
      return undefined;
  }
}

// ─── Line parser ─────────────────────────────────────────────────────────────

function parseLine(line: string): { day: WeekDay; entry: Omit<TrainingDay, "day"> } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Extract day: starts the line, followed by whitespace, colon, dash, or em-dash
  const dayMatch = trimmed.match(/^([a-zA-Z]{3,9})\s*[:\-–—]\s*/i);
  if (!dayMatch) return null;

  const dayKey = dayMatch[1].toLowerCase();
  const day = DAY_MAP[dayKey];
  if (!day) return null;

  const rest           = trimmed.slice(dayMatch[0].length);
  const training_type  = detectTrainingType(rest);
  const rawDuration    = extractDuration(rest);
  const duration       = rawDuration > 0 ? rawDuration : DEFAULT_DURATION[training_type];
  const intensity      = inferIntensity(training_type, rest);

  // Structured fields
  const subtype        = inferSubtype(training_type, rest);
  const distResult     = extractDistanceNumeric(rest);

  // Legacy notes: only set for cardio; captures activity label + distance string
  const notes = training_type === "cardio" ? buildCardioNotes(rest) : undefined;

  return {
    day,
    entry: {
      training_type,
      duration,
      intensity,
      ...(notes     !== undefined ? { notes }                          : {}),
      ...(subtype   !== undefined ? { subtype }                        : {}),
      ...(distResult !== null     ? {
        distance:     distResult.distance,
        distanceUnit: distResult.distanceUnit,
      } : {}),
    },
  };
}

// ─── Main parser ─────────────────────────────────────────────────────────────

export function parseTrainingInput(
  rawInput: string,
  existingPlan?: TrainingPlan | null,
): TrainingPlan {
  const lines  = rawInput.split(/\r?\n/);
  const parsed = new Map<WeekDay, Omit<TrainingDay, "day">>();

  for (const line of lines) {
    const result = parseLine(line);
    if (result) parsed.set(result.day, result.entry);
  }

  // If updating an existing plan, seed base with all existing days so that
  // days omitted from the new input are preserved.
  const base = new Map<WeekDay, Omit<TrainingDay, "day">>();
  if (existingPlan) {
    for (const d of existingPlan.weeklySchedule) {
      base.set(d.day, {
        training_type: d.training_type,
        duration:      d.duration,
        intensity:     d.intensity,
        ...(d.notes        !== undefined ? { notes:        d.notes        } : {}),
        ...(d.subtype      !== undefined ? { subtype:      d.subtype      } : {}),
        ...(d.distance     !== undefined ? { distance:     d.distance     } : {}),
        ...(d.distanceUnit !== undefined ? { distanceUnit: d.distanceUnit } : {}),
      });
    }
  }

  // Merge: new input fully overrides each day it mentions (notes included).
  for (const [day, entry] of Array.from(parsed)) base.set(day, entry);

  // Fill any days not covered by input or existing plan as "off".
  const weeklySchedule: TrainingDay[] = ORDERED_DAYS.map((day) => {
    const entry = base.get(day) ?? {
      training_type: "off" as TrainingType,
      duration:      0,
      intensity:     "low" as IntensityLevel,
    };
    return { day, ...entry };
  });

  const now = new Date().toISOString();
  return {
    id:             existingPlan?.id ?? crypto.randomUUID(),
    name:           "Weekly Training Plan",
    rawInput,
    weeklySchedule,
    createdAt:      existingPlan?.createdAt ?? now,
    updatedAt:      now,
  };
}

// ─── Plan → text serialiser ───────────────────────────────────────────────────

/**
 * Regenerate a human-readable text representation from a plan's weeklySchedule.
 *
 * Used to seed the PlanEditor with the *full*, merged schedule every time the
 * user opens the editor, keeping the textarea in sync with the Full Schedule.
 *
 * Cardio lines use the notes field (activity + optional distance) to reconstruct
 * their original form:
 *   notes="Run 15 mi"  → "Wednesday - Run 15 mi"
 *   notes="Run"        → "Wednesday - Run 45min"
 *   notes=undefined    → "Wednesday - Cardio 45min"
 *
 * This roundtrips cleanly: planToText output → parseTrainingInput → same plan.
 */
export function planToText(plan: TrainingPlan): string {
  return plan.weeklySchedule
    .map((d) => {
      if (d.training_type === "off") return `${d.day} - Off`;

      // ── Cardio ─────────────────────────────────────────────────────────────
      if (d.training_type === "cardio") {
        // Build the display label: prefer structured subtype, fall back to notes
        const label = d.subtype ?? (d.notes ? d.notes.split(" ")[0] : null) ?? "Cardio";

        // Distance takes precedence over duration for distance-based workouts
        if (d.distance !== undefined) {
          const unit = d.distanceUnit ?? "mi";
          return `${d.day} - ${label} ${d.distance} ${unit}`;
        }

        // Time-based cardio — include subtype keyword so it roundtrips correctly
        const durStr = d.duration > 0 ? ` ${formatDuration(d.duration)}` : "";
        return `${d.day} - ${label}${durStr}`;
      }

      // ── Non-cardio ─────────────────────────────────────────────────────────
      const typeLabel = d.subtype ?? TYPE_LABEL[d.training_type];
      const durStr    = d.duration > 0 ? ` ${formatDuration(d.duration)}` : "";
      // Emit intensity tag only when it deviates from the default for that type
      const defaultIntensity: IntensityLevel =
        d.training_type === "game"     ? "high" :
        d.training_type === "recovery" ? "low"  : "moderate";
      const intStr =
        d.intensity !== defaultIntensity
          ? (d.intensity === "high" ? " high" : d.intensity === "low" ? " low" : "")
          : "";
      return `${d.day} - ${typeLabel}${durStr}${intStr}`;
    })
    .join("\n");
}

// ─── Today / tomorrow helpers ─────────────────────────────────────────────────

export function getTodayDay(): WeekDay {
  return format(new Date(), "EEEE") as WeekDay;
}

export function getTomorrowDay(): WeekDay {
  return format(addDays(new Date(), 1), "EEEE") as WeekDay;
}

export function getDayPlan(plan: TrainingPlan, day: WeekDay): TrainingDay | undefined {
  return plan.weeklySchedule.find((d) => d.day === day);
}

// ─── UI helpers ──────────────────────────────────────────────────────────────

export const TYPE_COLOR: Record<TrainingType, string> = {
  strength: "#F59E0B",  // gold
  practice: "#3B82F6",  // blue
  game:     "#EF4444",  // red
  recovery: "#22C55E",  // green
  cardio:   "#8B5CF6",  // violet
  off:      "#4B5563",  // muted
};

export const TYPE_LABEL: Record<TrainingType, string> = {
  strength: "Strength",
  practice: "Practice",
  game:     "Game",
  recovery: "Recovery",
  cardio:   "Cardio",
  off:      "Off",
};

export const INTENSITY_LABEL: Record<IntensityLevel, string> = {
  low:      "Low Intensity",
  moderate: "Moderate",
  high:     "High Intensity",
};

export function formatDuration(minutes: number): string {
  if (minutes === 0) return "—";
  if (minutes < 60)  return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}
