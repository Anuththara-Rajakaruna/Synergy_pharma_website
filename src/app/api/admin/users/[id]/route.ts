import { requireAdmin } from "@/lib/auth/require-admin";
import { updateAdminUser } from "@/lib/careers/server/users";
import { apiHandler, jsonResponse } from "@/lib/http/handler";
import { readJsonBody } from "@/lib/http/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const PATCH = apiHandler(
  "api.admin.users.update",
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const ctx = await requireAdmin(request, { roles: ["admin"] });
    const { id } = await context.params;
    const body = await readJsonBody(request, 16 * 1024);
    const user = await updateAdminUser(id, body, ctx);
    return jsonResponse({ user });
  }
);
