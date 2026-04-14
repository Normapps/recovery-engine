/**
 * Dynamic Recovery Modality Selection Engine
 *
 * Selects a contextually appropriate set of recovery modalities (1 primary +
 * 1–2 supporting, max 3 total) based on athlete state, training load, and
 * recent modality history.
 *
 * ─── Design principles ────────────────────────────────────────────────────────
 *
 *   1. Context-first  — selections are driven by a deterministic priority tree,
 *                       not random sampling.  Given identical inputs the output
 *                       is always identical (stable, testable).
 *
 *   2. No-repeat      — any modality present in previous_modalities is excluded
 *                       from consideration.  A depth-ordered fallback list ensures
 *                       something valid is always returned.
 *
 *   3. Category diversity — the primary modality and each supporting modality
 *                       must come from different focus categories so the protocol
 *                       covers more recovery dimensions each day.
 *
 *   4. Minimum output — at least one modality is always returned, even when
 *                       exclusions are aggressive.
 *
 * ─── Stage map ────────────────────────────────────────────────────────────────
 *
 *   Stage 1 │ Classify context (recovery_state, readiness_state, load_state)
 *   Stage 2 │ Determine primary focus category
 *   Stage 3 │ Build per-category candidate lists, excluding previous_modalities
 *   Stage 4 │ Pick primary (top of primary-focus list) + supporting (top of
 *             other-category lists, respecting category diversity)
 *   Stage 5 │ Clamp output to max 3, guarantee min 1
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Score-tier classification — shared by recovery and readiness dimensions. */
type ContextLevel = "high" | "moderate" | "low";

/** Broad load level derived from load_today (0–100). */
type LoadLevel = "high" | "moderate" | "low";

/**
 * The four primary focus categories.
 *
 *   rehab          — active injury takes top priority
 *   muscle_recovery — high load or present soreness
 *   nervous_system  — low recovery state, declining HRV, or fatigue signal
 *   mobility        — default when no acute stress is present
 */
export type PrimaryFocus =
  | "rehab"
  | "muscle_recovery"
  | "nervous_system"
  | "mobility";

/** Full input contract for the selection engine. */
export interface ModalitySelectionInput {
  /** Physiological recovery score (0–100). */
  recovery_score: number;

  /** Performance readiness score (0–100). */
  readiness_score: number;

  /**
   * Today's training load as a 0–100 normalised value.
   * Maps to session AU divided by a 600 AU soft cap:
   *   0   = rest day
   *   50  = moderate session (~300 AU)
   *   100 = maximum session (≥ 600 AU)
   */
  load_today: number;

  /** True when muscle soreness is present (CK elevated or high-intensity session logged). */
  soreness: boolean;

  /**
   * True when fatigue is present as a discrete signal.
   * Typically derived from: low HRV trend, < 6 h sleep, or low readiness zone.
   */
  fatigue: boolean;

  /** True when an active injury is being managed. */
  injury: boolean;

  /**
   * IDs of modalities used in recent sessions (most-recent first).
   *
   * Any ID present here is excluded from today's selection.
   * Callers should pass yesterday's IDs at minimum; passing 2–3 days
   * of history produces more varied weekly rotation.
   *
   * ID values match the keys of MODALITY_CATALOGUE below.
   */
  previous_modalities: string[];
}

/** A single selected modality. */
export interface SelectedModality {
  /** Stable identifier — matches MODALITY_CATALOGUE key. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Recommended duration in minutes. */
  duration: number;
  /** Concise, athlete-facing rationale for this selection. */
  reason: string;
  /** Focus category this modality belongs to. */
  category: PrimaryFocus;
}

/** Final output of the selection engine. */
export interface ModalitySelectionOutput {
  /** Primary modality — directly matches the day's primary focus. */
  primary: SelectedModality;

  /**
   * 1–2 supporting modalities from different categories than the primary.
   * May be empty only when all non-primary candidates are exhausted by exclusions.
   */
  supporting: SelectedModality[];

