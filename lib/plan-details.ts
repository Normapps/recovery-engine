/**
 * Plan Detail Generator
 *
 * Produces the full modal content (title, overview, instructions, structure,
 * coaching note) for each of the four daily plan modules.
 *
 * Content adapts to the same score tiers and mood signal used by
 * generateDailyPlan() in lib/daily-plan.ts.
 */

import type { DailyEntry, TrainingDay } from "./types";

export interface PlanSection {
  title:        string;
  overview:     string;
  instructions: string[];
  structure:    string;
  coachingNote: string;
}

// ─── Structured nutrition section ────────────────────────────────────────────
//
// Designed to later accept biomarker inputs, recovery score, and training load
// without breaking callers:
//
//   generateNutritionSection(score, moodRating, todayPlan, entry, bwPanel?)
//
// biomarker influence examples:
//   low ferritin  → elevate iron-rich food recommendations
//   low vitamin D → add supplementation note to micronutrients.note
//   high CK       → increase protein target + add anti-inflammatory foods
//   high cortisol → lower caffeine ceiling, add magnesium note

export interface ProteinTarget {
  /** Daily total in grams. */
  totalGrams:  number;
  /** Recommended grams per eating occasion. */
  perMeal:     number;
  /** Plain-English guidance on timing and sourcing. */
  guidance:    string;
  /** Concrete example foods. */
  foods:       string[];
}

export interface CarbGuidance {
  /** Daily total in grams. */
  totalGrams:  number;
  /** When to prioritise carbohydrates (pre/post/all-day). */
  timing:      string;
  /** Concrete example foods. */
  foods:       string[];
}

export interface HydrationGuidance {
  /** Daily target in fluid ounces. */
  totalOz:   number;
  /** Practical schedule (e.g., "16 oz on waking, then every hour"). */
  schedule:  string;
}

export interface MicronutrientFocus {
  /** Key nutrients to prioritise today — can be biomarker-driven. */
  focus: string[];
  /** Short rationale or food-first approach note. */
  note:  string;
}

export interface NutritionSection {
  readonly _type: "nutrition";
  title:           string;
  overview:        string;
  protein:         ProteinTarget;
  carbs:           CarbGuidance;
  hydration:       HydrationGuidance;
  /** Only populated when there is a specific micronutrient priority. */
  micronutrients?: MicronutrientFocus;
  coachingNote:    string;
}

export interface PlanDetails {
  training:  PlanSection;
  recovery:  PlanSection;
  mobility:  PlanSection;
  nutrition: NutritionSection;
}

