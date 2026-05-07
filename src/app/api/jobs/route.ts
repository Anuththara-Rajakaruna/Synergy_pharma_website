import { NextResponse } from "next/server";
import { createJob, getJobs } from "@/lib/careers";
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

function validateJobPayload(payload: Partial<Job>) {
  const job: Job = {
    id: String(payload.id ?? "").trim(),
    title: String(payload.title ?? "").trim(),
    department: String(payload.department ?? "").trim(),
    location: String(payload.location ?? "").trim(),
    type: payload.type === "Internship" ? "Internship" : "Full-time",
    description: String(payload.description ?? "").trim(),
    responsibilities: normalizeTextArray(payload.responsibilities),
    requirements: normalizeTextArray(payload.requirements),
  };

  if (
    !job.id ||
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

export async function GET() {
  const jobs = await getJobs();
  return NextResponse.json(jobs);
}

export async function POST(request: Request) {
  const payload = (await request.json()) as Partial<Job>;
  const result = validateJobPayload(payload);

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const createdJob = await createJob(result.job);
  return NextResponse.json(createdJob, { status: 201 });
}
