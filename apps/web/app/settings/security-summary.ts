import { createAuthenticationRepository, createAuditRepository, createNotificationRepository, type Database } from "@athena/database";
import type { AuthenticatedUser } from "../../lib/server/auth-session";
import { logSecurityEvent } from "../../lib/server/security-logging";

export type SettingsSecuritySession = {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
  readonly userAgent: string | null;
  readonly isCurrent: boolean;
};

export type SettingsSecurityActivity = {
  readonly createdAt: string;
  readonly operation: string;
  readonly status: string;
};

export type SettingsSecuritySummary = {
  readonly passwordChangedAt: string | null;
  readonly activeSessionCount: number | null;
  readonly activeSessions: readonly SettingsSecuritySession[] | null;
  readonly securityActivity?: readonly SettingsSecurityActivity[];
  readonly pendingNotificationsCount?: number | null;
};

export function neutralSettingsSecuritySummary(): SettingsSecuritySummary {
  return { passwordChangedAt: null, activeSessionCount: null, activeSessions: null, pendingNotificationsCount: null };
}

export async function loadSettingsSecuritySummary(database: Database, user: AuthenticatedUser): Promise<SettingsSecuritySummary> {
  try {
    const [security, activity, pendingNotificationsCount] = await Promise.all([
      createAuthenticationRepository(database).getSecuritySummary(user.authUserId),
      createAuditRepository(database).listAuthSecurityEvents(user.owner.id, user.owner.isDemo),
      createNotificationRepository(database).countUnread(user.owner.id),
    ]);
    return {
      passwordChangedAt: security.passwordChangedAt?.toISOString() ?? null,
      activeSessionCount: security.activeSessionCount,
      activeSessions: security.activeSessions.map((session) => ({
        id: session.id,
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
        userAgent: session.userAgent,
        isCurrent: session.id === user.session.id,
      })),
      securityActivity: activity.map((row) => ({ createdAt: row.createdAt.toISOString(), operation: row.operation, status: row.status })),
      pendingNotificationsCount,
    };
  } catch (error) {
    logSecurityEvent({ event: "settings_security_summary_unavailable", component: "settings", operation: "load-security-summary", error });
    return neutralSettingsSecuritySummary();
  }
}
