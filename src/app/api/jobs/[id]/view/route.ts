import { NextResponse } from "next/server";
import { incrementJobViews } from "@/lib/careers";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const views = await incrementJobViews(id);
    return NextResponse.json({ views });
  } catch {
    return NextResponse.json({ error: "Failed to track view." }, { status: 500 });
  }
}
