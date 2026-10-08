import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDatabase, type Database } from "./client";
import { createAuthenticationRepository } from "./repositories/authentication";
import { authSessions, authUserWorkspaces, authUsers, sharedProjects, users } from "./drizzle-schema";
import { createSharedProjectsRepository } from "./shared-projects";

const connectionString = process.env.DATABASE_URL;
const database = connectionString ? createDatabase(connectionString) : undefined;

const ownerA = "00000000-0000-4000-8000-0000000022a1";
const ownerB = "00000000-0000-4000-8000-0000000022b1";
const authUserA = "auth-fixture-user-a-022";
const authUserB = "auth-fixture-user-b-022";
const activeSessionA = "auth-fixture-session-a-022";
const expiredSessionA = "auth-fixture-expired-a-022";

describe.skipIf(!database)("two-user authentication and workspace fixture", () => {
  it("maps sessions to separate owners and denies cross-user reads and writes", async () => {
    if (!database) return;
    const rollbackMarker = new Error("two-user authentication fixture rollback");

    await expect(database.transaction(async (tx) => {
      await tx.insert(users).values([
        { id: ownerA, email: "auth-fixture-owner-a@athena-vault.local", displayName: "Fixture A" },
        { id: ownerB, email: "auth-fixture-owner-b@athena-vault.local", displayName: "Fixture B" },
      ]);
      await tx.insert(authUsers).values([
        { id: authUserA, name: "Fixture A", email: "auth-fixture-owner-a@athena-vault.local", emailVerified: false, passwordChangedAt: new Date("2026-08-18T12:00:00.000Z") },
        { id: authUserB, name: "Fixture B", email: "auth-fixture-owner-b@athena-vault.local", emailVerified: false },
      ]);
      await tx.insert(authUserWorkspaces).values([
        { authUserId: authUserA, athenaUserId: ownerA },
        { authUserId: authUserB, athenaUserId: ownerB },
      ]);
      await tx.insert(authSessions).values([
        {
          id: activeSessionA,
          expiresAt: new Date("2099-01-01T00:00:00.000Z"),
          token: "auth-fixture-token-a-022",
          userId: authUserA,
        },
        {
          id: expiredSessionA,
          expiresAt: new Date("2000-01-01T00:00:00.000Z"),
          token: "auth-fixture-token-expired-a-022",
          userId: authUserA,
        },
      ]);

      const authentication = createAuthenticationRepository(tx as unknown as Database);
      await expect(authentication.getOwnerByAuthUserId(authUserA)).resolves.toMatchObject({ id: ownerA, email: "auth-fixture-owner-a@athena-vault.local" });
      await expect(authentication.getOwnerByAuthUserId(authUserB)).resolves.toMatchObject({ id: ownerB, email: "auth-fixture-owner-b@athena-vault.local" });
      await expect(authentication.getOwnerByAuthUserId("auth-fixture-unmapped-022")).resolves.toBeNull();
      await expect(authentication.getSecuritySummary(authUserA)).resolves.toMatchObject({ passwordChangedAt: new Date("2026-08-18T12:00:00.000Z"), activeSessionCount: 1 });
      await expect(authentication.getSecuritySummary(authUserB)).resolves.toMatchObject({ passwordChangedAt: null, activeSessionCount: 0 });
      await authentication.markPasswordChanged(authUserB, new Date("2026-08-18T13:00:00.000Z"));
      await expect(authentication.getSecuritySummary(authUserB)).resolves.toMatchObject({ passwordChangedAt: new Date("2026-08-18T13:00:00.000Z"), activeSessionCount: 0 });

      const projects = createSharedProjectsRepository(tx as unknown as Database);
      const projectA = await projects.createProject(ownerA, { name: "Fixture A ledger", projectYear: 2026, ownerParticipates: true, note: null });
      const projectB = await projects.createProject(ownerB, { name: "Fixture B ledger", projectYear: 2026, ownerParticipates: false, note: null });
      const expenseB = await projects.createExpense(ownerB, projectB, {
        description: "Fixture B expense",
        expenseOn: "2026-08-13",
        quantity: 2,
        amountMinor: 1_250,
        note: null,
      });

      expect((await projects.listProjects(ownerA)).map((project) => project.id)).toEqual([projectA]);
      expect((await projects.listProjects(ownerB)).map((project) => project.id)).toEqual([projectB]);
      await expect(projects.getProject(ownerA, projectB)).resolves.toBeNull();
      await expect(projects.getProject(ownerB, projectA)).resolves.toBeNull();

      await expect(projects.updateProject(ownerA, projectB, {
        name: "Tampered B ledger",
        projectYear: 2026,
        ownerParticipates: true,
        note: null,
      })).rejects.toThrow("Project not found.");
      await expect(projects.createExpense(ownerA, projectB, {
        description: "Tampered B expense",
        expenseOn: null,
        quantity: 1,
        amountMinor: 1,
        note: null,
      })).rejects.toThrow("Project not found.");
      await expect(projects.updateExpense(ownerA, expenseB, projectB, {
        description: "Tampered B expense",
        expenseOn: null,
        quantity: 1,
        amountMinor: 1,
        note: null,
      })).rejects.toThrow("Project not found.");

      await expect(tx.delete(authSessions).where(and(eq(authSessions.userId, authUserA), eq(authSessions.id, activeSessionA))).returning({ id: authSessions.id })).resolves.toEqual([{ id: activeSessionA }]);
      await expect(tx.select({ id: authSessions.id }).from(authSessions).where(eq(authSessions.userId, authUserA))).resolves.toEqual([{ id: expiredSessionA }]);

      expect(await tx.select({ id: sharedProjects.id }).from(sharedProjects).where(eq(sharedProjects.id, projectB))).toHaveLength(1);
      throw rollbackMarker;
    })).rejects.toThrow(rollbackMarker.message);

    await expect(database.select({ id: users.id }).from(users).where(eq(users.id, ownerA))).resolves.toHaveLength(0);
    await expect(database.select({ id: users.id }).from(users).where(eq(users.id, ownerB))).resolves.toHaveLength(0);
  });
});
