import { requireAdmin } from "@/lib/auth/require-admin";
import { getAdminStats } from "@/lib/careers/server/stats";
import { apiHandler, jsonResponse } from "@/lib/http/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/admin/stats — dashboard counters.
export const GET = apiHandler("api.admin.stats", async (request: Request) => {
  await requireAdmin(request);
  const stats = await getAdminStats();
  return jsonResponse(stats);
});