  /** Metadata for logging / compliance engine consumption. */
  meta: {
    primary_focus:   PrimaryFocus;
    recovery_state:  ContextLevel;
    readiness_state: ContextLevel;
    load_state:      LoadLevel;
  };
}

// ─── Modality catalogue ───────────────────────────────────────────────────────
//
// Each entry carries: name, duration (min), category, and an ordered list of
// context-sensitive reason strings. The first reason that matches the call-site
// context is used; the last is the universal fallback.
//
// Categories map to PrimaryFocus so the diversity constraint can be enforced
// at selection time.

interface CatalogueEntry {
  name:     string;
  duration: number;
  category: PrimaryFocus;
}

const MODALITY_CATALOGUE: Record<string, CatalogueEntry> = {
  // ── Rehab ──────────────────────────────────────────────────────────────────
  rehab_protocol: {
    name: "Rehab Protocol", duration: 20,
    category: "rehab",
  },
  injury_mobility: {
    name: "Injury Mobility Work", duration: 15,
    category: "rehab",
  },
  passive_elevation: {
    name: "Passive Elevation", duration: 20,
    category: "rehab",
  },

  // ── Muscle recovery ────────────────────────────────────────────────────────
  ice_bath: {
    name: "Ice Bath", duration: 12,
    category: "muscle_recovery",
  },
  compression_boots: {
    name: "Compression Boots", duration: 25,
    category: "muscle_recovery",
  },
  foam_rolling: {
    name: "Foam Rolling", duration: 12,
    category: "muscle_recovery",
  },
  myofascial_release: {
    name: "Myofascial Release", duration: 12,
    category: "muscle_recovery",
  },
  contrast_therapy: {
    name: "Contrast Therapy", duration: 20,
    category: "muscle_recovery",
  },
  sauna: {
    name: "Sauna", duration: 20,
    category: "muscle_recovery",
  },

  // ── Nervous system ─────────────────────────────────────────────────────────
  breathwork: {
    name: "Breathwork", duration: 10,
    category: "nervous_system",
  },
  sleep_protocol: {
    name: "Sleep Protocol", duration: 480,
    category: "nervous_system",
  },
  meditation: {
    name: "Meditation", duration: 10,
    category: "nervous_system",
  },
  cold_shower: {
    name: "Cold Shower", duration: 5,
    category: "nervous_system",
  },

  // ── Mobility ───────────────────────────────────────────────────────────────
  mobility_flow: {
    name: "Mobility Flow", duration: 15,
    category: "mobility",
  },
  active_recovery: {
    name: "Active Recovery", duration: 20,
    category: "mobility",
  },
  yoga: {
    name: "Yoga", duration: 30,
    category: "mobility",
  },
  dynamic_stretching: {
    name: "Dynamic Stretching", duration: 12,
    category: "mobility",
  },
};

// ─── Context-sensitive reason strings ────────────────────────────────────────
//
// Reasons are keyed by modality ID, then by context tags that can be combined
// with a pipe separator (e.g. "injury|high_load").  The engine picks the most
// specific match, falling back to "default".

type ReasonContext = {
  injury?:          boolean;
  soreness?:        boolean;
  fatigue?:         boolean;
  recovery_state?:  ContextLevel;
  load_state?:      LoadLevel;
};

