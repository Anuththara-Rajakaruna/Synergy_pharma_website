import { Schema, type Types } from "mongoose";
import { defineModel } from "@/models/shared";

export const EMAIL_STATUSES = ["pending", "sending", "sent", "failed", "skipped"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

// Every outgoing email is written here first, then delivered. A failed SMTP call therefore
// never loses the message or the record that triggered it, and is retried with backoff.
export interface EmailOutboxDoc {
  _id: Types.ObjectId;
  to: string;
  replyTo: string | null;
  template: string;
  subject: string;
  text: string;
  html: string;
  // pending: waiting for (re)delivery. sending: claimed by a worker until lockedUntil.
  // failed: gave up after maxAttempts. skipped: SMTP not configured when delivery was attempted
  // outside production (production keeps retrying instead).
  status: EmailStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  lockedUntil: Date | null;
  lastError: string | null;
  related: { entityType: string; entityId: string } | null;
  sentAt: Date | null;
  // Set once delivered or given up; the TTL index removes the message 180 days later.
  purgeAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const emailOutboxSchema = new Schema<EmailOutboxDoc>(
  {
    to: { type: String, required: true, maxlength: 254 },
    replyTo: { type: String, default: null, maxlength: 254 },
    template: { type: String, required: true, maxlength: 60 },
    subject: { type: String, required: true, maxlength: 300 },
    text: { type: String, required: true, maxlength: 50_000 },
    html: { type: String, required: true, maxlength: 100_000 },
    status: { type: String, enum: EMAIL_STATUSES, required: true, default: "pending" },
    attempts: { type: Number, required: true, default: 0 },
    maxAttempts: { type: Number, required: true, default: 6 },
    nextAttemptAt: { type: Date, required: true },
    lockedUntil: { type: Date, default: null },
    lastError: { type: String, default: null, maxlength: 500 },
    related: {
      type: new Schema(
        {
          entityType: { type: String, required: true, maxlength: 40 },
          entityId: { type: String, required: true, maxlength: 120 },
        },
        { _id: false }
      ),
      default: null,
    },
    sentAt: { type: Date, default: null },
    purgeAt: { type: Date, default: null },
  },
  {
    collection: "email_outbox",
    timestamps: true,
    strict: "throw",
    strictQuery: "throw",
  }
);

emailOutboxSchema.index({ status: 1, nextAttemptAt: 1 }, { name: "status_nextAttemptAt" });
emailOutboxSchema.index({ "related.entityType": 1, "related.entityId": 1, createdAt: -1 }, { name: "related_createdAt" });
emailOutboxSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60, name: "purgeAt_ttl" });

export const EmailOutboxModel = defineModel<EmailOutboxDoc>("EmailOutbox", emailOutboxSchema);
