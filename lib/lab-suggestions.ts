import type { BloodworkAnalysis } from "./bloodwork-engine";

export interface LabSuggestions {
  training: string[];
  recovery: string[];
  nutrition: string[];
  followUp: string[];
}

const RULES: Record<string, Partial<LabSuggestions>> = {
  creatineKinase: {
    training:  ["Reduce intensity; avoid eccentric-heavy sessions for 48–72h — elevated CK signals active muscle damage."],
    recovery:  ["Prioritize 8–9h sleep and contrast therapy (cold/heat cycling) to accelerate CK clearance."],
    followUp:  ["Retest CK in 5–7 days before returning to peak-intensity sessions."],
  },
  hsCRP: {
    training:  ["Limit high-intensity sessions to 2x/week until CRP normalises — chronic inflammation impairs adaptation."],
    nutrition: ["Add 2–3g EPA/DHA omega-3s daily; reduce ultra-processed foods and refined carbohydrates."],
    followUp:  ["Retest CRP + IL-6 in 2–3 weeks to track inflammatory resolution."],
  },
  il6: {
    training:  ["Replace high-load sessions with Zone 2 cardio to reduce pro-inflammatory cytokine output."],
    recovery:  ["Prioritise sleep ≥8h and reduce alcohol — both directly lower IL-6."],
  },
  ferritin: {
    nutrition: ["Increase heme iron (red meat 3x/week); pair plant sources with vitamin C. Avoid calcium supplements within 2h of iron-rich meals."],
    training:  ["Scale back high-intensity volume until ferritin improves — low iron storage impairs oxygen delivery and endurance capacity."],
    followUp:  ["Retest ferritin, serum iron, and TSAT in 6–8 weeks to assess repletion."],
  },
  hemoglobin: {
    training:  ["Scale back endurance volume — low hemoglobin directly limits aerobic capacity and recovery rate."],
    nutrition: ["Optimise iron intake with vitamin C co-ingestion; ensure protein ≥1.8g/kg."],
    followUp:  ["Full CBC retest in 4–6 weeks; add iron panel to rule out deficiency vs. dilutional anemia."],
  },
  vitaminD: {
    nutrition: ["Take 2,000–4,000 IU vitamin D3 daily with vitamin K2 (100–200mcg) and a fat-containing meal."],
    recovery:  ["Low vitamin D impairs muscle repair and immune function — prioritise supplementation before training resumes."],
    followUp:  ["Retest 25-OH vitamin D in 3 months; aim for 50–80 ng/mL for athletes."],
  },
  magnesium: {
    nutrition: ["Supplement 300–400mg magnesium glycinate or malate nightly — best absorbed forms for recovery."],
    recovery:  ["Magnesium before bed supports parasympathetic tone, sleep depth, and muscle relaxation."],
  },
  testosteroneTotal: {
    training:  ["Avoid chronic caloric deficit and training volume spikes; both suppress testosterone. Deload every 6–8 weeks."],
    nutrition: ["Prioritise dietary fat (≥30% of calories), zinc-rich foods, and ≥7.5h sleep."],
    followUp:  ["Retest testosterone, LH, FSH, and SHBG in 8–12 weeks."],
  },
  cortisolAM: {
    training:  ["Reduce total training volume 20–30% for 2 weeks — elevated cortisol signals overreaching."],
    recovery:  ["Implement a structured deload; consider ashwagandha (600mg/day) to support HPA-axis regulation."],
  },
  igf1: {
    training:  ["Increase compound resistance training — IGF-1 responds to mechanical loading; prioritise squats, deadlifts, rows."],
    nutrition: ["Optimise protein (2.0–2.4g/kg) and total calories — caloric restriction suppresses IGF-1."],
    recovery:  ["Deep sleep (Stage 3) is the primary driver of IGF-1/GH release — protect sleep duration and quality."],
  },
  freeT3: {
    nutrition: ["Ensure adequate caloric intake and selenium/iodine/zinc — severe restriction blocks T4→T3 conversion."],
    followUp:  ["Retest Free T3, Free T4, TSH; add Reverse T3 to rule out conversion blockade."],
  },
  tsh: {
    followUp:  ["Retest TSH with Free T3, Free T4, and TPO antibodies for a complete thyroid picture."],
  },
  vitaminB12: {
    nutrition: ["Supplement methylcobalamin B12 (1,000–2,000mcg sublingual/day) for 8–12 weeks."],
    followUp:  ["Retest B12 and MMA (methylmalonic acid) in 8 weeks to confirm absorption."],
  },
  omega3Index: {
    nutrition: ["Add 2–4g EPA/DHA from fish oil or algae oil daily; reduce omega-6 intake (seed oils, processed foods)."],
    recovery:  ["Omega-3 supplementation reduces post-training DOMS and CK elevation — prioritise in heavy blocks."],
    followUp:  ["Retest omega-3 index in 3–4 months; athlete target is >8%."],
  },
  zinc: {
    nutrition: ["Supplement zinc bisglycinate 25–30mg/day with food; avoid high-fibre meals (phytates block absorption)."],
    followUp:  ["Retest plasma zinc in 8–12 weeks."],
  },
  hba1c: {
    training:  ["Add Zone 2 cardio (3–4x/week, 30–45min) to improve insulin sensitivity."],
    nutrition: ["Reduce refined carbohydrates; time carb intake around training sessions for better partitioning."],
  },
  glucoseFasting: {
    nutrition: ["Avoid high-glycaemic foods in the evening; consider a 12h overnight fast to improve fasting glucose."],
    training:  ["Morning fasted Zone 2 cardio effectively improves insulin sensitivity."],
  },
  albumin: {
    nutrition: ["Increase total protein intake (≥2.0g/kg); low albumin signals insufficient dietary protein or chronic stress."],
    followUp:  ["Retest albumin and total protein; assess for inflammation or gut absorption issues if persistent."],
  },
  ldl: {
    nutrition: ["Reduce saturated fat; replace with olive oil and fatty fish. Increase dietary fibre (25–35g/day)."],
    followUp:  ["Add ApoB to the next panel — it's a better predictor of cardiovascular risk than LDL alone."],
  },
  triglycerides: {
    nutrition: ["Reduce refined carbohydrates and alcohol; add omega-3s (2–4g/day EPA/DHA)."],
    training:  ["Aerobic exercise 4–5x/week is the most effective lifestyle intervention for lowering triglycerides."],
  },
};

