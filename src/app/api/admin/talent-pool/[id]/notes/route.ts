import { requireAdmin } from "@/lib/auth/require-admin";
import { parseNotePayload } from "@/lib/careers/server/mappers";
import { addTalentNote } from "@/lib/careers/server/talent-pool";
import { apiHandler, jsonResponse } from "@/lib/http/handler";
import { readJsonBody } from "@/lib/http/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TalentRouteContext = { params: Promise<{ id: string }> };

// POST { body } — appends an internal HR note.
export const POST = apiHandler("api.admin.talent_pool.notes", async (request: Request, context: TalentRouteContext) => {
  const ctx = await requireAdmin(request);
  const { id } = await context.params;
  const body = parseNotePayload(await readJsonBody(request));
  const talent = await addTalentNote(id, body, ctx);
  return jsonResponse({ talent }, { status: 201 });
});
