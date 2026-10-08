import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, lte, or } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type Database } from "./client";
import { createAccountRepository } from "./drizzle-repositories";
import { createAccountTimelineRepository } from "./repositories/account-timeline";
import { createCashFlowRepository } from "./repositories/cash-flow";
import { createHouseholdRepository } from "./repositories/household";
import { createOwnerRepository } from "./repositories/owner";
import { accountBalanceNotes, accountGroups, accounts, auditEvents, balanceSnapshots, cashFlowPaydayChecks, cashFlowPeriods, householdExpenses, importBatches, institutions, recurringCashFlowOccurrenceExceptions, recurringCashFlowSeries, recurringTransactions, sourceReferences, transactions, transfers, users } from "./drizzle-schema";
import { addIsoDays } from "./account-contributions";
import { adjustRecurringCashFlowWeekday } from "./recurring-cash-flow";
import { expectIntegrationRollback } from "./integration-test-helpers";
import { toTorontoDateIso } from "./account-timeline";

const connectionString = process.env.DATABASE_URL;
const database = connectionString ? createDatabase(connectionString) : undefined;
const ownerA = "00000000-0000-0000-0000-0000000000ba";
const ownerB = "00000000-0000-0000-0000-0000000000bb";
const ownerAEmail = "annual-maintenance-owner-a@athena-vault.local";
const ownerBEmail = "annual-maintenance-owner-b@athena-vault.local";

describe.skipIf(!database)("owner repository", () => {
  it("updates one owner's display name and audits without identity metadata", async () => {
    if (!database) return;
    const displayNameOwnerA = "00000000-0000-0000-0000-0000000000bc";
    const displayNameOwnerB = "00000000-0000-0000-0000-0000000000bd";
    const rollbackMarker = new Error("owner display-name integration rollback");

    await expect(database.transaction(async (tx) => {
      await tx.insert(users).values([
        { id: displayNameOwnerA, email: "owner-display-name-a@athena-vault.local", createdAt: new Date("2000-01-01T00:00:00.000Z") },
        { id: displayNameOwnerB, email: "owner-display-name-b@athena-vault.local", createdAt: new Date("2000-01-01T00:01:00.000Z") },
      ]);

      const repository = createOwnerRepository(tx as unknown as Database);
      const updated = await repository.updateDisplayName(displayNameOwnerA, "  Jack & Julie  ");
      expect(updated).toMatchObject({ id: displayNameOwnerA, displayName: "Jack & Julie" });

      const rows = await tx.select({ id: users.id, email: users.email, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, [displayNameOwnerA, displayNameOwnerB]));
      expect(rows).toEqual(expect.arrayContaining([
        { id: displayNameOwnerA, email: "owner-display-name-a@athena-vault.local", displayName: "Jack & Julie" },
        { id: displayNameOwnerB, email: "owner-display-name-b@athena-vault.local", displayName: null },
      ]));

      const audits = await tx.select({ ownerId: auditEvents.ownerId, entityType: auditEvents.entityType, entityId: auditEvents.entityId, action: auditEvents.action, metadata: auditEvents.metadata })
        .from(auditEvents)
        .where(and(eq(auditEvents.ownerId, displayNameOwnerA), eq(auditEvents.entityId, displayNameOwnerA)));
      expect(audits).toEqual([{ ownerId: displayNameOwnerA, entityType: "owner", entityId: displayNameOwnerA, action: "updated", metadata: { operation: "display_name_update" } }]);
      expect(audits[0]?.metadata).not.toHaveProperty("email");
      expect(audits[0]?.metadata).not.toHaveProperty("oldDisplayName");
      expect(audits[0]?.metadata).not.toHaveProperty("newDisplayName");

      await expect(repository.updateDisplayName(displayNameOwnerB, "Household B")).resolves.toMatchObject({ id: displayNameOwnerB, displayName: "Household B" });
      expect(await tx.select({ displayName: users.displayName }).from(users).where(eq(users.id, displayNameOwnerA))).toEqual([{ displayName: "Jack & Julie" }]);

      throw rollbackMarker;
    })).rejects.toThrow(rollbackMarker.message);
  });
});

describe.skipIf(!database)("household annual-maintenance repository", () => {
  it("lists, mutates, isolates, and synchronizes all supported frequencies transactionally", async () => {
    if (!database) return;
    const rollbackMarker = new Error("annual-maintenance integration rollback");

    await expect(database.transaction(async (tx) => {
      await tx.insert(users).values([
        { id: ownerA, email: ownerAEmail },
        { id: ownerB, email: ownerBEmail },
      ]);
      await tx.insert(householdExpenses).values({
        ownerId: ownerA,
        name: "Annual maintenance",
        category: "annual-maintenance",
        frequency: "monthly",
        amountMinor: 0,
        annualAmountMinor: 0,
        currency: "CAD",
      });

      const household = createHouseholdRepository(tx as unknown as Database);
      expect(await household.listMaintenanceItems(ownerA)).toHaveLength(0);
      expect(await household.getMaintenanceSummary(ownerA)).toMatchObject({ amountMinor: 0, annualAmountMinor: 0 });

      const weekly = await household.createMaintenanceItem(ownerA, { name: "Snow clearing", amountMinor: 100, frequency: "weekly" });
      expect(weekly.item).toMatchObject({ amountMinor: 100, frequency: "weekly", annualizedAmountMinor: 5200 });
      expect(weekly.summary).toMatchObject({ amountMinor: 433, annualAmountMinor: 5200 });

      const biweekly = await household.createMaintenanceItem(ownerA, { name: "Yard service", amountMinor: 200, frequency: "biweekly" });
      expect(biweekly.item).toMatchObject({ amountMinor: 200, frequency: "biweekly", annualizedAmountMinor: 5200 });
      expect(biweekly.summary).toMatchObject({ amountMinor: 867, annualAmountMinor: 10400 });

      const monthly = await household.createMaintenanceItem(ownerA, { name: "Filter replacement", amountMinor: 300, frequency: "monthly" });
      expect(monthly.item).toMatchObject({ amountMinor: 300, frequency: "monthly", annualizedAmountMinor: 3600 });
      expect(monthly.summary).toMatchObject({ amountMinor: 1167, annualAmountMinor: 14000 });

      const annual = await household.createMaintenanceItem(ownerA, { name: "Surplus reserve", amountMinor: 400, frequency: "annual" });
      expect(annual.item).toMatchObject({ amountMinor: 400, frequency: "annual", annualizedAmountMinor: 400 });
      expect(annual.summary).toMatchObject({ amountMinor: 1200, annualAmountMinor: 14400 });

      const listed = await household.listMaintenanceItems(ownerA);
      expect(listed).toHaveLength(4);
      expect(listed.reduce((total, item) => total + item.annualizedAmountMinor, 0)).toBe(14400);

      const updated = await household.updateMaintenanceItem(ownerA, weekly.item!.id, { name: "Snow clearing updated", amountMinor: 46000, frequency: "annual" });
      expect(updated.item).toMatchObject({ name: "Snow clearing updated", amountMinor: 46000, frequency: "annual", annualizedAmountMinor: 46000 });
      expect(updated.summary).toMatchObject({ amountMinor: 4600, annualAmountMinor: 55200 });

      await expect(household.createMaintenanceItem(ownerA, { name: "Yard service", amountMinor: 1, frequency: "annual" }))
        .rejects.toThrow("already exists");
      await expect(household.updateMaintenanceItem(ownerB, annual.item!.id, { name: "Other owner", amountMinor: 1, frequency: "annual" }))
        .rejects.toThrow("not found");
      await expect(household.deleteMaintenanceItem(ownerB, annual.item!.id)).rejects.toThrow("not found");

      const deleted = await household.deleteMaintenanceItem(ownerA, biweekly.item!.id);
      expect(deleted.summary).toMatchObject({ amountMinor: 4167, annualAmountMinor: 50000 });
      expect(await household.listMaintenanceItems(ownerA)).toHaveLength(3);

      await expect(household.createMaintenanceItem(ownerB, { name: "Uncommitted", amountMinor: 100, frequency: "annual" }))
        .rejects.toThrow("summary not found");
      const ownerBItems = await household.listMaintenanceItems(ownerB);
      expect(ownerBItems).toHaveLength(0);

      const ownerAExpenseRows = await tx.select({ name: householdExpenses.name, amountMinor: householdExpenses.amountMinor, annualAmountMinor: householdExpenses.annualAmountMinor })
        .from(householdExpenses)
        .where(and(eq(householdExpenses.ownerId, ownerA), eq(householdExpenses.name, "Annual maintenance")));
      expect(ownerAExpenseRows).toHaveLength(1);
      expect(ownerAExpenseRows[0]).toMatchObject({ amountMinor: 4167, annualAmountMinor: 50000 });

      throw rollbackMarker;
    })).rejects.toThrow(rollbackMarker.message);
  });
});

