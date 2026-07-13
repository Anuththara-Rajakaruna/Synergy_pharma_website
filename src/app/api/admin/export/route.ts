import { NextRequest, NextResponse } from "next/server";
import { getApplications, getTalentPoolEntries } from "@/lib/careers";

function escapeCsvCell(value: string | undefined | null): string {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toRow(cells: (string | undefined | null)[]) {
  return cells.map(escapeCsvCell).join(",");
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") ?? "applications";

    if (type === "talent") {
      const records = await getTalentPoolEntries();
      const header = toRow(["ID", "Name", "Email", "Phone", "Area of Interest", "Notes", "Admin Notes", "Status", "Submitted"]);
      const rows = records.map((r) =>
        toRow([r.id, r.name, r.email, r.phone, r.areaOfInterest, r.notes, r.adminNotes, r.status ?? "pending", r.createdAt])
      );
      const csv = [header, ...rows].join("\r\n");

      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="talent-pool-${new Date().toISOString().split("T")[0]}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const applications = await getApplications();
    const header = toRow(["ID", "Name", "Email", "Phone", "Position", "Job ID", "Cover Letter", "Status", "Notes", "Submitted"]);
    const rows = applications.map((a) =>
      toRow([a.id, a.name, a.email, a.phone, a.position, a.jobId, a.coverLetter, a.status ?? "pending", a.notes, a.createdAt])
    );
    const csv = [header, ...rows].join("\r\n");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="applications-${new Date().toISOString().split("T")[0]}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Export failed." }, { status: 500 });
  }
}
