import { Schema, type Types } from "mongoose";
import { FIELD_LIMITS, JOB_STATUSES, JOB_TYPES, type JobStatus, type JobType } from "@/lib/careers/constants";
import { defineModel } from "@/models/shared";

export const JOB_ORIGINS = ["admin", "seed", "postgres"] as const;
export type JobOrigin = (typeof JOB_ORIGINS)[number];

export interface JobDoc {
  _id: Types.ObjectId;
  // Public identifier used in URLs (/careers/<slug>) and exposed by the API as `id`.
  // Immutable and never reused, including after the job is archived.
  slug: string;
  title: string;
  department: string;
  location: string;
  type: JobType;
  experience: string;
  description: string;
  responsibilities: string[];
  requirements: string[];
  qualifications: string[];
  benefits: string[];
  // Last moment applications are accepted (end of the chosen day, Sri Lanka time).
  applicationDeadline: Date | null;
  status: JobStatus;
  publishedAt: Date | null;
  closedAt: Date | null;
  archivedAt: Date | null;
  createdBy: Types.ObjectId | null;
  createdByName: string | null;
  updatedBy: Types.ObjectId | null;
  updatedByName: string | null;
  origin: JobOrigin;
  createdAt: Date;
  updatedAt: Date;
}

const listItem = { type: String, trim: true, maxlength: FIELD_LIMITS.listItem };
const list = (label: string) => ({
  type: [listItem],
  default: [],
  validate: {
    validator: (v: string[]) => v.length <= FIELD_LIMITS.listItems,
    message: `Too many ${label}.`,
  },
});

const jobSchema = new Schema<JobDoc>(
  {
    slug: {
      type: String,
      required: true,
      immutable: true,
      lowercase: true,
      trim: true,
      minlength: FIELD_LIMITS.jobSlugMin,
      maxlength: FIELD_LIMITS.jobSlugMax,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    },
    title: { type: String, required: true, trim: true, maxlength: FIELD_LIMITS.jobTitle },
    department: { type: String, required: true, trim: true, maxlength: FIELD_LIMITS.department },
    location: { type: String, required: true, trim: true, maxlength: FIELD_LIMITS.location },
    type: { type: String, required: true, enum: JOB_TYPES },
    experience: { type: String, trim: true, default: "", maxlength: FIELD_LIMITS.experience },
    description: { type: String, required: true, trim: true, maxlength: FIELD_LIMITS.jobDescription },
    responsibilities: list("responsibilities"),
    requirements: list("requirements"),
    qualifications: list("qualifications"),
    benefits: list("benefits"),
    applicationDeadline: { type: Date, default: null },
    status: { type: String, required: true, enum: JOB_STATUSES, default: "draft" },
    publishedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "AdminUser", default: null },
    createdByName: { type: String, default: null, maxlength: 200 },
    updatedBy: { type: Schema.Types.ObjectId, ref: "AdminUser", default: null },
    updatedByName: { type: String, default: null, maxlength: 200 },
    origin: { type: String, enum: JOB_ORIGINS, required: true, default: "admin" },
  },
  {
    collection: "jobs",
    timestamps: true,
    strict: "throw",
    strictQuery: "throw",
  }
);

jobSchema.index({ slug: 1 }, { unique: true, name: "slug_unique" });
// Public listing: status = published AND (deadline null OR deadline >= now), newest first.
jobSchema.index({ status: 1, applicationDeadline: 1, publishedAt: -1 }, { name: "public_listing" });
// Admin listing filtered by status, newest first.
jobSchema.index({ status: 1, createdAt: -1, _id: -1 }, { name: "status_createdAt_id" });
jobSchema.index({ createdAt: -1, _id: -1 }, { name: "createdAt_id_desc" });
jobSchema.index({ department: 1, status: 1 }, { name: "department_status" });

export const JobModel = defineModel<JobDoc>("Job", jobSchema);
