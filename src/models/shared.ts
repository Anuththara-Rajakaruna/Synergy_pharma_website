import mongoose, { Schema, type Model, type Types } from "mongoose";
import { DOCUMENT_KINDS, FIELD_LIMITS, type DocumentKind } from "@/lib/careers/constants";

// Registers a model once per process. In development the previous compilation is dropped so
// schema edits apply on hot reload instead of silently keeping the stale schema.
export function defineModel<T>(name: string, schema: Schema<T>): Model<T> {
  if (process.env.NODE_ENV === "development" && mongoose.models[name]) {
    mongoose.deleteModel(name);
  }
  return (mongoose.models[name] as Model<T> | undefined) ?? mongoose.model<T>(name, schema);
}

// A file stored in object storage. Only the key is kept here; bytes never touch MongoDB.
export interface StoredDocument {
  _id: Types.ObjectId;
  kind: DocumentKind;
  key: string;
  originalName: string;
  size: number | null;
  contentType: string;
  uploadedAt: Date;
  // Migrated from the PostgreSQL release (key predates the per-record key layout).
  legacy: boolean;
}

export const storedDocumentSchema = new Schema<StoredDocument>(
  {
    kind: { type: String, enum: DOCUMENT_KINDS, required: true },
    key: { type: String, required: true, maxlength: 512 },
    originalName: { type: String, required: true, maxlength: FIELD_LIMITS.originalFileName + 100 },
    size: { type: Number, default: null, min: 0 },
    contentType: { type: String, required: true, default: "application/pdf", maxlength: 100 },
    uploadedAt: { type: Date, required: true },
    legacy: { type: Boolean, default: false },
  },
  { _id: true }
);

export interface NoteEntry {
  _id: Types.ObjectId;
  body: string;
  author: Types.ObjectId | null;
  authorName: string;
  createdAt: Date;
}

export const noteSchema = new Schema<NoteEntry>(
  {
    body: { type: String, required: true, maxlength: FIELD_LIMITS.hrNote },
    author: { type: Schema.Types.ObjectId, ref: "AdminUser", default: null },
    authorName: { type: String, required: true, maxlength: 200 },
    createdAt: { type: Date, required: true },
  },
  { _id: true }
);

// Fields shared by records that are archived instead of destroyed.
export const archiveFields = {
  archivedAt: { type: Date, default: null },
  archivedBy: { type: Schema.Types.ObjectId, ref: "AdminUser", default: null },
  archivedByName: { type: String, default: null, maxlength: 200 },
  archiveReason: { type: String, default: "", maxlength: FIELD_LIMITS.archiveReason },
} as const;

export interface ArchiveState {
  archivedAt: Date | null;
  archivedBy: Types.ObjectId | null;
  archivedByName: string | null;
  archiveReason: string;
}
