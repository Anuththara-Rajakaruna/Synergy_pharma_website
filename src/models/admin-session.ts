import { Schema, type Types } from "mongoose";
import { defineModel } from "@/models/shared";

export interface AdminSessionDoc {
  _id: Types.ObjectId;
  // SHA-256 of the random session token; the token itself only exists in the browser cookie.
  tokenHash: string;
  user: Types.ObjectId;
  createdAt: Date;
  lastSeenAt: Date;
  // Absolute expiry. MongoDB's TTL monitor removes the document after this time.
  expiresAt: Date;
  ip: string | null;
  userAgent: string | null;
}

const adminSessionSchema = new Schema<AdminSessionDoc>(
  {
    tokenHash: { type: String, required: true, maxlength: 128 },
    user: { type: Schema.Types.ObjectId, ref: "AdminUser", required: true },
    createdAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    ip: { type: String, default: null, maxlength: 100 },
    userAgent: { type: String, default: null, maxlength: 400 },
  },
  {
    collection: "admin_sessions",
    timestamps: false,
    strict: "throw",
    strictQuery: "throw",
  }
);

adminSessionSchema.index({ tokenHash: 1 }, { unique: true, name: "tokenHash_unique" });
adminSessionSchema.index({ user: 1 }, { name: "user" });
adminSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "expiresAt_ttl" });

export const AdminSessionModel = defineModel<AdminSessionDoc>("AdminSession", adminSessionSchema);
