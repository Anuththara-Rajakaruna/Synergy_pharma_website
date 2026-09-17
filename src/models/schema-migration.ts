import { Schema } from "mongoose";
import { defineModel } from "@/models/shared";

// One document per applied data migration (see scripts/migrations).
export interface SchemaMigrationDoc {
  _id: string;
  appliedAt: Date;
  durationMs: number;
  summary: string;
}

const schemaMigrationSchema = new Schema<SchemaMigrationDoc>(
  {
    _id: { type: String, required: true, maxlength: 200 },
    appliedAt: { type: Date, required: true },
    durationMs: { type: Number, required: true },
    summary: { type: String, default: "", maxlength: 2000 },
  },
  {
    collection: "schema_migrations",
    timestamps: false,
    strict: "throw",
    strictQuery: "throw",
  }
);

export const SchemaMigrationModel = defineModel<SchemaMigrationDoc>("SchemaMigration", schemaMigrationSchema);
