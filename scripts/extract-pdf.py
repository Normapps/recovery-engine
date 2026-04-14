#!/usr/bin/env python3
"""
PDF lab report extractor.
Usage: python3 extract-pdf.py <pdf_path>
Returns JSON: { "text": str, "rows": [[str,...]], "method": str, "error": str }
"""
import sys, json, os, io

def extract_pdf(path):
    result = {"text": "", "rows": [], "method": "none", "error": ""}

    # ── STEP 1: pdfplumber (best for text/table PDFs) ────────────────────
    try:
        import pdfplumber
        texts = []
        rows  = []
        with pdfplumber.open(path) as pdf:
            for page in pdf.pages:
                # Extract structured tables
                for table in (page.extract_tables() or []):
                    for row in table:
                        if not row:
                            continue
                        cleaned = [str(c or "").strip() for c in row]
                        # Skip header rows and all-empty rows
                        if any(cleaned) and not all(
                            c.lower() in ("", "biomarker", "test", "analyte", "result",
                                          "value", "unit", "units", "reference range",
                                          "ref range", "normal range", "flag")
                            for c in cleaned
                        ):
                            rows.append(cleaned)
                # Extract plain text as fallback
                t = page.extract_text()
                if t:
                    texts.append(t)

        result["text"]   = "\n".join(texts)
        result["rows"]   = rows
        result["method"] = "pdfplumber"

        if result["text"].strip() or result["rows"]:
            return result

    except Exception as e:
        result["error"] += f"pdfplumber: {e}; "

    # ── STEP 2: PyMuPDF text extraction ──────────────────────────────────
    try:
        import fitz
        texts = []
        doc = fitz.open(path)
        for page in doc:
            t = page.get_text("text")
            if t.strip():
                texts.append(t)

        if texts:
            result["text"]   = "\n".join(texts)
            result["method"] = "pymupdf-text"
            return result

    except Exception as e:
        result["error"] += f"pymupdf-text: {e}; "

    # ── STEP 3: PyMuPDF + Tesseract OCR (scanned PDFs) ───────────────────
    try:
        import fitz, pytesseract
        from PIL import Image

        texts = []
        doc   = fitz.open(path)
        for page in doc:
            pix      = page.get_pixmap(dpi=200)
            img      = Image.open(io.BytesIO(pix.tobytes("png")))
            ocr_text = pytesseract.image_to_string(img)
            if ocr_text.strip():
                texts.append(ocr_text)

        result["text"]   = "\n".join(texts)
        result["method"] = "pymupdf+ocr"
        return result

    except Exception as e:
        result["error"] += f"pymupdf+ocr: {e}; "

    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "no path provided"}))
        sys.exit(1)
    print(json.dumps(extract_pdf(sys.argv[1])))
