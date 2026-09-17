import { expect, test } from "@playwright/test";
import { api, loginAsHr, pdfBytes, type UploadTicketResponse } from "../support/api";
import { expectApiError, expectNoSensitiveData, expectRetryAfter, expectStatus } from "./lib/assertions";
import { ORIGIN_EVIL, isolatedClientIp, sendStreamedJson } from "./lib/fixtures";

// POST /api/uploads issues presigned direct-to-storage PUT URLs. The declared file list is
// validated strictly, and storage itself enforces the signed size and content type.

const MB = 1024 * 1024;

type FileDescriptor = { kind: string; name: string; size: unknown; contentType?: string };

function presign(files: FileDescriptor[], options: { purpose?: string; cookie?: string; ip?: string; headers?: Record<string, string> } = {}) {
  return api<UploadTicketResponse>("POST", "/api/uploads", {
    cookie: options.cookie,
    ip: options.ip,
    headers: options.headers,
    json: { purpose: options.purpose ?? "application", files },
  });
}

const cv = (size: unknown = 4096, name = "cv.pdf", contentType = "application/pdf"): FileDescriptor => ({ kind: "cv", name, size, contentType });
const supporting = (size: unknown = 2048, name = "certificate.pdf"): FileDescriptor => ({ kind: "supporting", name, size, contentType: "application/pdf" });

