import "./support/env";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import mongoose, { type Model } from "mongoose";
import { ALL_MODELS } from "@/models/index";
import { ApplicationModel } from "@/models/application";
import { JobModel } from "@/models/job";
import { TalentPoolEntryModel } from "@/models/talent-pool-entry";
import { ensureCollectionsAndIndexes, inspectCollectionsAndIndexes } from "../../scripts/lib/indexes";
import { resetDatabase, startIntegration, type Integration } from "./support/harness";

type IndexInfo = { name: string; key: Record<string, unknown>; unique?: boolean };

async function indexes(model: Model<unknown>): Promise<IndexInfo[]> {
  return (await model.collection.listIndexes().toArray()) as IndexInfo[];
}

function declaredIndexNames(): string[] {
  return ALL_MODELS.flatMap((model) =>
    (model.schema.indexes() as [Record<string, unknown>, { name?: string }][]).map(([, options]) => `${model.collection.collectionName}.${options.name}`)
  ).sort();
}

describe("ensureCollectionsAndIndexes", { timeout: 120_000 }, () => {
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

  it("creates every collection and declared index on an empty database, then has nothing left to do", async () => {
    const report = await ensureCollectionsAndIndexes(log, { dropStale: false });
    assert.deepEqual(report.created.sort(), declaredIndexNames());
    assert.deepEqual([report.dropped, report.stale, report.failures], [[], [], []]);

    const collections = (await mongoose.connection.db?.listCollections({}, { nameOnly: true }).toArray())?.map((item) => item.name) ?? [];
    for (const model of ALL_MODELS) assert.ok(collections.includes(model.collection.collectionName), model.collection.collectionName);
    const slug = (await indexes(JobModel as Model<unknown>)).find((index) => index.name === "slug_unique");
    assert.deepEqual([slug?.key, slug?.unique], [{ slug: 1 }, true]);

    const again = await ensureCollectionsAndIndexes(log, { dropStale: false });
    assert.deepEqual(again, { created: [], dropped: [], stale: [], failures: [] });
    const states = await inspectCollectionsAndIndexes();
    assert.ok(states.every((state) => state.exists && state.missing.length === 0 && state.stale.length === 0), JSON.stringify(states));
  });

  it("reports missing collections and indexes without creating them when inspecting", async () => {
    const states = await inspectCollectionsAndIndexes();
    const jobs = states.find((state) => state.collection === "jobs");
    assert.deepEqual(jobs?.exists, false);
    assert.ok(jobs?.missing.includes("slug_unique"));
    const collections = (await mongoose.connection.db?.listCollections({}, { nameOnly: true }).toArray()) ?? [];
    assert.equal(collections.length, 0, "inspection is read-only");
  });

  it("reports undeclared indexes as stale and drops them only when asked", async () => {
    await ensureCollectionsAndIndexes(() => {}, { dropStale: false });
    await JobModel.collection.createIndex({ title: 1 }, { name: "title_1" });
    await ApplicationModel.collection.createIndex({ emailNormalized: 1, jobSlug: 1 }, { unique: true, name: "email_job_unique" });

    const report = await ensureCollectionsAndIndexes(log, { dropStale: false });
    assert.deepEqual(report.stale.sort(), ["applications.email_job_unique", "jobs.title_1"]);
    assert.deepEqual(report.dropped, []);
    assert.ok((await indexes(JobModel as Model<unknown>)).some((index) => index.name === "title_1"));
    assert.ok(lines.some((line) => line.includes("title_1") && line.includes("--drop-stale-indexes")));
    const inspected = await inspectCollectionsAndIndexes();
    assert.deepEqual(inspected.find((state) => state.collection === "jobs")?.stale, ["title_1"]);

    const dropped = await ensureCollectionsAndIndexes(log, { dropStale: true });
    assert.deepEqual(dropped.dropped.sort(), ["applications.email_job_unique", "jobs.title_1"]);
    assert.deepEqual(dropped.stale, []);
    assert.equal((await indexes(JobModel as Model<unknown>)).some((index) => index.name === "title_1"), false);
    assert.equal((await indexes(ApplicationModel as Model<unknown>)).some((index) => index.name === "email_job_unique"), false);
  });

  it("reports an index whose name is reused with other keys and replaces it with --drop-stale-indexes", async () => {
    await JobModel.createCollection();
    await JobModel.collection.createIndex({ title: 1 }, { name: "slug_unique" });

    const report = await ensureCollectionsAndIndexes(log, { dropStale: false });
    assert.deepEqual(
      report.failures.map((failure) => `${failure.collection}.${failure.index}`),
      ["jobs.slug_unique"]
    );
    assert.ok(report.failures[0].reason.includes("--drop-stale-indexes"));
    assert.ok(report.stale.includes("jobs.slug_unique"));
    assert.ok(lines.some((line) => line.includes("could not create index slug_unique")));

    const fixed = await ensureCollectionsAndIndexes(log, { dropStale: true });
    assert.deepEqual(fixed.failures, []);
    assert.ok(fixed.dropped.includes("jobs.slug_unique"));
    assert.ok(fixed.created.includes("jobs.slug_unique"));
    const slug = (await indexes(JobModel as Model<unknown>)).find((index) => index.name === "slug_unique");
    assert.deepEqual([slug?.key, slug?.unique], [{ slug: 1 }, true]);
  });

  it("accepts an equivalent index that exists under another name", async () => {
    await ApplicationModel.createCollection();
    await ApplicationModel.collection.createIndex({ emailNormalized: 1 }, { name: "email_1" });
    const report = await ensureCollectionsAndIndexes(log, { dropStale: false });
    assert.deepEqual([report.failures, report.stale], [[], []]);
    assert.equal(report.created.includes("applications.emailNormalized"), false);
    assert.deepEqual(
      (await indexes(ApplicationModel as Model<unknown>)).filter((index) => JSON.stringify(index.key) === "{\"emailNormalized\":1}").map((index) => index.name),
      ["email_1"]
    );
  });

  it("explains unique index build failures without printing the duplicate values", async () => {
    const email = "duplicate.person@example.com";
    const base = { name: "Dup Person", phone: "0771234567", areaOfInterest: "IT", consentGiven: true, source: "self_submitted", createdAt: new Date(), updatedAt: new Date() };
    await TalentPoolEntryModel.collection.insertMany([
      { ...base, email, emailNormalized: email },
      { ...base, email: email.toUpperCase(), emailNormalized: email },
    ]);

    const report = await ensureCollectionsAndIndexes(log, { dropStale: false });
    const failure = report.failures.find((item) => item.index === "email_unique");
    assert.ok(failure, JSON.stringify(report.failures));
    assert.equal(failure.collection, "talent_pool");
    assert.ok(failure.reason.includes("emailNormalized"));
    const output = `${JSON.stringify(report)}\n${lines.join("\n")}`.toLowerCase();
    assert.equal(output.includes(email), false, output);
    assert.ok(report.created.includes("talent_pool.archived_createdAt"), "other indexes are still created");
  });
});
