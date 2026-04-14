/**
 * POST /api/parse-wearable
 *
 * Accepts a multipart form upload of a wearable device export file:
 *   - Garmin Connect: Health Stats CSV, Sleep CSV, Activities CSV
 *   - WHOOP: journal.csv (recovery + sleep cycle data)
 *   - Oura Ring: sleep.json, readiness.json, or CSV export
 *   - Apple Health: export.xml or CSV summary
 *
 * Returns:
 *   { source, days: ParsedWearableDay[], errors, count }
 *
 * The client stores the days and merges them into DailyEntry records.
 */

import { NextRequest, NextResponse } from "next/server";
import { parseWearableData } from "@/lib/wearable-parser";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const content = await file.text();
    const filename = file.name;

    if (!content.trim()) {
      return NextResponse.json({ error: "File is empty" }, { status: 400 });
    }

    const result = parseWearableData(content, filename);

    return NextResponse.json({
      source: result.source,
      days: result.days,
      errors: result.errors,
      count: result.days.length,
      headers: result.rawHeaders,
    });

  } catch (err) {
    console.error("[parse-wearable]", err);
    return NextResponse.json(
      { error: "Failed to parse wearable data: " + String(err) },
      { status: 500 }
    );
  }
}
