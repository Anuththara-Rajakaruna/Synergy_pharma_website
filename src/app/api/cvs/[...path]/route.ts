import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/session";

const uploadsDirectory = path.join(process.cwd(), "private", "uploads");

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  // Auth check — only admin session holders can download CVs
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const valid = token ? await verifySessionToken(token) : false;

  if (!valid) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  try {
    const { path: segments } = await context.params;

    // Prevent path traversal: reject segments containing ".."
    if (segments.some((s) => s.includes(".."))) {
      return NextResponse.json({ error: "Invalid path." }, { status: 400 });
    }

    const filePath = path.join(uploadsDirectory, ...segments);

    // Ensure the resolved path stays within the uploads directory
    if (!filePath.startsWith(uploadsDirectory)) {
      return NextResponse.json({ error: "Invalid path." }, { status: 400 });
    }

    const buffer = await readFile(filePath);
    const filename = segments[segments.length - 1] ?? "cv.pdf";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
}
