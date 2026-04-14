/**
 * Pipeline QA Test
 *
 * Tests the full training plan pipeline without requiring a running server or API key:
 *   1. Text parsing  (parseTrainingInput → TrainingPlan)
 *   2. Load scoring  (calculateLoadScore per day)
 *   3. Display formatting (planToText roundtrip)
 *   4. API-route validation logic (validateEntry from parse-training-plan route)
 *   5. Edge cases (missing duration, missing distance, mixed formats)
 *
 * Run:
 *   node scripts/test-pipeline.mjs
 */

// ─── Inline engine logic (mirrors lib/training-engine.ts) ────────────────────
// We inline the key functions here so this script runs without ts-node/build step.

const DAY_MAP = {
  mon: "Monday", monday: "Monday",
  tue: "Tuesday", tues: "Tuesday", tuesday: "Tuesday",
  wed: "Wednesday", weds: "Wednesday", wednesday: "Wednesday",
  thu: "Thursday", thur: "Thursday", thurs: "Thursday", thursday: "Thursday",
  fri: "Friday", friday: "Friday",
  sat: "Saturday", saturday: "Saturday",
  sun: "Sunday", sunday: "Sunday",
};

const ORDERED_DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

const TYPE_KEYWORDS = [
  { type: "game",     keywords: ["game","match","competition","tournament","meet","race"] },
  { type: "cardio",   keywords: ["run","runs","running","jog","jogging","bike","biking","cycle",
                                  "cycling","swim","swimming","row","rowing","walk","walking",
                                  "hike","hiking","cardio","tempo","intervals","fartlek",
                                  "long run","easy run","progression run","hills"] },
  { type: "practice", keywords: ["practice","drill","skill","team","session","training"] },
  { type: "strength", keywords: ["strength","lift","weights","gym","squat","bench","deadlift",
                                  "resistance","upper body","lower body","full body","power","core"] },
  { type: "recovery", keywords: ["recovery","rest","easy","light","yoga","stretch","mobility",
                                  "active recovery"] },
  { type: "off",      keywords: ["off","rest day","no training","none"] },
];

function detectType(line) {
  const l = line.toLowerCase();
  for (const { type, keywords } of TYPE_KEYWORDS) {
    if (keywords.some(k => l.includes(k))) return type;
  }
  return "off";
}

function extractDuration(line) {
  const hm = line.match(/(\d+)h\s*(\d+)/i);
  if (hm) return parseInt(hm[1]) * 60 + parseInt(hm[2]);
  const h = line.match(/(\d+(?:\.\d+)?)\s*h(?:ours?)?(?!\w)/i);
  if (h) return Math.round(parseFloat(h[1]) * 60);
  const m = line.match(/(\d+)\s*min(?:utes?)?/i);
  if (m) return parseInt(m[1]);
  return 0;
}

function extractDistance(text) {
  const miles = text.match(/(\d+(?:\.\d+)?)\s*mi(?:les?)?(?!\w)/i);
  if (miles) return { distance: parseFloat(miles[1]), distanceUnit: "mi" };
  const km = text.match(/(\d+(?:\.\d+)?)\s*k(?:m|ilometers?)?(?!\w)/i);
  if (km) return { distance: parseFloat(km[1]), distanceUnit: "km" };
  if (/half[\s-]?marathon/i.test(text)) return { distance: 13.1, distanceUnit: "mi" };
  if (/\bmarathon\b/i.test(text)) return { distance: 26.2, distanceUnit: "mi" };
  return null;
}

function inferIntensity(type, line) {
  const l = line.toLowerCase();
  if (/high|heavy|hard|max|interval|sprint|race/.test(l)) return "high";
  if (/tempo|threshold|fartlek/.test(l)) return "moderate";
  if (/low|easy|light|recovery|jog|long run/.test(l)) return "low";
  if (type === "game") return "high";
  if (type === "recovery" || type === "off") return "low";
  return "moderate";
}

