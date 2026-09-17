import { Schema, type Types } from "mongoose";
import { ADMIN_ROLES, FIELD_LIMITS, type AdminRole } from "@/lib/careers/constants";
import { defineModel } from "@/models/shared";

export interface AdminUserDoc {
  _id: Types.ObjectId;
  email: string; // stored lower-cased
  name: string;
  role: AdminRole;
  // scrypt hash (see src/lib/auth/password.ts). Never selected unless explicitly requested.
  passwordHash: string;
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  passwordChangedAt: Date;
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const adminUserSchema = new Schema<AdminUserDoc>(
  {
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: FIELD_LIMITS.email },
    name: { type: String, required: true, trim: true, maxlength: FIELD_LIMITS.name },
    role: { type: String, enum: ADMIN_ROLES, required: true },
    passwordHash: { type: String, required: true, select: false, maxlength: 500 },
    active: { type: Boolean, required: true, default: true },
    mustChangePassword: { type: Boolean, required: true, default: false },
    lastLoginAt: { type: Date, default: null },
    failedLoginAttempts: { type: Number, required: true, default: 0, min: 0 },
    lockedUntil: { type: Date, default: null },
    passwordChangedAt: { type: Date, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "AdminUser", default: null },
  },
  {
    collection: "admin_users",
    timestamps: true,
    strict: "throw",
    strictQuery: "throw",
  }
);

adminUserSchema.index({ email: 1 }, { unique: true, name: "email_unique" });

export const AdminUserModel = defineModel<AdminUserDoc>("AdminUser", adminUserSchema);