describe.skipIf(!database)("cash-flow projection reads", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-19T16:00:00.000Z"));
  });

  afterEach(() => vi.useRealTimers());

  it("returns owner-scoped inclusion settings and Actual/manual anchors without generated rows", async () => {
    if (!database) return;
    const cashFlowOwnerA = "00000000-0000-0000-0000-0000000000bc";
    const cashFlowOwnerB = "00000000-0000-0000-0000-0000000000bd";
    const cashFlowInstitutionA = "10000000-0000-4000-8000-0000000000bc";
    const cashFlowInstitutionB = "10000000-0000-4000-8000-0000000000bd";
    const cashFlowAccountA = "20000000-0000-4000-8000-0000000000bc";
    const cashFlowAccountB = "20000000-0000-4000-8000-0000000000bd";
    const cashFlowAccountAReserve = "20000000-0000-4000-8000-0000000000be";
    const cashFlowPeriodA = "30000000-0000-4000-8000-0000000000bc";
    const cashFlowPeriodANext = "30000000-0000-4000-8000-0000000000be";
    const cashFlowPeriodB = "30000000-0000-4000-8000-0000000000bd";
    const cashFlowAnchor = "40000000-0000-4000-8000-0000000000bc";
    const cashFlowManualAnchor = "40000000-0000-4000-8000-0000000000bd";
    const cashFlowGenerated = "40000000-0000-4000-8000-0000000000be";
    const cashFlowTransaction = "50000000-0000-4000-8000-0000000000bc";
    const cashFlowExcludedExpense = "50000000-0000-4000-8000-0000000000bd";
    const cashFlowTransfer = "50000000-0000-4000-8000-0000000000be";
    const cashFlowRecurringExpense = "60000000-0000-4000-8000-0000000000bc";
    const rollbackMarker = new Error("cash-flow projection reads rollback");

    await expectIntegrationRollback(database.transaction(async (tx) => {
      await tx.insert(users).values([
        { id: cashFlowOwnerA, email: "cash-flow-read-owner-a@athena-vault.local" },
        { id: cashFlowOwnerB, email: "cash-flow-read-owner-b@athena-vault.local" },
      ]);
      await tx.insert(institutions).values([
        { id: cashFlowInstitutionA, ownerId: cashFlowOwnerA, name: "Cash-flow bank A", currency: "CAD" },
        { id: cashFlowInstitutionB, ownerId: cashFlowOwnerB, name: "Cash-flow bank B", currency: "CAD" },
      ]);
      await tx.insert(accounts).values([
        { id: cashFlowAccountA, ownerId: cashFlowOwnerA, institutionId: cashFlowInstitutionA, name: "Cash-flow A", kind: "checking", includeInAvailableCash: true, currency: "CAD" },
        { id: cashFlowAccountB, ownerId: cashFlowOwnerB, institutionId: cashFlowInstitutionB, name: "Cash-flow B", kind: "checking", includeInAvailableCash: false, currency: "CAD" },
        { id: cashFlowAccountAReserve, ownerId: cashFlowOwnerA, institutionId: cashFlowInstitutionA, name: "Cash-flow A reserve", kind: "savings", includeInAvailableCash: false, currency: "CAD" },
      ]);
      await tx.insert(cashFlowPeriods).values([
        { id: cashFlowPeriodA, ownerId: cashFlowOwnerA, label: "Cash-flow period A", startsOn: "2026-08-06", endsOn: "2026-08-19", payDate: "2026-08-19", currency: "CAD" },
        { id: cashFlowPeriodANext, ownerId: cashFlowOwnerA, label: "Cash-flow period A next", startsOn: "2026-08-20", endsOn: "2026-09-02", payDate: "2026-09-02", currency: "CAD" },
        { id: cashFlowPeriodB, ownerId: cashFlowOwnerB, label: "Cash-flow period B", startsOn: "2026-08-06", endsOn: "2026-08-19", payDate: "2026-08-19", currency: "CAD" },
      ]);
      await tx.insert(balanceSnapshots).values([
        { id: cashFlowAnchor, ownerId: cashFlowOwnerA, accountId: cashFlowAccountA, asOf: "2026-08-05", balanceMinor: 10000, status: "actual", isGenerated: false, currency: "CAD" },
        { id: cashFlowManualAnchor, ownerId: cashFlowOwnerA, accountId: cashFlowAccountA, asOf: "2026-08-19", balanceMinor: 12000, status: "planned", isGenerated: false, currency: "CAD" },
        { id: cashFlowGenerated, ownerId: cashFlowOwnerA, accountId: cashFlowAccountA, asOf: "2026-09-02", balanceMinor: 13000, status: "planned", isGenerated: true, currency: "CAD" },
      ]);
      await tx.insert(recurringCashFlowSeries).values({ id: cashFlowRecurringExpense, ownerId: cashFlowOwnerA, kind: "expense", state: "active" });
      await tx.insert(recurringTransactions).values({ id: cashFlowRecurringExpense, ownerId: cashFlowOwnerA, seriesId: cashFlowRecurringExpense, accountId: cashFlowAccountA, kind: "expense", frequency: "biweekly", description: "Cash-flow recurring expense", amountMinor: 500, startsOn: "2026-08-10", effectiveFrom: "2026-08-10", nextOccurrenceOn: "2026-08-10", currency: "CAD" });
      await tx.insert(transactions).values([
        { id: cashFlowTransaction, ownerId: cashFlowOwnerA, accountId: cashFlowAccountA, periodId: cashFlowPeriodA, transactionDate: "2026-08-10", kind: "income", status: "planned", description: "Cash-flow income", amountMinor: 200, currency: "CAD" },
        { id: cashFlowExcludedExpense, ownerId: cashFlowOwnerA, accountId: cashFlowAccountA, periodId: cashFlowPeriodA, recurringTransactionId: cashFlowRecurringExpense, transactionDate: "2026-08-11", kind: "expense", status: "planned", isExcluded: true, description: "Cash-flow excluded expense", amountMinor: 500, currency: "CAD" },
      ]);
      await tx.insert(transfers).values({
        id: cashFlowTransfer,
        ownerId: cashFlowOwnerA,
        periodId: cashFlowPeriodA,
        fromAccountId: cashFlowAccountA,
        toAccountId: cashFlowAccountAReserve,
        transferDate: "2026-08-12",
        amountMinor: 50,
        currency: "CAD",
        status: "planned",
        description: "Cash-flow transfer",
      });

      const beforeCount = (await tx.select({ id: balanceSnapshots.id }).from(balanceSnapshots).where(eq(balanceSnapshots.ownerId, cashFlowOwnerA))).length;
      const repository = createCashFlowRepository(tx as unknown as Database);
      const window = await repository.getPeriodWindow(cashFlowOwnerA, { selectedPeriodId: cashFlowPeriodA, pastPeriods: 0, futurePeriods: 1 });
      expect(window.accounts).toEqual(expect.arrayContaining([expect.objectContaining({ id: cashFlowAccountA, includeInAvailableCash: true, isVisibleInCashFlow: true })]));
      await repository.setCashFlowAccountVisibility(cashFlowOwnerA, cashFlowAccountA, false);
      expect((await repository.getPeriodWindow(cashFlowOwnerA, { selectedPeriodId: cashFlowPeriodA, pastPeriods: 0, futurePeriods: 0 })).accounts).toEqual(expect.arrayContaining([expect.objectContaining({ id: cashFlowAccountA, isVisibleInCashFlow: false })]));
      await expect(repository.setCashFlowAccountVisibility(cashFlowOwnerB, cashFlowAccountA, true)).rejects.toThrow("Cash-flow account is not active.");
      await repository.setCashFlowAccountVisibility(cashFlowOwnerA, cashFlowAccountA, true);
      expect(window.anchors.map((anchor) => anchor.id)).toEqual([cashFlowAnchor, cashFlowManualAnchor]);
      expect(window.anchors.some((anchor) => anchor.id === cashFlowGenerated)).toBe(false);
      expect(window.periods).toHaveLength(2);
      expect(window.periods[0]?.transactions).toMatchObject([{ id: cashFlowTransaction, accountId: cashFlowAccountA }]);
      expect(window.projectionTransactions).toEqual([]);
      expect(window.projectionTransfers).toEqual([]);
      const compactWindow = await repository.getPeriodWindow(cashFlowOwnerA, { selectedPeriodId: cashFlowPeriodANext, pastPeriods: 0, futurePeriods: 0 });
      expect(compactWindow.periods.map((period) => period.period.id)).toEqual([cashFlowPeriodANext]);
      expect(compactWindow.currentPeriodId).toBe(cashFlowPeriodA);
      expect(compactWindow.currentPeriodPayDate).toBe("2026-08-19");
      expect(compactWindow.projectionTransactions).toEqual([]);
      expect(compactWindow.projectionTransfers).toEqual([]);
      expect(new Set(compactWindow.projectionTransactions.map((transaction) => transaction.id)).size).toBe(compactWindow.projectionTransactions.length);
      expect(new Set(compactWindow.projectionTransfers.map((transfer) => transfer.id)).size).toBe(compactWindow.projectionTransfers.length);
      expect(await repository.listExcludedExpenses(cashFlowOwnerA)).toMatchObject([{
        id: cashFlowExcludedExpense,
        recurringTransactionId: cashFlowRecurringExpense,
        description: "Cash-flow excluded expense",
      }]);
      expect(await repository.listExcludedExpenses(cashFlowOwnerB)).toEqual([]);
      await expect(repository.restoreExpenseTransaction(cashFlowOwnerB, cashFlowExcludedExpense)).rejects.toThrow("Excluded cash-flow expense not found.");
      await repository.restoreExpenseTransaction(cashFlowOwnerA, cashFlowExcludedExpense);
      expect((await tx.select({ id: transactions.id, isExcluded: transactions.isExcluded, recurringTransactionId: transactions.recurringTransactionId }).from(transactions).where(eq(transactions.id, cashFlowExcludedExpense)))[0]).toEqual({ id: cashFlowExcludedExpense, isExcluded: false, recurringTransactionId: cashFlowRecurringExpense });
      expect((await repository.getPeriodData(cashFlowOwnerA, cashFlowPeriodA))?.transactions).toEqual(expect.arrayContaining([expect.objectContaining({ id: cashFlowExcludedExpense, recurringTransactionId: cashFlowRecurringExpense })]));
      expect(await repository.listExcludedExpenses(cashFlowOwnerA)).toEqual([]);
      const restoreAudit = await tx.select({ metadata: auditEvents.metadata }).from(auditEvents).where(and(eq(auditEvents.ownerId, cashFlowOwnerA), eq(auditEvents.entityId, cashFlowExcludedExpense))).orderBy(auditEvents.createdAt);
      expect(restoreAudit.at(-1)?.metadata).toMatchObject({ operation: "cash_flow_expense_restore" });
      const afterCount = (await tx.select({ id: balanceSnapshots.id }).from(balanceSnapshots).where(eq(balanceSnapshots.ownerId, cashFlowOwnerA))).length;
      expect(afterCount).toBe(beforeCount);
      const movedTransaction = {
        accountId: cashFlowAccountA,
        recurringTransactionId: null,
        transactionDate: "2026-08-21",
        description: "Cash-flow income moved",
        category: null,
        amountMinor: 200,
        status: "planned" as const,
        scope: "current" as const,
      };
      await expect(repository.updateTransaction(cashFlowOwnerB, cashFlowTransaction, movedTransaction)).rejects.toThrow("Cash-flow transaction not found.");
      await expect(repository.updateTransaction(cashFlowOwnerA, cashFlowTransaction, { ...movedTransaction, transactionDate: "2030-01-01" })).rejects.toThrow("Cash-flow date is outside an owner period.");
      await repository.updateTransaction(cashFlowOwnerA, cashFlowTransaction, movedTransaction);
      const movedTransfer = {
        fromAccountId: cashFlowAccountA,
        toAccountId: cashFlowAccountAReserve,
        transferDate: "2026-08-22",
        description: "Cash-flow transfer moved",
        amountMinor: 50,
        status: "planned" as const,
      };
      await expect(repository.updateTransfer(cashFlowOwnerB, cashFlowTransfer, movedTransfer)).rejects.toThrow("Cash-flow transfer not found.");
      await repository.updateTransfer(cashFlowOwnerA, cashFlowTransfer, movedTransfer);
      const oldPeriodAfterDateEdits = await repository.getPeriodData(cashFlowOwnerA, cashFlowPeriodA);
      const newPeriodAfterDateEdits = await repository.getPeriodData(cashFlowOwnerA, cashFlowPeriodANext);
      expect(oldPeriodAfterDateEdits?.transactions.some((transaction) => transaction.id === cashFlowTransaction)).toBe(false);
      expect(oldPeriodAfterDateEdits?.transfers.some((transfer) => transfer.id === cashFlowTransfer)).toBe(false);
      expect(newPeriodAfterDateEdits?.transactions.filter((transaction) => transaction.id === cashFlowTransaction)).toHaveLength(1);
      expect(newPeriodAfterDateEdits?.transfers.filter((transfer) => transfer.id === cashFlowTransfer)).toHaveLength(1);
      expect((await repository.getPeriodWindow(cashFlowOwnerB, { selectedPeriodId: cashFlowPeriodB })).accounts).toMatchObject([{ id: cashFlowAccountB, includeInAvailableCash: false }]);
      expect((await repository.getPeriodWindow(cashFlowOwnerB, { selectedPeriodId: cashFlowPeriodB })).anchors).toEqual([]);

      await repository.createCashFlowTransaction(cashFlowOwnerA, {
        periodId: cashFlowPeriodA,
        accountId: cashFlowAccountA,
        kind: "expense",
        transactionDate: "2026-08-20",
        description: "One-period expense",
        amountMinor: 1250,
      });
      expect((await tx.select({ periodId: transactions.periodId, accountId: transactions.accountId, transactionDate: transactions.transactionDate, description: transactions.description }).from(transactions).where(and(eq(transactions.ownerId, cashFlowOwnerA), eq(transactions.description, "One-period expense"))))).toEqual([{ periodId: cashFlowPeriodA, accountId: cashFlowAccountA, transactionDate: "2026-08-20", description: "One-period expense" }]);
      await expect(repository.createCashFlowTransaction(cashFlowOwnerA, {
        periodId: cashFlowPeriodA,
        accountId: cashFlowAccountA,
        kind: "expense",
        transactionDate: "2026-09-02",
        description: "Outside period",
        amountMinor: 100,
      })).rejects.toThrow("inside the selected Cash-flow period");

      throw rollbackMarker;
    }), rollbackMarker);
  });

  it("records observed payday anchors, preserves manual anchors, and rejects ambiguous setup", async () => {
    if (!database) return;
    const owner = "00000000-0000-4000-8000-0000000000ca";
    const institution = "10000000-0000-4000-8000-0000000000ca";
    const account = "20000000-0000-4000-8000-0000000000ca";
    const reserve = "20000000-0000-4000-8000-0000000000cb";
    const previousPeriod = "30000000-0000-4000-8000-0000000000ca";
    const currentPeriod = "30000000-0000-4000-8000-0000000000cb";
    const nextPeriod = "30000000-0000-4000-8000-0000000000cc";
    const openingSnapshot = "40000000-0000-4000-8000-0000000000ca";
    const importedSnapshot = "40000000-0000-4000-8000-0000000000cb";
    const manualSnapshot = "40000000-0000-4000-8000-0000000000cc";
    const importBatch = "50000000-0000-4000-8000-0000000000ca";
    const rollbackMarker = new Error("observed payday anchor rollback");
    const todayIso = toTorontoDateIso();
    const previousPayday = addIsoDays(todayIso, -14);
    const nextPayday = addIsoDays(todayIso, 14);

    await expect(database.transaction(async (tx) => {
      await tx.insert(users).values({ id: owner, email: "observed-payday-owner@athena-vault.local" });
      await tx.insert(institutions).values({ id: institution, ownerId: owner, name: "Observed payday bank", currency: "CAD" });
      await tx.insert(accounts).values([
        { id: account, ownerId: owner, institutionId: institution, name: "Observed checking", kind: "checking", includeInAvailableCash: true, currency: "CAD" },
        { id: reserve, ownerId: owner, institutionId: institution, name: "Observed reserve", kind: "savings", includeInAvailableCash: false, currency: "CAD" },
      ]);
      await tx.insert(cashFlowPeriods).values([
        { id: previousPeriod, ownerId: owner, label: "Observed previous payday", startsOn: previousPayday, endsOn: addIsoDays(todayIso, -1), payDate: previousPayday, currency: "CAD" },
        { id: currentPeriod, ownerId: owner, label: "Observed current payday", startsOn: todayIso, endsOn: addIsoDays(nextPayday, -1), payDate: todayIso, currency: "CAD" },
        { id: nextPeriod, ownerId: owner, label: "Observed next payday", startsOn: nextPayday, endsOn: addIsoDays(nextPayday, 13), payDate: nextPayday, currency: "CAD" },
      ]);
      await tx.insert(importBatches).values({
        id: importBatch,
        ownerId: owner,
        sourceFile: "observed-payday-test.xlsx",
        sourceFingerprint: "f".repeat(64),
        schemaVersion: "observed-payday-test",
        status: "dry_run",
        sourceSheetCount: 1,
        sourceCellCount: 1,
        sourceFormulaCount: 0,
      });
      await tx.insert(balanceSnapshots).values([
        { id: openingSnapshot, ownerId: owner, accountId: account, asOf: addIsoDays(previousPayday, -1), balanceMinor: 200000, status: "actual", isGenerated: false, currency: "CAD" },
        { id: importedSnapshot, ownerId: owner, accountId: account, asOf: todayIso, balanceMinor: 250000, status: "actual", isGenerated: false, currency: "CAD" },
        { id: manualSnapshot, ownerId: owner, accountId: account, asOf: nextPayday, balanceMinor: 300000, status: "planned", isGenerated: false, currency: "CAD" },
      ]);
      await tx.insert(sourceReferences).values({
        ownerId: owner,
        importBatchId: importBatch,
        recordType: "balance_snapshot",
        recordId: importedSnapshot,
        sheetName: "Cash Flow",
        sourceAddress: "B2",
        mappingStatus: "imported",
      });

      const repository = createCashFlowRepository(tx as unknown as Database);
      const timelineRepository = createAccountTimelineRepository(tx as unknown as Database);
      await expect(timelineRepository.upsertBalanceSnapshot(owner, account, { asOf: todayIso, balanceMinor: 215000, status: "actual" })).rejects.toThrow("Use Cash Flow Payday Check");
      await expect(repository.recordCashFlowPaydayBalance(owner, { accountId: account, asOf: nextPayday, balanceMinor: 215000 })).rejects.toThrow("today or an earlier payday");
      await repository.recordCashFlowPaydayBalance(owner, { accountId: account, asOf: todayIso, balanceMinor: 215000, note: "Rent cleared later than expected" });
      expect(await tx.select({ projectedBalanceMinor: cashFlowPaydayChecks.projectedBalanceMinor, actualBalanceMinor: cashFlowPaydayChecks.actualBalanceMinor })
        .from(cashFlowPaydayChecks)
        .where(and(eq(cashFlowPaydayChecks.ownerId, owner), eq(cashFlowPaydayChecks.accountId, account), eq(cashFlowPaydayChecks.payDate, todayIso))))
        .toEqual([{ projectedBalanceMinor: 200000, actualBalanceMinor: 215000 }]);
      await repository.recordCashFlowPaydayBalance(owner, { accountId: account, asOf: todayIso, balanceMinor: 217500, note: "Corrected after the bank settled" });
      await repository.updateCashFlowPaydayNote(owner, { accountId: account, asOf: todayIso, note: "Final reconciliation note" });
      await expect(timelineRepository.upsertBalanceSnapshot(owner, account, { asOf: todayIso, balanceMinor: 218000, status: "actual" })).rejects.toThrow("Use Cash Flow Payday Check");
      expect(await tx.select({ projectedBalanceMinor: cashFlowPaydayChecks.projectedBalanceMinor, actualBalanceMinor: cashFlowPaydayChecks.actualBalanceMinor })
        .from(cashFlowPaydayChecks)
        .where(and(eq(cashFlowPaydayChecks.ownerId, owner), eq(cashFlowPaydayChecks.accountId, account), eq(cashFlowPaydayChecks.payDate, todayIso))))
        .toEqual([{ projectedBalanceMinor: 200000, actualBalanceMinor: 217500 }]);
      expect(await tx.select({ accountId: accountBalanceNotes.accountId, asOf: accountBalanceNotes.asOf, note: accountBalanceNotes.note }).from(accountBalanceNotes).where(and(eq(accountBalanceNotes.ownerId, owner), eq(accountBalanceNotes.accountId, account), eq(accountBalanceNotes.asOf, todayIso))))
        .toEqual([{ accountId: account, asOf: todayIso, note: "Final reconciliation note" }]);
      const window = await repository.getPeriodWindow(owner, { selectedPeriodId: currentPeriod, pastPeriods: 1, futurePeriods: 1 });
      expect(window.anchors).toEqual(expect.arrayContaining([expect.objectContaining({ accountId: account, asOf: todayIso, balanceMinor: 217500, status: "actual", isGenerated: false })]));
      expect(window.paydayChecks).toEqual(expect.arrayContaining([expect.objectContaining({ accountId: account, payDate: todayIso, note: "Final reconciliation note" })]));
      const timelineAfterRecord = await createAccountTimelineRepository(tx as unknown as Database).getTimeline(owner, { selectedDate: todayIso });
      expect(timelineAfterRecord.accounts.find((entry) => entry.id === account)?.selectedSnapshot).toMatchObject({ asOf: todayIso, balanceMinor: 217500, status: "actual", isGenerated: false, note: "Final reconciliation note" });
      const snapshotsAfterRecord = await tx.select({ asOf: balanceSnapshots.asOf, balanceMinor: balanceSnapshots.balanceMinor, status: balanceSnapshots.status, isGenerated: balanceSnapshots.isGenerated }).from(balanceSnapshots).where(and(eq(balanceSnapshots.ownerId, owner), eq(balanceSnapshots.accountId, account)));
      expect(snapshotsAfterRecord).toEqual(expect.arrayContaining([
        { asOf: addIsoDays(previousPayday, -1), balanceMinor: 200000, status: "actual", isGenerated: false },
        { asOf: todayIso, balanceMinor: 250000, status: "actual", isGenerated: false },
        { asOf: nextPayday, balanceMinor: 300000, status: "planned", isGenerated: false },
      ]));

      await tx.update(accounts).set({ includeInAvailableCash: true }).where(and(eq(accounts.ownerId, owner), eq(accounts.id, reserve)));
      await expect(repository.recordCashFlowPaydayBalance(owner, { accountId: account, asOf: todayIso, balanceMinor: 215000 })).rejects.toThrow("exactly one active account");
      await tx.update(accounts).set({ includeInAvailableCash: false }).where(and(eq(accounts.ownerId, owner), eq(accounts.id, reserve)));
      await timelineRepository.upsertBalanceSnapshot(owner, reserve, { asOf: todayIso, balanceMinor: 123400, status: "actual", note: "Reserve buffer was used" });
      const reserveTimeline = await timelineRepository.getTimeline(owner, { selectedDate: todayIso });
      expect(reserveTimeline.accounts.find((entry) => entry.id === reserve)?.selectedSnapshot).toMatchObject({ note: "Reserve buffer was used" });
      await timelineRepository.updateAccountBalanceNote(owner, { accountId: reserve, asOf: todayIso, note: null });
      expect(await tx.select({ id: accountBalanceNotes.id }).from(accountBalanceNotes).where(and(eq(accountBalanceNotes.ownerId, owner), eq(accountBalanceNotes.accountId, reserve), eq(accountBalanceNotes.asOf, todayIso)))).toEqual([]);
      await repository.resetCashFlowPaydayBalance(owner, { accountId: account, asOf: todayIso });
      expect(await tx.select({ id: cashFlowPaydayChecks.id }).from(cashFlowPaydayChecks).where(eq(cashFlowPaydayChecks.ownerId, owner))).toEqual([]);
      expect(await tx.select({ note: accountBalanceNotes.note }).from(accountBalanceNotes).where(and(eq(accountBalanceNotes.ownerId, owner), eq(accountBalanceNotes.accountId, account), eq(accountBalanceNotes.asOf, todayIso)))).toEqual([{ note: "Final reconciliation note" }]);
      expect(await tx.select({ recordId: sourceReferences.recordId }).from(sourceReferences).where(and(eq(sourceReferences.ownerId, owner), eq(sourceReferences.recordId, importedSnapshot)))).toEqual([{ recordId: importedSnapshot }]);
      expect((await repository.getPeriodWindow(owner, { selectedPeriodId: currentPeriod, pastPeriods: 0, futurePeriods: 0 })).anchors).toEqual(expect.arrayContaining([expect.objectContaining({ accountId: account, asOf: todayIso, balanceMinor: 250000, status: "actual", isGenerated: false })]));
      const timelineAfterReset = await createAccountTimelineRepository(tx as unknown as Database).getTimeline(owner, { selectedDate: todayIso });
      expect(timelineAfterReset.accounts.find((entry) => entry.id === account)?.selectedSnapshot).toMatchObject({ asOf: todayIso, balanceMinor: 250000, status: "actual", isGenerated: false });

      throw rollbackMarker;
    })).rejects.toThrow(rollbackMarker.message);
  });
});

describe.skipIf(!database)("initial Cash Flow timeline repository", () => {
  it("keeps existing accounts visible and creates only empty planned periods", async () => {
    if (!database) return;
    const owner = "00000000-0000-4000-8000-0000000001a1";
    const institution = "10000000-0000-4000-8000-0000000001a1";
    const account = "20000000-0000-4000-8000-0000000001a1";
    const rollbackMarker = new Error("initial Cash Flow timeline rollback");

    await expect(database.transaction(async (tx) => {
      await tx.insert(users).values({ id: owner, email: "initial-timeline-owner@athena-vault.local" });
      await tx.insert(institutions).values({ id: institution, ownerId: owner, name: "Initial timeline bank", currency: "CAD" });
      await tx.insert(accounts).values({ id: account, ownerId: owner, institutionId: institution, name: "Initial checking", kind: "checking", currency: "CAD" });

      const repository = createCashFlowRepository(tx as unknown as Database);
      const emptyWindow = await repository.getPeriodWindow(owner);
      expect(emptyWindow.accounts).toEqual([expect.objectContaining({ id: account })]);
      expect(emptyWindow.totalPeriodCount).toBe(0);
      expect(emptyWindow.selectedPeriodId).toBeNull();

      const created = await repository.createInitialTimeline(owner, { firstPayday: "2099-01-01", throughDate: "2099-02-15" });
      expect(created).toEqual({ throughDate: "2099-02-15", periodsCreated: 4, snapshotsCreated: 0 });

      const periods = await tx.select({
        label: cashFlowPeriods.label,
        startsOn: cashFlowPeriods.startsOn,
        endsOn: cashFlowPeriods.endsOn,
        payDate: cashFlowPeriods.payDate,
        openingBalanceMinor: cashFlowPeriods.openingBalanceMinor,
        currency: cashFlowPeriods.currency,
        status: cashFlowPeriods.status,
      }).from(cashFlowPeriods).where(eq(cashFlowPeriods.ownerId, owner)).orderBy(asc(cashFlowPeriods.startsOn));
      expect(periods).toEqual([
        { label: "Pay period 2099-01-01", startsOn: "2098-12-19", endsOn: "2099-01-01", payDate: "2099-01-01", openingBalanceMinor: 0, currency: "CAD", status: "planned" },
        { label: "Pay period 2099-01-15", startsOn: "2099-01-02", endsOn: "2099-01-15", payDate: "2099-01-15", openingBalanceMinor: 0, currency: "CAD", status: "planned" },
        { label: "Pay period 2099-01-29", startsOn: "2099-01-16", endsOn: "2099-01-29", payDate: "2099-01-29", openingBalanceMinor: 0, currency: "CAD", status: "planned" },
        { label: "Pay period 2099-02-12", startsOn: "2099-01-30", endsOn: "2099-02-12", payDate: "2099-02-12", openingBalanceMinor: 0, currency: "CAD", status: "planned" },
      ]);
      expect(await tx.select({ id: balanceSnapshots.id }).from(balanceSnapshots).where(eq(balanceSnapshots.ownerId, owner))).toEqual([]);
      await expect(repository.createInitialTimeline(owner, { firstPayday: "2099-01-01", throughDate: "2099-02-15" })).rejects.toThrow("Cash Flow already has a timeline.");

      const audits = await tx.select({ action: auditEvents.action, entityType: auditEvents.entityType, entityId: auditEvents.entityId, metadata: auditEvents.metadata })
        .from(auditEvents).where(eq(auditEvents.ownerId, owner));
      expect(audits).toEqual([{
        action: "created",
        entityType: "cash_flow_initial_timeline",
        entityId: null,
        metadata: { operation: "cash_flow_initial_timeline_create", firstPayday: "2099-01-01", throughDate: "2099-02-15", periodsCreated: 4, snapshotsCreated: 0 },
      }]);

      throw rollbackMarker;
    })).rejects.toThrow(rollbackMarker.message);
  });

  it("adds the first income to an existing timeline without recreating its periods", async () => {
    if (!database) return;
    const owner = "00000000-0000-4000-8000-0000000001a3";
    const institution = "10000000-0000-4000-8000-0000000001a3";
    const account = "20000000-0000-4000-8000-0000000001a3";
    const rollbackMarker = new Error("existing timeline initial income rollback");

    await expect(database.transaction(async (tx) => {
      await tx.insert(users).values({ id: owner, email: "existing-timeline-income-owner@athena-vault.local" });
      await tx.insert(institutions).values({ id: institution, ownerId: owner, name: "Existing timeline bank", currency: "CAD" });
      await tx.insert(accounts).values({ id: account, ownerId: owner, institutionId: institution, name: "Existing timeline checking", kind: "checking", currency: "CAD", includeInAvailableCash: true, useCashFlowPlannedTimeline: true });

      const repository = createCashFlowRepository(tx as unknown as Database);
      await repository.createInitialTimeline(owner, { firstPayday: "2099-01-01", throughDate: "2099-02-15" });
      const before = await tx.select({ id: cashFlowPeriods.id, payDate: cashFlowPeriods.payDate }).from(cashFlowPeriods).where(eq(cashFlowPeriods.ownerId, owner)).orderBy(asc(cashFlowPeriods.payDate));

      const created = await repository.createInitialCashFlowIncome(owner, {
        accountId: account,
        name: "Paycheque",
        amountMinor: 185050,
        frequency: "biweekly",
        startsOn: "2099-01-01",
        throughDate: "2099-02-15",
      });

      const after = await tx.select({ id: cashFlowPeriods.id, payDate: cashFlowPeriods.payDate }).from(cashFlowPeriods).where(eq(cashFlowPeriods.ownerId, owner)).orderBy(asc(cashFlowPeriods.payDate));
      expect(created).toMatchObject({ accountId: account, periodsCreated: 0, generatedCount: 4 });
      expect(after).toEqual(before);

      throw rollbackMarker;
    })).rejects.toThrow(rollbackMarker.message);
  });

  it("creates the first income, timeline, and generated planned rows as one operation", async () => {
    if (!database) return;
    const owner = "00000000-0000-4000-8000-0000000001a2";
    const institution = "10000000-0000-4000-8000-0000000001a2";
    const account = "20000000-0000-4000-8000-0000000001a2";
    const rollbackMarker = new Error("initial Cash Flow income rollback");

    await expect(database.transaction(async (tx) => {
      await tx.insert(users).values({ id: owner, email: "initial-income-owner@athena-vault.local" });
      await tx.insert(institutions).values({ id: institution, ownerId: owner, name: "Initial income bank", currency: "CAD" });
      await tx.insert(accounts).values({ id: account, ownerId: owner, institutionId: institution, name: "Initial income checking", kind: "checking", currency: "CAD", includeInAvailableCash: true, useCashFlowPlannedTimeline: true });

      const repository = createCashFlowRepository(tx as unknown as Database);
      const created = await repository.createInitialCashFlowIncome(owner, {
        accountId: account,
        name: "Paycheque",
        amountMinor: 185050,
        frequency: "biweekly",
        startsOn: "2099-01-01",
        throughDate: "2099-02-15",
        note: "Main income",
      });
      expect(created).toMatchObject({ accountId: account, periodsCreated: 4, generatedCount: 4 });

      const periods = await tx.select({ payDate: cashFlowPeriods.payDate }).from(cashFlowPeriods).where(eq(cashFlowPeriods.ownerId, owner)).orderBy(asc(cashFlowPeriods.payDate));
      expect(periods).toEqual([{ payDate: "2099-01-01" }, { payDate: "2099-01-15" }, { payDate: "2099-01-29" }, { payDate: "2099-02-12" }]);
      const generated = await tx.select({ accountId: transactions.accountId, periodId: transactions.periodId, kind: transactions.kind, amountMinor: transactions.amountMinor, status: transactions.status, isGenerated: transactions.isGenerated, scheduledOccurrenceOn: transactions.scheduledOccurrenceOn, transactionDate: transactions.transactionDate, description: transactions.description })
        .from(transactions).where(and(eq(transactions.ownerId, owner), eq(transactions.recurringSeriesId, created.seriesId))).orderBy(asc(transactions.scheduledOccurrenceOn));
      expect(generated).toEqual(expect.arrayContaining([
        { accountId: account, periodId: expect.any(String), kind: "income", amountMinor: 185050, status: "planned", isGenerated: true, scheduledOccurrenceOn: "2099-01-01", transactionDate: "2099-01-01", description: "Paycheque" },
        { accountId: account, periodId: expect.any(String), kind: "income", amountMinor: 185050, status: "planned", isGenerated: true, scheduledOccurrenceOn: "2099-01-15", transactionDate: "2099-01-15", description: "Paycheque" },
        { accountId: account, periodId: expect.any(String), kind: "income", amountMinor: 185050, status: "planned", isGenerated: true, scheduledOccurrenceOn: "2099-01-29", transactionDate: "2099-01-29", description: "Paycheque" },
        { accountId: account, periodId: expect.any(String), kind: "income", amountMinor: 185050, status: "planned", isGenerated: true, scheduledOccurrenceOn: "2099-02-12", transactionDate: "2099-02-12", description: "Paycheque" },
      ]));
      expect(generated).toHaveLength(4);
      expect(await tx.select({ frequency: recurringTransactions.frequency }).from(recurringTransactions).where(and(eq(recurringTransactions.ownerId, owner), eq(recurringTransactions.seriesId, created.seriesId)))).toEqual([{ frequency: "biweekly" }]);
      await expect(repository.createInitialCashFlowIncome(owner, {
        accountId: account,
        name: "Second income",
        amountMinor: 1,
        frequency: "biweekly",
        startsOn: "2099-01-01",
        throughDate: "2099-02-15",
      })).rejects.toThrow("Cash Flow already has recurring movement.");

      throw rollbackMarker;
    })).rejects.toThrow(rollbackMarker.message);
  });
});

