import { requireAdmin } from "@/lib/auth/require-admin";
import { getApplicationDetail, purgeApplication } from "@/lib/careers/server/applications";
import { apiHandler, jsonResponse } from "@/lib/http/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ApplicationRouteContext = { params: Promise<{ id: string }> };

export const GET = apiHandler("api.admin.applications.get", async (request: Request, context: ApplicationRouteContext) => {
  const ctx = await requireAdmin(request);
  const { id } = await context.params;
  const application = await getApplicationDetail(id, ctx);
  return jsonResponse({ application });
});

// Permanent erasure (administrators only). The application must be archived first.
export const DELETE = apiHandler("api.admin.applications.purge", async (request: Request, context: ApplicationRouteContext) => {
  const ctx = await requireAdmin(request, { roles: ["admin"] });
  const { id } = await context.params;
  await purgeApplication(id, ctx);
  return jsonResponse({ success: true });
});
