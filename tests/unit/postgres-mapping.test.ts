import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Types, type Model } from "mongoose";
import { FIELD_LIMITS } from "@/lib/careers/constants";
import { ApplicationModel } from "@/models/application";
import { JobModel } from "@/models/job";
import type { NoteEntry, StoredDocument } from "@/models/shared";
import { TalentPoolEntryModel } from "@/models/talent-pool-entry";
import { LEGACY_AUTHOR, NOT_SPECIFIED, PLACEHOLDER_JOB_DESCRIPTION, buildValidated, maskEmail, type PlainDoc } from "../../scripts/lib/legacy";
import {
  applicationGroupKey,
  assignJobSlugs,
  chronological,
  findOrphanJobs,
  groupRows,
  mapApplicationGroup,
  mapJobRow,
  mapTalentGroup,
  placeholderJob,
  talentGroupKey,
  type JobRef,
  type MappingLog,
} from "../../scripts/lib/postgres-mapping";
import type { LegacyApplicationRow, LegacyJobRow, LegacyTalentRow } from "../../scripts/lib/postgres-source";

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);

const at = (iso: string) => new Date(iso);
const newLog = (): MappingLog => ({ issues: [], warnings: [] });

function jobRow(overrides: Partial<LegacyJobRow> = {}): LegacyJobRow {
  return {
    id: "qa-executive",
    title: "QA Executive",
    department: "Quality Assurance",
    location: "Colombo",
    type: "Full-time",
    status: "published",
    description: "Ensure product quality.",
    responsibilities: ["Review batch records", "  Approve   releases "],
    requirements: ["BSc Chemistry", ""],
    created_at: at("2024-01-10T08:00:00.000Z"),
    updated_at: at("2024-02-01T08:00:00.000Z"),
    ...overrides,
  };
}

function applicationRow(overrides: Partial<LegacyApplicationRow> = {}): LegacyApplicationRow {
  return {
    id: "app-1",
    name: "Nimal Perera",
    email: "Nimal.Perera@Example.com",
    phone: "0771234567",
    position: "QA Executive",
    job_id: "qa-executive",
    cover_letter: "I would like to apply.",
    cv_file_name: "1700000000-nimal-cv.pdf",
    cv_file_path: "/api/files/cvs/1700000000-nimal-cv.pdf",
    status: "new",
    notes: "",
    consent_given: true,
    linked_in: null,
    portfolio: null,
    created_at: at("2024-03-01T09:00:00.000Z"),
    ...overrides,
  };
}

function talentRow(overrides: Partial<LegacyTalentRow> = {}): LegacyTalentRow {
  return {
    id: "tp-1",
    name: "Kamala Silva",
    email: "Kamala@Example.com",
    phone: "0112345678",
    area_of_interest: "Quality Control",
    notes: "Available from October.",
    cv_file_name: "1700000001-kamala.pdf",
    cv_file_path: "/api/files/talent-pool/1700000001-kamala.pdf",
    consent_given: true,
    created_at: at("2024-04-01T09:00:00.000Z"),
    ...overrides,
  };
}

const jobRef: JobRef = { _id: new Types.ObjectId(), slug: "qa-executive", title: "QA Executive (Job)", department: "Quality Assurance", placeholder: false };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertSchemaValid(model: Model<any>, doc: PlainDoc): Promise<void> {
  const result = await buildValidated(model, { _id: new Types.ObjectId(), ...doc });
  assert.ok(result.ok, result.ok ? "" : result.problems.join(", "));
}

describe("grouping legacy rows", () => {
  it("orders rows chronologically, breaking ties by id", () => {
    const rows = [
      { id: "b", created_at: at("2024-01-02T00:00:00Z") },
      { id: "c", created_at: at("2024-01-01T00:00:00Z") },
      { id: "a", created_at: at("2024-01-02T00:00:00Z") },
    ];
    assert.deepEqual([...rows].sort(chronological).map((row) => row.id), ["c", "a", "b"]);
  });

  it("groups applications by case-insensitive email and job", () => {
    const rows = [
      applicationRow({ id: "a3", email: "nimal.perera@example.com ", created_at: at("2024-03-03T00:00:00Z") }),
      applicationRow({ id: "a1", created_at: at("2024-03-01T00:00:00Z") }),
      applicationRow({ id: "a2", job_id: "other-job", created_at: at("2024-03-02T00:00:00Z") }),
      applicationRow({ id: "a4", email: "someone.else@example.com", created_at: at("2024-03-04T00:00:00Z") }),
    ];
    const groups = groupRows(rows, applicationGroupKey);
    assert.deepEqual(
      groups.map((group) => group.map((row) => row.id)),
      [["a1", "a3"], ["a2"], ["a4"]]
    );
  });

  it("groups talent rows by case-insensitive email", () => {
    assert.equal(talentGroupKey(talentRow({ email: " KAMALA@example.COM" })), talentGroupKey(talentRow()));
    assert.notEqual(talentGroupKey(talentRow({ email: "other@example.com" })), talentGroupKey(talentRow()));
  });
});

