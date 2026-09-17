import type { Model } from "mongoose";
import { AdminSessionModel } from "@/models/admin-session";
import { AdminUserModel } from "@/models/admin-user";
import { ApplicationModel } from "@/models/application";
import { AuditLogModel } from "@/models/audit-log";
import { EmailOutboxModel } from "@/models/email-outbox";
import { JobModel } from "@/models/job";
import { RateLimitModel } from "@/models/rate-limit";
import { SchemaMigrationModel } from "@/models/schema-migration";
import { TalentPoolEntryModel } from "@/models/talent-pool-entry";
import { UploadIntentModel } from "@/models/upload-intent";

export { AdminSessionModel } from "@/models/admin-session";
export { AdminUserModel } from "@/models/admin-user";
export { ApplicationModel, applicationReference } from "@/models/application";
export { AuditLogModel } from "@/models/audit-log";
export { EmailOutboxModel } from "@/models/email-outbox";
export { JobModel } from "@/models/job";
export { RateLimitModel } from "@/models/rate-limit";
export { SchemaMigrationModel } from "@/models/schema-migration";
export { TalentPoolEntryModel } from "@/models/talent-pool-entry";
export { UploadIntentModel } from "@/models/upload-intent";

// Every collection the application owns; db:setup / db:check iterate over this list.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ALL_MODELS: Model<any>[] = [
  JobModel,
  ApplicationModel,
  TalentPoolEntryModel,
  AdminUserModel,
  AdminSessionModel,
  AuditLogModel,
  RateLimitModel,
  UploadIntentModel,
  EmailOutboxModel,
  SchemaMigrationModel,
];
