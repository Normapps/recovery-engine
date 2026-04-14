// ─── Core domain types ──────────────────────────────────────────────────────

export type CoachMode = "hardcore" | "balanced" | "recovery";

export type RecoveryTier = "low" | "mid" | "high";

export type ConfidenceLevel = "Low" | "Medium" | "High";

// ─── Daily entry ─────────────────────────────────────────────────────────────

export interface SleepData {
  duration: number | null;        // hours (e.g. 7.5)
  qualityRating: number | null;   // 1–5
  hrv: number | null;             // ms (e.g. 65)
  restingHR: number | null;       // bpm (e.g. 52)
  bodyBattery: number | null;     // 0–100 (optional)
}

export interface NutritionData {
  calories: number | null;
  protein: number | null;         // grams
  hydration: number | null;       // oz
  notes: string;
}

export interface TrainingData {
  strengthTraining: boolean;
  strengthDuration: number | null;  // minutes
  cardio: boolean;
  cardioDuration: number | null;    // minutes
  coreWork: boolean;
  mobility: boolean;
}

export interface RecoveryModalities {
  iceBath: boolean;
  sauna: boolean;
  compression: boolean;           // Normatec etc.
  massage: boolean;
}

export interface DailyEntry {
  id: string;
  date: string;                   // ISO date string YYYY-MM-DD
  sleep: SleepData;
  nutrition: NutritionData;
  training: TrainingData;
  recovery: RecoveryModalities;
  createdAt: string;
  updatedAt: string;
}

// ─── Recovery score ───────────────────────────────────────────────────────────

export interface ScoreBreakdown {
  sleep: number;        // 0–100 subscore
  hrv: number;          // 0–100 subscore
  training: number;     // 0–100 subscore (load vs recovery balance)
  nutrition: number;    // 0–100 subscore
  modalities: number;   // 0–100 subscore
  bloodwork?: number;   // 0–100 subscore, present when bloodwork modifier applied
}

export interface RecoveryScore {
  id: string;
  date: string;
  calculatedScore: number;        // 0–100
  adjustedScore: number | null;   // manual override
  breakdown: ScoreBreakdown;
  confidence: ConfidenceLevel;
  dataCompleteness: number;       // 0–1
}

// ─── Bloodwork ───────────────────────────────────────────────────────────────
// 20 categories · ~130 biomarkers

export interface BloodworkPanel {
  // ── 1. Oxygen delivery & RBC status ──────────────────────────────────────
  rbc: number | null;                   // M/μL    — male optimal: 4.7–6.1
  hemoglobin: number | null;            // g/dL    — male optimal: 14.5–17.5
  hematocrit: number | null;            // %       — male optimal: 42–52
  mcv: number | null;                   // fL      — optimal: 82–92
  mch: number | null;                   // pg      — optimal: 27–33
  mchc: number | null;                  // g/dL    — optimal: 33–35
  rdw: number | null;                   // %       — optimal: <13
  reticulocyteCount: number | null;     // %       — optimal: 0.5–2.5
  reticulocyteHb: number | null;        // pg      — optimal: >29
  epo: number | null;                   // mIU/mL  — normal: 4–24

  // ── 2. Iron status & handling ─────────────────────────────────────────────
  ferritin: number | null;              // ng/mL   — male optimal: 80–150
  ironSerum: number | null;             // μg/dL   — optimal: 80–120
  transferrin: number | null;           // mg/dL   — optimal: 220–300
  tibc: number | null;                  // μg/dL   — optimal: 250–330
  uibc: number | null;                  // μg/dL   — optimal: 100–200
  tsat: number | null;                  // %       — optimal: 25–40
  stfr: number | null;                  // mg/L    — optimal: 0.83–1.76
  hepcidin: number | null;              // ng/mL   — optimal: 30–150
  haptoglobin: number | null;           // g/L     — optimal: 0.8–2.0
  indirectBilirubin: number | null;     // mg/dL   — optimal: <0.8

