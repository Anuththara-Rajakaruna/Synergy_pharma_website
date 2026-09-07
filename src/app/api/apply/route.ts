import { NextResponse } from "next/server";
import { createApplicationRecord, getJobById } from "@/lib/careers";
import { sendMail } from "@/lib/email";
import { SITE_NAME, SITE_URL } from "@/lib/site";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+?[\d\s\-().]{7,20}$/;

export async function POST(request: Request) {
  const formData = await request.formData();
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  const email = String(formData.get("email") ?? "").trim().slice(0, 254);
  const phone = String(formData.get("phone") ?? "").trim().slice(0, 20);
  const position = String(formData.get("position") ?? "").trim().slice(0, 200);
  const jobId = String(formData.get("jobId") ?? "").trim();
  const coverLetter = String(formData.get("coverLetter") ?? "").trim().slice(0, 3000);
  const linkedIn = String(formData.get("linkedIn") ?? "").trim().slice(0, 300) || undefined;
  const portfolio = String(formData.get("portfolio") ?? "").trim().slice(0, 300) || undefined;
  const consentGiven = formData.get("consentGiven") === "true";
  const cv = formData.get("cv");

  if (!name || !email || !phone || !position || !jobId || !(cv instanceof File) || cv.size === 0) {
    return NextResponse.json({ error: "Please complete every required application field." }, { status: 400 });
  }

  if (!EMAIL_REGEX.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }

  if (!PHONE_REGEX.test(phone)) {
    return NextResponse.json({ error: "Please enter a valid phone number." }, { status: 400 });
  }

  if (!consentGiven) {
    return NextResponse.json({ error: "You must consent to data processing to apply." }, { status: 400 });
  }

  if (cv.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "CV file must be under 10 MB." }, { status: 413 });
  }

  const job = await getJobById(jobId);
  if (!job) {
    return NextResponse.json({ error: "The selected role could not be found." }, { status: 404 });
  }

  const result = await createApplicationRecord({
    name,
    email,
    phone,
    position,
    jobId,
    coverLetter,
    cv,
    consentGiven,
    linkedIn,
    portfolio,
  });

  if ("error" in result) {
    const errorMsg = result.error ?? "Application submission failed.";
    const status = errorMsg.includes("already submitted") ? 409 : 500;
    return NextResponse.json({ error: errorMsg }, { status });
  }

  const hrEmail = process.env.HR_NOTIFICATION_EMAIL;
  if (hrEmail) {
    await sendMail({
      to: hrEmail,
      subject: `New application: ${job.title} — ${name}`,
      text: [
        `${name} applied for "${job.title}".`,
        "",
        `Email: ${email}`,
        `Phone: ${phone}`,
        linkedIn ? `LinkedIn: ${linkedIn}` : null,
        portfolio ? `Portfolio: ${portfolio}` : null,
        "",
        `Review in the admin portal: ${SITE_URL}/careers/admin`,
      ]
        .filter((line) => line !== null)
        .join("\n"),
    });
  }

  await sendMail({
    to: email,
    subject: `We received your application — ${job.title}`,
    text: `Hi ${name},\n\nThank you for applying to the ${job.title} role at ${SITE_NAME}. Our talent team has received your application and will be in touch if your profile is shortlisted.\n\nBest regards,\n${SITE_NAME} Talent Acquisition Team`,
  });

  return NextResponse.json({
    success: true,
    id: result.record.id,
    message: "Application submitted successfully.",
  });
}
