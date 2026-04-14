/**
 * POST /api/parse-labs
 *
 * Accepts multipart form with `file` (PDF/CSV/image/txt) or `text` (pasted text).
 *
 * PDF pipeline (in order, stops at first success):
 *  1. Python (pdfplumber → table rows + text)   — most reliable for all PDF types
 *  2. Regex parser on extracted text              — fast alias matching
 *  3. Claude text extraction (if API key set)     — handles unusual formats
 *  4. Claude PDF document (if API key set)        — last-resort vision fallback
 *
 * Returns: { panel: Partial<BloodworkPanel>, count: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { parseBloodworkCSV, CSV_ALIASES } from "@/lib/bloodwork-engine";
import type { BloodworkPanel } from "@/lib/types";

export async function POST(req: NextRequest) {
  try {
    const formData  = await req.formData();
    const file      = formData.get("file") as File | null;
    const textInput = formData.get("text") as string | null;

    if (!file && !textInput) {
      return NextResponse.json({ error: "No file or text provided" }, { status: 400 });
    }

    let panel: Partial<BloodworkPanel> = {};

    // ── Pasted / plain text ─────────────────────────────────────────────
    if (textInput) {
      panel = parseLabContent(textInput.trim());
    }

    if (file) {
      const fileType = file.type.toLowerCase();
      const filename = file.name.toLowerCase();

      // ── CSV ────────────────────────────────────────────────────────────
      if (fileType.includes("csv") || filename.endsWith(".csv")) {
        panel = parseLabContent(await file.text());
      }

      // ── Plain text ─────────────────────────────────────────────────────
      else if (fileType === "text/plain" || filename.endsWith(".txt")) {
        panel = parseLabContent(await file.text());
      }

      // ── PDF ────────────────────────────────────────────────────────────
      else if (fileType === "application/pdf" || filename.endsWith(".pdf")) {
        const buf = Buffer.from(await file.arrayBuffer());
        panel = await extractFromPDF(buf);
      }

      // ── Image (JPEG / PNG / etc.) ──────────────────────────────────────
      else if (fileType.startsWith("image/")) {
        const bytes = Buffer.from(await file.arrayBuffer());
        if (process.env.ANTHROPIC_API_KEY) {
          panel = await extractVision(
            bytes.toString("base64"),
            fileType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          );
        } else {
          panel = await extractWithTesseract(bytes);
        }
      }

      else {
        return NextResponse.json(
          { error: `Unsupported file type: ${fileType || filename}. Use PDF, CSV, JPG, or PNG.` },
          { status: 400 },
        );
      }
    }

    const count = Object.values(panel).filter((v) => v !== null && v !== undefined).length;
    return NextResponse.json({ panel, count });

  } catch (err) {
    console.error("[parse-labs]", err);
    return NextResponse.json(
      { error: "Failed to parse lab report: " + String(err) },
      { status: 500 },
    );
  }
}

// ─── PDF extraction pipeline ───────────────────────────────────────────────

async function extractFromPDF(buf: Buffer): Promise<Partial<BloodworkPanel>> {

  // ── Step 1: Python (pdfplumber + pymupdf + OCR) ───────────────────────
  const pyResult = await extractWithPython(buf);
  let panel: Partial<BloodworkPanel> = {};

  if (pyResult) {
    // Parse structured table rows first (most reliable)
    if (pyResult.rows?.length) {
      panel = parseTableRows(pyResult.rows);
    }
    // Merge with regex parse of the full text (catches anything rows missed)
    if (pyResult.text?.trim()) {
      const textPanel = parseLabContent(pyResult.text);
      // Text results fill in any gaps left by table parsing
      for (const [k, v] of Object.entries(textPanel)) {
        if (v != null && (panel as Record<string, unknown>)[k] == null) {
          (panel as Record<string, unknown>)[k] = v;
        }
      }
    }
  }

  const count = () => Object.values(panel).filter((v) => v != null).length;

  // ── Step 2: Claude text fallback (unusual formats) ────────────────────
  if (count() < 3 && process.env.ANTHROPIC_API_KEY && pyResult?.text?.trim()) {
    panel = await extractWithClaudeText(pyResult.text);
  }

  // ── Step 3: Claude PDF document fallback (scanned / complex layouts) ──
  if (count() < 3 && process.env.ANTHROPIC_API_KEY) {
    panel = await extractWithClaudePDF(buf);
  }

  return panel;
}

// ─── Python subprocess extraction ─────────────────────────────────────────

interface PythonResult {
  text:   string;
  rows:   string[][];
  method: string;
  error:  string;
}

async function extractWithPython(buf: Buffer): Promise<PythonResult | null> {
  const { execFile }    = await import("child_process");
  const { writeFile, unlink } = await import("fs/promises");
  const { tmpdir }      = await import("os");
  const { join }        = await import("path");
  const { promisify }   = await import("util");
  const execFileAsync   = promisify(execFile);

  const tmpPath     = join(tmpdir(), `lab-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  const scriptPath  = join(process.cwd(), "scripts", "extract-pdf.py");

  try {
    await writeFile(tmpPath, buf);
    const { stdout } = await execFileAsync("python3", [scriptPath, tmpPath], {
      timeout: 45000,
      maxBuffer: 1024 * 1024 * 10, // 10 MB
    });
    return JSON.parse(stdout.trim()) as PythonResult;
  } catch (err) {
    console.error("[python-extract]", err);
    return null;
  } finally {
    unlink(tmpPath).catch(() => {});
  }
}

// ─── Parse structured table rows from pdfplumber ──────────────────────────
// Each row: [name, value, unit?, reference?]

function parseTableRows(rows: string[][]): Partial<BloodworkPanel> {
  const panel: Partial<BloodworkPanel> = {};
  const aliases = Object.keys(CSV_ALIASES).sort((a, b) => b.length - a.length);

  for (const row of rows) {
    if (!row || row.length < 2) continue;
    const rawName = row[0]?.trim();
    const rawVal  = row[1]?.trim();
    if (!rawName || !rawVal) continue;

    // Match name against alias list
    const normName = rawName.toLowerCase().replace(/[_\-\/,()]/g, " ").replace(/\s+/g, " ").trim();
    let matched: string | null = null;

    for (const alias of aliases) {
      const normAlias = alias.replace(/[_\-\/,()]/g, " ").replace(/\s+/g, " ");
      // Only match if the row name contains the alias (not the other way around —
      // that causes "hemoglobin" to match "mean corpuscular hemoglobin concentration")
      if (normName.includes(normAlias)) {
        matched = CSV_ALIASES[alias];
        break;
      }
    }

    if (!matched) continue;
    if ((panel as Record<string, unknown>)[matched] != null) continue;

    // Extract first numeric value (strip units, < > symbols, spaces)
    const numStr = rawVal.replace(/[<>]/g, "").match(/\d+\.?\d*/)?.[0];
    if (!numStr) continue;
    const val = parseFloat(numStr);
    if (isNaN(val) || val < 0) continue;

    (panel as Record<string, number>)[matched] = val;
  }

  return panel;
}

