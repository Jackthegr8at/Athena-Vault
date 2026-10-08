import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../client";
import { createGoalRepository } from "./goals";
import { createGoalPlanRepository } from "./goal-plans";
import type { TransactionDatabase } from "./shared";
import { expectIntegrationRollback } from "../integration-test-helpers";
import {
  accountContributionRules,
  accounts,
  balanceSnapshots,
  cashFlowPeriods,
  financialGoalPlans,
  financialGoals,
  institutions,
  recurringCashFlowSeries,
  recurringTransactions,
  transfers,
  users,
} from "../drizzle-schema";

const connectionString = process.env.DATABASE_URL;
const database = connectionString ? createDatabase(connectionString) : undefined;

const OWNER_A = "00000000-0000-0000-0000-0000000000ea";
const OWNER_B = "00000000-0000-0000-0000-0000000000eb";
const INSTITUTION_A = "10000000-0000-4000-8000-0000000000ea";
const INSTITUTION_B = "10000000-0000-4000-8000-0000000000eb";
const ACCOUNT_A = "20000000-0000-4000-8000-0000000000ea";
const ACCOUNT_B = "20000000-0000-4000-8000-0000000000eb";
const ACCOUNT_A2 = "20000000-0000-4000-8000-0000000000ec";
const GOAL_A = "30000000-0000-4000-8000-0000000000ea";
const GOAL_B = "30000000-0000-4000-8000-0000000000eb";
const RULE_A = "40000000-0000-4000-8000-0000000000ea";
const RULE_B = "40000000-0000-4000-8000-0000000000eb";
const RULE_UNRELATED = "40000000-0000-4000-8000-0000000000ec";
const PLAN_A = "50000000-0000-4000-8000-0000000000ea";
const PLAN_B = "50000000-0000-4000-8000-0000000000eb";
const TODAY = "2026-09-11";
const GOAL_SERIES = "30000000-0000-4000-8000-0000000000ed";
const SERIES_A = "60000000-0000-4000-8000-0000000000ed";
const VERSION_A = "70000000-0000-4000-8000-0000000000ed";
const PLAN_SERIES = "50000000-0000-4000-8000-0000000000ed";
const TRANSFER_ACTUAL = "80000000-0000-4000-8000-0000000000f0";

async function seedOwnerFixture(tx: TransactionDatabase) {
  await tx.insert(users).values([
    { id: OWNER_A, email: "goal-lifecycle-owner-a@athena-vault.local" },
    { id: OWNER_B, email: "goal-lifecycle-owner-b@athena-vault.local" },
  ]);
  await tx.insert(institutions).values([
    { id: INSTITUTION_A, ownerId: OWNER_A, name: "Goal bank A", currency: "CAD" },
    { id: INSTITUTION_B, ownerId: OWNER_B, name: "Goal bank B", currency: "CAD" },
  ]);
  await tx.insert(accounts).values([
    { id: ACCOUNT_A, ownerId: OWNER_A, institutionId: INSTITUTION_A, name: "Goal savings", kind: "savings", currency: "CAD" },
    { id: ACCOUNT_A2, ownerId: OWNER_A, institutionId: INSTITUTION_A, name: "Goal checking", kind: "checking", currency: "CAD" },
    { id: ACCOUNT_B, ownerId: OWNER_B, institutionId: INSTITUTION_B, name: "Goal savings B", kind: "savings", currency: "CAD" },
  ]);
  await tx.insert(cashFlowPeriods).values([
    { ownerId: OWNER_A, label: "Pay period 2026-09-16", startsOn: "2026-09-03", endsOn: "2026-09-16", payDate: "2026-09-16", openingBalanceMinor: 0, currency: "CAD", status: "planned" },
    { ownerId: OWNER_A, label: "Pay period 2026-09-30", startsOn: "2026-09-17", endsOn: "2026-09-30", payDate: "2026-09-30", openingBalanceMinor: 0, currency: "CAD", status: "planned" },
  ]);
  await tx.insert(balanceSnapshots).values([
    { ownerId: OWNER_A, accountId: ACCOUNT_A, asOf: "2026-09-10", balanceMinor: 10000, status: "actual", isGenerated: false, currency: "CAD" },
    { ownerId: OWNER_A, accountId: ACCOUNT_A, asOf: "2026-09-16", balanceMinor: 10000, status: "planned", isGenerated: true, currency: "CAD" },
    { ownerId: OWNER_A, accountId: ACCOUNT_A, asOf: "2026-09-30", balanceMinor: 10000, status: "planned", isGenerated: true, currency: "CAD" },
  ]);
}

