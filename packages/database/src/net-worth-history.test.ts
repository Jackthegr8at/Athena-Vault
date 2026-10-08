import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDatabase, type Database } from "./client";
import { createNetWorthHistoryRepository } from "./index";
import { expectIntegrationRollback } from "./integration-test-helpers";
import {
  accountContributionRules,
  accounts,
  balanceSnapshots,
  cashFlowPeriods,
  householdExpenses,
  homeMortgageAnchors,
  homeMortgageTerms,
  homeValueSnapshots,
  homes,
  institutions,
  investmentAccounts,
  investmentSnapshots,
  users,
} from "./drizzle-schema";

const connectionString = process.env.DATABASE_URL;
const database = connectionString ? createDatabase(connectionString) : undefined;

describe.skipIf(!database)("net-worth history repository", () => {
  it("is owner-scoped, buckets Accounts once, maps planned values, composes Home equity, and does not mutate", async () => {
    if (!database) return;
    const ownerA = "00000000-0000-0000-0000-0000000000c1";
    const ownerB = "00000000-0000-0000-0000-0000000000c2";
    const institutionA = "10000000-0000-4000-8000-0000000000c1";
    const institutionB = "10000000-0000-4000-8000-0000000000c2";
    const checkingA = "20000000-0000-4000-8000-0000000000c1";
    const savingsA = "20000000-0000-4000-8000-0000000000c2";
    const rrspA = "20000000-0000-4000-8000-0000000000c3";
    const creditA = "20000000-0000-4000-8000-0000000000c4";
    const otherA = "20000000-0000-4000-8000-0000000000c5";
    const accountB = "20000000-0000-4000-8000-0000000000c6";
    const periodA1 = "30000000-0000-4000-8000-0000000000c1";
    const periodA2 = "30000000-0000-4000-8000-0000000000c2";
    const checkingSnapshot = "40000000-0000-4000-8000-0000000000c1";
    const checkingPlannedSnapshot = "40000000-0000-4000-8000-0000000000c2";
    const checkingFutureSnapshot = "40000000-0000-4000-8000-0000000000c7";
    const savingsSnapshot = "40000000-0000-4000-8000-0000000000c3";
    const rrspSnapshot = "40000000-0000-4000-8000-0000000000c4";
    const creditSnapshot = "40000000-0000-4000-8000-0000000000c5";
    const otherSnapshot = "40000000-0000-4000-8000-0000000000c6";
    const savingsRule = "50000000-0000-4000-8000-0000000000c1";
    const homeId = "60000000-0000-4000-8000-0000000000c1";
    const homeValueId = "70000000-0000-4000-8000-0000000000c1";
    const mortgageAnchorId = "80000000-0000-4000-8000-0000000000c1";
    const mortgageTermId = "90000000-0000-4000-8000-0000000000c1";
    const mortgageExpenseId = "a0000000-0000-4000-8000-0000000000c1";
    const investmentAccountId = "b0000000-0000-4000-8000-0000000000c1";
    const investmentSnapshotId = "c0000000-0000-4000-8000-0000000000c1";
    const rollbackMarker = new Error("net-worth history rollback");

    await expectIntegrationRollback(database.transaction(async (tx) => {
      await tx.insert(users).values([
        { id: ownerA, email: "net-worth-history-owner-a@athena-vault.local" },
        { id: ownerB, email: "net-worth-history-owner-b@athena-vault.local" },
      ]);
      await tx.insert(institutions).values([
        { id: institutionA, ownerId: ownerA, name: "Net-worth bank A", currency: "CAD" },
        { id: institutionB, ownerId: ownerB, name: "Net-worth bank B", currency: "CAD" },
      ]);
      await tx.insert(accounts).values([
        { id: checkingA, ownerId: ownerA, institutionId: institutionA, name: "Checking A", kind: "checking", currency: "CAD" },
        { id: savingsA, ownerId: ownerA, institutionId: institutionA, name: "Savings A", kind: "savings", currency: "CAD" },
        { id: rrspA, ownerId: ownerA, institutionId: institutionA, name: "RRSP A", kind: "rrsp", currency: "CAD" },
        { id: creditA, ownerId: ownerA, institutionId: institutionA, name: "Credit A", kind: "credit", currency: "CAD" },
        { id: otherA, ownerId: ownerA, institutionId: institutionA, name: "Collectible A", kind: "other", customTypeLabel: "Collectible", currency: "CAD" },
        { id: accountB, ownerId: ownerB, institutionId: institutionB, name: "Checking B", kind: "checking", currency: "CAD" },
      ]);
      await tx.insert(cashFlowPeriods).values([
        { id: periodA1, ownerId: ownerA, label: "Period A1", startsOn: "2026-08-02", endsOn: "2026-08-15", payDate: "2026-08-15", currency: "CAD" },
        { id: periodA2, ownerId: ownerA, label: "Period A2", startsOn: "2026-08-16", endsOn: "2026-08-29", payDate: "2026-08-29", currency: "CAD" },
      ]);
      await tx.insert(balanceSnapshots).values([
        { id: checkingSnapshot, ownerId: ownerA, accountId: checkingA, asOf: "2026-08-01", balanceMinor: 10_000, status: "actual", isGenerated: false, currency: "CAD" },
        { id: checkingPlannedSnapshot, ownerId: ownerA, accountId: checkingA, asOf: "2026-08-15", balanceMinor: 11_000, status: "planned", isGenerated: false, currency: "CAD" },
        { id: checkingFutureSnapshot, ownerId: ownerA, accountId: checkingA, asOf: "2026-08-29", balanceMinor: 12_000, status: "actual", isGenerated: false, currency: "CAD" },
        { id: savingsSnapshot, ownerId: ownerA, accountId: savingsA, asOf: "2026-08-01", balanceMinor: 3_000, status: "actual", isGenerated: false, currency: "CAD" },
        { id: rrspSnapshot, ownerId: ownerA, accountId: rrspA, asOf: "2026-08-01", balanceMinor: 50_000, status: "actual", isGenerated: false, currency: "CAD" },
        { id: creditSnapshot, ownerId: ownerA, accountId: creditA, asOf: "2026-08-01", balanceMinor: 4_000, status: "actual", isGenerated: false, currency: "CAD" },
        { id: otherSnapshot, ownerId: ownerA, accountId: otherA, asOf: "2026-08-01", balanceMinor: 2_000, status: "actual", isGenerated: false, currency: "CAD" },
        { ownerId: ownerB, accountId: accountB, asOf: "2026-08-01", balanceMinor: 999_999, status: "actual", isGenerated: false, currency: "CAD" },
      ]);
      await tx.insert(accountContributionRules).values({
        id: savingsRule,
        ownerId: ownerA,
        accountId: savingsA,
        amountMinor: 100,
        frequency: "weekly",
        startsOn: "2026-08-02",
        isEnabled: true,
      });
      await tx.insert(homes).values({ id: homeId, ownerId: ownerA, name: "Home A", currency: "CAD" });
      await tx.insert(householdExpenses).values({
        id: mortgageExpenseId,
        ownerId: ownerA,
        name: "Mortgage payment A",
        category: "mortgage",
        frequency: "biweekly",
        amountMinor: 1_000,
        annualAmountMinor: 26_000,
        currency: "CAD",
      });
      await tx.insert(homeValueSnapshots).values({ id: homeValueId, ownerId: ownerA, homeId, asOf: "2026-08-01", marketValueMinor: 200_000 });
      await tx.insert(homeMortgageAnchors).values({ id: mortgageAnchorId, ownerId: ownerA, homeId, asOf: "2026-08-01", principalMinor: 150_000 });
      await tx.insert(homeMortgageTerms).values({
        id: mortgageTermId,
        ownerId: ownerA,
        homeId,
        effectiveOn: "2026-08-01",
        annualRateBps: 500,
        compoundingConvention: "monthly",
        paymentExpenseId: mortgageExpenseId,
        paymentMinor: 1_000,
        nextPaymentOn: "2026-08-15",
        renewalOn: "2027-08-15",
        payoffOn: "2030-08-15",
      });
      await tx.insert(investmentAccounts).values({ id: investmentAccountId, ownerId: ownerA, accountId: rrspA, name: "Separate investment model", kind: "registered", currency: "CAD" });
      await tx.insert(investmentSnapshots).values({ id: investmentSnapshotId, ownerId: ownerA, investmentAccountId, asOf: "2026-08-01", balanceMinor: 900_000, currency: "CAD" });

      const beforeSnapshots = await tx.select({ id: balanceSnapshots.id }).from(balanceSnapshots).where(eq(balanceSnapshots.ownerId, ownerA));
      const beforePeriods = await tx.select({ id: cashFlowPeriods.id }).from(cashFlowPeriods).where(eq(cashFlowPeriods.ownerId, ownerA));
      const beforeInvestmentSnapshots = await tx.select({ id: investmentSnapshots.id }).from(investmentSnapshots).where(eq(investmentSnapshots.ownerId, ownerA));

      const repository = createNetWorthHistoryRepository(tx as unknown as Database);
      const model = await repository.getHistory(ownerA, { evaluationDate: "2026-08-15", selectedRange: "all" });
      const actual = model.points.find((point) => point.asOf === "2026-08-01");
      const firstProjected = model.points.find((point) => point.isFirstProjected);

      expect(model.currency).toBe("CAD");
      expect(actual).toMatchObject({
        phase: "actual",
        netWorthMinor: 111_000,
        investmentsMinor: 50_000,
        cashOtherMinor: 15_000,
        homeEquityMinor: 50_000,
      });
      expect(firstProjected).toMatchObject({
        asOf: "2026-08-15",
        phase: "projected",
        isFirstProjected: true,
        netWorthMinor: 112_713,
        investmentsMinor: 50_000,
        homeEquityMinor: 50_713,
        cashOtherMinor: 16_000,
      });
      expect(model.points.find((point) => point.asOf === "2026-08-29")).toMatchObject({
        phase: "projected",
        cashOtherMinor: 17_200,
      });
      expect(model.firstProjectedAsOf).toBe("2026-08-15");
      expect(model.points.some((point) => point.investmentsMinor === 950_000)).toBe(false);
      expect(model.points.some((point) => point.cashOtherMinor === 999_999)).toBe(false);
      expect(model.points.some((point) => point.asOf === "2027-02-15" && point.phase === "projected")).toBe(true);

      const afterSnapshots = await tx.select({ id: balanceSnapshots.id }).from(balanceSnapshots).where(eq(balanceSnapshots.ownerId, ownerA));
      const afterPeriods = await tx.select({ id: cashFlowPeriods.id }).from(cashFlowPeriods).where(eq(cashFlowPeriods.ownerId, ownerA));
      const afterInvestmentSnapshots = await tx.select({ id: investmentSnapshots.id }).from(investmentSnapshots).where(eq(investmentSnapshots.ownerId, ownerA));
      expect(afterSnapshots).toEqual(beforeSnapshots);
      expect(afterPeriods).toEqual(beforePeriods);
      expect(afterInvestmentSnapshots).toEqual(beforeInvestmentSnapshots);

      throw rollbackMarker;
    }), rollbackMarker);
  });

  it("continues account contributions to the six-month horizon when stored periods end early", async () => {
    if (!database) return;
    const ownerId = "00000000-0000-0000-0000-0000000000e1";
    const institutionId = "10000000-0000-4000-8000-0000000000e1";
    const accountId = "20000000-0000-4000-8000-0000000000e1";
    const periodId = "30000000-0000-4000-8000-0000000000e1";
    const snapshotId = "40000000-0000-4000-8000-0000000000e1";
    const ruleId = "50000000-0000-4000-8000-0000000000e1";
    const rollbackMarker = new Error("net-worth history forecast rollback");

    await expect(database.transaction(async (tx) => {
      await tx.insert(users).values({ id: ownerId, email: "net-worth-history-forecast@athena-vault.local" });
      await tx.insert(institutions).values({ id: institutionId, ownerId, name: "Forecast bank", currency: "CAD" });
      await tx.insert(accounts).values({ id: accountId, ownerId, institutionId, name: "Forecast checking", kind: "checking", currency: "CAD" });
      await tx.insert(cashFlowPeriods).values({ id: periodId, ownerId, label: "Stored period", startsOn: "2026-08-02", endsOn: "2026-08-15", payDate: "2026-08-15", currency: "CAD" });
      await tx.insert(balanceSnapshots).values({ id: snapshotId, ownerId, accountId, asOf: "2026-08-01", balanceMinor: 1_000, status: "actual", isGenerated: false, currency: "CAD" });
      await tx.insert(accountContributionRules).values({ id: ruleId, ownerId, accountId, amountMinor: 100, frequency: "weekly", startsOn: "2026-08-02", isEnabled: true });

      const beforeSnapshots = await tx.select({ id: balanceSnapshots.id }).from(balanceSnapshots).where(and(eq(balanceSnapshots.ownerId, ownerId), eq(balanceSnapshots.accountId, accountId)));
      const model = await createNetWorthHistoryRepository(tx as unknown as Database).getHistory(ownerId, {
        evaluationDate: "2026-08-15",
        projectedMonths: 6,
        selectedRange: "all",
      });
      const horizonPoint = model.points.find((point) => point.asOf === "2027-02-15");

      expect(model.projectedThrough).toBe("2027-02-15");
      expect(horizonPoint).toMatchObject({ phase: "projected", cashOtherMinor: expect.any(Number), homeEquityMinor: null, netWorthMinor: null });
      expect(horizonPoint?.cashOtherMinor).toBeGreaterThan(1_200);
      expect(await tx.select({ id: balanceSnapshots.id }).from(balanceSnapshots).where(and(eq(balanceSnapshots.ownerId, ownerId), eq(balanceSnapshots.accountId, accountId)))).toEqual(beforeSnapshots);

      throw rollbackMarker;
    })).rejects.toThrow(rollbackMarker.message);
  });
});
