import { and, count, eq, gte } from "drizzle-orm";
import type { Database } from "../client";
import { ownerNotifications } from "../drizzle-schema";

export const OWNER_NOTIFICATION_TYPES = [
  "new_session",
  "recovery_code_used",
  "passkey_registered",
  "passkey_revoked",
  "password_changed",
  "mfa_changed",
] as const;

export type OwnerNotificationType = (typeof OWNER_NOTIFICATION_TYPES)[number];
export type OwnerNotificationPayload = Readonly<Record<string, string>>;

const SAFE_PAYLOAD_KEYS: ReadonlySet<string> = new Set(["title", "message", "occurredAt"]);

function sanitizePayload(payload: OwnerNotificationPayload): Record<string, string> {
  return Object.fromEntries(Object.entries(payload).filter(([key, value]) => SAFE_PAYLOAD_KEYS.has(key) && value.length <= 256));
}

export function createNotificationRepository(db: Database) {
  return {
    async createOwnerNotification(ownerId: string, type: OwnerNotificationType, payload: OwnerNotificationPayload, now = new Date()): Promise<void> {
      await db.insert(ownerNotifications).values({ ownerId, type, payload: sanitizePayload(payload), createdAt: now });
    },
    async hasRecentNotification(ownerIdentifier: string, type: OwnerNotificationType, since: Date): Promise<boolean> {
      const [row] = await db.select({ id: ownerNotifications.id })
        .from(ownerNotifications)
        .where(and(eq(ownerNotifications.ownerId, ownerIdentifier), eq(ownerNotifications.type, type), gte(ownerNotifications.createdAt, since)))
        .limit(1);
      return Boolean(row);
    },
    async countUnread(ownerIdentifier: string): Promise<number> {
      const [row] = await db.select({ n: count() }).from(ownerNotifications).where(and(eq(ownerNotifications.ownerId, ownerIdentifier), eq(ownerNotifications.read, false)));
      return Number(row?.n ?? 0);
    },
  };
}