// ─── Unified text parser (regex + CSV) ────────────────────────────────────

function parseLabContent(text: string): Partial<BloodworkPanel> {
  const textResult = extractLabText(text);
  const csvResult  = parseBloodworkCSV(text);
  return { ...textResult, ...csvResult };
}

// ─── Free-text regex extractor ────────────────────────────────────────────

function extractLabText(text: string): Partial<BloodworkPanel> {
  const panel   = {} as Record<string, number>;
  const lines   = text.split(/\r?\n/);
  const aliases = Object.keys(CSV_ALIASES).sort((a, b) => b.length - a.length);

  for (const line of lines) {
    const normalized = line.toLowerCase().replace(/[_\-\/,()]/g, " ").trim();
    if (!normalized || normalized.startsWith("#")) continue;

    for (const alias of aliases) {
      const normAlias = alias.replace(/[_\-\/,()]/g, " ");
      if (!normalized.includes(normAlias)) continue;

      const fieldKey = CSV_ALIASES[alias];
      if (panel[fieldKey] !== undefined) continue;

      // Value followed by a unit (most reliable signal)
      const withUnit   = line.match(/\b(\d+\.?\d*)\s+(?:[a-zA-Zμ%][a-zA-Z\/μ.%*]*)/);
      // Value after 2+ spaces (column-aligned fallback)
      const afterSpace = line.match(/\s{2,}(\d+\.?\d*)/);

      const raw = withUnit?.[1] ?? afterSpace?.[1];
      if (!raw) continue;

      const val = parseFloat(raw);
      if (isNaN(val) || val < 0) continue;

      panel[fieldKey] = val;
      break;
    }
  }

  return panel as Partial<BloodworkPanel>;
}

// ─── Shared Claude extraction prompt ──────────────────────────────────────

