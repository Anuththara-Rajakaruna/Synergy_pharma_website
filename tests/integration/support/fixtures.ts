import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { Types } from "mongoose";
import { createSession, resolveSession, type AdminContext } from "@/lib/auth/session";
import type { AdminRole, DocumentKind, UploadPurpose } from "@/lib/careers/constants";
import { createJob } from "@/lib/careers/server/jobs";
import { createUploadTickets } from "@/lib/careers/server/uploads";
import { createAdminUser } from "@/lib/careers/server/users";
import type { ApplicationSubmission, JobInput, TalentSubmission } from "@/lib/careers/validation";
import { AppError } from "@/lib/http/errors";
import type { AuditLogDoc } from "@/models/audit-log";
import { AuditLogModel } from "@/models/audit-log";
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
  const { token } = await createSession(new Types.ObjectId(user.id), { ip: "203.0.113.10", userAgent: "integration-tests" });
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

export async function putToTicket(ticket: UploadTicket, body: Buffer, headers: Record<string, string> = ticket.headers): Promise<number> {
  const response = await fetch(ticket.url, { method: ticket.method, headers, body: new Uint8Array(body) });
  await response.arrayBuffer();
  return response.status;
}

// Requests an upload ticket and uploads the bytes through the presigned URL, like the browser does.
export async function uploadDocument(
  purpose: UploadPurpose,
  kind: DocumentKind,
  body: Buffer = pdfBytes(),
  options: { adminUserId?: AdminContext["userId"]; name?: string } = {}
): Promise<string> {
  const [ticket] = await createUploadTickets(
    { purpose, files: [{ kind, name: options.name ?? `${kind}-${uniqueSuffix()}.pdf`, size: body.length, contentType: "application/pdf" }] },
    { adminUserId: options.adminUserId ?? null }
  );
  const status = await putToTicket(ticket, body);
  assert.equal(status, 200, `presigned upload failed with HTTP ${status}`);
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

export async function auditEntries(filter: { action?: string; entityId?: string } = {}): Promise<AuditLogDoc[]> {
  return AuditLogModel.find(filter).sort({ at: 1, _id: 1 }).lean<AuditLogDoc[]>();
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
  const entries = await AuditLogModel.find({}).lean();
  assertNoPersonalData(JSON.stringify(entries), values, "audit log");
}
