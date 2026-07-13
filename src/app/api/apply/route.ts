import { NextResponse } from "next/server";
import { createApplicationRecord, getJobById, applicationExists } from "@/lib/careers";
import { sendApplicationConfirmation, sendNewApplicationAlert } from "@/lib/email";

function isPdf(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const name = String(formData.get("name") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const phone = String(formData.get("phone") ?? "").trim();
    const position = String(formData.get("position") ?? "").trim();
    const jobId = String(formData.get("jobId") ?? "").trim();
    const coverLetter = String(formData.get("coverLetter") ?? "").trim();
    const cv = formData.get("cv");
    // Honeypot — bots fill this field, humans leave it blank
    const website = String(formData.get("website") ?? "").trim();
    if (website) {
      return NextResponse.json({ success: true, id: "bot", message: "Application submitted successfully." });
    }

    if (!name || !email || !phone || !position || !jobId || !(cv instanceof File) || cv.size === 0) {
      return NextResponse.json({ error: "Please complete every required application field." }, { status: 400 });
    }

    if (cv.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "CV file must be under 10 MB." }, { status: 400 });
    }

    if (!isPdf(cv)) {
      return NextResponse.json({ error: "CV uploads must be provided as PDF files." }, { status: 400 });
    }

    const job = await getJobById(jobId);
    if (!job) {
      return NextResponse.json({ error: "The selected role could not be found." }, { status: 404 });
    }

    const duplicate = await applicationExists(email, jobId);
    if (duplicate) {
      return NextResponse.json(
        { error: "You have already applied for this role. We will be in touch if your profile is a match." },
        { status: 409 }
      );
    }

    const source = String(formData.get("source") ?? "direct").trim() || "direct";
    const application = await createApplicationRecord({ name, email, phone, position, jobId, coverLetter, cv, source });

    // Fire-and-forget emails — don't fail the request if email sending fails
    void sendApplicationConfirmation({ to: email, name, position, applicationId: application.id }).catch(() => {});
    void sendNewApplicationAlert({ applicantName: name, position, email, applicationId: application.id }).catch(() => {});

    return NextResponse.json({
      success: true,
      id: application.id,
      message: "Application submitted successfully.",
    });
  } catch {
    return NextResponse.json({ error: "Failed to submit application. Please try again." }, { status: 500 });
  }
}
