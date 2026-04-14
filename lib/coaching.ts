/**
 * Coach Personality Engine
 *
 * Generates daily coaching messages based on:
 *  - Recovery score tier (low / mid / high)
 *  - Coach mode (hardcore / balanced / recovery)
 *  - Score breakdown highlights
 */

import type { CoachMode, RecoveryScore, ScoreBreakdown } from "./types";
import { getEffectiveScore } from "./recovery-engine";

interface CoachContext {
  score: number;
  breakdown: ScoreBreakdown;
  tier: "low" | "mid" | "high";
}

// ─── Message banks ────────────────────────────────────────────────────────────

const HARDCORE_MESSAGES = {
  low: [
    "Your body is waving a white flag. That's not an excuse to slow down — it's a call to fix your fundamentals. Sleep more. Hydrate. Do the work.",
    "Score in the red. Weak numbers, weak output. This doesn't happen to people who are serious. Fix your sleep, fix your nutrition. No excuses.",
    "Recovery score crushed. You can't outperform a broken foundation. You already know what you're doing wrong. Fix it.",
    "Red zone. That means you've been sloppy — with sleep, with nutrition, with recovery work. Mediocre habits produce mediocre results. Tighten up.",
  ],
  mid: [
    "You're in the middle. Comfortable. Average. The athletes you're trying to beat aren't stopping here — why are you?",
    "Moderate recovery. You're doing enough to survive, not enough to dominate. Push your sleep and protein numbers — they're your biggest levers.",
    "Yellow zone. This is where most people stay. You're better than most people. Close the gaps.",
    "Mid-range score. Solid effort. Not elite effort. You know where the gaps are — address them or accept the ceiling.",
  ],
  high: [
    "Green. You showed up for recovery the same way you show up for training. That's the standard. Hold it.",
    "High score. Your body is ready. Don't waste it. Push hard today — you've earned the capacity.",
    "You did everything right. Sleep, nutrition, recovery work — all of it. This is what it looks like when discipline compounds. Keep building.",
    "Strong recovery metrics. Your body is primed. Train with intent today. This is not luck — it's the result of consistent choices.",
  ],
};

const BALANCED_MESSAGES = {
  low: [
    "Your recovery score is in the low range today. This is useful information, not a reason to panic. Prioritize sleep quality tonight and consider scaling back training intensity.",
    "Low recovery today. Your body is asking for more support. Look at what's driving the score down — sleep, hydration, and training load are the most common factors.",
    "You're starting from a deficit today. That's okay. Reduce the load, stay consistent with nutrition, and let your body catch up.",
    "Below baseline recovery. Rest is productive. The athletes who last longest are the ones who respect this data.",
  ],
  mid: [
    "Moderate recovery score. You're in a workable range — just be thoughtful about training intensity today. Your body has more to give with a few consistent adjustments.",
    "Solid middle-ground recovery. Sleep is likely your biggest opportunity here. Even 30 more minutes can shift this score meaningfully.",
    "Mid-range score. You're recovering, but there's room to build. Focus on your protein target and hydration today to set up a stronger tomorrow.",
    "Reasonable recovery. You're maintaining. To improve, look at which category scored lowest in your breakdown — that's where your leverage is.",
  ],
  high: [
    "Strong recovery today. Your body is well-rested and fueled. This is a good day to push your training with confidence.",
    "High recovery score. The work you put into sleep and nutrition is showing up in your numbers. Build on this momentum.",
    "Your recovery is strong. Whatever you did yesterday — do it again. Consistency is the mechanism.",
    "Excellent score across the board. Your inputs are aligned. Train hard, stay consistent, and you'll see this reflected in long-term performance.",
  ],
};

const RECOVERY_MESSAGES = {
  low: [
    "Take care of yourself today. Your body is giving you clear signals that it needs support — rest is not weakness, it's wisdom.",
    "Low recovery score. This is a gentle reminder that your body is doing important work behind the scenes. Prioritize sleep, warm meals, and light movement if anything at all.",
    "Your system is under stress. The most productive thing you can do today is rest, hydrate well, and give yourself permission to slow down.",
    "Recovery starts with listening. Your score says your body needs more time. Honor that — a lighter day now means a stronger week ahead.",
  ],
  mid: [
    "You're in a comfortable recovery range. There's no urgency, just opportunity. Small improvements in sleep or hydration can meaningfully elevate how you feel.",
    "Moderate recovery. Your body is doing its job. Lean into your recovery habits today — sauna, compression, or even a walk can help close the gap.",
    "Good foundation today. You're not depleted, and there's room to optimize. How did your sleep feel? That's usually the most impactful variable to tune.",
    "Steady recovery. You're in a positive direction. Stay consistent with your habits and your score will reflect it.",
  ],
  high: [
    "You're thriving. High recovery scores like this are the result of genuine care for your body. Take a moment to appreciate that.",
    "Strong recovery today. Your sleep, nutrition, and recovery habits are working in harmony. This is what balance looks like in the data.",
    "Excellent score. You've earned this — through consistent sleep, good nutrition, and deliberate recovery work. Today, your body is at its best.",
    "You're in peak recovery. Whatever you're doing, it's working. Your body is ready, your mind should be too.",
  ],
};

