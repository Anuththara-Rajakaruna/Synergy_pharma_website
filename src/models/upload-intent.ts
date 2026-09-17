import { Schema, type Types } from "mongoose";
import {
  DOCUMENT_KINDS,
  FIELD_LIMITS,
  UPLOAD_PURPOSES,
  type DocumentKind,
  type UploadPurpose,
} from "@/lib/careers/constants";
import { defineModel } from "@/models/shared";

// A presigned direct-to-storage upload handed to a browser. The object is uploaded under
// `incoming/`, and only becomes part of a record when a submission claims it (the object is
// then copied to its permanent key). Unclaimed intents expire; unclaimed objects under
// `incoming/` are removed by the maintenance job / bucket lifecycle rule.
export interface UploadIntentDoc {
  // Random UUID (unguessable); the client uses it to reference the upload.
  _id: string;
  key: string;
  kind: DocumentKind;
  purpose: UploadPurpose;
  originalName: string;
  size: number;
  contentType: string;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  // Set when an admin requested the upload (purpose admin_talent).
  createdByAdmin: Types.ObjectId | null;
}

const uploadIntentSchema = new Schema<UploadIntentDoc>(
  {
    _id: { type: String, required: true, maxlength: 64 },
    key: { type: String, required: true, maxlength: 512 },
    kind: { type: String, enum: DOCUMENT_KINDS, required: true },
    purpose: { type: String, enum: UPLOAD_PURPOSES, required: true },
    originalName: { type: String, required: true, maxlength: FIELD_LIMITS.originalFileName },
    size: { type: Number, required: true, min: 1 },
    contentType: { type: String, required: true, maxlength: 100 },
    createdAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
    createdByAdmin: { type: Schema.Types.ObjectId, ref: "AdminUser", default: null },
  },
  {
    collection: "upload_intents",
    timestamps: false,
    strict: "throw",
    strictQuery: "throw",
  }
);

uploadIntentSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "expiresAt_ttl" });

export const UploadIntentModel = defineModel<UploadIntentDoc>("UploadIntent", uploadIntentSchema);
