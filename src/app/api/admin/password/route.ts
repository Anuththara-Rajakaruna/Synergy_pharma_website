import { requireAdmin } from "@/lib/auth/require-admin";
import { changeOwnPassword } from "@/lib/careers/server/users";
import { apiHandler, jsonResponse } from "@/lib/http/handler";
import { readJsonBody } from "@/lib/http/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = apiHandler("api.admin.password", async (request: Request) => {
  const ctx = await requireAdmin(request, { allowPasswordChangePending: true });
  const body = await readJsonBody(request, 16 * 1024);
  await changeOwnPassword(ctx, body.currentPassword, body.newPassword);
  return jsonResponse({ success: true });
});
