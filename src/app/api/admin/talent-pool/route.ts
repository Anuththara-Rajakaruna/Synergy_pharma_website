import { requireAdmin } from "@/lib/auth/require-admin";
import { createTalentEntry, listTalent, parseTalentFilters } from "@/lib/careers/server/talent-pool";
import { parsePagination, validateHrTalentInput } from "@/lib/careers/validation";
import { badRequest } from "@/lib/http/errors";
import { apiHandler, jsonResponse } from "@/lib/http/handler";
import { readJsonBody } from "@/lib/http/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/admin/talent-pool?q=&area=&tag=&source=&from=&to=&archived=&page=&limit=
export const GET = apiHandler("api.admin.talent_pool.list", async (request: Request) => {
  await requireAdmin(request);
  const params = new URL(request.url).searchParams;
  const result = await listTalent(parseTalentFilters(params), parsePagination(params));
  return jsonResponse(result);
});

// POST HrTalentPayload — HR adds a candidate manually (documents optional, uploaded beforehand).
export const POST = apiHandler("api.admin.talent_pool.create", async (request: Request) => {
  const ctx = await requireAdmin(request);
  const result = validateHrTalentInput(await readJsonBody(request));
  if (!result.ok) throw badRequest(result.message, result.errors);
  const talent = await createTalentEntry(result.value, ctx);
  return jsonResponse({ talent }, { status: 201 });
});
