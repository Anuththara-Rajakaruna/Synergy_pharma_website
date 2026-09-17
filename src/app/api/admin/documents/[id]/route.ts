import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { resolveDocumentDownload } from "@/lib/careers/server/documents";
import { apiHandler } from "@/lib/http/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Redirects to a 60-second presigned download URL. The URL is never cached or leaked through
// the Referer header of the storage request.
export const GET = apiHandler("api.admin.documents.get", async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const ctx = await requireAdmin(request);
  const { id } = await context.params;
  const url = await resolveDocumentDownload(id, ctx);
  const response = NextResponse.redirect(url, 302);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
});
