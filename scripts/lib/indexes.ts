import type { Model, mongo } from "mongoose";
import { ALL_MODELS } from "@/models/index";

// Collections and indexes declared by the Mongoose schemas (src/models). db:setup creates what is
// missing; db:check and the Postgres import use the read-only inspection.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModel = Model<any>;

type IndexKeys = Record<string, mongo.IndexDirection>;
type SchemaIndex = [IndexKeys, Record<string, unknown>];

export type IndexFailure = { collection: string; index: string; reason: string };

export type IndexSetupReport = {
  created: string[];
  dropped: string[];
  stale: string[];
  failures: IndexFailure[];
};

export type CollectionIndexState = {
  collection: string;
  exists: boolean;
  missing: string[];
  stale: string[];
};

function indexName(keys: IndexKeys, options: Record<string, unknown>): string {
  if (typeof options.name === "string") return options.name;
  return Object.entries(keys)
    .map(([field, direction]) => `${field}_${direction}`)
    .join("_");
}

async function diff(model: AnyModel): Promise<{ missing: SchemaIndex[]; stale: string[] }> {
  const { toCreate, toDrop } = await model.diffIndexes({ indexOptionsToCreate: true });
  return {
    missing: toCreate as SchemaIndex[],
    // Mongoose never lists the default _id index, but guard anyway: it cannot be dropped.
    stale: (toDrop as string[]).filter((name) => name !== "_id_"),
  };
}

async function collectionNames(model: AnyModel): Promise<Set<string>> {
  const db = model.db.db;
  if (!db) throw new Error("Not connected to MongoDB.");
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  return new Set(collections.map((collection) => collection.name));
}

// Read-only: which collections exist, which schema indexes are missing and which database
// indexes are not declared in the schema.
export async function inspectCollectionsAndIndexes(): Promise<CollectionIndexState[]> {
  const existing = await collectionNames(ALL_MODELS[0]);
  const states: CollectionIndexState[] = [];
  for (const model of ALL_MODELS) {
    const collection = model.collection.collectionName;
    if (!existing.has(collection)) {
      const declared = (model.schema.indexes() as SchemaIndex[]).map(([keys, options]) => indexName(keys, options));
      states.push({ collection, exists: false, missing: declared, stale: [] });
      continue;
    }
    const { missing, stale } = await diff(model);
    states.push({ collection, exists: true, missing: missing.map(([keys, options]) => indexName(keys, options)), stale });
  }
  return states;
}

// Creates every collection and every schema index that is missing. Indexes in the database that
// the schema does not declare are reported, and dropped only when `dropStale` is set. They are
// dropped before anything is created, so an index whose definition changed under the same name
// (or whose keys are now declared under a new name) can be rebuilt.
export async function ensureCollectionsAndIndexes(
  log: (line: string) => void,
  options: { dropStale: boolean }
): Promise<IndexSetupReport> {
  const report: IndexSetupReport = { created: [], dropped: [], stale: [], failures: [] };

  for (const model of ALL_MODELS) {
    const collection = model.collection.collectionName;
    await model.createCollection();
    const { missing, stale } = await diff(model);

    for (const name of stale) {
      if (options.dropStale) {
        await model.collection.dropIndex(name);
        report.dropped.push(`${collection}.${name}`);
        log(`  - ${collection}: dropped index ${name} (not declared in the schema)`);
      } else {
        report.stale.push(`${collection}.${name}`);
        log(`  ! ${collection}: index ${name} is not declared in the schema (re-run with --drop-stale-indexes to drop it)`);
      }
    }

    for (const [keys, rawOptions] of missing) {
      const name = indexName(keys, rawOptions);
      const indexOptions: Record<string, unknown> = { ...rawOptions };
      delete indexOptions._autoIndex;
      try {
        await model.collection.createIndex(keys, indexOptions as mongo.CreateIndexesOptions);
        report.created.push(`${collection}.${name}`);
        log(`  + ${collection}: created index ${name}`);
      } catch (err) {
        const code = (err as { code?: unknown }).code;
        if (code === 11000) {
          // The server's message quotes the duplicate values; only the index is reported.
          const reason =
            `existing documents share the same value(s) for ${Object.keys(keys).join(", ")}, so the unique index ` +
            "cannot be built. Resolve the duplicate records, then re-run.";
          report.failures.push({ collection, index: name, reason });
          log(`  ✗ ${collection}: could not create unique index ${name}: ${reason}`);
        } else if (code === 85 || code === 86) {
          const reason =
            "an index with the same name or the same keys but a different definition already exists. " +
            "Re-run with --drop-stale-indexes to replace it.";
          report.failures.push({ collection, index: name, reason });
          log(`  ✗ ${collection}: could not create index ${name}: ${reason}`);
        } else {
          throw err;
        }
      }
    }

    const names = (await model.listIndexes()).map((index: { name: string }) => index.name);
    log(`  ✓ ${collection}: ${names.join(", ")}`);
  }

  return report;
}
