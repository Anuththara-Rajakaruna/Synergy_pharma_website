import { getOpenJob } from "@/lib/careers/server/jobs";
import { notFound } from "@/lib/http/errors";
import { apiHandler, jsonResponse } from "@/lib/http/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Draft, closed, expired and archived jobs all answer 404 so unpublished postings can't be probed.
export const GET = apiHandler("api.jobs.get", async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const job = await getOpenJob(id);
  if (!job) throw notFound("This job posting could not be found or is no longer open.", "job_not_found");
  return jsonResponse(job);
});
