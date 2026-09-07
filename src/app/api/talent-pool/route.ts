import { NextResponse } from "next/server";
import { createTalentPoolRecord } from "@/lib/careers";
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
  const areaOfInterest = String(formData.get("areaOfInterest") ?? "").trim().slice(0, 100);
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 1500);
  const consentGiven = formData.get("consentGiven") === "true";
  const cv = formData.get("cv");

  if (!name || !email || !phone || !areaOfInterest || !(cv instanceof File) || cv.size === 0) {
    return NextResponse.json({ error: "Please complete the required talent pool fields." }, { status: 400 });
  }

  if (!EMAIL_REGEX.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }

  if (!PHONE_REGEX.test(phone)) {
    return NextResponse.json({ error: "Please enter a valid phone number." }, { status: 400 });
  }

  if (!consentGiven) {
    return NextResponse.json({ error: "You must consent to data processing to submit your profile." }, { status: 400 });
  }

  if (cv.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "CV file must be under 10 MB." }, { status: 413 });
  }

  const result = await createTalentPoolRecord({
    name,
    email,
    phone,
    areaOfInterest,
    notes,
    cv,
    consentGiven,
  });

  if ("error" in result) {
    const status = result.error?.includes("already in our talent pool") ? 409 : 500;
    return NextResponse.json({ error: result.error ?? "Profile submission failed." }, { status });
  }

  const hrEmail = process.env.HR_NOTIFICATION_EMAIL;
  if (hrEmail) {
    await sendMail({
      to: hrEmail,
      subject: `New talent pool profile: ${name}`,
      text: `${name} joined the talent pool.\n\nEmail: ${email}\nPhone: ${phone}\nArea of interest: ${areaOfInterest}\n\nReview in the admin portal: ${SITE_URL}/careers/admin`,
    });
  }

  await sendMail({
    to: email,
    subject: `Thanks for joining the ${SITE_NAME} talent pool`,
    text: `Hi ${name},\n\nThank you for sharing your profile with ${SITE_NAME}. We'll keep your details on file and reach out when a role matching your interests (${areaOfInterest}) opens up.\n\nBest regards,\n${SITE_NAME} Talent Acquisition Team`,
  });

  return NextResponse.json({
    success: true,
    id: result.record.id,
    message: "Talent profile submitted successfully.",
  });
}
