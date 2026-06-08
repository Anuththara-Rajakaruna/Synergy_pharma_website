import { NextResponse } from "next/server";
import { deleteJob, getJobById, updateJob } from "@/lib/careers";
import { Job } from "@/types/careers";

function normalizeTextArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  return String(value ?? "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function validateJobPayload(id: string, payload: Partial<Job>) {
  const salary = String(payload.salary ?? "").trim();
  const closingDate = String(payload.closingDate ?? "").trim();
  const preferredRequirements = normalizeTextArray(payload.preferredRequirements);
  const job: Job = {
    id,
    title: String(payload.title ?? "").trim(),
    department: String(payload.department ?? "").trim(),
    location: String(payload.location ?? "").trim(),
    type: payload.type === "Internship" ? "Internship" : "Full-time",
    description: String(payload.description ?? "").trim(),
    responsibilities: normalizeTextArray(payload.responsibilities),
    requirements: normalizeTextArray(payload.requirements),
    ...(preferredRequirements.length > 0 ? { preferredRequirements } : {}),
    ...(salary ? { salary } : {}),
    ...(closingDate ? { closingDate } : {}),
  };

  if (
    !job.title ||
    !job.department ||
    !job.location ||
    !job.description ||
    job.responsibilities.length === 0 ||
    job.requirements.length === 0
  ) {
    return { error: "Please complete all required job fields." };
  }

  return { job };
}

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const job = await getJobById(id);

    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    return NextResponse.json(job);
  } catch {
    return NextResponse.json({ error: "Failed to load job." }, { status: 500 });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const payload = (await request.json()) as Partial<Job>;
    const result = validateJobPayload(id, payload);

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    const updatedJob = await updateJob(id, result.job);

    if (!updatedJob) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    return NextResponse.json(updatedJob);
  } catch {
    return NextResponse.json({ error: "Failed to update job." }, { status: 500 });
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const removed = await deleteJob(id);

    if (!removed) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete job." }, { status: 500 });
  }
}
