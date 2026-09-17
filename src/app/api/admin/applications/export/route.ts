import { requireAdmin } from "@/lib/auth/require-admin";
import { exportApplicationsCsv, parseApplicationFilters } from "@/lib/careers/server/applications";
import { formatDeadlineDate } from "@/lib/careers/validation";
import { apiHandler } from "@/lib/http/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/admin/applications/export — the filtered list (same filters as the list endpoint) as
// a CSV download, at most 5,000 rows.
export const GET = apiHandler("api.admin.applications.export", async (request: Request) => {
  const ctx = await requireAdmin(request);
  const filters = parseApplicationFilters(new URL(request.url).searchParams);
  const { csv, rowCount } = await exportApplicationsCsv(filters, ctx);
  // Date as seen in Sri Lanka, matching the dates HR works with.
  const fileName = `applications-${formatDeadlineDate(new Date())}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Row-Count": String(rowCount),
    },
  });
});
