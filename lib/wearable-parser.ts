/**
 * Wearable Device Data Parser
 *
 * Parses exported data from:
 *   - Garmin Connect (Health Stats CSV, Sleep CSV, Activities CSV)
 *   - WHOOP (Recovery + Sleep CSV)
 *   - Oura Ring (Activity + Sleep + Readiness JSON/CSV)
 *   - Apple Health (export.xml or summary CSV)
 *
 * Returns an array of ParsedWearableDay objects, one per calendar day,
 * which can be mapped to DailyEntry/SleepData/TrainingData fields.
 */

import type { SleepData, TrainingData } from "./types";

// ─── Output types ─────────────────────────────────────────────────────────

export type WearableSource = "garmin" | "whoop" | "oura" | "apple_health" | "unknown";

export interface ParsedWearableDay {
  date: string;              // YYYY-MM-DD
  source: WearableSource;
  sleep: Partial<SleepData>;
  training: Partial<TrainingData>;
  extras: {
    steps?: number;
    calories?: number;
    bodyBattery?: number;    // Garmin specific
    recoveryScore?: number;  // WHOOP / Oura readiness
    respiratoryRate?: number;
    spO2?: number;
    stressScore?: number;
    strainScore?: number;    // WHOOP strain
    activeCalories?: number;
    vo2max?: number;
  };
}

export interface WearableParseResult {
  source: WearableSource;
  days: ParsedWearableDay[];
  errors: string[];
  rawHeaders?: string[];
}

// ─── Format detection ──────────────────────────────────────────────────────

export function detectWearableFormat(filename: string, content: string): WearableSource {
  const lower = filename.toLowerCase();

  // Garmin
  if (lower.includes("garmin") || lower.includes("activities.csv")) return "garmin";
  if (content.includes("Body Battery") || content.includes("Avg Overnight HRV")) return "garmin";
  if (content.includes("Avg Stress") && content.includes("Sleep Score")) return "garmin";

  // WHOOP
  if (lower.includes("whoop") || lower.includes("journal.csv")) return "whoop";
  if (content.includes("Recovery score %") || content.includes("HRV resting")) return "whoop";
  if (content.includes("Cycle start time") && content.includes("Strain")) return "whoop";

  // Oura
  if (lower.includes("oura") || lower.includes("readiness.csv")) return "oura";
  if (content.includes("readiness_score") || content.includes("Readiness Score")) return "oura";

  // Apple Health
  if (lower.includes("apple") || lower.includes("export.xml")) return "apple_health";
  if (content.startsWith("<?xml") && content.includes("HealthData")) return "apple_health";

  return "unknown";
}

// ─── CSV helper ────────────────────────────────────────────────────────────

function parseCSVLines(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = lines[0].split(",").map((h) => h.trim().replace(/^["']|["']$/g, ""));
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = splitCSVLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (parts[idx] ?? "").trim().replace(/^["']|["']$/g, "");
    });
    rows.push(row);
  }

  return { headers, rows };
}

function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === "," && !inQuotes) { result.push(current); current = ""; continue; }
    current += ch;
  }
  result.push(current);
  return result;
}

function toDate(raw: string): string | null {
  if (!raw) return null;
  // Try YYYY-MM-DD first
  const iso = raw.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  // MM/DD/YYYY
  const mdy = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  return null;
}