function inferSubtype(type, line) {
  if (type === "cardio") {
    if (/\bintervals?\b|\b800s?\b|\b400s?\b|\brepeat/i.test(line)) return "Intervals";
    if (/\btempo\b|\bthreshold\b/i.test(line)) return "Tempo Run";
    if (/\blong\s*run\b/i.test(line)) return "Long Run";
    if (/\bprogression\b/i.test(line)) return "Progression Run";
    if (/\bfartlek\b/i.test(line)) return "Fartlek";
    if (/\bhills?\b/i.test(line)) return "Hill Run";
    if (/\beasy\s*run\b|\brecovery\s*run\b/i.test(line)) return "Easy Run";
    if (/\beasy\b|\bjog\b/i.test(line)) return "Easy Run";
    if (/\brun\b/i.test(line)) return "Run";
    if (/\bbike\b|\bcycle\b/i.test(line)) return "Bike";
    return null;
  }
  if (type === "strength") {
    if (/\bfull[\s-]?body\b/i.test(line)) return "Full Body";
    if (/\bupper[\s-]?body\b|\bupper\b/i.test(line)) return "Upper Body";
    if (/\blower[\s-]?body\b|\blower\b|\blegs?\b/i.test(line)) return "Lower Body";
    return null;
  }
  if (type === "recovery") {
    if (/\byoga\b/i.test(line)) return "Yoga";
    if (/\bactive\s*recovery\b/i.test(line)) return "Active Recovery";
    if (/\bmobilit/i.test(line)) return "Mobility";
    if (/\bstretch/i.test(line)) return "Stretching";
    return null;
  }
  return null;
}

const DEFAULT_DURATION = { strength:60, practice:90, game:120, cardio:45, recovery:30, off:0 };

function parseLine(line) {
  const t = line.trim();
  if (!t) return null;
  const dayMatch = t.match(/^([a-zA-Z]{3,9})\s*[:\-–—]\s*/i);
  if (!dayMatch) return null;
  const dayKey = dayMatch[1].toLowerCase();
  const day = DAY_MAP[dayKey];
  if (!day) return null;
  const rest = t.slice(dayMatch[0].length);
  const training_type = detectType(rest);
  const rawDur = extractDuration(rest);
  const duration = rawDur > 0 ? rawDur : DEFAULT_DURATION[training_type];
  const intensity = inferIntensity(training_type, rest);
  const subtype = inferSubtype(training_type, rest);
  const distResult = extractDistance(rest);
  return {
    day,
    training_type,
    duration,
    intensity,
    ...(subtype   ? { subtype }                        : {}),
    ...(distResult ? { distance: distResult.distance, distanceUnit: distResult.distanceUnit } : {}),
  };
}