describe.skipIf(!database)("recurring Cash Flow series repository", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-05T16:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("removes a stale generated weekend occurrence when an entire series moves it to a weekday", async () => {
    if (!database) return;
    const owner = "00000000-0000-4000-8000-0000000000e1";
    const institution = "10000000-0000-4000-8000-0000000000e1";
    const account = "20000000-0000-4000-8000-0000000000e1";
    const reserve = "20000000-0000-4000-8000-0000000000e2";
    const currentPeriod = "30000000-0000-4000-8000-0000000000e1";
    const nextPeriod = "30000000-0000-4000-8000-0000000000e2";
    const openingSnapshot = "40000000-0000-4000-8000-0000000000e1";
    const futureTransaction = "50000000-0000-4000-8000-0000000000e1";
    const rollbackMarker = new Error("weekend occurrence replacement rollback");
    const todayIso = toTorontoDateIso();
    const todayDay = new Date(`${todayIso}T00:00:00Z`).getUTCDay();
    const oldOccurrence = addIsoDays(todayIso, -((todayDay + 1) % 7));
    const movedOccurrence = adjustRecurringCashFlowWeekday(oldOccurrence, "next_weekday");
    const currentPayday = addIsoDays(todayIso, -13);
    const nextPayday = addIsoDays(todayIso, 1);

    await expect(database.transaction(async (tx) => {
      await tx.insert(users).values({ id: owner, email: "weekend-replacement-owner@athena-vault.local" });
      await tx.insert(institutions).values({ id: institution, ownerId: owner, name: "Weekend replacement bank", currency: "CAD" });
      await tx.insert(accounts).values([
        { id: account, ownerId: owner, institutionId: institution, name: "Weekend checking", kind: "checking", currency: "CAD", useCashFlowPlannedTimeline: true },
        { id: reserve, ownerId: owner, institutionId: institution, name: "Weekend reserve", kind: "savings", currency: "CAD" },
      ]);
      await tx.insert(cashFlowPeriods).values([
        { id: currentPeriod, ownerId: owner, label: "Weekend current period", startsOn: addIsoDays(currentPayday, -13), endsOn: todayIso, payDate: currentPayday, currency: "CAD" },
        { id: nextPeriod, ownerId: owner, label: "Weekend next period", startsOn: nextPayday, endsOn: addIsoDays(nextPayday, 13), payDate: nextPayday, currency: "CAD" },
      ]);
      await tx.insert(balanceSnapshots).values({ id: openingSnapshot, ownerId: owner, accountId: account, asOf: addIsoDays(currentPayday, -1), balanceMinor: 100000, status: "actual", isGenerated: false, currency: "CAD" });
      await tx.insert(transactions).values({ id: futureTransaction, ownerId: owner, accountId: account, periodId: nextPeriod, transactionDate: nextPayday, kind: "expense", status: "planned", isGenerated: false, isExcluded: false, description: "Next-period expense", amountMinor: 1000, currency: "CAD" });
      const repository = createCashFlowRepository(tx as unknown as Database);
      const series = await repository.createRecurringSeries(owner, {
        name: "FTQ - REER",
        kind: "transfer",
        accountId: null,
        fromAccountId: account,
        toAccountId: reserve,
        amountMinor: 4000,
        frequency: "monthly",
        weekdayAdjustment: "none",
        startsOn: oldOccurrence,
        nextOccurrenceOn: oldOccurrence,
        endsOn: null,
        note: null,
      });
      expect((await tx.select({ scheduledOccurrenceOn: transfers.scheduledOccurrenceOn, transferDate: transfers.transferDate }).from(transfers).where(and(eq(transfers.ownerId, owner), eq(transfers.recurringSeriesId, series.id))))).toEqual(expect.arrayContaining([{ scheduledOccurrenceOn: oldOccurrence, transferDate: oldOccurrence }]));
      await createAccountTimelineRepository(tx as unknown as Database).recalculateAccountProjections(owner, account);
      expect((await tx.select({ balanceMinor: balanceSnapshots.balanceMinor, status: balanceSnapshots.status, isGenerated: balanceSnapshots.isGenerated }).from(balanceSnapshots).where(and(eq(balanceSnapshots.ownerId, owner), eq(balanceSnapshots.accountId, account), eq(balanceSnapshots.asOf, nextPayday))))[0]).toEqual({ balanceMinor: 95000, status: "planned", isGenerated: true });

      await repository.updateRecurringSeriesEntirely(owner, series.id, {
        name: "FTQ - REER",
        kind: "transfer",
        accountId: null,
        fromAccountId: account,
        toAccountId: reserve,
        amountMinor: 5000,
        frequency: "monthly",
        weekdayAdjustment: "next_weekday",
        startsOn: oldOccurrence,
        endsOn: null,
        note: null,
        countsAsExpense: false,
      });
      expect((await tx.select({ balanceMinor: balanceSnapshots.balanceMinor, status: balanceSnapshots.status, isGenerated: balanceSnapshots.isGenerated }).from(balanceSnapshots).where(and(eq(balanceSnapshots.ownerId, owner), eq(balanceSnapshots.accountId, account), eq(balanceSnapshots.asOf, nextPayday))))[0]).toEqual({ balanceMinor: 94000, status: "planned", isGenerated: true });
      const timeline = await createAccountTimelineRepository(tx as unknown as Database).getTimeline(owner, { selectedDate: nextPayday });
      expect(timeline.accounts.find((entry) => entry.id === account)?.selectedSnapshot).toMatchObject({ asOf: nextPayday, balanceMinor: 95000, status: "planned", isGenerated: true });

      const rows = await tx.select({ scheduledOccurrenceOn: transfers.scheduledOccurrenceOn, transferDate: transfers.transferDate, amountMinor: transfers.amountMinor })
        .from(transfers)
        .where(and(eq(transfers.ownerId, owner), eq(transfers.recurringSeriesId, series.id)))
        .orderBy(asc(transfers.scheduledOccurrenceOn), asc(transfers.id));
      expect(rows.some((row) => row.scheduledOccurrenceOn === oldOccurrence)).toBe(false);
      expect(rows.filter((row) => row.scheduledOccurrenceOn === movedOccurrence)).toEqual([{ scheduledOccurrenceOn: movedOccurrence, transferDate: movedOccurrence, amountMinor: 5000 }]);
      expect(new Set(rows.map((row) => row.scheduledOccurrenceOn)).size).toBe(rows.length);

      throw rollbackMarker;
    })).rejects.toThrow(rollbackMarker.message);
  });

  it("generates historical recurring rows without changing existing timeline rows", async () => {
    if (!database) return;
    const historicalOwner = "00000000-0000-4000-8000-0000000000f5";
    const historicalInstitution = "10000000-0000-4000-8000-0000000000f5";
    const historicalAccount = "20000000-0000-4000-8000-0000000000f5";
    const historicalReserve = "20000000-0000-4000-8000-0000000000f6";
    const historicalPeriods = [
      "30000000-0000-4000-8000-0000000000f5",
      "30000000-0000-4000-8000-0000000000f6",
      "30000000-0000-4000-8000-0000000000f7",
      "30000000-0000-4000-8000-0000000000f8",
    ];
    const rollbackMarker = new Error("historical recurring generation rollback");
    const todayIso = toTorontoDateIso();
    const startsOn = addIsoDays(todayIso, -28);
    const throughDate = addIsoDays(todayIso, 14);
    const payDates = [startsOn, addIsoDays(startsOn, 14), todayIso, throughDate];

    await expect(database.transaction(async (tx) => {
      await tx.insert(users).values({ id: historicalOwner, email: "historical-recurring-owner@athena-vault.local" });
      await tx.insert(institutions).values({ id: historicalInstitution, ownerId: historicalOwner, name: "Historical recurring bank", currency: "CAD" });
      await tx.insert(accounts).values([
        { id: historicalAccount, ownerId: historicalOwner, institutionId: historicalInstitution, name: "Historical recurring account", kind: "checking", currency: "CAD" },
        { id: historicalReserve, ownerId: historicalOwner, institutionId: historicalInstitution, name: "Historical recurring reserve", kind: "savings", currency: "CAD" },
      ]);
      await tx.insert(cashFlowPeriods).values(payDates.map((payDate, index) => ({
        id: historicalPeriods[index]!,
        ownerId: historicalOwner,
        label: `Historical payday ${payDate}`,
        startsOn: addIsoDays(payDate, -13),
        endsOn: payDate,
        payDate,
        currency: "CAD" as const,
      })));
      await tx.insert(transfers).values({
        ownerId: historicalOwner,
        periodId: historicalPeriods[0],
        fromAccountId: historicalAccount,
        toAccountId: historicalReserve,
        transferDate: startsOn,
        amountMinor: 123,
        currency: "CAD",
        status: "planned",
        description: "Existing transfer",
      });
      const [manualRow] = await tx.insert(transactions).values({
        ownerId: historicalOwner,
        accountId: historicalAccount,
        transactionDate: addIsoDays(startsOn, 7),
        kind: "expense",
        status: "planned",
        isGenerated: false,
        isExcluded: false,
        description: "Historical recurring expense",
        amountMinor: 777,
        currency: "CAD",
      }).returning({ id: transactions.id });
      const [actualRow] = await tx.insert(transactions).values({
        ownerId: historicalOwner,
        accountId: historicalAccount,
        transactionDate: addIsoDays(startsOn, 14),
        kind: "expense",
        status: "actual",
        isGenerated: false,
        isExcluded: false,
        description: "Historical recurring expense",
        amountMinor: 888,
        currency: "CAD",
      }).returning({ id: transactions.id });
      const [excludedRow] = await tx.insert(transactions).values({
        ownerId: historicalOwner,
        accountId: historicalAccount,
        transactionDate: addIsoDays(startsOn, 21),
        kind: "expense",
        status: "planned",
        isGenerated: false,
        isExcluded: true,
        description: "Historical recurring expense",
        amountMinor: 999,
        currency: "CAD",
      }).returning({ id: transactions.id });

      const repository = createCashFlowRepository(tx as unknown as Database);
      const created = await repository.createRecurringSeries(historicalOwner, {
        name: "Historical recurring expense",
        kind: "expense",
        accountId: historicalAccount,
        amountMinor: 1000,
        frequency: "weekly",
        weekdayAdjustment: "none",
        startsOn,
        nextOccurrenceOn: startsOn,
        endsOn: throughDate,
        note: null,
      });
      const initialRows = await tx.select({ scheduledOccurrenceOn: transactions.scheduledOccurrenceOn, transactionDate: transactions.transactionDate, isGenerated: transactions.isGenerated })
        .from(transactions)
        .where(and(eq(transactions.ownerId, historicalOwner), eq(transactions.recurringSeriesId, created.id)))
        .orderBy(transactions.scheduledOccurrenceOn);
      expect(initialRows).toEqual([
        { scheduledOccurrenceOn: startsOn, transactionDate: startsOn, isGenerated: true },
        { scheduledOccurrenceOn: todayIso, transactionDate: todayIso, isGenerated: true },
        { scheduledOccurrenceOn: addIsoDays(todayIso, 7), transactionDate: addIsoDays(todayIso, 7), isGenerated: true },
        { scheduledOccurrenceOn: throughDate, transactionDate: throughDate, isGenerated: true },
      ]);
      expect(manualRow).toBeTruthy();
      expect(actualRow).toBeTruthy();
      expect(excludedRow).toBeTruthy();

      const [changedGeneratedRow] = await tx.update(transactions).set({ description: "Existing generated expense", amountMinor: 4321, updatedAt: new Date() })
        .where(and(eq(transactions.ownerId, historicalOwner), eq(transactions.recurringSeriesId, created.id), eq(transactions.scheduledOccurrenceOn, startsOn)))
        .returning({ id: transactions.id });
      expect(changedGeneratedRow).toBeTruthy();

      const generation = await repository.generateRecurringOccurrences(historicalOwner, created.id, { throughDate });
      expect(generation).toMatchObject({ insertedCount: 0, updatedCount: 3, deletedCount: 0, skippedCount: 0, preservedCount: 0 });
      expect((await tx.select({ description: transactions.description, amountMinor: transactions.amountMinor, isGenerated: transactions.isGenerated }).from(transactions).where(eq(transactions.id, changedGeneratedRow!.id)))[0]).toEqual({ description: "Existing generated expense", amountMinor: 4321, isGenerated: true });
      expect((await tx.select({ description: transactions.description, amountMinor: transactions.amountMinor, isExcluded: transactions.isExcluded, status: transactions.status }).from(transactions).where(inArray(transactions.id, [manualRow!.id, actualRow!.id, excludedRow!.id]))).sort((left, right) => left.amountMinor - right.amountMinor)).toEqual([
        { description: "Historical recurring expense", amountMinor: 777, isExcluded: false, status: "planned" },
        { description: "Historical recurring expense", amountMinor: 888, isExcluded: false, status: "actual" },
        { description: "Historical recurring expense", amountMinor: 999, isExcluded: true, status: "planned" },
      ]);

      const edited = await repository.updateRecurringSeriesEntirely(historicalOwner, created.id, {
        name: "Historical recurring expense updated",
        kind: "expense",
        accountId: historicalAccount,
        amountMinor: 2000,
        frequency: "weekly",
        weekdayAdjustment: "none",
        startsOn,
        endsOn: throughDate,
        note: null,
      });
      expect(edited.id).toBe(created.id);
      expect((await tx.select({ amountMinor: transactions.amountMinor }).from(transactions).where(eq(transactions.id, changedGeneratedRow!.id)))[0]).toEqual({ amountMinor: 4321 });
      expect(await tx.select({ scheduledOccurrenceOn: transactions.scheduledOccurrenceOn, amountMinor: transactions.amountMinor, status: transactions.status, isGenerated: transactions.isGenerated })
        .from(transactions)
        .where(and(eq(transactions.ownerId, historicalOwner), eq(transactions.recurringSeriesId, created.id), gte(transactions.scheduledOccurrenceOn, todayIso)))
        .orderBy(transactions.scheduledOccurrenceOn)).toEqual([
        { scheduledOccurrenceOn: todayIso, amountMinor: 2000, status: "planned", isGenerated: true },
        { scheduledOccurrenceOn: addIsoDays(todayIso, 7), amountMinor: 2000, status: "planned", isGenerated: true },
        { scheduledOccurrenceOn: throughDate, amountMinor: 2000, status: "planned", isGenerated: true },
      ]);

      throw rollbackMarker;
    })).rejects.toThrow(rollbackMarker.message);
  });

  it("standalone regeneration restores a missing first occurrence inside the current pay period", async () => {
    if (!database) return;
    const owner = "00000000-0000-0000-0000-0000000000f7";
    const institution = "10000000-0000-4000-8000-0000000000f7";
    const account = "20000000-0000-4000-8000-0000000000f7";
    const currentPeriod = "30000000-0000-4000-8000-0000000000f7";
    const nextPeriod = "30000000-0000-4000-8000-0000000000f8";
    const rollbackMarker = new Error("missing recurring occurrence rollback");

    await expectIntegrationRollback(database.transaction(async (tx) => {
      await tx.insert(users).values({ id: owner, email: "recurring-missing-occurrence@athena-vault.local" });
      await tx.insert(institutions).values({ id: institution, ownerId: owner, name: "Tidal bank", currency: "CAD" });
      await tx.insert(accounts).values({ id: account, ownerId: owner, institutionId: institution, name: "Tidal account", kind: "checking", currency: "CAD" });
      await tx.insert(cashFlowPeriods).values([
        { id: currentPeriod, ownerId: owner, label: "Aug 5 payday", startsOn: "2026-07-23", endsOn: "2026-08-05", payDate: "2026-08-05", currency: "CAD", status: "actual" },
        { id: nextPeriod, ownerId: owner, label: "Aug 19 payday", startsOn: "2026-08-06", endsOn: "2026-09-19", payDate: "2026-08-19", currency: "CAD", status: "planned" },
      ]);

      const repository = createCashFlowRepository(tx as unknown as Database);
      const created = await repository.createRecurringSeries(owner, {
        name: "Tidal",
        kind: "expense",
        accountId: account,
        amountMinor: 5000,
        frequency: "monthly",
        weekdayAdjustment: "none",
        startsOn: "2026-08-06",
        nextOccurrenceOn: "2026-08-06",
        endsOn: "2026-09-06",
        note: null,
      });
      const versionId = created.versions[0]!.id;
      const [missingRow] = await tx.delete(transactions).where(and(
        eq(transactions.ownerId, owner),
        eq(transactions.recurringSeriesId, created.id),
        eq(transactions.scheduledOccurrenceOn, "2026-08-06"),
      )).returning({ id: transactions.id });
      expect(missingRow).toBeTruthy();
      await tx.update(recurringTransactions).set({ effectiveFrom: "2026-09-06", nextOccurrenceOn: "2026-09-06", updatedAt: new Date() })
        .where(and(eq(recurringTransactions.ownerId, owner), eq(recurringTransactions.id, versionId), eq(recurringTransactions.seriesId, created.id)));
      expect(await tx.select({ scheduledOccurrenceOn: transactions.scheduledOccurrenceOn }).from(transactions).where(eq(transactions.recurringSeriesId, created.id))).toEqual([{ scheduledOccurrenceOn: "2026-09-06" }]);

      const generation = await repository.generateRecurringOccurrences(owner, created.id, { throughDate: "2026-09-06" });

      expect(generation).toMatchObject({ insertedCount: 1, updatedCount: 1, deletedCount: 0 });
      expect((await tx.select({ effectiveFrom: recurringTransactions.effectiveFrom, nextOccurrenceOn: recurringTransactions.nextOccurrenceOn })
        .from(recurringTransactions)
        .where(and(eq(recurringTransactions.ownerId, owner), eq(recurringTransactions.id, versionId))))[0]).toEqual({ effectiveFrom: "2026-08-06", nextOccurrenceOn: "2026-09-06" });
      expect(await tx.select({ scheduledOccurrenceOn: transactions.scheduledOccurrenceOn, amountMinor: transactions.amountMinor, status: transactions.status, isGenerated: transactions.isGenerated })
        .from(transactions)
        .where(and(eq(transactions.ownerId, owner), eq(transactions.recurringSeriesId, created.id)))
        .orderBy(transactions.scheduledOccurrenceOn)).toEqual([
        { scheduledOccurrenceOn: "2026-08-06", amountMinor: 5000, status: "planned", isGenerated: true },
        { scheduledOccurrenceOn: "2026-09-06", amountMinor: 5000, status: "planned", isGenerated: true },
      ]);

      throw rollbackMarker;
    }), rollbackMarker);
  });

  it("repairs a current-period generated actual while preserving older actual history", async () => {
    if (!database) return;
    const owner = "00000000-0000-0000-0000-0000000000f8";
    const institution = "10000000-0000-4000-8000-0000000000f8";
    const account = "20000000-0000-4000-8000-0000000000f8";
    const currentPeriod = "30000000-0000-4000-8000-0000000000f9";
    const nextPeriod = "30000000-0000-4000-8000-0000000000fa";
    const rollbackMarker = new Error("current generated actual rollback");

    await expect(database.transaction(async (tx) => {
      await tx.insert(users).values({ id: owner, email: "recurring-current-actual@athena-vault.local" });
      await tx.insert(institutions).values({ id: institution, ownerId: owner, name: "Current actual bank", currency: "CAD" });
      await tx.insert(accounts).values({ id: account, ownerId: owner, institutionId: institution, name: "Current actual account", kind: "checking", currency: "CAD" });
      await tx.insert(cashFlowPeriods).values([
        { id: currentPeriod, ownerId: owner, label: "Aug 5 payday", startsOn: "2026-07-23", endsOn: "2026-08-05", payDate: "2026-08-05", currency: "CAD", status: "actual" },
        { id: nextPeriod, ownerId: owner, label: "Aug 19 payday", startsOn: "2026-08-06", endsOn: "2026-09-19", payDate: "2026-08-19", currency: "CAD", status: "planned" },
      ]);

      const repository = createCashFlowRepository(tx as unknown as Database);
      const created = await repository.createRecurringSeries(owner, {
        name: "Current generated actual",
        kind: "expense",
        accountId: account,
        amountMinor: 5000,
        frequency: "monthly",
        weekdayAdjustment: "none",
        startsOn: "2026-08-06",
        nextOccurrenceOn: "2026-08-06",
        endsOn: "2026-09-06",
        note: null,
      });
      const versionId = created.versions[0]!.id;
      const [olderActual] = await tx.insert(transactions).values({
        ownerId: owner,
        accountId: account,
        periodId: currentPeriod,
        recurringTransactionId: versionId,
        recurringSeriesId: created.id,
        recurringOccurrenceId: "44000000-0000-4000-8000-0000000000f8",
        scheduledOccurrenceOn: "2026-07-06",
        transactionDate: "2026-07-06",
        kind: "expense",
        status: "actual",
        isGenerated: true,
        isExcluded: false,
        description: "Older generated actual",
        amountMinor: 1111,
        currency: "CAD",
      }).returning({ id: transactions.id });
      const [currentActual] = await tx.update(transactions).set({ status: "actual", amountMinor: 2222, updatedAt: new Date() })
        .where(and(eq(transactions.ownerId, owner), eq(transactions.recurringSeriesId, created.id), eq(transactions.scheduledOccurrenceOn, "2026-08-06")))
        .returning({ id: transactions.id });
      expect(olderActual).toBeTruthy();
      expect(currentActual).toBeTruthy();

      await repository.updateRecurringSeriesEntirely(owner, created.id, {
        name: "Current generated actual",
        kind: "expense",
        accountId: account,
        amountMinor: 6200,
        frequency: "monthly",
        weekdayAdjustment: "none",
        startsOn: "2026-08-06",
        endsOn: "2026-09-06",
        note: null,
      });

      expect(await tx.select({ amountMinor: transactions.amountMinor, status: transactions.status, isGenerated: transactions.isGenerated })
        .from(transactions)
        .where(eq(transactions.id, olderActual!.id))).toEqual([{ amountMinor: 1111, status: "actual", isGenerated: true }]);
      expect(await tx.select({ amountMinor: transactions.amountMinor, status: transactions.status, isGenerated: transactions.isGenerated })
        .from(transactions)
        .where(eq(transactions.id, currentActual!.id))).toEqual([{ amountMinor: 6200, status: "actual", isGenerated: true }]);

      throw rollbackMarker;
    })).rejects.toThrow(rollbackMarker.message);
  });

  it("deletes a recurring series and all linked rows while preserving unrelated rows", async () => {
    if (!database) return;
    const deleteOwner = "00000000-0000-4000-8000-0000000000f9";
    const deleteInstitution = "10000000-0000-4000-8000-0000000000f9";
    const deleteAccount = "20000000-0000-4000-8000-0000000000f9";
    const deleteReserve = "20000000-0000-4000-8000-0000000000fa";
    const deletePeriods = [
      "30000000-0000-4000-8000-0000000000f9",
      "30000000-0000-4000-8000-0000000000fa",
      "30000000-0000-4000-8000-0000000000fb",
    ];
    const rollbackMarker = new Error("recurring series delete rollback");

    await expect(database.transaction(async (tx) => {
      await tx.insert(users).values({ id: deleteOwner, email: "recurring-delete-owner@athena-vault.local" });
      await tx.insert(institutions).values({ id: deleteInstitution, ownerId: deleteOwner, name: "Delete bank", currency: "CAD" });
      await tx.insert(accounts).values([
        { id: deleteAccount, ownerId: deleteOwner, institutionId: deleteInstitution, name: "Delete account", kind: "checking", currency: "CAD" },
        { id: deleteReserve, ownerId: deleteOwner, institutionId: deleteInstitution, name: "Delete reserve", kind: "savings", currency: "CAD" },
      ]);
      await tx.insert(cashFlowPeriods).values([
        { id: deletePeriods[0]!, ownerId: deleteOwner, label: "Delete payday 1", startsOn: "2088-12-19", endsOn: "2089-01-01", payDate: "2089-01-01", currency: "CAD" },
        { id: deletePeriods[1]!, ownerId: deleteOwner, label: "Delete payday 2", startsOn: "2089-01-02", endsOn: "2089-01-15", payDate: "2089-01-15", currency: "CAD" },
        { id: deletePeriods[2]!, ownerId: deleteOwner, label: "Delete payday 3", startsOn: "2089-01-16", endsOn: "2089-01-29", payDate: "2089-01-29", currency: "CAD" },
      ]);
      const repository = createCashFlowRepository(tx as unknown as Database);
      const created = await repository.createRecurringSeries(deleteOwner, {
        name: "Transfert voyage de tangerine",
        kind: "expense",
        accountId: deleteAccount,
        amountMinor: 2500,
        frequency: "weekly",
        weekdayAdjustment: "none",
        startsOn: "2089-01-01",
        nextOccurrenceOn: "2089-01-01",
        endsOn: "2089-01-15",
        note: null,
      });
      const versionId = created.versions[0]!.id;
      const [actualRow] = await tx.update(transactions).set({ status: "actual", updatedAt: new Date() })
        .where(and(eq(transactions.ownerId, deleteOwner), eq(transactions.recurringSeriesId, created.id), eq(transactions.scheduledOccurrenceOn, "2089-01-01")))
        .returning({ id: transactions.id });
      const [manualRow] = await tx.insert(transactions).values({
        ownerId: deleteOwner,
        accountId: deleteAccount,
        recurringTransactionId: versionId,
        recurringSeriesId: created.id,
        scheduledOccurrenceOn: "2089-01-08",
        transactionDate: "2089-01-08",
        kind: "expense",
        status: "planned",
        isGenerated: false,
        isExcluded: false,
        description: "Transfert voyage de tangerine",
        amountMinor: 2600,
        currency: "CAD",
      }).returning({ id: transactions.id });
      const [excludedRow] = await tx.insert(transactions).values({
        ownerId: deleteOwner,
        accountId: deleteAccount,
        recurringTransactionId: versionId,
        recurringSeriesId: created.id,
        scheduledOccurrenceOn: "2089-01-15",
        transactionDate: "2089-01-15",
        kind: "expense",
        status: "planned",
        isGenerated: false,
        isExcluded: true,
        description: "Transfert voyage de tangerine",
        amountMinor: 2700,
        currency: "CAD",
      }).returning({ id: transactions.id });
      const [unrelatedRow] = await tx.insert(transactions).values({
        ownerId: deleteOwner,
        accountId: deleteAccount,
        transactionDate: "2089-01-29",
        kind: "expense",
        status: "planned",
        description: "Transfert voyage de tangerine",
        amountMinor: 2800,
        currency: "CAD",
      }).returning({ id: transactions.id });
      expect(actualRow).toBeTruthy();
      expect(manualRow).toBeTruthy();
      expect(excludedRow).toBeTruthy();
      expect(unrelatedRow).toBeTruthy();

      await repository.updateRecurringSeriesEntirely(deleteOwner, created.id, {
        name: "Transfert voyage de tangerine",
        kind: "expense",
        accountId: deleteReserve,
        amountMinor: 2500,
        frequency: "weekly",
        weekdayAdjustment: "none",
        startsOn: "2089-01-01",
        endsOn: "2089-01-15",
        note: null,
      });
      const movedRows = await tx.select({ accountId: transactions.accountId }).from(transactions).where(eq(transactions.recurringSeriesId, created.id));
      expect(movedRows).toHaveLength(5);
      expect(movedRows.every((row) => row.accountId === deleteReserve)).toBe(true);

      const result = await repository.deleteRecurringSeries(deleteOwner, created.id);
      expect(result.seriesId).toBe(created.id);
      expect(result).toEqual({ seriesId: created.id, transactionCount: 5, transferCount: 0, sourceReferenceCount: 0 });
      expect(await tx.select({ id: recurringCashFlowSeries.id }).from(recurringCashFlowSeries).where(eq(recurringCashFlowSeries.id, created.id))).toEqual([]);
      expect(await tx.select({ id: transactions.id }).from(transactions).where(eq(transactions.id, actualRow!.id))).toEqual([]);
      expect(await tx.select({ id: transactions.id }).from(transactions).where(eq(transactions.id, manualRow!.id))).toEqual([]);
      expect(await tx.select({ id: transactions.id }).from(transactions).where(eq(transactions.id, excludedRow!.id))).toEqual([]);
      expect(await tx.select({ id: transactions.id }).from(transactions).where(eq(transactions.id, unrelatedRow!.id))).toEqual([{ id: unrelatedRow!.id }]);
      expect(await tx.select({ metadata: auditEvents.metadata }).from(auditEvents).where(and(eq(auditEvents.ownerId, deleteOwner), eq(auditEvents.entityId, created.id), eq(auditEvents.action, "deleted")))).toEqual([{ metadata: { operation: "recurring_series_delete", transactionCount: 5, transferCount: 0, sourceReferenceCount: 0 } }]);

      throw rollbackMarker;
    })).rejects.toThrow(rollbackMarker.message);
  });

  it("creates versions, deletes safe history versions, protects financial rows, and restores grouped exceptions", async () => {
    if (!database) return;
    const recurringOwnerA = "00000000-0000-0000-0000-0000000000ea";
    const recurringOwnerB = "00000000-0000-0000-0000-0000000000eb";
    const recurringInstitutionA = "10000000-0000-4000-8000-0000000000ea";
    const recurringInstitutionB = "10000000-0000-4000-8000-0000000000eb";
    const recurringAccountA = "20000000-0000-4000-8000-0000000000ea";
    const recurringAccountB = "20000000-0000-4000-8000-0000000000eb";
    const rollbackMarker = new Error("recurring Cash Flow integration rollback");

    await expect(database.transaction(async (tx) => {
      await tx.insert(users).values([
        { id: recurringOwnerA, email: "recurring-series-owner-a@athena-vault.local" },
        { id: recurringOwnerB, email: "recurring-series-owner-b@athena-vault.local" },
      ]);
      await tx.insert(institutions).values([
        { id: recurringInstitutionA, ownerId: recurringOwnerA, name: "Recurring bank A", currency: "CAD" },
        { id: recurringInstitutionB, ownerId: recurringOwnerB, name: "Recurring bank B", currency: "CAD" },
      ]);
      await tx.insert(accounts).values([
        { id: recurringAccountA, ownerId: recurringOwnerA, institutionId: recurringInstitutionA, name: "Recurring account A", kind: "checking", currency: "CAD" },
        { id: recurringAccountB, ownerId: recurringOwnerB, institutionId: recurringInstitutionB, name: "Recurring account B", kind: "checking", currency: "CAD" },
      ]);
      await tx.insert(cashFlowPeriods).values([
        { ownerId: recurringOwnerA, label: "Recurring test horizon", startsOn: "2099-01-01", endsOn: "2099-04-30", payDate: "2099-01-01", currency: "CAD", status: "planned" },
        { ownerId: recurringOwnerB, label: "Other owner horizon", startsOn: "2099-01-01", endsOn: "2099-04-30", payDate: "2099-01-01", currency: "CAD", status: "planned" },
      ]);

      const repository = createCashFlowRepository(tx as unknown as Database);
      const created = await repository.createRecurringSeries(recurringOwnerA, {
        name: "Weekly reserve",
        kind: "expense",
        accountId: recurringAccountA,
        amountMinor: 1000,
        frequency: "weekly",
        startsOn: "2099-01-10",
        nextOccurrenceOn: "2099-01-10",
        endsOn: null,
        note: "Initial version",
      });
      expect(created.versions).toHaveLength(1);
      const versionId = created.versions[0]!.id;
      const elapsedSeries = await repository.createRecurringSeries(recurringOwnerA, {
        name: "Elapsed schedule",
        kind: "expense",
        accountId: recurringAccountA,
        amountMinor: 500,
        frequency: "weekly",
        startsOn: "2026-05-31",
        nextOccurrenceOn: "2026-05-31",
        endsOn: null,
        note: null,
      });
      await expect(repository.changeRecurringSeriesVersion(recurringOwnerA, {
        seriesId: elapsedSeries.id,
        name: "Invalid historical version",
        kind: "expense",
        accountId: recurringAccountA,
        amountMinor: 600,
        frequency: "weekly",
        startsOn: "2026-06-07",
        nextOccurrenceOn: "2026-06-07",
        endsOn: null,
        note: null,
        previousEndsOn: "2026-05-31",
        effectiveFrom: "2026-06-07",
        versionNote: null,
      })).rejects.toThrow("future occurrence");
      expect(await repository.listRecurringSeries(recurringOwnerB)).toEqual([]);
      await expect(repository.listRecurringSeries(recurringOwnerB, { includeHistory: true })).resolves.toEqual([]);
      await expect(repository.generateRecurringOccurrences(recurringOwnerB, created.id, { fromDate: "2099-01-10", throughDate: "2099-02-28" })).rejects.toThrow("not found");

      const firstGeneration = await repository.generateRecurringOccurrences(recurringOwnerA, created.id, { fromDate: "2099-01-10", throughDate: "2099-02-28" });
      expect(firstGeneration).toMatchObject({ insertedCount: 0, updatedCount: 8, deletedCount: 0, skippedCount: 0, preservedCount: 0 });
      const secondGeneration = await repository.generateRecurringOccurrences(recurringOwnerA, created.id, { fromDate: "2099-01-10", throughDate: "2099-02-28" });
      expect(secondGeneration).toMatchObject({ insertedCount: 0, updatedCount: 8, deletedCount: 0, preservedCount: 0 });
      const generatedRows = await tx.select({ id: transactions.id, scheduledOccurrenceOn: transactions.scheduledOccurrenceOn, recurringOccurrenceId: transactions.recurringOccurrenceId, status: transactions.status, isGenerated: transactions.isGenerated, amountMinor: transactions.amountMinor, transactionDate: transactions.transactionDate, description: transactions.description })
        .from(transactions).where(and(eq(transactions.ownerId, recurringOwnerA), eq(transactions.recurringSeriesId, created.id), lte(transactions.scheduledOccurrenceOn, "2099-02-28"))).orderBy(transactions.scheduledOccurrenceOn);
      expect(generatedRows).toHaveLength(8);
      expect(new Set(generatedRows.map((row) => row.recurringOccurrenceId)).size).toBe(8);

      const [actualGeneratedRow] = await tx.select({ id: transactions.id }).from(transactions).where(and(eq(transactions.ownerId, recurringOwnerA), eq(transactions.recurringSeriesId, created.id), eq(transactions.scheduledOccurrenceOn, "2099-03-14"))).limit(1);
      expect(actualGeneratedRow).toBeTruthy();
      await tx.update(transactions).set({ status: "actual", updatedAt: new Date() }).where(eq(transactions.id, actualGeneratedRow!.id));
      const protectedGeneration = await repository.generateRecurringOccurrences(recurringOwnerA, created.id, { fromDate: "2099-01-10", throughDate: "2099-03-14" });
      expect(protectedGeneration.preservedCount).toBeGreaterThanOrEqual(1);
      expect((await tx.select({ status: transactions.status }).from(transactions).where(eq(transactions.id, actualGeneratedRow!.id)))[0]).toEqual({ status: "actual" });
      const [singleTransaction] = await tx.select({ id: transactions.id }).from(transactions).where(and(
        eq(transactions.ownerId, recurringOwnerA),
        eq(transactions.recurringSeriesId, created.id),
        eq(transactions.scheduledOccurrenceOn, "2099-01-17"),
      )).limit(1);
      expect(singleTransaction).toBeTruthy();
      const single = await repository.applyRecurringOccurrenceException(recurringOwnerA, {
        seriesId: created.id,
        versionId,
        transactionId: singleTransaction!.id,
        scheduledOccurrenceOn: "2099-01-17",
        scope: "only_this_occurrence",
        kind: "override",
        dateOverride: "2099-01-18",
        amountOverrideMinor: 2200,
        accountOverrideId: recurringAccountA,
        statusOverride: "planned",
        note: "Moved for the holiday",
      });
      expect(single.overrideGroupId).toBeNull();
      expect(single.exceptionIds).toHaveLength(1);
      expect((await tx.select({ transactionId: recurringCashFlowOccurrenceExceptions.transactionId }).from(recurringCashFlowOccurrenceExceptions).where(eq(recurringCashFlowOccurrenceExceptions.id, single.exceptionIds[0]!)))[0]).toEqual({ transactionId: singleTransaction!.id });
      expect((await tx.select({ amountMinor: transactions.amountMinor, transactionDate: transactions.transactionDate, description: transactions.description }).from(transactions).where(and(eq(transactions.ownerId, recurringOwnerA), eq(transactions.recurringSeriesId, created.id), eq(transactions.scheduledOccurrenceOn, "2099-01-17"))))[0]).toMatchObject({ amountMinor: 2200, transactionDate: "2099-01-18", description: "Weekly reserve" });

      const range = await repository.applyRecurringOccurrenceException(recurringOwnerA, {
        seriesId: created.id,
        versionId,
        scheduledOccurrenceOn: "2099-01-24",
        endingOccurrenceOn: "2099-02-28",
        scope: "selected_range",
        kind: "override",
        amountOverrideMinor: 1300,
        accountOverrideId: recurringAccountA,
        statusOverride: "planned",
        note: "Six-week winter range",
      });
      expect(range.overrideGroupId).toBeTruthy();
      expect(range.exceptionIds).toHaveLength(6);
      expect((await tx.select({ id: recurringCashFlowOccurrenceExceptions.id }).from(recurringCashFlowOccurrenceExceptions).where(and(eq(recurringCashFlowOccurrenceExceptions.ownerId, recurringOwnerA), eq(recurringCashFlowOccurrenceExceptions.overrideGroupId, range.overrideGroupId!))))).toHaveLength(6);
      expect((await tx.select({ amountMinor: transactions.amountMinor }).from(transactions).where(and(eq(transactions.ownerId, recurringOwnerA), eq(transactions.recurringSeriesId, created.id), gte(transactions.scheduledOccurrenceOn, "2099-01-24"), lte(transactions.scheduledOccurrenceOn, "2099-02-28"))))).toHaveLength(6);

      const nested = await repository.applyRecurringOccurrenceException(recurringOwnerA, {
        seriesId: created.id,
        versionId,
        scheduledOccurrenceOn: "2099-02-07",
        scope: "only_this_occurrence",
        kind: "override",
        amountOverrideMinor: 1700,
        accountOverrideId: recurringAccountA,
        statusOverride: "planned",
        note: "Independent occurrence edit",
      });
      expect(nested.exceptionIds).toHaveLength(1);
      const groupExceptions = await tx.select({ isActive: recurringCashFlowOccurrenceExceptions.isActive }).from(recurringCashFlowOccurrenceExceptions).where(and(eq(recurringCashFlowOccurrenceExceptions.ownerId, recurringOwnerA), eq(recurringCashFlowOccurrenceExceptions.overrideGroupId, range.overrideGroupId!)));
      expect(groupExceptions.filter((row) => row.isActive)).toHaveLength(5);
      const nestedRow = (await tx.select({ recurringOccurrenceId: transactions.recurringOccurrenceId, amountMinor: transactions.amountMinor }).from(transactions).where(and(eq(transactions.ownerId, recurringOwnerA), eq(transactions.recurringSeriesId, created.id), eq(transactions.scheduledOccurrenceOn, "2099-02-07"))))[0]!;

      await repository.restoreRecurringOccurrence(recurringOwnerA, { seriesId: created.id, occurrenceId: nestedRow.recurringOccurrenceId, overrideGroupId: null, scope: "occurrence" });
      await repository.restoreRecurringOccurrence(recurringOwnerA, { seriesId: created.id, occurrenceId: null, overrideGroupId: range.overrideGroupId, scope: "group" });
      const restoredExceptions = await tx.select({ scheduledOccurrenceOn: recurringCashFlowOccurrenceExceptions.scheduledOccurrenceOn, isActive: recurringCashFlowOccurrenceExceptions.isActive })
        .from(recurringCashFlowOccurrenceExceptions)
        .where(and(
          eq(recurringCashFlowOccurrenceExceptions.ownerId, recurringOwnerA),
          gte(recurringCashFlowOccurrenceExceptions.scheduledOccurrenceOn, "2099-01-24"),
          lte(recurringCashFlowOccurrenceExceptions.scheduledOccurrenceOn, "2099-02-28"),
        ));
      expect(restoredExceptions.every((row) => !row.isActive)).toBe(true);
      expect((await tx.select({ isActive: recurringCashFlowOccurrenceExceptions.isActive }).from(recurringCashFlowOccurrenceExceptions).where(and(eq(recurringCashFlowOccurrenceExceptions.ownerId, recurringOwnerA), eq(recurringCashFlowOccurrenceExceptions.scheduledOccurrenceOn, "2099-01-17"))))[0]).toEqual({ isActive: true });
      expect((await tx.select({ amountMinor: transactions.amountMinor }).from(transactions).where(and(eq(transactions.ownerId, recurringOwnerA), eq(transactions.recurringSeriesId, created.id), eq(transactions.scheduledOccurrenceOn, "2099-02-07"))))[0]).toMatchObject({ amountMinor: 1000 });

      const skip = await repository.applyRecurringOccurrenceException(recurringOwnerA, {
        seriesId: created.id,
        versionId,
        scheduledOccurrenceOn: "2099-03-07",
        scope: "only_this_occurrence",
        kind: "skip",
        dateOverride: null,
        amountOverrideMinor: null,
        accountOverrideId: null,
        statusOverride: null,
        note: "Skip one planned date",
      });
      expect(skip.exceptionIds).toHaveLength(1);
      expect((await repository.restoreRecurringOccurrence(recurringOwnerA, { seriesId: created.id, occurrenceId: skip.exceptionIds[0], overrideGroupId: null, scope: "occurrence" })).insertedCount).toBe(1);

      const [manualRow] = await tx.insert(transactions).values({
        ownerId: recurringOwnerA,
        accountId: recurringAccountA,
        recurringTransactionId: versionId,
        recurringSeriesId: created.id,
        scheduledOccurrenceOn: "2099-02-14",
        transactionDate: "2099-02-14",
        kind: "expense",
        status: "planned",
        isGenerated: false,
        description: "Manual recurring row",
        amountMinor: 777,
        currency: "CAD",
      }).returning({ id: transactions.id });
      expect(manualRow).toBeTruthy();
      const manualProtection = await repository.generateRecurringOccurrences(recurringOwnerA, created.id, { fromDate: "2099-02-14", throughDate: "2099-02-14" });
      expect(manualProtection.preservedCount).toBeGreaterThanOrEqual(1);
      expect((await tx.select({ amountMinor: transactions.amountMinor, isGenerated: transactions.isGenerated }).from(transactions).where(eq(transactions.id, manualRow!.id)))[0]).toEqual({ amountMinor: 777, isGenerated: false });
      const [excludedRow] = await tx.insert(transactions).values({
        ownerId: recurringOwnerA,
        accountId: recurringAccountA,
        recurringTransactionId: versionId,
        recurringSeriesId: created.id,
        scheduledOccurrenceOn: "2099-02-21",
        transactionDate: "2099-02-21",
        kind: "expense",
        status: "planned",
        isGenerated: false,
        isExcluded: true,
        description: "Excluded recurring row",
        amountMinor: 888,
        currency: "CAD",
      }).returning({ id: transactions.id });
      expect(excludedRow).toBeTruthy();

      const versioned = await repository.changeRecurringSeriesVersion(recurringOwnerA, {
        seriesId: created.id,
        name: "Weekly reserve renamed",
        kind: "expense",
        accountId: recurringAccountA,
        amountMinor: 1500,
        frequency: "weekly",
        startsOn: "2099-03-07",
        nextOccurrenceOn: "2099-03-07",
        endsOn: null,
        note: null,
        previousEndsOn: "2099-02-28",
        effectiveFrom: "2099-03-07",
        versionNote: "Future version",
      });
      expect(versioned.id).toBe(created.id);
      expect(versioned.versions).toHaveLength(2);
      expect(new Set(versioned.versions.map((version) => version.id)).size).toBe(2);
      expect((await tx.select({ description: transactions.description, amountMinor: transactions.amountMinor }).from(transactions).where(and(eq(transactions.ownerId, recurringOwnerA), eq(transactions.recurringSeriesId, created.id), gte(transactions.scheduledOccurrenceOn, "2099-03-07"))))).toEqual(expect.arrayContaining([{ description: "Weekly reserve renamed", amountMinor: 1500 }]));
      expect(versioned.versions).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Weekly reserve renamed", amountMinor: 1500 })]));
      const versionGeneration = await repository.generateRecurringOccurrences(recurringOwnerA, created.id, { fromDate: "2099-03-07", throughDate: "2099-03-21" });
      expect(versionGeneration).toMatchObject({ insertedCount: 0, updatedCount: 2, deletedCount: 0, preservedCount: 1 });

      const partiallyEdited = await repository.updateRecurringSeriesVersion(recurringOwnerA, created.id, versionId, {
        name: "Weekly reserve corrected",
        kind: "expense",
        accountId: recurringAccountA,
        amountMinor: 1250,
        frequency: "weekly",
        startsOn: "2099-01-10",
        endsOn: "2099-02-28",
        note: "Partial historical correction",
      });
      expect(partiallyEdited.versions).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: versionId, name: "Weekly reserve corrected", amountMinor: 1250, versionNote: "Partial historical correction" }),
      ]));
      expect((await tx.select({ amountMinor: transactions.amountMinor, description: transactions.description }).from(transactions).where(and(
        eq(transactions.ownerId, recurringOwnerA),
        eq(transactions.recurringSeriesId, created.id),
        eq(transactions.scheduledOccurrenceOn, "2099-01-10"),
      )))[0]).toEqual({ amountMinor: 1250, description: "Weekly reserve corrected" });
      expect((await tx.select({ amountMinor: transactions.amountMinor, transactionDate: transactions.transactionDate, description: transactions.description }).from(transactions).where(and(
        eq(transactions.ownerId, recurringOwnerA),
        eq(transactions.recurringSeriesId, created.id),
        eq(transactions.scheduledOccurrenceOn, "2099-01-17"),
      )))[0]).toEqual({ amountMinor: 2200, transactionDate: "2099-01-18", description: "Weekly reserve" });
      expect((await tx.select({ amountMinor: transactions.amountMinor, isGenerated: transactions.isGenerated }).from(transactions).where(eq(transactions.id, manualRow!.id)))[0]).toEqual({ amountMinor: 777, isGenerated: false });
      expect((await tx.select({ amountMinor: transactions.amountMinor, isGenerated: transactions.isGenerated, isExcluded: transactions.isExcluded }).from(transactions).where(eq(transactions.id, excludedRow!.id)))[0]).toEqual({ amountMinor: 888, isGenerated: false, isExcluded: true });
      const [editAudit] = await tx.select({ metadata: auditEvents.metadata }).from(auditEvents).where(and(
        eq(auditEvents.ownerId, recurringOwnerA),
        eq(auditEvents.entityType, "recurring_version"),
        eq(auditEvents.entityId, versionId),
        eq(auditEvents.action, "updated"),
      ));
      expect(editAudit?.metadata).toMatchObject({ operation: "recurring_version_edit", activeExceptionCount: 1, preservedCount: expect.any(Number) });
      await expect(repository.deleteRecurringSeriesVersion(recurringOwnerA, created.id, versionId)).rejects.toThrow("protected Cash Flow rows or active occurrence overrides");
      expect((await tx.select({ id: recurringTransactions.id }).from(recurringTransactions).where(and(eq(recurringTransactions.ownerId, recurringOwnerA), eq(recurringTransactions.id, versionId))))).toHaveLength(1);
      expect((await tx.select({ status: transactions.status, isExcluded: transactions.isExcluded }).from(transactions).where(inArray(transactions.id, [actualGeneratedRow!.id, manualRow!.id, excludedRow!.id])))).toEqual(expect.arrayContaining([
        { status: "actual", isExcluded: false },
        { status: "planned", isExcluded: false },
        { status: "planned", isExcluded: true },
      ]));

      const shiftedSeries = await repository.createRecurringSeries(recurringOwnerA, {
        name: "Shifted schedule",
        kind: "expense",
        accountId: recurringAccountA,
        amountMinor: 2000,
        frequency: "weekly",
        startsOn: "2099-04-02",
        nextOccurrenceOn: "2099-04-02",
        endsOn: null,
        note: null,
      });
      const shiftedVersion = await repository.changeRecurringSeriesVersion(recurringOwnerA, {
        seriesId: shiftedSeries.id,
        name: "Shifted schedule",
        kind: "expense",
        accountId: recurringAccountA,
        amountMinor: 2500,
        frequency: "weekly",
        startsOn: "2099-04-13",
        nextOccurrenceOn: "2099-04-13",
        endsOn: null,
        note: null,
        previousEndsOn: "2099-04-09",
        effectiveFrom: "2099-04-13",
        versionNote: "Moved payment weekday",
      });
      expect(shiftedVersion.versions).toEqual(expect.arrayContaining([
        expect.objectContaining({ startsOn: "2099-04-02", endsOn: "2099-04-09", effectiveTo: "2099-04-09" }),
        expect.objectContaining({ startsOn: "2099-04-13", effectiveFrom: "2099-04-13", amountMinor: 2500 }),
      ]));
      const shiftedVersionId = shiftedVersion.versions.find((version) => version.effectiveFrom === "2099-04-13")!.id;
      const editedShiftedVersion = await repository.updateRecurringSeriesVersion(recurringOwnerA, shiftedSeries.id, shiftedVersionId, {
        name: "Shifted schedule corrected",
        kind: "expense",
        accountId: recurringAccountA,
        amountMinor: 2750,
        frequency: "weekly",
        startsOn: "2099-04-13",
        endsOn: null,
        note: "Corrected historical amount",
      });
      expect(editedShiftedVersion.versions).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: shiftedVersionId, name: "Shifted schedule corrected", amountMinor: 2750, versionNote: "Corrected historical amount" }),
      ]));
      expect((await tx.select({ amountMinor: transactions.amountMinor, description: transactions.description }).from(transactions).where(and(
        eq(transactions.ownerId, recurringOwnerA),
        eq(transactions.recurringSeriesId, shiftedSeries.id),
        eq(transactions.recurringTransactionId, shiftedVersionId),
      )))).toEqual(expect.arrayContaining([{ amountMinor: 2750, description: "Shifted schedule corrected" }]));
      const shiftedRowsBeforeDelete = await tx.select({ id: transactions.id }).from(transactions).where(and(
        eq(transactions.ownerId, recurringOwnerA),
        eq(transactions.recurringSeriesId, shiftedSeries.id),
        eq(transactions.recurringTransactionId, shiftedVersionId),
      ));
      expect(shiftedRowsBeforeDelete.length).toBeGreaterThan(0);
      const deletedVersion = await repository.deleteRecurringSeriesVersion(recurringOwnerA, shiftedSeries.id, shiftedVersionId);
      expect(deletedVersion).toMatchObject({ seriesId: shiftedSeries.id, versionId: shiftedVersionId, transferCount: 0 });
      expect(deletedVersion.transactionCount).toBe(shiftedRowsBeforeDelete.length);
      expect(await tx.select({ id: recurringTransactions.id }).from(recurringTransactions).where(and(
        eq(recurringTransactions.ownerId, recurringOwnerA),
        eq(recurringTransactions.seriesId, shiftedSeries.id),
        eq(recurringTransactions.id, shiftedVersionId),
      ))).toEqual([]);
      expect(await tx.select({ id: transactions.id }).from(transactions).where(and(
        eq(transactions.ownerId, recurringOwnerA),
        eq(transactions.recurringSeriesId, shiftedSeries.id),
        eq(transactions.recurringTransactionId, shiftedVersionId),
      ))).toEqual([]);
      expect(await tx.select({ supersedesVersionId: recurringTransactions.supersedesVersionId }).from(recurringTransactions).where(and(
        eq(recurringTransactions.ownerId, recurringOwnerA),
        eq(recurringTransactions.seriesId, shiftedSeries.id),
      ))).toEqual([{ supersedesVersionId: null }]);
      expect((await tx.select({ metadata: auditEvents.metadata }).from(auditEvents).where(and(
        eq(auditEvents.ownerId, recurringOwnerA),
        eq(auditEvents.entityType, "recurring_version"),
        eq(auditEvents.entityId, shiftedVersionId),
        eq(auditEvents.action, "deleted"),
      )))[0]?.metadata).toMatchObject({ operation: "recurring_version_delete", seriesId: shiftedSeries.id, transactionCount: shiftedRowsBeforeDelete.length, transferCount: 0 });

      const ended = await repository.endRecurringSeries(recurringOwnerA, created.id, "2099-03-21");
      expect(ended.state).toBe("ended");
      expect(ended.versions).toHaveLength(2);
      await expect(repository.setRecurringSeriesState(recurringOwnerA, created.id, "active")).rejects.toThrow("ended");
      const audits = await tx.select({ entityType: auditEvents.entityType, metadata: auditEvents.metadata }).from(auditEvents).where(eq(auditEvents.ownerId, recurringOwnerA));
      expect(audits.some((audit) => audit.entityType === "recurring_series")).toBe(true);
      expect(audits.some((audit) => audit.entityType === "recurring_exception")).toBe(true);

      throw rollbackMarker;
    })).rejects.toThrow(rollbackMarker.message);
  });

  it("generates a new series through the owner period and safely handles no-period owners", async () => {
    if (!database) return;
    const createOwner = "00000000-0000-0000-0000-0000000000f3";
    const noPeriodOwner = "00000000-0000-0000-0000-0000000000f4";
    const createInstitution = "10000000-0000-4000-8000-0000000000f3";
    const noPeriodInstitution = "10000000-0000-4000-8000-0000000000f4";
    const sourceAccount = "20000000-0000-4000-8000-0000000000f3";
    const destinationAccount = "20000000-0000-4000-8000-0000000000f4";
    const noPeriodAccount = "20000000-0000-4000-8000-0000000000f5";
    const paydayPeriod = "30000000-0000-4000-8000-0000000000f3";
    const nextPeriod = "30000000-0000-4000-8000-0000000000f4";
    const rollbackMarker = new Error("recurring creation generation rollback");

    await expectIntegrationRollback(database.transaction(async (tx) => {
      await tx.insert(users).values([
        { id: createOwner, email: "recurring-create-owner@athena-vault.local" },
        { id: noPeriodOwner, email: "recurring-create-no-period@athena-vault.local" },
      ]);
      await tx.insert(institutions).values([
        { id: createInstitution, ownerId: createOwner, name: "Creation bank", currency: "CAD" },
        { id: noPeriodInstitution, ownerId: noPeriodOwner, name: "No-period bank", currency: "CAD" },
      ]);
      await tx.insert(accounts).values([
        { id: sourceAccount, ownerId: createOwner, institutionId: createInstitution, name: "Creation source", kind: "checking", currency: "CAD" },
        { id: destinationAccount, ownerId: createOwner, institutionId: createInstitution, name: "Creation destination", kind: "savings", currency: "CAD" },
        { id: noPeriodAccount, ownerId: noPeriodOwner, institutionId: noPeriodInstitution, name: "No-period account", kind: "checking", currency: "CAD" },
      ]);
      await tx.insert(cashFlowPeriods).values([
        { id: paydayPeriod, ownerId: createOwner, label: "Aug 5 payday", startsOn: "2026-07-23", endsOn: "2026-08-05", payDate: "2026-08-05", currency: "CAD", status: "actual" },
        { id: nextPeriod, ownerId: createOwner, label: "Aug 19 payday", startsOn: "2026-08-06", endsOn: "2026-08-19", payDate: "2026-08-19", currency: "CAD", status: "planned" },
      ]);

      const repository = createCashFlowRepository(tx as unknown as Database);
      const created = await repository.createRecurringSeries(createOwner, {
        name: "Transfert Maison",
        kind: "transfer",
        accountId: null,
        fromAccountId: sourceAccount,
        toAccountId: destinationAccount,
        amountMinor: 5000,
        frequency: "biweekly",
        weekdayAdjustment: "none",
        startsOn: "2026-08-06",
        nextOccurrenceOn: "2026-08-06",
        endsOn: null,
        note: null,
      });
      expect(created).toMatchObject({ firstOccurrenceOn: "2026-08-06", nextOccurrenceOn: "2026-08-20" });
      const generatedTransfers = await tx.select({ id: transfers.id, periodId: transfers.periodId, scheduledOccurrenceOn: transfers.scheduledOccurrenceOn, transferDate: transfers.transferDate, amountMinor: transfers.amountMinor }).from(transfers)
        .where(and(eq(transfers.ownerId, createOwner), eq(transfers.recurringSeriesId, created.id)));
      expect(generatedTransfers).toEqual([{ id: expect.any(String), periodId: paydayPeriod, scheduledOccurrenceOn: "2026-08-06", transferDate: "2026-08-06", amountMinor: 5000 }]);
      const [createAudit] = await tx.select({ metadata: auditEvents.metadata }).from(auditEvents)
        .where(and(eq(auditEvents.ownerId, createOwner), eq(auditEvents.entityId, created.id)));
      expect(createAudit?.metadata).toMatchObject({ operation: "recurring_series_create", insertedCount: 1, affectedTransferIds: [generatedTransfers[0]!.id], affectedTransactionIds: [] });

      await repository.updateRecurringSeriesEntirely(createOwner, created.id, {
        name: "Tidal",
        kind: "transfer",
        accountId: null,
        fromAccountId: sourceAccount,
        toAccountId: destinationAccount,
        amountMinor: 6200,
        frequency: "biweekly",
        weekdayAdjustment: "none",
        startsOn: "2026-08-06",
        endsOn: "2026-08-06",
        note: null,
      });
      expect(await tx.select({ scheduledOccurrenceOn: transfers.scheduledOccurrenceOn, amountMinor: transfers.amountMinor, status: transfers.status, isGenerated: transfers.isGenerated })
        .from(transfers)
        .where(and(eq(transfers.ownerId, createOwner), eq(transfers.recurringSeriesId, created.id))))
        .toEqual([{ scheduledOccurrenceOn: "2026-08-06", amountMinor: 6200, status: "planned", isGenerated: true }]);

      const adjustedSeries = await repository.createRecurringSeries(createOwner, {
        name: "August 15 expense",
        kind: "expense",
        accountId: sourceAccount,
        amountMinor: 2820,
        frequency: "monthly",
        weekdayAdjustment: "next_weekday",
        startsOn: "2026-08-15",
        nextOccurrenceOn: "2026-08-17",
        endsOn: null,
        note: null,
      });
      expect(adjustedSeries.versions[0]).toMatchObject({ startsOn: "2026-08-15", effectiveFrom: "2026-08-17", nextOccurrenceOn: "2026-09-15" });
      expect(await tx.select({ transactionDate: transactions.transactionDate, scheduledOccurrenceOn: transactions.scheduledOccurrenceOn }).from(transactions).where(eq(transactions.recurringSeriesId, adjustedSeries.id))).toEqual([{ transactionDate: "2026-08-17", scheduledOccurrenceOn: "2026-08-17" }]);

      const noPeriod = await repository.createRecurringSeries(noPeriodOwner, {
        name: "No-period expense",
        kind: "expense",
        accountId: noPeriodAccount,
        amountMinor: 1000,
        frequency: "biweekly",
        weekdayAdjustment: "none",
        startsOn: "2026-08-06",
        nextOccurrenceOn: "2026-08-06",
        endsOn: null,
        note: null,
      });
      expect(noPeriod).toMatchObject({ firstOccurrenceOn: "2026-08-06", nextOccurrenceOn: "2026-08-06" });
      expect(await tx.select({ id: transactions.id }).from(transactions).where(and(eq(transactions.ownerId, noPeriodOwner), eq(transactions.recurringSeriesId, noPeriod.id)))).toEqual([]);
      const [noPeriodAudit] = await tx.select({ metadata: auditEvents.metadata }).from(auditEvents)
        .where(and(eq(auditEvents.ownerId, noPeriodOwner), eq(auditEvents.entityId, noPeriod.id)));
      expect(noPeriodAudit?.metadata).toMatchObject({ operation: "recurring_series_create", generationThroughDate: null, insertedCount: 0, affectedTransactionIds: [], affectedTransferIds: [] });

      throw rollbackMarker;
    }), rollbackMarker);
  });

  it("renames every version and linked transaction without changing financial fields or provenance", async () => {
    if (!database) return;
    const renameOwner = "00000000-0000-0000-0000-0000000000f1";
    const otherOwner = "00000000-0000-0000-0000-0000000000f2";
    const renameInstitution = "10000000-0000-4000-8000-0000000000f1";
    const renameAccount = "20000000-0000-4000-8000-0000000000f1";
    const renameReserve = "20000000-0000-4000-8000-0000000000f2";
    const renamePeriod = "30000000-0000-4000-8000-0000000000f1";
    const renameSeries = "40000000-0000-4000-8000-0000000000f1";
    const renameVersionA = "41000000-0000-4000-8000-0000000000f1";
    const renameVersionB = "41000000-0000-4000-8000-0000000000f2";
    const renameTransactionPast = "42000000-0000-4000-8000-0000000000f1";
    const renameTransactionGenerated = "42000000-0000-4000-8000-0000000000f2";
    const renameTransferPast = "43000000-0000-4000-8000-0000000000f1";
    const renameTransferGenerated = "43000000-0000-4000-8000-0000000000f2";
    const rollbackMarker = new Error("recurring series rename integration rollback");

    await expect(database.transaction(async (tx) => {
      await tx.insert(users).values([
        { id: renameOwner, email: "recurring-series-rename-owner@athena-vault.local" },
        { id: otherOwner, email: "recurring-series-rename-other@athena-vault.local" },
      ]);
      await tx.insert(institutions).values({ id: renameInstitution, ownerId: renameOwner, name: "Rename bank", currency: "CAD" });
      await tx.insert(accounts).values([
        { id: renameAccount, ownerId: renameOwner, institutionId: renameInstitution, name: "Rename account", kind: "checking", currency: "CAD" },
        { id: renameReserve, ownerId: renameOwner, institutionId: renameInstitution, name: "Rename reserve", kind: "savings", currency: "CAD" },
      ]);
      await tx.insert(cashFlowPeriods).values({ id: renamePeriod, ownerId: renameOwner, label: "Rename horizon", startsOn: "2099-01-01", endsOn: "2099-12-31", payDate: "2099-12-31", currency: "CAD", status: "planned" });
      await tx.insert(recurringCashFlowSeries).values({ id: renameSeries, ownerId: renameOwner, kind: "expense", state: "active" });
      await tx.insert(recurringTransactions).values([
        { id: renameVersionA, ownerId: renameOwner, seriesId: renameSeries, accountId: renameAccount, kind: "expense", frequency: "monthly", weekdayAdjustment: "none", description: "Old recurring name", amountMinor: 1000, currency: "CAD", startsOn: "2099-01-01", endsOn: "2099-01-31", effectiveFrom: "2099-01-01", effectiveTo: "2099-01-31", nextOccurrenceOn: "2099-01-01", status: "planned" },
        { id: renameVersionB, ownerId: renameOwner, seriesId: renameSeries, supersedesVersionId: renameVersionA, accountId: renameAccount, kind: "expense", frequency: "monthly", weekdayAdjustment: "none", description: "Old recurring name v2", amountMinor: 1250, currency: "CAD", startsOn: "2099-02-01", effectiveFrom: "2099-02-01", nextOccurrenceOn: "2099-02-01", status: "planned" },
      ]);
      await tx.insert(transactions).values([
        { id: renameTransactionPast, ownerId: renameOwner, accountId: renameAccount, periodId: renamePeriod, recurringTransactionId: renameVersionA, recurringSeriesId: renameSeries, scheduledOccurrenceOn: "2099-01-01", transactionDate: "2099-01-01", kind: "expense", status: "actual", isGenerated: false, isExcluded: false, description: "Old recurring name", amountMinor: 1000, currency: "CAD" },
        { id: renameTransactionGenerated, ownerId: renameOwner, accountId: renameAccount, periodId: renamePeriod, recurringTransactionId: renameVersionB, recurringSeriesId: renameSeries, recurringOccurrenceId: "44000000-0000-4000-8000-0000000000f1", scheduledOccurrenceOn: "2099-02-01", transactionDate: "2099-02-01", kind: "expense", status: "planned", isGenerated: true, isExcluded: false, description: "Old recurring name v2", amountMinor: 1250, currency: "CAD" },
      ]);
      await tx.insert(transfers).values([
        { id: renameTransferPast, ownerId: renameOwner, periodId: renamePeriod, fromAccountId: renameAccount, toAccountId: renameReserve, recurringTransactionId: renameVersionA, recurringSeriesId: renameSeries, scheduledOccurrenceOn: "2099-01-15", transferDate: "2099-01-15", amountMinor: 500, currency: "CAD", status: "actual", isGenerated: false, description: "Old recurring name" },
        { id: renameTransferGenerated, ownerId: renameOwner, periodId: renamePeriod, fromAccountId: renameAccount, toAccountId: renameReserve, recurringTransactionId: renameVersionB, recurringSeriesId: renameSeries, recurringOccurrenceId: "44000000-0000-4000-8000-0000000000f2", scheduledOccurrenceOn: "2099-02-15", transferDate: "2099-02-15", amountMinor: 650, currency: "CAD", status: "planned", isGenerated: true, description: "Old recurring name v2" },
      ]);

      const repository = createCashFlowRepository(tx as unknown as Database);
      await expect(repository.renameRecurringSeries(otherOwner, renameSeries, "Wrong owner")).rejects.toThrow("not found");
      const before = await tx.select({ id: transactions.id, transactionDate: transactions.transactionDate, amountMinor: transactions.amountMinor, status: transactions.status, isGenerated: transactions.isGenerated, recurringSeriesId: transactions.recurringSeriesId }).from(transactions).where(eq(transactions.recurringSeriesId, renameSeries));
      const beforeTransfers = await tx.select({ id: transfers.id, transferDate: transfers.transferDate, amountMinor: transfers.amountMinor, status: transfers.status, isGenerated: transfers.isGenerated, recurringSeriesId: transfers.recurringSeriesId }).from(transfers).where(eq(transfers.recurringSeriesId, renameSeries));

      const result = await repository.renameRecurringSeries(renameOwner, renameSeries, "  New recurring name  ");

      expect(result).toMatchObject({ seriesId: renameSeries, oldNames: ["Old recurring name", "Old recurring name v2"], newName: "New recurring name", versionIds: [renameVersionA, renameVersionB], transactionIds: [renameTransactionPast, renameTransactionGenerated], transferIds: [renameTransferPast, renameTransferGenerated] });
      expect(await tx.select({ id: recurringTransactions.id, description: recurringTransactions.description }).from(recurringTransactions).where(eq(recurringTransactions.seriesId, renameSeries)).orderBy(recurringTransactions.effectiveFrom)).toEqual([
        { id: renameVersionA, description: "New recurring name" },
        { id: renameVersionB, description: "New recurring name" },
      ]);
      expect(await tx.select({ id: transactions.id, description: transactions.description }).from(transactions).where(eq(transactions.recurringSeriesId, renameSeries)).orderBy(transactions.id)).toEqual([
        { id: renameTransactionPast, description: "New recurring name" },
        { id: renameTransactionGenerated, description: "New recurring name" },
      ]);
      expect(await tx.select({ id: transfers.id, description: transfers.description }).from(transfers).where(eq(transfers.recurringSeriesId, renameSeries)).orderBy(transfers.id)).toEqual([
        { id: renameTransferPast, description: "New recurring name" },
        { id: renameTransferGenerated, description: "New recurring name" },
      ]);
      expect(await tx.select({ id: transactions.id, transactionDate: transactions.transactionDate, amountMinor: transactions.amountMinor, status: transactions.status, isGenerated: transactions.isGenerated, recurringSeriesId: transactions.recurringSeriesId }).from(transactions).where(eq(transactions.recurringSeriesId, renameSeries))).toEqual(before);
      expect(await tx.select({ id: transfers.id, transferDate: transfers.transferDate, amountMinor: transfers.amountMinor, status: transfers.status, isGenerated: transfers.isGenerated, recurringSeriesId: transfers.recurringSeriesId }).from(transfers).where(eq(transfers.recurringSeriesId, renameSeries))).toEqual(beforeTransfers);

      const audits = await tx.select({ metadata: auditEvents.metadata }).from(auditEvents).where(and(eq(auditEvents.ownerId, renameOwner), eq(auditEvents.entityType, "recurring_series"), eq(auditEvents.entityId, renameSeries)));
      const renameAudit = audits.find((audit) => audit.metadata.operation === "recurring_series_rename");
      expect(renameAudit?.metadata).toMatchObject({ oldNames: ["Old recurring name", "Old recurring name v2"], newName: "New recurring name", affectedVersionCount: 2, affectedTransactionCount: 2, affectedTransferCount: 2 });

      throw rollbackMarker;
    })).rejects.toThrow(rollbackMarker.message);
  });
});

