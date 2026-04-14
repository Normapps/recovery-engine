// Force Node.js runtime — required for pdf-parse and Buffer APIs.
// Must NOT run in Edge Runtime.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import pdf from "pdf-parse";

export async function POST(req: NextRequest) {
  // ── 1. Read FormData ──────────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid request. Expected multipart/form-data." },
      { status: 400 }
    );
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  // ── 2. Convert to Buffer ──────────────────────────────────────────────────
  const buffer   = Buffer.from(await file.arrayBuffer());
  const fileName = file.name.toLowerCase();
  const mimeType = file.type;
  let extractedText = "";

  // ── 3. CSV ────────────────────────────────────────────────────────────────
  if (
    fileName.endsWith(".csv") ||
    mimeType === "text/csv"   ||
    mimeType === "application/csv" ||
    mimeType === "text/plain"
  ) {
    extractedText = buffer.toString();
  }

  // ── 4. PDF ────────────────────────────────────────────────────────────────
  else if (fileName.endsWith(".pdf") || mimeType === "application/pdf") {
    try {
      const data    = await pdf(buffer);
      extractedText = data.text;
    } catch (err) {
      console.error("[upload-training] PDF extraction error:", err);
      return NextResponse.json(
        { error: "Unable to read PDF. Please upload a text-based PDF." },
        { status: 422 }
      );
    }
  }

  // ── Unsupported type ──────────────────────────────────────────────────────
  else {
    return NextResponse.json(
      { error: "Unsupported file type. Upload a PDF or CSV." },
      { status: 415 }
    );
  }

  // ── 5. Debug log (required for debugging) ─────────────────────────────────
  console.log("Extracted training text:", extractedText.slice(0, 500));

  // ── 6. Validate output ────────────────────────────────────────────────────
  if (!extractedText || extractedText.trim().length < 10) {
    return NextResponse.json(
      { error: "Unable to read file. Please upload a valid PDF or CSV." },
      { status: 422 }
    );
  }

  // ── 7. Return clean text — AI parsing happens separately ─────────────────
  return NextResponse.json({ text: extractedText });
}