export function generateSuggestions(analysis: BloodworkAnalysis): LabSuggestions {
  const out: LabSuggestions = { training: [], recovery: [], nutrition: [], followUp: [] };

  // Sorted worst-first so highest-priority issues lead
  const concerns = [...analysis.topConcerns].sort((a, b) => a.score - b.score);

  for (const marker of concerns) {
    const rule = RULES[marker.key as string];
    if (!rule) continue;
    (["training", "recovery", "nutrition", "followUp"] as const).forEach((k) => {
      const items = rule[k] ?? [];
      items.forEach((item) => {
        if (out[k].length < 3 && !out[k].includes(item)) out[k].push(item);
      });
    });
  }

  // Score-level catch-alls
  if (analysis.score < 50) {
    if (!out.training.length) out.training.unshift("Reduce overall training load 30–40% until biomarkers stabilise — multiple critical markers detected.");
    if (!out.recovery.length) out.recovery.unshift("Schedule a full deload week with only light movement and recovery modalities.");
  } else if (analysis.score < 70 && !out.training.length) {
    out.training.push("Schedule a deload within the next 7 days — accumulated biomarker stress detected.");
  }

  // Highlight top strengths
  if (analysis.strengths.length > 0) {
    const names = analysis.strengths.slice(0, 3).map((m) => m.label).join(", ");
    out.training.push(`Optimal: ${names} — maintain current training protocols for these markers.`);
  }

  // Ensure every section has at least a baseline
  if (!out.followUp.length)
    out.followUp.push("Retest full panel in 3 months; quarterly bloodwork is recommended during structured training blocks.");
  if (!out.nutrition.length)
    out.nutrition.push("Biomarkers indicate solid nutritional status. Continue current protocol and monitor protein intake (1.8–2.2g/kg) during hard blocks.");
  if (!out.recovery.length)
    out.recovery.push("Recovery markers are healthy. Maintain current modalities and protect sleep quality above all else.");

  return out;
}