// ─── Score-specific highlights ────────────────────────────────────────────────

function getSleepNote(breakdown: ScoreBreakdown, mode: CoachMode): string {
  if (breakdown.sleep < 50) {
    if (mode === "hardcore") return " Sleep is your weakest link — fix it tonight.";
    if (mode === "balanced") return " Your sleep score is pulling this down — prioritize 7-8 hours tonight.";
    return " Your body is asking for more sleep. Make it a priority tonight.";
  }
  return "";
}

function getHRVNote(breakdown: ScoreBreakdown, mode: CoachMode): string {
  if (breakdown.hrv < 45) {
    if (mode === "hardcore") return " HRV is suppressed. Your nervous system is under load — recover harder.";
    if (mode === "balanced") return " Low HRV suggests your nervous system needs support. Consider scaling back intensity.";
    return " Low HRV is a signal to take it easy today. Your nervous system is working to restore balance.";
  }
  return "";
}

function getNutritionNote(breakdown: ScoreBreakdown, mode: CoachMode): string {
  if (breakdown.nutrition < 55) {
    if (mode === "hardcore") return " Nutrition is subpar. Hit your protein target — it's non-negotiable.";
    if (mode === "balanced") return " Nutrition could be stronger — protein and hydration are your quickest levers.";
    return " A bit more protein and water today could make a real difference in how you feel.";
  }
  return "";
}

// ─── Main function ────────────────────────────────────────────────────────────

export function generateCoachMessage(
  recoveryScore: RecoveryScore,
  mode: CoachMode,
): string {
  const score = getEffectiveScore(recoveryScore);
  const { breakdown } = recoveryScore;

  const tier: "low" | "mid" | "high" =
    score >= 71 ? "high" : score >= 41 ? "mid" : "low";

  const bank =
    mode === "hardcore"
      ? HARDCORE_MESSAGES
      : mode === "balanced"
      ? BALANCED_MESSAGES
      : RECOVERY_MESSAGES;

  const messages = bank[tier];
  const base = messages[Math.floor(Math.random() * messages.length)];

  // Append targeted notes for lowest-scoring areas
  const notes = [
    getSleepNote(breakdown, mode),
    getHRVNote(breakdown, mode),
    getNutritionNote(breakdown, mode),
  ]
    .filter(Boolean)
    .slice(0, 1) // max one note to keep message clean
    .join("");

  return base + notes;
}

// ─── Static example messages for docs/onboarding ─────────────────────────────

export const EXAMPLE_MESSAGES = {
  hardcore: {
    low: "Score in the red. Weak numbers, weak output. This doesn't happen to people who are serious. Fix your sleep, fix your nutrition. No excuses.",
    mid: "You're in the middle. Comfortable. Average. The athletes you're trying to beat aren't stopping here — why are you?",
    high: "Green. You showed up for recovery the same way you show up for training. That's the standard. Hold it.",
  },
  balanced: {
    low: "Low recovery today. Your body is asking for more support. Look at what's driving the score down — sleep, hydration, and training load are the most common factors.",
    mid: "Solid middle-ground recovery. Sleep is likely your biggest opportunity here. Even 30 more minutes can shift this score meaningfully.",
    high: "Strong recovery today. The work you put into sleep and nutrition is showing up in your numbers. Build on this momentum.",
  },
  recovery: {
    low: "Your system is under stress. The most productive thing you can do today is rest, hydrate well, and give yourself permission to slow down.",
    mid: "Good foundation today. You're not depleted, and there's room to optimize. How did your sleep feel? That's usually the most impactful variable to tune.",
    high: "You're thriving. High recovery scores like this are the result of genuine care for your body. Take a moment to appreciate that.",
  },
} as const;
