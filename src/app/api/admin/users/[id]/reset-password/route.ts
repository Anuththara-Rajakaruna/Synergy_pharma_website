import { requireAdmin } from "@/lib/auth/require-admin";
import { resetAdminPassword } from "@/lib/careers/server/users";
import { apiHandler, jsonResponse } from "@/lib/http/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = apiHandler(
  "api.admin.users.reset_password",
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const ctx = await requireAdmin(request, { roles: ["admin"] });
    const { id } = await context.params;
    const result = await resetAdminPassword(id, ctx);
    return jsonResponse(result);
  }
);
