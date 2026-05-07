import { NextResponse } from "next/server";
import { getApplications, getTalentPoolEntries } from "@/lib/careers";

export async function GET() {
  const [applications, talentPool] = await Promise.all([getApplications(), getTalentPoolEntries()]);

  return NextResponse.json({
    applications,
    talentPool,
  });
}
