import { listOpenJobs } from "@/lib/careers/server/jobs";
import { apiHandler, jsonResponse } from "@/lib/http/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Open jobs only (published, deadline not passed), newest first. Admin listings live under
// /api/admin/jobs.
export const GET = apiHandler("api.jobs.list", async () => {
  const jobs = await listOpenJobs();
  return jsonResponse(jobs);
});
