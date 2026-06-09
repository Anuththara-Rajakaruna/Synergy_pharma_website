import { NextResponse } from "next/server";
import {
  deleteApplicationRecord,
  deleteTalentPoolRecord,
  updateApplicationRecord,
} from "@/lib/careers";
import { ApplicationStatus } from "@/types/careers";

const VALID_STATUSES: ApplicationStatus[] = [
  "new",
  "reviewing",
  "shortlisted",
  "rejected",
  "hired",
];

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = (await request.json()) as { status?: string; notes?: string };

  const updates: Partial<{ status: ApplicationStatus; notes: string }> = {};

  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status as ApplicationStatus)) {
      return NextResponse.json({ error: "Invalid application status." }, { status: 400 });
    }
    updates.status = body.status as ApplicationStatus;
  }

  if (body.notes !== undefined) {
    updates.notes = String(body.notes).slice(0, 1500);
  }

  const updated = await updateApplicationRecord(id, updates);
  if (!updated) return NextResponse.json({ error: "Application not found." }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const type = url.searchParams.get("type");

  let removed: boolean;
  if (type === "talent-pool") {
    removed = await deleteTalentPoolRecord(id);
  } else {
    removed = await deleteApplicationRecord(id);
  }

  if (!removed) return NextResponse.json({ error: "Record not found." }, { status: 404 });
  return NextResponse.json({ success: true });
}
