import { requireAdmin } from "@/lib/auth/require-admin";
import { deleteJob, getAdminJob, updateJob } from "@/lib/careers/server/jobs";
import { validateJobInput } from "@/lib/careers/validation";
import { badRequest, notFound } from "@/lib/http/errors";
import { apiHandler, jsonResponse } from "@/lib/http/handler";
import { readJsonBody } from "@/lib/http/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const JOB_BODY_LIMIT = 512 * 1024;

type JobRouteContext = { params: Promise<{ id: string }> };

export const GET = apiHandler("api.admin.jobs.get", async (request: Request, context: JobRouteContext) => {
  await requireAdmin(request);
  const { id } = await context.params;
  const job = await getAdminJob(id);
  if (!job) throw notFound("Job not found.", "job_not_found");
  return jsonResponse({ job });
});

// Full editor payload. The slug is immutable and status changes go through ./status, so both
// are ignored here.
export const PATCH = apiHandler("api.admin.jobs.update", async (request: Request, context: JobRouteContext) => {
  const ctx = await requireAdmin(request);
  const { id } = await context.params;
  const body = await readJsonBody(request, JOB_BODY_LIMIT);
  const result = validateJobInput(body, "update");
  if (!result.ok) throw badRequest(result.message, result.errors);
  const job = await updateJob(id, result.value, ctx);
  return jsonResponse({ job });
});

export const DELETE = apiHandler("api.admin.jobs.delete", async (request: Request, context: JobRouteContext) => {
  const ctx = await requireAdmin(request);
  const { id } = await context.params;
  await deleteJob(id, ctx);
  return jsonResponse({ success: true });
});
