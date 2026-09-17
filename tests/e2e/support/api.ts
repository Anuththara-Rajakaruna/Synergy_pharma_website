import { randomBytes, randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { e2eEnv } from "./env";

// Helpers for calling the site under test the way a browser would (same-origin headers, cookies)
// while letting each test present a distinct client IP.

export type ApiResult<T = unknown> = { status: number; headers: Headers; body: T; text: string };

export function uniqueSuffix(): string {
  return randomBytes(4).toString("hex");
}

// A random client address per call, so rate limits keyed on the client IP do not interfere between tests.
export function clientIp(): string {
  return `198.${randomInt(18, 20)}.${randomInt(0, 256)}.${randomInt(1, 255)}`;
}

export type CallOptions = {
  json?: unknown;
  body?: BodyInit;
  cookie?: string;
  ip?: string;
  headers?: Record<string, string>;
  // Adds Origin: <base URL> (what browsers send on same-origin POST/PUT/PATCH/DELETE).
  sameOrigin?: boolean;
  redirect?: RequestRedirect;
};

export async function api<T = Record<string, unknown>>(method: string, urlPath: string, options: CallOptions = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { [e2eEnv.clientIpHeader]: options.ip ?? clientIp(), ...options.headers };
  if (options.cookie) headers.cookie = options.cookie;
  if (options.json !== undefined) headers["content-type"] = "application/json";
  if (options.sameOrigin ?? method !== "GET") headers.origin ??= e2eEnv.baseUrl;
  const response = await fetch(e2eEnv.baseUrl + urlPath, {
    method,
    headers,
    body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
    redirect: options.redirect ?? "manual",
  });
  const text = await response.text();
  let body: unknown = text;
  if ((response.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, headers: response.headers, body: body as T, text };
}

export async function login(email: string, password: string): Promise<string> {
  const result = await api("POST", "/api/admin/login", { json: { email, password } });
  if (result.status !== 200) throw new Error(`Login failed for ${email}: ${result.status} ${result.text}`);
  const cookie = (result.headers.get("set-cookie") ?? "").split(";")[0];
  if (!cookie) throw new Error("Login response did not set a session cookie.");
  return cookie;
}

export const loginAsAdmin = () => login(e2eEnv.adminEmail, e2eEnv.adminPassword);
export const loginAsHr = () => login(e2eEnv.hrEmail, e2eEnv.hrPassword);

// A minimal but structurally plausible PDF (header + random body + trailer).
export function pdfBytes(sizeBytes = 4096, label = "e2e"): Buffer {
  const head = Buffer.from(`%PDF-1.7\n% ${label}\n`);
  const tail = Buffer.from("\n%%EOF\n");
  const bodySize = Math.max(0, sizeBytes - head.length - tail.length);
  return Buffer.concat([head, randomBytes(bodySize), tail]);
}

export type UploadFile = { kind: "cv" | "supporting"; name: string; bytes: Buffer; contentType?: string };
export type UploadTicketResponse = {
  uploads: { uploadId: string; kind: string; method: "PUT"; url: string; headers: Record<string, string>; expiresAt: string }[];
};

// Presigns and PUTs files straight to object storage like the browser forms do.
export async function uploadFiles(
  purpose: "application" | "talent_pool" | "admin_talent",
  files: UploadFile[],
  options: { cookie?: string; ip?: string } = {}
): Promise<{ ids: string[]; tickets: UploadTicketResponse["uploads"] }> {
  const presign = await api<UploadTicketResponse>("POST", "/api/uploads", {
    cookie: options.cookie,
    ip: options.ip,
    json: {
      purpose,
      files: files.map((f) => ({ kind: f.kind, name: f.name, size: f.bytes.length, contentType: f.contentType ?? "application/pdf" })),
    },
  });
  if (presign.status !== 201) throw new Error(`Presign failed: ${presign.status} ${presign.text}`);
  const ids: string[] = [];
  for (const [index, ticket] of presign.body.uploads.entries()) {
    const put = await fetch(ticket.url, { method: ticket.method, headers: ticket.headers, body: new Uint8Array(files[index].bytes) });
    if (!put.ok) throw new Error(`Upload PUT failed: ${put.status} ${await put.text()}`);
    ids.push(ticket.uploadId);
  }
  return { ids, tickets: presign.body.uploads };
}

export type CapturedEmail = { n: number; at: string; from: string; to: string[]; subject: string; size: number; raw: string };

// Reads messages captured by the SMTP sink, optionally waiting until `predicate` matches.
export async function readMailbox(predicate?: (mail: CapturedEmail) => boolean, timeoutMs = 20_000): Promise<CapturedEmail[]> {
  const started = Date.now();
  for (;;) {
    const index = await readFile(path.join(e2eEnv.mailboxDir, "index.ndjson"), "utf8").catch(() => "");
    const entries = index
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Omit<CapturedEmail, "raw">);
    const mails: CapturedEmail[] = [];
    for (const entry of entries) {
      const raw = await readFile(path.join(e2eEnv.mailboxDir, `${entry.n}.eml`), "utf8").catch(() => "");
      mails.push({ ...entry, raw });
    }
    if (!predicate || mails.some(predicate) || Date.now() - started > timeoutMs) {
      return predicate ? mails.filter(predicate) : mails;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