  // ── 3. Muscle damage & training stress ────────────────────────────────────
  creatineKinase: number | null;        // U/L     — resting optimal: <200
  ldh: number | null;                   // U/L     — optimal: 140–200
  myoglobin: number | null;             // ng/mL   — optimal: <85
  ast: number | null;                   // U/L     — optimal: <25
  alt: number | null;                   // U/L     — optimal: <25
  aldolase: number | null;              // U/L     — optimal: 1.5–7.5
  troponin: number | null;              // ng/L    — optimal: <26 (resting)

  // ── 4. Systemic inflammation & acute-phase response ───────────────────────
  hsCRP: number | null;                 // mg/L    — optimal: <0.5
  il6: number | null;                   // pg/mL   — optimal: <2
  tnfAlpha: number | null;              // pg/mL   — optimal: <3
  fibrinogen: number | null;            // mg/dL   — optimal: 200–350
  esr: number | null;                   // mm/hr   — optimal: <10
  serumAmyloidA: number | null;         // mg/L    — optimal: <6.4

  // ── 5. Stress, anabolic-catabolic balance & overreaching ──────────────────
  cortisolAM: number | null;            // μg/dL   — optimal: 10–18
  cortisolPM: number | null;            // μg/dL   — optimal: 2–6
  testosteroneTotal: number | null;     // ng/dL   — male optimal: 600–1000
  testosteroneFree: number | null;      // pg/mL   — male optimal: 15–25
  shbg: number | null;                  // nmol/L  — male optimal: 20–40
  dheas: number | null;                 // μg/dL   — male optimal: 200–400
  acth: number | null;                  // pg/mL   — optimal: 10–40
  gh: number | null;                    // ng/mL   — fasting: <1 (pulsatile)
  igf1: number | null;                  // ng/mL   — athlete optimal: 150–250

  // ── 6. Thyroid & metabolic-rate regulation ────────────────────────────────
  tsh: number | null;                   // mIU/L   — optimal: 0.5–2.0
  freeT4: number | null;                // ng/dL   — optimal: 1.1–1.6
  freeT3: number | null;                // pg/mL   — optimal: 3.2–4.2
  totalT4: number | null;               // μg/dL   — optimal: 6.5–10
  totalT3: number | null;               // ng/dL   — optimal: 100–180
  reverseT3: number | null;             // ng/dL   — optimal: <15
  tpoAb: number | null;                 // IU/mL   — optimal: <35
  tgAb: number | null;                  // IU/mL   — optimal: <20

  // ── 7. Glucose regulation & carbohydrate availability ─────────────────────
  glucoseFasting: number | null;        // mg/dL   — optimal: 72–90
  insulin: number | null;              // μIU/mL  — optimal: <5
  hba1c: number | null;                 // %       — optimal: <5.3
  cPeptide: number | null;              // ng/mL   — optimal: 0.8–2.0
  fructosamine: number | null;          // μmol/L  — optimal: 190–240
  lactateFasting: number | null;        // mmol/L  — optimal: 0.5–1.5
  betaHydroxybutyrate: number | null;   // mmol/L  — optimal: <0.3

  // ── 8. Protein status, liver function & substrate turnover ────────────────
  albumin: number | null;               // g/dL    — optimal: 4.2–5.0
  totalProtein: number | null;          // g/dL    — optimal: 7.0–8.0
  ggt: number | null;                   // U/L     — optimal: <20
  alp: number | null;                   // U/L     — optimal: 40–100
  totalBilirubin: number | null;        // mg/dL   — optimal: <0.8
  directBilirubin: number | null;       // mg/dL   — optimal: <0.2

  // ── 9. Kidney function, hydration & nitrogen balance ──────────────────────
  creatinine: number | null;            // mg/dL   — male optimal: 0.8–1.1
  cystatinC: number | null;             // mg/L    — optimal: 0.5–0.8
  egfr: number | null;                  // mL/min  — optimal: >90 (creatinine)
  egfrCystatinC: number | null;         // mL/min  — optimal: >90 (cystatin C)
  bun: number | null;                   // mg/dL   — optimal: 10–20
  uricAcid: number | null;              // mg/dL   — optimal: 3.5–6.0
  plasmaOsmolality: number | null;      // mOsm/kg — optimal: 280–295
  sodium: number | null;                // mEq/L   — optimal: 136–142