async function seedGoalWithPlan(tx: TransactionDatabase) {
  await tx.insert(financialGoals).values([
    { id: GOAL_A, ownerId: OWNER_A, name: "Emergency fund", targetMinor: 20000, currentMinor: 10000, targetDate: "2026-12-31", priority: 0, status: "active", currency: "CAD" },
    { id: GOAL_B, ownerId: OWNER_B, name: "Owner B goal", targetMinor: 5000, currentMinor: 0, targetDate: "2026-12-31", priority: 0, status: "active", currency: "CAD" },
  ]);
  await tx.insert(accountContributionRules).values([
    { id: RULE_A, ownerId: OWNER_A, accountId: ACCOUNT_A, amountMinor: 500, frequency: "weekly", startsOn: "2026-09-12", endsOn: null, isEnabled: true },
    { id: RULE_B, ownerId: OWNER_B, accountId: ACCOUNT_B, amountMinor: 100, frequency: "monthly", startsOn: "2026-09-12", endsOn: null, isEnabled: true },
    { id: RULE_UNRELATED, ownerId: OWNER_A, accountId: ACCOUNT_A2, amountMinor: 250, frequency: "monthly", startsOn: "2026-09-12", endsOn: null, isEnabled: true },
  ]);
  await tx.insert(financialGoalPlans).values([
    { id: PLAN_A, ownerId: OWNER_A, goalId: GOAL_A, contributionRuleId: RULE_A, isEnabled: true },
    { id: PLAN_B, ownerId: OWNER_B, goalId: GOAL_B, contributionRuleId: RULE_B, isEnabled: true },
  ]);
}

async function seedGoalWithSeriesPlan(tx: TransactionDatabase, options: { readonly withVersion?: boolean } = {}) {
  const withVersion = options.withVersion !== false;
  await tx.insert(financialGoals).values({
    id: GOAL_SERIES,
    ownerId: OWNER_A,
    name: "Cash Flow goal",
    targetMinor: 20000,
    currentMinor: 0,
    targetDate: "2026-12-31",
    priority: 1,
    status: "active",
    currency: "CAD",
  });
  await tx.insert(recurringCashFlowSeries).values({
    id: SERIES_A,
    ownerId: OWNER_A,
    kind: "transfer",
    state: "active",
    endedOn: null,
    homeHouseholdFrequency: null,
  });
  if (withVersion) {
    await tx.insert(recurringTransactions).values({
      id: VERSION_A,
      ownerId: OWNER_A,
      seriesId: SERIES_A,
      accountId: null,
      fromAccountId: ACCOUNT_A2,
      toAccountId: ACCOUNT_A,
      kind: "transfer",
      frequency: "weekly",
      weekdayAdjustment: "none",
      description: "Goal savings transfer",
      amountMinor: 500,
      currency: "CAD",
      startsOn: TODAY,
      endsOn: "2026-12-31",
      effectiveFrom: TODAY,
      effectiveTo: null,
      versionNote: null,
      countsAsExpense: true,
      nextOccurrenceOn: TODAY,
      status: "planned",
    });
  }
  await tx.insert(financialGoalPlans).values({
    id: PLAN_SERIES,
    ownerId: OWNER_A,
    goalId: GOAL_SERIES,
    contributionRuleId: null,
    cashFlowSeriesId: SERIES_A,
    isEnabled: true,
  });
}