test.describe("POST /api/uploads", () => {
  test("issues one presigned PUT ticket per file", async () => {
    const before = Date.now();
    const result = await presign([cv(4096), supporting(2048), supporting(1024, "transcript.pdf")]);
    expectStatus(result, 201);
    expect(result.headers.get("cache-control")).toContain("no-store");
    const { uploads } = result.body;
    expect(uploads.map((ticket) => ticket.kind)).toEqual(["cv", "supporting", "supporting"]);
    expect(new Set(uploads.map((ticket) => ticket.uploadId)).size).toBe(3);
    for (const ticket of uploads) {
      expect(Object.keys(ticket).sort()).toEqual(["expiresAt", "headers", "kind", "method", "uploadId", "url"]);
      expect(ticket.uploadId).toMatch(/^[A-Za-z0-9-]{8,64}$/);
      expect(ticket.method).toBe("PUT");
      expect(ticket.url).toMatch(/^https?:\/\//);
      expect(ticket.url).toContain("X-Amz-Signature=");
      const headerNames = Object.keys(ticket.headers).map((name) => name.toLowerCase());
      expect(headerNames).toContain("content-type");
      expect(Object.values(ticket.headers)).toContain("application/pdf");
      const expiresIn = new Date(ticket.expiresAt).getTime() - before;
      expect(expiresIn).toBeGreaterThan(10 * 60 * 1000);
      expect(expiresIn).toBeLessThanOrEqual(16 * 60 * 1000);
    }
    // Upload URLs necessarily contain the object location; nothing else may.
    expectNoSensitiveData(uploads.map((ticket) => ({ ...ticket, url: "" })), "upload tickets");
  });

  test("accepts files at exactly the size limits", async () => {
    expectStatus(await presign([cv(10 * MB)]), 201);
    expectStatus(await presign([cv(1), supporting(5 * MB)]), 201);
  });

  test("rejects declared sizes over the limits, empty files and non-integer sizes", async () => {
    const cases: FileDescriptor[][] = [
      [cv(10 * MB + 1)],
      [cv(4096), supporting(5 * MB + 1)],
      [cv(0)],
      [cv(-1)],
      [cv(1.5)],
      [cv("4096")],
      [cv(null)],
      [cv({ $gt: 0 })],
      [cv(Number.MAX_SAFE_INTEGER)],
    ];
    for (const files of cases) {
      expectApiError(await presign(files), 400, "invalid_input", { fields: ["files"] });
    }
  });

  test("rejects files that are not PDFs by name or declared type", async () => {
    const control = `cv${String.fromCharCode(0)}.pdf`;
    const cases: FileDescriptor[][] = [
      [cv(4096, "cv.docx")],
      [cv(4096, "cv.pdf.exe")],
      [cv(4096, "cv")],
      [cv(4096, "cv.pdf", "text/html")],
      [cv(4096, "cv.pdf", "application/x-msdownload")],
      [cv(4096, control)],
      [cv(4096, `${"a".repeat(300)}.pdf`)],
      [{ kind: "cv", name: { $ne: "" } as unknown as string, size: 4096 }],
      [{ kind: "photo", name: "cv.pdf", size: 4096 }],
    ];
    for (const files of cases) {
      expectApiError(await presign(files), 400, "invalid_input", { fields: ["files"] });
    }
  });

  test("rejects too many files and malformed requests", async () => {
    expectApiError(await presign([cv(), cv()]), 400, "invalid_input", { fields: ["files"] });
    expectApiError(await presign([cv(), supporting(), supporting(), supporting(), supporting()]), 400, "invalid_input", { fields: ["files"] });
    expectApiError(await presign([]), 400, "invalid_input", { fields: ["files"] });
    expectApiError(await presign([cv()], { purpose: "avatar" }), 400, "invalid_input", { fields: ["purpose"] });
    const notArray = await api("POST", "/api/uploads", { json: { purpose: "application", files: { kind: "cv" } } });
    expectApiError(notArray, 400, "invalid_input", { fields: ["files"] });
    const operator = await api("POST", "/api/uploads", { json: { purpose: { $in: ["admin_talent"] }, files: [cv()] } });
    expectApiError(operator, 400, "invalid_input", { fields: ["purpose"] });
    expectApiError(await api("POST", "/api/uploads", { json: [cv()] }), 400, "invalid_json");
    const malformed = await api("POST", "/api/uploads", { body: "{not json", headers: { "content-type": "application/json" } });
    expectApiError(malformed, 400, "invalid_json");
  });

  test("requires a JSON content type and a small body", async () => {
    const text = await api("POST", "/api/uploads", {
      body: JSON.stringify({ purpose: "application", files: [cv()] }),
      headers: { "content-type": "text/plain" },
    });
    expectApiError(text, 415, "unsupported_media_type");
    const form = await api("POST", "/api/uploads", { body: "purpose=application", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expectApiError(form, 415, "unsupported_media_type");
    const large = await api("POST", "/api/uploads", {
      json: { purpose: "application", files: [cv()], padding: "a".repeat(70 * 1024) },
    });
    expectApiError(large, 413, "payload_too_large");
    const streamed = await sendStreamedJson("POST", "/api/uploads", 200 * 1024);
    expect(streamed.status, streamed.text.slice(0, 200)).toBe(413);
  });

  test("admin_talent uploads require an admin session", async () => {
    expectApiError(await presign([cv()], { purpose: "admin_talent" }), 401, "unauthorized");
    const forged = await presign([cv()], { purpose: "admin_talent", cookie: `__Host-synergy_admin=${"A".repeat(43)}` });
    expectApiError(forged, 401, "unauthorized");
    const hr = await loginAsHr();
    expectStatus(await presign([cv()], { purpose: "admin_talent", cookie: hr }), 201);
    const crossSite = await presign([cv()], { purpose: "admin_talent", cookie: hr, headers: { origin: ORIGIN_EVIL } });
    expectApiError(crossSite, 403, "cross_site_request");
  });

  test("cross-site presign requests are refused", async () => {
    expectApiError(await presign([cv()], { headers: { origin: ORIGIN_EVIL } }), 403, "cross_site_request");
    expectApiError(await presign([cv()], { headers: { origin: "null" } }), 403, "cross_site_request");
  });

  test("storage rejects a PUT whose size or content type differs from the ticket", async () => {
    const result = await presign([cv(4096), supporting(4096)]);
    expectStatus(result, 201);
    const [first, second] = result.body.uploads;

    const shorter = await fetch(first.url, { method: "PUT", headers: first.headers, body: new Uint8Array(pdfBytes(4000)) });
    expect(shorter.status, "PUT with fewer bytes than declared").toBe(403);
    const longer = await fetch(first.url, { method: "PUT", headers: first.headers, body: new Uint8Array(pdfBytes(8192)) });
    expect(longer.status, "PUT with more bytes than declared").toBe(403);
    const html = await fetch(second.url, {
      method: "PUT",
      headers: { "Content-Type": "text/html" },
      body: new Uint8Array(pdfBytes(4096)),
    });
    expect(html.status, "PUT with a different content type").toBe(403);
    const tampered = new URL(second.url);
    tampered.searchParams.set("X-Amz-Expires", "604800");
    const extended = await fetch(tampered, { method: "PUT", headers: second.headers, body: new Uint8Array(pdfBytes(4096)) });
    expect(extended.status, "PUT with a tampered expiry").toBe(403);

    const exact = await fetch(second.url, { method: "PUT", headers: second.headers, body: new Uint8Array(pdfBytes(4096)) });
    expect(exact.status, "PUT matching the ticket").toBe(200);
  });

  test("the upload-ip bucket allows 40 requests per 15 minutes per client", async () => {
    const ip = isolatedClientIp();
    for (let attempt = 1; attempt <= 40; attempt += 1) {
      const result = await presign([], { ip });
      expect(result.status, `attempt ${attempt}`).toBe(400);
    }
    const limited = await presign([cv()], { ip });
    expectApiError(limited, 429, "rate_limited");
    expectRetryAfter(limited, 15 * 60);
    // Another client is unaffected.
    expectStatus(await presign([cv()], { ip: isolatedClientIp() }), 201);
  });
});
