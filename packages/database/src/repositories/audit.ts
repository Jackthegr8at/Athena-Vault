import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../client";
import {
  auditEvents,
} from "../drizzle-schema";

export type AuditEventView = Pick<
  typeof auditEvents.$inferSelect,
  "id" | "action" | "entityType" | "entityId" | "metadata" | "createdAt"
>;

const AUTH_SECURITY_OPERATIONS = [
  "two-factor-enable",
  "two-factor-disable",
  "backup-codes-regenerate",
  "session-revoke",
  "session-create",
  "password-change",
  "passkey-register",
  "passkey-authenticate",
  "passkey-revoke",
  "recovery-code-used",
  "security-setting-changed",
] as const;


const AUTH_SECURITY_STATUSES = ["success", "client-error", "server-error", "unknown"] as const;


export type AuthSecurityOperation = (typeof AUTH_SECURITY_OPERATIONS)[number];

export type AuthSecurityStatus = (typeof AUTH_SECURITY_STATUSES)[number];

const AUTH_SECURITY_OPERATION_SET: Record<string, true> = {
  "two-factor-enable": true,
  "two-factor-disable": true,
  "backup-codes-regenerate": true,
  "session-revoke": true,
  "session-create": true,
  "password-change": true,
  "passkey-register": true,
  "passkey-authenticate": true,
  "passkey-revoke": true,
  "recovery-code-used": true,
  "security-setting-changed": true,
};


const AUTH_SECURITY_STATUS_SET: Record<string, true> = {
  success: true,
  "client-error": true,
  "server-error": true,
  unknown: true,
};




export type AuthSecurityEventInput = {
  readonly operation: AuthSecurityOperation;
  readonly status: AuthSecurityStatus;
};



export type AuthSecurityActivityView = {
  readonly createdAt: Date;
  readonly operation: string;
  readonly status: string;
};


export function createAuditRepository(db: Database) {
  return {
    async listByOwner(ownerId: string, limit = 100): Promise<readonly AuditEventView[]> {
      return db.select({
        id: auditEvents.id,
        action: auditEvents.action,
        entityType: auditEvents.entityType,
        entityId: auditEvents.entityId,
        metadata: auditEvents.metadata,
        createdAt: auditEvents.createdAt,
      }).from(auditEvents)
        .where(eq(auditEvents.ownerId, ownerId))
        .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
        .limit(limit);
    },
    async listForBatch(ownerId: string, batchId: string): Promise<readonly AuditEventView[]> {
      return db.select({
        id: auditEvents.id,
        action: auditEvents.action,
        entityType: auditEvents.entityType,
        entityId: auditEvents.entityId,
        metadata: auditEvents.metadata,
        createdAt: auditEvents.createdAt,
      }).from(auditEvents)
        .where(and(eq(auditEvents.ownerId, ownerId), eq(auditEvents.importBatchId, batchId)))
        .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id));
    },
    async writeAuthSecurityEvent(ownerId: string, actorUserId: string, input: AuthSecurityEventInput): Promise<void> {
      const metadata: Record<string, unknown> = { operation: input.operation, status: input.status };

      await db.insert(auditEvents).values({
        ownerId,
        actorUserId,
        action: "created",
        entityType: "auth_security",
        entityId: null,
        metadata,
      });
    },
    async listAuthSecurityEvents(ownerId: string, isDemo: boolean, limit = 100): Promise<readonly AuthSecurityActivityView[]> {
      if (isDemo) return [];
      const rows = await db.select({
        createdAt: auditEvents.createdAt,
        metadata: auditEvents.metadata,
      }).from(auditEvents)
        .where(and(
          eq(auditEvents.ownerId, ownerId),
          eq(auditEvents.entityType, "auth_security"),
          eq(auditEvents.action, "created"),
        ))
        .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
        .limit(limit);
      return rows.map((row) => {
        const metadata = typeof row.metadata === "object" && row.metadata !== null ? (row.metadata as Record<string, unknown>) : {};
        const rawOperation = typeof metadata.operation === "string" ? metadata.operation : "unknown";
        const rawStatus = typeof metadata.status === "string" ? metadata.status : "unknown";
        const operation = AUTH_SECURITY_OPERATION_SET[rawOperation] ? rawOperation : "unknown";
        const status = AUTH_SECURITY_STATUS_SET[rawStatus] ? rawStatus : "unknown";
        return { createdAt: row.createdAt, operation, status };
      });
    },
  };
}