describe("assignJobSlugs", () => {
  it("keeps valid ids and converts invalid ones deterministically without collisions", () => {
    const log = newLog();
    const ids = ["qa-executive", "Intern 2024", "intern-2024", "QA", "", "QA Executive"];
    const { slugs, used } = assignJobSlugs(ids, log);
    assert.equal(slugs.get("qa-executive"), "qa-executive");
    assert.equal(slugs.get("intern-2024"), "intern-2024");
    assert.equal(slugs.get("Intern 2024"), "intern-2024-2", "must not take an id another legacy job uses as-is");
    assert.equal(slugs.get("QA"), "job-qa");
    assert.equal(slugs.get(""), "legacy-job");
    assert.equal(slugs.get("QA Executive"), "qa-executive-2");
    assert.equal(used.size, ids.length);
    assert.equal(log.warnings.length, 4);
    assert.deepEqual(assignJobSlugs(ids, newLog()).slugs, slugs);
  });
});

describe("mapJobRow", () => {
  it("maps a published job with cleaned lists", async () => {
    const log = newLog();
    const doc = mapJobRow(jobRow(), "qa-executive", log);
    assert.ok(doc);
    assert.equal(doc.status, "published");
    assert.equal(doc.origin, "postgres");
    assert.deepEqual(doc.responsibilities, ["Review batch records", "Approve releases"]);
    assert.deepEqual(doc.requirements, ["BSc Chemistry"]);
    assert.deepEqual(doc.publishedAt, at("2024-01-10T08:00:00.000Z"));
    assert.equal(doc.closedAt, null);
    assert.equal(doc.applicationDeadline, null);
    assert.deepEqual(log, newLog());
    await assertSchemaValid(JobModel, doc);
  });

  it("imports a published job without lists as closed, with a warning", async () => {
    const log = newLog();
    const doc = mapJobRow(jobRow({ responsibilities: [], requirements: null }), "empty-lists", log);
    assert.ok(doc);
    assert.equal(doc.status, "closed");
    assert.deepEqual(doc.publishedAt, at("2024-01-10T08:00:00.000Z"));
    assert.deepEqual(doc.closedAt, at("2024-02-01T08:00:00.000Z"));
    assert.equal(log.warnings.length, 1);
    await assertSchemaValid(JobModel, doc);
  });

  it("keeps drafts with empty lists and sets closedAt for closed jobs", () => {
    const draft = mapJobRow(jobRow({ status: "draft", responsibilities: [], requirements: [] }), "draft-job", newLog());
    assert.equal(draft?.status, "draft");
    assert.equal(draft?.publishedAt, null);
    const closed = mapJobRow(jobRow({ status: "closed" }), "closed-job", newLog());
    assert.deepEqual(closed?.closedAt, at("2024-02-01T08:00:00.000Z"));
  });

  it("fills empty required text and records warnings", async () => {
    const log = newLog();
    const doc = mapJobRow(jobRow({ department: " ", location: "", title: "" }), "blank-job", log);
    assert.ok(doc);
    assert.equal(doc.department, NOT_SPECIFIED);
    assert.equal(doc.location, NOT_SPECIFIED);
    assert.equal(doc.title, "Untitled posting blank-job");
    assert.equal(log.warnings.length, 3);
    await assertSchemaValid(JobModel, doc);
  });

  it("reports unknown statuses and non-list columns as blocking issues", () => {
    const log = newLog();
    assert.equal(mapJobRow(jobRow({ status: "archived" }), "a-job", log), null);
    assert.equal(mapJobRow(jobRow({ responsibilities: "not a list" }), "b-job", log), null);
    assert.equal(mapJobRow(jobRow({ requirements: [1, 2] }), "c-job", log), null);
    assert.equal(log.issues.length, 3);
  });
});

