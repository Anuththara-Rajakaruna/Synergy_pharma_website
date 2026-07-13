import { NextRequest, NextResponse } from "next/server";
import {
  getApplications,
  getTalentPoolEntries,
  updateApplicationStatus,
  updateTalentPoolStatus,
  updateApplicationNotes,
  updateTalentPoolNotes,
  updateInterviewLink,
  bulkUpdateApplicationStatus,
  bulkUpdateTalentPoolStatus,
  getJobViews,
} from "@/lib/careers";
import { ApplicantStatus } from "@/types/careers";
import { sendStatusUpdateNotification, sendInterviewInvitation } from "@/lib/email";

const VALID_STATUSES: ApplicantStatus[] = [
  "applied", "phone_screen", "interview", "offer", "hired", "rejected",
  "pending", "reviewed", "shortlisted", // legacy
];

export async function GET() {
  try {
    const [applications, talentPool, jobViews] = await Promise.all([
      getApplications(),
      getTalentPoolEntries(),
      getJobViews(),
    ]);
    return NextResponse.json({ applications, talentPool, jobViews });
  } catch {
    return NextResponse.json({ error: "Failed to load applicants." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      id?: string;
      ids?: string[];
      type?: string;
      status?: string;
      notes?: string;
      interviewLink?: string;
      action?: string;
    };
    const { id, ids, type, status, notes, interviewLink, action = "status" } = body;

    if (type !== "application" && type !== "talent") {
      return NextResponse.json({ error: 'type must be "application" or "talent".' }, { status: 400 });
    }

    // ── Bulk status update ──────────────────────────────────────────────────
    if (action === "bulk_status") {
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return NextResponse.json({ error: "ids array is required for bulk_status." }, { status: 400 });
      }
      if (!status || !VALID_STATUSES.includes(status as ApplicantStatus)) {
        return NextResponse.json({ error: "Invalid status value." }, { status: 400 });
      }
      const count =
        type === "talent"
          ? await bulkUpdateTalentPoolStatus(ids, status as ApplicantStatus)
          : await bulkUpdateApplicationStatus(ids, status as ApplicantStatus);
      return NextResponse.json({ success: true, updated: count });
    }

    if (!id) {
      return NextResponse.json({ error: "id is required." }, { status: 400 });
    }

    // ── Interview link ──────────────────────────────────────────────────────
    if (action === "interview_link") {
      if (typeof interviewLink !== "string") {
        return NextResponse.json({ error: "interviewLink must be a string." }, { status: 400 });
      }
      const updated = await updateInterviewLink(id, interviewLink);
      if (!updated) return NextResponse.json({ error: "Record not found." }, { status: 404 });

      // Send interview invitation email if a link was provided
      if (interviewLink) {
        void sendInterviewInvitation({
          to: updated.email,
          name: updated.name,
          position: updated.position,
          interviewLink,
        }).catch(() => {});
      }

      return NextResponse.json({ success: true, record: updated });
    }

    // ── Notes update ────────────────────────────────────────────────────────
    if (action === "notes") {
      if (typeof notes !== "string") {
        return NextResponse.json({ error: "notes must be a string." }, { status: 400 });
      }
      const updated =
        type === "talent"
          ? await updateTalentPoolNotes(id, notes)
          : await updateApplicationNotes(id, notes);
      if (!updated) return NextResponse.json({ error: "Record not found." }, { status: 404 });
      return NextResponse.json({ success: true, record: updated });
    }

    // ── Status update ───────────────────────────────────────────────────────
    if (!status || !VALID_STATUSES.includes(status as ApplicantStatus)) {
      return NextResponse.json(
        { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }

    const updated =
      type === "talent"
        ? await updateTalentPoolStatus(id, status as ApplicantStatus)
        : await updateApplicationStatus(id, status as ApplicantStatus);

    if (!updated) return NextResponse.json({ error: "Record not found." }, { status: 404 });

    // Send status notification email (fire-and-forget)
    if (status !== "applied" && status !== "pending" && "email" in updated) {
      const position = "position" in updated
        ? (updated.position as string)
        : (updated as { areaOfInterest: string }).areaOfInterest;
      void sendStatusUpdateNotification({
        to: updated.email as string,
        name: updated.name as string,
        position,
        status,
      }).catch(() => {});
    }

    return NextResponse.json({ success: true, record: updated });
  } catch {
    return NextResponse.json({ error: "Failed to update record." }, { status: 500 });
  }
}
