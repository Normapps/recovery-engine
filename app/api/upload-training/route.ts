// Force Node.js runtime — required for Buffer APIs and pdfjs-dist.
// Must NOT run in Edge Runtime.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import path from "path";

// ─── PDF text extraction using pdfjs-dist legacy build ────────────────────────
//
// pdfjs-dist v5 is ESM-only.  Importing it as a static `import` causes webpack
// to emit `require("pdfjs-dist/…")` which fails with ERR_REQUIRE_ESM.
// The `/* webpackIgnore: true */` comment bypasses webpack entirely so Node.js
// resolves the ESM module natively at runtime.

async function extractPDFText(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — webpackIgnore prevents bundling; types come from pdf.d.mts
  const pdfjsLib = await import(
    /* webpackIgnore: true */
    "pdfjs-dist/legacy/build/pdf.mjs"
  );

  // Point to the worker file so pdfjs-dist can spawn it in Node.js.
  // process.cwd() is the project root in both dev and production.
  const workerPath = path.resolve(
    process.cwd(),
    "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"
  );
  pdfjsLib.GlobalWorkerOptions.workerSrc = `file://${workerPath}`;

  const uint8Array = new Uint8Array(buffer);
  const pdf = await pdfjsLib.getDocument({ data: uint8Array }).promise;

  let text = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const strings = content.items.map((item: any) => item.str ?? "");
    text += strings.join(" ") + "\n";
  }

  return text;
}

// ─── POST handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // 1. Read FormData
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

  // 2. Convert to Buffer
  const buffer   = Buffer.from(await file.arrayBuffer());
  const fileName = file.name.toLowerCase();
  const mimeType = file.type;
  let extractedText = "";

  // 3. CSV — read as plain text
  if (
    fileName.endsWith(".csv") ||
    mimeType === "text/csv"   ||
    mimeType === "application/csv" ||
    mimeType === "text/plain"
  ) {
    extractedText = buffer.toString();
  }

  // 4. PDF — extract text with pdfjs-dist
  else if (fileName.endsWith(".pdf") || mimeType === "application/pdf") {
    try {
      extractedText = await extractPDFText(buffer);
    } catch (err) {
      console.error("[upload-training] PDF extraction error:", err);
      return NextResponse.json(
        { error: "Unable to extract text from PDF." },
        { status: 422 }
      );
    }
  }

  // Unsupported type
  else {
    return NextResponse.json(
      { error: "Unsupported file type. Upload a PDF or CSV." },
      { status: 415 }
    );
  }

  // 5. Debug output
  console.log("Extracted text:", extractedText.slice(0, 500));

  // 6. Validate
  if (!extractedText || extractedText.trim().length < 10) {
    return NextResponse.json(
      { error: "Unable to extract text from PDF." },
      { status: 422 }
    );
  }

  // 7. Return clean text — AI parsing is a separate step
  return NextResponse.json({ text: extractedText });
}
