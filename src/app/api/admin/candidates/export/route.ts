import { requireAdmin } from "@/lib/auth/require-admin";
import { exportCandidateData } from "@/lib/careers/server/candidates";
import { formatDeadlineDate } from "@/lib/careers/validation";
import { apiHandler } from "@/lib/http/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/admin/candidates/export?email= — everything held about one candidate, as a JSON file
// for answering a data access request (administrators only).
export const GET = apiHandler("api.admin.candidates.export", async (request: Request) => {
  const ctx = await requireAdmin(request, { roles: ["admin"] });
  const email = new URL(request.url).searchParams.get("email") ?? "";
  const data = await exportCandidateData(email, ctx);
  const fileName = `candidate-data-${formatDeadlineDate(new Date())}.json`;
  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
