import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { createSession, resolveSession, type AdminContext } from "@/lib/auth/session";
import type { AdminRole, DocumentKind, UploadPurpose } from "@/lib/careers/constants";
import { createJob } from "@/lib/careers/server/jobs";
import type { AuditLogRecord } from "@/lib/careers/server/records";
import { createUploadTickets, receiveUpload } from "@/lib/careers/server/uploads";
import { createAdminUser } from "@/lib/careers/server/users";
import type { ApplicationSubmission, JobInput, TalentSubmission } from "@/lib/careers/validation";
import { AppError } from "@/lib/http/errors";
import { flushAuditBuffer, listAuditRecords } from "@/lib/sheets-db/repositories/audit";
import type { AdminJob, UploadTicket } from "@/types/careers";

const LF = String.fromCharCode(10);

export function uniqueSuffix(): string {
  return randomBytes(4).toString("hex");
}

const FIRST_NAMES = ["Nimal", "Kamala", "Saman", "Dilani", "Ruwan", "Tharushi", "Kasun", "Ishara"];
const LAST_NAMES = ["Perera", "Silva", "Fernando", "Jayasinghe", "Wickramasinghe", "Bandara"];

// A unique, realistic candidate identity. Names contain only letters (the validators require it).
export function candidate(): { name: string; email: string; phone: string } {
  const suffix = uniqueSuffix();
  const pick = <T>(list: readonly T[]) => list[randomBytes(1)[0] % list.length];
  const letters = suffix.replace(/[0-9]/g, (digit) => "abcdefghij"[Number(digit)]);
  return {
    name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)} ${letters[0].toUpperCase()}${letters.slice(1)}`,
    email: `Candidate.${suffix}@Example.com`,
    phone: `+94 77 ${String(100 + (randomBytes(2).readUInt16BE(0) % 900))} ${String(1000 + (randomBytes(2).readUInt16BE(0) % 9000))}`,
  };
}

export async function adminContext(role: AdminRole = "hr", name = "Hiruni Recruiter"): Promise<AdminContext> {
  const suffix = uniqueSuffix();
  const { user } = await createAdminUser({ email: `${role}.${suffix}@synergypharma.test`, name, role }, null);
  const { token } = await createSession(user.id, { ip: "203.0.113.10", userAgent: "integration-tests" });
  const resolved = await resolveSession(token);
  assert.ok(resolved, "session for the fixture admin could not be resolved");
  return { ...resolved, ip: "203.0.113.10", userAgent: "integration-tests" };
}

export function jobInput(overrides: Partial<JobInput> = {}): JobInput {
  const suffix = uniqueSuffix();
  return {
    slug: `qa-executive-${suffix}`,
    title: `QA Executive ${suffix}`,
    department: "Quality Assurance",
    location: "Colombo",
    type: "Full-time",
    experience: "2+ years",
    description: `Ensure every batch meets GMP standards.${LF}${LF}Work with production and QC.`,
    responsibilities: ["Review batch manufacturing records", "Approve product releases"],
    requirements: ["BSc in Chemistry or Pharmacy"],
    qualifications: [],
    benefits: ["Medical insurance"],
    applicationDeadline: null,
    ...overrides,
  };
}

export async function publishedJob(ctx: AdminContext, overrides: Partial<JobInput> = {}): Promise<AdminJob> {
  return createJob(jobInput(overrides), "published", ctx);
}

// A minimal byte sequence that passes the PDF structure checks (header and end-of-file marker).
export function pdfBytes(size = 4096): Buffer {
  const header = Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1");
  const trailer = Buffer.from("\ntrailer\n<<>>\nstartxref\n0\n%%EOF\n", "latin1");
  assert.ok(size >= header.length + trailer.length, "PDF fixture too small");
  const filler = Buffer.alloc(size - header.length - trailer.length, 0x20);
  return Buffer.concat([header, filler, trailer]);
}

// The signed token out of a ticket URL. The browser never looks at it; the route handler does.
export function ticketToken(ticket: UploadTicket): string | null {
  return new URL(ticket.url).searchParams.get("t");
}

// What the browser does with a ticket, minus the HTTP hop: PUT /api/uploads/<id> validates the
// bytes and forwards them to Drive, and that validation is exactly `receiveUpload`. The suite has
// no server running, so it calls the handler's implementation directly.
export async function putToTicket(ticket: UploadTicket, body: Buffer, token: string | null = ticketToken(ticket)): Promise<void> {
  await receiveUpload(ticket.uploadId, token, body);
}

// Requests an upload ticket and sends the bytes, like the browser does.
export async function uploadDocument(
  purpose: UploadPurpose,
  kind: DocumentKind,
  body: Buffer = pdfBytes(),
  options: { adminUserId?: string | null; name?: string } = {}
): Promise<string> {
  const [ticket] = await createUploadTickets(
    { purpose, files: [{ kind, name: options.name ?? `${kind}-${uniqueSuffix()}.pdf`, size: body.length, contentType: "application/pdf" }] },
    { adminUserId: options.adminUserId ?? null }
  );
  await putToTicket(ticket, body);
  return ticket.uploadId;
}

export function applicationSubmission(jobSlug: string, uploads: { cv: string; supporting?: string[] }, overrides: Partial<ApplicationSubmission> = {}): ApplicationSubmission {
  const person = candidate();
  return {
    jobSlug,
    name: person.name,
    email: person.email,
    phone: person.phone,
    coverLetter: `Dear hiring team,${LF}I would like to apply.`,
    linkedIn: "https://www.linkedin.com/in/candidate",
    portfolio: "",
    uploads: { cv: uploads.cv, supporting: uploads.supporting ?? [] },
    ...overrides,
  };
}

export function talentSubmission(uploads: { cv: string; supporting?: string[] }, overrides: Partial<TalentSubmission> = {}): TalentSubmission {
  const person = candidate();
  return {
    name: person.name,
    email: person.email,
    phone: person.phone,
    areaOfInterest: "Quality Control",
    candidateNotes: "Available to start next month.",
    uploads: { cv: uploads.cv, supporting: uploads.supporting ?? [] },
    ...overrides,
  };
}

// Awaits a rejection with the given AppError status and code and returns the error for further checks.
export async function expectAppError(promise: Promise<unknown>, status: number, code: string): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof AppError, `expected AppError ${status} ${code}, got ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
    assert.equal(`${err.status} ${err.code}`, `${status} ${code}`, err.message);
    return err;
  }
  assert.fail(`expected AppError ${status} ${code}, but the operation succeeded`);
}

