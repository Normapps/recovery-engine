/**
 * Full Integration Test: Supabase + Claude pipeline
 *
 * Steps:
 *   1. Create (or reuse) a test user in Supabase
 *   2. Fetch athlete record
 *   3. Insert a test daily entry
 *   4. Call Claude API → score + recommendations
 *   5. Save to recovery_scores
 *   6. Verify the saved record
 *   7. Cleanup test data
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { request } from "https";

// ─── Load env from .env.local ─────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "../.env.local");
const envLines = readFileSync(envPath, "utf8").split("\n");
for (const line of envLines) {
  const [key, ...rest] = line.split("=");
  if (key && rest.length && !key.startsWith("#")) {
    process.env[key.trim()] = rest.join("=").trim();
  }
}

const SUPABASE_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
// Service role key bypasses RLS — test script only, never used in app
const SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxcXZyZW9wZ3FzZnlrZmh1YW90Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTk1ODY2OCwiZXhwIjoyMDkxNTM0NjY4fQ.wf_SMUB6sZmK6nCkdbEo1VmkRIP2YM4Q5IIhQ87btus";
const TODAY             = new Date().toISOString().slice(0, 10);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pass(msg) { console.log(`  ✅  ${msg}`); }
function fail(msg) { console.error(`  ❌  ${msg}`); }
function info(msg) { console.log(`  ℹ️   ${msg}`); }
function section(msg) { console.log(`\n${"─".repeat(56)}\n${msg}\n${"─".repeat(56)}`); }

async function sb(method, path, body, useServiceRole = false) {
  const key = useServiceRole ? SERVICE_KEY : SUPABASE_ANON_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      "Content-Type":  "application/json",
      "apikey":        key,
      "Authorization": `Bearer ${key}`,
      "Prefer":        "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return { status: res.status, data };
}

// ─── STEP 1: Create test user ─────────────────────────────────────────────────

async function ensureTestUser() {
  section("STEP 1 — Create / reuse test user");

  // Check if test user already exists
  const check = await sb("GET", "/users?email=eq.test@synergy-recovery.dev&select=id,display_name,coach_mode", null, true);
  if (check.status === 200 && check.data?.length > 0) {
    const user = check.data[0];
    pass(`Reusing existing test user: ${user.id}`);
    return user.id;
  }

  // Create new test user (service role bypasses RLS)
  const res = await sb("POST", "/users", {
    display_name: "Test Athlete",
    email:        "test@synergy-recovery.dev",
    coach_mode:   "balanced",
  }, true);

  if (res.status !== 201 || !res.data?.[0]?.id) {
    fail(`Failed to create test user. Status: ${res.status}`);
    console.error(res.data);
    process.exit(1);
  }

  const userId = res.data[0].id;
  pass(`Created test user: ${userId}`);
  return userId;
}

// ─── STEP 2: Ensure performance profile ──────────────────────────────────────

async function ensureProfile(userId) {
  section("STEP 2 — Ensure performance profile");

  const check = await sb("GET", `/performance_profiles?user_id=eq.${userId}&select=id`, null, true);
  if (check.status === 200 && check.data?.length > 0) {
    pass(`Profile already exists: ${check.data[0].id}`);
    return;
  }

  const res = await sb("POST", "/performance_profiles", {
    user_id:        userId,
    primary_goal:   "General Fitness",
    training_focus: "Hybrid",
    priority:       "Recovery",
  }, true);

  if (res.status !== 201) {
    fail(`Failed to create profile. Status: ${res.status}`);
    console.error(res.data);
    process.exit(1);
  }

  pass(`Created performance profile: ${res.data[0].id}`);
}

// ─── STEP 3: Fetch athlete record ─────────────────────────────────────────────

async function fetchAthlete(userId) {
  section("STEP 3 — Fetch athlete record from Supabase");

  const [userRes, profileRes] = await Promise.all([
    sb("GET", `/users?id=eq.${userId}&select=id,auth_id,display_name,email,coach_mode,created_at`, null, true),
    sb("GET", `/performance_profiles?user_id=eq.${userId}&select=id,primary_goal,training_focus,priority,event_date&order=updated_at.desc&limit=1`, null, true),
  ]);

  if (userRes.status !== 200 || !userRes.data?.[0]) {
    fail(`Could not fetch user. Status: ${userRes.status}`);
    process.exit(1);
  }

  const athlete = {
    ...userRes.data[0],
    profile: profileRes.data?.[0] ?? null,
  };

  pass(`Fetched athlete: ${athlete.display_name} (${athlete.email})`);
  pass(`Coach mode: ${athlete.coach_mode}`);
  pass(`Goal: ${athlete.profile?.primary_goal ?? "none"}`);
  return athlete;
}

// ─── STEP 4: Insert test daily entry ─────────────────────────────────────────

async function ensureDailyEntry(userId) {
  section("STEP 4 — Insert test daily entry");

  // Check if entry exists for today
  const check = await sb("GET", `/daily_entries?user_id=eq.${userId}&date=eq.${TODAY}&select=id`, null, true);
  if (check.status === 200 && check.data?.length > 0) {
    pass(`Daily entry already exists for ${TODAY}`);
    return;
  }

  const res = await sb("POST", "/daily_entries", {
    user_id:              userId,
    date:                 TODAY,
    sleep_duration:       7.5,
    sleep_quality_rating: 4,
    hrv:                  62,
    resting_hr:           54,
    body_battery:         72,
    calories:             2800,
    protein_g:            185,
    hydration_oz:         96,
    strength_training:    false,
    cardio:               true,
    cardio_duration:      45,
    core_work:            true,
    mobility:             true,
    ice_bath:             false,
    sauna:                true,
    compression:          false,
    massage:              false,
  }, true);

  if (res.status !== 201) {
    fail(`Failed to insert daily entry. Status: ${res.status}`);
    console.error(res.data);
    process.exit(1);
  }

  pass(`Inserted daily entry for ${TODAY}`);
}

// ─── STEP 5: Call Claude API ──────────────────────────────────────────────────

async function callClaude(athlete) {
  section("STEP 5 — Send athlete data to Claude API");

  if (!ANTHROPIC_API_KEY) {
    fail("ANTHROPIC_API_KEY is not set in .env.local");
    process.exit(1);
  }

  const systemPrompt = `You are an elite sports performance scientist and recovery coach.

PERFORMANCE PRODUCT ENGINE — apply these rules to every output:

1. STATE what is happening to the athlete's body right now (simple, honest)
2. Give ONE clear action for today
3. Include a tomorrow benefit hook ("do this and tomorrow you will...")

SCORING RULES:
- Sleep 30% weight | HRV 25% | Training Load 20% | Nutrition 20% | Modalities 5%
- Score 71–100 = Green (perform) | 41–70 = Yellow (manage) | 0–40 = Red (rest)
- Name the single biggest limiting factor pulling the score down

RECOMMENDATION RULES:
- Always 3 modalities: circulation · tissue repair · nervous system
- Each reason must answer: what does this do for the athlete TOMORROW?
- Use benefit-outcome language, not procedural instructions

OUTPUT: Return ONLY valid JSON. No markdown. No prose. No explanation.`;

  const userPrompt = `Analyze this athlete and return a recovery assessment.

ATHLETE:
${JSON.stringify(athlete, null, 2)}

Return this exact JSON structure:
{
  "score": <integer 0–100>,
  "summary": "<1–2 sentences: what is happening to the body + the ONE action today>",
  "recommendations": [
    { "id": "circulation",   "name": "<modality>", "duration": <minutes>, "reason": "<benefit tomorrow>" },
    { "id": "tissue",        "name": "<modality>", "duration": <minutes>, "reason": "<benefit tomorrow>" },
    { "id": "nervous_system","name": "<modality>", "duration": <minutes>, "reason": "<benefit tomorrow>" }
  ]
}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-opus-4-5",
      max_tokens: 1024,
      system:     systemPrompt,
      messages:   [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    fail(`Claude API error: ${res.status}`);
    const err = await res.text();
    console.error(err);
    process.exit(1);
  }

  const raw     = await res.json();
  const text    = raw?.content?.[0]?.text ?? "";
  const cleaned = text.replace(/```(?:json)?\r?\n?/g, "").replace(/\r?\n?```/g, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    fail("Claude returned invalid JSON:");
    console.error(cleaned);
    process.exit(1);
  }

  if (typeof parsed.score !== "number" || parsed.score < 0 || parsed.score > 100) {
    fail(`Invalid score: ${parsed.score}`);
    process.exit(1);
  }
  if (!Array.isArray(parsed.recommendations) || parsed.recommendations.length !== 3) {
    fail(`Expected 3 recommendations, got ${parsed.recommendations?.length}`);
    process.exit(1);
  }

  pass(`Score: ${parsed.score}/100`);
  pass(`Summary: ${parsed.summary}`);
  pass("3 recommendations received:");
  parsed.recommendations.forEach((r) => info(`${r.name} (${r.duration} min) — ${r.reason}`));

  return parsed;
}

// ─── STEP 6: Save to Supabase ─────────────────────────────────────────────────

async function saveScore(userId, analysis) {
  section("STEP 6 — Save recovery score to Supabase");

  const res = await sb("POST", "/recovery_scores", {
    user_id:          userId,
    date:             TODAY,
    calculated_score: Math.round(analysis.score),
    confidence:       "High",
    data_completeness: 0.9,
    recommendations:  analysis.recommendations,
  }, true);

  if (res.status !== 201) {
    // Could be duplicate — try upsert via PATCH
    if (res.status === 409 || (res.data && JSON.stringify(res.data).includes("unique"))) {
      info("Record exists — updating instead...");
      const patch = await sb(
        "PATCH",
        `/recovery_scores?user_id=eq.${userId}&date=eq.${TODAY}`,
        {
          calculated_score: Math.round(analysis.score),
          confidence:       "High",
          recommendations:  analysis.recommendations,
        },
        true
      );
      if (patch.status === 200) {
        pass("Updated existing recovery score record.");
        return patch.data?.[0];
      }
    }
    fail(`Failed to save score. Status: ${res.status}`);
    console.error(res.data);
    process.exit(1);
  }

  const saved = res.data[0];
  pass(`Saved recovery score: ${saved.id}`);
  pass(`Score stored: ${saved.calculated_score}/100`);
  return saved;
}

// ─── STEP 7: Verify ───────────────────────────────────────────────────────────

async function verify(userId) {
  section("STEP 7 — Verify record in Supabase");

  const res = await sb(
    "GET",
    `/recovery_scores?user_id=eq.${userId}&date=eq.${TODAY}&select=id,calculated_score,confidence,recommendations,created_at`,
    null,
    true
  );

  if (res.status !== 200 || !res.data?.[0]) {
    fail("Could not retrieve saved record.");
    process.exit(1);
  }

  const row = res.data[0];
  pass(`Record confirmed in DB:`);
  info(`  ID:          ${row.id}`);
  info(`  Score:       ${row.calculated_score}/100`);
  info(`  Confidence:  ${row.confidence}`);
  info(`  Modalities:  ${row.recommendations.map(r => r.name).join(", ")}`);
  info(`  Saved at:    ${row.created_at}`);

  return row;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log("\n🔬  SYNERGY RECOVERY — FULL INTEGRATION TEST");
  console.log(`📅  Date: ${TODAY}`);

  const userId  = await ensureTestUser();
  await ensureProfile(userId);
  const athlete = await fetchAthlete(userId);
  await ensureDailyEntry(userId);
  const analysis = await callClaude(athlete);
  await saveScore(userId, analysis);
  const verified = await verify(userId);

  section("✅  ALL STEPS PASSED");
  console.log("\nFINAL OUTPUT:");
  console.log(JSON.stringify({
    user_id:         userId,
    date:            TODAY,
    score:           verified.calculated_score,
    recommendations: verified.recommendations,
  }, null, 2));
})();
