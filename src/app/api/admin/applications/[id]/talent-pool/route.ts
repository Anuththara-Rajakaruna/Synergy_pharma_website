import { requireAdmin } from "@/lib/auth/require-admin";
import { moveApplicationToTalentPool } from "@/lib/careers/server/applications";
import { parseMoveToTalentPoolPayload } from "@/lib/careers/server/mappers";
import { apiHandler, jsonResponse } from "@/lib/http/handler";
import { readJsonBody } from "@/lib/http/request";
import type { MoveToTalentPoolResponse } from "@/types/careers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ApplicationRouteContext = { params: Promise<{ id: string }> };

// POST { tags?, note? } — creates or links the candidate's talent pool profile. Safe to retry.
export const POST = apiHandler("api.admin.applications.talent_pool", async (request: Request, context: ApplicationRouteContext) => {
  const ctx = await requireAdmin(request);
  const { id } = await context.params;
  const payload = parseMoveToTalentPoolPayload(await readJsonBody(request));
  const result: MoveToTalentPoolResponse = await moveApplicationToTalentPool(id, payload, ctx);
  return jsonResponse(result);
});
