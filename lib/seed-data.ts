/**
 * Seed data — generates 30 days of realistic demo entries
 * Called on first load if no data exists
 */

import { format, subDays } from "date-fns";
import type { DailyEntry, RecoveryScore } from "./types";
import { computeRecoveryScore } from "./recovery-engine";

function rand(min: number, max: number, decimals = 0): number {
  const v = Math.random() * (max - min) + min;
  return decimals > 0
    ? Math.round(v * 10 ** decimals) / 10 ** decimals
    : Math.round(v);
}

function bool(probability = 0.5): boolean {
  return Math.random() < probability;
}

export function generateSeedData(): {
  entries: Record<string, DailyEntry>;
  scores: Record<string, RecoveryScore>;
} {
  const entries: Record<string, DailyEntry> = {};
  const scores: Record<string, RecoveryScore> = {};

  for (let i = 29; i >= 1; i--) {
    const date = format(subDays(new Date(), i), "yyyy-MM-dd");
    const isRestDay = bool(0.25);
    const isHighDay = bool(0.3);

    const entry: DailyEntry = {
      id: crypto.randomUUID(),
      date,
      sleep: {
        duration: rand(5.5, 9, 1),
        qualityRating: rand(2, 5),
        hrv: rand(28, 85),
        restingHR: rand(48, 72),
        bodyBattery: rand(30, 95),
      },
      nutrition: {
        calories: rand(1800, 3400),
        protein: rand(90, 210),
        hydration: rand(40, 110),
        notes: "",
      },
      training: {
        strengthTraining: !isRestDay && bool(0.6),
        strengthDuration: !isRestDay ? rand(30, 75) : null,
        cardio: !isRestDay && bool(0.4),
        cardioDuration: !isRestDay ? rand(20, 55) : null,
        coreWork: bool(0.35),
        mobility: bool(0.45),
      },
      recovery: {
        iceBath: isHighDay && bool(0.4),
        sauna: bool(0.35),
        compression: bool(0.25),
        massage: bool(0.1),
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Build history array from already-generated entries (most-recent first)
    const history = Object.values(entries)
      .sort((a, b) => b.date.localeCompare(a.date));

    const score = computeRecoveryScore(entry, history);
    entries[date] = entry;
    scores[date] = score;
  }

  return { entries, scores };
}
