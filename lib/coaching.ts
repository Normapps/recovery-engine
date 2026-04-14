/**
 * Coach Personality Engine
 *
 * Every message follows the Marketability Engine formula:
 *   1. What's happening to your body right now (simple, honest)
 *   2. The ONE thing to do today (clear, actionable)
 *   3. What happens tomorrow if you do it (retention hook)
 *
 * Modes differ in tone, not in the quality of advice.
 */

import type { CoachMode, RecoveryScore, ScoreBreakdown } from "./types";
import { getEffectiveScore } from "./recovery-engine";

// ─── Message banks ────────────────────────────────────────────────────────────

const HARDCORE_MESSAGES = {
  low: [
    "Your body is running on empty — training hard on top of that just digs the hole deeper. Scale back today, sleep 8 hours tonight, and hit your protein. One smart recovery day buys you three strong training days.",
    "Recovery is in the red. Your output today will reflect it whether you want it to or not. Lower the load, fuel up, and get real sleep tonight. Tomorrow you come back with more to give.",
    "You're spending capacity you don't have. Forcing intensity through low recovery is how athletes get hurt and lose weeks. Do the disciplined thing — recover hard today and perform better tomorrow.",
    "Red zone. Your body is telling you it needs more than you've been giving it. Fix sleep, fix nutrition — those are your two levers. Ignore them and you stay stuck. Address them and your score moves.",
  ],
  mid: [
    "You're workable but not optimal. The athletes beating you aren't leaving these gaps open. Find the lowest score in your breakdown, fix that one input today, and watch your score climb tomorrow.",
    "Moderate recovery means moderate output — it's that direct. Your biggest lever right now is sleep. Add 30–45 minutes tonight and you'll feel the difference in tomorrow's session.",
    "Yellow zone is where most people get comfortable and stop improving. You have a clear path to green — look at your breakdown and close the gap on whichever category is lowest.",
    "Mid-range score. You can train with purpose today, but leave something in the tank. Fix the inputs tonight — sleep and protein — and you'll be in a better position to push hard tomorrow.",
  ],
  high: [
    "Green. This is the result of showing up for recovery the same way you show up for training. Your body is ready — don't waste the window. Push hard today and repeat the habits tonight.",
    "High recovery score. Your body is primed to perform and absorb training. Execute at full intensity today — this is exactly the state where gains happen. Do the same things tonight.",
    "You did the work — sleep, fuel, recovery protocols — and the score shows it. Train with full intent today. The adaptation happens when you push inside a recovered state like this.",
    "Strong across the board. This is what discipline compounds into. Train hard, fuel the session, and recover intentionally tonight. Consistency is how you stay here.",
  ],
};

const BALANCED_MESSAGES = {
  low: [
    "Your body is under-recovered today, which means your output will be lower no matter how hard you push. Drop training intensity one level, hit your protein target, and get 8 hours tonight. A focused recovery day can move your score up 10+ points by tomorrow.",
    "Low recovery is your body asking for more support than it's been getting. The fix is simple: train lighter today, eat more protein, sleep earlier tonight. Small corrections now prevent bigger setbacks later.",
    "You're starting from a deficit — and that's just information, not a problem. Lower your training load today, stay consistent with nutrition, and use tonight to rebuild. Your body does its best repair work while you sleep.",
    "Below baseline today. The most productive thing you can do is respect the signal. One light day now is worth far more than pushing through and losing a full week to fatigue or injury.",
  ],
  mid: [
    "You're in a workable range today. Train at 70–75%, hit your protein, and look at your sleep schedule — that's where your biggest return is. Even 30 extra minutes of sleep tonight can shift tomorrow's score noticeably.",
    "Moderate recovery means you have room to improve with small adjustments. Check your breakdown — whichever category scored lowest is your highest-leverage input today. Fix that one thing.",
    "Solid foundation. You can train with purpose today, just stay in control. The score improves from here through consistency, not intensity. Small inputs compound into strong baselines.",
    "Mid-range score. You're maintaining, which is good — but building is better. Focus on whichever input was lowest today and correct it tonight. Tomorrow's score directly reflects tonight's choices.",
  ],
  high: [
    "Strong recovery today — your body is ready to perform. Push training intensity and fuel the session well. This is the window where real adaptation happens. Do the same things tonight and you'll build on it.",
    "High recovery score. Everything you've been putting in is showing up in the numbers. Build on this momentum — train hard, eat well, and repeat the habits that got you here.",
    "Your recovery is strong. Train with confidence today. The habits that produced this score are working — keep them. Consistency is what turns a good day into a great week.",
    "Excellent score. Sleep, nutrition, and recovery work are all aligned. This is peak performance territory. Make the most of today's session and set up tomorrow the same way.",
  ],
};

