import { NextResponse } from "next/server";
import { createTalentPoolRecord } from "@/lib/careers";

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
  const areaOfInterest = String(formData.get("areaOfInterest") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const cv = formData.get("cv");

  if (!name || !email || !phone || !areaOfInterest || !(cv instanceof File) || cv.size === 0) {
    return NextResponse.json({ error: "Please complete the required talent pool fields." }, { status: 400 });
  }

  if (!isPdf(cv)) {
    return NextResponse.json({ error: "CV uploads must be provided as PDF files." }, { status: 400 });
  }

  const record = await createTalentPoolRecord({
    name,
    email,
    phone,
    areaOfInterest,
    notes,
    cv,
  });

  return NextResponse.json({
    success: true,
    id: record.id,
    message: "Talent profile submitted successfully.",
  });
}
