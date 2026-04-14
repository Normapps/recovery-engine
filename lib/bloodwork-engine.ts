/**
 * Bloodwork Scoring Engine — v2
 *
 * Scores ~130 biomarkers across 20 categories using athlete-optimized reference
 * ranges derived from sports medicine and functional medicine literature.
 *
 * Each marker is scored 0–100, then weighted by its relevance to recovery.
 * The overall bloodwork score (0–100) modifies the daily recovery score by
 * up to ±12 points when data is available within the past 90 days.
 *
 * Modifier formula: (score - 50) * 0.24, clamped to [-12, +12]
 */

import type { BloodworkPanel } from "./types";

// ─── Status classifications ────────────────────────────────────────────────

export type MarkerStatus =
  | "optimal"      // green — top tier for athletes
  | "good"         // lime  — healthy, minor room to improve
  | "suboptimal"   // amber — warrants attention
  | "low"          // orange — below range
  | "high"         // orange — above range
  | "critical";    // red — significantly out of range

// ─── Output types ─────────────────────────────────────────────────────────

export interface ScoredMarker {
  key: keyof BloodworkPanel;
  label: string;
  category: string;
  value: number;
  unit: string;
  score: number;        // 0–100
  weight: number;
  status: MarkerStatus;
  optimal: string;
  insight: string;
}

export interface BloodworkAnalysis {
  score: number;
  markerCount: number;
  scoredMarkers: ScoredMarker[];
  topConcerns: ScoredMarker[];    // score < 55
  strengths: ScoredMarker[];      // score >= 90
  recoveryModifier: number;       // ±pts added to daily score
}

// ─── Marker definition type ────────────────────────────────────────────────

interface MarkerDef {
  label: string;
  category: string;
  unit: string;
  optimal: string;
  weight: number;
  score: (v: number) => number;
  status: (v: number) => MarkerStatus;
  insight: (v: number, score: number) => string;
}

// ─── Helper builders ───────────────────────────────────────────────────────

/** Scores a value based on an optimal band with graded falloff */
function bandScore(v: number, lo: number, hi: number): number {
  if (v >= lo && v <= hi) return 100;
  const range = hi - lo;
  const miss = v < lo ? lo - v : v - hi;
  const pct = miss / (range * 0.6);
  return Math.max(0, Math.round(100 - pct * 100));
}

/** Lower is better scorer */
function lowerIsBetter(v: number, great: number, good: number, warn: number, bad: number): number {
  if (v <= great) return 100;
  if (v <= good) return 85;
  if (v <= warn) return 65;
  if (v <= bad) return 40;
  return 15;
}

/** Higher is better scorer */
function higherIsBetter(v: number, bad: number, warn: number, good: number, great: number): number {
  if (v >= great) return 100;
  if (v >= good) return 85;
  if (v >= warn) return 65;
  if (v >= bad) return 40;
  return 15;
}

function bandStatus(v: number, lo: number, hi: number, crit: number): MarkerStatus {
  if (v >= lo && v <= hi) return "optimal";
  const range = hi - lo;
  const miss = v < lo ? lo - v : v - hi;
  if (miss < range * 0.15) return "good";
  if (miss < range * 0.40) return "suboptimal";
  if (v < lo) return miss > crit ? "critical" : "low";
  return miss > crit ? "critical" : "high";
}

// ─── Master marker definitions ─────────────────────────────────────────────

