import { requireAdmin } from "@/lib/auth/require-admin";
import { parseArchivePayload } from "@/lib/careers/server/mappers";
import { setTalentArchived } from "@/lib/careers/server/talent-pool";
import { apiHandler, jsonResponse } from "@/lib/http/handler";
import { readJsonBody } from "@/lib/http/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TalentRouteContext = { params: Promise<{ id: string }> };

// POST { archived: true, reason? } archives; { archived: false } restores.
export const POST = apiHandler("api.admin.talent_pool.archive", async (request: Request, context: TalentRouteContext) => {
  const ctx = await requireAdmin(request);
  const { id } = await context.params;
  const { archived, reason } = parseArchivePayload(await readJsonBody(request));
  const talent = await setTalentArchived(id, archived, reason, ctx);
  return jsonResponse({ talent });
});
