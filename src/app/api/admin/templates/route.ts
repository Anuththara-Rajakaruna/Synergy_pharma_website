import { NextRequest, NextResponse } from "next/server";
import { getEmailTemplates, updateEmailTemplate } from "@/lib/careers";

export async function GET() {
  try {
    const templates = await getEmailTemplates();
    return NextResponse.json(templates);
  } catch {
    return NextResponse.json({ error: "Failed to load templates." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as { name?: string; subject?: string; body?: string };
    const { name, subject, body: templateBody } = body;

    if (!name) {
      return NextResponse.json({ error: "Template name is required." }, { status: 400 });
    }

    const updated = await updateEmailTemplate(name, {
      ...(subject !== undefined ? { subject } : {}),
      ...(templateBody !== undefined ? { body: templateBody } : {}),
    });

    if (!updated) {
      return NextResponse.json({ error: "Template not found." }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Failed to update template." }, { status: 500 });
  }
}
