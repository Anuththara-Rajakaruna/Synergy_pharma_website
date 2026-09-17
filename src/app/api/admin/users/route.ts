import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminUser, listAdminUsers } from "@/lib/careers/server/users";
import { apiHandler, jsonResponse } from "@/lib/http/handler";
import { readJsonBody } from "@/lib/http/request";
import type { CreateAdminUserResponse } from "@/types/careers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = apiHandler("api.admin.users.list", async (request: Request) => {
  await requireAdmin(request, { roles: ["admin"] });
  const items = await listAdminUsers();
  return jsonResponse({ items });
});

export const POST = apiHandler("api.admin.users.create", async (request: Request) => {
  const ctx = await requireAdmin(request, { roles: ["admin"] });
  const body = await readJsonBody(request, 16 * 1024);
  const result: CreateAdminUserResponse = await createAdminUser(body, ctx);
  return jsonResponse(result, { status: 201 });
});
