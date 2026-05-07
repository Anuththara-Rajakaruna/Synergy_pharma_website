import { NextResponse } from "next/server";
import { createApplicationRecord, getJobById } from "@/lib/careers";

function isPdf(file: File | null) {
  if (!file) {
    return false;
  }

  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const position = String(formData.get("position") ?? "").trim();
  const jobId = String(formData.get("jobId") ?? "").trim();
  const coverLetter = String(formData.get("coverLetter") ?? "").trim();
  const cv = formData.get("cv");

  if (!name || !email || !phone || !position || !jobId || !(cv instanceof File) || cv.size === 0) {
    return NextResponse.json({ error: "Please complete every required application field." }, { status: 400 });
  }

  if (!isPdf(cv)) {
    return NextResponse.json({ error: "CV uploads must be provided as PDF files." }, { status: 400 });
  }

  const job = await getJobById(jobId);

  if (!job) {
    return NextResponse.json({ error: "The selected role could not be found." }, { status: 404 });
  }

  const application = await createApplicationRecord({
    name,
    email,
    phone,
    position,
    jobId,
    coverLetter,
    cv,
  });

  return NextResponse.json({
    success: true,
    id: application.id,
    message: "Application submitted successfully.",
  });
}
