import { requireAdmin } from "@/lib/auth/require-admin";
import { listAuditLogs, type AuditLogFilters } from "@/lib/careers/server/audit";
import { isObjectIdString, toObjectId } from "@/lib/careers/server/ids";
import { parseDateFilter, parsePagination, type FieldErrors } from "@/lib/careers/validation";
import { badRequest } from "@/lib/http/errors";
import { apiHandler, jsonResponse } from "@/lib/http/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// "auth" (every auth.* action) or an exact action such as "job.publish".
const ACTION = /^[a-z_]{1,40}(?:\.[a-z_]{1,40})?$/;
const ENTITY_TYPE = /^[a-z_]{1,40}$/;
const ENTITY_ID = /^[A-Za-z0-9_.:-]{1,120}$/;

function readParam(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key)?.trim();
  return value ? value : undefined;
}

export const GET = apiHandler("api.admin.audit.list", async (request: Request) => {
  await requireAdmin(request, { roles: ["admin"] });
  const params = new URL(request.url).searchParams;
  const { page, limit } = parsePagination(params);
  const errors: FieldErrors = {};
  const filters: AuditLogFilters = { page, limit };

  const action = readParam(params, "action");
  if (action) {
    if (ACTION.test(action)) filters.action = action;
    else errors.action = "Invalid action filter.";
  }
  const entityType = readParam(params, "entityType");
  if (entityType) {
    if (ENTITY_TYPE.test(entityType)) filters.entityType = entityType;
    else errors.entityType = "Invalid record type filter.";
  }
  const entityId = readParam(params, "entityId");
  if (entityId) {
    if (ENTITY_ID.test(entityId)) filters.entityId = entityId;
    else errors.entityId = "Invalid record filter.";
  }
  const actorId = readParam(params, "actorId");
  if (actorId) {
    if (isObjectIdString(actorId)) filters.actorId = toObjectId(actorId);
    else errors.actorId = "Invalid user filter.";
  }
  for (const [key, bound] of [["from", "start"], ["to", "end"]] as const) {
    const raw = readParam(params, key);
    if (!raw) continue;
    const date = parseDateFilter(raw, bound);
    if (date) filters[key] = date;
    else errors[key] = "Dates must use the format YYYY-MM-DD.";
  }
  if (filters.from && filters.to && filters.from > filters.to) {
    errors.to = "The end date must be on or after the start date.";
  }
  if (Object.keys(errors).length > 0) {
    throw badRequest(Object.values(errors)[0] ?? "Invalid filters.", errors);
  }

  const result = await listAuditLogs(filters);
  return jsonResponse(result);
});
