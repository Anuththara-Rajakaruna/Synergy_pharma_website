import "./support/env";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import mongoose, { Types, type Model } from "mongoose";
import { changeApplicationStatus } from "@/lib/careers/server/applications";
import { ApplicationModel, type ApplicationDoc } from "@/models/application";
import { JobModel, type JobDoc } from "@/models/job";
import { SchemaMigrationModel } from "@/models/schema-migration";
import { TalentPoolEntryModel, type TalentPoolEntryDoc } from "@/models/talent-pool-entry";
import { ensureCollectionsAndIndexes } from "../../scripts/lib/indexes";
import { getMigrationStatus, MigrationAbortedError, MIGRATIONS, runPendingMigrations } from "../../scripts/lib/migrations";
import { careersV2Migration } from "../../scripts/migrations/20260917-001-careers-v2";
import { adminContext } from "./support/fixtures";
import { resetDatabase, startIntegration, type Integration } from "./support/harness";

const MIGRATION_ID = "20260917-001-careers-v2";
const at = (iso: string) => new Date(iso);

type Ids = {
  publishedJob: Types.ObjectId;
  invalidSlugJob: Types.ObjectId;
  draftJob: Types.ObjectId;
  linkedApplication: Types.ObjectId;
  slugOnlyApplication: Types.ObjectId;
  orphanApplication: Types.ObjectId;
  legacyTalent: Types.ObjectId;
  longNotesTalent: Types.ObjectId;
};

