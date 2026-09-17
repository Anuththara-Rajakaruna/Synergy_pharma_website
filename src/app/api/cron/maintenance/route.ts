import { runMaintenance } from "@/lib/careers/server/maintenance";
import { bearerTokenMatches } from "@/lib/env";
import { serviceUnavailable, unauthorized } from "@/lib/http/errors";
import { apiHandler, jsonResponse } from "@/lib/http/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// Vercel Cron calls this with `Authorization: Bearer <CRON_SECRET>` (GET); other schedulers may
// use POST with the same header.
async function handle(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (!secret) throw serviceUnavailable("Scheduled maintenance is not configured.", "cron_not_configured");
  if (!bearerTokenMatches(request.headers.get("authorization"), secret)) throw unauthorized("Invalid cron credentials.");
  const report = await runMaintenance();
  return jsonResponse(report);
}

export const GET = apiHandler("api.cron.maintenance", handle);
export const POST = apiHandler("api.cron.maintenance", handle);
