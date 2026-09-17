import { requireAdmin } from "@/lib/auth/require-admin";
import { setApplicationArchived } from "@/lib/careers/server/applications";
import { parseArchivePayload } from "@/lib/careers/server/mappers";
import { apiHandler, jsonResponse } from "@/lib/http/handler";
import { readJsonBody } from "@/lib/http/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ApplicationRouteContext = { params: Promise<{ id: string }> };

// POST { archived: true, reason? } archives; { archived: false } restores.
export const POST = apiHandler("api.admin.applications.archive", async (request: Request, context: ApplicationRouteContext) => {
  const ctx = await requireAdmin(request);
  const { id } = await context.params;
  const { archived, reason } = parseArchivePayload(await readJsonBody(request));
  const application = await setApplicationArchived(id, archived, reason, ctx);
  return jsonResponse({ application });
});