const MARKERS: Partial<Record<keyof BloodworkPanel, MarkerDef>> = {

  // ══════════════════════════════════════════════════════════════════════════
  // 1. OXYGEN DELIVERY & RBC STATUS
  // ══════════════════════════════════════════════════════════════════════════

  rbc: {
    label: "RBC Count", category: "Oxygen Delivery", unit: "M/μL",
    optimal: "4.7–6.1 M/μL", weight: 10,
    score: (v) => bandScore(v, 4.7, 6.1),
    status: (v) => bandStatus(v, 4.7, 6.1, 0.8),
    insight: (v, s) => s >= 90 ? "Excellent RBC count — strong oxygen-carrying capacity." : s >= 65 ? "RBC within acceptable range; minor optimization possible." : v < 4.7 ? "Low RBC may impair aerobic output and tissue oxygenation." : "Elevated RBC — ensure adequate hydration; consider altitude or over-training.",
  },

  hemoglobin: {
    label: "Hemoglobin", category: "Oxygen Delivery", unit: "g/dL",
    optimal: "14.5–17.5 g/dL", weight: 14,
    score: (v) => bandScore(v, 14.5, 17.5),
    status: (v) => bandStatus(v, 14.5, 17.5, 2),
    insight: (v, s) => s >= 90 ? "Hemoglobin is in the athlete-optimal range — peak oxygen delivery." : s >= 65 ? "Hemoglobin is adequate but slight room for improvement." : v < 14.5 ? "Low hemoglobin limits aerobic capacity and muscle recovery." : "High hemoglobin — check hydration; if consistent, investigate polycythemia.",
  },

  hematocrit: {
    label: "Hematocrit", category: "Oxygen Delivery", unit: "%",
    optimal: "42–52%", weight: 10,
    score: (v) => bandScore(v, 42, 52),
    status: (v) => bandStatus(v, 42, 52, 6),
    insight: (v, s) => s >= 90 ? "Hematocrit ideal for oxygen transport." : v < 42 ? "Low hematocrit reduces VO2 potential." : "Elevated hematocrit increases blood viscosity; hydrate well.",
  },

  mcv: {
    label: "MCV", category: "Oxygen Delivery", unit: "fL",
    optimal: "82–92 fL", weight: 6,
    score: (v) => bandScore(v, 82, 92),
    status: (v) => bandStatus(v, 82, 92, 8),
    insight: (v, s) => s >= 90 ? "Normal cell size — healthy red cell morphology." : v < 82 ? "Microcytosis — possible iron deficiency or thalassemia trait." : "Macrocytosis — consider B12 or folate deficiency.",
  },

  mch: {
    label: "MCH", category: "Oxygen Delivery", unit: "pg",
    optimal: "27–33 pg", weight: 5,
    score: (v) => bandScore(v, 27, 33),
    status: (v) => bandStatus(v, 27, 33, 5),
    insight: (v, s) => s >= 90 ? "Normal hemoglobin per cell." : v < 27 ? "Low MCH — hypochromic cells; check iron status." : "High MCH — investigate B12/folate.",
  },

  mchc: {
    label: "MCHC", category: "Oxygen Delivery", unit: "g/dL",
    optimal: "33–35 g/dL", weight: 5,
    score: (v) => bandScore(v, 33, 35),
    status: (v) => bandStatus(v, 33, 35, 2),
    insight: (v, s) => s >= 90 ? "Optimal hemoglobin concentration per cell." : v < 33 ? "Low MCHC — hypochromia, often from iron deficiency." : "High MCHC — possible spherocytosis or overhydration artifact.",
  },

  rdw: {
    label: "RDW", category: "Oxygen Delivery", unit: "%",
    optimal: "<13%", weight: 6,
    score: (v) => lowerIsBetter(v, 12, 13, 14.5, 16),
    status: (v) => v <= 13 ? "optimal" : v <= 14.5 ? "good" : v <= 16 ? "suboptimal" : "high",
    insight: (v, s) => s >= 90 ? "Low RDW — uniform RBC size, healthy erythropoiesis." : s >= 65 ? "Slight RBC size variability — monitor iron and B12." : "High RDW indicates mixed cell populations; investigate nutritional deficiencies or hemolysis.",
  },

  reticulocyteCount: {
    label: "Reticulocyte Count", category: "Oxygen Delivery", unit: "%",
    optimal: "0.5–2.5%", weight: 7,
    score: (v) => bandScore(v, 0.5, 2.5),
    status: (v) => bandStatus(v, 0.5, 2.5, 1),
    insight: (v, s) => s >= 90 ? "Healthy reticulocyte count — bone marrow is producing RBCs efficiently." : v < 0.5 ? "Low reticulocytes suggest suppressed marrow; consider anemia workup." : "Elevated reticulocytes — active hemolysis or acute blood loss response.",
  },

  reticulocyteHb: {
    label: "Reticulocyte Hemoglobin", category: "Oxygen Delivery", unit: "pg",
    optimal: ">29 pg", weight: 8,
    score: (v) => higherIsBetter(v, 24, 27, 29, 31),
    status: (v) => v >= 29 ? "optimal" : v >= 27 ? "good" : v >= 25 ? "suboptimal" : "low",
    insight: (v, s) => s >= 90 ? "Strong reticulocyte Hb — iron supply to marrow is excellent." : s >= 65 ? "Adequate iron supply to marrow; slight room to optimize." : "Low reticulocyte Hb — functional iron deficiency; supplement even if ferritin is normal.",
  },

  epo: {
    label: "Erythropoietin (EPO)", category: "Oxygen Delivery", unit: "mIU/mL",
    optimal: "4–24 mIU/mL", weight: 5,
    score: (v) => bandScore(v, 4, 24),
    status: (v) => bandStatus(v, 4, 24, 10),
    insight: (v, s) => s >= 90 ? "EPO in normal physiological range." : v < 4 ? "Suppressed EPO — may indicate polycythemia." : "Elevated EPO — possible anemia, altitude response, or kidney stress.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 2. IRON STATUS & HANDLING
  // ══════════════════════════════════════════════════════════════════════════

  ferritin: {
    label: "Ferritin", category: "Iron Status", unit: "ng/mL",
    optimal: "80–150 ng/mL", weight: 14,
    score: (v) => bandScore(v, 80, 150),
    status: (v) => bandStatus(v, 80, 150, 30),
    insight: (v, s) => s >= 90 ? "Ferritin in athlete-optimal zone — iron stores are excellent." : s >= 65 ? "Ferritin is acceptable; consider optimizing for peak endurance." : v < 80 ? "Low ferritin depletes energy, VO2, and muscle recovery. Prioritize iron repletion." : "High ferritin may indicate inflammation or hemochromatosis — investigate.",
  },

  ironSerum: {
    label: "Serum Iron", category: "Iron Status", unit: "μg/dL",
    optimal: "80–120 μg/dL", weight: 8,
    score: (v) => bandScore(v, 80, 120),
    status: (v) => bandStatus(v, 80, 120, 30),
    insight: (v, s) => s >= 90 ? "Serum iron in optimal range." : v < 80 ? "Low serum iron — aerobic capacity may be compromised." : "Elevated serum iron — check for overload or hemolysis.",
  },

  transferrin: {
    label: "Transferrin", category: "Iron Status", unit: "mg/dL",
    optimal: "220–300 mg/dL", weight: 5,
    score: (v) => bandScore(v, 220, 300),
    status: (v) => bandStatus(v, 220, 300, 40),
    insight: (v, s) => s >= 90 ? "Transferrin in optimal range — iron transport is healthy." : v < 220 ? "Low transferrin may indicate malnutrition or inflammation." : "High transferrin suggests iron deficiency; correlate with ferritin.",
  },

  tibc: {
    label: "TIBC", category: "Iron Status", unit: "μg/dL",
    optimal: "250–330 μg/dL", weight: 5,
    score: (v) => bandScore(v, 250, 330),
    status: (v) => bandStatus(v, 250, 330, 40),
    insight: (v, s) => s >= 90 ? "Normal iron-binding capacity." : v > 330 ? "High TIBC — indicates iron deficiency." : "Low TIBC — may indicate hemochromatosis or inflammation.",
  },

  tsat: {
    label: "Transferrin Saturation", category: "Iron Status", unit: "%",
    optimal: "25–40%", weight: 9,
    score: (v) => bandScore(v, 25, 40),
    status: (v) => bandStatus(v, 25, 40, 10),
    insight: (v, s) => s >= 90 ? "Transferrin saturation ideal — iron delivery to tissues is efficient." : v < 25 ? "Low TSAT reduces iron delivery; functional deficiency even with normal ferritin." : "High TSAT — risk of iron overload; check for hemochromatosis.",
  },

  stfr: {
    label: "Soluble Transferrin Receptor", category: "Iron Status", unit: "mg/L",
    optimal: "0.83–1.76 mg/L", weight: 7,
    score: (v) => bandScore(v, 0.83, 1.76),
    status: (v) => bandStatus(v, 0.83, 1.76, 0.5),
    insight: (v, s) => s >= 90 ? "sTfR in optimal range — tissue iron demand is normal." : v > 1.76 ? "Elevated sTfR — tissues are iron-hungry; functional iron deficiency likely." : "Low sTfR — iron supply exceeds demand.",
  },

  hepcidin: {
    label: "Hepcidin", category: "Iron Status", unit: "ng/mL",
    optimal: "30–150 ng/mL", weight: 6,
    score: (v) => bandScore(v, 30, 150),
    status: (v) => bandStatus(v, 30, 150, 20),
    insight: (v, s) => s >= 90 ? "Hepcidin in balance — iron absorption and storage are regulated." : v < 30 ? "Low hepcidin allows excess iron absorption; monitor ferritin." : "High hepcidin suppresses iron absorption — common post hard training; time supplementation.",
  },

  haptoglobin: {
    label: "Haptoglobin", category: "Iron Status", unit: "g/L",
    optimal: "0.8–2.0 g/L", weight: 5,
    score: (v) => bandScore(v, 0.8, 2.0),
    status: (v) => bandStatus(v, 0.8, 2.0, 0.4),
    insight: (v, s) => s >= 90 ? "Haptoglobin normal — minimal hemolysis." : v < 0.8 ? "Low haptoglobin — significant intravascular hemolysis; running-related or pathological." : "Elevated haptoglobin — acute phase response or dehydration.",
  },

  indirectBilirubin: {
    label: "Indirect Bilirubin", category: "Iron Status", unit: "mg/dL",
    optimal: "<0.8 mg/dL", weight: 4,
    score: (v) => lowerIsBetter(v, 0.5, 0.8, 1.2, 2.0),
    status: (v) => v <= 0.8 ? "optimal" : v <= 1.2 ? "good" : v <= 2.0 ? "suboptimal" : "high",
    insight: (v, s) => s >= 90 ? "Indirect bilirubin normal — RBC breakdown in check." : "Elevated indirect bilirubin suggests increased RBC hemolysis — common in runners.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 3. MUSCLE DAMAGE & TRAINING STRESS
  // ══════════════════════════════════════════════════════════════════════════

  creatineKinase: {
    label: "Creatine Kinase (CK)", category: "Muscle Damage", unit: "U/L",
    optimal: "<200 U/L (resting)", weight: 12,
    score: (v) => lowerIsBetter(v, 150, 200, 500, 1000),
    status: (v) => v <= 200 ? "optimal" : v <= 500 ? "good" : v <= 1000 ? "suboptimal" : v <= 2000 ? "high" : "critical",
    insight: (v, s) => s >= 90 ? "CK at resting baseline — muscle damage is minimal." : s >= 65 ? "Mildly elevated CK — expected post-training; ensure adequate recovery." : v > 1000 ? "Significantly elevated CK — risk of overtraining or rhabdomyolysis; reduce load immediately." : "Elevated CK — delayed muscle breakdown still active; prioritize recovery modalities.",
  },

  ldh: {
    label: "LDH", category: "Muscle Damage", unit: "U/L",
    optimal: "140–200 U/L", weight: 8,
    score: (v) => bandScore(v, 140, 200),
    status: (v) => bandStatus(v, 140, 200, 50),
    insight: (v, s) => s >= 90 ? "LDH in normal range — tissue breakdown is balanced." : v > 200 ? "Elevated LDH — may indicate muscle, liver, or RBC damage." : "Low LDH — generally benign.",
  },

  myoglobin: {
    label: "Myoglobin", category: "Muscle Damage", unit: "ng/mL",
    optimal: "<85 ng/mL", weight: 9,
    score: (v) => lowerIsBetter(v, 50, 85, 200, 500),
    status: (v) => v <= 85 ? "optimal" : v <= 200 ? "suboptimal" : v <= 500 ? "high" : "critical",
    insight: (v, s) => s >= 90 ? "Myoglobin in safe range — muscle membranes intact." : v > 500 ? "High myoglobin — rhabdomyolysis risk; hydrate aggressively and rest." : "Elevated myoglobin — significant muscle breakdown post-training.",
  },

  ast: {
    label: "AST", category: "Muscle Damage", unit: "U/L",
    optimal: "<25 U/L", weight: 7,
    score: (v) => lowerIsBetter(v, 20, 25, 40, 80),
    status: (v) => v <= 25 ? "optimal" : v <= 40 ? "good" : v <= 80 ? "suboptimal" : "high",
    insight: (v, s) => s >= 90 ? "AST optimal — liver and muscle stress are low." : "Elevated AST in athletes often reflects muscle damage rather than liver stress; correlate with CK.",
  },

  alt: {
    label: "ALT", category: "Muscle Damage", unit: "U/L",
    optimal: "<25 U/L", weight: 7,
    score: (v) => lowerIsBetter(v, 20, 25, 40, 80),
    status: (v) => v <= 25 ? "optimal" : v <= 40 ? "good" : v <= 80 ? "suboptimal" : "high",
    insight: (v, s) => s >= 90 ? "ALT optimal — minimal hepatocellular stress." : "Elevated ALT suggests liver strain; evaluate alcohol, supplements, and training load.",
  },

  aldolase: {
    label: "Aldolase", category: "Muscle Damage", unit: "U/L",
    optimal: "1.5–7.5 U/L", weight: 5,
    score: (v) => bandScore(v, 1.5, 7.5),
    status: (v) => bandStatus(v, 1.5, 7.5, 3),
    insight: (v, s) => s >= 90 ? "Aldolase normal — glycolytic muscle enzyme turnover is healthy." : v > 7.5 ? "Elevated aldolase — muscle breakdown above baseline; increase recovery days." : "Low aldolase — benign.",
  },

  troponin: {
    label: "Troponin I (cardiac)", category: "Muscle Damage", unit: "ng/L",
    optimal: "<26 ng/L (resting)", weight: 10,
    score: (v) => lowerIsBetter(v, 14, 26, 52, 100),
    status: (v) => v <= 26 ? "optimal" : v <= 52 ? "suboptimal" : "critical",
    insight: (v, s) => s >= 90 ? "Troponin within resting normal — cardiac stress minimal." : v > 52 ? "Elevated resting troponin warrants cardiology review — do not dismiss as exercise-related." : "Mildly elevated troponin post-intense exercise; confirm trend with repeat test in 48h.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 4. SYSTEMIC INFLAMMATION
  // ══════════════════════════════════════════════════════════════════════════

  hsCRP: {
    label: "hs-CRP", category: "Inflammation", unit: "mg/L",
    optimal: "<0.5 mg/L", weight: 15,
    score: (v) => lowerIsBetter(v, 0.3, 0.5, 1.0, 3.0),
    status: (v) => v <= 0.5 ? "optimal" : v <= 1.0 ? "good" : v <= 3.0 ? "suboptimal" : "high",
    insight: (v, s) => s >= 90 ? "hs-CRP in elite range — systemic inflammation is suppressed." : s >= 65 ? "Mild inflammation present; evaluate sleep quality and nutrition." : "Elevated hs-CRP significantly impairs recovery and adaptation — prioritize anti-inflammatory interventions.",
  },

  il6: {
    label: "Interleukin-6 (IL-6)", category: "Inflammation", unit: "pg/mL",
    optimal: "<2 pg/mL", weight: 10,
    score: (v) => lowerIsBetter(v, 1, 2, 5, 10),
    status: (v) => v <= 2 ? "optimal" : v <= 5 ? "suboptimal" : "high",
    insight: (v, s) => s >= 90 ? "IL-6 suppressed — acute inflammatory response is controlled." : "Elevated IL-6 drives systemic fatigue and catabolism; review training load and sleep.",
  },

  tnfAlpha: {
    label: "TNF-α", category: "Inflammation", unit: "pg/mL",
    optimal: "<3 pg/mL", weight: 8,
    score: (v) => lowerIsBetter(v, 2, 3, 6, 12),
    status: (v) => v <= 3 ? "optimal" : v <= 6 ? "suboptimal" : "high",
    insight: (v, s) => s >= 90 ? "TNF-α well controlled — pro-inflammatory cytokines in check." : "Elevated TNF-α impairs protein synthesis and sleep quality; reduce inflammatory load.",
  },

  fibrinogen: {
    label: "Fibrinogen", category: "Inflammation", unit: "mg/dL",
    optimal: "200–350 mg/dL", weight: 6,
    score: (v) => bandScore(v, 200, 350),
    status: (v) => bandStatus(v, 200, 350, 80),
    insight: (v, s) => s >= 90 ? "Fibrinogen in optimal range — coagulation and acute phase balanced." : v > 350 ? "Elevated fibrinogen — acute phase response or chronic inflammation." : "Low fibrinogen — may indicate coagulation disorder; investigate.",
  },

  esr: {
    label: "ESR", category: "Inflammation", unit: "mm/hr",
    optimal: "<10 mm/hr", weight: 7,
    score: (v) => lowerIsBetter(v, 5, 10, 20, 40),
    status: (v) => v <= 10 ? "optimal" : v <= 20 ? "good" : v <= 40 ? "suboptimal" : "high",
    insight: (v, s) => s >= 90 ? "ESR minimal — inflammation absent." : "Elevated ESR is a non-specific marker of inflammation; combine with hs-CRP for context.",
  },

  serumAmyloidA: {
    label: "Serum Amyloid A", category: "Inflammation", unit: "mg/L",
    optimal: "<6.4 mg/L", weight: 6,
    score: (v) => lowerIsBetter(v, 3, 6.4, 10, 20),
    status: (v) => v <= 6.4 ? "optimal" : v <= 10 ? "suboptimal" : "high",
    insight: (v, s) => s >= 90 ? "SAA normal — acute phase proteins controlled." : "Elevated SAA — potent acute phase reactant; investigate chronic infection or inflammatory trigger.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 5. STRESS, HORMONES & ANABOLIC-CATABOLIC BALANCE
  // ══════════════════════════════════════════════════════════════════════════

  cortisolAM: {
    label: "Cortisol (AM)", category: "Stress & Hormones", unit: "μg/dL",
    optimal: "10–18 μg/dL", weight: 12,
    score: (v) => bandScore(v, 10, 18),
    status: (v) => bandStatus(v, 10, 18, 4),
    insight: (v, s) => s >= 90 ? "AM cortisol in optimal athlete range — HPA axis healthy." : v < 10 ? "Low AM cortisol — possible adrenal fatigue or HPA suppression; evaluate training load." : "Elevated AM cortisol — chronic stress or overtraining; prioritize sleep and stress management.",
  },

  cortisolPM: {
    label: "Cortisol (PM)", category: "Stress & Hormones", unit: "μg/dL",
    optimal: "2–6 μg/dL", weight: 8,
    score: (v) => bandScore(v, 2, 6),
    status: (v) => bandStatus(v, 2, 6, 3),
    insight: (v, s) => s >= 90 ? "PM cortisol appropriately suppressed — diurnal rhythm is healthy." : v > 6 ? "Elevated evening cortisol disrupts sleep architecture and recovery." : "Very low PM cortisol — may indicate adrenal insufficiency.",
  },

  testosteroneTotal: {
    label: "Testosterone (Total)", category: "Stress & Hormones", unit: "ng/dL",
    optimal: "600–1000 ng/dL", weight: 14,
    score: (v) => { if (v >= 600 && v <= 1200) return 100; if (v >= 450) return 80; if (v >= 300) return 55; if (v >= 200) return 30; return 10; },
    status: (v) => v >= 600 && v <= 1200 ? "optimal" : v >= 450 ? "good" : v >= 300 ? "suboptimal" : v >= 200 ? "low" : "critical",
    insight: (v, s) => s >= 90 ? "Excellent anabolic drive — supports muscle repair and recovery." : s >= 65 ? "Good testosterone; supports recovery with room for optimization." : v < 300 ? "Low testosterone significantly impairs recovery, tissue repair, and motivation." : "Suboptimal testosterone — evaluate sleep quality, zinc, vitamin D, and training volume.",
  },

  testosteroneFree: {
    label: "Testosterone (Free)", category: "Stress & Hormones", unit: "pg/mL",
    optimal: "15–25 pg/mL", weight: 11,
    score: (v) => bandScore(v, 15, 25),
    status: (v) => bandStatus(v, 15, 25, 7),
    insight: (v, s) => s >= 90 ? "Free testosterone in prime range — bioavailable androgen is excellent." : v < 15 ? "Low free testosterone — check SHBG; even normal total T may be biologically inactive." : "High free testosterone — verify SHBG is not suppressed.",
  },

  shbg: {
    label: "SHBG", category: "Stress & Hormones", unit: "nmol/L",
    optimal: "20–40 nmol/L", weight: 8,
    score: (v) => bandScore(v, 20, 40),
    status: (v) => bandStatus(v, 20, 40, 15),
    insight: (v, s) => s >= 90 ? "SHBG in optimal range — testosterone bioavailability balanced." : v > 40 ? "High SHBG binds testosterone, reducing free fraction; may blunt anabolic recovery." : "Low SHBG associated with insulin resistance; correlate with fasting glucose.",
  },

  dheas: {
    label: "DHEA-S", category: "Stress & Hormones", unit: "μg/dL",
    optimal: "200–400 μg/dL", weight: 9,
    score: (v) => bandScore(v, 200, 400),
    status: (v) => bandStatus(v, 200, 400, 80),
    insight: (v, s) => s >= 90 ? "DHEA-S in optimal range — adrenal vitality is strong." : v < 200 ? "Low DHEA-S — adrenal reserve may be compromised; key anabolic precursor depleted." : "High DHEA-S — generally favorable but check for adrenal hyperplasia.",
  },

  acth: {
    label: "ACTH", category: "Stress & Hormones", unit: "pg/mL",
    optimal: "10–40 pg/mL", weight: 6,
    score: (v) => bandScore(v, 10, 40),
    status: (v) => bandStatus(v, 10, 40, 15),
    insight: (v, s) => s >= 90 ? "ACTH in physiological range — pituitary-adrenal axis healthy." : v < 10 ? "Suppressed ACTH — evaluate pituitary function." : "Elevated ACTH drives cortisol chronically; investigate stressors.",
  },

  gh: {
    label: "Growth Hormone (GH)", category: "Stress & Hormones", unit: "ng/mL",
    optimal: "<1 ng/mL (fasting)", weight: 7,
    score: (v) => lowerIsBetter(v, 0.5, 1.0, 3.0, 10),
    status: (v) => v <= 1.0 ? "optimal" : v <= 3.0 ? "good" : "suboptimal",
    insight: (v, s) => s >= 90 ? "Fasting GH in normal range — pulsatile release pattern is healthy." : "Elevated fasting GH may reflect acute stress; GH pulses are highest during deep sleep.",
  },

  igf1: {
    label: "IGF-1", category: "Stress & Hormones", unit: "ng/mL",
    optimal: "150–250 ng/mL", weight: 10,
    score: (v) => bandScore(v, 150, 250),
    status: (v) => bandStatus(v, 150, 250, 60),
    insight: (v, s) => s >= 90 ? "IGF-1 in athlete-optimal range — anabolic signaling and tissue repair are primed." : v < 150 ? "Low IGF-1 reduces protein synthesis and recovery capacity; optimize sleep and protein intake." : "High IGF-1 — strong anabolic state; monitor if >350 for growth factor excess.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 6. THYROID & METABOLIC RATE
  // ══════════════════════════════════════════════════════════════════════════

  tsh: {
    label: "TSH", category: "Thyroid", unit: "mIU/L",
    optimal: "0.5–2.0 mIU/L", weight: 12,
    score: (v) => bandScore(v, 0.5, 2.0),
    status: (v) => bandStatus(v, 0.5, 2.0, 1.5),
    insight: (v, s) => s >= 90 ? "TSH in functional optimal range — thyroid regulation is healthy." : v > 2.0 ? "Elevated TSH — subclinical hypothyroidism may blunt metabolic rate, energy, and recovery." : "Suppressed TSH — hyperthyroid tendency; can cause overtraining-like symptoms.",
  },

  freeT4: {
    label: "Free T4", category: "Thyroid", unit: "ng/dL",
    optimal: "1.1–1.6 ng/dL", weight: 9,
    score: (v) => bandScore(v, 1.1, 1.6),
    status: (v) => bandStatus(v, 1.1, 1.6, 0.3),
    insight: (v, s) => s >= 90 ? "Free T4 in optimal range — thyroid hormone production is adequate." : v < 1.1 ? "Low free T4 — thyroid output insufficient; correlate with TSH and symptoms." : "High free T4 — hyperthyroid state possible; evaluate.",
  },

  freeT3: {
    label: "Free T3", category: "Thyroid", unit: "pg/mL",
    optimal: "3.2–4.2 pg/mL", weight: 11,
    score: (v) => bandScore(v, 3.2, 4.2),
    status: (v) => bandStatus(v, 3.2, 4.2, 0.5),
    insight: (v, s) => s >= 90 ? "Free T3 in athlete-optimal range — active thyroid hormone is excellent." : v < 3.2 ? "Low free T3 — active thyroid hormone depleted; energy, recovery, and thermogenesis impaired." : "High free T3 — accelerated catabolism and cardiac stress; evaluate.",
  },

  reverseT3: {
    label: "Reverse T3", category: "Thyroid", unit: "ng/dL",
    optimal: "<15 ng/dL", weight: 8,
    score: (v) => lowerIsBetter(v, 10, 15, 20, 30),
    status: (v) => v <= 15 ? "optimal" : v <= 20 ? "suboptimal" : "high",
    insight: (v, s) => s >= 90 ? "Reverse T3 low — thyroid conversion is efficient, not shunting to inactive form." : "Elevated rT3 indicates metabolic stress, chronic illness, or caloric restriction — blunts active T3 effect.",
  },

  tpoAb: {
    label: "TPO Antibodies", category: "Thyroid", unit: "IU/mL",
    optimal: "<35 IU/mL", weight: 8,
    score: (v) => lowerIsBetter(v, 20, 35, 100, 500),
    status: (v) => v <= 35 ? "optimal" : v <= 100 ? "suboptimal" : "high",
    insight: (v, s) => s >= 90 ? "No significant thyroid autoimmunity detected." : "Elevated TPO antibodies indicate Hashimoto's autoimmunity — optimize selenium, vitamin D, and gut health.",
  },

  tgAb: {
    label: "Thyroglobulin Antibodies", category: "Thyroid", unit: "IU/mL",
    optimal: "<20 IU/mL", weight: 6,
    score: (v) => lowerIsBetter(v, 10, 20, 100, 300),
    status: (v) => v <= 20 ? "optimal" : v <= 100 ? "suboptimal" : "high",
    insight: (v, s) => s >= 90 ? "Thyroglobulin antibodies negative — no thyroid autoimmunity." : "Positive TgAb — Hashimoto's or Graves' disease possible; work up with physician.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 7. GLUCOSE REGULATION & FUEL
  // ══════════════════════════════════════════════════════════════════════════

  glucoseFasting: {
    label: "Fasting Glucose", category: "Glucose Regulation", unit: "mg/dL",
    optimal: "72–90 mg/dL", weight: 12,
    score: (v) => bandScore(v, 72, 90),
    status: (v) => bandStatus(v, 72, 90, 15),
    insight: (v, s) => s >= 90 ? "Fasting glucose in athlete-optimal zone — insulin sensitivity is excellent." : v > 100 ? "Impaired fasting glucose — insulin resistance emerging; prioritize carb timing and sleep." : v < 72 ? "Low fasting glucose — ensure adequate pre-sleep fueling and carbohydrate availability." : "Slightly suboptimal glucose — optimize meal timing and carbohydrate strategy.",
  },

  insulin: {
    label: "Fasting Insulin", category: "Glucose Regulation", unit: "μIU/mL",
    optimal: "<5 μIU/mL", weight: 11,
    score: (v) => lowerIsBetter(v, 3, 5, 10, 20),
    status: (v) => v <= 5 ? "optimal" : v <= 10 ? "good" : v <= 20 ? "suboptimal" : "high",
    insight: (v, s) => s >= 90 ? "Fasting insulin excellent — insulin sensitivity is peak." : s >= 65 ? "Insulin mildly elevated; reduce refined carbohydrates around rest periods." : "Elevated fasting insulin — significant insulin resistance impairs fat oxidation and recovery.",
  },

  hba1c: {
    label: "HbA1c", category: "Glucose Regulation", unit: "%",
    optimal: "<5.3%", weight: 10,
    score: (v) => lowerIsBetter(v, 4.8, 5.3, 5.7, 6.4),
    status: (v) => v <= 5.3 ? "optimal" : v <= 5.7 ? "good" : v <= 6.4 ? "suboptimal" : "high",
    insight: (v, s) => s >= 90 ? "HbA1c in optimal range — long-term glycemic control is excellent." : v > 5.7 ? "Pre-diabetic HbA1c range — significantly impacts recovery, inflammation, and body composition." : "Slightly elevated HbA1c; audit carbohydrate sources and sleep quality.",
  },

  lactateFasting: {
    label: "Fasting Lactate", category: "Glucose Regulation", unit: "mmol/L",
    optimal: "0.5–1.5 mmol/L", weight: 7,
    score: (v) => bandScore(v, 0.5, 1.5),
    status: (v) => bandStatus(v, 0.5, 1.5, 0.5),
    insight: (v, s) => s >= 90 ? "Resting lactate normal — mitochondrial efficiency is healthy." : v > 1.5 ? "Elevated resting lactate — possible mitochondrial dysfunction or insufficient carb metabolism." : "Low resting lactate — typically favorable; ensure adequate glycogen availability.",
  },

  betaHydroxybutyrate: {
    label: "β-Hydroxybutyrate", category: "Glucose Regulation", unit: "mmol/L",
    optimal: "<0.3 mmol/L (fed)", weight: 5,
    score: (v) => lowerIsBetter(v, 0.15, 0.3, 1.0, 3.0),
    status: (v) => v <= 0.3 ? "optimal" : v <= 1.0 ? "good" : "suboptimal",
    insight: (v, s) => s >= 90 ? "BHB low in fed state — not in significant ketosis; glycogen-fueled metabolism." : v > 1.0 ? "Elevated BHB — significant fat/ketone metabolism; ensure adequate muscle glycogen for performance." : "Mild ketone production — may indicate caloric restriction or low carbohydrate intake.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 8. PROTEIN STATUS & LIVER FUNCTION
  // ══════════════════════════════════════════════════════════════════════════

  albumin: {
    label: "Albumin", category: "Liver & Protein", unit: "g/dL",
    optimal: "4.2–5.0 g/dL", weight: 10,
    score: (v) => bandScore(v, 4.2, 5.0),
    status: (v) => bandStatus(v, 4.2, 5.0, 0.5),
    insight: (v, s) => s >= 90 ? "Albumin in optimal range — protein status and liver function are excellent." : v < 4.2 ? "Low albumin indicates poor protein status or liver compromise — impacts drug transport and recovery." : "High albumin — usually dehydration; ensure adequate fluid intake.",
  },

  totalProtein: {
    label: "Total Protein", category: "Liver & Protein", unit: "g/dL",
    optimal: "7.0–8.0 g/dL", weight: 7,
    score: (v) => bandScore(v, 7.0, 8.0),
    status: (v) => bandStatus(v, 7.0, 8.0, 0.8),
    insight: (v, s) => s >= 90 ? "Total protein in optimal range — circulating protein pools are healthy." : v < 7.0 ? "Low total protein — evaluate dietary protein and liver function." : "High total protein — investigate globulin fraction; may indicate infection or dysproteinemia.",
  },

  ggt: {
    label: "GGT", category: "Liver & Protein", unit: "U/L",
    optimal: "<20 U/L", weight: 8,
    score: (v) => lowerIsBetter(v, 15, 20, 40, 80),
    status: (v) => v <= 20 ? "optimal" : v <= 40 ? "good" : v <= 80 ? "suboptimal" : "high",
    insight: (v, s) => s >= 90 ? "GGT minimal — hepatic and biliary stress is absent." : "Elevated GGT is sensitive to alcohol, oxidative stress, and supplement load — review intake.",
  },

  alp: {
    label: "ALP", category: "Liver & Protein", unit: "U/L",
    optimal: "40–100 U/L", weight: 5,
    score: (v) => bandScore(v, 40, 100),
    status: (v) => bandStatus(v, 40, 100, 40),
    insight: (v, s) => s >= 90 ? "ALP in normal range — liver and bone metabolism balanced." : v > 100 ? "Elevated ALP — could indicate liver, bone turnover, or vitamin D deficiency." : "Low ALP — may reflect zinc or magnesium deficiency.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 9. KIDNEY FUNCTION & HYDRATION
  // ══════════════════════════════════════════════════════════════════════════

  creatinine: {
    label: "Creatinine", category: "Kidney & Hydration", unit: "mg/dL",
    optimal: "0.8–1.1 mg/dL", weight: 8,
    score: (v) => bandScore(v, 0.8, 1.1),
    status: (v) => bandStatus(v, 0.8, 1.1, 0.3),
    insight: (v, s) => s >= 90 ? "Creatinine in optimal range — kidney filtration is healthy." : v > 1.2 ? "Elevated creatinine — watch hydration and kidney function; can also elevate post high protein intake." : "Low creatinine may indicate low muscle mass.",
  },

  cystatinC: {
    label: "Cystatin C", category: "Kidney & Hydration", unit: "mg/L",
    optimal: "0.5–0.8 mg/L", weight: 9,
    score: (v) => bandScore(v, 0.5, 0.8),
    status: (v) => bandStatus(v, 0.5, 0.8, 0.2),
    insight: (v, s) => s >= 90 ? "Cystatin C optimal — GFR is healthy, unaffected by muscle mass." : v > 0.8 ? "Elevated cystatin C — more accurate GFR indicator than creatinine; renal function declining." : "Low cystatin C — generally favorable.",
  },

  egfr: {
    label: "eGFR (Creatinine)", category: "Kidney & Hydration", unit: "mL/min",
    optimal: ">90 mL/min", weight: 8,
    score: (v) => higherIsBetter(v, 45, 60, 75, 90),
    status: (v) => v >= 90 ? "optimal" : v >= 75 ? "good" : v >= 60 ? "suboptimal" : "low",
    insight: (v, s) => s >= 90 ? "eGFR excellent — kidney filtration rate is optimal." : "Reduced eGFR — monitor hydration, protein intake, and NSAID use.",
  },

  bun: {
    label: "BUN", category: "Kidney & Hydration", unit: "mg/dL",
    optimal: "10–20 mg/dL", weight: 7,
    score: (v) => bandScore(v, 10, 20),
    status: (v) => bandStatus(v, 10, 20, 8),
    insight: (v, s) => s >= 90 ? "BUN in optimal range — nitrogen balance is healthy." : v > 20 ? "Elevated BUN — possible dehydration, high protein intake, or kidney stress." : "Low BUN may indicate low protein intake or poor liver function.",
  },

  uricAcid: {
    label: "Uric Acid", category: "Kidney & Hydration", unit: "mg/dL",
    optimal: "3.5–6.0 mg/dL", weight: 7,
    score: (v) => bandScore(v, 3.5, 6.0),
    status: (v) => bandStatus(v, 3.5, 6.0, 1.5),
    insight: (v, s) => s >= 90 ? "Uric acid in optimal range — purine metabolism balanced." : v > 6.0 ? "Elevated uric acid — increases inflammation, gout risk, and impairs nitric oxide production." : "Low uric acid — consider antioxidant status; urate is also an antioxidant.",
  },

  sodium: {
    label: "Sodium", category: "Kidney & Hydration", unit: "mEq/L",
    optimal: "136–142 mEq/L", weight: 8,
    score: (v) => bandScore(v, 136, 142),
    status: (v) => bandStatus(v, 136, 142, 4),
    insight: (v, s) => s >= 90 ? "Sodium balanced — hydration and electrolyte status are optimal." : v < 136 ? "Hyponatremia — over-hydration or sodium losses from sweat; critical for endurance athletes." : "Hypernatremia — dehydration; increase fluid intake.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 10. ELECTROLYTES & NEUROMUSCULAR RECOVERY
  // ══════════════════════════════════════════════════════════════════════════

  potassium: {
    label: "Potassium", category: "Electrolytes", unit: "mEq/L",
    optimal: "4.0–4.8 mEq/L", weight: 9,
    score: (v) => bandScore(v, 4.0, 4.8),
    status: (v) => bandStatus(v, 4.0, 4.8, 0.5),
    insight: (v, s) => s >= 90 ? "Potassium in optimal range — muscle function and cardiac rhythm are well-supported." : v < 4.0 ? "Low potassium causes cramping, weakness, and arrhythmia risk — increase vegetable and electrolyte intake." : "Elevated potassium — evaluate kidney function and supplement excess.",
  },

  magnesium: {
    label: "Magnesium", category: "Electrolytes", unit: "mg/dL",
    optimal: "2.1–2.5 mg/dL", weight: 12,
    score: (v) => bandScore(v, 2.1, 2.5),
    status: (v) => bandStatus(v, 2.1, 2.5, 0.3),
    insight: (v, s) => s >= 90 ? "Magnesium in optimal range — sleep, neuromuscular function, and over 300 enzymatic reactions supported." : v < 2.1 ? "Low serum magnesium — impairs sleep quality, increases cramping risk, and blunts protein synthesis. Consider glycinate/malate form." : "Elevated magnesium — check supplement intake.",
  },

  calciumTotal: {
    label: "Calcium (Total)", category: "Electrolytes", unit: "mg/dL",
    optimal: "9.0–10.2 mg/dL", weight: 7,
    score: (v) => bandScore(v, 9.0, 10.2),
    status: (v) => bandStatus(v, 9.0, 10.2, 0.8),
    insight: (v, s) => s >= 90 ? "Calcium in normal range — bone and neuromuscular health supported." : v < 9.0 ? "Low calcium — impairs muscle contraction and bone health." : "Elevated calcium — investigate vitamin D toxicity, hyperparathyroidism.",
  },

  ionizedCalcium: {
    label: "Ionized Calcium", category: "Electrolytes", unit: "mmol/L",
    optimal: "1.15–1.30 mmol/L", weight: 8,
    score: (v) => bandScore(v, 1.15, 1.30),
    status: (v) => bandStatus(v, 1.15, 1.30, 0.1),
    insight: (v, s) => s >= 90 ? "Ionized calcium ideal — biologically active calcium is optimal." : v < 1.15 ? "Low ionized calcium impairs muscle contractility and nerve function." : "High ionized calcium — investigate parathyroid activity.",
  },

  bicarbonate: {
    label: "Bicarbonate (CO2)", category: "Electrolytes", unit: "mEq/L",
    optimal: "24–28 mEq/L", weight: 7,
    score: (v) => bandScore(v, 24, 28),
    status: (v) => bandStatus(v, 24, 28, 3),
    insight: (v, s) => s >= 90 ? "Bicarbonate in optimal range — acid-base buffering capacity is healthy." : v < 24 ? "Low bicarbonate — metabolic acidosis tendency; impairs high-intensity performance." : "Elevated bicarbonate — metabolic alkalosis; check hydration.",
  },

  phosphate: {
    label: "Phosphate", category: "Electrolytes", unit: "mg/dL",
    optimal: "2.5–4.5 mg/dL", weight: 6,
    score: (v) => bandScore(v, 2.5, 4.5),
    status: (v) => bandStatus(v, 2.5, 4.5, 1),
    insight: (v, s) => s >= 90 ? "Phosphate balanced — ATP synthesis and bone mineralization supported." : v < 2.5 ? "Low phosphate impairs ATP production and bone density." : "High phosphate — evaluate kidney function and vitamin D.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 11. BONE HEALTH & VITAMIN D
  // ══════════════════════════════════════════════════════════════════════════

  vitaminD: {
    label: "Vitamin D (25-OH)", category: "Bone & Vitamin D", unit: "ng/mL",
    optimal: "50–80 ng/mL", weight: 13,
    score: (v) => bandScore(v, 50, 80),
    status: (v) => bandStatus(v, 50, 80, 20),
    insight: (v, s) => s >= 90 ? "Vitamin D in athlete-optimal range — immune function, testosterone, and bone health are supported." : v < 30 ? "Severely deficient vitamin D — impairs immune function, testosterone production, muscle recovery, and bone density." : v < 50 ? "Suboptimal vitamin D — supplement with 2000–5000 IU D3+K2 daily; target 60–70 ng/mL." : "Excellent vitamin D status.",
  },

  pth: {
    label: "Parathyroid Hormone (PTH)", category: "Bone & Vitamin D", unit: "pg/mL",
    optimal: "15–50 pg/mL", weight: 7,
    score: (v) => bandScore(v, 15, 50),
    status: (v) => bandStatus(v, 15, 50, 15),
    insight: (v, s) => s >= 90 ? "PTH in optimal range — calcium/vitamin D regulation is healthy." : v > 50 ? "Elevated PTH — investigate calcium and vitamin D deficiency; secondary hyperparathyroidism blunts bone density." : "Low PTH — may reflect high calcium or vitamin D excess.",
  },

  p1np: {
    label: "P1NP (bone formation)", category: "Bone & Vitamin D", unit: "ng/mL",
    optimal: "25–74 ng/mL", weight: 6,
    score: (v) => bandScore(v, 25, 74),
    status: (v) => bandStatus(v, 25, 74, 20),
    insight: (v, s) => s >= 90 ? "P1NP in optimal range — active bone formation is healthy." : v < 25 ? "Low P1NP — bone formation suppressed; optimize vitamin D, calcium, and loading exercise." : "High P1NP — rapid bone turnover; could be post-fracture or high PTH.",
  },

  ctx1: {
    label: "CTX-1 (bone resorption)", category: "Bone & Vitamin D", unit: "pg/mL",
    optimal: "100–400 pg/mL", weight: 5,
    score: (v) => bandScore(v, 100, 400),
    status: (v) => bandStatus(v, 100, 400, 150),
    insight: (v, s) => s >= 90 ? "CTX-1 bone resorption in normal range — bone remodeling balanced." : v > 400 ? "High bone resorption — evaluate vitamin D, calcium, estrogen/testosterone, and RED-S risk." : "Low CTX-1 — minimal bone resorption.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 12. LIPIDS & CARDIOMETABOLIC HEALTH
  // ══════════════════════════════════════════════════════════════════════════

  totalCholesterol: {
    label: "Total Cholesterol", category: "Lipids", unit: "mg/dL",
    optimal: "160–200 mg/dL", weight: 7,
    score: (v) => bandScore(v, 160, 200),
    status: (v) => bandStatus(v, 160, 200, 30),
    insight: (v, s) => s >= 90 ? "Total cholesterol in optimal range for athletes." : v < 160 ? "Very low cholesterol may compromise testosterone and hormone synthesis." : "Elevated total cholesterol — evaluate particle quality via apoB and LDL-P.",
  },

  ldl: {
    label: "LDL Cholesterol", category: "Lipids", unit: "mg/dL",
    optimal: "<100 mg/dL", weight: 8,
    score: (v) => lowerIsBetter(v, 70, 100, 130, 160),
    status: (v) => v <= 100 ? "optimal" : v <= 130 ? "good" : v <= 160 ? "suboptimal" : "high",
    insight: (v, s) => s >= 90 ? "LDL in optimal range — cardiovascular risk is low." : "Elevated LDL — use apoB for particle count; standard LDL underestimates risk in athletes.",
  },

  hdl: {
    label: "HDL Cholesterol", category: "Lipids", unit: "mg/dL",
    optimal: ">55 mg/dL (male)", weight: 9,
    score: (v) => higherIsBetter(v, 35, 45, 55, 70),
    status: (v) => v >= 55 ? "optimal" : v >= 45 ? "good" : v >= 35 ? "suboptimal" : "low",
    insight: (v, s) => s >= 90 ? "HDL elevated — excellent cardiovascular protection and reverse cholesterol transport." : "Low HDL — associated with metabolic syndrome; aerobic exercise is the most potent HDL elevator.",
  },

  triglycerides: {
    label: "Triglycerides", category: "Lipids", unit: "mg/dL",
    optimal: "<100 mg/dL", weight: 8,
    score: (v) => lowerIsBetter(v, 70, 100, 150, 200),
    status: (v) => v <= 100 ? "optimal" : v <= 150 ? "good" : v <= 200 ? "suboptimal" : "high",
    insight: (v, s) => s >= 90 ? "Triglycerides in excellent range — fat metabolism and insulin sensitivity are optimal." : "Elevated triglycerides — reduce refined carbohydrates; strong marker of insulin resistance.",
  },

  apob: {
    label: "ApoB", category: "Lipids", unit: "mg/dL",
    optimal: "<80 mg/dL", weight: 9,
    score: (v) => lowerIsBetter(v, 60, 80, 100, 130),
    status: (v) => v <= 80 ? "optimal" : v <= 100 ? "good" : v <= 130 ? "suboptimal" : "high",
    insight: (v, s) => s >= 90 ? "ApoB excellent — atherogenic particle count is low." : "Elevated ApoB is the most accurate predictor of cardiovascular risk; prioritize reduction.",
  },

  lipoproteinA: {
    label: "Lipoprotein(a)", category: "Lipids", unit: "mg/dL",
    optimal: "<30 mg/dL", weight: 7,
    score: (v) => lowerIsBetter(v, 20, 30, 50, 80),
    status: (v) => v <= 30 ? "optimal" : v <= 50 ? "suboptimal" : "high",
    insight: (v, s) => s >= 90 ? "Lp(a) in low-risk range." : "Elevated Lp(a) is largely genetic and significantly increases cardiovascular risk — discuss with physician.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 13. MICRONUTRIENTS
  // ══════════════════════════════════════════════════════════════════════════

  vitaminB12: {
    label: "Vitamin B12", category: "Micronutrients", unit: "pg/mL",
    optimal: "400–900 pg/mL", weight: 11,
    score: (v) => bandScore(v, 400, 900),
    status: (v) => bandStatus(v, 400, 900, 150),
    insight: (v, s) => s >= 90 ? "B12 in athlete-optimal range — methylation, neurological function, and RBC synthesis are supported." : v < 300 ? "Low B12 causes fatigue, impaired methylation, and neurological symptoms." : v < 400 ? "Suboptimal B12 — supplement methylcobalamin to reach 600–800 pg/mL." : "High B12 — often from supplementation; generally safe.",
  },

  folate: {
    label: "Serum Folate", category: "Micronutrients", unit: "ng/mL",
    optimal: ">10 ng/mL", weight: 8,
    score: (v) => higherIsBetter(v, 4, 7, 10, 15),
    status: (v) => v >= 10 ? "optimal" : v >= 7 ? "good" : v >= 4 ? "suboptimal" : "low",
    insight: (v, s) => s >= 90 ? "Folate in optimal range — one-carbon metabolism is well-supported." : "Low folate impairs DNA synthesis, RBC maturation, and methylation — increase leafy greens or supplement with methylfolate.",
  },

  vitaminB6: {
    label: "Vitamin B6 (P5P)", category: "Micronutrients", unit: "nmol/L",
    optimal: "25–80 nmol/L", weight: 7,
    score: (v) => bandScore(v, 25, 80),
    status: (v) => bandStatus(v, 25, 80, 20),
    insight: (v, s) => s >= 90 ? "B6 (P5P) in optimal range — neurotransmitter synthesis and amino acid metabolism are healthy." : v < 25 ? "Low B6 impairs serotonin, GABA, and dopamine synthesis — impacts sleep and mood." : "High B6 — evaluate for neuropathy risk if > 200 nmol/L.",
  },

  zinc: {
    label: "Zinc", category: "Micronutrients", unit: "μg/dL",
    optimal: "85–120 μg/dL", weight: 11,
    score: (v) => bandScore(v, 85, 120),
    status: (v) => bandStatus(v, 85, 120, 20),
    insight: (v, s) => s >= 90 ? "Zinc in athlete-optimal range — immune function, testosterone, and wound healing are supported." : v < 70 ? "Low zinc significantly impairs testosterone production, immune defense, and protein synthesis." : v < 85 ? "Suboptimal zinc — supplement 15–30 mg elemental zinc with food." : "High zinc — check for copper depletion; zinc and copper compete for absorption.",
  },

  selenium: {
    label: "Selenium", category: "Micronutrients", unit: "μg/L",
    optimal: "120–200 μg/L", weight: 8,
    score: (v) => bandScore(v, 120, 200),
    status: (v) => bandStatus(v, 120, 200, 40),
    insight: (v, s) => s >= 90 ? "Selenium in optimal range — thyroid conversion and antioxidant defense are well-supported." : v < 80 ? "Low selenium impairs glutathione peroxidase and thyroid T4→T3 conversion." : v > 250 ? "High selenium can cause selenosis; reduce supplementation." : "Suboptimal selenium — Brazil nuts (2/day) or 100–200 μg selenomethionine.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 14. OXIDATIVE STRESS & ANTIOXIDANT DEFENSE
  // ══════════════════════════════════════════════════════════════════════════

  mda: {
    label: "Malondialdehyde (MDA)", category: "Oxidative Stress", unit: "μmol/L",
    optimal: "<0.5 μmol/L", weight: 8,
    score: (v) => lowerIsBetter(v, 0.3, 0.5, 1.0, 2.0),
    status: (v) => v <= 0.5 ? "optimal" : v <= 1.0 ? "suboptimal" : "high",
    insight: (v, s) => s >= 90 ? "MDA low — lipid peroxidation is minimal; cell membranes are protected." : "Elevated MDA indicates significant oxidative damage — increase colorful vegetables, omega-3s, and sleep.",
  },

  totalAntioxidantCapacity: {
    label: "Total Antioxidant Capacity", category: "Oxidative Stress", unit: "mmol/L",
    optimal: ">1.5 mmol/L", weight: 8,
    score: (v) => higherIsBetter(v, 0.8, 1.2, 1.5, 2.0),
    status: (v) => v >= 1.5 ? "optimal" : v >= 1.2 ? "good" : v >= 0.8 ? "suboptimal" : "low",
    insight: (v, s) => s >= 90 ? "Total antioxidant capacity is excellent — oxidative stress well-buffered." : "Low antioxidant capacity — increase polyphenols, vitamin C, E, and glutathione precursors.",
  },

  reducedGlutathione: {
    label: "Reduced Glutathione (GSH)", category: "Oxidative Stress", unit: "μmol/L",
    optimal: ">800 μmol/L", weight: 9,
    score: (v) => higherIsBetter(v, 500, 650, 800, 1000),
    status: (v) => v >= 800 ? "optimal" : v >= 650 ? "good" : v >= 500 ? "suboptimal" : "low",
    insight: (v, s) => s >= 90 ? "Glutathione in excellent range — master antioxidant and detoxification are robust." : "Low glutathione impairs immune function, mitochondrial output, and post-exercise recovery — optimize with N-acetylcysteine, glycine, and sleep.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 15. FATTY ACIDS & MEMBRANE HEALTH
  // ══════════════════════════════════════════════════════════════════════════

  omega3Index: {
    label: "Omega-3 Index", category: "Fatty Acids", unit: "%",
    optimal: ">8%", weight: 10,
    score: (v) => higherIsBetter(v, 4, 6, 8, 10),
    status: (v) => v >= 8 ? "optimal" : v >= 6 ? "good" : v >= 4 ? "suboptimal" : "low",
    insight: (v, s) => s >= 90 ? "Omega-3 index in optimal zone — cell membrane fluidity and anti-inflammatory signaling are excellent." : v < 4 ? "Very low omega-3 index — strongly pro-inflammatory; supplementation urgently needed (2–4g EPA+DHA daily)." : "Suboptimal omega-3 — target >8% for cardiovascular and recovery benefits.",
  },

  epa: {
    label: "EPA", category: "Fatty Acids", unit: "%",
    optimal: ">1.5%", weight: 7,
    score: (v) => higherIsBetter(v, 0.5, 1.0, 1.5, 2.5),
    status: (v) => v >= 1.5 ? "optimal" : v >= 1.0 ? "good" : v >= 0.5 ? "suboptimal" : "low",
    insight: (v, s) => s >= 90 ? "EPA in optimal range — eicosanoid anti-inflammatory signaling is robust." : "Low EPA drives inflammatory prostaglandins — supplement with quality fish oil.",
  },

  dha: {
    label: "DHA", category: "Fatty Acids", unit: "%",
    optimal: ">4.5%", weight: 8,
    score: (v) => higherIsBetter(v, 2, 3.5, 4.5, 6),
    status: (v) => v >= 4.5 ? "optimal" : v >= 3.5 ? "good" : v >= 2 ? "suboptimal" : "low",
    insight: (v, s) => s >= 90 ? "DHA in excellent range — neurological function and membrane integrity are well-supported." : "Low DHA impairs brain recovery, mood regulation, and membrane plasticity.",
  },

  arachidonicAcid: {
    label: "Arachidonic Acid (AA)", category: "Fatty Acids", unit: "%",
    optimal: "8–12%", weight: 6,
    score: (v) => bandScore(v, 8, 12),
    status: (v) => bandStatus(v, 8, 12, 4),
    insight: (v, s) => s >= 90 ? "AA in optimal range — pro-inflammatory signaling for training adaptation is balanced." : v > 12 ? "High arachidonic acid shifts prostaglandin balance toward inflammation." : "Low AA — ensure adequate dietary omega-6 for anabolic signaling.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 16. REPRODUCTIVE HORMONES & RED-S SCREENING
  // ══════════════════════════════════════════════════════════════════════════

  lh: {
    label: "LH", category: "Reproductive Hormones", unit: "mIU/mL",
    optimal: "2–8 mIU/mL", weight: 7,
    score: (v) => bandScore(v, 2, 8),
    status: (v) => bandStatus(v, 2, 8, 3),
    insight: (v, s) => s >= 90 ? "LH in normal range — pituitary gonadotropin signaling is healthy." : v < 2 ? "Low LH — possible functional hypothalamic suppression from energy deficit or overtraining." : "High LH — investigate gonadal insufficiency.",
  },

  estradiol: {
    label: "Estradiol (E2)", category: "Reproductive Hormones", unit: "pg/mL",
    optimal: "20–35 pg/mL (male)", weight: 8,
    score: (v) => bandScore(v, 20, 35),
    status: (v) => bandStatus(v, 20, 35, 12),
    insight: (v, s) => s >= 90 ? "Estradiol in optimal male range — bone density, joint health, and libido supported." : v < 20 ? "Low estradiol in males impairs bone density, joint lubrication, and mood." : "High estradiol — evaluate aromatase activity; correlate with body fat and testosterone.",
  },

  prolactin: {
    label: "Prolactin", category: "Reproductive Hormones", unit: "ng/mL",
    optimal: "2–15 ng/mL", weight: 7,
    score: (v) => bandScore(v, 2, 15),
    status: (v) => bandStatus(v, 2, 15, 8),
    insight: (v, s) => s >= 90 ? "Prolactin in normal range — pituitary function is balanced." : v > 20 ? "Elevated prolactin suppresses testosterone and GH; investigate chronic stress and microadenoma." : "Low prolactin — generally benign.",
  },

  leptin: {
    label: "Leptin", category: "Reproductive Hormones", unit: "ng/mL",
    optimal: "2–10 ng/mL (male)", weight: 8,
    score: (v) => bandScore(v, 2, 10),
    status: (v) => bandStatus(v, 2, 10, 4),
    insight: (v, s) => s >= 90 ? "Leptin in optimal range — energy balance signals are healthy." : v < 2 ? "Low leptin — energy deficiency signal; thyroid, reproductive, and immune function may be suppressed." : "High leptin suggests leptin resistance — correlate with insulin and adiposity.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 17. CONNECTIVE TISSUE & REPAIR BIOLOGY
  // ══════════════════════════════════════════════════════════════════════════

  piiinp: {
    label: "P-III-NP (collagen synthesis)", category: "Connective Tissue", unit: "ng/mL",
    optimal: "3–8 ng/mL", weight: 7,
    score: (v) => bandScore(v, 3, 8),
    status: (v) => bandStatus(v, 3, 8, 3),
    insight: (v, s) => s >= 90 ? "P-III-NP in optimal range — connective tissue synthesis is active and balanced." : v < 3 ? "Low P-III-NP — collagen production is suppressed; consider vitamin C, glycine, and loading protocols." : "Elevated P-III-NP — high connective tissue turnover post-injury or intense loading.",
  },

  hyaluronicAcid: {
    label: "Hyaluronic Acid", category: "Connective Tissue", unit: "ng/mL",
    optimal: "<50 ng/mL", weight: 5,
    score: (v) => lowerIsBetter(v, 30, 50, 100, 200),
    status: (v) => v <= 50 ? "optimal" : v <= 100 ? "suboptimal" : "high",
    insight: (v, s) => s >= 90 ? "Hyaluronic acid in normal range — joint and tissue hydration are balanced." : "Elevated hyaluronic acid indicates liver fibrosis or joint inflammation.",
  },

  mmp3: {
    label: "MMP-3 (matrix remodeling)", category: "Connective Tissue", unit: "ng/mL",
    optimal: "5–25 ng/mL", weight: 5,
    score: (v) => bandScore(v, 5, 25),
    status: (v) => bandStatus(v, 5, 25, 10),
    insight: (v, s) => s >= 90 ? "MMP-3 in normal range — extracellular matrix remodeling is balanced." : v > 25 ? "Elevated MMP-3 indicates active matrix breakdown; may reflect joint overload or inflammation." : "Low MMP-3 — reduced connective tissue remodeling.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 18. WHITE BLOOD CELLS & IMMUNE READINESS
  // ══════════════════════════════════════════════════════════════════════════

  wbc: {
    label: "WBC (Total)", category: "Immune & WBC", unit: "K/μL",
    optimal: "5.0–8.0 K/μL", weight: 8,
    score: (v) => bandScore(v, 5.0, 8.0),
    status: (v) => bandStatus(v, 5.0, 8.0, 2),
    insight: (v, s) => s >= 90 ? "WBC count in optimal range — immune system is neither suppressed nor overactivated." : v < 4.0 ? "Low WBC — immune suppression; common with overtraining; reduce load and optimize recovery." : v > 10 ? "High WBC — possible infection or inflammatory response." : "WBC slightly outside optimal; monitor trend.",
  },

  neutrophils: {
    label: "Neutrophils", category: "Immune & WBC", unit: "K/μL",
    optimal: "2.0–6.0 K/μL", weight: 6,
    score: (v) => bandScore(v, 2.0, 6.0),
    status: (v) => bandStatus(v, 2.0, 6.0, 1.5),
    insight: (v, s) => s >= 90 ? "Neutrophil count optimal — first-line immune defense is healthy." : v < 1.5 ? "Neutropenia — significantly reduced infection defense; rest and reduce training load." : "Neutrophilia — active infection or inflammatory stress.",
  },

  lymphocytes: {
    label: "Lymphocytes", category: "Immune & WBC", unit: "K/μL",
    optimal: "1.5–3.5 K/μL", weight: 7,
    score: (v) => bandScore(v, 1.5, 3.5),
    status: (v) => bandStatus(v, 1.5, 3.5, 0.8),
    insight: (v, s) => s >= 90 ? "Lymphocyte count optimal — adaptive immunity is healthy." : v < 1.5 ? "Low lymphocytes — overtraining immune suppression window; high infection risk post hard session." : "High lymphocytes — viral response or chronic inflammation.",
  },

  platelets: {
    label: "Platelets", category: "Immune & WBC", unit: "K/μL",
    optimal: "200–350 K/μL", weight: 6,
    score: (v) => bandScore(v, 200, 350),
    status: (v) => bandStatus(v, 200, 350, 80),
    insight: (v, s) => s >= 90 ? "Platelet count in normal range — coagulation and repair are well-supported." : v < 150 ? "Thrombocytopenia — significant bleeding risk; investigate cause." : "Thrombocytosis — reactive (infection/inflammation) or essential; evaluate.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 19. VASCULAR, COAGULATION & ENDOTHELIAL FUNCTION
  // ══════════════════════════════════════════════════════════════════════════

  homocysteine: {
    label: "Homocysteine", category: "Vascular & Coagulation", unit: "μmol/L",
    optimal: "<8 μmol/L", weight: 10,
    score: (v) => lowerIsBetter(v, 6, 8, 12, 18),
    status: (v) => v <= 8 ? "optimal" : v <= 12 ? "good" : v <= 18 ? "suboptimal" : "high",
    insight: (v, s) => s >= 90 ? "Homocysteine in optimal range — methylation and vascular health are excellent." : v > 15 ? "High homocysteine is strongly pro-atherosclerotic and impairs methylation — supplement B12, B6, and methylfolate." : "Elevated homocysteine — optimize methylation nutrients (B12, folate, B6).",
  },

  dDimer: {
    label: "D-Dimer", category: "Vascular & Coagulation", unit: "μg/mL",
    optimal: "<0.5 μg/mL", weight: 7,
    score: (v) => lowerIsBetter(v, 0.3, 0.5, 1.0, 2.0),
    status: (v) => v <= 0.5 ? "optimal" : v <= 1.0 ? "suboptimal" : "high",
    insight: (v, s) => s >= 90 ? "D-dimer low — no significant clot formation or breakdown." : "Elevated D-dimer — possible thrombotic activity, recent exercise, or systemic inflammation; clinical evaluation needed.",
  },

  nitricOxide: {
    label: "Nitric Oxide (metabolites)", category: "Vascular & Coagulation", unit: "μmol/L",
    optimal: "30–70 μmol/L", weight: 9,
    score: (v) => bandScore(v, 30, 70),
    status: (v) => bandStatus(v, 30, 70, 15),
    insight: (v, s) => s >= 90 ? "Nitric oxide in optimal range — vasodilation, blood flow, and O2 delivery are maximized." : v < 30 ? "Low NO bioavailability impairs vasodilation and exercise performance — increase dietary nitrates (beetroot, leafy greens) and L-arginine/citrulline." : "Very high NO — generally positive but verify accuracy of measurement.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 20. ADVANCED: MITOCHONDRIAL, METABOLIC & GUT MARKERS
  // ══════════════════════════════════════════════════════════════════════════

  adiponectin: {
    label: "Adiponectin", category: "Advanced Biomarkers", unit: "μg/mL",
    optimal: ">10 μg/mL", weight: 8,
    score: (v) => higherIsBetter(v, 4, 7, 10, 15),
    status: (v) => v >= 10 ? "optimal" : v >= 7 ? "good" : v >= 4 ? "suboptimal" : "low",
    insight: (v, s) => s >= 90 ? "Adiponectin high — excellent insulin sensitivity, anti-inflammatory, and metabolic health." : "Low adiponectin is a potent marker of metabolic dysfunction and cardiovascular risk.",
  },

  gdf15: {
    label: "GDF-15 (mitochondrial stress)", category: "Advanced Biomarkers", unit: "pg/mL",
    optimal: "<300 pg/mL", weight: 7,
    score: (v) => lowerIsBetter(v, 200, 300, 600, 1200),
    status: (v) => v <= 300 ? "optimal" : v <= 600 ? "suboptimal" : "high",
    insight: (v, s) => s >= 90 ? "GDF-15 in low range — mitochondrial stress and systemic catabolism are minimal." : "Elevated GDF-15 signals mitochondrial dysfunction, metabolic stress, or systemic disease — evaluate training load and nutrition.",
  },

  bdnf: {
    label: "BDNF", category: "Advanced Biomarkers", unit: "ng/mL",
    optimal: ">25 ng/mL", weight: 7,
    score: (v) => higherIsBetter(v, 10, 18, 25, 35),
    status: (v) => v >= 25 ? "optimal" : v >= 18 ? "good" : v >= 10 ? "suboptimal" : "low",
    insight: (v, s) => s >= 90 ? "BDNF elevated — neuroplasticity, mood, and cognitive recovery are well-supported." : "Low BDNF is associated with depression, poor neuromotor recovery, and impaired skill learning — aerobic exercise acutely elevates BDNF.",
  },

  zonulin: {
    label: "Zonulin (gut barrier)", category: "Advanced Biomarkers", unit: "ng/mL",
    optimal: "<30 ng/mL", weight: 7,
    score: (v) => lowerIsBetter(v, 20, 30, 60, 100),
    status: (v) => v <= 30 ? "optimal" : v <= 60 ? "suboptimal" : "high",
    insight: (v, s) => s >= 90 ? "Zonulin in normal range — intestinal barrier integrity is healthy." : "Elevated zonulin indicates increased gut permeability ('leaky gut') — drives systemic inflammation that impairs recovery.",
  },
};

// ─── Core analysis function ────────────────────────────────────────────────

export function analyzeBloodwork(panel: BloodworkPanel): BloodworkAnalysis {
  const scored: ScoredMarker[] = [];
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [key, def] of Object.entries(MARKERS) as [keyof BloodworkPanel, MarkerDef][]) {
    const value = panel[key];
    if (value === null || value === undefined) continue;

    const score = Math.max(0, Math.min(100, def.score(value)));
    const status = def.status(value);
    const insight = def.insight(value, score);

    scored.push({
      key,
      label: def.label,
      category: def.category,
      value,
      unit: def.unit,
      score,
      weight: def.weight,
      status,
      optimal: def.optimal,
      insight,
    });

    weightedSum += score * def.weight;
    totalWeight += def.weight;
  }

  const overallScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 50;
  const recoveryModifier = Math.max(-12, Math.min(12, Math.round((overallScore - 50) * 0.24)));

  return {
    score: overallScore,
    markerCount: scored.length,
    scoredMarkers: scored.sort((a, b) => a.score - b.score),
    topConcerns: scored.filter((m) => m.score < 55).sort((a, b) => a.score - b.score).slice(0, 5),
    strengths: scored.filter((m) => m.score >= 90).sort((a, b) => b.score - a.score).slice(0, 5),
    recoveryModifier,
  };
}

// ─── Status helpers ────────────────────────────────────────────────────────

export function getStatusColor(status: MarkerStatus): string {
  switch (status) {
    case "optimal": return "#22C55E";
    case "good": return "#84CC16";
    case "suboptimal": return "#F59E0B";
    case "low": return "#F97316";
    case "high": return "#F97316";
    case "critical": return "#EF4444";
  }
}

export function getStatusLabel(status: MarkerStatus): string {
  switch (status) {
    case "optimal": return "Optimal";
    case "good": return "Good";
    case "suboptimal": return "Suboptimal";
    case "low": return "Low";
    case "high": return "High";
    case "critical": return "Critical";
  }
}

// ─── CSV import/export ─────────────────────────────────────────────────────

export const CSV_ALIASES: Record<string, keyof BloodworkPanel> = {
  // RBC
  rbc: "rbc", "red blood cell count": "rbc", "red blood cells": "rbc",
  hemoglobin: "hemoglobin", hgb: "hemoglobin", hb: "hemoglobin",
  hematocrit: "hematocrit", hct: "hematocrit", pcv: "hematocrit",
  mcv: "mcv", "mean corpuscular volume": "mcv",
  mch: "mch", "mean corpuscular hemoglobin": "mch",
  mchc: "mchc", "mean corpuscular hemoglobin concentration": "mchc",
  rdw: "rdw", "red cell distribution width": "rdw",
  "reticulocyte count": "reticulocyteCount", reticulocytes: "reticulocyteCount",
  "reticulocyte hemoglobin": "reticulocyteHb", "retic hb": "reticulocyteHb",
  epo: "epo", erythropoietin: "epo",
  // Iron
  ferritin: "ferritin",
  "serum iron": "ironSerum", iron: "ironSerum",
  transferrin: "transferrin",
  tibc: "tibc", "total iron binding capacity": "tibc",
  uibc: "uibc",
  tsat: "tsat", "transferrin saturation": "tsat",
  stfr: "stfr", "soluble transferrin receptor": "stfr",
  hepcidin: "hepcidin",
  haptoglobin: "haptoglobin",
  "indirect bilirubin": "indirectBilirubin", "indirect bili": "indirectBilirubin",
  // Muscle damage
  "creatine kinase": "creatineKinase", ck: "creatineKinase", cpk: "creatineKinase",
  ldh: "ldh", "lactate dehydrogenase": "ldh",
  myoglobin: "myoglobin",
  ast: "ast", "aspartate aminotransferase": "ast", sgot: "ast",
  alt: "alt", "alanine aminotransferase": "alt", sgpt: "alt",
  aldolase: "aldolase",
  troponin: "troponin", "troponin i": "troponin",
  // Inflammation
  "hs-crp": "hsCRP", hscrp: "hsCRP", crp: "hsCRP", "c-reactive protein": "hsCRP", "high sensitivity crp": "hsCRP",
  "il-6": "il6", "interleukin 6": "il6", "interleukin-6": "il6",
  "tnf-alpha": "tnfAlpha", "tnf alpha": "tnfAlpha", "tumor necrosis factor": "tnfAlpha",
  fibrinogen: "fibrinogen",
  esr: "esr", "erythrocyte sedimentation rate": "esr", "sed rate": "esr",
  "serum amyloid a": "serumAmyloidA", saa: "serumAmyloidA",
  // Stress/hormones
  "cortisol am": "cortisolAM", "cortisol morning": "cortisolAM", "cortisol (am)": "cortisolAM",
  "cortisol pm": "cortisolPM", "cortisol evening": "cortisolPM",
  "testosterone total": "testosteroneTotal", "total testosterone": "testosteroneTotal", testosterone: "testosteroneTotal",
  "testosterone free": "testosteroneFree", "free testosterone": "testosteroneFree",
  shbg: "shbg", "sex hormone binding globulin": "shbg",
  "dhea-s": "dheas", dheas: "dheas", "dehydroepiandrosterone sulfate": "dheas",
  acth: "acth", "adrenocorticotropic hormone": "acth",
  gh: "gh", "growth hormone": "gh",
  igf1: "igf1", "igf-1": "igf1", "insulin-like growth factor 1": "igf1",
  // Thyroid
  tsh: "tsh", "thyroid stimulating hormone": "tsh",
  "free t4": "freeT4", ft4: "freeT4",
  "free t3": "freeT3", ft3: "freeT3",
  "total t4": "totalT4", t4: "totalT4", thyroxine: "totalT4",
  "total t3": "totalT3", t3: "totalT3", triiodothyronine: "totalT3",
  "reverse t3": "reverseT3", rt3: "reverseT3",
  "tpo antibodies": "tpoAb", "thyroid peroxidase antibodies": "tpoAb", tpoab: "tpoAb",
  "thyroglobulin antibodies": "tgAb", tgab: "tgAb",
  // Glucose
  "fasting glucose": "glucoseFasting", glucose: "glucoseFasting", "blood glucose": "glucoseFasting",
  "fasting insulin": "insulin", insulin: "insulin",
  "hba1c": "hba1c", "hemoglobin a1c": "hba1c", "a1c": "hba1c",
  "c-peptide": "cPeptide", "c peptide": "cPeptide",
  fructosamine: "fructosamine",
  "fasting lactate": "lactateFasting", lactate: "lactateFasting",
  "beta-hydroxybutyrate": "betaHydroxybutyrate", bhb: "betaHydroxybutyrate",
  // Liver/protein
  albumin: "albumin",
  "total protein": "totalProtein",
  ggt: "ggt", "gamma-glutamyl transferase": "ggt",
  alp: "alp", "alkaline phosphatase": "alp",
  "total bilirubin": "totalBilirubin", "total bili": "totalBilirubin",
  "direct bilirubin": "directBilirubin", "direct bili": "directBilirubin",
  // Kidney
  creatinine: "creatinine",
  "cystatin c": "cystatinC",
  egfr: "egfr", "estimated gfr": "egfr",
  "egfr cystatin c": "egfrCystatinC",
  bun: "bun", "blood urea nitrogen": "bun", urea: "bun",
  "uric acid": "uricAcid",
  "plasma osmolality": "plasmaOsmolality", osmolality: "plasmaOsmolality",
  sodium: "sodium", na: "sodium",
  // Electrolytes
  potassium: "potassium", k: "potassium",
  chloride: "chloride", cl: "chloride",
  bicarbonate: "bicarbonate", co2: "bicarbonate", "carbon dioxide": "bicarbonate",
  calcium: "calciumTotal", "total calcium": "calciumTotal",
  "ionized calcium": "ionizedCalcium",
  magnesium: "magnesium", mg: "magnesium",
  phosphate: "phosphate", phosphorus: "phosphate",
  // Bone/Vit D
  "vitamin d": "vitaminD", "25-oh vitamin d": "vitaminD", "vitamin d 25-oh": "vitaminD",
  "1,25 vitamin d": "vitaminD125",
  pth: "pth", "parathyroid hormone": "pth",
  p1np: "p1np",
  ctx1: "ctx1", "ctx-1": "ctx1",
  osteocalcin: "osteocalcin",
  // Lipids
  "total cholesterol": "totalCholesterol", cholesterol: "totalCholesterol",
  ldl: "ldl", "ldl cholesterol": "ldl",
  hdl: "hdl", "hdl cholesterol": "hdl",
  triglycerides: "triglycerides", tg: "triglycerides",
  apob: "apob", "apolipoprotein b": "apob",
  apoa1: "apoA1", "apolipoprotein a1": "apoA1",
  "lipoprotein a": "lipoproteinA", "lp(a)": "lipoproteinA",
  // Micronutrients
  "vitamin b12": "vitaminB12", b12: "vitaminB12", cobalamin: "vitaminB12",
  folate: "folate", "serum folate": "folate", "folic acid": "folate",
  "rbc folate": "rbcFolate",
  "vitamin b6": "vitaminB6", b6: "vitaminB6", "pyridoxal phosphate": "vitaminB6",
  "vitamin b1": "vitaminB1", thiamine: "vitaminB1", b1: "vitaminB1",
  zinc: "zinc",
  copper: "copper",
  selenium: "selenium",
  // Oxidative stress
  mda: "mda", malondialdehyde: "mda",
  "total antioxidant capacity": "totalAntioxidantCapacity", tac: "totalAntioxidantCapacity",
  "glutathione": "reducedGlutathione", gsh: "reducedGlutathione",
  // Fatty acids
  "omega-3 index": "omega3Index", "omega 3 index": "omega3Index",
  epa: "epa",
  dha: "dha",
  "arachidonic acid": "arachidonicAcid", aa: "arachidonicAcid",
  // Reproductive
  lh: "lh", "luteinizing hormone": "lh",
  fsh: "fsh", "follicle stimulating hormone": "fsh",
  estradiol: "estradiol", e2: "estradiol",
  progesterone: "progesterone",
  prolactin: "prolactin",
  leptin: "leptin",
  ghrelin: "ghrelin",
  // Connective tissue
  "p-iii-np": "piiinp", piiinp: "piiinp",
  comp: "comp",
  "hyaluronic acid": "hyaluronicAcid",
  "mmp-3": "mmp3",
  "mmp-9": "mmp9",
  // Immune/WBC
  wbc: "wbc", "white blood cell count": "wbc", "white blood cells": "wbc",
  neutrophils: "neutrophils",
  lymphocytes: "lymphocytes",
  monocytes: "monocytes",
  eosinophils: "eosinophils",
  basophils: "basophils",
  platelets: "platelets", "platelet count": "platelets",
  mpv: "mpv", "mean platelet volume": "mpv",
  // Vascular
  homocysteine: "homocysteine",
  "d-dimer": "dDimer", ddimer: "dDimer",
  "pt/inr": "ptInr", inr: "ptInr",
  "von willebrand factor": "vonWillebrandFactor",
  "nitric oxide": "nitricOxide", no: "nitricOxide",
  vegf: "vegf",
  // Advanced
  adiponectin: "adiponectin",
  resistin: "resistin",
  "gdf-15": "gdf15", gdf15: "gdf15",
  bdnf: "bdnf",
  "fgf-21": "fgf21", fgf21: "fgf21",
  "lps binding protein": "lpsBp", lpsbp: "lpsBp",
  zonulin: "zonulin",
};

export function parseBloodworkCSV(text: string): Partial<BloodworkPanel> {
  const panel: Partial<BloodworkPanel> = {};
  const lines = text.trim().split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim() || line.startsWith("#")) continue;
    const parts = line.split(",");
    if (parts.length < 2) continue;

    const rawKey = parts[0].trim().toLowerCase();
    // Extract only the first numeric token that is followed by whitespace or end-of-string.
    // This rejects test-name numbers like "25" in "Vitamin D, 25-OH 65 ng/mL"
    // because "25" is followed by "-", not whitespace.
    const firstNum = parts[1].trim().match(/^([0-9]+\.?[0-9]*)(?=\s|$)/);
    if (!firstNum) continue;
    const numVal = parseFloat(firstNum[1]);
    if (isNaN(numVal)) continue;

    const fieldKey = CSV_ALIASES[rawKey];
    if (fieldKey) {
      (panel as Record<string, number>)[fieldKey] = numVal;
    }
  }

  return panel;
}

export function generateCSVTemplate(): string {
  const lines = ["# Recovery Engine — Lab Results CSV Template", "# Format: marker_name,value", "# Leave blank or delete rows you don't have", ""];

  const grouped: Record<string, string[]> = {};
  for (const [key, def] of Object.entries(MARKERS) as [keyof BloodworkPanel, MarkerDef][]) {
    if (!grouped[def.category]) grouped[def.category] = [];
    grouped[def.category].push(`${key.toLowerCase()},   # ${def.label} (${def.unit}) — Optimal: ${def.optimal}`);
  }

  for (const [cat, rows] of Object.entries(grouped)) {
    lines.push(`# ── ${cat} ──`);
    lines.push(...rows);
    lines.push("");
  }

  return lines.join("\n");
}
