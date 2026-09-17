import { requireAdmin } from "@/lib/auth/require-admin";
import { listApplications, parseApplicationFilters } from "@/lib/careers/server/applications";
import { parsePagination } from "@/lib/careers/validation";
import { apiHandler, jsonResponse } from "@/lib/http/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/admin/applications?q=&status=&job=&from=&to=&archived=&sort=&page=&limit=
export const GET = apiHandler("api.admin.applications.list", async (request: Request) => {
  await requireAdmin(request);
  const params = new URL(request.url).searchParams;
  const result = await listApplications(parseApplicationFilters(params), parsePagination(params));
  return jsonResponse(result);
});
