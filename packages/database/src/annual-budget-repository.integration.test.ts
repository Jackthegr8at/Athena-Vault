import { and, eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type Database } from "./client";
import { expectIntegrationRollback } from "./integration-test-helpers";
import { createAnnualBudgetMutationRepository } from "./annual-budget-mutations";
import { createAnnualBudgetRepository } from "./annual-budgets";
import { annualBudgets, annualExpensePayments, annualExpenseValues, annualExpenses, accounts, auditEvents, balanceSnapshots, cashFlowPeriods, institutions, users } from "./drizzle-schema";

const connectionString = process.env.DATABASE_URL;
const database = connectionString ? createDatabase(connectionString) : undefined;
const ownerA = "00000000-0000-0000-0000-0000000000ca";
const ownerB = "00000000-0000-0000-0000-0000000000cb";

describe.skipIf(!database)("annual budget repositories", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-05T16:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps budgets isolated, supports reversible mutations, preserves history, and rolls back as one unit", async () => {
    if (!database) return;
    const rollbackMarker = new Error("annual-budget integration rollback");

    await expectIntegrationRollback(database.transaction(async (tx) => {
      await tx.insert(users).values([
        { id: ownerA, email: "annual-budget-owner-a@athena-vault.local" },
        { id: ownerB, email: "annual-budget-owner-b@athena-vault.local" },
      ]);
      const [institutionA] = await tx.insert(institutions).values({ ownerId: ownerA, name: "Community bank A", currency: "CAD" }).returning({ id: institutions.id });
      const [institutionB] = await tx.insert(institutions).values({ ownerId: ownerB, name: "Community bank B", currency: "CAD" }).returning({ id: institutions.id });
      if (!institutionA || !institutionB) throw new Error("Integration institutions were not created.");
      const [accountA1] = await tx.insert(accounts).values({ ownerId: ownerA, institutionId: institutionA.id, name: "Personal goal", kind: "other", customTypeLabel: "Reserve" }).returning({ id: accounts.id });
      const [accountA2] = await tx.insert(accounts).values({ ownerId: ownerA, institutionId: institutionA.id, name: "House goal", kind: "other", customTypeLabel: "Reserve" }).returning({ id: accounts.id });
      const [accountB] = await tx.insert(accounts).values({ ownerId: ownerB, institutionId: institutionB.id, name: "Other goal", kind: "other", customTypeLabel: "Reserve" }).returning({ id: accounts.id });
      if (!accountA1 || !accountA2 || !accountB) throw new Error("Integration accounts were not created.");
      const [budgetA1] = await tx.insert(annualBudgets).values({ ownerId: ownerA, name: "Personal budget", linkedAccountId: accountA1.id, displayOrder: 0 }).returning({ id: annualBudgets.id });
      const [budgetA2] = await tx.insert(annualBudgets).values({ ownerId: ownerA, name: "House budget", linkedAccountId: accountA2.id, displayOrder: 1 }).returning({ id: annualBudgets.id });
      const [budgetB] = await tx.insert(annualBudgets).values({ ownerId: ownerB, name: "Other budget", linkedAccountId: accountB.id, displayOrder: 0 }).returning({ id: annualBudgets.id });
      if (!budgetA1 || !budgetA2 || !budgetB) throw new Error("Integration budgets were not created.");

      const repository = createAnnualBudgetRepository(tx as unknown as Database);
      const mutations = createAnnualBudgetMutationRepository(tx as unknown as Database);
      const expenseId = await repository.createExpense(ownerA, {
        budgetId: budgetA1.id,
        taxYear: 2026,
        name: "Insurance",
        amountMinor: 5_000,
        dueMonth: 2,
        dueDay: 31,
      });
      expect((await repository.listByOwner(ownerB, 2026)).budgets.flatMap((budget) => budget.items)).toHaveLength(0);
      expect((await repository.listByOwner(ownerA, 2026)).budgets[0]).toMatchObject({ name: "Personal budget", itemCount: 1, totalPlannedMinor: 5_000 });

      await repository.updateExpense(ownerA, expenseId, { name: "Insurance renewal", amountMinor: 6_000, dueMonth: 3, dueDay: null, fromYear: 2026 });
      await repository.moveExpense(ownerA, expenseId, budgetA2.id, 2026);
      const moved = await repository.listByOwner(ownerA, 2026);
      expect(moved.budgets.find((budget) => budget.id === budgetA2.id)?.items[0]).toMatchObject({ budgetId: budgetA2.id, name: "Insurance renewal", occurrence: { dueDate: "2026-03-01" } });

      const occurrenceId = moved.budgets.find((budget) => budget.id === budgetA2.id)?.items[0]?.occurrence.id;
      if (!occurrenceId) throw new Error("Integration occurrence was not created.");
      await mutations.createPayment(ownerA, { annualExpenseValueId: occurrenceId, paymentOn: "2026-01-15", amountMinor: 2_000, note: "First payment" });
      const secondPaymentId = await mutations.createPayment(ownerA, { annualExpenseValueId: occurrenceId, paymentOn: "2026-02-15", amountMinor: 1_500, note: null });
      let afterPayments = await repository.listByOwner(ownerA, 2026);
      expect(afterPayments.budgets.find((budget) => budget.id === budgetA2.id)?.items[0]?.occurrence).toMatchObject({ paidMinor: 3_500, remainingMinor: 2_500, status: "Partially paid" });
      await mutations.updatePayment(ownerA, secondPaymentId, { id: secondPaymentId, annualExpenseValueId: occurrenceId, paymentOn: "2026-02-20", amountMinor: 2_500, note: "Updated payment" });
      await mutations.deletePayment(ownerA, secondPaymentId);
      afterPayments = await repository.listByOwner(ownerA, 2026);
      expect(afterPayments.budgets.find((budget) => budget.id === budgetA2.id)?.items[0]?.occurrence).toMatchObject({ paidMinor: 2_000, status: "Partially paid" });

      await mutations.upsertYearOverride(ownerA, {
        annualExpenseId: expenseId,
        taxYear: 2026,
        plannedAmountMinor: 1_000,
        dueDate: "2026-04-30",
        note: "Reduced after payment",
        scope: "current_year",
      });
      afterPayments = await repository.listByOwner(ownerA, 2026);
      expect(afterPayments.budgets.find((budget) => budget.id === budgetA2.id)?.items[0]?.occurrence).toMatchObject({ plannedAmountMinor: 1_000, paidMinor: 2_000, remainingMinor: 0, varianceMinor: -1_000, status: "Over budget" });

      await repository.setExpenseArchived(ownerA, expenseId, true);
      const archived = await repository.listByOwner(ownerA, 2026);
      const archivedItem = archived.budgets.find((budget) => budget.id === budgetA2.id)?.items[0];
      expect(archivedItem).toMatchObject({ isActive: false, history: [expect.objectContaining({ taxYear: 2026, status: "Over budget" })] });
      expect(archived.budgets.find((budget) => budget.id === budgetA2.id)).toMatchObject({ itemCount: 0, totalPlannedMinor: 0 });

      await expect(mutations.createPayment(ownerB, { annualExpenseValueId: occurrenceId, paymentOn: "2026-03-01", amountMinor: 1, note: null })).rejects.toThrow("occurrence not found");
      const auditRows = await tx.select({ entityType: auditEvents.entityType, action: auditEvents.action }).from(auditEvents).where(and(eq(auditEvents.ownerId, ownerA), eq(auditEvents.entityType, "annual_expense_payment")));
      expect(auditRows.map((row) => row.action)).toEqual(expect.arrayContaining(["created", "updated", "deleted"]));

      throw rollbackMarker;
    }), rollbackMarker);

    expect(await database.select({ id: annualExpenses.id }).from(annualExpenses).where(eq(annualExpenses.ownerId, ownerA))).toHaveLength(0);
    expect(await database.select({ id: annualExpenseValues.id }).from(annualExpenseValues).where(eq(annualExpenseValues.ownerId, ownerA))).toHaveLength(0);
    expect(await database.select({ id: annualExpensePayments.id }).from(annualExpensePayments).where(eq(annualExpensePayments.ownerId, ownerA))).toHaveLength(0);
  });

  it("creates, renames, relinks, archives, and restores budgets with active-only conflicts and projection restart", async () => {
    if (!database) return;
    const lifecycleInstitutionA = "10000000-0000-4000-8000-0000000000ca";
    const lifecycleInstitutionB = "10000000-0000-4000-8000-0000000000cb";
    const lifecycleAccountA1 = "20000000-0000-4000-8000-0000000000ca";
    const lifecycleAccountA2 = "20000000-0000-4000-8000-0000000000cb";
    const lifecycleAccountA3 = "20000000-0000-4000-8000-0000000000cc";
    const lifecycleAccountB = "20000000-0000-4000-8000-0000000000cd";
    const rollbackMarker = new Error("annual-budget lifecycle integration rollback");

    await expectIntegrationRollback(database.transaction(async (tx) => {
      await tx.insert(users).values([
        { id: ownerA, email: "annual-budget-lifecycle-owner-a@athena-vault.local" },
        { id: ownerB, email: "annual-budget-lifecycle-owner-b@athena-vault.local" },
      ]);
      await tx.insert(institutions).values([
        { id: lifecycleInstitutionA, ownerId: ownerA, name: "Lifecycle bank A", currency: "CAD" },
        { id: lifecycleInstitutionB, ownerId: ownerB, name: "Lifecycle bank B", currency: "CAD" },
      ]);
      await tx.insert(accounts).values([
        { id: lifecycleAccountA1, ownerId: ownerA, institutionId: lifecycleInstitutionA, name: "Reserve A1", kind: "checking", currency: "CAD" },
        { id: lifecycleAccountA2, ownerId: ownerA, institutionId: lifecycleInstitutionA, name: "Reserve A2", kind: "checking", currency: "CAD" },
        { id: lifecycleAccountA3, ownerId: ownerA, institutionId: lifecycleInstitutionA, name: "Reserve A3", kind: "checking", currency: "CAD" },
        { id: lifecycleAccountB, ownerId: ownerB, institutionId: lifecycleInstitutionB, name: "Reserve B", kind: "checking", currency: "CAD" },
      ]);
      await tx.insert(cashFlowPeriods).values([
        { ownerId: ownerA, label: "Lifecycle actual", startsOn: "2026-07-23", endsOn: "2026-08-05", payDate: "2026-08-05", openingBalanceMinor: 0, currency: "CAD", status: "actual" },
        { ownerId: ownerA, label: "Lifecycle projected", startsOn: "2026-08-06", endsOn: "2026-08-19", payDate: "2026-08-19", openingBalanceMinor: 0, currency: "CAD", status: "planned" },
      ]);
      await tx.insert(balanceSnapshots).values([
        { ownerId: ownerA, accountId: lifecycleAccountA1, asOf: "2026-08-05", balanceMinor: 10000, status: "actual", isGenerated: false, currency: "CAD" },
        { ownerId: ownerA, accountId: lifecycleAccountA1, asOf: "2026-08-19", balanceMinor: 10000, status: "planned", isGenerated: true, currency: "CAD" },
        { ownerId: ownerA, accountId: lifecycleAccountA2, asOf: "2026-08-05", balanceMinor: 50000, status: "actual", isGenerated: false, currency: "CAD" },
        { ownerId: ownerA, accountId: lifecycleAccountA2, asOf: "2026-08-19", balanceMinor: 50000, status: "planned", isGenerated: true, currency: "CAD" },
      ]);

      const repository = createAnnualBudgetRepository(tx as unknown as Database);
      const mutations = createAnnualBudgetMutationRepository(tx as unknown as Database);
      const personalBudgetId = await repository.createBudget(ownerA, { name: "Personal lifecycle", linkedAccountId: lifecycleAccountA1 });
      const householdBudgetId = await repository.createBudget(ownerA, { name: "Household lifecycle", linkedAccountId: lifecycleAccountA2 });

      expect((await repository.listEligibleFundingAccounts(ownerA)).map((account) => account.id)).toEqual([lifecycleAccountA3]);
      expect((await repository.listEligibleFundingAccounts(ownerB)).map((account) => account.id)).toEqual([lifecycleAccountB]);

      const expenseId = await repository.createExpense(ownerA, {
        budgetId: personalBudgetId,
        taxYear: 2026,
        name: "Lifecycle insurance",
        amountMinor: 2_000,
        dueMonth: 8,
        dueDay: 10,
      });
      await repository.renameBudget(ownerA, personalBudgetId, "Personal lifecycle renamed");
      await repository.archiveBudget(ownerA, householdBudgetId);
      await repository.relinkBudget(ownerA, personalBudgetId, lifecycleAccountA2);

      const relinkedSnapshots = await tx.select({ accountId: balanceSnapshots.accountId, asOf: balanceSnapshots.asOf, balanceMinor: balanceSnapshots.balanceMinor, status: balanceSnapshots.status })
        .from(balanceSnapshots)
        .where(and(eq(balanceSnapshots.ownerId, ownerA), eq(balanceSnapshots.asOf, "2026-08-19")));
      expect(relinkedSnapshots).toEqual(expect.arrayContaining([
        { accountId: lifecycleAccountA1, asOf: "2026-08-19", balanceMinor: 10000, status: "planned" },
        { accountId: lifecycleAccountA2, asOf: "2026-08-19", balanceMinor: 48000, status: "planned" },
      ]));

      const replacementBudgetId = await repository.createBudget(ownerA, { name: "Replacement lifecycle", linkedAccountId: lifecycleAccountA3 });
      expect(replacementBudgetId).toBeTruthy();
      await repository.restoreBudget(ownerA, householdBudgetId, { linkedAccountId: lifecycleAccountA1 });

      const relinkedSummary = await repository.getSummary(ownerA, 2026);
      const relinkedItem = relinkedSummary.budgets.find((budget) => budget.id === personalBudgetId)?.items.find((item) => item.id === expenseId);
      if (!relinkedItem?.occurrence.id) throw new Error("Lifecycle occurrence was not created.");
      await mutations.createPayment(ownerA, { annualExpenseValueId: relinkedItem.occurrence.id, paymentOn: "2026-08-10", amountMinor: 500, note: "Lifecycle payment" });
      await repository.archiveBudget(ownerA, personalBudgetId);
      const archivedSummary = await repository.getSummary(ownerA, 2026);
      const archivedBudget = archivedSummary.budgets.find((budget) => budget.id === personalBudgetId);
      expect(archivedBudget).toMatchObject({ isActive: false, itemCount: 1, totalPlannedMinor: 2_000, totalPaidMinor: 500 });
      expect(archivedBudget?.items[0]).toMatchObject({ id: expenseId, isActive: true, occurrence: { paidMinor: 500 } });
      const archivedProjection = await tx.select({ accountId: balanceSnapshots.accountId, asOf: balanceSnapshots.asOf, balanceMinor: balanceSnapshots.balanceMinor, status: balanceSnapshots.status })
        .from(balanceSnapshots)
        .where(and(eq(balanceSnapshots.ownerId, ownerA), eq(balanceSnapshots.accountId, lifecycleAccountA2), eq(balanceSnapshots.asOf, "2026-08-19")));
      expect(archivedProjection).toEqual([{ accountId: lifecycleAccountA2, asOf: "2026-08-19", balanceMinor: 50000, status: "planned" }]);
      await repository.restoreBudget(ownerA, personalBudgetId);
      const restored = (await repository.getSummary(ownerA, 2026)).budgets.find((budget) => budget.id === personalBudgetId);
      expect(restored).toMatchObject({ isActive: true, linkedAccountId: lifecycleAccountA2 });
      expect(restored?.items[0]?.occurrence.payments).toEqual([expect.objectContaining({ amountMinor: 500, note: "Lifecycle payment" })]);

      expect((await repository.getSummary(ownerB, 2026)).budgets).toHaveLength(0);
      const auditRows = await tx.select({ action: auditEvents.action, metadata: auditEvents.metadata })
        .from(auditEvents)
        .where(and(eq(auditEvents.ownerId, ownerA), eq(auditEvents.entityType, "annual_budget")));
      expect(auditRows.map((row) => row.action)).toEqual(expect.arrayContaining(["created", "updated"]));
      expect(auditRows.some((row) => row.metadata.operation === "archive")).toBe(true);
      expect(auditRows.some((row) => row.metadata.operation === "restore")).toBe(true);

      throw rollbackMarker;
    }), rollbackMarker);

    expect(await database.select({ id: annualBudgets.id }).from(annualBudgets).where(eq(annualBudgets.ownerId, ownerA))).toHaveLength(0);
    expect(await database.select({ id: annualExpenses.id }).from(annualExpenses).where(eq(annualExpenses.ownerId, ownerA))).toHaveLength(0);
    expect(await database.select({ id: auditEvents.id }).from(auditEvents).where(eq(auditEvents.ownerId, ownerA))).toHaveLength(0);
  });

  it("allows duplicate annual-expense names on create and update with independent occurrences", async () => {
    if (!database) return;
    const duplicateOwner = "00000000-0000-0000-0000-0000000000e1";
    const duplicateInstitution = "10000000-0000-4000-8000-0000000000e1";
    const duplicateAccount = "20000000-0000-4000-8000-0000000000e1";
    const rollbackMarker = new Error("annual-expense duplicate-name integration rollback");

    await expect(database.transaction(async (tx) => {
      await tx.insert(users).values({ id: duplicateOwner, email: "annual-expense-duplicate-owner@athena-vault.local" });
      await tx.insert(institutions).values({ id: duplicateInstitution, ownerId: duplicateOwner, name: "Duplicate-name bank", currency: "CAD" });
      await tx.insert(accounts).values({ id: duplicateAccount, ownerId: duplicateOwner, institutionId: duplicateInstitution, name: "Duplicate-name reserve", kind: "checking", currency: "CAD" });

      const repository = createAnnualBudgetRepository(tx as unknown as Database);
      const mutations = createAnnualBudgetMutationRepository(tx as unknown as Database);
      const budgetId = await repository.createBudget(duplicateOwner, { name: "Duplicate-name budget", linkedAccountId: duplicateAccount });
      const firstId = await repository.createExpense(duplicateOwner, {
        budgetId,
        taxYear: 2026,
        name: "Costco",
        amountMinor: 12_000,
        dueMonth: 2,
        dueDay: 15,
      });
      const secondId = await repository.createExpense(duplicateOwner, {
        budgetId,
        taxYear: 2026,
        name: "Costco",
        amountMinor: 18_000,
        dueMonth: 8,
        dueDay: 20,
      });
      const updatedId = await repository.createExpense(duplicateOwner, {
        budgetId,
        taxYear: 2026,
        name: "Other reserve",
        amountMinor: 7_000,
        dueMonth: 10,
        dueDay: 5,
      });
      await repository.updateExpense(duplicateOwner, updatedId, {
        name: "Costco",
        amountMinor: 9_000,
        dueMonth: 12,
        dueDay: 31,
        fromYear: 2026,
      });

      const beforePayment = await repository.getSummary(duplicateOwner, 2026);
      const beforeItems = beforePayment.budgets.find((budget) => budget.id === budgetId)?.items ?? [];
      expect(beforeItems).toHaveLength(3);
      expect(beforeItems.map((item) => item.name)).toEqual(["Costco", "Costco", "Costco"]);

      const firstOccurrenceId = beforeItems.find((item) => item.id === firstId)?.occurrence.id;
      const secondOccurrenceId = beforeItems.find((item) => item.id === secondId)?.occurrence.id;
      if (!firstOccurrenceId || !secondOccurrenceId) throw new Error("Duplicate-name integration occurrences were not created.");
      await mutations.createPayment(duplicateOwner, {
        annualExpenseValueId: firstOccurrenceId,
        paymentOn: "2026-02-01",
        amountMinor: 7_000,
        note: "Costco paid",
      });
      const remainderTransfer = await mutations.moveRemainingToNext(duplicateOwner, { annualExpenseId: firstId, taxYear: 2026 });
      expect(remainderTransfer).toMatchObject({
        sourceAnnualExpenseId: firstId,
        targetAnnualExpenseId: secondId,
        sourceDueDate: "2026-02-15",
        targetDueDate: "2026-08-20",
        amountMovedMinor: 5_000,
      });
      await expect(mutations.moveRemainingToNext(ownerB, { annualExpenseId: firstId, taxYear: 2026 })).rejects.toThrow("not found");

      const budget = (await repository.getSummary(duplicateOwner, 2026)).budgets.find((item) => item.id === budgetId);
      const itemsById = new Map((budget?.items ?? []).map((item) => [item.id, item]));
      expect(itemsById.get(firstId)).toMatchObject({
        name: "Costco",
        amountMinor: 12_000,
        occurrence: { dueDate: "2026-02-15", plannedAmountMinor: 7_000, paidMinor: 7_000, remainingMinor: 0, status: "Paid" },
      });
      expect(itemsById.get(secondId)).toMatchObject({
        name: "Costco",
        amountMinor: 18_000,
        occurrence: { dueDate: "2026-08-20", plannedAmountMinor: 23_000, paidMinor: 0, remainingMinor: 23_000, status: "Unpaid" },
      });
      expect(itemsById.get(updatedId)).toMatchObject({
        name: "Costco",
        amountMinor: 9_000,
        occurrence: { dueDate: "2026-12-31", paidMinor: 0, status: "Unpaid" },
      });
      const remainderAudits = await tx.select({ metadata: auditEvents.metadata })
        .from(auditEvents)
        .where(and(eq(auditEvents.ownerId, duplicateOwner), eq(auditEvents.entityType, "annual_expense_remainder_transfer")));
      expect(remainderAudits).toEqual([expect.objectContaining({ metadata: expect.objectContaining({
        operation: "annual_expense_remainder_transfer",
        sourceAnnualExpenseId: firstId,
        targetAnnualExpenseId: secondId,
        amountMovedMinor: 5_000,
      }) })]);

      throw rollbackMarker;
    })).rejects.toThrow(rollbackMarker.message);

    expect(await database.select({ id: users.id }).from(users).where(eq(users.id, duplicateOwner))).toHaveLength(0);
  });

  it("rejects duplicate active names, assigned accounts, cross-owner links, and unavailable restore accounts", async () => {
    if (!database) return;
    const conflictOwnerA = "00000000-0000-0000-0000-0000000000d1";
    const conflictOwnerB = "00000000-0000-0000-0000-0000000000d2";
    const conflictInstitutionA = "10000000-0000-4000-8000-0000000000d1";
    const conflictInstitutionB = "10000000-0000-4000-8000-0000000000d2";
    const conflictAccountA1 = "20000000-0000-4000-8000-0000000000d1";
    const conflictAccountA2 = "20000000-0000-4000-8000-0000000000d2";
    const conflictAccountA3 = "20000000-0000-4000-8000-0000000000d3";
    const conflictAccountB = "20000000-0000-4000-8000-0000000000d4";

    try {
      await database.insert(users).values([
        { id: conflictOwnerA, email: "annual-budget-conflict-owner-a@athena-vault.local" },
        { id: conflictOwnerB, email: "annual-budget-conflict-owner-b@athena-vault.local" },
      ]);
      await database.insert(institutions).values([
        { id: conflictInstitutionA, ownerId: conflictOwnerA, name: "Conflict bank A", currency: "CAD" },
        { id: conflictInstitutionB, ownerId: conflictOwnerB, name: "Conflict bank B", currency: "CAD" },
      ]);
      await database.insert(accounts).values([
        { id: conflictAccountA1, ownerId: conflictOwnerA, institutionId: conflictInstitutionA, name: "Conflict A1", kind: "checking", currency: "CAD" },
        { id: conflictAccountA2, ownerId: conflictOwnerA, institutionId: conflictInstitutionA, name: "Conflict A2", kind: "checking", currency: "CAD" },
        { id: conflictAccountA3, ownerId: conflictOwnerA, institutionId: conflictInstitutionA, name: "Conflict A3", kind: "checking", currency: "CAD" },
        { id: conflictAccountB, ownerId: conflictOwnerB, institutionId: conflictInstitutionB, name: "Conflict B", kind: "checking", currency: "CAD" },
      ]);

      const repository = createAnnualBudgetRepository(database);
      const firstBudgetId = await repository.createBudget(conflictOwnerA, { name: "Conflict budget", linkedAccountId: conflictAccountA1 });
      const secondBudgetId = await repository.createBudget(conflictOwnerA, { name: "Second conflict", linkedAccountId: conflictAccountA2 });
      await expect(repository.createBudget(conflictOwnerA, { name: "Conflict budget", linkedAccountId: conflictAccountA3 })).rejects.toThrow("name is already in use");
      await expect(repository.createBudget(conflictOwnerA, { name: "Third conflict", linkedAccountId: conflictAccountA1 })).rejects.toThrow("already assigned");
      await expect(repository.createBudget(conflictOwnerA, { name: "Cross-owner conflict", linkedAccountId: conflictAccountB })).rejects.toThrow("linked account not found");
      await expect(repository.relinkBudget(conflictOwnerA, firstBudgetId, conflictAccountA2)).rejects.toThrow("already assigned");

      await repository.archiveBudget(conflictOwnerA, firstBudgetId);
      const replacementBudgetId = await repository.createBudget(conflictOwnerA, { name: "Conflict budget", linkedAccountId: conflictAccountA1 });
      expect(replacementBudgetId).not.toBe(firstBudgetId);
      await expect(repository.restoreBudget(conflictOwnerA, firstBudgetId)).rejects.toThrow("already assigned");
      expect(secondBudgetId).toBeTruthy();
    } finally {
      await database.delete(users).where(inArray(users.id, [conflictOwnerA, conflictOwnerB]));
    }
  });
});