describe("orphan jobs", () => {
  it("collects job ids referenced by applications but missing from the jobs table", () => {
    const rows = [
      applicationRow({ id: "1", job_id: "deleted-job", position: "", created_at: at("2024-01-05T00:00:00Z") }),
      applicationRow({ id: "2", job_id: "qa-executive" }),
      applicationRow({ id: "3", job_id: "deleted-job", position: "Former QA Role", created_at: at("2024-01-07T00:00:00Z") }),
      applicationRow({ id: "4", job_id: "deleted-job", position: "Later title", created_at: at("2024-01-06T00:00:00Z") }),
    ];
    const orphans = findOrphanJobs(rows, new Set(["qa-executive"]));
    assert.deepEqual([...orphans.keys()], ["deleted-job"]);
    assert.deepEqual(orphans.get("deleted-job"), {
      title: "Later title",
      first: at("2024-01-05T00:00:00Z"),
      last: at("2024-01-07T00:00:00Z"),
      rows: 3,
    });
  });

  it("builds an archived placeholder job", async () => {
    const doc = placeholderJob("deleted-job", { title: "T".repeat(300), first: at("2024-01-05T00:00:00Z"), last: at("2024-01-07T00:00:00Z"), rows: 2 });
    assert.equal(doc.status, "archived");
    assert.equal(doc.description, PLACEHOLDER_JOB_DESCRIPTION);
    assert.equal(String(doc.title).length, FIELD_LIMITS.jobTitle);
    assert.deepEqual(doc.archivedAt, at("2024-01-07T00:00:00Z"));
    assert.deepEqual(doc.createdAt, at("2024-01-05T00:00:00Z"));
    assert.equal(placeholderJob("x-job", { title: null, first: at("2024-01-01T00:00:00Z"), last: at("2024-01-01T00:00:00Z"), rows: 1 }).title, "Former posting x-job");
    await assertSchemaValid(JobModel, doc);
  });
});