  // ── 10. Electrolytes & neuromuscular recovery ─────────────────────────────
  potassium: number | null;             // mEq/L   — optimal: 4.0–4.8
  chloride: number | null;              // mEq/L   — optimal: 100–106
  bicarbonate: number | null;           // mEq/L   — optimal: 24–28
  calciumTotal: number | null;          // mg/dL   — optimal: 9.0–10.2
  ionizedCalcium: number | null;        // mmol/L  — optimal: 1.15–1.30
  magnesium: number | null;             // mg/dL   — optimal: 2.1–2.5
  phosphate: number | null;             // mg/dL   — optimal: 2.5–4.5

  // ── 11. Bone health, mineral metabolism & vitamin D ──────────────────────
  vitaminD: number | null;              // ng/mL   — athlete optimal: 50–80
  vitaminD125: number | null;           // pg/mL   — optimal: 40–65
  pth: number | null;                   // pg/mL   — optimal: 15–50
  p1np: number | null;                  // ng/mL   — optimal: 25–74
  ctx1: number | null;                  // pg/mL   — optimal: 100–400
  osteocalcin: number | null;           // ng/mL   — optimal: 5–14

  // ── 12. Lipids & cardiometabolic recovery ─────────────────────────────────
  totalCholesterol: number | null;      // mg/dL   — optimal: 160–200
  ldl: number | null;                   // mg/dL   — optimal: <100
  hdl: number | null;                   // mg/dL   — male optimal: >55
  triglycerides: number | null;         // mg/dL   — optimal: <100
  apob: number | null;                  // mg/dL   — optimal: <80
  apoA1: number | null;                 // mg/dL   — optimal: >130
  lipoproteinA: number | null;          // mg/dL   — optimal: <30

  // ── 13. Micronutrients that shape recovery ────────────────────────────────
  vitaminB12: number | null;            // pg/mL   — optimal: 400–900
  folate: number | null;                // ng/mL   — optimal: >10
  rbcFolate: number | null;             // ng/mL   — optimal: >280
  vitaminB6: number | null;             // nmol/L  — optimal: 25–80
  vitaminB1: number | null;             // nmol/L  — optimal: 70–150
  zinc: number | null;                  // μg/dL   — optimal: 85–120
  copper: number | null;                // μg/dL   — optimal: 70–140
  selenium: number | null;              // μg/L    — optimal: 120–200

  // ── 14. Oxidative stress & antioxidant defense ───────────────────────────
  mda: number | null;                   // μmol/L  — optimal: <0.5
  totalAntioxidantCapacity: number | null; // mmol/L — optimal: >1.5
  reducedGlutathione: number | null;    // μmol/L  — optimal: >800

  // ── 15. Fatty acids & membrane-based recovery ─────────────────────────────
  omega3Index: number | null;           // %       — optimal: >8
  epa: number | null;                   // %       — optimal: >1.5
  dha: number | null;                   // %       — optimal: >4.5
  arachidonicAcid: number | null;       // %       — optimal: 8–12

  // ── 16. Reproductive hormones & RED-S screening ───────────────────────────
  lh: number | null;                    // mIU/mL  — male optimal: 2–8
  fsh: number | null;                   // mIU/mL  — male optimal: 2–10
  estradiol: number | null;             // pg/mL   — male optimal: 20–35
  progesterone: number | null;          // ng/mL   — male optimal: 0.2–1.4
  prolactin: number | null;             // ng/mL   — male optimal: 2–15
  leptin: number | null;                // ng/mL   — male optimal: 2–10
  ghrelin: number | null;               // pg/mL   — optimal: 100–500

  // ── 17. Connective tissue, collagen & repair biology ─────────────────────
  piiinp: number | null;                // ng/mL   — optimal: 3–8
  comp: number | null;                  // μg/mL   — optimal: 3–8
  hyaluronicAcid: number | null;        // ng/mL   — optimal: <50
  mmp3: number | null;                  // ng/mL   — optimal: 5–25
  mmp9: number | null;                  // ng/mL   — optimal: <30