describe.skipIf(!database)("account timeline repository", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-19T16:00:00.000Z"));
  });

  afterEach(() => vi.useRealTimers());

  it("reads, mutates, archives, restores, isolates, and rolls back account history", async () => {
    if (!database) return;
    const rollbackMarker = new Error("account-timeline integration rollback");

    await expectIntegrationRollback(database.transaction(async (tx) => {
      await tx.insert(users).values([
        { id: ownerA, email: "account-timeline-owner-a@athena-vault.local" },
        { id: ownerB, email: "account-timeline-owner-b@athena-vault.local" },
      ]);
      await tx.insert(cashFlowPeriods).values([
        { ownerId: ownerA, label: "Pay 1", startsOn: "2026-08-01", endsOn: "2026-08-05", payDate: "2026-08-05", currency: "CAD" },
        { ownerId: ownerA, label: "Pay 2", startsOn: "2026-08-06", endsOn: "2026-08-19", payDate: "2026-08-19", currency: "CAD" },
      ]);

      const repository = createAccountTimelineRepository(tx as unknown as Database);
      const created = await repository.createAccount(ownerA, {
        name: "Primary reserve",
        institutionName: "  CIBC  ",
        kind: "checking",
        lastFour: "4242",
        initialSnapshot: { asOf: "2026-08-05", balanceMinor: 12345, status: "actual" },
      });
      expect(created).toMatchObject({
        name: "Primary reserve",
        institution: "CIBC",
        kind: "checking",
        lastFour: "4242",
        isMainAccount: true,
        includeInAvailableCash: true,
        useCashFlowPlannedTimeline: true,
      });
      expect(created.snapshots).toMatchObject([
        { asOf: "2026-08-05", balanceMinor: 12345, status: "actual", isGenerated: false },
        { asOf: "2026-08-19", balanceMinor: 12345, status: "planned", isGenerated: true },
      ]);
      expect(created.selectedSnapshot).toMatchObject({ asOf: "2026-08-05", balanceMinor: 12345, status: "actual" });
      const updatedLastFour = await repository.updateAccount(ownerA, created.id, { name: "Primary reserve", institutionName: "CIBC", kind: "checking", lastFour: "7713" });
      expect(updatedLastFour.lastFour).toBe("7713");
      const clearedLastFour = await repository.updateAccount(ownerA, created.id, { name: "Primary reserve", institutionName: "CIBC", kind: "checking", lastFour: null });
      expect(clearedLastFour.lastFour).toBeNull();
      await expect(repository.updateAccount(ownerA, created.id, { name: "Primary reserve", institutionName: "CIBC", kind: "checking", lastFour: "123" })).rejects.toThrow("exactly four digits");

      const second = await repository.createAccount(ownerA, { name: "Future reserve", institutionName: "cibc", kind: "other", customTypeLabel: "Buffer" });
      expect(second.institutionId).toBe(created.institutionId);
      expect(second).toMatchObject({ isMainAccount: false, includeInAvailableCash: false, useCashFlowPlannedTimeline: false });
      await expect(repository.createAccount(ownerA, { name: "PRIMARY RESERVE", institutionName: "CIBC", kind: "checking" })).rejects.toThrow("already exists");

      const timeline = await repository.getTimeline(ownerA, { selectedDate: "2026-08-05" });
      expect(timeline.paydays).toEqual(["2026-08-05", "2026-08-19"]);
      expect(timeline.accounts).toHaveLength(2);
      expect(timeline.selectedValues[created.id]).toMatchObject({ balanceMinor: 12345, status: "actual" });

      const rdsp = await repository.createAccount(ownerA, { name: "Disability savings", institutionName: "CIBC", kind: "rdsp", lastFour: "a1b2" });
      expect(rdsp.lastFour).toBe("A1B2");
      await expect(repository.createAccount(ownerA, { name: "Invalid chequing identifier", institutionName: "CIBC", kind: "checking", lastFour: "A1B2" })).rejects.toThrow("exactly four digits");

      const [importedSnapshot] = await tx.select({ id: balanceSnapshots.id })
        .from(balanceSnapshots)
        .where(and(eq(balanceSnapshots.ownerId, ownerA), eq(balanceSnapshots.accountId, created.id), eq(balanceSnapshots.asOf, "2026-08-05")));
      if (!importedSnapshot) throw new Error("Expected imported account timeline snapshot.");
      await tx.insert(importBatches).values({
        id: "50000000-0000-4000-8000-0000000000f1",
        ownerId: ownerA,
        sourceFile: "account-timeline-test.xlsx",
        sourceFingerprint: "e".repeat(64),
        schemaVersion: "account-timeline-test",
        status: "dry_run",
        sourceSheetCount: 1,
        sourceCellCount: 1,
        sourceFormulaCount: 0,
      });
      await tx.insert(sourceReferences).values({
        ownerId: ownerA,
        importBatchId: "50000000-0000-4000-8000-0000000000f1",
        recordType: "balance_snapshot",
        recordId: importedSnapshot.id,
        sheetName: "Accounts",
        sourceAddress: "B2",
        mappingStatus: "imported",
      });
      await repository.upsertBalanceSnapshot(ownerA, created.id, { asOf: "2026-08-05", balanceMinor: 13000, status: "actual" });
      expect((await repository.getTimeline(ownerA, { selectedDate: "2026-08-05" })).selectedValues[created.id]).toMatchObject({ balanceMinor: 13000, status: "actual" });
      const [importedAudit] = await tx.select({ metadata: auditEvents.metadata }).from(auditEvents)
        .where(and(eq(auditEvents.ownerId, ownerA), eq(auditEvents.entityType, "balance_snapshot"), eq(auditEvents.entityId, importedSnapshot.id)));
      expect(importedAudit?.metadata).toMatchObject({ importedAnchorEdited: true });

      await repository.upsertBalanceSnapshot(ownerA, created.id, { asOf: "2026-08-19", balanceMinor: 20000, status: "planned" });
      expect((await repository.getTimeline(ownerA, { selectedDate: "2026-08-19" })).selectedValues[created.id]).toMatchObject({ balanceMinor: 20000, status: "planned" });
      expect((await repository.confirmPeriod(ownerA, "2026-08-19")).updatedCount).toBe(1);
      expect((await repository.getTimeline(ownerA, { selectedDate: "2026-08-19" })).selectedValues[created.id]).toMatchObject({ status: "actual" });

      await expect(repository.updateAccount(ownerB, created.id, { name: "Cross owner", institutionName: "CIBC", kind: "checking" })).rejects.toThrow("not found");
      await repository.archiveAccount(ownerA, created.id);
      expect((await repository.getTimeline(ownerA)).accounts.some((account) => account.id === created.id)).toBe(false);
      expect((await repository.getTimeline(ownerA, { includeArchived: true })).accounts.find((account) => account.id === created.id)?.isActive).toBe(false);
      await repository.restoreAccount(ownerA, created.id);
      expect((await repository.getTimeline(ownerA)).accounts.some((account) => account.id === created.id)).toBe(true);

      const included = await repository.updateAvailableCash(ownerA, created.id, true);
      expect(included).toMatchObject({
        id: created.id,
        name: "Primary reserve",
        kind: "checking",
        includeInAvailableCash: true,
      });
      const preservedRows = await tx.select({ name: accounts.name, kind: accounts.kind, balanceMinor: balanceSnapshots.balanceMinor })
        .from(accounts)
        .leftJoin(balanceSnapshots, and(eq(balanceSnapshots.accountId, accounts.id), eq(balanceSnapshots.ownerId, ownerA), eq(balanceSnapshots.asOf, "2026-08-05")))
        .where(and(eq(accounts.ownerId, ownerA), eq(accounts.id, created.id)));
      expect(preservedRows).toEqual([{ name: "Primary reserve", kind: "checking", balanceMinor: 13000 }]);
      const availabilityAudit = await tx.select({ metadata: auditEvents.metadata })
        .from(auditEvents)
        .where(and(eq(auditEvents.ownerId, ownerA), eq(auditEvents.entityId, created.id)))
        .orderBy(auditEvents.createdAt);
      expect(availabilityAudit.at(-1)?.metadata).toMatchObject({ operation: "available_cash_inclusion", includeInAvailableCash: true });
      await expect(repository.updateAvailableCash(ownerB, created.id, false)).rejects.toThrow("Account not found");

      const plannedTimeline = await repository.updateCashFlowPlannedTimeline(ownerA, created.id, true);
      expect(plannedTimeline).toMatchObject({
        id: created.id,
        useCashFlowPlannedTimeline: true,
      });
      const plannedTimelineAudit = await tx.select({ metadata: auditEvents.metadata })
        .from(auditEvents)
        .where(and(eq(auditEvents.ownerId, ownerA), eq(auditEvents.entityId, created.id)))
        .orderBy(auditEvents.createdAt);
      expect(plannedTimelineAudit.at(-1)?.metadata).toMatchObject({
        operation: "cash_flow_planned_timeline",
        useCashFlowPlannedTimeline: true,
      });
      await expect(repository.updateCashFlowPlannedTimeline(ownerB, created.id, false)).rejects.toThrow("Account not found");

      const disposable = await repository.createAccount(ownerA, {
        name: "Disposable empty",
        institutionName: "CIBC",
        kind: "checking",
      });
      await repository.deleteAccount(ownerA, disposable.id);
      expect((await repository.getTimeline(ownerA, { includeArchived: true })).accounts.some((account) => account.id === disposable.id)).toBe(false);
      const deleteAudit = await tx.select({ action: auditEvents.action, metadata: auditEvents.metadata })
        .from(auditEvents)
        .where(and(eq(auditEvents.ownerId, ownerA), eq(auditEvents.entityId, disposable.id)))
        .orderBy(auditEvents.createdAt);
      expect(deleteAudit.at(-1)).toMatchObject({ action: "deleted", metadata: { operation: "delete", name: "Disposable empty" } });

      const blocked = await repository.createAccount(ownerA, {
        name: "Blocked by transfer",
        institutionName: "CIBC",
        kind: "checking",
      });
      await tx.insert(transfers).values({
        ownerId: ownerA,
        fromAccountId: created.id,
        toAccountId: blocked.id,
        transferDate: "2026-08-10",
        amountMinor: 100,
        status: "planned",
        description: "Block delete",
        currency: "CAD",
      });
      await expect(repository.deleteAccount(ownerA, blocked.id)).rejects.toThrow("transfers still reference it");
      await expect(repository.deleteAccount(ownerB, created.id)).rejects.toThrow("Account not found");

      const recurringBlocked = await repository.createAccount(ownerA, {
        name: "Blocked by recurring account",
        institutionName: "CIBC",
        kind: "checking",
      });
      const recurringSeriesId = "60000000-0000-4000-8000-0000000000f9";
      const recurringVersionId = "60000000-0000-4000-8000-0000000000fa";
      await tx.insert(recurringCashFlowSeries).values({ id: recurringSeriesId, ownerId: ownerA, kind: "expense", state: "active" });
      await tx.insert(recurringTransactions).values({
        id: recurringVersionId,
        ownerId: ownerA,
        seriesId: recurringSeriesId,
        accountId: recurringBlocked.id,
        kind: "expense",
        frequency: "monthly",
        description: "Recurring account link",
        amountMinor: 100,
        startsOn: "2026-08-10",
        effectiveFrom: "2026-08-10",
        nextOccurrenceOn: "2026-08-10",
        currency: "CAD",
      });
      await expect(repository.deleteAccount(ownerA, recurringBlocked.id)).rejects.toThrow("recurring transaction version references it");

      throw rollbackMarker;
    }), rollbackMarker);
  });

  it("confirms historical/current periods, rejects future confirmation, and keeps future overrides planned", async () => {
    if (!database) return;
    const owner = "00000000-0000-4000-8000-0000000000f1";
    const institution = "10000000-0000-4000-8000-0000000000f1";
    const account = "20000000-0000-4000-8000-0000000000f1";
    const historicalPeriod = "30000000-0000-4000-8000-0000000000f1";
    const currentPeriod = "30000000-0000-4000-8000-0000000000f2";
    const futurePeriod = "30000000-0000-4000-8000-0000000000f3";
    const historicalSnapshot = "40000000-0000-4000-8000-0000000000f1";
    const currentSnapshot = "40000000-0000-4000-8000-0000000000f2";
    const futureSnapshot = "40000000-0000-4000-8000-0000000000f3";
    const todayIso = toTorontoDateIso();
    const historicalPayday = addIsoDays(todayIso, -14);
    const futurePayday = addIsoDays(todayIso, 14);
    const rollbackMarker = new Error("account timeline status rule rollback");

    await expect(database.transaction(async (tx) => {
      await tx.insert(users).values({ id: owner, email: "account-timeline-status-rule@athena-vault.local" });
      await tx.insert(institutions).values({ id: institution, ownerId: owner, name: "Status rule bank", currency: "CAD" });
      await tx.insert(accounts).values({ id: account, ownerId: owner, institutionId: institution, name: "Status rule account", kind: "savings", currency: "CAD" });
      await tx.insert(cashFlowPeriods).values([
        { id: historicalPeriod, ownerId: owner, label: "Historical status period", startsOn: historicalPayday, endsOn: addIsoDays(todayIso, -1), payDate: historicalPayday, currency: "CAD", status: "actual" },
        { id: currentPeriod, ownerId: owner, label: "Current status period", startsOn: todayIso, endsOn: addIsoDays(futurePayday, -1), payDate: todayIso, currency: "CAD", status: "actual" },
        { id: futurePeriod, ownerId: owner, label: "Future status period", startsOn: futurePayday, endsOn: addIsoDays(futurePayday, 13), payDate: futurePayday, currency: "CAD", status: "planned" },
      ]);
      await tx.insert(balanceSnapshots).values([
        { id: historicalSnapshot, ownerId: owner, accountId: account, asOf: historicalPayday, balanceMinor: 10000, status: "planned", isGenerated: true, currency: "CAD" },
        { id: currentSnapshot, ownerId: owner, accountId: account, asOf: todayIso, balanceMinor: 11000, status: "planned", isGenerated: true, currency: "CAD" },
        { id: futureSnapshot, ownerId: owner, accountId: account, asOf: futurePayday, balanceMinor: 12000, status: "planned", isGenerated: true, currency: "CAD" },
      ]);

      const repository = createAccountTimelineRepository(tx as unknown as Database);
      expect(await repository.confirmPeriod(owner, historicalPayday)).toEqual({ updatedCount: 1 });
      expect(await repository.confirmPeriod(owner, todayIso)).toEqual({ updatedCount: 1 });
      await expect(repository.confirmPeriod(owner, futurePayday)).rejects.toThrow("Future pay periods must remain Projected.");
      await expect(repository.upsertBalanceSnapshot(owner, account, { asOf: futurePayday, balanceMinor: 12500, status: "actual" })).rejects.toThrow("Future pay periods must remain Projected.");

      const override = await repository.upsertBalanceSnapshot(owner, account, { asOf: futurePayday, balanceMinor: 12500, status: "planned", note: "Projected manual override" });
      expect(override).toMatchObject({ asOf: futurePayday, balanceMinor: 12500, status: "planned", note: "Projected manual override" });
      expect(await tx.select({ asOf: balanceSnapshots.asOf, balanceMinor: balanceSnapshots.balanceMinor, status: balanceSnapshots.status })
        .from(balanceSnapshots)
        .where(and(eq(balanceSnapshots.ownerId, owner), eq(balanceSnapshots.accountId, account)))
        .orderBy(asc(balanceSnapshots.asOf))).toEqual([
        { asOf: historicalPayday, balanceMinor: 10000, status: "actual" },
        { asOf: todayIso, balanceMinor: 11000, status: "actual" },
        { asOf: futurePayday, balanceMinor: 12500, status: "planned" },
      ]);

      throw rollbackMarker;
    })).rejects.toThrow(rollbackMarker.message);
  });
});

