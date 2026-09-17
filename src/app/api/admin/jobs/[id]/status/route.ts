import { requireAdmin } from "@/lib/auth/require-admin";
import { JOB_STATUS_ACTIONS, type JobStatusAction } from "@/lib/careers/constants";
import { changeJobStatus } from "@/lib/careers/server/jobs";
import { badRequest } from "@/lib/http/errors";
import { apiHandler, jsonResponse } from "@/lib/http/handler";
import { readJsonBody } from "@/lib/http/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isJobStatusAction(value: unknown): value is JobStatusAction {
  return typeof value === "string" && (JOB_STATUS_ACTIONS as readonly string[]).includes(value);
}

export const POST = apiHandler(
  "api.admin.jobs.status",
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const ctx = await requireAdmin(request);
    const { id } = await context.params;
    const body = await readJsonBody(request, 4 * 1024);
    if (!isJobStatusAction(body.action)) {
      throw badRequest("Choose a valid status action.", { action: `Action must be one of: ${JOB_STATUS_ACTIONS.join(", ")}.` });
    }
    const job = await changeJobStatus(id, body.action, ctx);
    return jsonResponse({ job });
  }
);
