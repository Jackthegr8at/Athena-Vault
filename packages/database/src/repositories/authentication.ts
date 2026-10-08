import { and, desc, eq, gt } from "drizzle-orm";
import type { Database } from "../client";
import {
  authSessions,
  authUserWorkspaces,
  authUsers,
  users,
} from "../drizzle-schema";

import type { OwnerRecord } from "./shared";

export function createAuthenticationRepository(db: Database) {
  return {
    async getOwnerByAuthUserId(authUserId: string): Promise<OwnerRecord | null> {
      const [owner] = await db.select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        isDemo: users.isDemo,
        demoFixtureVersion: users.demoFixtureVersion,
        createdAt: users.createdAt,
      }).from(authUserWorkspaces)
        .innerJoin(users, eq(users.id, authUserWorkspaces.athenaUserId))
        .where(eq(authUserWorkspaces.authUserId, authUserId))
        .limit(1);
      return owner ?? null;
    },
    async listActiveSessions(authUserId: string): Promise<readonly {
      readonly id: string;
      readonly createdAt: Date;
      readonly updatedAt: Date;
      readonly expiresAt: Date;
      readonly userAgent: string | null;
    }[]> {
      return db.select({
        id: authSessions.id,
        createdAt: authSessions.createdAt,
        updatedAt: authSessions.updatedAt,
        expiresAt: authSessions.expiresAt,
        userAgent: authSessions.userAgent,
      }).from(authSessions)
        .where(and(eq(authSessions.userId, authUserId), gt(authSessions.expiresAt, new Date())))
        .orderBy(desc(authSessions.updatedAt), desc(authSessions.createdAt), desc(authSessions.id));
    },
    async getSessionToken(authUserId: string, sessionId: string): Promise<string | null> {
      const [session] = await db.select({ token: authSessions.token })
        .from(authSessions)
        .where(and(eq(authSessions.userId, authUserId), eq(authSessions.id, sessionId)))
        .limit(1);
      return session?.token ?? null;
    },
    async getSecuritySummary(authUserId: string): Promise<{
      readonly passwordChangedAt: Date | null;
      readonly activeSessionCount: number;
      readonly activeSessions: readonly {
        readonly id: string;
        readonly createdAt: Date;
        readonly updatedAt: Date;
        readonly expiresAt: Date;
        readonly userAgent: string | null;
      }[];
    }> {
      // Passkey storage is intentionally restricted to the Better Auth role.
      // This repository is also used with the application role for settings,
      // so keep the summary limited to tables that role may read.
      const [userRows, sessions] = await Promise.all([
        db.select({ passwordChangedAt: authUsers.passwordChangedAt }).from(authUsers).where(eq(authUsers.id, authUserId)).limit(1),
        this.listActiveSessions(authUserId),
      ]);
      return { passwordChangedAt: userRows[0]?.passwordChangedAt ?? null, activeSessionCount: sessions.length, activeSessions: sessions };
    },
    async markPasswordChanged(authUserId: string, changedAt = new Date()): Promise<void> {
      await db.update(authUsers).set({ passwordChangedAt: changedAt }).where(eq(authUsers.id, authUserId));
    },
  };
}