// Documents exactly as the first MongoDB release (v1) wrote them, including its indexes.
async function insertV1Data(): Promise<Ids> {
  const ids: Ids = {
    publishedJob: new Types.ObjectId(),
    invalidSlugJob: new Types.ObjectId(),
    draftJob: new Types.ObjectId(),
    linkedApplication: new Types.ObjectId(),
    slugOnlyApplication: new Types.ObjectId(),
    orphanApplication: new Types.ObjectId(),
    legacyTalent: new Types.ObjectId(),
    longNotesTalent: new Types.ObjectId(),
  };

  await JobModel.collection.insertMany([
    {
      _id: ids.publishedJob,
      slug: "qa-specialist",
      title: "QA Specialist",
      department: "Quality Assurance",
      location: "Colombo",
      type: "Full-time",
      status: "published",
      description: "Ensure quality.",
      responsibilities: ["Review records"],
      requirements: ["BSc"],
      createdAt: at("2025-01-01T00:00:00.000Z"),
      updatedAt: at("2025-01-02T00:00:00.000Z"),
      __v: 0,
    },
    {
      _id: ids.invalidSlugJob,
      slug: "QA Lead",
      title: "QA Lead",
      department: "Quality Assurance",
      location: "Colombo",
      type: "Internship",
      status: "closed",
      description: "Lead the QA team.",
      responsibilities: [],
      requirements: [],
      createdAt: at("2025-01-03T00:00:00.000Z"),
      updatedAt: at("2025-01-04T00:00:00.000Z"),
      __v: 0,
    },
    {
      _id: ids.draftJob,
      slug: "draft-role",
      title: "Draft Role",
      department: "IT",
      location: "Colombo",
      type: "Full-time",
      status: "draft",
      description: "Not yet published.",
      responsibilities: [],
      requirements: [],
      createdAt: at("2025-01-05T00:00:00.000Z"),
      updatedAt: at("2025-01-05T00:00:00.000Z"),
      __v: 0,
    },
  ]);

  await ApplicationModel.collection.insertMany([
    {
      _id: ids.linkedApplication,
      legacyId: "pg-app-1",
      name: "Nimali Perera",
      email: "Nimali@Example.com",
      emailNormalized: "nimali@example.com",
      phone: "0771234567",
      position: "QA Specialist (Colombo)",
      job: ids.publishedJob,
      jobSlug: "qa-specialist",
      coverLetter: "",
      cvFileName: "1700000000-nimali cv.pdf",
      cvFilePath: "/api/files/cvs/1700000000-nimali cv.pdf",
      status: "reviewing",
      notes: "Good fit",
      consentGiven: true,
      createdAt: at("2025-02-01T00:00:00.000Z"),
      updatedAt: at("2025-02-03T00:00:00.000Z"),
      __v: 0,
    },
    {
      _id: ids.slugOnlyApplication,
      name: "Kasun Silva",
      email: "kasun@example.com",
      emailNormalized: "kasun@example.com",
      phone: "0711234567",
      position: "QA Lead",
      jobSlug: "QA Lead",
      coverLetter: "Hello",
      cvFileName: "1700000001-kasun.pdf",
      cvFilePath: "/api/files/cvs/1700000001-kasun.pdf",
      status: "new",
      notes: "",
      consentGiven: true,
      linkedIn: "",
      createdAt: at("2025-02-02T00:00:00.000Z"),
      updatedAt: at("2025-02-02T00:00:00.000Z"),
      __v: 0,
    },
    {
      _id: ids.orphanApplication,
      legacyId: "pg-app-3",
      name: "Old Candidate",
      email: "old@example.com",
      emailNormalized: "old@example.com",
      phone: "0701234567",
      position: "Former Role",
      jobSlug: "Deleted Job",
      coverLetter: "",
      cvFileName: "1600000000-old.pdf",
      cvFilePath: "/api/files/cvs/1600000000-old.pdf",
      status: "hired",
      notes: "",
      consentGiven: true,
      createdAt: at("2024-02-02T00:00:00.000Z"),
      updatedAt: at("2024-03-02T00:00:00.000Z"),
      __v: 0,
    },
  ]);

  await TalentPoolEntryModel.collection.insertMany([
    {
      _id: ids.legacyTalent,
      legacyId: "pg-tp-1",
      name: "Tara Fernando",
      email: "Tara@Example.com",
      emailNormalized: "tara@example.com",
      phone: "0721234567",
      areaOfInterest: "Quality Control",
      notes: "Please call after 5pm",
      cvFileName: "1700000002-tara.pdf",
      cvFilePath: "/api/files/talent-pool/1700000002-tara.pdf",
      consentGiven: true,
      createdAt: at("2025-01-10T00:00:00.000Z"),
      updatedAt: at("2025-01-10T00:00:00.000Z"),
      __v: 0,
    },
    {
      _id: ids.longNotesTalent,
      name: "Web Candidate",
      email: "web@example.com",
      emailNormalized: "web@example.com",
      phone: "0731234567",
      areaOfInterest: "IT",
      notes: "z".repeat(2000),
      cvFileName: "1700000003-web.pdf",
      cvFilePath: "/api/files/talent-pool/1700000003-web.pdf",
      consentGiven: true,
      createdAt: at("2025-01-11T00:00:00.000Z"),
      updatedAt: at("2025-01-11T00:00:00.000Z"),
      __v: 0,
    },
  ]);

  await JobModel.collection.createIndex({ slug: 1 }, { unique: true, name: "slug_unique" });
  await JobModel.collection.createIndex({ status: 1, createdAt: -1 }, { name: "status_createdAt" });
  await JobModel.collection.createIndex({ createdAt: -1 }, { name: "createdAt_desc" });
  await ApplicationModel.collection.createIndex({ emailNormalized: 1, jobSlug: 1 }, { unique: true, name: "email_job_unique" });
  // Same name as a v1 index but a different key pattern: not created by v1, so it must be kept.
  await ApplicationModel.collection.createIndex({ createdAt: 1 }, { name: "createdAt_desc" });
  await ApplicationModel.collection.createIndex({ status: 1, createdAt: -1 }, { name: "status_createdAt" });
  await ApplicationModel.collection.createIndex({ job: 1 }, { name: "job" });
  await ApplicationModel.collection.createIndex({ legacyId: 1 }, { unique: true, sparse: true, name: "legacyId_unique" });
  await TalentPoolEntryModel.collection.createIndex({ emailNormalized: 1 }, { unique: true, name: "email_unique" });
  await TalentPoolEntryModel.collection.createIndex({ createdAt: -1 }, { name: "createdAt_desc" });
  await TalentPoolEntryModel.collection.createIndex({ legacyId: 1 }, { unique: true, sparse: true, name: "legacyId_unique" });
  return ids;
}