async function getPlanAndRule(tx: TransactionDatabase, planId: string, ruleId: string) {
  const [plan] = await tx.select({ isEnabled: financialGoalPlans.isEnabled }).from(financialGoalPlans).where(eq(financialGoalPlans.id, planId));
  const [rule] = await tx.select({ isEnabled: accountContributionRules.isEnabled }).from(accountContributionRules).where(eq(accountContributionRules.id, ruleId));
  return { plan, rule };
}

describe.skipIf(!database)("goal repository lifecycle", () => {
  it("keeps no-plan status transitions unchanged", async () => {
    if (!database) return;
    const rollbackMarker = new Error("goal lifecycle rollback");

    await expect(database.transaction(async (tx) => {
      await seedOwnerFixture(tx);
      await tx.insert(financialGoals).values({
        id: GOAL_A,
        ownerId: OWNER_A,
        name: "No plan goal",
        targetMinor: 1000,
        currentMinor: 0,
        targetDate: "2026-12-31",
        priority: 0,
        status: "active",
        currency: "CAD",
      });

      const repository = createGoalRepository(tx as unknown as Database);
      await expect(repository.setStatus(OWNER_A, GOAL_A, "archived", { todayIso: TODAY })).resolves.toMatchObject({ id: GOAL_A, status: "archived" });
      await expect(repository.setStatus(OWNER_A, GOAL_A, "achieved", { todayIso: TODAY })).resolves.toMatchObject({ id: GOAL_A, status: "achieved" });
      await expect(repository.setStatus(OWNER_A, GOAL_A, "active", { todayIso: TODAY })).resolves.toMatchObject({ id: GOAL_A, status: "active" });

      throw rollbackMarker;
    })).rejects.toThrow(rollbackMarker.message);
  });

  it("disables linked plan on archive and achieved, preserves on stopContributions false, and re-enables on active", async () => {
    if (!database) return;
    const rollbackMarker = new Error("goal lifecycle rollback");

    await expectIntegrationRollback(database.transaction(async (tx) => {
      await seedOwnerFixture(tx);
      await seedGoalWithPlan(tx);

      const repository = createGoalRepository(tx as unknown as Database);

      await repository.setStatus(OWNER_A, GOAL_A, "archived", { todayIso: TODAY });
      let state = await getPlanAndRule(tx, PLAN_A, RULE_A);
      expect(state.plan?.isEnabled).toBe(false);
      expect(state.rule?.isEnabled).toBe(false);
      const afterArchive = await tx
        .select({ asOf: balanceSnapshots.asOf, balanceMinor: balanceSnapshots.balanceMinor })
        .from(balanceSnapshots)
        .where(and(eq(balanceSnapshots.ownerId, OWNER_A), eq(balanceSnapshots.accountId, ACCOUNT_A)))
        .orderBy(balanceSnapshots.asOf);
      expect(afterArchive).toEqual([
        { asOf: "2026-09-10", balanceMinor: 10000 },
        { asOf: "2026-09-16", balanceMinor: 10000 },
        { asOf: "2026-09-30", balanceMinor: 10000 },
      ]);

      await repository.setStatus(OWNER_A, GOAL_A, "active", { todayIso: TODAY });
      state = await getPlanAndRule(tx, PLAN_A, RULE_A);
      expect(state.plan?.isEnabled).toBe(true);
      expect(state.rule?.isEnabled).toBe(true);
      const afterActive = await tx
        .select({ asOf: balanceSnapshots.asOf, balanceMinor: balanceSnapshots.balanceMinor })
        .from(balanceSnapshots)
        .where(and(eq(balanceSnapshots.ownerId, OWNER_A), eq(balanceSnapshots.accountId, ACCOUNT_A)))
        .orderBy(balanceSnapshots.asOf);
      expect(afterActive).toEqual([
        { asOf: "2026-09-10", balanceMinor: 10000 },
        { asOf: "2026-09-16", balanceMinor: 10500 },
        { asOf: "2026-09-30", balanceMinor: 11500 },
      ]);

      await repository.setStatus(OWNER_A, GOAL_A, "achieved", { todayIso: TODAY });
      state = await getPlanAndRule(tx, PLAN_A, RULE_A);
      expect(state.plan?.isEnabled).toBe(false);
      expect(state.rule?.isEnabled).toBe(false);

      await repository.setStatus(OWNER_A, GOAL_A, "active", { todayIso: TODAY });
      state = await getPlanAndRule(tx, PLAN_A, RULE_A);
      expect(state.plan?.isEnabled).toBe(true);
      expect(state.rule?.isEnabled).toBe(true);

      await repository.setStatus(OWNER_A, GOAL_A, "achieved", { todayIso: TODAY, stopContributions: false });
      state = await getPlanAndRule(tx, PLAN_A, RULE_A);
      expect(state.plan?.isEnabled).toBe(true);
      expect(state.rule?.isEnabled).toBe(true);

      throw rollbackMarker;
    }), rollbackMarker);
  });

  it("restores archived goals and re-enables linked plan only when destination is eligible", async () => {
    if (!database) return;
    const rollbackMarker = new Error("goal lifecycle rollback");

    await expect(database.transaction(async (tx) => {
      await seedOwnerFixture(tx);
      await seedGoalWithPlan(tx);

      const repository = createGoalRepository(tx as unknown as Database);

      await repository.setStatus(OWNER_A, GOAL_A, "archived", { todayIso: TODAY });
      const restored = await repository.restore(OWNER_A, GOAL_A, TODAY);
      expect(restored.goal.status).toBe("active");
      expect(restored.planEnabled).toBe(true);
      let state = await getPlanAndRule(tx, PLAN_A, RULE_A);
      expect(state.plan?.isEnabled).toBe(true);
      expect(state.rule?.isEnabled).toBe(true);

      await repository.setStatus(OWNER_A, GOAL_A, "archived", { todayIso: TODAY });
      await tx.update(accounts).set({ isActive: false }).where(eq(accounts.id, ACCOUNT_A));
      const restoredUnavailable = await repository.restore(OWNER_A, GOAL_A, TODAY);
      expect(restoredUnavailable.goal.status).toBe("active");
      expect(restoredUnavailable.planEnabled).toBe(false);
      state = await getPlanAndRule(tx, PLAN_A, RULE_A);
      expect(state.plan?.isEnabled).toBe(false);
      expect(state.rule?.isEnabled).toBe(false);

      throw rollbackMarker;
    })).rejects.toThrow(rollbackMarker.message);
  });

  it("rejects cross-owner lifecycle calls", async () => {
    if (!database) return;
    const rollbackMarker = new Error("goal lifecycle rollback");

    await expect(database.transaction(async (tx) => {
      await seedOwnerFixture(tx);
      await seedGoalWithPlan(tx);

      const repository = createGoalRepository(tx as unknown as Database);
      await expect(repository.setStatus(OWNER_B, GOAL_A, "archived", { todayIso: TODAY })).rejects.toThrow("Goal not found.");
      await expect(repository.restore(OWNER_B, GOAL_A, TODAY)).rejects.toThrow("Goal not found.");
      await expect(repository.delete(OWNER_B, GOAL_A, TODAY)).rejects.toThrow("Goal not found.");

      throw rollbackMarker;
    })).rejects.toThrow(rollbackMarker.message);
  });

  it("deletes linked rule and preserves unrelated rules", async () => {
    if (!database) return;
    const rollbackMarker = new Error("goal lifecycle rollback");

    await expect(database.transaction(async (tx) => {
      await seedOwnerFixture(tx);
      await seedGoalWithPlan(tx);

      const repository = createGoalRepository(tx as unknown as Database);
      await repository.delete(OWNER_A, GOAL_A, TODAY);

      const remainingRules = await tx
        .select({ id: accountContributionRules.id })
        .from(accountContributionRules)
        .where(eq(accountContributionRules.ownerId, OWNER_A));
      expect(remainingRules.map((row) => row.id)).toEqual([RULE_UNRELATED]);

      const remainingPlans = await tx
        .select({ id: financialGoalPlans.id })
        .from(financialGoalPlans)
        .where(eq(financialGoalPlans.ownerId, OWNER_A));
      expect(remainingPlans).toHaveLength(0);

      const remainingGoals = await tx
        .select({ id: financialGoals.id })
        .from(financialGoals)
        .where(eq(financialGoals.ownerId, OWNER_A));
      expect(remainingGoals).toHaveLength(0);

      const ownerBRules = await tx
        .select({ id: accountContributionRules.id })
        .from(accountContributionRules)
        .where(eq(accountContributionRules.ownerId, OWNER_B));
      expect(ownerBRules.map((row) => row.id)).toEqual([RULE_B]);

      throw rollbackMarker;
    })).rejects.toThrow(rollbackMarker.message);
  });

  it("deletes generated planned Cash Flow transfers with a goal but preserves actual and manual transfers", async () => {
    if (!database) return;
    const rollbackMarker = new Error("goal lifecycle rollback");

    await expect(database.transaction(async (tx) => {
      await seedOwnerFixture(tx);
      await seedGoalWithPlan(tx);
      const [period] = await tx
        .select({ id: cashFlowPeriods.id })
        .from(cashFlowPeriods)
        .where(eq(cashFlowPeriods.ownerId, OWNER_A))
        .limit(1);
      await tx.insert(financialGoals).values({
        id: "30000000-0000-4000-8000-0000000000ec",
        ownerId: OWNER_A,
        name: "Cash Flow goal",
        targetMinor: 20000,
        currentMinor: 0,
        targetDate: "2026-12-31",
        priority: 1,
        status: "active",
        currency: "CAD",
      });
      await tx.insert(recurringCashFlowSeries).values({
        id: "60000000-0000-4000-8000-0000000000ec",
        ownerId: OWNER_A,
        kind: "transfer",
        state: "active",
        endedOn: null,
        homeHouseholdFrequency: null,
      });
      await tx.insert(recurringTransactions).values({
        id: "70000000-0000-4000-8000-0000000000ec",
        ownerId: OWNER_A,
        seriesId: "60000000-0000-4000-8000-0000000000ec",
        accountId: null,
        fromAccountId: ACCOUNT_A2,
        toAccountId: ACCOUNT_A,
        kind: "transfer",
        frequency: "weekly",
        weekdayAdjustment: "none",
        description: "Goal savings transfer",
        amountMinor: 500,
        currency: "CAD",
        startsOn: TODAY,
        endsOn: "2026-12-31",
        effectiveFrom: TODAY,
        effectiveTo: null,
        versionNote: null,
        countsAsExpense: true,
        nextOccurrenceOn: TODAY,
        status: "planned",
      });
      await tx.insert(financialGoalPlans).values({
        id: "50000000-0000-4000-8000-0000000000ec",
        ownerId: OWNER_A,
        goalId: "30000000-0000-4000-8000-0000000000ec",
        contributionRuleId: null,
        cashFlowSeriesId: "60000000-0000-4000-8000-0000000000ec",
        isEnabled: true,
      });
      await tx.insert(transfers).values([
        {
          id: "80000000-0000-4000-8000-0000000000ed",
          ownerId: OWNER_A,
          periodId: period!.id,
          fromAccountId: ACCOUNT_A2,
          toAccountId: ACCOUNT_A,
          recurringTransactionId: "70000000-0000-4000-8000-0000000000ec",
          recurringSeriesId: "60000000-0000-4000-8000-0000000000ec",
          recurringOccurrenceId: "90000000-0000-4000-8000-0000000000ed",
          scheduledOccurrenceOn: TODAY,
          isGenerated: true,
          transferDate: TODAY,
          amountMinor: 500,
          currency: "CAD",
          status: "planned",
          description: "Goal savings transfer",
        },
        {
          id: "80000000-0000-4000-8000-0000000000ee",
          ownerId: OWNER_A,
          periodId: period!.id,
          fromAccountId: ACCOUNT_A2,
          toAccountId: ACCOUNT_A,
          recurringTransactionId: "70000000-0000-4000-8000-0000000000ec",
          recurringSeriesId: "60000000-0000-4000-8000-0000000000ec",
          recurringOccurrenceId: "90000000-0000-4000-8000-0000000000ee",
          scheduledOccurrenceOn: "2026-09-04",
          isGenerated: true,
          transferDate: "2026-09-04",
          amountMinor: 500,
          currency: "CAD",
          status: "actual",
          description: "Goal savings transfer",
        },
        {
          id: "80000000-0000-4000-8000-0000000000ef",
          ownerId: OWNER_A,
          periodId: period!.id,
          fromAccountId: ACCOUNT_A2,
          toAccountId: ACCOUNT_A,
          recurringTransactionId: null,
          recurringSeriesId: null,
          recurringOccurrenceId: null,
          scheduledOccurrenceOn: null,
          isGenerated: false,
          transferDate: TODAY,
          amountMinor: 500,
          currency: "CAD",
          status: "planned",
          description: "Manual transfer",
        },
      ]);

      const repository = createGoalRepository(tx as unknown as Database);
      await repository.delete(OWNER_A, "30000000-0000-4000-8000-0000000000ec", TODAY);

      const remainingTransfers = await tx
        .select({ id: transfers.id, status: transfers.status, isGenerated: transfers.isGenerated })
        .from(transfers)
        .where(eq(transfers.ownerId, OWNER_A));
      expect(remainingTransfers).toContainEqual({ id: "80000000-0000-4000-8000-0000000000ee", status: "actual", isGenerated: true });
      expect(remainingTransfers).toContainEqual({ id: "80000000-0000-4000-8000-0000000000ef", status: "planned", isGenerated: false });
      expect(remainingTransfers).not.toContainEqual({ id: "80000000-0000-4000-8000-0000000000ed", status: "planned", isGenerated: true });

      throw rollbackMarker;
    })).rejects.toThrow(rollbackMarker.message);
  });

  it("deletes a Cash Flow series when no linked rows remain", async () => {
    if (!database) return;
    const rollbackMarker = new Error("goal lifecycle rollback");

    await expectIntegrationRollback(database.transaction(async (tx) => {
      await seedOwnerFixture(tx);
      await seedGoalWithSeriesPlan(tx, { withVersion: false });

      const repository = createGoalRepository(tx as unknown as Database);
      await repository.delete(OWNER_A, GOAL_SERIES, TODAY);

      const remainingSeries = await tx
        .select({ id: recurringCashFlowSeries.id })
        .from(recurringCashFlowSeries)
        .where(eq(recurringCashFlowSeries.id, SERIES_A));
      expect(remainingSeries).toHaveLength(0);

      const remainingPlans = await tx
        .select({ id: financialGoalPlans.id })
        .from(financialGoalPlans)
        .where(eq(financialGoalPlans.id, PLAN_SERIES));
      expect(remainingPlans).toHaveLength(0);

      throw rollbackMarker;
    }), rollbackMarker);
  });

  it("ends a Cash Flow series when linked rows remain", async () => {
    if (!database) return;
    const rollbackMarker = new Error("goal lifecycle rollback");

    await expect(database.transaction(async (tx) => {
      await seedOwnerFixture(tx);
      await seedGoalWithSeriesPlan(tx);
      const [period] = await tx
        .select({ id: cashFlowPeriods.id })
        .from(cashFlowPeriods)
        .where(eq(cashFlowPeriods.ownerId, OWNER_A))
        .limit(1);
      await tx.insert(transfers).values({
        id: TRANSFER_ACTUAL,
        ownerId: OWNER_A,
        periodId: period!.id,
        fromAccountId: ACCOUNT_A2,
        toAccountId: ACCOUNT_A,
        recurringTransactionId: VERSION_A,
        recurringSeriesId: SERIES_A,
        recurringOccurrenceId: "90000000-0000-4000-8000-0000000000f0",
        scheduledOccurrenceOn: "2026-09-04",
        isGenerated: true,
        transferDate: "2026-09-04",
        amountMinor: 500,
        currency: "CAD",
        status: "actual",
        description: "Goal savings transfer",
      });

      const repository = createGoalRepository(tx as unknown as Database);
      await repository.delete(OWNER_A, GOAL_SERIES, TODAY);

      const [series] = await tx
        .select({ state: recurringCashFlowSeries.state, endedOn: recurringCashFlowSeries.endedOn })
        .from(recurringCashFlowSeries)
        .where(eq(recurringCashFlowSeries.id, SERIES_A));
      expect(series).toEqual({ state: "ended", endedOn: TODAY });

      const [version] = await tx
        .select({ effectiveTo: recurringTransactions.effectiveTo, endsOn: recurringTransactions.endsOn })
        .from(recurringTransactions)
        .where(eq(recurringTransactions.id, VERSION_A));
      expect(version).toEqual({ effectiveTo: TODAY, endsOn: TODAY });

      throw rollbackMarker;
    })).rejects.toThrow(rollbackMarker.message);
  });

  it("pauses a Cash Flow series on archive and achieved with stopContributions", async () => {
    if (!database) return;
    const rollbackMarker = new Error("goal lifecycle rollback");

    await expect(database.transaction(async (tx) => {
      await seedOwnerFixture(tx);
      await seedGoalWithSeriesPlan(tx);

      const repository = createGoalRepository(tx as unknown as Database);

      await repository.setStatus(OWNER_A, GOAL_SERIES, "archived", { todayIso: TODAY });
      let [series] = await tx
        .select({ state: recurringCashFlowSeries.state })
        .from(recurringCashFlowSeries)
        .where(eq(recurringCashFlowSeries.id, SERIES_A));
      let [plan] = await tx
        .select({ isEnabled: financialGoalPlans.isEnabled })
        .from(financialGoalPlans)
        .where(eq(financialGoalPlans.id, PLAN_SERIES));
      expect(series?.state).toBe("paused");
      expect(plan?.isEnabled).toBe(false);

      await repository.setStatus(OWNER_A, GOAL_SERIES, "active", { todayIso: TODAY });
      [series] = await tx
        .select({ state: recurringCashFlowSeries.state })
        .from(recurringCashFlowSeries)
        .where(eq(recurringCashFlowSeries.id, SERIES_A));
      [plan] = await tx
        .select({ isEnabled: financialGoalPlans.isEnabled })
        .from(financialGoalPlans)
        .where(eq(financialGoalPlans.id, PLAN_SERIES));
      expect(series?.state).toBe("active");
      expect(plan?.isEnabled).toBe(true);

      await repository.setStatus(OWNER_A, GOAL_SERIES, "achieved", { todayIso: TODAY });
      [series] = await tx
        .select({ state: recurringCashFlowSeries.state })
        .from(recurringCashFlowSeries)
        .where(eq(recurringCashFlowSeries.id, SERIES_A));
      [plan] = await tx
        .select({ isEnabled: financialGoalPlans.isEnabled })
        .from(financialGoalPlans)
        .where(eq(financialGoalPlans.id, PLAN_SERIES));
      expect(series?.state).toBe("paused");
      expect(plan?.isEnabled).toBe(false);

      throw rollbackMarker;
    })).rejects.toThrow(rollbackMarker.message);
  });

  it("preserves a Cash Flow series on achieved without stopContributions", async () => {
    if (!database) return;
    const rollbackMarker = new Error("goal lifecycle rollback");

    await expect(database.transaction(async (tx) => {
      await seedOwnerFixture(tx);
      await seedGoalWithSeriesPlan(tx);

      const repository = createGoalRepository(tx as unknown as Database);
      await repository.setStatus(OWNER_A, GOAL_SERIES, "achieved", { todayIso: TODAY, stopContributions: false });

      const [series] = await tx
        .select({ state: recurringCashFlowSeries.state })
        .from(recurringCashFlowSeries)
        .where(eq(recurringCashFlowSeries.id, SERIES_A));
      const [plan] = await tx
        .select({ isEnabled: financialGoalPlans.isEnabled })
        .from(financialGoalPlans)
        .where(eq(financialGoalPlans.id, PLAN_SERIES));
      expect(series?.state).toBe("active");
      expect(plan?.isEnabled).toBe(true);

      throw rollbackMarker;
    })).rejects.toThrow(rollbackMarker.message);
  });

  it("restores a Cash Flow series when eligible", async () => {
    if (!database) return;
    const rollbackMarker = new Error("goal lifecycle rollback");

    await expect(database.transaction(async (tx) => {
      await seedOwnerFixture(tx);
      await seedGoalWithSeriesPlan(tx);

      const repository = createGoalRepository(tx as unknown as Database);
      await repository.setStatus(OWNER_A, GOAL_SERIES, "archived", { todayIso: TODAY });
      const restored = await repository.restore(OWNER_A, GOAL_SERIES, TODAY);
      expect(restored.goal.status).toBe("active");
      expect(restored.planEnabled).toBe(true);

      const [series] = await tx
        .select({ state: recurringCashFlowSeries.state })
        .from(recurringCashFlowSeries)
        .where(eq(recurringCashFlowSeries.id, SERIES_A));
      const [plan] = await tx
        .select({ isEnabled: financialGoalPlans.isEnabled })
        .from(financialGoalPlans)
        .where(eq(financialGoalPlans.id, PLAN_SERIES));
      expect(series?.state).toBe("active");
      expect(plan?.isEnabled).toBe(true);

      throw rollbackMarker;
    })).rejects.toThrow(rollbackMarker.message);
  });

  it("re-saves a goal plan in place and keeps a single series", async () => {
    if (!database) return;
    const rollbackMarker = new Error("goal lifecycle rollback");

    await expect(database.transaction(async (tx) => {
      await seedOwnerFixture(tx);
      await seedGoalWithSeriesPlan(tx);

      const planRepository = createGoalPlanRepository(tx as unknown as Database);
      const updated = await planRepository.savePlan(OWNER_A, {
        goalId: GOAL_SERIES,
        accountId: ACCOUNT_A,
        sourceAccountId: ACCOUNT_A2,
        amountMinor: 750,
        frequency: "monthly",
        startsOn: "2026-09-30",
      }, TODAY);

      expect(updated.cashFlowSeriesId).toBe(SERIES_A);

      const seriesRows = await tx
        .select({ id: recurringCashFlowSeries.id })
        .from(recurringCashFlowSeries)
        .where(eq(recurringCashFlowSeries.ownerId, OWNER_A));
      expect(seriesRows).toHaveLength(1);

      const versions = await tx
        .select({ id: recurringTransactions.id, amountMinor: recurringTransactions.amountMinor, frequency: recurringTransactions.frequency, effectiveTo: recurringTransactions.effectiveTo })
        .from(recurringTransactions)
        .where(eq(recurringTransactions.seriesId, SERIES_A));
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({ id: VERSION_A, amountMinor: 750, frequency: "monthly", effectiveTo: null });

      throw rollbackMarker;
    })).rejects.toThrow(rollbackMarker.message);
  });

});