describe.skipIf(!database)("account ordering repository", () => {
  it("persists order within a section and rejects cross-section moves", async () => {
    if (!database) return;
    const orderGroup = "30000000-0000-4000-8000-0000000000aa";
    const orderInstitution = "30000000-0000-4000-8000-0000000000ab";
    const liquidFirst = "30000000-0000-4000-8000-0000000000ac";
    const liquidSecond = "30000000-0000-4000-8000-0000000000ad";
    const reserveAccount = "30000000-0000-4000-8000-0000000000ae";
    const reserveSecond = "30000000-0000-4000-8000-0000000000af";
    const rollbackMarker = new Error("account ordering integration rollback");

    await expect(database.transaction(async (tx) => {
      await tx.insert(users).values({ id: ownerA, email: "account-ordering-owner-a@athena-vault.local" });
      await tx.insert(institutions).values({ id: orderInstitution, ownerId: ownerA, name: "Ordering bank", currency: "CAD" });
      await tx.insert(accountGroups).values({ id: orderGroup, ownerId: ownerA, name: "Reserve accounts" });
      await tx.insert(accounts).values([
        { id: liquidFirst, ownerId: ownerA, institutionId: orderInstitution, name: "First liquid", kind: "checking", timelineOrder: 0, currency: "CAD" },
        { id: liquidSecond, ownerId: ownerA, institutionId: orderInstitution, name: "Second liquid", kind: "savings", timelineOrder: 1, currency: "CAD" },
        { id: reserveAccount, ownerId: ownerA, institutionId: orderInstitution, groupId: orderGroup, name: "Reserve", kind: "other", timelineOrder: 0, customTypeLabel: "Reserve", currency: "CAD" },
        { id: reserveSecond, ownerId: ownerA, institutionId: orderInstitution, groupId: orderGroup, name: "Reserve two", kind: "other", timelineOrder: 1, customTypeLabel: " reserve ", currency: "CAD" },
      ]);

      const repository = createAccountTimelineRepository(tx as unknown as Database);
      await expect(repository.reorderAccounts(ownerA, "liquid", [liquidSecond, liquidFirst])).resolves.toMatchObject({
        section: "liquid",
        accountIds: [liquidSecond, liquidFirst],
      });
      const liquidRows = await tx.select({ id: accounts.id, timelineOrder: accounts.timelineOrder })
        .from(accounts)
        .where(and(eq(accounts.ownerId, ownerA), inArray(accounts.id, [liquidFirst, liquidSecond])))
        .orderBy(accounts.timelineOrder);
      expect(liquidRows).toEqual([
        { id: liquidSecond, timelineOrder: 0 },
        { id: liquidFirst, timelineOrder: 1 },
      ]);

      await expect(repository.reorderAccounts(ownerA, "liquid", [reserveAccount])).rejects.toThrow("inside their current section");
      await expect(repository.reorderAccounts(ownerB, "other:reserve", [reserveAccount])).rejects.toThrow("Account not found");
      await expect(repository.reorderAccounts(ownerA, "other:reserve", [reserveSecond, reserveAccount])).resolves.toMatchObject({
        section: "other:reserve",
        accountIds: [reserveSecond, reserveAccount],
      });

      throw rollbackMarker;
    })).rejects.toThrow(rollbackMarker.message);
  });
});