// Audit entries are appended in batches a few hundred milliseconds after the action, so that a
// request does not pay for a Google Sheets round trip per entry. Every read here flushes the
// buffer first, which is why assertions about the audit log are still exact.
export async function auditEntries(filter: { action?: string; entityId?: string } = {}): Promise<AuditLogRecord[]> {
  await flushAuditBuffer();
  const entries = await listAuditRecords({ maxAgeMs: 0 });
  // Sheet order, which is append order: the AuditLog tab is append-only, so rows are already in
  // the order the actions happened. Sorting by `at` would be worse - it has one-millisecond
  // resolution and two actions in one request often share a timestamp.
  return entries.filter(
    (entry) => (filter.action === undefined || entry.action === filter.action) && (filter.entityId === undefined || entry.entityId === filter.entityId)
  );
}

// Asserts that none of the given personal values appear in the text (case-insensitive).
export function assertNoPersonalData(text: string, values: string[], context: string): void {
  const haystack = text.toLowerCase();
  for (const value of values) {
    if (!value) continue;
    assert.equal(haystack.includes(value.toLowerCase()), false, `${context} contains personal data: ${JSON.stringify(value)}`);
  }
}

export async function assertAuditHasNoPersonalData(values: string[]): Promise<void> {
  assertNoPersonalData(JSON.stringify(await auditEntries()), values, "audit log");
}
