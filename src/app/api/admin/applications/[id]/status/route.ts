import { requireAdmin } from "@/lib/auth/require-admin";
import { changeApplicationStatus } from "@/lib/careers/server/applications";
import { parseStatusChangePayload } from "@/lib/careers/server/mappers";
import { apiHandler, jsonResponse } from "@/lib/http/handler";
import { readJsonBody } from "@/lib/http/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ApplicationRouteContext = { params: Promise<{ id: string }> };

// POST { status, expectedStatus, note?, notifyCandidate?, candidateMessage? }
export const POST = apiHandler("api.admin.applications.status", async (request: Request, context: ApplicationRouteContext) => {
  const ctx = await requireAdmin(request);
  const { id } = await context.params;
  const payload = parseStatusChangePayload(await readJsonBody(request));
  const application = await changeApplicationStatus(id, payload, ctx);
  return jsonResponse({ application });
});