describe.skipIf(!database)("account contribution timeline repository", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-05T16:00:00.000Z"));
  });

  afterEach(() => vi.useRealTimers());

  it("isolates rules, applies exceptions, preserves anchors, and extends periods transactionally", async () => {
    if (!database) return;
    const contributionOwnerA = "00000000-0000-0000-0000-0000000000ca";
    const contributionOwnerB = "00000000-0000-0000-0000-0000000000cb";
    const institutionA = "10000000-0000-4000-8000-0000000000ca";
    const institutionB = "10000000-0000-4000-8000-0000000000cb";
    const accountA = "20000000-0000-4000-8000-0000000000ca";
    const accountB = "20000000-0000-4000-8000-0000000000cb";
    const rollbackMarker = new Error("account contribution integration rollback");

    await expectIntegrationRollback(database.transaction(async (tx) => {
      await tx.insert(users).values([
        { id: contributionOwnerA, email: "contribution-owner-a@athena-vault.local" },
        { id: contributionOwnerB, email: "contribution-owner-b@athena-vault.local" },
      ]);
      await tx.insert(institutions).values([
        { id: institutionA, ownerId: contributionOwnerA, name: "Contribution bank A", currency: "CAD" },
        { id: institutionB, ownerId: contributionOwnerB, name: "Contribution bank B", currency: "CAD" },
      ]);
      await tx.insert(accounts).values([
        { id: accountA, ownerId: contributionOwnerA, institutionId: institutionA, name: "Reserve A", kind: "checking", currency: "CAD" },
        { id: accountB, ownerId: contributionOwnerB, institutionId: institutionB, name: "Reserve B", kind: "checking", currency: "CAD" },
      ]);
      await tx.insert(cashFlowPeriods).values([
        { ownerId: contributionOwnerA, label: "Pay period 2026-08-05", startsOn: "2026-07-23", endsOn: "2026-08-05", payDate: "2026-08-05", openingBalanceMinor: 0, currency: "CAD", status: "actual" },
        { ownerId: contributionOwnerA, label: "Pay period 2026-08-19", startsOn: "2026-08-06", endsOn: "2026-08-19", payDate: "2026-08-19", openingBalanceMinor: 0, currency: "CAD", status: "planned" },
        { ownerId: contributionOwnerA, label: "Pay period 2026-09-02", startsOn: "2026-08-20", endsOn: "2026-09-02", payDate: "2026-09-02", openingBalanceMinor: 0, currency: "CAD", status: "planned" },
        { ownerId: contributionOwnerA, label: "Pay period 2026-09-16", startsOn: "2026-09-03", endsOn: "2026-09-16", payDate: "2026-09-16", openingBalanceMinor: 0, currency: "CAD", status: "planned" },
      ]);
      await tx.insert(balanceSnapshots).values([
        { ownerId: contributionOwnerA, accountId: accountA, asOf: "2026-08-05", balanceMinor: 10000, status: "actual", isGenerated: false, currency: "CAD" },
        { ownerId: contributionOwnerA, accountId: accountA, asOf: "2026-08-19", balanceMinor: 10000, status: "planned", isGenerated: true, currency: "CAD" },
        { ownerId: contributionOwnerA, accountId: accountA, asOf: "2026-09-02", balanceMinor: 10000, status: "planned", isGenerated: true, currency: "CAD" },
        { ownerId: contributionOwnerA, accountId: accountA, asOf: "2026-09-16", balanceMinor: 10000, status: "planned", isGenerated: true, currency: "CAD" },
      ]);

      const repository = createAccountTimelineRepository(tx as unknown as Database);
      const saved = await repository.saveContributionRule(contributionOwnerA, {
        accountId: accountA,
        amountMinor: 500,
        frequency: "biweekly",
        startsOn: "2026-08-10",
        endsOn: null,
        isEnabled: true,
      }, "from_rule_start");
      expect(saved).toMatchObject({ amountMinor: 500, frequency: "biweekly", nextOccurrenceOn: "2026-08-10" });
      expect((await repository.getTimeline(contributionOwnerA, { selectedDate: "2026-09-16" })).accounts[0]?.contributionRules).toHaveLength(1);

      let rows = await tx.select({ asOf: balanceSnapshots.asOf, balanceMinor: balanceSnapshots.balanceMinor, status: balanceSnapshots.status, isGenerated: balanceSnapshots.isGenerated })
        .from(balanceSnapshots).where(eq(balanceSnapshots.accountId, accountA)).orderBy(balanceSnapshots.asOf);
      expect(rows).toMatchObject([
        { asOf: "2026-08-05", balanceMinor: 10000, status: "actual", isGenerated: false },
        { asOf: "2026-08-19", balanceMinor: 10500, isGenerated: true },
        { asOf: "2026-09-02", balanceMinor: 11000, isGenerated: true },
        { asOf: "2026-09-16", balanceMinor: 11500, isGenerated: true },
      ]);

      await expect(repository.saveContributionRule(contributionOwnerB, { ...saved, accountId: accountA, isEnabled: true }, "rule_only")).rejects.toThrow("Account not found");
      await expect(repository.updateContributionExceptions(contributionOwnerB, { ruleId: saved.id, occurrenceDates: ["2026-08-10"], kind: "skip" })).rejects.toThrow("Contribution rule not found");

      await repository.updateContributionExceptions(contributionOwnerA, { ruleId: saved.id, occurrenceDates: ["2026-08-10"], kind: "skip" });
      rows = await tx.select({ asOf: balanceSnapshots.asOf, balanceMinor: balanceSnapshots.balanceMinor, status: balanceSnapshots.status, isGenerated: balanceSnapshots.isGenerated }).from(balanceSnapshots).where(eq(balanceSnapshots.accountId, accountA)).orderBy(balanceSnapshots.asOf);
      expect(rows.find((row) => row.asOf === "2026-08-19")).toMatchObject({ balanceMinor: 10000 });
      expect(rows.find((row) => row.asOf === "2026-09-02")).toMatchObject({ balanceMinor: 10500 });

      await repository.updateContributionExceptions(contributionOwnerA, { ruleId: saved.id, occurrenceDates: ["2026-08-10"], kind: "override", amountMinor: 2000 });
      rows = await tx.select({ asOf: balanceSnapshots.asOf, balanceMinor: balanceSnapshots.balanceMinor, status: balanceSnapshots.status, isGenerated: balanceSnapshots.isGenerated }).from(balanceSnapshots).where(eq(balanceSnapshots.accountId, accountA)).orderBy(balanceSnapshots.asOf);
      expect(rows.find((row) => row.asOf === "2026-08-19")).toMatchObject({ balanceMinor: 12000 });
      expect(rows.find((row) => row.asOf === "2026-09-02")).toMatchObject({ balanceMinor: 12500 });

      await repository.upsertBalanceSnapshot(contributionOwnerA, accountA, { asOf: "2026-09-02", balanceMinor: 99999, status: "planned" });
      await repository.saveContributionRule(contributionOwnerA, { ...saved, amountMinor: 500 }, "all_future");
      rows = await tx.select({ asOf: balanceSnapshots.asOf, balanceMinor: balanceSnapshots.balanceMinor, status: balanceSnapshots.status, isGenerated: balanceSnapshots.isGenerated }).from(balanceSnapshots).where(eq(balanceSnapshots.accountId, accountA)).orderBy(balanceSnapshots.asOf);
      expect(rows.find((row) => row.asOf === "2026-09-02")).toMatchObject({ balanceMinor: 99999, isGenerated: false });
      expect(rows.find((row) => row.asOf === "2026-09-16")).toMatchObject({ balanceMinor: 100499, isGenerated: true });

      const extension = await repository.extendTimeline(contributionOwnerA, "2026-09-30");
      expect(extension).toMatchObject({ periodsCreated: 1, snapshotsCreated: 1 });
      expect((await tx.select({ asOf: balanceSnapshots.asOf, balanceMinor: balanceSnapshots.balanceMinor, isGenerated: balanceSnapshots.isGenerated }).from(balanceSnapshots).where(and(eq(balanceSnapshots.accountId, accountA), eq(balanceSnapshots.asOf, "2026-09-30"))))[0]).toMatchObject({ balanceMinor: 100999, isGenerated: true });

      throw rollbackMarker;
    }), rollbackMarker);
  });
});

