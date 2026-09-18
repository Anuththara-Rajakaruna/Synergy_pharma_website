import { requireAdmin } from "@/lib/auth/require-admin";
import { contentDisposition, resolveDocumentDownload } from "@/lib/careers/server/documents";
import { apiHandler } from "@/lib/http/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The bytes are streamed from Drive through this route, so allow for a large CV on a slow link.
export const maxDuration = 60;

// Streams a candidate document to a signed-in admin. Drive has no link that can be handed to a
// browser without also handing over Drive access, so the bytes come through the application
// instead of a redirect to storage. The response is never cached and carries no referrer, and
// resolveDocumentDownload() writes the document.download audit entry before the body is
// returned. 404 document_not_found for an unknown id, document_missing when the file is gone.
export const GET = apiHandler("api.admin.documents.get", async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const ctx = await requireAdmin(request);
  const { id } = await context.params;
  const download = await resolveDocumentDownload(id, ctx);

  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": contentDisposition(download.fileName),
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  if (download.size !== null && Number.isFinite(download.size)) headers.set("Content-Length", String(download.size));

  return new Response(download.body, { status: 200, headers });
});