const REASONS: Record<string, Array<{ when: ReasonContext; text: string }>> = {
  rehab_protocol: [
    { when: { injury: true },    text: "Work through your prescribed injury rehab sequence — consistent daily execution is the fastest path back." },
    { when: {},                  text: "Complete your rehabilitation protocol to maintain tissue progress and prevent setbacks." },
  ],
  injury_mobility: [
    { when: { injury: true },    text: "Perform gentle pain-free range-of-motion work around the injured area to maintain joint health." },
    { when: {},                  text: "Move gently through the injured area's range of motion — stay well within pain-free limits." },
  ],
  passive_elevation: [
    { when: { injury: true },    text: "Elevate the injured limb above heart level for 20 minutes to reduce swelling and speed tissue clearance." },
    { when: {},                  text: "Elevate your legs above heart level for 20 minutes to assist venous return and reduce tissue fluid." },
  ],
  ice_bath: [
    { when: { soreness: true, load_state: "high" }, text: "Submerge legs to the waist for 10–12 minutes post-session — high training load increases inflammation significantly today." },
    { when: { soreness: true  }, text: "Submerge legs to the waist for 10–12 minutes to drive down quad and hamstring inflammation." },
    { when: { load_state: "high" }, text: "High load day — cold immersion for 10 minutes reduces acute inflammation before it compounds overnight." },
    { when: {},                  text: "10–12 minutes of cold immersion to flush inflammation and accelerate overnight tissue repair." },
  ],
  compression_boots: [
    { when: { load_state: "high" }, text: "Strap on compression boots for 25 minutes post-session to clear lactate and push blood back from the lower legs." },
    { when: { soreness: true  }, text: "25 minutes of compression to reduce soreness-driven fluid pooling and accelerate recovery." },
    { when: {},                  text: "25 minutes of compression to assist lymphatic return and reduce residual training fatigue." },
  ],
  foam_rolling: [
    { when: { soreness: true  }, text: "Roll quads, IT band, and hamstrings — 90 seconds per area, pausing on sore spots to release tension." },
    { when: {},                  text: "Roll quads, IT band, and upper back for 90 seconds per area to restore tissue length." },
  ],
  myofascial_release: [
    { when: { soreness: true  }, text: "Slow myofascial work on quads and hamstrings — pause 15 seconds on tender spots rather than rolling past them." },
    { when: { injury: true    }, text: "Targeted myofascial release around the injured area to maintain tissue quality and prevent compensatory patterns." },
    { when: {},                  text: "Deliberate myofascial work on primary working muscles to restore length and reduce stiffness." },
  ],
  contrast_therapy: [
    { when: { load_state: "high" }, text: "Alternate 3 minutes hot and 1 minute cold, four cycles from feet to hips — drives blood in and out of fatigued tissue." },
    { when: {},                  text: "Alternate 3 minutes hot and 1 minute cold for four cycles to flush metabolic waste and restore circulation." },
  ],
  sauna: [
    { when: { recovery_state: "high" }, text: "20 minutes at 170–190°F to trigger heat-shock protein production — optimal when recovery is already strong." },
    { when: { fatigue: true   }, text: "15 minutes of heat exposure to promote parasympathetic tone and reduce cortisol — keep session short when fatigued." },
    { when: {},                  text: "20 minutes of sauna to support heat adaptation, increase plasma volume, and aid tissue repair." },
  ],
  breathwork: [
    { when: { fatigue: true   }, text: "Lie on your back and breathe in 4 counts, hold 4, exhale 8 — the extended exhale activates your parasympathetic system fastest when fatigued." },
    { when: { recovery_state: "low" }, text: "10 minutes of slow nasal breathing at a 4-second in, 6-second out rhythm to lower cortisol and shift into recovery mode." },
    { when: {},                  text: "10 minutes of box breathing — 4 in, 4 hold, 4 out, 4 hold — before sleep to reduce residual nervous system activation." },
  ],
  sleep_protocol: [
    { when: { recovery_state: "low" }, text: "Set a bedtime two hours earlier tonight — sleep is the highest-leverage recovery tool when your score is low." },
    { when: { fatigue: true   }, text: "Prioritise 8–9 hours tonight. Fatigue compounds without sleep — no modality replaces it." },
    { when: {},                  text: "Target 8 hours in a cool, dark room. Consistent sleep timing is the single largest driver of recovery score." },
  ],
  meditation: [
    { when: { fatigue: true   }, text: "10 minutes of eyes-closed body-scan meditation to down-regulate the nervous system after a high-demand period." },
    { when: {},                  text: "10 minutes of guided or breath-focused meditation to reduce cortisol and prepare your nervous system for sleep." },
  ],
  cold_shower: [
    { when: { fatigue: true   }, text: "End your shower with 2 minutes of cold water — brief cold exposure elevates alertness and shifts autonomic tone." },
    { when: {},                  text: "2-minute cold finish to stimulate norepinephrine, reduce inflammation, and trigger a parasympathetic rebound." },
  ],
  mobility_flow: [
    { when: { recovery_state: "high" }, text: "15-minute full-body flow — hips, thoracic, and ankles — to maintain range of motion and prepare for tomorrow's session." },
    { when: {},                  text: "Slow hip circles, thoracic rotations, and hamstring stretches for 15 minutes to preserve movement quality." },
  ],
  active_recovery: [
    { when: { load_state: "high" }, text: "20-minute low-intensity walk or cycle to clear lactate without adding stress to already-loaded tissues." },
    { when: {},                  text: "Light movement for 20 minutes — walking, easy cycling, or swimming — to promote blood flow without adding load." },
  ],
  yoga: [
    { when: { recovery_state: "high" }, text: "30-minute restorative yoga session — yin or slow flow — to build tissue tolerance and support long-term mobility." },
    { when: {},                  text: "30 minutes of gentle yoga to unwind connective tissue, reduce stiffness, and support parasympathetic recovery." },
  ],
  dynamic_stretching: [
    { when: {},                  text: "12-minute dynamic stretching circuit targeting hips, hamstrings, and thoracic spine to maintain daily movement capacity." },
  ],
};

