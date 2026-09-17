import { Schema, type Types } from "mongoose";
import { ADMIN_ROLES, type AdminRole } from "@/lib/careers/constants";
import { defineModel } from "@/models/shared";

export interface AuditActor {
  user: Types.ObjectId;
  email: string;
  name: string;
  role: AdminRole;
}

export interface AuditLogDoc {
  _id: Types.ObjectId;
  at: Date;
  // null for public or system events (e.g. failed login for an unknown email, cron jobs).
  actor: AuditActor | null;
  // Dotted verb, e.g. "job.publish", "application.status_change", "document.download".
  action: string;
  entityType: string;
  entityId: string;
  // Human-readable one-liner shown in the admin audit view. Must not contain candidate PII
  // beyond what HR already sees (no emails, phone numbers or document contents).
  summary: string;
  meta: Record<string, unknown>;
  ip: string | null;
}

const auditActorSchema = new Schema<AuditActor>(
  {
    user: { type: Schema.Types.ObjectId, ref: "AdminUser", required: true },
    email: { type: String, required: true, maxlength: 254 },
    name: { type: String, required: true, maxlength: 200 },
    role: { type: String, enum: ADMIN_ROLES, required: true },
  },
  { _id: false }
);

const auditLogSchema = new Schema<AuditLogDoc>(
  {
    at: { type: Date, required: true },
    actor: { type: auditActorSchema, default: null },
    action: { type: String, required: true, maxlength: 80 },
    entityType: { type: String, required: true, maxlength: 40 },
    entityId: { type: String, required: true, maxlength: 120 },
    summary: { type: String, required: true, maxlength: 500 },
    meta: { type: Schema.Types.Mixed, default: {} },
    ip: { type: String, default: null, maxlength: 100 },
  },
  {
    collection: "audit_logs",
    timestamps: false,
    strict: "throw",
    strictQuery: "throw",
    minimize: false,
  }
);

auditLogSchema.index({ at: -1 }, { name: "at_desc" });
auditLogSchema.index({ entityType: 1, entityId: 1, at: -1 }, { name: "entity_at" });
auditLogSchema.index({ "actor.user": 1, at: -1 }, { name: "actor_at" });
auditLogSchema.index({ action: 1, at: -1 }, { name: "action_at" });

export const AuditLogModel = defineModel<AuditLogDoc>("AuditLog", auditLogSchema);
