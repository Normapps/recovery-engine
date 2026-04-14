/**
 * Daily Plan Generator
 *
 * Produces a 4-section prescriptive daily plan (training, recovery, mobility,
 * nutrition) from the psych-adjusted display score and mood rating.
 *
 * Rules:
 *   score < 45  → fatigued tier (rest, passive recovery)
 *   score 45–64 → caution tier (low-intensity work)
 *   score 65–79 → moderate tier (controlled training)
 *   score ≥ 80  → optimal tier (push hard)
 *
 *   moodRating ≤ 2 → drop one intensity tier across training + recovery
 *   moodRating ≥ 4 → maintain or reinforce current tier
 *
 * All sentences: verb-first, ≤ 15 words, specific and actionable.
 */

import type { DailyEntry, TrainingDay } from "./types";

export interface DailyPlan {
  training:  string;
  recovery:  string;
  mobility:  string;
  nutrition: string;
}

export function generateDailyPlan(
  score:      number,         // psych-adjusted display score (0–100)
  moodRating: number | null,  // 1–5 from mood picker, null = not logged
  todayPlan:  TrainingDay | null,
  entry:      DailyEntry,
): DailyPlan {
  const isRestDay =
    todayPlan?.training_type === "off" ||
    (!todayPlan &&
      !entry.training.strengthTraining &&
      !entry.training.cardio &&
      !entry.training.coreWork);

  const isGameDay = todayPlan?.training_type === "game";
  const lowMood   = moodRating !== null && moodRating <= 2;
  const highMood  = moodRating !== null && moodRating >= 4;

  // ── Training ──────────────────────────────────────────────────────────────

  let training: string;

  if (isRestDay) {
    training = "Keep today movement-only — short walks and light stretching are enough.";
  } else if (isGameDay) {
    training = "Focus on pre-game activation only — conserve energy for competition today.";
  } else if (score < 45 || lowMood) {
    training = "Avoid structured training today — limit activity to short walks and gentle movement.";
  } else if (score < 65) {
    training = "Perform a low-intensity session with short efforts and full rest between sets.";
  } else if (score < 80) {
    training = "Complete a moderate session at controlled intensity, prioritizing technique over volume.";
  } else {
    training = highMood
      ? "Push a hard training session today — body and mind are both ready to perform."
      : "Train at high intensity today — recovery is strong and your body is primed.";
  }

  // ── Recovery ──────────────────────────────────────────────────────────────

  let recovery: string;

  if (score < 45) {
    recovery = "Use compression boots for 25 minutes and prioritize full rest between all activities.";
  } else if (lowMood) {
    recovery = "Complete an ice bath and follow with 10 minutes of slow nasal breathing afterward.";
  } else if (score < 65) {
    recovery = "Foam roll quads, hamstrings, and calves — pause 15 seconds on each sore spot.";
  } else if (score < 80) {
    recovery = "Perform an ice bath and foam roll quads, hamstrings, and calves post-training.";
  } else {
    recovery = "Use compression boots or a 10-minute ice bath to lock in your recovery gains.";
  }

  // ── Mobility ──────────────────────────────────────────────────────────────

  let mobility: string;

  if (score < 45) {
    mobility = "Perform gentle hip circles and shoulder rolls — stay within a pain-free range only.";
  } else if (score < 65) {
    mobility = "Complete 5 controlled hip openers and thoracic rotations per side before any session.";
  } else if (score < 80) {
    mobility = "Perform hip openers, hamstring stretches, and thoracic rotations for 5 reps per side.";
  } else {
    mobility = "Run a full mobility flow targeting hips, hamstrings, and thoracic spine before training.";
  }

  // ── Nutrition ─────────────────────────────────────────────────────────────

  let nutrition: string;

  if (score < 45) {
    nutrition = "Eat three full meals and prioritize carbohydrates to replenish glycogen stores today.";
  } else if (lowMood) {
    nutrition = "Prioritize protein intake and eat balanced meals to support both body and focus.";
  } else if (score < 65) {
    nutrition = "Hit your protein target and drink 80oz of water spread consistently throughout the day.";
  } else if (isGameDay || score >= 80) {
    nutrition = "Consume protein within 45 minutes post-session and replenish carbohydrates afterward.";
  } else {
    nutrition = "Fuel with a high-protein meal pre-training and hydrate with 90oz of water today.";
  }

  return { training, recovery, mobility, nutrition };
}
