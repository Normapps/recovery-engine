/**
 * AI Prescription Layer
 *
 * Sends structured athlete context to the /api/prescriptions endpoint,
 * which calls Claude to generate specific, prescriptive protocols for
 * nutrition, recovery, and mobility — anchored on tomorrow's training plan.
 *
 * Falls back gracefully when the API key is absent or the call fails.
 */

// ─── Input ────────────────────────────────────────────────────────────────────

export interface AITrainingContext {
  type:      string;   // "strength" | "cardio" | "game" | "off" | etc.
  intensity: string;   // "low" | "moderate" | "high"
  duration:  number;   // minutes
}

export interface AIPrescriptionInput {
  /** Primary anchor — what the athlete needs to be ready for. */
  tomorrowTraining: AITrainingContext | null;
  /** Today's completed or planned training. */
  todayTraining:    AITrainingContext | null;

  recoveryScore: number;       // 0–100 display score (psych-adjusted)
  psychScore:    number | null; // mood 1–5, null = not logged

  sleepHours:   number | null;
  sleepQuality: number | null;  // 1–5
  hrv:          number | null;  // ms
  restingHR:    number | null;  // bpm

  soreness: "low" | "moderate" | "high";

  /** Key bloodwork findings, e.g. ["Low ferritin", "Elevated CK"]. */
  bloodworkFlags?: string[];

  /** Athlete's performance profile — drives goal-specific recommendations. */
  performanceProfile?: {
    primaryGoal:    string;
    eventDate?:     string;
    trainingFocus?: string;
    priority?:      string;
  } | null;
}

// ─── Output ───────────────────────────────────────────────────────────────────

export interface AINutritionProtocol {
  summary:       string;  // one sentence for the card row
  overview:      string;
  protein:       string;
  carbs:         string;
  hydration:     string;
  micronutrients: string;
  coaching_note: string;
}

export interface AIRecoveryProtocol {
  summary:           string;
  overview:          string;
  primary_modality:  string;
  secondary_modality: string;
  timing:            string;
  coaching_note:     string;
}

export interface AIMobilityProtocol {
  summary:      string;
  overview:     string;
  movement_1:   string;
  movement_2:   string;
  movement_3:   string;
  structure:    string;
  coaching_note: string;
}

export interface AIPrescriptionOutput {
  nutrition: AINutritionProtocol;
  recovery:  AIRecoveryProtocol;
  mobility:  AIMobilityProtocol;
}

// ─── Client ───────────────────────────────────────────────────────────────────

export async function generateAIPrescriptions(
  input: AIPrescriptionInput,
): Promise<AIPrescriptionOutput> {
  const res = await fetch("/api/prescriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => String(res.status));
    throw new Error(`Prescription API error ${res.status}: ${msg}`);
  }

  return res.json();
}
