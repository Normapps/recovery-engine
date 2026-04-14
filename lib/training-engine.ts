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
  // cardio: run/bike/swim/row/walk/hike and generic "cardio" keyword
  { type: "cardio",
    keywords: ["run", "runs", "running", "jog", "jogging",
               "bike", "biking", "cycle", "cycling",
               "swim", "swimming",
               "row", "rowing",
               "walk", "walking",
               "hike", "hiking",
               "cardio"] },
  { type: "practice",
    keywords: ["practice", "drill", "skill", "team", "session", "training"] },
  { type: "strength",
    keywords: ["strength", "lift", "weights", "gym", "squat", "bench", "deadlift", "resistance"] },
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
  if (lower.includes("high") || lower.includes("heavy") || lower.includes("hard") || lower.includes("max") || lower.includes("tempo") || lower.includes("interval")) return "high";
  if (lower.includes("low")  || lower.includes("easy")  || lower.includes("light") || lower.includes("recovery") || lower.includes("jog")) return "low";
  if (type === "game") return "high";
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

  // Build notes: only set for cardio entries; captures activity label + distance
  const notes = training_type === "cardio" ? buildCardioNotes(rest) : undefined;

  return {
    day,
    entry: {
      training_type,
      duration,
      intensity,
      ...(notes !== undefined ? { notes } : {}),
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
      // Preserve notes (activity/distance) from the existing plan so they
      // are not silently dropped when the user re-saves without retyping them.
      base.set(d.day, {
        training_type: d.training_type,
        duration:      d.duration,
        intensity:     d.intensity,
        ...(d.notes !== undefined ? { notes: d.notes } : {}),
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

      if (d.training_type === "cardio") {
        if (d.notes) {
          // notes already contains the activity label (and optional distance).
          // Include duration only when the notes are purely a label (no digits),
          // i.e., distance-based workouts don't append a redundant "45min".
          const notesHasQuantity = /\d/.test(d.notes);
          const durStr = (!notesHasQuantity && d.duration > 0)
            ? ` ${formatDuration(d.duration)}`
            : "";
          return `${d.day} - ${d.notes}${durStr}`;
        }
        // Generic cardio with no specific activity — output type label + duration
        const durStr = d.duration > 0 ? ` ${formatDuration(d.duration)}` : "";
        return `${d.day} - Cardio${durStr}`;
      }

      const durStr = d.duration > 0 ? ` ${formatDuration(d.duration)}` : "";
      const intStr =
        d.intensity === "high" ? " high" :
        d.intensity === "low"  ? " low"  : "";
      return `${d.day} - ${TYPE_LABEL[d.training_type]}${durStr}${intStr}`;
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