describe("mapApplicationGroup", () => {
  it("maps a single legacy application", async () => {
    const log = newLog();
    const row = applicationRow({ status: "reviewing", notes: "Strong candidate", linked_in: "  ", portfolio: "https://nimal.example.com" });
    const doc = mapApplicationGroup([row], jobRef, log);
    assert.ok(doc);
    assert.ok((doc.job as Types.ObjectId).equals(jobRef._id));
    assert.equal(doc.jobSlug, "qa-executive");
    assert.equal(doc.jobTitle, "QA Executive");
    assert.equal(doc.department, "Quality Assurance");
    assert.equal(doc.email, "Nimal.Perera@Example.com");
    assert.equal(doc.emailNormalized, "nimal.perera@example.com");
    assert.equal(doc.status, "under_review");
    assert.equal(doc.source, "legacy");
    assert.equal(doc.linkedIn, null);
    assert.equal(doc.portfolio, "https://nimal.example.com");
    assert.equal(doc.consentGiven, true);
    assert.deepEqual(doc.consentAt, row.created_at);
    assert.deepEqual(doc.legacyIds, ["app-1"]);
    const documents = doc.documents as StoredDocument[];
    assert.equal(documents.length, 1);
    assert.deepEqual(
      { key: documents[0].key, originalName: documents[0].originalName, size: documents[0].size, legacy: documents[0].legacy, kind: documents[0].kind },
      { key: "cvs/1700000000-nimal-cv.pdf", originalName: "1700000000-nimal-cv.pdf", size: null, legacy: true, kind: "cv" }
    );
    const notes = doc.notes as NoteEntry[];
    assert.equal(notes.length, 1);
    assert.equal(notes[0].body, "Strong candidate");
    assert.equal(notes[0].authorName, LEGACY_AUTHOR);
    const history = doc.statusHistory as { from: string | null; to: string }[];
    assert.deepEqual(
      history.map((entry) => [entry.from, entry.to]),
      [[null, "under_review"]]
    );
    assert.deepEqual(log, newLog());
    await assertSchemaValid(ApplicationModel, doc);
  });

  it("merges case-variant duplicate submissions into the earliest record", async () => {
    const log = newLog();
    const first = applicationRow({ id: "app-1", created_at: at("2024-03-01T09:00:00Z"), consent_given: false, notes: "First HR note" });
    const second = applicationRow({
      id: "app-2",
      email: "nimal.perera@example.com",
      name: "Nimal P.",
      phone: "0719999999",
      cover_letter: `Updated letter${CR}${LF}with more detail`,
      cv_file_name: "1700000100-nimal-cv-v2.pdf",
      status: "shortlisted",
      notes: "Second HR note",
      linked_in: "https://linkedin.com/in/nimal",
      consent_given: true,
      created_at: at("2024-03-05T09:00:00Z"),
    });
    const third = applicationRow({ id: "app-3", email: "NIMAL.PERERA@EXAMPLE.COM", status: "rejected", cover_letter: "", cv_file_name: "1700000100-nimal-cv-v2.pdf", created_at: at("2024-03-09T09:00:00Z") });
    const doc = mapApplicationGroup([first, second, third], jobRef, log);
    assert.ok(doc);

    assert.equal(doc.name, "Nimal Perera", "identity comes from the earliest row");
    assert.equal(doc.email, "Nimal.Perera@Example.com");
    assert.equal(doc.coverLetter, "I would like to apply.");
    assert.equal(doc.status, "rejected", "status comes from the latest row");
    assert.deepEqual(doc.legacyIds, ["app-1", "app-2", "app-3"]);
    assert.deepEqual(doc.createdAt, first.created_at);
    assert.deepEqual(doc.updatedAt, third.created_at);
    assert.deepEqual(doc.statusChangedAt, third.created_at);
    assert.equal(doc.consentGiven, true);
    assert.deepEqual(doc.consentAt, second.created_at, "consent time is the first consenting submission");
    assert.equal(doc.linkedIn, "https://linkedin.com/in/nimal");

    const documents = doc.documents as StoredDocument[];
    assert.deepEqual(
      documents.map((item) => item.key),
      ["cvs/1700000000-nimal-cv.pdf", "cvs/1700000100-nimal-cv-v2.pdf"],
      "every distinct CV is kept once"
    );

    const history = doc.statusHistory as { from: string | null; to: string; note: string; changedByName: string }[];
    assert.deepEqual(
      history.map((entry) => [entry.from, entry.to]),
      [
        [null, "submitted"],
        ["submitted", "shortlisted"],
        ["shortlisted", "rejected"],
      ]
    );
    assert.equal(history[1].note, "Merged duplicate submission (app-2)");
    assert.ok(history.every((entry) => entry.changedByName === LEGACY_AUTHOR));

    const bodies = (doc.notes as NoteEntry[]).map((note) => note.body);
    assert.equal(bodies[0], "First HR note");
    assert.ok(bodies.some((body) => body.startsWith("Merged duplicate submission (app-2), cover letter:") && body.includes(`Updated letter${LF}with more detail`)));
    assert.ok(bodies.some((body) => body.startsWith("Merged duplicate submission (app-2), HR notes:") && body.includes("Second HR note")));
    const details = bodies.find((body) => body.startsWith("Merged duplicate submission (app-2), submitted details:"));
    assert.ok(details);
    assert.ok(details.includes("Name: Nimal P."));
    assert.ok(details.includes("Phone: 0719999999"));
    assert.ok(details.includes("Email: nimal.perera@example.com"));

    await assertSchemaValid(ApplicationModel, doc);
  });

  it("uses the job title when the legacy position is too long and blanks the department for placeholders", async () => {
    const placeholderRef: JobRef = { ...jobRef, slug: "deleted-job", title: "Former QA Role", department: NOT_SPECIFIED, placeholder: true };
    const doc = mapApplicationGroup([applicationRow({ position: "P".repeat(FIELD_LIMITS.jobTitle + 51) })], placeholderRef, newLog());
    assert.ok(doc);
    assert.equal(doc.jobTitle, "Former QA Role");
    assert.equal(doc.department, "");
    await assertSchemaValid(ApplicationModel, doc);
  });

  it("splits notes longer than the note limit instead of truncating", async () => {
    const long = "n".repeat(FIELD_LIMITS.hrNote * 2 + 10);
    const doc = mapApplicationGroup([applicationRow({ notes: long })], jobRef, newLog());
    assert.ok(doc);
    const notes = doc.notes as NoteEntry[];
    assert.equal(notes.length, 3);
    assert.ok(notes[0].body.startsWith("(part 1 of 3)"));
    assert.ok(notes.every((note) => note.body.length <= FIELD_LIMITS.hrNote));
    assert.equal(notes.map((note) => note.body.split(LF).slice(1).join(LF)).join(""), long);
    await assertSchemaValid(ApplicationModel, doc);
  });

  it("warns about missing CVs, fills missing names and blocks unknown statuses", () => {
    const log = newLog();
    const doc = mapApplicationGroup([applicationRow({ cv_file_name: "", name: " " })], jobRef, log);
    assert.ok(doc);
    assert.deepEqual(doc.documents, []);
    assert.equal(doc.name, "Unknown applicant");
    assert.equal(log.warnings.length, 2);

    const blocked = newLog();
    assert.equal(mapApplicationGroup([applicationRow({ status: "on-hold" })], jobRef, blocked), null);
    assert.equal(blocked.issues.length, 1);
    assert.equal(blocked.issues[0].includes("Nimal"), false, "issues never contain names");
  });
});

