/**
 * Runs the initial schema migration against Supabase.
 * Uses the Supabase Management API — no extra packages required.
 *
 * Usage: node scripts/run-migration.mjs
 */

import { readFileSync } from "fs";
import { request } from "https";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PROJECT_REF = "aqqvreopgqsfykfhuaot";
const sql = readFileSync(
  join(__dirname, "../supabase/migrations/001_initial_schema.sql"),
  "utf8"
);

// Supabase Management API — requires a Personal Access Token (PAT)
// Generate one at: app.supabase.com → Account → Access Tokens
const MANAGEMENT_TOKEN = process.env.SUPABASE_MANAGEMENT_TOKEN ?? "";

if (!MANAGEMENT_TOKEN) {
  console.error("❌  Set SUPABASE_MANAGEMENT_TOKEN env var before running.");
  console.error("   Generate one at: app.supabase.com → Account → Access Tokens");
  process.exit(1);
}

const body = JSON.stringify({ query: sql });

const options = {
  hostname: "api.supabase.com",
  path:     `/v1/projects/${PROJECT_REF}/database/query`,
  method:   "POST",
  headers: {
    "Content-Type":  "application/json",
    "Authorization": `Bearer ${MANAGEMENT_TOKEN}`,
    "Content-Length": Buffer.byteLength(body),
  },
};

console.log("⏳  Running migration against project:", PROJECT_REF);

const req = request(options, (res) => {
  let data = "";
  res.on("data", (chunk) => (data += chunk));
  res.on("end", () => {
    if (res.statusCode === 200 || res.statusCode === 201) {
      console.log("✅  Migration complete — all tables created.");
    } else {
      console.error(`❌  HTTP ${res.statusCode}:`, data);
      process.exit(1);
    }
  });
});

req.on("error", (err) => {
  console.error("❌  Request failed:", err.message);
  process.exit(1);
});

req.write(body);
req.end();