async function snapshot(): Promise<string> {
  const parts: Record<string, unknown> = {};
  for (const model of [JobModel, ApplicationModel, TalentPoolEntryModel, SchemaMigrationModel] as Model<unknown>[]) {
    const docs = await model.collection.find({}).sort({ _id: 1 }).toArray();
    const indexes = await model.collection
      .listIndexes()
      .toArray()
      .catch(() => []);
    parts[model.collection.collectionName] = { docs, indexes: indexes.map((index) => [index.name, index.key]) };
  }
  return JSON.stringify(parts);
}

async function indexNames(model: Model<unknown>): Promise<string[]> {
  return (await model.collection.listIndexes().toArray()).map((index) => String(index.name)).sort();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertValid(model: Model<any>, doc: Record<string, unknown>): Promise<void> {
  await assert.doesNotReject(new model(doc).validate(), `${model.modelName} ${String(doc._id)} does not match the v2 schema`);
}

describe("migration 001 (v1 to v2)", { timeout: 180_000 }, () => {
  let integration: Integration;
  const lines: string[] = [];
  const log = (line: string) => lines.push(line);

  before(async () => {
    integration = await startIntegration({ indexes: false });
  });

  beforeEach(async () => {
    lines.length = 0;
    await resetDatabase({ indexes: false });
  });

  after(async () => {
    await integration.stop();
  });

  it("is registered in order with a valid id", () => {
    assert.deepEqual(
      MIGRATIONS.map((migration) => migration.id),
      [MIGRATION_ID]
    );
  });

  it("dry run reports the plan without changing anything", async () => {
    await insertV1Data();
    const before = await snapshot();
    const result = await runPendingMigrations({ dryRun: true, allowInvalid: false, log });
    assert.deepEqual(result, { applied: [], pending: [MIGRATION_ID] });
    assert.equal(await snapshot(), before);
    const output = lines.join("\n");
    assert.ok(output.includes("would drop obsolete v1 index applications.email_job_unique"), output);
    assert.ok(output.includes("placeholder job \"deleted-job\" would be created"), output);
    assert.ok(output.includes("Would apply"), output);
    assert.equal(output.includes("Nimali"), false, "no candidate names in the output");
    assert.equal(output.toLowerCase().includes("nimali@example.com"), false, "no candidate emails in the output");
  });

  it("upgrades v1 documents, drops obsolete indexes and records the migration", async () => {
    const ids = await insertV1Data();
    const result = await runPendingMigrations({ dryRun: false, allowInvalid: false, log });
    assert.deepEqual(result, { applied: [MIGRATION_ID], pending: [] });
    const record = await SchemaMigrationModel.findById(MIGRATION_ID).lean();
    assert.ok(record);
    assert.equal(
      record.summary,
      "jobs upgraded: 3 (URL ids changed: 1), placeholder jobs: 1, applications upgraded: 3, talent entries upgraded: 2, obsolete indexes dropped: 8"
    );

    // Jobs
    const published = await JobModel.findById(ids.publishedJob).lean<JobDoc>();
    assert.ok(published);
    assert.deepEqual(
      [published.origin, published.experience, published.qualifications, published.benefits, published.applicationDeadline, published.closedAt, published.archivedAt],
      ["admin", "", [], [], null, null, null]
    );
    assert.deepEqual(published.publishedAt, at("2025-01-01T00:00:00.000Z"));
    const renamed = await JobModel.findById(ids.invalidSlugJob).lean<JobDoc>();
    assert.equal(renamed?.slug, "qa-lead");
    assert.deepEqual(renamed?.closedAt, at("2025-01-04T00:00:00.000Z"));
    assert.deepEqual(renamed?.publishedAt, at("2025-01-03T00:00:00.000Z"));
    assert.equal((await JobModel.findById(ids.draftJob).lean<JobDoc>())?.publishedAt, null);
    const placeholder = await JobModel.findOne({ slug: "deleted-job" }).lean<JobDoc>();
    assert.ok(placeholder);
    assert.deepEqual(
      [placeholder.status, placeholder.origin, placeholder.title, placeholder.description],
      ["archived", "postgres", "Former Role", "Archived posting imported from the previous system."]
    );

    // Applications
    const linked = await ApplicationModel.findById(ids.linkedApplication).lean<ApplicationDoc>();
    assert.ok(linked);
    assert.equal(linked.status, "under_review");
    assert.equal(linked.source, "legacy");
    assert.deepEqual(linked.legacyIds, ["pg-app-1"]);
    assert.equal(linked.jobTitle, "QA Specialist (Colombo)");
    assert.equal(linked.department, "Quality Assurance");
    assert.deepEqual(
      linked.documents.map((document) => [document.key, document.originalName, document.size, document.legacy]),
      [["cvs/1700000000-nimali cv.pdf", "1700000000-nimali cv.pdf", null, true]]
    );
    assert.deepEqual(
      linked.notes.map((note) => [note.body, note.authorName]),
      [["Good fit", "Legacy system"]]
    );
    assert.deepEqual(
      linked.statusHistory.map((entry) => [entry.from, entry.to, entry.changedByName]),
      [[null, "under_review", "Legacy system"]]
    );
    assert.equal(linked.consentGiven, true);
    assert.deepEqual(linked.consentAt, at("2025-02-01T00:00:00.000Z"));
    const raw = await ApplicationModel.collection.findOne({ _id: ids.linkedApplication });
    assert.ok(raw);
    for (const field of ["position", "cvFileName", "cvFilePath", "legacyId"]) assert.equal(field in raw, false, field);

    const slugOnly = await ApplicationModel.findById(ids.slugOnlyApplication).lean<ApplicationDoc>();
    assert.ok(slugOnly?.job.equals(ids.invalidSlugJob));
    assert.equal(slugOnly?.jobSlug, "qa-lead");
    assert.equal(slugOnly?.status, "submitted");
    assert.equal(slugOnly?.source, "website");
    assert.equal(slugOnly?.linkedIn, null);

    const orphan = await ApplicationModel.findById(ids.orphanApplication).lean<ApplicationDoc>();
    assert.ok(orphan?.job.equals(placeholder._id));
    assert.equal(orphan?.jobSlug, "deleted-job");
    assert.equal(orphan?.status, "selected");
    assert.equal(orphan?.department, "");

    // Talent pool
    const legacyTalent = await TalentPoolEntryModel.findById(ids.legacyTalent).lean<TalentPoolEntryDoc>();
    assert.equal(legacyTalent?.candidateNotes, "Please call after 5pm");
    assert.deepEqual(legacyTalent?.notes, []);
    assert.equal(legacyTalent?.source, "legacy");
    assert.equal(legacyTalent?.documents[0].key, "talent-pool/1700000002-tara.pdf");
    assert.deepEqual(legacyTalent?.activity.map((entry) => entry.action), ["created"]);
    const longNotes = await TalentPoolEntryModel.findById(ids.longNotesTalent).lean<TalentPoolEntryDoc>();
    assert.equal(longNotes?.source, "self_submitted");
    assert.equal(longNotes?.candidateNotes, "");
    assert.equal(longNotes?.notes.length, 1);
    assert.ok(longNotes?.notes[0].body.includes("z".repeat(2000)));

    // Every document now matches the v2 schema.
    for (const [model, docs] of [
      [JobModel, await JobModel.collection.find({}).toArray()],
      [ApplicationModel, await ApplicationModel.collection.find({}).toArray()],
      [TalentPoolEntryModel, await TalentPoolEntryModel.collection.find({}).toArray()],
    ] as const) {
      for (const doc of docs) await assertValid(model, doc);
    }

    // Obsolete v1 indexes are gone; an index that only shares a name with one is kept.
    assert.deepEqual(await indexNames(JobModel as Model<unknown>), ["_id_", "slug_unique"]);
    assert.deepEqual(await indexNames(ApplicationModel as Model<unknown>), ["_id_", "createdAt_desc"]);
    assert.deepEqual(await indexNames(TalentPoolEntryModel as Model<unknown>), ["_id_", "email_unique"]);

    // The v2 indexes (including the new unique job/email index) build on the migrated data.
    const report = await ensureCollectionsAndIndexes(() => {}, { dropStale: false });
    assert.deepEqual(report.failures, []);
    assert.deepEqual(report.stale, ["applications.createdAt_desc"]);
    assert.ok(report.created.includes("applications.job_email_unique"));
  });

  it("is idempotent: a second run changes nothing", async () => {
    await insertV1Data();
    await runPendingMigrations({ dryRun: false, allowInvalid: false, log });
    const afterFirst = await snapshot();

    lines.length = 0;
    assert.deepEqual(await runPendingMigrations({ dryRun: false, allowInvalid: false, log }), { applied: [], pending: [] });
    assert.ok(lines.join("\n").includes("No pending migrations"));

    const summary = await careersV2Migration.up({ dryRun: false, allowInvalid: false, log });
    assert.equal(summary, "jobs upgraded: 0 (URL ids changed: 0), placeholder jobs: 0, applications upgraded: 0, talent entries upgraded: 0, obsolete indexes dropped: 0");
    assert.equal(await snapshot(), afterFirst);
  });

  it("reuses the placeholder job from an earlier run for applications added later", async () => {
    await insertV1Data();
    await runPendingMigrations({ dryRun: false, allowInvalid: false, log });
    const lateId = new Types.ObjectId();
    await ApplicationModel.collection.insertOne({
      _id: lateId,
      name: "Late Candidate",
      email: "late@example.com",
      emailNormalized: "late@example.com",
      phone: "0741234567",
      position: "Former Role",
      jobSlug: "Deleted Job",
      coverLetter: "",
      cvFileName: "late.pdf",
      cvFilePath: "/api/files/cvs/late.pdf",
      status: "rejected",
      notes: "",
      consentGiven: false,
      createdAt: at("2024-02-05T00:00:00.000Z"),
      updatedAt: at("2024-02-05T00:00:00.000Z"),
    });
    const summary = await careersV2Migration.up({ dryRun: false, allowInvalid: false, log });
    assert.ok(summary.includes("placeholder jobs: 0"), summary);
    assert.equal(await JobModel.countDocuments({ slug: /^deleted-job/ }), 1);
    const late = await ApplicationModel.findById(lateId).lean<ApplicationDoc>();
    assert.equal(late?.jobSlug, "deleted-job");
    assert.equal(late?.consentGiven, false);
    assert.equal(late?.consentAt, null);
  });

  it("migrated applications work with the v2 services", async () => {
    const ids = await insertV1Data();
    await runPendingMigrations({ dryRun: false, allowInvalid: false, log });
    await ensureCollectionsAndIndexes(() => {}, { dropStale: false });
    const hr = await adminContext("hr", "Hiruni Recruiter");
    const detail = await changeApplicationStatus(ids.linkedApplication.toHexString(), { status: "shortlisted", expectedStatus: "under_review" }, hr);
    assert.equal(detail.statusHistory.length, 2);
    assert.equal(detail.documents[0].size, null);
  });

  it("aborts without writing when upgraded documents would be invalid, unless allowed", async () => {
    const badJob = new Types.ObjectId();
    await JobModel.collection.insertOne({
      _id: badJob,
      slug: "broken-job",
      title: "Broken",
      department: "IT",
      location: "Colombo",
      type: "Freelance",
      status: "draft",
      description: "x",
      responsibilities: [],
      requirements: [],
      createdAt: at("2025-01-01T00:00:00.000Z"),
      updatedAt: at("2025-01-01T00:00:00.000Z"),
    });
    await JobModel.collection.createIndex({ status: 1, createdAt: -1 }, { name: "status_createdAt" });
    const before = await snapshot();
    await assert.rejects(runPendingMigrations({ dryRun: false, allowInvalid: false, log }), MigrationAbortedError);
    assert.equal(await snapshot(), before);
    assert.ok(lines.some((line) => line.includes(`jobs ${badJob.toHexString()}: type`)), lines.join("\n"));

    const result = await runPendingMigrations({ dryRun: false, allowInvalid: true, log });
    assert.deepEqual(result.applied, [MIGRATION_ID]);
    assert.equal((await JobModel.collection.findOne({ _id: badJob }))?.origin, "admin");
  });

  it("reports migrations recorded by a newer version of the code", async () => {
    await SchemaMigrationModel.create({ _id: "20991231-001-future", appliedAt: new Date(), durationMs: 1, summary: "" });
    const status = await getMigrationStatus();
    assert.deepEqual(status.unknown, ["20991231-001-future"]);
    assert.deepEqual(status.pending.map((migration) => migration.id), [MIGRATION_ID]);
    assert.equal(mongoose.connection.db?.databaseName.endsWith("_test"), true);
  });
});
