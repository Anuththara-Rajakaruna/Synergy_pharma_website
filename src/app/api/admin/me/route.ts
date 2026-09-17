import { requireAdmin } from "@/lib/auth/require-admin";
import { apiHandler, jsonResponse } from "@/lib/http/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = apiHandler("api.admin.me", async (request: Request) => {
  const ctx = await requireAdmin(request, { allowPasswordChangePending: true });
  return jsonResponse({ user: ctx.user });
});