function parseTrainingInput(rawInput) {
  const lines = rawInput.split(/\r?\n/);
  const parsed = new Map();
  for (const line of lines) {
    const result = parseLine(line);
    if (result) {
      const { day, ...entry } = result;
      parsed.set(day, entry);
    }
  }
  const weeklySchedule = ORDERED_DAYS.map(day => {
    const entry = parsed.get(day) ?? { training_type: "off", duration: 0, intensity: "low" };
    return { day, ...entry };
  });
  return { id: "test", name: "Test Plan", rawInput, weeklySchedule, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

// ─── Load score (mirrors lib/training-engine.ts calculateLoadScore) ───────────

const INTENSITY_FACTOR = { low: 1.0, moderate: 1.5, high: 2.0 };

function calculateLoadScore(day) {
  if (day.training_type === "off") return 0;
  const factor = INTENSITY_FACTOR[day.intensity];
  let base;
  if (day.distance !== undefined && day.distance > 0) {
    const miles = day.distanceUnit === "km" ? day.distance * 0.621 : day.distance;
    base = miles * 10 * factor;
  } else {
    base = day.duration * factor;
  }
  const subtype = (day.subtype ?? "").toLowerCase();
  if (subtype.includes("long run")) base += 10;
  if (day.training_type === "game")     base += 20;
  if (day.training_type === "recovery") base *= 0.5;
  return Math.round(base);
}

// ─── Display formatter ────────────────────────────────────────────────────────

function formatDuration(min) {
  if (min === 0) return "—";
  if (min < 60)  return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function formatRow(day, loadScore) {
  const distStr = day.distance !== undefined
    ? `${day.distance} ${day.distanceUnit === "km" ? "km" : "miles"}`
    : null;
  const durStr = day.duration > 0 ? formatDuration(day.duration) : null;
  const metric = day.training_type === "off"
    ? "Rest"
    : distStr && durStr
      ? `${distStr} · ${durStr}`
      : distStr ?? durStr ?? "—";
  const label = day.subtype ?? day.training_type;
  return `${day.day.padEnd(11)} ${label.padEnd(16)} ${metric.padEnd(22)} load=${loadScore}`;
}

// ─── API-route validation logic (mirrors route.ts validateEntry) ──────────────

const VALID_TYPES = new Set(["strength","practice","game","recovery","cardio","off"]);
const VALID_INTENSITY = new Set(["low","moderate","high"]);

function resolveTrainingType(type, category) {
  const t = (type ?? "").toLowerCase().trim();
  const c = (category ?? "").toLowerCase().trim();
  if (/\boff\b|\brest\b|\bnone\b/.test(t)) return "off";
  if (/\bgame\b|\brace\b|\bcompetition\b|\bmatch\b/.test(t)) return "game";
  if (/\bpractice\b|\bdrill\b|\bskills\b/.test(t)) return "practice";
  if (/\brecovery\b|\byoga\b|\bmobility\b|\bstretch\b|\bwalk\b/.test(t)) return "recovery";
  if (/\bstrength\b|\blift\b|\bweights?\b|\bgym\b|\bpower\b/.test(t)) return "strength";
  if (/\brun\b|\bbike\b|\bswim\b|\brow\b|\bcardio\b|\bcycle\b|\bhike\b|\bspin\b/.test(t)) return "cardio";
  if (c === "cardio") return "cardio";
  if (c === "strength") return "strength";
  if (c === "sport") return "practice";
  if (c === "recovery") return "recovery";
  return "off";
}

function parseDuration(v) {
  if (typeof v === "number") return Math.min(Math.max(v, 0), 600);
  if (!v) return 0;
  const s = String(v).toLowerCase().trim();
  const hm = s.match(/(\d+)\s*h(?:our)?s?\s*(\d+)?\s*m?i?n?/);
  if (hm) return Math.min(parseInt(hm[1]) * 60 + parseInt(hm[2] ?? "0"), 600);
  const h = s.match(/^(\d+)\s*h(?:our)?s?$/);
  if (h) return Math.min(parseInt(h[1]) * 60, 600);
  const m = s.match(/(\d+)\s*m(?:in)?/);
  if (m) return Math.min(parseInt(m[1]), 600);
  return parseInt(s) || 0;
}

function validateEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const r = raw;
  const WEEK_DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
  const day = String(r.day ?? "").trim();
  if (!WEEK_DAYS.includes(day)) return null;
  const rawType = String(r.type ?? r.training_type ?? "Off");
  const rawCategory = String(r.category ?? "");
  const training_type = resolveTrainingType(rawType, rawCategory);
  if (!VALID_TYPES.has(training_type)) return null;
  const subtype = typeof r.subtype === "string" && r.subtype.trim() ? r.subtype.trim() : undefined;
  const rawIntensity = String(r.intensity ?? "").toLowerCase().trim();
  const intensity = VALID_INTENSITY.has(rawIntensity) ? rawIntensity : "moderate";
  let duration = parseDuration(r.duration_minutes ?? r.duration);
  if (duration === 0 && training_type !== "off") {
    const d = { strength:50, practice:80, game:120, cardio:40, recovery:30, off:0 };
    duration = d[training_type] ?? 0;
  }
  const raw_dist = r.distance_miles ?? r.distance;
  const distance = raw_dist != null && parseFloat(raw_dist) > 0 ? parseFloat(raw_dist) : undefined;
  const distanceUnit = distance !== undefined ? (r.distanceUnit === "km" ? "km" : "mi") : undefined;
  return { day, training_type, duration, intensity, ...(subtype ? { subtype } : {}), ...(distance !== undefined ? { distance, distanceUnit } : {}) };
}

// ─── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
    failures.push(`${label}${detail ? `: ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(60));
}

// ─── TEST 1: Primary sample plan ─────────────────────────────────────────────

section("TEST 1: Primary sample plan parsing");

const SAMPLE = `Monday — Strength 45 min
Tuesday — Easy Run 3 miles
Wednesday — Off
Thursday — Tempo Run 4 miles
Friday — Strength 45 min
Saturday — Long Run 8 miles
Sunday — Recovery 30 min`;

console.log("[parse] Input:");
SAMPLE.split("\n").forEach(l => console.log(`  ${l}`));

const plan = parseTrainingInput(SAMPLE);
console.log("\n[parse] Result:");

assert("Plan has 7 days", plan.weeklySchedule.length === 7);

const byDay = Object.fromEntries(plan.weeklySchedule.map(d => [d.day, d]));

// Monday
assert("Monday → strength",    byDay.Monday.training_type === "strength");
assert("Monday duration=45",   byDay.Monday.duration === 45, `got ${byDay.Monday.duration}`);
assert("Monday intensity=moderate", byDay.Monday.intensity === "moderate", `got ${byDay.Monday.intensity}`);

// Tuesday
assert("Tuesday → cardio",     byDay.Tuesday.training_type === "cardio");
assert("Tuesday distance=3",   byDay.Tuesday.distance === 3, `got ${byDay.Tuesday.distance}`);
assert("Tuesday unit=mi",      byDay.Tuesday.distanceUnit === "mi", `got ${byDay.Tuesday.distanceUnit}`);
assert("Tuesday subtype=Easy Run", byDay.Tuesday.subtype === "Easy Run", `got ${byDay.Tuesday.subtype}`);
assert("Tuesday intensity=low",byDay.Tuesday.intensity === "low", `got ${byDay.Tuesday.intensity}`);

// Wednesday
assert("Wednesday → off",      byDay.Wednesday.training_type === "off");

// Thursday
assert("Thursday → cardio",    byDay.Thursday.training_type === "cardio");
assert("Thursday distance=4",  byDay.Thursday.distance === 4, `got ${byDay.Thursday.distance}`);
assert("Thursday subtype=Tempo Run", byDay.Thursday.subtype === "Tempo Run", `got ${byDay.Thursday.subtype}`);
assert("Thursday intensity=moderate", byDay.Thursday.intensity === "moderate", `got ${byDay.Thursday.intensity}`);

// Friday
assert("Friday → strength",    byDay.Friday.training_type === "strength");
assert("Friday duration=45",   byDay.Friday.duration === 45, `got ${byDay.Friday.duration}`);

// Saturday
assert("Saturday → cardio",    byDay.Saturday.training_type === "cardio");
assert("Saturday distance=8",  byDay.Saturday.distance === 8, `got ${byDay.Saturday.distance}`);
assert("Saturday subtype=Long Run", byDay.Saturday.subtype === "Long Run", `got ${byDay.Saturday.subtype}`);
assert("Saturday intensity=low", byDay.Saturday.intensity === "low", `got ${byDay.Saturday.intensity}`);

// Sunday
assert("Sunday → recovery",    byDay.Sunday.training_type === "recovery");
assert("Sunday duration=30",   byDay.Sunday.duration === 30, `got ${byDay.Sunday.duration}`);
assert("Sunday intensity=low", byDay.Sunday.intensity === "low", `got ${byDay.Sunday.intensity}`);

// ─── TEST 2: Load scores ──────────────────────────────────────────────────────

section("TEST 2: Load score calculations");

const loads = plan.weeklySchedule.map(d => ({ day: d.day, load_score: calculateLoadScore(d) }));
const loadByDay = Object.fromEntries(loads.map(l => [l.day, l.load_score]));

console.log("[load] Scores:");
loads.forEach(l => console.log(`  ${l.day.padEnd(12)} ${l.load_score}`));

// Monday: Strength 45 min moderate → 45 × 1.5 = 67 (rounded)
assert("Monday load ≈ 68",    loadByDay.Monday === 68, `got ${loadByDay.Monday}`);
// Tuesday: Easy Run 3mi low → 3 × 10 × 1.0 = 30
assert("Tuesday load = 30",   loadByDay.Tuesday === 30, `got ${loadByDay.Tuesday}`);
// Wednesday: Off → 0
assert("Wednesday load = 0",  loadByDay.Wednesday === 0, `got ${loadByDay.Wednesday}`);
// Thursday: Tempo Run 4mi moderate → 4 × 10 × 1.5 = 60
assert("Thursday load = 60",  loadByDay.Thursday === 60, `got ${loadByDay.Thursday}`);
// Friday: Strength 45min moderate → 68
assert("Friday load ≈ 68",    loadByDay.Friday === 68, `got ${loadByDay.Friday}`);
// Saturday: Long Run 8mi low → 8 × 10 × 1.0 + 10 = 90
assert("Saturday load = 90",  loadByDay.Saturday === 90, `got ${loadByDay.Saturday}`);
// Sunday: Recovery 30min low → (30 × 1.0) × 0.5 = 15
assert("Sunday load = 15",    loadByDay.Sunday === 15, `got ${loadByDay.Sunday}`);

// ─── TEST 3: Display output ───────────────────────────────────────────────────

section("TEST 3: Display formatting");

console.log("[display] Full Schedule:");
console.log("  Day         Label            Metric                 Load");
plan.weeklySchedule.forEach(d => {
  const load = calculateLoadScore(d);
  console.log("  " + formatRow(d, load));
});

// Spot-check that display strings are correct
assert("Saturday display includes 'miles'",
  formatRow(byDay.Saturday, loadByDay.Saturday).includes("miles"),
  formatRow(byDay.Saturday, loadByDay.Saturday));
assert("Wednesday display shows 'Rest'",
  formatRow(byDay.Wednesday, loadByDay.Wednesday).includes("Rest"),
  formatRow(byDay.Wednesday, loadByDay.Wednesday));
assert("Monday display shows 'min'",
  formatRow(byDay.Monday, loadByDay.Monday).includes("min"),
  formatRow(byDay.Monday, loadByDay.Monday));
assert("Saturday display shows 'Long Run'",
  formatRow(byDay.Saturday, loadByDay.Saturday).includes("Long Run"),
  formatRow(byDay.Saturday, loadByDay.Saturday));

// ─── TEST 4: Edge cases ───────────────────────────────────────────────────────

section("TEST 4: Edge cases");

const EDGE_CASES = [
  { input: "Monday - Run 5 miles",       expect: { type:"cardio", distance:5 } },
  { input: "Tuesday - Lift 45 min",      expect: { type:"strength", duration:45 } },
  { input: "Wednesday - Game 2h high",   expect: { type:"game", duration:120, intensity:"high" } },
  { input: "Thursday - Practice 1h 15min", expect: { type:"practice", duration:75 } },
  { input: "Friday - Tempo",             expect: { type:"cardio", subtype:"Tempo Run" } },
  { input: "Saturday - Yoga 30 min",     expect: { type:"recovery", duration:30 } },
  { input: "Sunday - Off",               expect: { type:"off" } },
  // Missing duration — should fall back to default
  { input: "Monday - Strength",          expect: { type:"strength", duration:60 } },
  // Missing distance — should fall back to duration
  { input: "Tuesday - Easy Run",         expect: { type:"cardio", subtype:"Easy Run" } },
  // km distance
  { input: "Wednesday - Run 10km",       expect: { type:"cardio", distance:10, distanceUnit:"km" } },
];

for (const { input, expect: ex } of EDGE_CASES) {
  const p = parseLine(input);
  if (!p) {
    assert(`Parse: "${input}"`, false, "parseLine returned null");
    continue;
  }
  const load = calculateLoadScore(p);
  let ok = true;
  const details = [];
  if (ex.type      && p.training_type !== ex.type)     { ok=false; details.push(`type=${p.training_type} want ${ex.type}`); }
  if (ex.distance  !== undefined && p.distance !== ex.distance) { ok=false; details.push(`dist=${p.distance} want ${ex.distance}`); }
  if (ex.distanceUnit && p.distanceUnit !== ex.distanceUnit) { ok=false; details.push(`unit=${p.distanceUnit} want ${ex.distanceUnit}`); }
  if (ex.duration  !== undefined && p.duration !== ex.duration) { ok=false; details.push(`dur=${p.duration} want ${ex.duration}`); }
  if (ex.intensity && p.intensity !== ex.intensity)    { ok=false; details.push(`intensity=${p.intensity} want ${ex.intensity}`); }
  if (ex.subtype   && p.subtype !== ex.subtype)         { ok=false; details.push(`subtype=${p.subtype} want ${ex.subtype}`); }
  assert(`"${input}"`, ok, details.join(", "));
}

// ─── TEST 5: API route validateEntry (Claude JSON → TrainingDay) ──────────────

section("TEST 5: API route validateEntry (Claude response simulation)");

const CLAUDE_ENTRIES = [
  { day:"Monday",    type:"Strength", category:"strength", duration_minutes:45, intensity:"moderate", subtype:null },
  { day:"Tuesday",   type:"Run",      category:"cardio",   distance_miles:3,    intensity:"low",      subtype:"Easy Run" },
  { day:"Wednesday", type:"Off",      category:"recovery", duration_minutes:0,  intensity:"low" },
  { day:"Thursday",  type:"Run",      category:"cardio",   distance_miles:4,    intensity:"moderate", subtype:"Tempo Run" },
  // Text duration (should parse "2h")
  { day:"Friday",    type:"Strength", category:"strength", duration_minutes:"45 min", intensity:"moderate" },
  { day:"Saturday",  type:"Run",      category:"cardio",   distance_miles:8,    intensity:"low",      subtype:"Long Run" },
  { day:"Sunday",    type:"Recovery", category:"recovery", duration_minutes:30, intensity:"low" },
  // Missing intensity (should infer)
  { day:"Monday",    type:"Game",     category:"sport",    duration_minutes:120 },
];

console.log("[validate] Testing validateEntry on simulated Claude responses:");
for (const entry of CLAUDE_ENTRIES) {
  const result = validateEntry(entry);
  assert(
    `validateEntry { day:${entry.day}, type:${entry.type} }`,
    result !== null && result.day === entry.day && VALID_TYPES.has(result.training_type),
    result ? `→ ${result.training_type} | ${result.intensity} | dur=${result.duration}` : "returned null"
  );
}

// ─── TEST 6: Weekly load totals ───────────────────────────────────────────────

section("TEST 6: Weekly load totals");

const weeklyTotal = loads.reduce((sum, l) => sum + l.load_score, 0);
console.log(`[load] Weekly total: ${weeklyTotal}`);
assert("Weekly total > 200 (realistic training week)", weeklyTotal > 200, `got ${weeklyTotal}`);
assert("Weekly total < 600 (not overreaching)", weeklyTotal < 600, `got ${weeklyTotal}`);

// ─── Final report ─────────────────────────────────────────────────────────────

section("RESULTS");

const result = {
  success: failed === 0,
  passed,
  failed,
  parsed_plan: plan.weeklySchedule.map(d => ({
    day: d.day,
    training_type: d.training_type,
    subtype: d.subtype ?? null,
    duration: d.duration,
    distance: d.distance ?? null,
    distanceUnit: d.distanceUnit ?? null,
    intensity: d.intensity,
  })),
  load_scores: loads,
  display_output: plan.weeklySchedule.map(d => formatRow(d, calculateLoadScore(d))),
};

console.log(`\n  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);

if (failures.length > 0) {
  console.error("\n  Failed checks:");
  failures.forEach(f => console.error(`    ✗ ${f}`));
}

console.log("\n[output] Final structured result:");
console.log(JSON.stringify(result, null, 2));

if (!result.success) process.exit(1);
