import { NextResponse } from "next/server";
import { createJob, getJobs, getActiveJobs } from "@/lib/careers";
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
  const salary = String(payload.salary ?? "").trim();
  const closingDate = String(payload.closingDate ?? "").trim();
  const preferredRequirements = normalizeTextArray(payload.preferredRequirements);
  const job: Job = {
    id: String(payload.id ?? "").trim(),
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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    // Admin can pass ?all=true to see expired jobs too
    const all = searchParams.get("all") === "true";
    const jobs = all ? await getJobs() : await getActiveJobs();
    return NextResponse.json(jobs);
  } catch {
    return NextResponse.json({ error: "Failed to load jobs." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Partial<Job>;
    const result = validateJobPayload(payload);

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    const createdJob = await createJob(result.job);
    return NextResponse.json(createdJob, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create job." }, { status: 500 });
  }
}