const RECOVERY_MESSAGES = {
  low: [
    "Your body needs real rest today more than it needs more training. A walk is enough movement. Prioritize sleep, warm food, and calm. One true rest day now returns more than any session you force through fatigue.",
    "Low recovery score — your body is working hard on repair behind the scenes. Support that process: eat well, hydrate, sleep early. You'll come back tomorrow noticeably fresher than if you push through.",
    "Your system is under stress and more load will slow your recovery, not speed it up. Rest deliberately today — it's not wasted time, it's the session your body actually needs right now.",
    "Low score means low capacity. The kindest and most effective thing you can do is rest, fuel up, and sleep long tonight. Your score will respond — and you'll perform better for it.",
  ],
  mid: [
    "You're in a comfortable recovery range — no urgency, just opportunity. A sauna session, compression protocol, or even a focused walk can close the gap. Pick one recovery habit and complete it today.",
    "Moderate recovery. Your body is doing its job. Lean into your recovery tools today — the score responds to deliberate input. What's one thing you can do tonight to sleep better?",
    "Good foundation today. The score can move higher with intentional recovery work — not harder training. A mobility session or breathwork protocol will show up in tomorrow's number.",
    "Steady and positive. Recovery scores respond to accumulation — every consistent choice builds on the last. What habit can you repeat today that you did well yesterday?",
  ],
  high: [
    "You're thriving — and that's the result of genuine, consistent care for your body. Keep doing exactly what you're doing. High scores like this compound into sustained performance week over week.",
    "Strong recovery today. Sleep, nutrition, and recovery habits are working in harmony. This is what your body looks like when everything is aligned. Protect it tonight with the same intention.",
    "Excellent score. You've built this through consistent effort — sleep, nutrition, recovery protocols. Today your body is operating at its best. Train with that confidence and recover the same way tonight.",
    "Peak recovery state. This is what you've been working toward. Your body is fully ready to perform. Train hard, fuel well, and don't skip tonight's recovery — this is how you stay here.",
  ],
};

// ─── Targeted signal notes ────────────────────────────────────────────────────
// Each note answers: what's pulling the score down, and what's the specific fix?

function getSleepNote(breakdown: ScoreBreakdown, mode: CoachMode): string {
  if (breakdown.sleep < 50) {
    if (mode === "hardcore")
      return " Sleep is your biggest lever right now — 8 hours tonight will move your score more than any supplement or protocol.";
    if (mode === "balanced")
      return " Sleep is pulling your score down. Getting 8 hours tonight is the single highest-return thing you can do right now.";
    return " Your body recovers during sleep, not during the day. Make 8 hours tonight a non-negotiable — you'll feel the difference tomorrow morning.";
  }
  return "";
}

function getHRVNote(breakdown: ScoreBreakdown, mode: CoachMode): string {
  if (breakdown.hrv < 45) {
    if (mode === "hardcore")
      return " HRV is suppressed — your nervous system is under serious load. Back off intensity today or you'll be in a deeper hole tomorrow.";
    if (mode === "balanced")
      return " Low HRV means your nervous system needs a reset. Reduce training intensity today and you'll recover faster than if you push through.";
    return " Your nervous system is asking for calm today. Lower the load and your HRV will rebound — usually within 24–48 hours of real rest.";
  }
  return "";
}

function getNutritionNote(breakdown: ScoreBreakdown, mode: CoachMode): string {
  if (breakdown.nutrition < 55) {
    if (mode === "hardcore")
      return " Nutrition is costing you points — hit your protein target today, no exceptions. Your muscles can't repair without the raw material.";
    if (mode === "balanced")
      return " Protein and hydration are your fastest levers right now. Hit both today and your recovery score will respond.";
    return " A bit more protein and consistent water intake today directly improves how recovered you feel tomorrow. Small input, clear return.";
  }
  return "";
}

// ─── Main export ──────────────────────────────────────────────────────────────

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

  // Append one targeted note for the lowest-scoring area
  const notes = [
    getSleepNote(breakdown, mode),
    getHRVNote(breakdown, mode),
    getNutritionNote(breakdown, mode),
  ]
    .filter(Boolean)
    .slice(0, 1)
    .join("");

  return base + notes;
}

// ─── Example messages for onboarding / docs ───────────────────────────────────

export const EXAMPLE_MESSAGES = {
  hardcore: {
    low:  "Recovery is in the red. Lower the load, fuel up, and get real sleep tonight. Tomorrow you come back with more to give.",
    mid:  "Yellow zone is where most people get comfortable and stop improving. Find the lowest score in your breakdown and close the gap today.",
    high: "Green. Your body is primed — don't waste the window. Push hard today and repeat the habits tonight.",
  },
  balanced: {
    low:  "Your body is under-recovered today. Drop training intensity one level, hit your protein target, and get 8 hours tonight. A focused recovery day can move your score up 10+ points by tomorrow.",
    mid:  "Moderate recovery. Check your breakdown — whichever category scored lowest is your highest-leverage input today. Fix that one thing.",
    high: "Strong recovery today — your body is ready to perform. This is the window where real adaptation happens. Train hard and repeat the habits tonight.",
  },
  recovery: {
    low:  "Your body needs real rest today more than it needs more training. Rest deliberately — it's the session your body actually needs right now.",
    mid:  "Good foundation today. Pick one recovery habit and complete it — the score responds to deliberate input. What's one thing you can do tonight to sleep better?",
    high: "Peak recovery state. Your body is fully ready to perform. Train hard, fuel well, and don't skip tonight's recovery — this is how you stay here.",
  },
} as const;