export function generatePlanDetails(
  score:      number,
  moodRating: number | null,
  todayPlan:  TrainingDay | null,
  entry:      DailyEntry,
): PlanDetails {
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

  let training: PlanSection;

  if (isRestDay) {
    training = {
      title:    "Today's Training",
      overview: "It's a scheduled rest day. Use the time to move lightly and let your body absorb previous training.",
      instructions: [
        "Take a 15–20 minute walk at a relaxed, conversational pace",
        "Avoid any weighted or high-effort exercise",
        "Focus on deep breathing and staying loose",
      ],
      structure:    "1 walk · 15–20 min · conversational pace · no load",
      coachingNote: "Output comes from recovering well — today's rest is tomorrow's performance.",
    };
  } else if (isGameDay) {
    training = {
      title:    "Today's Training",
      overview: "Game day — keep pre-competition movement short and sharp. Conserve energy for when it counts.",
      instructions: [
        "5 minutes of light jogging or skipping to elevate heart rate",
        "Dynamic warm-up: leg swings, hip circles, arm crosses — 10 reps each",
        "3–4 sport-specific activation movements at 60–70% effort",
        "Do not fatigue yourself — this is activation, not a session",
      ],
      structure:    "Activation only · 15–20 min total · 60–70% effort · no heavy loading",
      coachingNote: "Save everything for the game — the warm-up should excite the system, not drain it.",
    };
  } else if (score < 45 || lowMood) {
    training = {
      title:    "Today's Training",
      overview: "Your body needs rest more than stimulus today. Adding load will slow your recovery, not speed it up.",
      instructions: [
        "Take a 15–20 minute walk at a comfortable, easy pace",
        "Avoid any weighted, ballistic, or max-effort exercise",
        "If you must move, choose a 10-minute light bodyweight flow only",
      ],
      structure:    "Walk only · 15–20 min · easy effort · no sets or reps",
      coachingNote: "Skipping one session to recover fully is always worth it — overtraining costs more than one missed day.",
    };
  } else if (score < 65) {
    training = {
      title:    "Today's Training",
      overview: "Your body can handle light work today. Keep intensity well below your maximum and monitor how you feel.",
      instructions: [
        "Warm up with 5 minutes of light cardio — bike or treadmill at easy pace",
        "Choose bodyweight or machine exercises — avoid heavy free weights",
        "Limit session to 30–40 minutes total volume",
        "Rest 90 seconds minimum between all sets",
      ],
      structure:    "2–3 sets · 10–12 reps · 60% of max · 90-second rest",
      coachingNote: "A disciplined light session beats a forced hard one when recovery is low.",
    };
  } else if (score < 80) {
    training = {
      title:    "Today's Training",
      overview: "Recovery is in a solid range. Train with purpose but stay in control — technique over weight today.",
      instructions: [
        "Complete a structured warm-up targeting today's primary muscle groups",
        "Work through your planned session at 70–75% of your max effort",
        "Rest fully between sets — do not cut rest short",
        "Finish with 5 minutes of light cooldown cardio",
      ],
      structure:    "3–4 sets · 8–10 reps · 70–75% effort · 2-minute rest",
      coachingNote: "Consistent moderate sessions build the base that hard sessions capitalize on.",
    };
  } else {
    training = {
      title:    "Today's Training",
      overview: highMood
        ? "Body and mind are both ready. This is one of your best days to push performance."
        : "Recovery metrics are strong. Push intensity today and take advantage of the window.",
      instructions: [
        "Begin with a thorough activation warm-up — at least 10 minutes",
        "Execute your primary lifts at 85–90% of your max effort",
        "Push accessory work with shorter rest periods to build density",
        "End with a 5-minute cooldown — do not skip it on hard days",
      ],
      structure:    "4–5 sets · 5–8 reps · 85–90% effort · 90-second rest",
      coachingNote: "Your body is primed — commit to the session and execute with full intent.",
    };
  }

  // ── Recovery ──────────────────────────────────────────────────────────────

  let recovery: PlanSection;

  if (score < 45) {
    recovery = {
      title:    "Today's Recovery",
      overview: "Passive recovery is the priority. Your system needs support — not additional stress.",
      instructions: [
        "Strap on compression boots for 25 minutes after waking or post any light movement",
        "Elevate your legs above heart level for 10 minutes mid-day if possible",
        "Avoid sauna or hot tub today — heat adds cardiovascular stress",
        "Prioritize 8–9 hours of sleep tonight",
      ],
      structure:    "Compression boots · 25 min · legs elevated · no heat protocols",
      coachingNote: "Rest is an active recovery tool — use it deliberately and without guilt.",
    };
  } else if (lowMood) {
    recovery = {
      title:    "Today's Recovery",
      overview: "Your nervous system needs calming today. Cold and controlled breathing are the fastest tools available.",
      instructions: [
        "Fill a tub or large container with cold water — target 50–60°F",
        "Submerge legs to the waist for 10 minutes — keep upper body dry",
        "Immediately after, lie on your back and use 4-4-8 breathing: inhale 4, hold 4, exhale 8",
        "Continue breathing protocol for 10 minutes without stopping",
      ],
      structure:    "Ice bath · 10 min legs submerged → breathwork · 10 min · 4-4-8 pattern",
      coachingNote: "Cold water drops cortisol; the extended exhale activates your parasympathetic system — together they reset your state.",
    };
  } else if (score < 65) {
    recovery = {
      title:    "Today's Recovery",
      overview: "Targeted tissue work prevents soreness from compounding. Work slowly through each area.",
      instructions: [
        "Foam roll quads — 2 minutes each leg, slow strokes from hip to knee",
        "Move to hamstrings — pause 15 seconds on any tight or tender spots",
        "Finish on calves — 90 seconds each side, rotate foot inward and outward",
        "Do not rush — let the tissue soften before moving the roller",
      ],
      structure:    "Foam rolling · 8–10 min total · 2 min per major area · 15-sec pauses on sore spots",
      coachingNote: "Slow rolling is better than fast — pressure held still releases more than repeated strokes.",
    };
  } else if (score < 80) {
    recovery = {
      title:    "Today's Recovery",
      overview: "A full circulation and tissue protocol today keeps you primed and prevents buildup.",
      instructions: [
        "Fill a tub or ice bath to 50–55°F",
        "Submerge legs to the waist for 10 minutes — stay still and breathe steadily",
        "After the ice bath, foam roll quads, hamstrings, and calves",
        "Pause 15 seconds on any tender spot before moving on",
      ],
      structure:    "Ice bath · 10 min → foam rolling · 10–12 min · same day, sequentially",
      coachingNote: "Ice reduces acute inflammation; foam rolling restores tissue length — use both in sequence.",
    };
  } else {
    recovery = {
      title:    "Today's Recovery",
      overview: "Maintenance recovery at peak scores is what keeps you there — do not skip it.",
      instructions: [
        "Strap on compression boots for 25 minutes post-training",
        "Alternatively, take a 10-minute ice bath if soreness is present anywhere",
        "Spend 5 minutes with your feet elevated before sleep",
        "Hydrate well — even at high scores, dehydration accelerates fatigue",
      ],
      structure:    "Compression boots · 25 min OR ice bath · 10 min · choose based on soreness",
      coachingNote: "High scores drop when recovery is neglected — this session is how you stay at the top.",
    };
  }

  // ── Mobility ──────────────────────────────────────────────────────────────

  let mobility: PlanSection;

  if (score < 45) {
    mobility = {
      title:    "Today's Mobility",
      overview: "Gentle movement only. The goal is circulation and lubrication — not flexibility gains.",
      instructions: [
        "10 slow hip circles each direction — standing, hands on hips",
        "5 shoulder rolls forward and backward, full range",
        "10 slow neck half-circles — stop immediately if any pain or tingling",
      ],
      structure:    "1 round · 10 reps per movement · no load · pain-free range only",
      coachingNote: "Move gently to keep blood flowing — any discomfort means you have gone too far.",
    };
  } else if (score < 65) {
    mobility = {
      title:    "Today's Mobility",
      overview: "Targeted joint work reduces stiffness and prepares your body for light training activity.",
      instructions: [
        "90/90 hip stretch — 5 reps per side, hold 3 seconds at end range",
        "World's greatest stretch — 5 reps per side, slow and controlled",
        "Cat-cow thoracic extension — 10 continuous reps, full spinal range",
        "Child's pose with lateral reach — 30 seconds each side",
      ],
      structure:    "2 rounds · 5 reps per side · 3-second holds at end range",
      coachingNote: "Move into the end range and breathe — tension releases when you stop fighting it.",
    };
  } else if (score < 80) {
    mobility = {
      title:    "Today's Mobility",
      overview: "A focused pre-session mobility flow will improve tissue quality and range under load.",
      instructions: [
        "Hip openers — 5 controlled reps per side, from standing or half-kneeling",
        "Hamstring stretch — lying or standing, hold 30 seconds each side",
        "Thoracic rotation in seated or kneeling position — 8 reps per side",
        "Ankle circles — 10 rotations each direction per foot",
      ],
      structure:    "2 rounds · 5–8 reps or 30-sec holds per movement · perform before training",
      coachingNote: "Do this before your session, not after — it primes the joints when it matters most.",
    };
  } else {
    mobility = {
      title:    "Today's Mobility",
      overview: "A full activation flow primes the nervous system and prepares every joint for high-effort work.",
      instructions: [
        "Leg swings — 15 reps per direction per leg, holding lightly for balance",
        "Hip 90/90 transitions — 5 reps each way, keep spine tall throughout",
        "Thoracic rotation with reach — 8 reps per side, exhale as you rotate",
        "Ankle circles and calf stretches — 30 seconds each leg",
      ],
      structure:    "1–2 rounds · 8–15 reps per movement · 12–15 min total · before training",
      coachingNote: "This flow takes 12 minutes and will make every rep in your training session feel better.",
    };
  }

  // ── Nutrition (structured — ready for biomarker + training-load extension) ─

  const nutrition = generateNutritionSection(score, moodRating, isGameDay, lowMood);

  return { training, recovery, mobility, nutrition };
}

