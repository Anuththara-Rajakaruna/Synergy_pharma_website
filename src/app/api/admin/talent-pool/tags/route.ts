import { requireAdmin } from "@/lib/auth/require-admin";
import { listTalentTags } from "@/lib/careers/server/talent-pool";
import { apiHandler, jsonResponse } from "@/lib/http/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/admin/talent-pool/tags — tags in use on active profiles, sorted.
export const GET = apiHandler("api.admin.talent_pool.tags", async (request: Request) => {
  await requireAdmin(request);
  const tags = await listTalentTags();
  return jsonResponse({ tags });
});
