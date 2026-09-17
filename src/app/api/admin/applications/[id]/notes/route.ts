import { requireAdmin } from "@/lib/auth/require-admin";
import { addApplicationNote } from "@/lib/careers/server/applications";
import { parseNotePayload } from "@/lib/careers/server/mappers";
import { apiHandler, jsonResponse } from "@/lib/http/handler";
import { readJsonBody } from "@/lib/http/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ApplicationRouteContext = { params: Promise<{ id: string }> };

// POST { body } — appends an internal HR note.
export const POST = apiHandler("api.admin.applications.notes", async (request: Request, context: ApplicationRouteContext) => {
  const ctx = await requireAdmin(request);
  const { id } = await context.params;
  const body = parseNotePayload(await readJsonBody(request));
  const application = await addApplicationNote(id, body, ctx);
  return jsonResponse({ application }, { status: 201 });
});