describe.skipIf(!database)("account projection repair repository", () => {
  it("carries initial balances forward, repairs missing future rows, preserves anchors, and scopes all-account work", async () => {
    if (!database) return;
    const projectionOwnerA = "00000000-0000-0000-0000-0000000000da";
    const projectionOwnerB = "00000000-0000-0000-0000-0000000000db";
    const projectionInstitutionA = "10000000-0000-4000-8000-0000000000da";
    const projectionInstitutionB = "10000000-0000-4000-8000-0000000000db";
    const projectionAccountB = "20000000-0000-4000-8000-0000000000db";
    const rollbackMarker = new Error("account projection repair integration rollback");

    await expectIntegrationRollback(database.transaction(async (tx) => {
      await tx.insert(users).values([
        { id: projectionOwnerA, email: "projection-repair-owner-a@athena-vault.local" },
        { id: projectionOwnerB, email: "projection-repair-owner-b@athena-vault.local" },
      ]);
      await tx.insert(institutions).values([
        { id: projectionInstitutionA, ownerId: projectionOwnerA, name: "Projection bank A", currency: "CAD" },
        { id: projectionInstitutionB, ownerId: projectionOwnerB, name: "Projection bank B", currency: "CAD" },
      ]);
      await tx.insert(accounts).values([
        { id: projectionAccountB, ownerId: projectionOwnerB, institutionId: projectionInstitutionB, name: "Other owner", kind: "checking", currency: "CAD" },
      ]);
      await tx.insert(cashFlowPeriods).values([
        { ownerId: projectionOwnerA, label: "Pay period 2099-01-05", startsOn: "2098-12-23", endsOn: "2099-01-05", payDate: "2099-01-05", openingBalanceMinor: 0, currency: "CAD", status: "actual" },
        { ownerId: projectionOwnerA, label: "Pay period 2099-01-19", startsOn: "2099-01-06", endsOn: "2099-01-19", payDate: "2099-01-19", openingBalanceMinor: 0, currency: "CAD", status: "planned" },
        { ownerId: projectionOwnerA, label: "Pay period 2099-02-02", startsOn: "2099-01-20", endsOn: "2099-02-02", payDate: "2099-02-02", openingBalanceMinor: 0, currency: "CAD", status: "planned" },
        { ownerId: projectionOwnerA, label: "Pay period 2099-02-16", startsOn: "2099-02-03", endsOn: "2099-02-16", payDate: "2099-02-16", openingBalanceMinor: 0, currency: "CAD", status: "planned" },
        { ownerId: projectionOwnerA, label: "Pay period 2099-03-02", startsOn: "2099-02-17", endsOn: "2099-03-02", payDate: "2099-03-02", openingBalanceMinor: 0, currency: "CAD", status: "planned" },
      ]);
      await tx.insert(cashFlowPeriods).values({
        ownerId: projectionOwnerB,
        label: "Pay period 2099-01-05",
        startsOn: "2098-12-23",
        endsOn: "2099-01-05",
        payDate: "2099-01-05",
        openingBalanceMinor: 0,
        currency: "CAD",
        status: "actual",
      });

      const repository = createAccountTimelineRepository(tx as unknown as Database);
      const created = await repository.createAccount(projectionOwnerA, {
        name: "Projection reserve",
        institutionName: "Projection bank A",
        kind: "checking",
        initialSnapshot: { asOf: "2099-01-05", balanceMinor: 10000, status: "actual" },
      });
      expect(created.snapshots).toMatchObject([
        { asOf: "2099-01-05", balanceMinor: 10000, status: "actual", isGenerated: false },
        { asOf: "2099-01-19", balanceMinor: 10000, status: "planned", isGenerated: true },
        { asOf: "2099-02-02", balanceMinor: 10000, status: "planned", isGenerated: true },
        { asOf: "2099-02-16", balanceMinor: 10000, status: "planned", isGenerated: true },
        { asOf: "2099-03-02", balanceMinor: 10000, status: "planned", isGenerated: true },
      ]);
      await repository.updateCashFlowPlannedTimeline(projectionOwnerA, created.id, false);

      const noAnchor = await repository.createAccount(projectionOwnerA, {
        name: "No anchor reserve",
        institutionName: "Projection bank A",
        kind: "savings",
      });
      expect(noAnchor.snapshots).toEqual([]);
      await expect(repository.recalculateAccountProjections(projectionOwnerB, created.id)).rejects.toThrow("Account not found");

      const rule = await repository.saveContributionRule(projectionOwnerA, {
        accountId: created.id,
        amountMinor: 500,
        frequency: "biweekly",
        startsOn: "2099-01-10",
        endsOn: null,
        isEnabled: true,
      }, "from_rule_start");
      await repository.updateContributionExceptions(projectionOwnerA, {
        ruleId: rule.id,
        occurrenceDates: ["2099-01-10"],
        kind: "override",
        amountMinor: 1000,
      });
      await repository.upsertBalanceSnapshot(projectionOwnerA, created.id, { asOf: "2099-02-16", balanceMinor: 50000, status: "planned" });
      await tx.delete(balanceSnapshots)
        .where(and(eq(balanceSnapshots.ownerId, projectionOwnerA), eq(balanceSnapshots.accountId, created.id), eq(balanceSnapshots.asOf, "2099-02-02")));

      const repaired = await repository.recalculateAccountProjections(projectionOwnerA, created.id);
      expect(repaired).toMatchObject({ accountCount: 1, snapshotsCreated: 1, snapshotsUpdated: 0 });
      const repairedRows = await tx.select({ asOf: balanceSnapshots.asOf, balanceMinor: balanceSnapshots.balanceMinor, status: balanceSnapshots.status, isGenerated: balanceSnapshots.isGenerated })
        .from(balanceSnapshots)
        .where(and(eq(balanceSnapshots.ownerId, projectionOwnerA), eq(balanceSnapshots.accountId, created.id)))
        .orderBy(balanceSnapshots.asOf);
      expect(repairedRows).toMatchObject([
        { asOf: "2099-01-05", balanceMinor: 10000, status: "actual", isGenerated: false },
        { asOf: "2099-01-19", balanceMinor: 11000, status: "planned", isGenerated: true },
        { asOf: "2099-02-02", balanceMinor: 11500, status: "planned", isGenerated: true },
        { asOf: "2099-02-16", balanceMinor: 50000, status: "planned", isGenerated: false },
        { asOf: "2099-03-02", balanceMinor: 50500, status: "planned", isGenerated: true },
      ]);

      const all = await repository.recalculateAllAccountProjections(projectionOwnerA);
      expect(all).toMatchObject({ accountCount: 2, snapshotsCreated: 0, snapshotsUpdated: 0 });
      const otherOwnerRows = await tx.select({ accountId: balanceSnapshots.accountId, balanceMinor: balanceSnapshots.balanceMinor })
        .from(balanceSnapshots)
        .where(eq(balanceSnapshots.ownerId, projectionOwnerB));
      expect(otherOwnerRows).toEqual([]);
      expect((await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.ownerId, projectionOwnerA), eq(accounts.id, noAnchor.id))))).toHaveLength(1);

      throw rollbackMarker;
    }), rollbackMarker);
  });
});

