// Audit trail of security-relevant and data-changing admin actions. Writing an entry never
// fails the action being audited; a failed write is logged instead.

import type { Types } from "mongoose";
import { escapeRegExp } from "@/lib/careers/validation";
import { logger } from "@/lib/logger";
import { connectToDatabase } from "@/lib/mongodb";
import { AuditLogModel, type AuditActor, type AuditLogDoc } from "@/models/audit-log";
import type { AuditLogEntry, Paginated } from "@/types/careers";

export type AuditEntryInput = {
  actor: AuditActor | null;
  action: string;
  entityType: string;
  entityId: string;
  // Shown to administrators. Never include candidate emails, phone numbers or note bodies.
  summary: string;
  meta?: Record<string, unknown>;
  ip?: string | null;
};

// Schema maxlengths; values are clipped so an unusually long title never loses the entry.
const LIMITS = { action: 80, entityType: 40, entityId: 120, summary: 500, ip: 100, actorName: 200 } as const;

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export async function recordAudit(entry: AuditEntryInput): Promise<void> {
  try {
    await connectToDatabase();
    const ip = entry.ip && entry.ip !== "unknown" ? entry.ip.slice(0, LIMITS.ip) : null;
    await AuditLogModel.create({
      at: new Date(),
      actor: entry.actor
        ? {
            user: entry.actor.user,
            email: entry.actor.email,
            name: clip(entry.actor.name, LIMITS.actorName),
            role: entry.actor.role,
          }
        : null,
      action: entry.action.slice(0, LIMITS.action),
      entityType: entry.entityType.slice(0, LIMITS.entityType),
      entityId: (entry.entityId || "unknown").slice(0, LIMITS.entityId),
      summary: clip(entry.summary || entry.action, LIMITS.summary),
      meta: entry.meta ?? {},
      ip,
    });
  } catch (err) {
    logger.error("audit.write_failed", { action: entry.action, entityType: entry.entityType, entityId: entry.entityId, err });
  }
}

export type AuditLogFilters = {
  page: number;
  limit: number;
  // "job.publish" matches exactly; a bare prefix such as "job" matches every "job.*" action.
  action?: string;
  entityType?: string;
  entityId?: string;
  actorId?: Types.ObjectId;
  from?: Date;
  to?: Date;
};

type AuditLogQuery = {
  action?: string | RegExp;
  entityType?: string;
  entityId?: string;
  "actor.user"?: Types.ObjectId;
  at?: { $gte?: Date; $lte?: Date };
};

export function toAuditLogEntry(doc: Pick<AuditLogDoc, "_id" | "at" | "actor" | "action" | "entityType" | "entityId" | "summary" | "ip">): AuditLogEntry {
  return {
    id: String(doc._id),
    at: doc.at.toISOString(),
    actorName: doc.actor?.name ?? null,
    actorEmail: doc.actor?.email ?? null,
    action: doc.action,
    entityType: doc.entityType,
    entityId: doc.entityId,
    summary: doc.summary,
    ip: doc.ip ?? null,
  };
}

export async function listAuditLogs(filters: AuditLogFilters): Promise<Paginated<AuditLogEntry>> {
  await connectToDatabase();
  const page = Math.max(1, Math.floor(filters.page));
  const limit = Math.max(1, Math.floor(filters.limit));

  const query: AuditLogQuery = {};
  if (filters.action) {
    query.action = filters.action.includes(".") ? filters.action : new RegExp(`^${escapeRegExp(filters.action)}\\.`);
  }
  if (filters.entityType) query.entityType = filters.entityType;
  if (filters.entityId) query.entityId = filters.entityId;
  if (filters.actorId) query["actor.user"] = filters.actorId;
  if (filters.from || filters.to) {
    query.at = {};
    if (filters.from) query.at.$gte = filters.from;
    if (filters.to) query.at.$lte = filters.to;
  }

  const [docs, total] = await Promise.all([
    AuditLogModel.find(query)
      .select({ at: 1, actor: 1, action: 1, entityType: 1, entityId: 1, summary: 1, ip: 1 })
      .sort({ at: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    AuditLogModel.countDocuments(query),
  ]);

  return {
    items: docs.map(toAuditLogEntry),
    total,
    page,
    limit,
    pageCount: Math.max(1, Math.ceil(total / limit)),
  };
}
