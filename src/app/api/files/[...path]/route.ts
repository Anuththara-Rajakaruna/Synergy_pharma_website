import { NextResponse } from "next/server";
import { getPrivateFileBuffer } from "@/lib/careers";

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
  const buffer = await getPrivateFileBuffer(directory, fileName);

  if (!buffer) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
