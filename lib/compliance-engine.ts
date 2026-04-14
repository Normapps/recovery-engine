/**
 * Compliance Engine
 *
 * Computes the influence of yesterday's plan-task completion on today's
 * Recovery and Readiness scores.
 *
 * ─── Rationale ────────────────────────────────────────────────────────────────
 *
 * Following a prescribed plan is itself a recovery behaviour.  Athletes who
 * consistently execute their protocol (sleep hygiene, nutrition timing,
 * recovery modalities) recover measurably better than those who do not —
 * independent of what a single biomarker captures on a given morning.
 *
 * The modifier is intentionally narrow (−8 … +5) so it influences but never
 * dominates the physiological signal.  A single missed day cannot undo a
 * strong HRV reading, and a single perfect day cannot mask deep fatigue.
 *
 * ─── Calculation ──────────────────────────────────────────────────────────────
 *
 *   Step 1 │ compliance = completed_count / total_tasks    (0 → 1.0)
 *   Step 2 │ modifier                                      (−8 … +5 pts)
 *           │   compliance ≥ 0.80  →  +5   (high compliance — positive signal)
 *           │   compliance  0.50–0.79  →   0   (neutral — no meaningful signal)
 *           │   compliance < 0.50  →  −8   (low compliance — recovery penalty)
 *   Step 3 │ Applied by caller to recovery_score and readiness_score
 *           │ Caller is responsible for clamping the final score to [0, 100]
 *
 * ─── Edge cases ───────────────────────────────────────────────────────────────
 *
 *   No tasks (total = 0)   → compliance = 1.0, modifier = 0 (neutral — no data)
 *   All tasks incomplete   → compliance = 0,   modifier = −8
 *   All tasks complete     → compliance = 1.0, modifier = +5
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Minimal shape expected by the compliance engine.
 * Compatible with PlanTaskItem — callers may pass the full type.
 */
export interface ComplianceTaskInput {
  completed: boolean;
}

export interface ComplianceResult {
  /**
   * Ratio of completed to total tasks, expressed as 0–100.
   *
   *   100 = every prescribed task completed
   *     0 = no tasks completed
   *
   * Returned as a percentage (not a 0–1 fraction) for consistency with the
   * rest of the scoring pipeline's 0–100 convention.
   */
  compliance_score:    number;

  /**
   * Score adjustment applied to both recovery_score and readiness_score.
   *
   *   +5  high compliance (≥ 80 %)
   *    0  neutral          (50–79 %)
   *   −8  low compliance  (< 50 %)
   */
  compliance_modifier: number;
}

// ─── Thresholds ────────────────────────────────────────────────────────────────

const HIGH_COMPLIANCE_THRESHOLD  = 0.80;  //  ≥ 80 % → +5
const LOW_COMPLIANCE_THRESHOLD   = 0.50;  //  < 50 % → −8
const HIGH_COMPLIANCE_MODIFIER   =  5;
const NEUTRAL_COMPLIANCE_MODIFIER =  0;
const LOW_COMPLIANCE_MODIFIER    = -8;

// ─── Main function ─────────────────────────────────────────────────────────────

/**
 * computeComplianceModifier
 *
 * Calculates the compliance ratio from yesterday's plan tasks and returns the
 * resulting score modifier.
 *
 * @param yesterdayTasks  Array of task objects from the previous day's planTaskLog.
 *                        Pass an empty array or omit to signal no data (neutral).
 *
 * @returns ComplianceResult — compliance_score (0–100) + compliance_modifier (−8 … +5)
 *
 * Caller responsibility: clamp final scores to [0, 100] after applying the modifier.
 *
 * Example:
 *
 *   const { compliance_modifier } = computeComplianceModifier(yesterdayTasks);
 *   const recovery_score  = clamp(raw_recovery  + compliance_modifier, 0, 100);
 *   const readiness_score = clamp(raw_readiness + compliance_modifier, 0, 100);
 */
export function computeComplianceModifier(
  yesterdayTasks: ComplianceTaskInput[] = [],
): ComplianceResult {

  // ── Edge case: no tasks logged yesterday → neutral, no penalty ───────────
  const total = yesterdayTasks.length;
  if (total === 0) {
    return { compliance_score: 100, compliance_modifier: NEUTRAL_COMPLIANCE_MODIFIER };
  }

  // ── Step 1: Compliance ratio ──────────────────────────────────────────────
  const completed = yesterdayTasks.filter((t) => t.completed).length;
  const ratio     = completed / total;                          // 0 … 1.0

  // ── Step 2: Modifier ──────────────────────────────────────────────────────
  let compliance_modifier: number;

  if      (ratio >= HIGH_COMPLIANCE_THRESHOLD) compliance_modifier = HIGH_COMPLIANCE_MODIFIER;
  else if (ratio >= LOW_COMPLIANCE_THRESHOLD)  compliance_modifier = NEUTRAL_COMPLIANCE_MODIFIER;
  else                                          compliance_modifier = LOW_COMPLIANCE_MODIFIER;

  // ── Step 3: Return ────────────────────────────────────────────────────────
  const compliance_score = Math.round(ratio * 100);

  return { compliance_score, compliance_modifier };
}
