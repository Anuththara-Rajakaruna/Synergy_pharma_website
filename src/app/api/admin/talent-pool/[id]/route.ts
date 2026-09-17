import { requireAdmin } from "@/lib/auth/require-admin";
import { parseTalentUpdatePayload } from "@/lib/careers/server/mappers";
import { getTalentDetail, purgeTalentEntry, updateTalentEntry } from "@/lib/careers/server/talent-pool";
import { apiHandler, jsonResponse } from "@/lib/http/handler";
import { readJsonBody } from "@/lib/http/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TalentRouteContext = { params: Promise<{ id: string }> };

export const GET = apiHandler("api.admin.talent_pool.get", async (request: Request, context: TalentRouteContext) => {
  const ctx = await requireAdmin(request);
  const { id } = await context.params;
  const talent = await getTalentDetail(id, ctx);
  return jsonResponse({ talent });
});

// PATCH { name?, phone?, areaOfInterest?, tags? } — the email address is the profile's identity
// and cannot be changed.
export const PATCH = apiHandler("api.admin.talent_pool.update", async (request: Request, context: TalentRouteContext) => {
  const ctx = await requireAdmin(request);
  const { id } = await context.params;
  const patch = parseTalentUpdatePayload(await readJsonBody(request));
  const talent = await updateTalentEntry(id, patch, ctx);
  return jsonResponse({ talent });
});

// Permanent erasure (administrators only). The profile must be archived first.
export const DELETE = apiHandler("api.admin.talent_pool.purge", async (request: Request, context: TalentRouteContext) => {
  const ctx = await requireAdmin(request, { roles: ["admin"] });
  const { id } = await context.params;
  await purgeTalentEntry(id, ctx);
  return jsonResponse({ success: true });
});