  // ── 18. White blood cells & immune readiness ──────────────────────────────
  wbc: number | null;                   // K/μL    — optimal: 5.0–8.0
  neutrophils: number | null;           // K/μL    — optimal: 2.0–6.0
  lymphocytes: number | null;           // K/μL    — optimal: 1.5–3.5
  monocytes: number | null;             // K/μL    — optimal: 0.2–0.8
  eosinophils: number | null;           // K/μL    — optimal: <0.3
  basophils: number | null;             // K/μL    — optimal: <0.1
  platelets: number | null;             // K/μL    — optimal: 200–350
  mpv: number | null;                   // fL      — optimal: 7.5–12

  // ── 19. Vascular, coagulation & endothelial function ─────────────────────
  homocysteine: number | null;          // μmol/L  — optimal: <8
  dDimer: number | null;                // μg/mL   — optimal: <0.5
  ptInr: number | null;                 // ratio   — optimal: 0.9–1.1
  vonWillebrandFactor: number | null;   // %       — optimal: 80–150
  nitricOxide: number | null;           // μmol/L  — optimal: 30–70
  vegf: number | null;                  // pg/mL   — optimal: 60–400

  // ── 20. Advanced: mitochondrial, metabolic & gut markers ─────────────────
  adiponectin: number | null;           // μg/mL   — optimal: >10
  resistin: number | null;              // ng/mL   — optimal: <5
  gdf15: number | null;                 // pg/mL   — optimal: <300
  bdnf: number | null;                  // ng/mL   — optimal: >25
  fgf21: number | null;                 // pg/mL   — optimal: <100
  lpsBp: number | null;                 // μg/mL   — optimal: 5–15
  zonulin: number | null;               // ng/mL   — optimal: <30
}

export interface BloodworkEntry {
  id: string;
  date: string;
  labName: string;
  panel: BloodworkPanel;
  notes: string;
}

export function emptyBloodworkPanel(): BloodworkPanel {
  const n = null;
  return {
    // 1. RBC/Oxygen
    rbc: n, hemoglobin: n, hematocrit: n, mcv: n, mch: n, mchc: n,
    rdw: n, reticulocyteCount: n, reticulocyteHb: n, epo: n,
    // 2. Iron
    ferritin: n, ironSerum: n, transferrin: n, tibc: n, uibc: n,
    tsat: n, stfr: n, hepcidin: n, haptoglobin: n, indirectBilirubin: n,
    // 3. Muscle damage
    creatineKinase: n, ldh: n, myoglobin: n, ast: n, alt: n,
    aldolase: n, troponin: n,
    // 4. Inflammation
    hsCRP: n, il6: n, tnfAlpha: n, fibrinogen: n, esr: n, serumAmyloidA: n,
    // 5. Hormones / stress
    cortisolAM: n, cortisolPM: n, testosteroneTotal: n, testosteroneFree: n,
    shbg: n, dheas: n, acth: n, gh: n, igf1: n,
    // 6. Thyroid
    tsh: n, freeT4: n, freeT3: n, totalT4: n, totalT3: n,
    reverseT3: n, tpoAb: n, tgAb: n,
    // 7. Glucose
    glucoseFasting: n, insulin: n, hba1c: n, cPeptide: n,
    fructosamine: n, lactateFasting: n, betaHydroxybutyrate: n,
    // 8. Liver / protein
    albumin: n, totalProtein: n, ggt: n, alp: n,
    totalBilirubin: n, directBilirubin: n,
    // 9. Kidney / hydration
    creatinine: n, cystatinC: n, egfr: n, egfrCystatinC: n,
    bun: n, uricAcid: n, plasmaOsmolality: n, sodium: n,
    // 10. Electrolytes
    potassium: n, chloride: n, bicarbonate: n, calciumTotal: n,
    ionizedCalcium: n, magnesium: n, phosphate: n,
    // 11. Bone
    vitaminD: n, vitaminD125: n, pth: n, p1np: n, ctx1: n, osteocalcin: n,
    // 12. Lipids
    totalCholesterol: n, ldl: n, hdl: n, triglycerides: n,
    apob: n, apoA1: n, lipoproteinA: n,
    // 13. Micronutrients
    vitaminB12: n, folate: n, rbcFolate: n, vitaminB6: n,
    vitaminB1: n, zinc: n, copper: n, selenium: n,
    // 14. Oxidative stress
    mda: n, totalAntioxidantCapacity: n, reducedGlutathione: n,
    // 15. Fatty acids
    omega3Index: n, epa: n, dha: n, arachidonicAcid: n,
    // 16. Reproductive hormones
    lh: n, fsh: n, estradiol: n, progesterone: n, prolactin: n,
    leptin: n, ghrelin: n,
    // 17. Connective tissue
    piiinp: n, comp: n, hyaluronicAcid: n, mmp3: n, mmp9: n,
    // 18. Immune / WBC
    wbc: n, neutrophils: n, lymphocytes: n, monocytes: n,
    eosinophils: n, basophils: n, platelets: n, mpv: n,
    // 19. Vascular / coagulation
    homocysteine: n, dDimer: n, ptInr: n, vonWillebrandFactor: n,
    nitricOxide: n, vegf: n,
    // 20. Advanced
    adiponectin: n, resistin: n, gdf15: n, bdnf: n,
    fgf21: n, lpsBp: n, zonulin: n,
  };
}