// ─── Nutrition section generator ─────────────────────────────────────────────
//
// Kept as a dedicated function so future callers can pass additional context:
//
//   generateNutritionSection(score, moodRating, isGameDay, lowMood, bwPanel?, trainingLoadAU?)
//
// Biomarker extension examples (not yet wired):
//   bwPanel.ferritin < 30     → add iron-rich foods, flag supplementation
//   bwPanel.creatineKinase > 300 → raise protein target by 20g, add anti-inflammatories
//   bwPanel.vitaminD < 30     → add vitamin D note to micronutrients
//   bwPanel.cortisolAM > 20   → lower caffeine ceiling, add adaptogen note
//   trainingLoadAU > 500      → raise carb target by 50–80g

function generateNutritionSection(
  score:       number,
  moodRating:  number | null,
  isGameDay:   boolean,
  lowMood:     boolean,
): NutritionSection {

  // ── Fatigued tier (score < 45) ───────────────────────────────────────────
  if (score < 45) {
    return {
      _type: "nutrition",
      title:    "Today's Nutrition",
      overview: "Replenishment is the priority today. Your body cannot repair without adequate fuel — undereating when recovery is low extends the hole you are in. Prioritize anti-inflammatory foods including dark leafy greens alongside your protein and carbs.",
      protein: {
        totalGrams: 160,
        perMeal:    40,
        guidance:   "Spread protein across 4 eating occasions to sustain muscle protein synthesis throughout the day.",
        foods:      ["Chicken breast or thigh (35g per 4 oz)", "Eggs — 3 whole eggs = 18g", "Greek yogurt — 15–17g per cup", "Cottage cheese — 25g per cup", "White fish or salmon — 30g per 4 oz"],
      },
      carbs: {
        totalGrams: 350,
        timing:     "Spread across all meals — prioritize morning and midday to restore glycogen.",
        foods:      ["White rice — 45g carbs per cup cooked", "Oats — 27g per half cup dry", "Sweet potato — 26g per medium", "Banana — 27g each", "White bread — 30g per 2 slices"],
      },
      hydration: {
        totalOz:  90,
        schedule: "Drink 16oz immediately on waking. Carry a bottle and refill every 2 hours. Add electrolytes if urine is clear.",
      },
      micronutrients: {
        focus: ["Magnesium", "Zinc", "Vitamin C", "Dark Leafy Greens"],
        note:  "Spinach and kale supply magnesium, iron, and vitamin C simultaneously. Broccoli and brussels sprouts add sulforaphane — a compound that directly reduces exercise-induced inflammation. Pumpkin seeds cover zinc. Aim for 2–3 cups of cooked or raw greens today.",
      },
      coachingNote: "When recovery is critically low, carbohydrates are medicine — and vegetables are the micronutrient delivery system that makes them work. Do not skip either today.",
    };
  }

  // ── Low mood override ────────────────────────────────────────────────────
  if (lowMood) {
    return {
      _type: "nutrition",
      title:    "Today's Nutrition",
      overview: "What you eat directly affects how you feel mentally. Stable blood sugar, adequate protein, omega-3 fats, and dark leafy greens are the fastest dietary interventions for low mood.",
      protein: {
        totalGrams: 160,
        perMeal:    40,
        guidance:   "Eat within 45 minutes of waking — skipping breakfast when mood is low worsens cortisol balance.",
        foods:      ["Salmon (35g per 4 oz) — also provides omega-3", "Eggs — 3 whole eggs + 2 whites", "Turkey breast — 30g per 4 oz", "Sardines — 25g per can, high in omega-3", "Walnuts — 4g per oz, best nut source of ALA"],
      },
      carbs: {
        totalGrams: 250,
        timing:     "Prioritize slow-releasing carbs to prevent energy crashes that worsen mood.",
        foods:      ["Oats — 27g per half cup dry, steady release", "Brown rice — 45g per cup cooked", "Sweet potato — 26g, also high in B6", "Lentils — 40g per cup cooked, also high in folate", "Blueberries — 21g per cup, antioxidant-rich", "Spinach or kale — pair with any meal, negligible carbs, high mineral density"],
      },
      hydration: {
        totalOz:  80,
        schedule: "16oz on waking. Avoid caffeine after 2pm — late caffeine elevates cortisol and disrupts sleep, compounding the mood deficit.",
      },
      micronutrients: {
        focus: ["Omega-3 (EPA + DHA)", "Magnesium", "B-Complex (B6, B12, Folate)", "Dark Leafy Greens"],
        note:  "Omega-3 EPA reduces neuroinflammation. Magnesium supports GABA and sleep. B vitamins drive serotonin synthesis — spinach, kale, and broccoli deliver folate, magnesium, and vitamin C simultaneously. Aim for at least 2 cups of greens today alongside salmon and legumes.",
      },
      coachingNote: "Consistent, balanced meals — including vegetables — are the most underused mental performance tool. Do not skip any eating occasion today.",
    };
  }

  // ── Caution tier (score 45–64) ───────────────────────────────────────────
  if (score < 65) {
    return {
      _type: "nutrition",
      title:    "Today's Nutrition",
      overview: "Consistent fueling today stabilizes energy and gives tissues the substrate they need to recover. Include dark leafy greens at two meals — their micronutrient density is the highest-value addition you can make when recovery is compromised.",
      protein: {
        totalGrams: 160,
        perMeal:    45,
        guidance:   "Spread 160g across 3–4 meals. Aim for a protein source the size of your palm at every eating occasion.",
        foods:      ["Chicken breast — 35g per 4 oz", "Greek yogurt — 17g per cup", "Eggs — 6g each", "Tuna — 30g per 4 oz can", "Lean beef — 35g per 4 oz"],
      },
      carbs: {
        totalGrams: 250,
        timing:     "Distribute across all meals. If training today, prioritize carbs in the 90-minute window before and directly after.",
        foods:      ["Rice — 45g per cup cooked", "Oats — 27g per half cup dry", "Potatoes — 37g per medium", "Bread — 30g per 2 slices", "Fruit — banana (27g), apple (25g)", "Broccoli or green beans — pair with any meal as a side"],
      },
      hydration: {
        totalOz:  80,
        schedule: "16oz on waking, then 8–12oz every 1–2 hours. Your urine should be pale yellow by mid-morning.",
      },
      micronutrients: {
        focus: ["Magnesium", "Vitamin C", "Dark Leafy Greens"],
        note:  "Spinach, kale, broccoli, and brussels sprouts supply magnesium, vitamin C, and folate — nutrients that directly support tissue repair and energy metabolism. Two cups of cooked or raw greens across your meals today will noticeably support recovery.",
      },
      coachingNote: "Protein timing and vegetable intake are the two levers that move the needle fastest at this score range — do not let either slip today.",
    };
  }

  // ── Game day ─────────────────────────────────────────────────────────────
  if (isGameDay) {
    return {
      _type: "nutrition",
      title:    "Game Day Nutrition",
      overview: "Every intake window today has a purpose. Pre-game fueling sets your energy ceiling; post-game intake determines how fast you recover for the next session. Include greens at your pre-game meal — their potassium and magnesium content directly reduce cramp risk.",
      protein: {
        totalGrams: 180,
        perMeal:    45,
        guidance:   "Pre-game meal 2–3 hours out: 30–40g protein. Post-game within 30 minutes: 50g protein to start repair immediately.",
        foods:      ["Grilled chicken or turkey breast (35g per 4 oz)", "Eggs — whole eggs pre-game for sustained energy", "Protein shake post-game for fast absorption (25–30g per scoop)", "White fish — 30g per 4 oz, light on the stomach pre-game"],
      },
      carbs: {
        totalGrams: 380,
        timing:     "Load carbs 2–3 hours pre-game (80–100g). Sip a sports drink or fruit during if the game exceeds 60 minutes. Refuel with 60–80g post-game.",
        foods:      ["White rice — 45g per cup, easy to digest pre-game", "Pasta — 43g per cup cooked", "White bread with honey — 30–35g fast carbs", "Banana pre-game (27g) — portable, easy", "Gatorade or similar during — 14g per 8oz", "Steamed broccoli or spinach pre-game — keeps gut stable, adds potassium"],
      },
      hydration: {
        totalOz:  100,
        schedule: "16oz on waking. 16oz with pre-game meal. 8–16oz per hour during play. 24oz post-game immediately. Add electrolytes post-game if you sweat heavily.",
      },
      micronutrients: {
        focus: ["Sodium", "Potassium", "Magnesium", "Dark Leafy Greens"],
        note:  "Electrolyte loss through sweat increases cramp risk and impairs muscle contraction. Spinach and broccoli provide natural potassium and magnesium — pairing them with your pre-game meal gives you a mineral buffer that sports drinks alone cannot match. Post-game salted food or an electrolyte drink restores what competition took.",
      },
      coachingNote: "Fuel every window today — you cannot out-compete poor game-day nutrition. Greens at your pre-game meal are one of the most overlooked cramp-prevention strategies.",
    };
  }

  // ── Optimal tier (score 80+) ──────────────────────────────────────────────
  if (score >= 80) {
    return {
      _type: "nutrition",
      title:    "Today's Nutrition",
      overview: "High recovery opens the door to high performance output. Fuel to match the intensity you are capable of — every intake window matters on a day like today. Include dark leafy greens at your evening meal to prime tomorrow's recovery from today's hard session.",
      protein: {
        totalGrams: 180,
        perMeal:    45,
        guidance:   "Pre-training: 30g protein + 60–80g carbs, 90 minutes out. Post-training: 50g protein within 30 minutes. The post-workout window is the most important of the day.",
        foods:      ["Chicken breast — 35g per 4 oz, pre or post", "Salmon — 35g per 4 oz, provides omega-3 for inflammation", "Eggs + egg whites — versatile, full amino acid profile", "Protein shake post-training — fastest absorption (25–30g per scoop)", "Lean beef — 35g per 4 oz, high in zinc and creatine"],
      },
      carbs: {
        totalGrams: 350,
        timing:     "Pre-training (90 min out): 60–80g. Intra-training if session exceeds 75 min: 30–45g per hour. Post-training (within 30 min): 60–80g. Evening meal: 60–80g to restore glycogen for tomorrow.",
        foods:      ["White rice — fast-digesting, ideal pre and post", "Oats + banana — pre-training combination", "Sweet potato — 26g, ideal evening carb with high micronutrient density", "Pasta — 43g per cup, good pre-training loading", "Dried fruit + honey — fast intra-session carbs", "Spinach or kale (evening) — pair with your post-training meal for magnesium and vitamin K"],
      },
      hydration: {
        totalOz:  100,
        schedule: "16oz immediately on waking. 16oz with pre-training meal. 16–24oz per hour during training. 24oz post-training. Remaining across the day in even sips.",
      },
      micronutrients: {
        focus: ["Creatine (3–5g daily)", "Vitamin D", "Omega-3", "Dark Leafy Greens"],
        note:  "On high-output days, creatine, vitamin D, and omega-3 each measurably support performance and recovery. Add 2 cups of spinach, kale, or broccoli at your evening meal — the sulforaphane in brassica vegetables directly dampens exercise-induced inflammation overnight, so you wake up recovered instead of stiff.",
      },
      coachingNote: "You cannot out-train poor nutrition — fuel every window today, and do not skip the greens. They are what keeps a high-output day from becoming a sore, sluggish tomorrow.",
    };
  }

  // ── Moderate tier (score 65–79) ───────────────────────────────────────────
  return {
    _type: "nutrition",
    title:    "Today's Nutrition",
    overview: "Training-day nutrition fuels today's session and primes tomorrow's recovery. Be deliberate about timing — the windows around training matter most. Add a serving of dark leafy greens at lunch or dinner to keep micronutrients dialed in.",
    protein: {
      totalGrams: 170,
      perMeal:    43,
      guidance:   "Eat a protein-rich meal 60–90 minutes before training. Consume 40–50g protein within 30 minutes of finishing. Do not let more than 4 hours pass without a protein source.",
      foods:      ["Chicken breast or thigh — 35g per 4 oz", "Greek yogurt — 17g per cup", "Eggs — 3 whole eggs = 18g", "Cottage cheese — 25g per cup (good pre-sleep option)", "Tuna or salmon — 30–35g per 4 oz"],
    },
    carbs: {
      totalGrams: 280,
      timing:     "Prioritize carbs in the meals around training. Pre-training: 50–60g. Post-training: 50–60g. Remaining across other meals.",
      foods:      ["White rice — 45g per cup cooked, easy to digest", "Oats — 27g per half cup dry, sustained energy", "Banana — 27g, ideal pre-training", "Sweet potato — 26g, excellent post-training", "Bread — 30g per 2 slices, convenient", "Broccoli or spinach as a side — adds folate, vitamin C, and iron with minimal calories"],
    },
    hydration: {
      totalOz:  90,
      schedule: "16oz on waking. 12–16oz with pre-training meal. 16oz per hour during training. 24oz immediately post-training. Remainder across the day.",
    },
    micronutrients: {
      focus: ["Iron", "Folate", "Vitamin C", "Dark Leafy Greens"],
      note:  "At this training intensity, iron and folate are commonly under-consumed. Spinach, kale, broccoli, and asparagus address both and pair well with any protein source. Vitamin C from these vegetables also improves iron absorption when eaten alongside meat. Aim for 1–2 cups across your meals today.",
    },
    coachingNote: "Pre-training fuel is as important as post-training — both windows drive adaptation. A side of greens at one of those meals closes the micronutrient gap most athletes don't realize they have.",
  };
}