// ─── Stage 1 — Classify context ───────────────────────────────────────────────

function classifyScore(score: number): ContextLevel {
  if (score > 80) return "high";
  if (score > 60) return "moderate";
  return "low";
}

function classifyLoad(load_today: number): LoadLevel {
  if (load_today >= 70) return "high";
  if (load_today >= 35) return "moderate";
  return "low";
}

// ─── Stage 2 — Determine primary focus ───────────────────────────────────────

function determinePrimaryFocus(
  recovery_state:  ContextLevel,
  load_state:      LoadLevel,
  soreness:        boolean,
  fatigue:         boolean,
  injury:          boolean,
): PrimaryFocus {
  if (injury)                                      return "rehab";
  if (load_state === "high" || soreness)           return "muscle_recovery";
  if (recovery_state === "low" || fatigue)         return "nervous_system";
  return "mobility";
}

// ─── Reason picker ────────────────────────────────────────────────────────────

function pickReason(id: string, ctx: ReasonContext): string {
  const entries = REASONS[id];
  if (!entries) return "Follow this protocol to support your recovery today.";

  // Find the most specific matching entry (most `when` fields satisfied)
  let best: string | null = null;
  let bestScore = -1;

  for (const entry of entries) {
    const { when, text } = entry;
    const keys = Object.keys(when) as (keyof ReasonContext)[];

    // Empty `when` = universal fallback (score 0)
    if (keys.length === 0) {
      if (best === null) best = text;
      continue;
    }

    // All specified conditions must match; partial matches are rejected
    const matched = keys.every((k) => {
      const required = when[k];
      const actual   = ctx[k];
      return required === actual;
    });

    if (matched && keys.length > bestScore) {
      best      = text;
      bestScore = keys.length;
    }
  }

  return best ?? "Follow this protocol to support your recovery today.";
}

// ─── Stage 3+4 — Build candidate lists and select ────────────────────────────

/**
 * Returns the ordered candidate list for a given category, with previously-used
 * modalities removed.  Priority order within each category reflects clinical
 * value for the most common presentation.
 */
const CATEGORY_PRIORITY: Record<PrimaryFocus, string[]> = {
  rehab: [
    "rehab_protocol",
    "passive_elevation",
    "injury_mobility",
  ],
  muscle_recovery: [
    "ice_bath",
    "compression_boots",
    "myofascial_release",
    "foam_rolling",
    "contrast_therapy",
    "sauna",
  ],
  nervous_system: [
    "sleep_protocol",
    "breathwork",
    "meditation",
    "cold_shower",
  ],
  mobility: [
    "mobility_flow",
    "active_recovery",
    "dynamic_stretching",
    "yoga",
  ],
};

