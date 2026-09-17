import { Schema, type Types } from "mongoose";
import { FIELD_LIMITS, TALENT_SOURCES, type TalentSource } from "@/lib/careers/constants";
import {
  archiveFields,
  defineModel,
  noteSchema,
  storedDocumentSchema,
  type ArchiveState,
  type NoteEntry,
  type StoredDocument,
} from "@/models/shared";

export interface TalentActivityDoc {
  _id: Types.ObjectId;
  action: string;
  at: Date;
  actor: Types.ObjectId | null;
  actorName: string | null;
  detail: string;
}

export interface TalentPoolEntryDoc extends ArchiveState {
  _id: Types.ObjectId;
  name: string;
  email: string;
  // Lower-cased email; one talent-pool profile per person.
  emailNormalized: string;
  phone: string;
  areaOfInterest: string;
  // What the candidate wrote when submitting their profile.
  candidateNotes: string;
  tags: string[];
  // Internal HR notes (append-only).
  notes: NoteEntry[];
  documents: StoredDocument[];
  consentGiven: boolean;
  consentAt: Date | null;
  source: TalentSource;
  sourceApplication: Types.ObjectId | null;
  applications: Types.ObjectId[];
  createdBy: Types.ObjectId | null;
  // Profile timeline (created, linked application, tags changed, archived, ...).
  activity: TalentActivityDoc[];
  legacyIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

const activitySchema = new Schema<TalentActivityDoc>(
  {
    action: { type: String, required: true, maxlength: 60 },
    at: { type: Date, required: true },
    actor: { type: Schema.Types.ObjectId, ref: "AdminUser", default: null },
    actorName: { type: String, default: null, maxlength: 200 },
    detail: { type: String, default: "", maxlength: 1000 },
  },
  { _id: true }
);

const talentPoolEntrySchema = new Schema<TalentPoolEntryDoc>(
  {
    name: { type: String, required: true, trim: true, maxlength: FIELD_LIMITS.name },
    email: { type: String, required: true, trim: true, maxlength: FIELD_LIMITS.email },
    emailNormalized: { type: String, required: true, maxlength: FIELD_LIMITS.email },
    phone: { type: String, required: true, trim: true, maxlength: 40 },
    areaOfInterest: { type: String, required: true, trim: true, maxlength: FIELD_LIMITS.areaOfInterest },
    candidateNotes: { type: String, default: "", maxlength: FIELD_LIMITS.candidateNotes },
    tags: {
      type: [{ type: String, lowercase: true, trim: true, maxlength: FIELD_LIMITS.tag }],
      default: [],
      validate: { validator: (v: string[]) => v.length <= FIELD_LIMITS.tags, message: "Too many tags." },
    },
    notes: { type: [noteSchema], default: [] },
    documents: { type: [storedDocumentSchema], default: [] },
    consentGiven: { type: Boolean, required: true },
    consentAt: { type: Date, default: null },
    source: { type: String, enum: TALENT_SOURCES, required: true },
    sourceApplication: { type: Schema.Types.ObjectId, ref: "Application", default: null },
    applications: { type: [{ type: Schema.Types.ObjectId, ref: "Application" }], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "AdminUser", default: null },
    activity: { type: [activitySchema], default: [] },
    legacyIds: { type: [String], default: [] },
    ...archiveFields,
  },
  {
    collection: "talent_pool",
    timestamps: true,
    strict: "throw",
    strictQuery: "throw",
  }
);

talentPoolEntrySchema.pre("validate", function normalize() {
  if (this.email) this.emailNormalized = this.email.trim().toLowerCase();
});

talentPoolEntrySchema.index({ emailNormalized: 1 }, { unique: true, name: "email_unique" });
talentPoolEntrySchema.index({ archivedAt: 1, createdAt: -1, _id: -1 }, { name: "archived_createdAt" });
talentPoolEntrySchema.index({ tags: 1, createdAt: -1 }, { name: "tags_createdAt" });
talentPoolEntrySchema.index({ areaOfInterest: 1, createdAt: -1 }, { name: "area_createdAt" });
talentPoolEntrySchema.index({ "documents._id": 1 }, { name: "documents_id" });
talentPoolEntrySchema.index({ applications: 1 }, { name: "applications" });
talentPoolEntrySchema.index({ legacyIds: 1 }, { name: "legacyIds" });

export const TalentPoolEntryModel = defineModel<TalentPoolEntryDoc>("TalentPoolEntry", talentPoolEntrySchema);