describe.skipIf(!database)("account timeline status boundary", () => {
  it("classifies every synthetic canonical snapshot by the source-date boundary", async () => {
    if (!database) return;
    const boundary = "2026-08-05";
    const dates = [
      "2026-06-10", "2026-06-24", "2026-07-08", "2026-07-22", "2026-08-05", "2026-08-19",
      "2026-09-02", "2026-09-16", "2026-09-30", "2026-10-14", "2026-10-28", "2026-11-11",
    ];
    const rollbackMarker = new Error("synthetic source-date boundary rollback");

    await expectIntegrationRollback(database.transaction(async (tx) => {
      const ownerId = randomUUID();
      const institutionId = randomUUID();
      const importBatchId = randomUUID();
      const accountIds = Array.from({ length: 12 }, () => randomUUID());
      const sourceFingerprint = `${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "")}`;

      await tx.insert(users).values({ id: ownerId, email: `status-boundary-${ownerId}@athena-vault.local` });
      await tx.insert(institutions).values({ id: institutionId, ownerId, name: "Synthetic source institution", currency: "CAD" });
      await tx.insert(accounts).values(accountIds.map((id, index) => ({
        id,
        ownerId,
        institutionId,
        name: `Synthetic source account ${index + 1}`,
        kind: "checking" as const,
        currency: "CAD" as const,
      })));

      const snapshots = accountIds.flatMap((accountId, accountIndex) => dates.map((asOf, dateIndex) => ({
        id: randomUUID(),
        ownerId,
        accountId,
        asOf,
        balanceMinor: 100_000 + accountIndex * 10_000 + dateIndex * 100,
        status: (asOf <= boundary ? "actual" : "planned") as "actual" | "planned",
        isGenerated: false,
        currency: "CAD" as const,
      })));

      await tx.insert(importBatches).values({
        id: importBatchId,
        ownerId,
        sourceFile: "synthetic-status-boundary.xlsx",
        sourceFingerprint,
        schemaVersion: "synthetic-status-boundary",
        status: "accepted",
        sourceSheetCount: 1,
        sourceCellCount: snapshots.length,
        sourceFormulaCount: 0,
        startedAt: new Date("2026-08-05T12:00:00.000Z"),
        completedAt: new Date("2026-08-05T13:00:00.000Z"),
        acceptedAt: new Date("2026-08-05T13:00:00.000Z"),
      });
      await tx.insert(balanceSnapshots).values(snapshots);
      await tx.insert(sourceReferences).values(snapshots.map((snapshot, index) => ({
        ownerId,
        importBatchId,
        recordType: "balance_snapshot",
        recordId: snapshot.id,
        sheetName: "Synthetic Accounts",
        sourceAddress: `A${index + 1}`,
        mappingStatus: "imported" as const,
      })));

      const canonicalSourceRows = await tx
        .select({ recordId: sourceReferences.recordId })
        .from(sourceReferences)
        .where(and(eq(sourceReferences.importBatchId, importBatchId), eq(sourceReferences.recordType, "balance_snapshot")));
      const canonicalRecordIds = canonicalSourceRows.map((row) => row.recordId);
      const rows = await tx
        .select({ asOf: balanceSnapshots.asOf, status: balanceSnapshots.status })
        .from(balanceSnapshots)
        .where(inArray(balanceSnapshots.id, canonicalRecordIds));

      expect(rows).toHaveLength(144);
      expect(rows.filter((row) => row.status === "actual")).toHaveLength(rows.filter((row) => row.asOf <= boundary).length);
      expect(rows.filter((row) => row.status === "planned")).toHaveLength(rows.filter((row) => row.asOf > boundary).length);
      expect(rows.every((row) => row.status === (row.asOf <= boundary ? "actual" : "planned"))).toBe(true);

      const byDate = new Map<string, typeof rows>();
      for (const row of rows) byDate.set(row.asOf, [...(byDate.get(row.asOf) ?? []), row]);
      expect([...byDate.keys()].sort()).toEqual(dates);
      for (const [asOf, dateRows] of byDate) {
        expect(dateRows).toHaveLength(12);
        expect(new Set(dateRows.map((row) => row.status)).size).toBe(1);
        expect(dateRows[0]?.status).toBe(asOf <= boundary ? "actual" : "planned");
      }

      const importedRows = await tx
        .select({ asOf: balanceSnapshots.asOf, status: balanceSnapshots.status })
        .from(balanceSnapshots)
        .where(and(
          inArray(balanceSnapshots.accountId, accountIds.slice(0, 6)),
          inArray(balanceSnapshots.id, canonicalRecordIds),
        ));
      expect(importedRows).toHaveLength(72);
      expect(importedRows.filter((row) => row.status === "actual")).toHaveLength(30);
      expect(importedRows.filter((row) => row.status === "planned")).toHaveLength(42);

      throw rollbackMarker;
    }), rollbackMarker);
  });
});

describe.skipIf(!database)("account repository latest balances", () => {
  it("applies payday-check overrides, excludes generated planned snapshots, bounds by asOf, and isolates owners", async () => {
    if (!database) return;
    const latestOwnerA = "00000000-0000-0000-0000-0000000000da";
    const latestOwnerB = "00000000-0000-0000-0000-0000000000db";
    const institutionA = "10000000-0000-4000-8000-0000000000da";
    const institutionB = "10000000-0000-4000-8000-0000000000db";
    const overrideAccount = "20000000-0000-4000-8000-0000000000da";
    const generatedAccount = "20000000-0000-4000-8000-0000000000db";
    const boundAccount = "20000000-0000-4000-8000-0000000000dc";
    const otherOwnerAccount = "20000000-0000-4000-8000-0000000000dd";
    const asOf = "2026-09-15";
    const rollbackMarker = new Error("account latest balances integration rollback");

    await expect(database.transaction(async (tx) => {
      await tx.insert(users).values([
        { id: latestOwnerA, email: "latest-balances-owner-a@athena-vault.local" },
        { id: latestOwnerB, email: "latest-balances-owner-b@athena-vault.local" },
      ]);
      await tx.insert(institutions).values([
        { id: institutionA, ownerId: latestOwnerA, name: "Latest balances bank", currency: "CAD" },
        { id: institutionB, ownerId: latestOwnerB, name: "Other owner bank", currency: "CAD" },
      ]);
      await tx.insert(accounts).values([
        { id: overrideAccount, ownerId: latestOwnerA, institutionId: institutionA, name: "Override chequing", kind: "checking", currency: "CAD" },
        { id: generatedAccount, ownerId: latestOwnerA, institutionId: institutionA, name: "Generated savings", kind: "savings", currency: "CAD" },
        { id: boundAccount, ownerId: latestOwnerA, institutionId: institutionA, name: "Bounded cash", kind: "cash", currency: "CAD" },
        { id: otherOwnerAccount, ownerId: latestOwnerB, institutionId: institutionB, name: "Other owner chequing", kind: "checking", currency: "CAD" },
      ]);
      await tx.insert(balanceSnapshots).values([
        { ownerId: latestOwnerA, accountId: overrideAccount, asOf: "2026-09-01", balanceMinor: 1000, status: "actual", isGenerated: false, currency: "CAD" },
        { ownerId: latestOwnerA, accountId: generatedAccount, asOf: "2026-09-01", balanceMinor: 2000, status: "actual", isGenerated: false, currency: "CAD" },
        { ownerId: latestOwnerA, accountId: generatedAccount, asOf: "2026-09-10", balanceMinor: 9999, status: "planned", isGenerated: true, currency: "CAD" },
        { ownerId: latestOwnerA, accountId: boundAccount, asOf: "2026-09-05", balanceMinor: 3000, status: "planned", isGenerated: false, currency: "CAD" },
        { ownerId: latestOwnerA, accountId: boundAccount, asOf: "2026-09-20", balanceMinor: 8888, status: "actual", isGenerated: false, currency: "CAD" },
        { ownerId: latestOwnerB, accountId: otherOwnerAccount, asOf: "2026-09-01", balanceMinor: 7777, status: "actual", isGenerated: false, currency: "CAD" },
      ]);
      await tx.insert(cashFlowPaydayChecks).values([
        { ownerId: latestOwnerA, accountId: overrideAccount, payDate: "2026-09-01", projectedBalanceMinor: 1100, actualBalanceMinor: 1500 },
        { ownerId: latestOwnerA, accountId: boundAccount, payDate: "2026-09-20", projectedBalanceMinor: 3100, actualBalanceMinor: 6666 },
        { ownerId: latestOwnerB, accountId: otherOwnerAccount, payDate: "2026-09-01", projectedBalanceMinor: 7800, actualBalanceMinor: 7900 },
      ]);

      const repository = createAccountRepository(tx as unknown as Database);
      const rows = await repository.listWithLatestBalances(latestOwnerA, asOf);
      const byId = new Map(rows.map((row) => [row.id, row]));

      expect(rows.map((row) => row.id).sort()).toEqual([overrideAccount, generatedAccount, boundAccount].sort());
      expect(byId.get(overrideAccount)).toEqual({
        id: overrideAccount,
        name: "Override chequing",
        kind: "checking",
        currency: "CAD",
        institution: "Latest balances bank",
        includeInAvailableCash: false,
        asOf: "2026-09-01",
        balanceMinor: 1500,
        isActive: true,
      });
      expect(byId.get(generatedAccount)).toMatchObject({ asOf: "2026-09-01", balanceMinor: 2000 });
      expect(byId.get(boundAccount)).toMatchObject({ asOf: "2026-09-05", balanceMinor: 3000 });
      expect(byId.has(otherOwnerAccount)).toBe(false);
      expect(await repository.listWithLatestBalances(latestOwnerB, asOf)).toEqual([
        expect.objectContaining({ id: otherOwnerAccount, institution: "Other owner bank", asOf: "2026-09-01", balanceMinor: 7900 }),
      ]);

      throw rollbackMarker;
    })).rejects.toThrow(rollbackMarker.message);
  });
});

describe.skipIf(!database)("account repository latest balances equivalence", () => {
  it("matches the previous full-history JS reduction on tied and filtered fixture rows", async () => {
    if (!database) return;
    const equivalenceOwner = "00000000-0000-0000-0000-0000000000dc";
    const equivalenceInstitution = "10000000-0000-4000-8000-0000000000dc";
    const sameDateAccount = "20000000-0000-4000-8000-0000000000d1";
    const laterSnapshotAccount = "20000000-0000-4000-8000-0000000000d2";
    const checkOnlyAccount = "20000000-0000-4000-8000-0000000000d3";
    const emptyAccount = "20000000-0000-4000-8000-0000000000d4";
    const filteredAccount = "20000000-0000-4000-8000-0000000000d5";
    const asOf = "2026-09-15";
    const rollbackMarker = new Error("account latest balances equivalence rollback");

    await expect(database.transaction(async (tx) => {
      await tx.insert(users).values([{ id: equivalenceOwner, email: "latest-balances-equivalence@athena-vault.local" }]);
      await tx.insert(institutions).values([{ id: equivalenceInstitution, ownerId: equivalenceOwner, name: "Equivalence bank", currency: "CAD" }]);
      await tx.insert(accounts).values([
        { id: sameDateAccount, ownerId: equivalenceOwner, institutionId: equivalenceInstitution, name: "Same date chequing", kind: "checking", currency: "CAD" },
        { id: laterSnapshotAccount, ownerId: equivalenceOwner, institutionId: equivalenceInstitution, name: "Later snapshot savings", kind: "savings", currency: "CAD" },
        { id: checkOnlyAccount, ownerId: equivalenceOwner, institutionId: equivalenceInstitution, name: "Check only cash", kind: "cash", currency: "CAD" },
        { id: emptyAccount, ownerId: equivalenceOwner, institutionId: equivalenceInstitution, name: "Empty wallet", kind: "cash", currency: "CAD" },
        { id: filteredAccount, ownerId: equivalenceOwner, institutionId: equivalenceInstitution, name: "Filtered card", kind: "credit", currency: "CAD" },
      ]);
      await tx.insert(balanceSnapshots).values([
        { ownerId: equivalenceOwner, accountId: sameDateAccount, asOf: "2026-08-20", balanceMinor: 400, status: "actual", isGenerated: false, currency: "CAD" },
        { ownerId: equivalenceOwner, accountId: sameDateAccount, asOf: "2026-09-01", balanceMinor: 1000, status: "actual", isGenerated: false, currency: "CAD" },
        { ownerId: equivalenceOwner, accountId: sameDateAccount, asOf: "2026-09-30", balanceMinor: 9999, status: "actual", isGenerated: false, currency: "CAD" },
        { ownerId: equivalenceOwner, accountId: laterSnapshotAccount, asOf: "2026-09-10", balanceMinor: 2000, status: "planned", isGenerated: false, currency: "CAD" },
        { ownerId: equivalenceOwner, accountId: laterSnapshotAccount, asOf: "2026-09-12", balanceMinor: 2100, status: "planned", isGenerated: true, currency: "CAD" },
        { ownerId: equivalenceOwner, accountId: filteredAccount, asOf: "2026-09-05", balanceMinor: 5000, status: "planned", isGenerated: true, currency: "CAD" },
        { ownerId: equivalenceOwner, accountId: filteredAccount, asOf: "2026-08-01", balanceMinor: 4000, status: "actual", isGenerated: false, currency: "CAD" },
      ]);
      await tx.insert(cashFlowPaydayChecks).values([
        { ownerId: equivalenceOwner, accountId: sameDateAccount, payDate: "2026-09-01", projectedBalanceMinor: 1100, actualBalanceMinor: 1500 },
        { ownerId: equivalenceOwner, accountId: laterSnapshotAccount, payDate: "2026-09-01", projectedBalanceMinor: 1900, actualBalanceMinor: 1950 },
        { ownerId: equivalenceOwner, accountId: laterSnapshotAccount, payDate: "2026-09-16", projectedBalanceMinor: 1200, actualBalanceMinor: 1250 },
        { ownerId: equivalenceOwner, accountId: checkOnlyAccount, payDate: "2026-09-02", projectedBalanceMinor: 3000, actualBalanceMinor: 3100 },
      ]);

      const repository = createAccountRepository(tx as unknown as Database);
      const rows = await repository.listWithLatestBalances(equivalenceOwner, asOf);

      // Reference implementation: the pre-TASK-023 full-history selects plus JS reduction.
      const [referenceSnapshots, referenceChecks] = await Promise.all([
        tx.select({
          id: balanceSnapshots.id,
          accountId: balanceSnapshots.accountId,
          asOf: balanceSnapshots.asOf,
          balanceMinor: balanceSnapshots.balanceMinor,
        }).from(balanceSnapshots)
          .where(and(
            eq(balanceSnapshots.ownerId, equivalenceOwner),
            lte(balanceSnapshots.asOf, asOf),
            or(eq(balanceSnapshots.status, "actual"), and(eq(balanceSnapshots.status, "planned"), eq(balanceSnapshots.isGenerated, false))),
          )),
        tx.select({
          id: cashFlowPaydayChecks.id,
          accountId: cashFlowPaydayChecks.accountId,
          asOf: cashFlowPaydayChecks.payDate,
          balanceMinor: cashFlowPaydayChecks.actualBalanceMinor,
        }).from(cashFlowPaydayChecks)
          .where(and(eq(cashFlowPaydayChecks.ownerId, equivalenceOwner), lte(cashFlowPaydayChecks.payDate, asOf))),
      ]);
      type ReferenceBalance = { accountId: string; asOf: string; balanceMinor: number; source: "snapshot" | "payday-check"; id: string };
      const latestByAccount = new Map<string, ReferenceBalance>();
      for (const candidate of [
        ...referenceSnapshots.map((row): ReferenceBalance => ({ ...row, source: "snapshot" })),
        ...referenceChecks.map((row): ReferenceBalance => ({ ...row, source: "payday-check" })),
      ]) {
        const current = latestByAccount.get(candidate.accountId);
        if (!current
          || candidate.asOf > current.asOf
          || (candidate.asOf === current.asOf && (
            (candidate.source === "payday-check" && current.source !== "payday-check")
            || (candidate.source === current.source && candidate.id > current.id)
          ))) {
          latestByAccount.set(candidate.accountId, candidate);
        }
      }

      expect(rows).toHaveLength(5);
      for (const row of rows) {
        const expected = latestByAccount.get(row.id);
        expect({ asOf: row.asOf, balanceMinor: row.balanceMinor }).toEqual({
          asOf: expected?.asOf ?? null,
          balanceMinor: expected?.balanceMinor ?? null,
        });
      }
      expect(latestByAccount.get(sameDateAccount)?.balanceMinor).toBe(1500);
      expect(latestByAccount.get(laterSnapshotAccount)?.balanceMinor).toBe(2000);
      expect(latestByAccount.get(filteredAccount)?.balanceMinor).toBe(4000);
      expect(latestByAccount.has(emptyAccount)).toBe(false);

      throw rollbackMarker;
    })).rejects.toThrow(rollbackMarker.message);
  });
});