const LAB_EXTRACTION_PROMPT = `Extract ALL numeric lab values from this lab report and return them as a single JSON object.

Map test names to these exact camelCase keys (use your best judgment for synonyms):
rbc, hemoglobin, hematocrit, mcv, mch, mchc, rdw, reticulocyteCount,
ferritin, ironSerum, tsat, transferrin, tibc,
creatineKinase, ldh, myoglobin, ast, alt,
hsCRP, il6, tnfAlpha, fibrinogen, esr,
cortisolAM, cortisolPM, testosteroneTotal, testosteroneFree, shbg, dheas, igf1,
tsh, freeT4, freeT3, totalT3, reverseT3, tpoAb,
glucoseFasting, insulin, hba1c, cPeptide,
albumin, totalProtein, ggt, alp, totalBilirubin, directBilirubin,
creatinine, egfr, bun, uricAcid, cystatinC, sodium,
potassium, chloride, bicarbonate, calciumTotal, magnesium, phosphate,
vitaminD, pth, p1np, osteocalcin,
totalCholesterol, ldl, hdl, triglycerides, apob, apoA1, lipoproteinA,
vitaminB12, folate, vitaminB6, zinc, copper, selenium,
omega3Index, epa, dha,
lh, fsh, estradiol, progesterone, prolactin, leptin,
wbc, neutrophils, lymphocytes, monocytes, eosinophils, platelets, mpv,
homocysteine, dDimer, nitricOxide,
adiponectin, bdnf, gdf15

Rules:
- Numeric values only — strip units
- "< 0.5" → use 0.5, "> 80" → use 80
- Skip qualitative results (Negative, Detected, etc.)
- Return ONLY raw JSON with no markdown, no explanation`;

// ─── Claude text extraction ────────────────────────────────────────────────

async function extractWithClaudeText(rawText: string): Promise<Partial<BloodworkPanel>> {
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response  = await client.messages.create({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages:   [{
        role:    "user",
        content: `${LAB_EXTRACTION_PROMPT}\n\nLab report text:\n${rawText.slice(0, 12000)}`,
      }],
    });
    const text = response.content[0].type === "text" ? response.content[0].text : "";
    return parseJSONResponse(text);
  } catch (err) {
    console.error("[claude-text]", err);
    return {};
  }
}

// ─── Claude PDF document extraction ───────────────────────────────────────

async function extractWithClaudePDF(pdfBuffer: Buffer): Promise<Partial<BloodworkPanel>> {
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const base64    = pdfBuffer.toString("base64");

    const response = await client.messages.create({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages:   [{
        role:    "user",
        content: [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } } as any,
          { type: "text", text: LAB_EXTRACTION_PROMPT },
        ],
      }],
    });
    const text = response.content[0].type === "text" ? response.content[0].text : "";
    return parseJSONResponse(text);
  } catch (err) {
    console.error("[claude-pdf]", err);
    return {};
  }
}

// ─── Claude vision (for images) ───────────────────────────────────────────

async function extractVision(
  base64: string,
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp",
): Promise<Partial<BloodworkPanel>> {
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response  = await client.messages.create({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages:   [{
        role:    "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text",  text: LAB_EXTRACTION_PROMPT },
        ],
      }],
    });
    const text = response.content[0].type === "text" ? response.content[0].text : "";
    return parseJSONResponse(text);
  } catch (err) {
    console.error("[claude-vision]", err);
    return {};
  }
}

// ─── Tesseract OCR (image fallback without API key) ───────────────────────

async function extractWithTesseract(imageBuffer: Buffer): Promise<Partial<BloodworkPanel>> {
  try {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng", 1, { logger: () => {} });
    const { data: { text } } = await worker.recognize(imageBuffer);
    await worker.terminate();
    return parseLabContent(text);
  } catch (err) {
    console.error("[tesseract]", err);
    return {};
  }
}

// ─── JSON response parser ──────────────────────────────────────────────────

function parseJSONResponse(text: string): Partial<BloodworkPanel> {
  try {
    const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const match   = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return {};

    const parsed = JSON.parse(match[0]);
    const result: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number" && isFinite(v)) {
        result[k] = v;
      } else if (typeof v === "string") {
        const n = parseFloat(v.replace(/[^0-9.]/g, ""));
        if (!isNaN(n)) result[k] = n;
      }
    }
    return result as Partial<BloodworkPanel>;
  } catch {
    return {};
  }
}
