import { NextResponse } from "next/server";
import { createJob, getJobs, getPublishedJobs } from "@/lib/careers";
import { Job, JobStatus } from "@/types/careers";

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
  const statusInput = String(payload.status ?? "published");
  const validStatuses: JobStatus[] = ["draft", "published", "closed"];
  const status: JobStatus = validStatuses.includes(statusInput as JobStatus)
    ? (statusInput as JobStatus)
    : "published";

  const job: Job = {
    id: String(payload.id ?? "").trim(),
    title: String(payload.title ?? "").trim(),
    department: String(payload.department ?? "").trim(),
    location: String(payload.location ?? "").trim(),
    type: payload.type === "Internship" ? "Internship" : "Full-time",
    status,
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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const showAll = url.searchParams.get("all") === "1";
  const jobs = showAll ? await getJobs() : await getPublishedJobs();
  return NextResponse.json(jobs);
}

export async function POST(request: Request) {
  const payload = (await request.json()) as Partial<Job>;
  const result = validateJobPayload(payload);

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const createResult = await createJob(result.job);

  if ("error" in createResult) {
    return NextResponse.json({ error: createResult.error }, { status: 409 });
  }

  return NextResponse.json(createResult.job, { status: 201 });
}
