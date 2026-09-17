import { requireAdmin } from "@/lib/auth/require-admin";
import { parseTalentApplyPayload } from "@/lib/careers/server/mappers";
import { applyTalentToJob } from "@/lib/careers/server/talent-pool";
import { apiHandler, jsonResponse } from "@/lib/http/handler";
import { readJsonBody } from "@/lib/http/request";
import type { TalentApplyResponse } from "@/types/careers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TalentRouteContext = { params: Promise<{ id: string }> };

// POST { jobId, note? } — creates an application for the job from this profile. Safe to retry.
export const POST = apiHandler("api.admin.talent_pool.apply", async (request: Request, context: TalentRouteContext) => {
  const ctx = await requireAdmin(request);
  const { id } = await context.params;
  const payload = parseTalentApplyPayload(await readJsonBody(request));
  const result: TalentApplyResponse = await applyTalentToJob(id, payload, ctx);
  return jsonResponse(result, { status: 201 });
});
