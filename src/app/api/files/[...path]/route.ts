import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { getPrivateFilePath } from "@/lib/careers";

export async function GET(
  _: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await context.params;

  if (!segments || segments.length < 2) {
    return NextResponse.json({ error: "Invalid file path." }, { status: 400 });
  }

  const [directory, ...rest] = segments;

  // Only allow known upload directories
  if (directory !== "cvs" && directory !== "talent-pool") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // Reject path traversal attempts
  if (segments.some((segment) => segment.includes(".."))) {
    return NextResponse.json({ error: "Invalid path." }, { status: 400 });
  }

  const fileName = rest.join("/");
  const filePath = await getPrivateFilePath(directory, fileName);

  try {
    const buffer = await readFile(filePath);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
}