describe("mapTalentGroup", () => {
  it("maps a single talent entry", async () => {
    const log = newLog();
    const doc = mapTalentGroup([talentRow()], log);
    assert.equal(doc.emailNormalized, "kamala@example.com");
    assert.equal(doc.candidateNotes, "Available from October.");
    assert.deepEqual(doc.notes, []);
    assert.equal(doc.source, "legacy");
    assert.equal((doc.documents as StoredDocument[])[0].key, "talent-pool/1700000001-kamala.pdf");
    assert.deepEqual(
      (doc.activity as { action: string }[]).map((entry) => entry.action),
      ["created"]
    );
    assert.deepEqual(log, newLog());
    await assertSchemaValid(TalentPoolEntryModel, doc);
  });

  it("merges duplicates, concatenating short candidate notes", async () => {
    const first = talentRow({ id: "tp-1", created_at: at("2024-04-01T09:00:00Z") });
    const second = talentRow({
      id: "tp-2",
      email: "kamala@example.com",
      phone: "0779999999",
      area_of_interest: "Regulatory Affairs",
      notes: "Also interested in regulatory work.",
      cv_file_name: "1700000200-kamala-new.pdf",
      created_at: at("2024-05-01T09:00:00Z"),
    });
    const doc = mapTalentGroup([first, second], newLog());
    // Only the candidate's own words; the merge is recorded in the activity timeline.
    assert.equal(doc.candidateNotes, `Available from October.${LF}${LF}Also interested in regulatory work.`);
    assert.deepEqual(doc.legacyIds, ["tp-1", "tp-2"]);
    assert.equal((doc.documents as StoredDocument[]).length, 2);
    assert.deepEqual(
      (doc.activity as { action: string }[]).map((entry) => entry.action),
      ["created", "merged_duplicate"]
    );
    const details = (doc.notes as NoteEntry[]).map((note) => note.body).join(LF);
    assert.ok(details.includes("Phone: 0779999999"));
    assert.ok(details.includes("Area of interest: Regulatory Affairs"));
    assert.equal(doc.areaOfInterest, "Quality Control");
    assert.deepEqual(doc.updatedAt, second.created_at);
    await assertSchemaValid(TalentPoolEntryModel, doc);
  });

  it("keeps long merged candidate notes in full as HR notes", async () => {
    const first = talentRow({ id: "tp-1", notes: "a".repeat(1000) });
    const second = talentRow({ id: "tp-2", notes: "b".repeat(1000), created_at: at("2024-05-01T09:00:00Z") });
    const doc = mapTalentGroup([first, second], newLog());
    assert.equal(doc.candidateNotes, "");
    const bodies = (doc.notes as NoteEntry[]).map((note) => note.body);
    assert.ok(bodies.some((body) => body.includes("a".repeat(1000))));
    assert.ok(bodies.some((body) => body.includes("b".repeat(1000))));
    await assertSchemaValid(TalentPoolEntryModel, doc);
  });
});

describe("maskEmail", () => {
  it("keeps only the first character and the domain", () => {
    assert.equal(maskEmail("Nimal.Perera@example.com"), "N***@example.com");
    assert.equal(maskEmail("no-at-sign"), "***");
  });
});
