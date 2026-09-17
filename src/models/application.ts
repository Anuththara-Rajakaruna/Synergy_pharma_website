import { Schema, type Types } from "mongoose";
import {
  APPLICATION_SOURCES,
  APPLICATION_STATUSES,
  FIELD_LIMITS,
  type ApplicationSource,
  type ApplicationStatus,
} from "@/lib/careers/constants";
import {
  archiveFields,
  defineModel,
  noteSchema,
  storedDocumentSchema,
  type ArchiveState,
  type NoteEntry,
  type StoredDocument,
} from "@/models/shared";

export interface StatusHistoryDoc {
  _id: Types.ObjectId;
  from: ApplicationStatus | null;
  to: ApplicationStatus;
  changedAt: Date;
  changedBy: Types.ObjectId | null;
  changedByName: string | null;
  note: string;
  candidateNotified: boolean;
}

export interface ApplicationDoc extends ArchiveState {
  _id: Types.ObjectId;
  // The job applied for. Jobs with applications are archived, never deleted, so this stays valid.
  job: Types.ObjectId;
  // Snapshots taken from the job at submission time (never from client input).
  jobSlug: string;
  jobTitle: string;
  department: string;
  name: string;
  email: string;
  // Lower-cased email; backs the one-application-per-job rule.
  emailNormalized: string;
  phone: string;
  coverLetter: string;
  linkedIn: string | null;
  portfolio: string | null;
  consentGiven: boolean;
  consentAt: Date | null;
  documents: StoredDocument[];
  status: ApplicationStatus;
  statusChangedAt: Date;
  // Append-only; every status change (including the initial submission) adds an entry.
  statusHistory: StatusHistoryDoc[];
  // Append-only internal HR notes.
  notes: NoteEntry[];
  source: ApplicationSource;
  talentPoolEntry: Types.ObjectId | null;
  // IDs of the PostgreSQL rows this record was migrated from (several when case-variant
  // duplicate submissions were merged).
  legacyIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

const statusHistorySchema = new Schema<StatusHistoryDoc>(
  {
    // null for the initial "submitted" entry. Enum validators are skipped for null values.
    from: { type: String, enum: APPLICATION_STATUSES, default: null },
    to: { type: String, enum: APPLICATION_STATUSES, required: true },
    changedAt: { type: Date, required: true },
    changedBy: { type: Schema.Types.ObjectId, ref: "AdminUser", default: null },
    changedByName: { type: String, default: null, maxlength: 200 },
    note: { type: String, default: "", maxlength: FIELD_LIMITS.hrNote },
    candidateNotified: { type: Boolean, default: false },
  },
  { _id: true }
);

const applicationSchema = new Schema<ApplicationDoc>(
  {
    job: { type: Schema.Types.ObjectId, ref: "Job", required: true },
    jobSlug: { type: String, required: true, maxlength: FIELD_LIMITS.jobSlugMax },
    jobTitle: { type: String, required: true, maxlength: FIELD_LIMITS.jobTitle + 50 },
    department: { type: String, default: "", maxlength: FIELD_LIMITS.department },
    name: { type: String, required: true, trim: true, maxlength: FIELD_LIMITS.name },
    email: { type: String, required: true, trim: true, maxlength: FIELD_LIMITS.email },
    emailNormalized: { type: String, required: true, maxlength: FIELD_LIMITS.email },
    phone: { type: String, required: true, trim: true, maxlength: 40 },
    coverLetter: { type: String, default: "", maxlength: FIELD_LIMITS.coverLetter },
    linkedIn: { type: String, default: null, maxlength: FIELD_LIMITS.url },
    portfolio: { type: String, default: null, maxlength: FIELD_LIMITS.url },
    consentGiven: { type: Boolean, required: true },
    consentAt: { type: Date, default: null },
    documents: { type: [storedDocumentSchema], default: [] },
    status: { type: String, enum: APPLICATION_STATUSES, required: true, default: "submitted" },
    statusChangedAt: { type: Date, required: true },
    statusHistory: { type: [statusHistorySchema], default: [] },
    notes: { type: [noteSchema], default: [] },
    source: { type: String, enum: APPLICATION_SOURCES, required: true, default: "website" },
    talentPoolEntry: { type: Schema.Types.ObjectId, ref: "TalentPoolEntry", default: null },
    legacyIds: { type: [String], default: [] },
    ...archiveFields,
  },
  {
    collection: "applications",
    timestamps: true,
    strict: "throw",
    strictQuery: "throw",
  }
);

applicationSchema.pre("validate", function normalize() {
  if (this.email) this.emailNormalized = this.email.trim().toLowerCase();
});

applicationSchema.index({ job: 1, emailNormalized: 1 }, { unique: true, name: "job_email_unique" });
applicationSchema.index({ archivedAt: 1, createdAt: -1, _id: -1 }, { name: "archived_createdAt" });
applicationSchema.index({ status: 1, archivedAt: 1, createdAt: -1 }, { name: "status_archived_createdAt" });
applicationSchema.index({ job: 1, archivedAt: 1, createdAt: -1 }, { name: "job_archived_createdAt" });
applicationSchema.index({ emailNormalized: 1 }, { name: "emailNormalized" });
applicationSchema.index({ "documents._id": 1 }, { name: "documents_id" });
applicationSchema.index({ talentPoolEntry: 1 }, { name: "talentPoolEntry", sparse: true });
applicationSchema.index({ legacyIds: 1 }, { name: "legacyIds" });

export const ApplicationModel = defineModel<ApplicationDoc>("Application", applicationSchema);

// Short, human-friendly reference shown to candidates and HR ("APP-7F3A9C21").
export function applicationReference(id: Types.ObjectId | string): string {
  return `APP-${String(id).slice(-8).toUpperCase()}`;
}