// ─── Training plan ───────────────────────────────────────────────────────────

export type TrainingType   = "strength" | "practice" | "game" | "recovery" | "cardio" | "off";
export type IntensityLevel = "low" | "moderate" | "high";
export type WeekDay =
  | "Monday" | "Tuesday" | "Wednesday" | "Thursday"
  | "Friday" | "Saturday" | "Sunday";

export interface TrainingDay {
  day:           WeekDay;
  training_type: TrainingType;
  duration:      number;       // minutes (0 for off days)
  intensity:     IntensityLevel;
  notes?:        string;
}

export interface TrainingPlan {
  id:             string;
  name:           string;
  rawInput:       string;
  weeklySchedule: TrainingDay[];
  createdAt:      string;
  updatedAt:      string;
}

// ─── Coaching ────────────────────────────────────────────────────────────────

export interface CoachingPreferences {
  mode: CoachMode;
}

// ─── Performance Profile ─────────────────────────────────────────────────────

export const PERFORMANCE_GOALS = [
  "Marathon",
  "Half Marathon",
  "Triathlon",
  "Ironman",
  "Cycling Race",
  "Strength Training",
  "Powerlifting",
  "MMA / Combat Sports",
  "General Fitness",
  "Longevity",
] as const;

export type PerformanceGoal = (typeof PERFORMANCE_GOALS)[number];

export type TrainingFocus = "Endurance" | "Strength" | "Hybrid";
export type PerformancePriority = "Performance" | "Recovery" | "Longevity";

export interface PerformanceProfile {
  primaryGoal:    PerformanceGoal;
  eventDate?:     string | null;          // YYYY-MM-DD
  trainingFocus?: TrainingFocus | null;
  priority?:      PerformancePriority | null;
}

// ─── Store shape ─────────────────────────────────────────────────────────────

export interface AppState {
  // Current day
  todayEntry: DailyEntry | null;
  todayScore: RecoveryScore | null;
  // History (keyed by YYYY-MM-DD)
  entries: Record<string, DailyEntry>;
  scores: Record<string, RecoveryScore>;
  // Bloodwork history
  bloodwork: BloodworkEntry[];
  // Training plan
  trainingPlan: TrainingPlan | null;
  // Daily mood (1–5, keyed by YYYY-MM-DD)
  moodLog: Record<string, number>;
  // Performance profile
  performanceProfile: PerformanceProfile | null;
  // Settings
  coachingPrefs: CoachingPreferences;
  // Actions
  setTodayEntry: (entry: DailyEntry) => void;
  setTodayScore: (score: RecoveryScore) => void;
  upsertEntry: (entry: DailyEntry) => void;
  upsertScore: (score: RecoveryScore) => void;
  addBloodwork: (entry: BloodworkEntry) => void;
  upsertBloodwork: (entry: BloodworkEntry) => void;
  deleteBloodwork: (id: string) => void;
  setCoachingPrefs: (prefs: CoachingPreferences) => void;
  setAdjustedScore: (date: string, score: number | null) => void;
  setTrainingPlan: (plan: TrainingPlan | null) => void;
  setMood: (date: string, rating: number) => void;
  setPerformanceProfile: (profile: PerformanceProfile | null) => void;
}