function num(v: string | undefined): number | null {
  if (!v || v === "" || v === "--" || v === "N/A") return null;
  const n = parseFloat(v.replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? null : n;
}

function bool(v: string | undefined): boolean {
  return !!v && v.toLowerCase() !== "false" && v !== "0" && v !== "";
}

// ─── WHOOP parser ─────────────────────────────────────────────────────────

/**
 * WHOOP exports two main CSVs:
 *   journal.csv — recovery + strain per cycle
 *   sleep_data.csv — sleep staging per cycle
 *
 * Key columns (journal.csv):
 *   Cycle start time, Recovery score %, Resting heart rate, HRV resting,
 *   Skin temp, Blood oxygen %, Day Strain, Kilojoules, Sleep performance %,
 *   Respiratory rate
 */
function parseWHOOP(content: string): WearableParseResult {
  const { headers, rows } = parseCSVLines(content);
  const days: ParsedWearableDay[] = [];
  const errors: string[] = [];

  // detect column names (WHOOP has changed their CSV headers over versions)
  const findCol = (...candidates: string[]) =>
    candidates.find((c) => headers.includes(c)) ?? candidates[0];

  const dateCol = findCol("Cycle start time", "Date");
  const recoveryCol = findCol("Recovery score %", "Recovery Score %", "Recovery score");
  const rhrCol = findCol("Resting heart rate", "Resting Heart Rate");
  const hrvCol = findCol("HRV resting", "HRV Resting", "Heart Rate Variability (ms)");
  const strainCol = findCol("Day Strain", "Strain");
  const sleepPerfCol = findCol("Sleep performance %", "Sleep Performance %");
  const respRateCol = findCol("Respiratory rate", "Respiratory Rate");
  const spo2Col = findCol("Blood oxygen %", "SpO2 %");
  const kjCol = findCol("Kilojoules", "Energy burned (kJ)");

  // Sleep-specific columns
  const asleepDurCol = findCol("Asleep duration (min)", "Asleep duration", "Sleep duration (min)");
  const inBedCol = findCol("In bed duration (min)", "In bed duration");

  for (const row of rows) {
    const rawDate = row[dateCol] ?? "";
    const date = toDate(rawDate);
    if (!date) { errors.push(`Skipping row with unrecognizable date: ${rawDate}`); continue; }

    const hrvVal = num(row[hrvCol]);
    const rhrVal = num(row[rhrCol]);
    const recoveryVal = num(row[recoveryCol]);
    const strainVal = num(row[strainCol]);
    const sleepMin = num(row[asleepDurCol]);
    const sleepHrs = sleepMin !== null ? Math.round((sleepMin / 60) * 10) / 10 : null;

    // WHOOP strain 0–21 scale; map to training flags
    const hasTraining = strainVal !== null && strainVal > 10;
    const highStrain = strainVal !== null && strainVal > 16;

    days.push({
      date,
      source: "whoop",
      sleep: {
        hrv: hrvVal,
        restingHR: rhrVal,
        duration: sleepHrs,
        // WHOOP doesn't give a 1–5 quality; map sleep performance % to 1–5
        qualityRating: recoveryVal !== null ? Math.max(1, Math.min(5, Math.round(recoveryVal / 20))) : null,
        bodyBattery: recoveryVal,
      },
      training: {
        cardio: hasTraining,
        cardioDuration: hasTraining ? Math.round((strainVal! - 10) * 10) : null,
        strengthTraining: highStrain,
        strengthDuration: null,
        coreWork: false,
        mobility: false,
      },
      extras: {
        recoveryScore: recoveryVal ?? undefined,
        strainScore: strainVal ?? undefined,
        respiratoryRate: num(row[respRateCol]) ?? undefined,
        spO2: num(row[spo2Col]) ?? undefined,
        calories: kjCol ? Math.round((num(row[kjCol]) ?? 0) * 0.239) : undefined,
      },
    });
  }

  return { source: "whoop", days, errors, rawHeaders: headers };
}

// ─── Garmin parser ─────────────────────────────────────────────────────────

/**
 * Garmin Health Stats CSV (from Garmin Connect → Export → Health Stats)
 * Columns vary by export type; we handle the common "Activities" export,
 * "Sleep" export, and consolidated "Summary" export.
 *
 * Common columns: Date, Steps, Avg Overnight HRV, Resting HR, Stress,
 *   Body Battery Charged, Body Battery Drained, Total Sleep, Sleep Score,
 *   Avg Respiration Rate, SpO2 Average, VO2 Max
 */
function parseGarmin(content: string): WearableParseResult {
  const { headers, rows } = parseCSVLines(content);
  const days: ParsedWearableDay[] = [];
  const errors: string[] = [];

  // Detect if this is a sleep-specific export or activity-specific export
  const isSleepExport = headers.some((h) => h.includes("Sleep") || h.includes("Deep") || h.includes("REM"));
  const isActivityExport = headers.some((h) => h.includes("Activity Type") || h.includes("Distance"));

  const findCol = (...candidates: string[]) =>
    candidates.find((c) => headers.some((h) => h.toLowerCase() === c.toLowerCase())) ??
    headers.find((h) => candidates.some((c) => h.toLowerCase().includes(c.toLowerCase()))) ??
    candidates[0];

  const dateCol = findCol("Date", "Start Time", "Timestamp");
  const stepsCol = findCol("Steps", "Total Steps");
  const hrvCol = findCol("Avg Overnight HRV", "HRV Status", "Overnight HRV");
  const rhrCol = findCol("Resting HR", "Min HR", "Avg RHR");
  const bodyBatteryCol = findCol("Body Battery Charged", "Max Body Battery", "Body Battery");
  const sleepScoreCol = findCol("Sleep Score", "Sleep Quality");
  const sleepDurCol = findCol("Total Sleep", "Sleep Duration", "Asleep (seconds)", "Asleep (min)");
  const stressCol = findCol("Avg Stress", "Stress Level");
  const respRateCol = findCol("Avg Respiration Rate", "Avg Respiration", "Respiration Rate");
  const spo2Col = findCol("SpO2 Average", "Avg SpO2", "Pulse Ox");
  const vo2Col = findCol("VO2 Max", "Vo2Max");
  const caloriesCol = findCol("Calories", "Total Calories", "Active Calories");
  const activityTypeCol = findCol("Activity Type");
  const durationCol = findCol("Time", "Duration", "Elapsed Time");

  if (isActivityExport) {
    // Group activities by date
    const byDate: Record<string, typeof rows> = {};
    for (const row of rows) {
      const date = toDate(row[dateCol] ?? "");
      if (!date) continue;
      if (!byDate[date]) byDate[date] = [];
      byDate[date].push(row);
    }

    for (const [date, activities] of Object.entries(byDate)) {
      let hasStrength = false, hasCardio = false;
      let strengthDur: number | null = null, cardioDur: number | null = null;

      for (const act of activities) {
        const type = (act[activityTypeCol] ?? "").toLowerCase();
        const durStr = act[durationCol] ?? "";
        const dur = parseDuration(durStr);

        if (type.includes("strength") || type.includes("weight") || type.includes("lifting")) {
          hasStrength = true;
          strengthDur = (strengthDur ?? 0) + (dur ?? 0);
        } else if (type.includes("running") || type.includes("cycling") || type.includes("swim") ||
                   type.includes("cardio") || type.includes("walk") || type.includes("hiit") ||
                   type.includes("rowing") || type.includes("elliptical") || type.includes("stair")) {
          hasCardio = true;
          cardioDur = (cardioDur ?? 0) + (dur ?? 0);
        } else if (type.includes("yoga") || type.includes("stretch") || type.includes("mobility")) {
          // handled as mobility
        }
      }

      days.push({
        date, source: "garmin",
        sleep: {},
        training: {
          strengthTraining: hasStrength,
          strengthDuration: strengthDur,
          cardio: hasCardio,
          cardioDuration: cardioDur,
          coreWork: activities.some((a) => (a[activityTypeCol] ?? "").toLowerCase().includes("core")),
          mobility: activities.some((a) =>
            ["yoga", "stretch", "pilates", "mobility"].some((k) => (a[activityTypeCol] ?? "").toLowerCase().includes(k))
          ),
        },
        extras: {},
      });
    }
  } else {
    for (const row of rows) {
      const rawDate = row[dateCol] ?? "";
      const date = toDate(rawDate);
      if (!date) { errors.push(`Skipping unrecognizable date: ${rawDate}`); continue; }

      const sleepRaw = num(row[sleepDurCol]);
      // Garmin may export sleep in seconds, minutes, or h:mm
      let sleepHrs: number | null = null;
      if (sleepRaw !== null) {
        if (sleepRaw > 1000) sleepHrs = Math.round((sleepRaw / 3600) * 10) / 10; // seconds
        else if (sleepRaw > 20) sleepHrs = Math.round((sleepRaw / 60) * 10) / 10; // minutes
        else sleepHrs = sleepRaw; // already hours
      } else if (row[sleepDurCol]?.includes(":")) {
        sleepHrs = parseDuration(row[sleepDurCol] ?? "") ?? null;
      }

      const sleepScore = num(row[sleepScoreCol]);
      const qualityRating = sleepScore !== null ? Math.max(1, Math.min(5, Math.round(sleepScore / 20))) : null;
      const bb = num(row[bodyBatteryCol]);

      days.push({
        date, source: "garmin",
        sleep: {
          hrv: num(row[hrvCol]),
          restingHR: num(row[rhrCol]),
          duration: sleepHrs,
          qualityRating,
          bodyBattery: bb,
        },
        training: { strengthTraining: false, cardio: false, coreWork: false, mobility: false, strengthDuration: null, cardioDuration: null },
        extras: {
          steps: num(row[stepsCol]) ?? undefined,
          bodyBattery: bb ?? undefined,
          stressScore: num(row[stressCol]) ?? undefined,
          respiratoryRate: num(row[respRateCol]) ?? undefined,
          spO2: num(row[spo2Col]) ?? undefined,
          calories: num(row[caloriesCol]) ?? undefined,
          vo2max: num(row[vo2Col]) ?? undefined,
        },
      });
    }
  }

  return { source: "garmin", days, errors, rawHeaders: headers };
}

// ─── Oura parser ──────────────────────────────────────────────────────────

/**
 * Oura Ring exports: sleep.json, readiness.json, activity.json
 * or consolidated CSV exports. We handle both.
 *
 * JSON format:
 * { "sleep": [ { "summary_date": "2024-01-01", "score": 85, "duration": 28800,
 *                "rmssd": 65, "hr_lowest": 52, ... } ] }
 */
function parseOura(content: string): WearableParseResult {
  const days: ParsedWearableDay[] = [];
  const errors: string[] = [];

  // Try JSON first
  if (content.trim().startsWith("{") || content.trim().startsWith("[")) {
    try {
      const data = JSON.parse(content);

      // Oura API v2 / app export JSON
      const sleepArr: Record<string, unknown>[] = data.sleep ?? data.data ?? (Array.isArray(data) ? data : []);

      for (const entry of sleepArr) {
        const date = toDate(String(entry.summary_date ?? entry.day ?? entry.date ?? ""));
        if (!date) continue;

        const durationSec = num(String(entry.duration ?? entry.total_sleep_duration ?? ""));
        const durationHrs = durationSec !== null ? Math.round((durationSec / 3600) * 10) / 10 : null;
        const score = num(String(entry.score ?? entry.sleep_score ?? ""));
        const hrv = num(String(entry.rmssd ?? entry.average_hrv ?? ""));
        const rhr = num(String(entry.hr_lowest ?? entry.lowest_heart_rate ?? ""));

        days.push({
          date, source: "oura",
          sleep: {
            duration: durationHrs,
            hrv,
            restingHR: rhr,
            qualityRating: score !== null ? Math.max(1, Math.min(5, Math.round(score / 20))) : null,
            bodyBattery: null,
          },
          training: { strengthTraining: false, cardio: false, coreWork: false, mobility: false, strengthDuration: null, cardioDuration: null },
          extras: {
            recoveryScore: num(String(entry.readiness_score ?? "")) ?? undefined,
            respiratoryRate: num(String(entry.average_breath ?? entry.average_breathing_frequency ?? "")) ?? undefined,
            spO2: num(String(entry.average_spo2 ?? "")) ?? undefined,
          },
        });
      }

      return { source: "oura", days, errors };
    } catch (e) {
      errors.push("Failed to parse Oura JSON: " + String(e));
    }
  }

  // Fall back to CSV
  const { headers, rows } = parseCSVLines(content);
  const findCol = (...candidates: string[]) =>
    candidates.find((c) => headers.some((h) => h.toLowerCase().includes(c.toLowerCase()))) ?? candidates[0];

  const dateCol = findCol("date", "summary_date");
  const scoreCol = findCol("score", "sleep_score", "readiness_score");
  const durationCol = findCol("duration", "sleep_duration", "total_sleep");
  const hrvCol = findCol("rmssd", "hrv", "average_hrv");
  const rhrCol = findCol("hr_lowest", "lowest_heart_rate", "resting_heart_rate");

  for (const row of rows) {
    const date = toDate(row[dateCol] ?? "");
    if (!date) continue;

    const durationSec = num(row[durationCol]);
    const durationHrs = durationSec !== null ? durationSec > 24 ? Math.round((durationSec / 3600) * 10) / 10 : durationSec : null;
    const score = num(row[scoreCol]);

    days.push({
      date, source: "oura",
      sleep: {
        duration: durationHrs,
        hrv: num(row[hrvCol]),
        restingHR: num(row[rhrCol]),
        qualityRating: score !== null ? Math.max(1, Math.min(5, Math.round(score / 20))) : null,
        bodyBattery: null,
      },
      training: { strengthTraining: false, cardio: false, coreWork: false, mobility: false, strengthDuration: null, cardioDuration: null },
      extras: { recoveryScore: score ?? undefined },
    });
  }

  return { source: "oura", days, errors, rawHeaders: headers };
}

// ─── Apple Health parser ───────────────────────────────────────────────────

/**
 * Apple Health exports export.xml (large) or CSV summaries.
 * We handle a simplified CSV export with common columns.
 * For XML, we extract key HKQuantityTypeIdentifier records.
 */
function parseAppleHealth(content: string): WearableParseResult {
  const days: ParsedWearableDay[] = [];
  const errors: string[] = [];

  if (content.trim().startsWith("<?xml")) {
    // Parse XML — extract date-keyed values
    const byDate: Record<string, ParsedWearableDay> = {};

    const extractRecords = (type: string) => {
      const regex = new RegExp(`<Record[^>]*type="${type}"[^>]*startDate="([^"]+)"[^>]*value="([^"]+)"`, "g");
      const results: { date: string; value: number }[] = [];
      let m: RegExpExecArray | null;
      while ((m = regex.exec(content)) !== null) {
        const date = toDate(m[1]);
        const value = parseFloat(m[2]);
        if (date && !isNaN(value)) results.push({ date, value });
      }
      return results;
    };

    const ensureDay = (date: string, source: WearableSource): ParsedWearableDay => {
      if (!byDate[date]) {
        byDate[date] = {
          date, source,
          sleep: { hrv: null, restingHR: null, duration: null, qualityRating: null, bodyBattery: null },
          training: { strengthTraining: false, cardio: false, coreWork: false, mobility: false, strengthDuration: null, cardioDuration: null },
          extras: {},
        };
      }
      return byDate[date];
    };

    const hrvRecords = extractRecords("HKQuantityTypeIdentifierHeartRateVariabilitySDNN");
    const rhrRecords = extractRecords("HKQuantityTypeIdentifierRestingHeartRate");
    const sleepRecords = extractRecords("HKCategoryTypeIdentifierSleepAnalysis");
    const stepsRecords = extractRecords("HKQuantityTypeIdentifierStepCount");

    for (const { date, value } of hrvRecords) {
      ensureDay(date, "apple_health").sleep.hrv = value;
    }
    for (const { date, value } of rhrRecords) {
      ensureDay(date, "apple_health").sleep.restingHR = value;
    }
    for (const { date, value } of stepsRecords) {
      const d = ensureDay(date, "apple_health");
      d.extras.steps = (d.extras.steps ?? 0) + value;
    }

    days.push(...Object.values(byDate));
    return { source: "apple_health", days, errors };
  }

  // CSV fallback
  const { headers, rows } = parseCSVLines(content);

  const findCol = (...candidates: string[]) =>
    candidates.find((c) => headers.some((h) => h.toLowerCase().includes(c.toLowerCase())));

  const dateCol = findCol("date", "start_date") ?? "date";
  const hrvCol = findCol("hrv", "heart rate variability");
  const rhrCol = findCol("resting heart rate", "rhr");
  const sleepCol = findCol("sleep duration", "sleep");
  const stepsCol = findCol("steps");

  for (const row of rows) {
    const date = toDate(row[dateCol] ?? "");
    if (!date) continue;

    days.push({
      date, source: "apple_health",
      sleep: {
        hrv: hrvCol ? num(row[hrvCol]) : null,
        restingHR: rhrCol ? num(row[rhrCol]) : null,
        duration: sleepCol ? num(row[sleepCol]) : null,
        qualityRating: null,
        bodyBattery: null,
      },
      training: { strengthTraining: false, cardio: false, coreWork: false, mobility: false, strengthDuration: null, cardioDuration: null },
      extras: { steps: stepsCol ? (num(row[stepsCol]) ?? undefined) : undefined },
    });
  }

  return { source: "apple_health", days, errors, rawHeaders: headers };
}

// ─── Duration parser ───────────────────────────────────────────────────────

/** Parses "1:23:45" or "83" (minutes) → decimal hours */
function parseDuration(raw: string): number | null {
  if (!raw) return null;
  const hms = raw.match(/(\d+):(\d{2}):(\d{2})/);
  if (hms) return parseInt(hms[1]) + parseInt(hms[2]) / 60 + parseInt(hms[3]) / 3600;
  const hm = raw.match(/(\d+):(\d{2})/);
  if (hm) return parseInt(hm[1]) + parseInt(hm[2]) / 60;
  const mins = parseFloat(raw);
  if (!isNaN(mins)) return mins / 60;
  return null;
}

// ─── Master parse entry point ──────────────────────────────────────────────

export function parseWearableData(
  content: string,
  filename: string,
): WearableParseResult {
  const source = detectWearableFormat(filename, content);

  switch (source) {
    case "whoop": return parseWHOOP(content);
    case "garmin": return parseGarmin(content);
    case "oura": return parseOura(content);
    case "apple_health": return parseAppleHealth(content);
    default:
      // Best-effort: try to auto-detect from headers
      if (content.includes("Recovery score") || content.includes("HRV resting")) return parseWHOOP(content);
      if (content.includes("Body Battery") || content.includes("Sleep Score")) return parseGarmin(content);
      if (content.includes("rmssd") || content.includes("readiness")) return parseOura(content);
      return { source: "unknown", days: [], errors: ["Could not detect wearable format. Supported: Garmin, WHOOP, Oura, Apple Health."], rawHeaders: [] };
  }
}

// ─── Merge helper ──────────────────────────────────────────────────────────

/**
 * Merges a ParsedWearableDay into an existing DailyEntry's sleep/training data.
 * Wearable data fills in nulls but does not overwrite manually entered values.
 */
export function mergeWearableSleep(
  existing: Partial<import("./types").SleepData>,
  wearable: Partial<SleepData>,
): import("./types").SleepData {
  return {
    duration: existing.duration ?? wearable.duration ?? null,
    qualityRating: existing.qualityRating ?? wearable.qualityRating ?? null,
    hrv: existing.hrv ?? wearable.hrv ?? null,
    restingHR: existing.restingHR ?? wearable.restingHR ?? null,
    bodyBattery: existing.bodyBattery ?? wearable.bodyBattery ?? null,
  };
}