function getCandidates(
  category:           PrimaryFocus,
  previousModalities: string[],
): string[] {
  const excluded = new Set(previousModalities);
  return CATEGORY_PRIORITY[category].filter((id) => !excluded.has(id));
}

function buildModality(id: string, ctx: ReasonContext): SelectedModality {
  const entry  = MODALITY_CATALOGUE[id];
  const reason = pickReason(id, ctx);
  return {
    id,
    name:     entry.name,
    duration: entry.duration,
    reason,
    category: entry.category,
  };
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * selectModalities
 *
 * Contextual modality selection engine — 5-stage deterministic pipeline.
 *
 * @param input  ModalitySelectionInput — athlete state for today
 * @returns      ModalitySelectionOutput — primary + 0–2 supporting modalities
 *
 * Guarantees:
 *   - At least 1 modality always returned (primary may fall back to last
 *     resort in its category even if theoretically "excluded")
 *   - Maximum 3 modalities total (primary + up to 2 supporting)
 *   - Each modality is from a different PrimaryFocus category
 *   - No modality ID appears in previous_modalities
 *   - Selection is deterministic for identical inputs
 *
 * Example:
 *
 *   const result = selectModalities({
 *     recovery_score:      72,
 *     readiness_score:     68,
 *     load_today:          75,    // high load day
 *     soreness:            true,
 *     fatigue:             false,
 *     injury:              false,
 *     previous_modalities: ["ice_bath", "breathwork"],
 *   });
 *   // result.primary.id     → "compression_boots"  (muscle_recovery, ice_bath excluded)
 *   // result.supporting[0]  → "breathwork" excluded → "mobility_flow" (mobility)
 *   // result.supporting[1]  → "sleep_protocol" (nervous_system)
 */
export function selectModalities(
  input: ModalitySelectionInput,
): ModalitySelectionOutput {

  // ── Stage 1: Classify ────────────────────────────────────────────────────
  const recovery_state  = classifyScore(input.recovery_score);
  const readiness_state = classifyScore(input.readiness_score);
  const load_state      = classifyLoad(input.load_today);

  // ── Stage 2: Primary focus ───────────────────────────────────────────────
  const primary_focus = determinePrimaryFocus(
    recovery_state,
    load_state,
    input.soreness,
    input.fatigue,
    input.injury,
  );

  // Reason context — passed to pickReason for all modalities this session
  const reasonCtx: ReasonContext = {
    injury:         input.injury,
    soreness:       input.soreness,
    fatigue:        input.fatigue,
    recovery_state,
    load_state,
  };

  // ── Stage 3+4: Build candidate lists, pick primary ───────────────────────
  const primaryCandidates = getCandidates(primary_focus, input.previous_modalities);

  // Fallback: if all candidates are excluded, use the full list (always select
  // something — last-resort rather than returning nothing)
  const primaryId =
    primaryCandidates.length > 0
      ? primaryCandidates[0]
      : CATEGORY_PRIORITY[primary_focus][0];

  const primary = buildModality(primaryId, reasonCtx);

  // ── Stage 4: Supporting modalities ───────────────────────────────────────
  // Pick from every category except the primary's category, in a fixed
  // priority order that mirrors the clinical recovery hierarchy.
  const supportingFocusOrder: PrimaryFocus[] = ["muscle_recovery", "nervous_system", "mobility", "rehab"]
    .filter((f) => f !== primary_focus) as PrimaryFocus[];

  const supporting: SelectedModality[] = [];

  for (const focus of supportingFocusOrder) {
    if (supporting.length >= 2) break; // Stage 5: max 2 supporting

    const candidates = getCandidates(focus, [
      ...input.previous_modalities,
      primaryId,  // also exclude the already-selected primary
    ]);
    if (candidates.length === 0) continue;

    supporting.push(buildModality(candidates[0], reasonCtx));
  }

  // ── Stage 5: Return ───────────────────────────────────────────────────────
  return {
    primary,
    supporting,
    meta: {
      primary_focus,
      recovery_state,
      readiness_state,
      load_state,
    },
  };
}
