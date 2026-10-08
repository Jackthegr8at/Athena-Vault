import { and, eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDatabase, type Database } from "./client";
import { auditEvents, sharedProjectExpenses, sharedProjectParticipants, sharedProjects, users } from "./drizzle-schema";
import { createSharedProjectsRepository } from "./shared-projects";
import { expectIntegrationRollback } from "./integration-test-helpers";

const connectionString = process.env.DATABASE_URL;
const database = connectionString ? createDatabase(connectionString) : undefined;
const ownerA = "00000000-0000-4000-8000-0000000002a1";
const ownerB = "00000000-0000-4000-8000-0000000002b1";

describe.skipIf(!database)("shared projects repository", () => {
  it("keeps the project ledger owner-scoped, supports duplicate names, archives reversibly, and preserves payments", async () => {
    if (!database) return;
    const rollbackMarker = new Error("shared projects integration rollback");
    let createdProjectId: string | null = null;

    await expectIntegrationRollback(database.transaction(async (tx) => {
      await tx.insert(users).values([
        { id: ownerA, email: "shared-projects-owner-a@athena-vault.local" },
        { id: ownerB, email: "shared-projects-owner-b@athena-vault.local" },
      ]);
      const repository = createSharedProjectsRepository(tx as unknown as Database);
      const projectId = await repository.createProject(ownerA, { name: "Camping internet", projectYear: 2026, ownerParticipates: false, note: "Summer" });
      createdProjectId = projectId;
      const duplicateProjectId = await repository.createProject(ownerA, { name: "Camping internet", projectYear: 2026, ownerParticipates: true, note: null });
      const ownerBProjectId = await repository.createProject(ownerB, { name: "Camping internet", projectYear: 2026, ownerParticipates: false, note: null });
      expect(projectId).not.toBe(duplicateProjectId);
      expect(ownerBProjectId).not.toBe(projectId);

      const unsafeDescription = "Unsafe product";
      await expect(repository.createExpense(ownerA, projectId, { description: unsafeDescription, expenseOn: null, quantity: Number.MAX_SAFE_INTEGER, amountMinor: 2, note: null })).rejects.toThrow("Expense total");
      expect(await tx.select({ id: sharedProjectExpenses.id }).from(sharedProjectExpenses).where(and(
        eq(sharedProjectExpenses.ownerId, ownerA),
        eq(sharedProjectExpenses.projectId, projectId),
        eq(sharedProjectExpenses.description, unsafeDescription),
      ))).toHaveLength(0);

      const expenseId = await repository.createExpense(ownerA, projectId, { description: "Internet", expenseOn: "2026-07-01", quantity: 2, amountMinor: 5_000, note: null });
      await expect(repository.updateExpense(ownerA, expenseId, projectId, { description: "Unsafe update", expenseOn: null, quantity: Number.MAX_SAFE_INTEGER, amountMinor: 2, note: null })).rejects.toThrow("Expense total");
      expect((await repository.getProject(ownerA, projectId))?.expenses.find((expense) => expense.id === expenseId)).toMatchObject({ description: "Internet", quantity: 2, amountMinor: 5_000, totalMinor: 10_000 });

      const quantityExpenseId = await repository.createExpense(ownerA, projectId, { description: "Eight units", expenseOn: null, quantity: 8, amountMinor: 1_000, note: null });
      expect((await repository.getProject(ownerA, projectId))?.expenses.find((expense) => expense.id === quantityExpenseId)).toMatchObject({ quantity: 8, amountMinor: 1_000, totalMinor: 8_000 });
      await repository.deleteExpense(ownerA, quantityExpenseId, projectId);

      const removableExpenseId = await repository.createExpense(ownerA, projectId, { description: "Temporary", expenseOn: null, amountMinor: 100, note: null });
      const partialParticipantId = await repository.createParticipant(ownerA, projectId, { name: "Alex", paidMinor: 2_000 });
      const exactParticipantId = await repository.createParticipant(ownerA, projectId, { name: "Alex", paidMinor: 5_000 });
      const removableParticipantId = await repository.createParticipant(ownerA, projectId, { name: "Alex", paidMinor: 0 });
      expect(partialParticipantId).not.toBe(exactParticipantId);

      let view = await repository.getProject(ownerA, projectId);
      expect(view).toMatchObject({ id: projectId, totalExpensesMinor: 10_100, participantCount: 3, summary: { sharePerPersonMinor: 3_367, receivedFromOthersMinor: 7_000 } });
      expect(view?.participants.map((participant) => participant.paidMinor).sort((left, right) => left - right)).toEqual([0, 2_000, 5_000]);

      await repository.updateExpense(ownerA, expenseId, projectId, { description: "Internet updated", expenseOn: "2026-07-02", quantity: 3, amountMinor: 4_000, note: "Corrected" });
      view = await repository.getProject(ownerA, projectId);
      expect(view?.expenses.find((expense) => expense.id === expenseId)).toMatchObject({ amountMinor: 4_000, quantity: 3, totalMinor: 12_000, description: "Internet updated" });
      expect(view?.participants.map((participant) => participant.paidMinor).sort((left, right) => left - right)).toEqual([0, 2_000, 5_000]);
      expect(view?.participants.map((participant) => participant.status).sort()).toEqual(["extra", "partial", "unpaid"].sort());

      await repository.updateParticipant(ownerA, partialParticipantId, projectId, { name: "Alex paid", paidMinor: 6_000 });
      await repository.deleteParticipant(ownerA, removableParticipantId, projectId);
      await repository.deleteExpense(ownerA, removableExpenseId, projectId);
      await repository.archiveProject(ownerA, projectId);
      expect((await repository.listProjects(ownerA, { archived: false })).some((project) => project.id === projectId)).toBe(false);
      expect((await repository.listProjects(ownerA, { archived: true })).filter((project) => project.id === projectId)).toHaveLength(1);
      await repository.updateProject(ownerA, projectId, { name: "Camping internet corrected", projectYear: 2026, ownerParticipates: false, note: "Archived correction" });
      await repository.restoreProject(ownerA, projectId);

      expect(await repository.getProject(ownerB, projectId)).toBeNull();
      await expect(repository.updateExpense(ownerB, expenseId, projectId, { description: "No access", expenseOn: null, quantity: 1, amountMinor: 1, note: null })).rejects.toThrow("Project not found.");
      expect((await repository.listProjects(ownerA, { projectYear: 2026 })).map((project) => project.id)).toEqual(expect.arrayContaining([projectId, duplicateProjectId]));

      const audits = await tx.select({ entityType: auditEvents.entityType, entityId: auditEvents.entityId })
        .from(auditEvents)
        .where(and(eq(auditEvents.ownerId, ownerA), inArray(auditEvents.entityType, ["shared_project", "shared_project_expense", "shared_project_participant", "shared_project_payment"])));
      expect(audits.length).toBeGreaterThanOrEqual(10);
      expect(audits.some((audit) => audit.entityId === projectId && audit.entityType === "shared_project")).toBe(true);
      expect((await tx.select({ id: sharedProjectExpenses.id }).from(sharedProjectExpenses).where(eq(sharedProjectExpenses.id, expenseId)))).toHaveLength(1);
      expect((await tx.select({ id: sharedProjectParticipants.id }).from(sharedProjectParticipants).where(eq(sharedProjectParticipants.id, exactParticipantId)))).toHaveLength(1);
      expect((await tx.select({ id: sharedProjects.id }).from(sharedProjects).where(eq(sharedProjects.id, projectId)))).toHaveLength(1);

      throw rollbackMarker;
    }), rollbackMarker);

    if (!createdProjectId) throw new Error("Shared Projects integration did not create a project.");
    await expect(database.select({ id: sharedProjects.id }).from(sharedProjects).where(eq(sharedProjects.id, createdProjectId))).resolves.toHaveLength(0);
  });

  it("clones active and archived projects into unpaid active templates atomically", async () => {
    if (!database) return;
    const rollbackMarker = new Error("shared project clone integration rollback");
    let clonedProjectId: string | null = null;

    await expectIntegrationRollback(database.transaction(async (tx) => {
      await tx.insert(users).values([
        { id: ownerA, email: "shared-projects-owner-a@athena-vault.local" },
        { id: ownerB, email: "shared-projects-owner-b@athena-vault.local" },
      ]);
      const repository = createSharedProjectsRepository(tx as unknown as Database);
      const sourceProjectId = await repository.createProject(ownerA, { name: "Annual cabin", projectYear: 2026, ownerParticipates: true, note: "Source-only note" });
      const sourceExpenseId = await repository.createExpense(ownerA, sourceProjectId, { description: "Lodging", expenseOn: "2026-08-11", quantity: 2, amountMinor: 12_345, note: "Source expense" });
      const paidParticipantId = await repository.createParticipant(ownerA, sourceProjectId, { name: "Alex", paidMinor: 4_500 });
      const unpaidParticipantId = await repository.createParticipant(ownerA, sourceProjectId, { name: "Jordan", paidMinor: 0 });
      const sourceBefore = await repository.getProject(ownerA, sourceProjectId);
      const sourceExpense = sourceBefore?.expenses.find((expense) => expense.id === sourceExpenseId);
      expect(sourceExpense).toMatchObject({ description: "Lodging", expenseOn: "2026-08-11", quantity: 2, amountMinor: 12_345, note: "Source expense" });

      clonedProjectId = await repository.cloneProject(ownerA, sourceProjectId, { name: "Annual cabin", projectYear: 2027 });
      const clone = await repository.getProject(ownerA, clonedProjectId);
      expect(clone).toMatchObject({ name: "Annual cabin", projectYear: 2027, ownerParticipates: true, note: null, archivedAt: null });
      expect(clone?.expenses).toHaveLength(1);
      expect(clone?.expenses[0]).toMatchObject({ description: "Lodging", expenseOn: "2026-08-11", quantity: 2, amountMinor: 12_345, note: "Source expense" });
      expect(clone?.expenses[0]?.id).not.toBe(sourceExpenseId);
      expect(clone?.participants.map((participant) => ({ name: participant.name, paidMinor: participant.paidMinor, paidAt: participant.paidAt }))).toEqual(expect.arrayContaining([
        { name: "Alex", paidMinor: 0, paidAt: null },
        { name: "Jordan", paidMinor: 0, paidAt: null },
      ]));
      expect(clone?.participants.map((participant) => participant.id)).not.toEqual([paidParticipantId, unpaidParticipantId]);

      await repository.archiveProject(ownerA, sourceProjectId);
      const archivedCloneId = await repository.cloneProject(ownerA, sourceProjectId, { name: "Archived annual cabin", projectYear: 2028 });
      const archivedClone = await repository.getProject(ownerA, archivedCloneId);
      expect(archivedClone).toMatchObject({ name: "Archived annual cabin", projectYear: 2028, ownerParticipates: true, note: null, archivedAt: null });

      const emptySourceId = await repository.createProject(ownerA, { name: "Empty source", projectYear: 2026, ownerParticipates: false, note: "Do not copy" });
      const emptyCloneId = await repository.cloneProject(ownerA, emptySourceId, { name: "Empty clone", projectYear: 2029 });
      const emptyClone = await repository.getProject(ownerA, emptyCloneId);
      expect(emptyClone).toMatchObject({ name: "Empty clone", projectYear: 2029, ownerParticipates: false, note: null, archivedAt: null });
      expect(emptyClone?.expenses).toEqual([]);
      expect(emptyClone?.participants).toEqual([]);

      await expect(repository.cloneProject(ownerB, sourceProjectId, { name: "Cross-owner clone", projectYear: 2029 })).rejects.toThrow("Project not found.");

      await tx.execute(sql`
        CREATE OR REPLACE FUNCTION pg_temp.fail_shared_project_clone_expense()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $function$
        BEGIN
          RAISE EXCEPTION 'shared project clone test failure';
        END;
        $function$;
      `);
      await tx.execute(sql`
        CREATE TRIGGER shared_project_clone_test_failure
        BEFORE INSERT ON public.shared_project_expenses
        FOR EACH ROW
        EXECUTE FUNCTION pg_temp.fail_shared_project_clone_expense();
      `);
      await expect(repository.cloneProject(ownerA, sourceProjectId, { name: "Rollback clone", projectYear: 2030 })).rejects.toMatchObject({
        cause: expect.objectContaining({ message: expect.stringContaining("shared project clone test failure") }),
      });
      expect(await tx.select({ id: sharedProjects.id }).from(sharedProjects).where(and(eq(sharedProjects.ownerId, ownerA), eq(sharedProjects.name, "Rollback clone")))).toHaveLength(0);
      await tx.execute(sql`DROP TRIGGER shared_project_clone_test_failure ON public.shared_project_expenses`);

      const sourceAfter = await repository.getProject(ownerA, sourceProjectId);
      expect(sourceAfter?.note).toBe("Source-only note");
      expect(sourceAfter?.archivedAt).not.toBeNull();
      expect(sourceAfter?.expenses.find((expense) => expense.id === sourceExpenseId)?.amountMinor).toBe(12_345);
      expect(sourceAfter?.participants.map((participant) => ({ id: participant.id, paidMinor: participant.paidMinor }))).toEqual(expect.arrayContaining([
        { id: paidParticipantId, paidMinor: 4_500 },
        { id: unpaidParticipantId, paidMinor: 0 },
      ]));

      const audits = await tx.select({ action: auditEvents.action, entityType: auditEvents.entityType, entityId: auditEvents.entityId, metadata: auditEvents.metadata })
        .from(auditEvents)
        .where(eq(auditEvents.ownerId, ownerA));
      const cloneAudits = audits.filter((audit) => audit.metadata.operation === "clone" && audit.metadata.sourceProjectId === sourceProjectId);
      expect(cloneAudits).toHaveLength(8);
      expect(cloneAudits.some((audit) => audit.entityType === "shared_project" && audit.entityId === clonedProjectId)).toBe(true);

      throw rollbackMarker;
    }), rollbackMarker);

    if (!clonedProjectId) throw new Error("Shared project clone integration did not create a clone.");
    await expect(database.select({ id: sharedProjects.id }).from(sharedProjects).where(eq(sharedProjects.id, clonedProjectId))).resolves.toHaveLength(0);
  });
});
