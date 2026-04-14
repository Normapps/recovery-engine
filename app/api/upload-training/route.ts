// Force Node.js runtime — required for Buffer APIs.
// Must NOT run in Edge Runtime.
export const runtime = "nodejs";

import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file received" });
    }

    console.log("FILE NAME:", file.name);
    console.log("FILE TYPE:", file.type);
    console.log("FILE SIZE:", file.size);

    const buffer = Buffer.from(await file.arrayBuffer());

    console.log("BUFFER LENGTH:", buffer.length);

    return NextResponse.json({
      success: true,
      name: file.name,
      type: file.type,
      size: file.size,
    });
  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    return NextResponse.json({ error: "Upload failed" });
  }
}
