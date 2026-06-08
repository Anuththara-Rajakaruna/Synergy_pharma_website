import { NextRequest, NextResponse } from "next/server";
import { getApplications } from "@/lib/careers";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email")?.trim().toLowerCase();
    const id = searchParams.get("id")?.trim();

    if (!email || !id) {
      return NextResponse.json({ error: "Email and application ID are required." }, { status: 400 });
    }

    const applications = await getApplications();
    const application = applications.find(
      (a) => a.id === id && a.email.toLowerCase() === email
    );

    if (!application) {
      return NextResponse.json({ error: "No application found with those details." }, { status: 404 });
    }

    // Return only safe fields — no CV path or internal notes
    return NextResponse.json({
      id: application.id,
      name: application.name,
      position: application.position,
      status: application.status ?? "pending",
      createdAt: application.createdAt,
    });
  } catch {
    return NextResponse.json({ error: "Failed to look up application." }, { status: 500 });
  }
}
