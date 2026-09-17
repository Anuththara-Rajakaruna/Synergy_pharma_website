import { requireAdmin } from "@/lib/auth/require-admin";
import { createJob, listAdminJobs, type AdminJobStatusFilter } from "@/lib/careers/server/jobs";
import { isJobStatus, parseSearchQuery, validateJobInput } from "@/lib/careers/validation";
import { badRequest } from "@/lib/http/errors";
import { apiHandler, jsonResponse } from "@/lib/http/handler";
import { readJsonBody } from "@/lib/http/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A full job (20k-character description plus four 40-item lists) in multi-byte scripts.
const JOB_BODY_LIMIT = 512 * 1024;

function parseStatusFilter(value: string | null): AdminJobStatusFilter {
  if (value === null || value === "" || value === "active") return "active";
  if (value === "all" || isJobStatus(value)) return value;
  throw badRequest("Invalid status filter.", { status: "Choose active, all, draft, published, closed or archived." });
}

export const GET = apiHandler("api.admin.jobs.list", async (request: Request) => {
  await requireAdmin(request);
  const params = new URL(request.url).searchParams;
  const items = await listAdminJobs({
    status: parseStatusFilter(params.get("status")),
    q: parseSearchQuery(params),
    department: parseSearchQuery(params, "department"),
  });
  return jsonResponse({ items });
});

// Missing status means draft; anything other than draft/published is rejected, never coerced.
function parseCreateStatus(value: unknown): "draft" | "published" | null {
  if (value === undefined || value === null || value === "" || value === "draft") return "draft";
  return value === "published" ? "published" : null;
}

export const POST = apiHandler("api.admin.jobs.create", async (request: Request) => {
  const ctx = await requireAdmin(request);
  const body = await readJsonBody(request, JOB_BODY_LIMIT);

  const result = validateJobInput(body, "create");
  const status = parseCreateStatus(body.status);
  if (!result.ok || !status) {
    const fields: Record<string, string> = result.ok ? {} : { ...result.errors };
    if (!status) fields.status = "Choose draft or published.";
    throw badRequest(result.ok ? "New jobs can be saved as a draft or published." : result.message, fields);
  }

  const job = await createJob(result.value, status, ctx);
  return jsonResponse({ job }, { status: 201 });
});
