import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDatabase, type Database } from "./client";
import { createInvestmentProjectionRepository } from "./repositories/investment-projection";
import {
  accountContributionRules,
  accounts,
  auditEvents,
  institutions,
  investmentAccounts,
  investmentProjectionProjectAccountScheduleOverrides,
  investmentProjectionProjectAccountSchedules,
  investmentProjectionProjectAccounts,
  investmentProjectionProjectRates,
  investmentProjectionProjects,
  investmentSnapshots,
  recurringCashFlowSeries,
  recurringTransactions,
  users,
} from "./drizzle-schema";

const connectionString = process.env.DATABASE_URL;
const database = connectionString ? createDatabase(connectionString) : undefined;

describe.skipIf(!database)("investment projection repository", () => {
  it("supports isolated calculator and portfolio projects without mutating source data", async () => {
    if (!database) return;

    const ownerA = "00000000-0000-4000-8000-0000000000f1";
    const ownerB = "00000000-0000-4000-8000-0000000000f2";
    const institutionA = "10000000-0000-4000-8000-0000000000f1";
    const institutionB = "10000000-0000-4000-8000-0000000000f2";
    const ordinaryAccountA = "20000000-0000-4000-8000-0000000000f1";
    const ordinaryAccountB = "20000000-0000-4000-8000-0000000000f2";
    const ordinaryAccountA2 = "20000000-0000-4000-8000-0000000000f3";
    const investmentAccountA = "30000000-0000-4000-8000-0000000000f1";
    const investmentAccountB = "30000000-0000-4000-8000-0000000000f2";
    const investmentAccountA2 = "30000000-0000-4000-8000-0000000000f3";
    const investmentSnapshotA = "40000000-0000-4000-8000-0000000000f1";
    const investmentSnapshotAAfterBaseline = "40000000-0000-4000-8000-0000000000f2";
    const investmentSnapshotB = "40000000-0000-4000-8000-0000000000f3";
    const monthlyRuleA = "50000000-0000-4000-8000-0000000000f1";
    const weeklyRuleA = "50000000-0000-4000-8000-0000000000f2";
    const annualRuleA = "50000000-0000-4000-8000-0000000000f3";
    const disabledBiweeklyRuleA = "50000000-0000-4000-8000-0000000000f4";
    const biweeklyRuleA2 = "50000000-0000-4000-8000-0000000000f5";
    const recurringSeriesA2 = "60000000-0000-4000-8000-0000000000f1";
    const recurringVersionA2 = "70000000-0000-4000-8000-0000000000f1";
    const rollbackMarker = new Error("investment projection integration rollback");

    await expect(database.transaction(async (tx) => {
      await tx.insert(users).values([
        { id: ownerA, email: "investment-projection-owner-a@athena-vault.local" },
        { id: ownerB, email: "investment-projection-owner-b@athena-vault.local" },
      ]);
      await tx.insert(institutions).values([
        { id: institutionA, ownerId: ownerA, name: "Projection institution A", currency: "CAD" },
        { id: institutionB, ownerId: ownerB, name: "Projection institution B", currency: "CAD" },
      ]);
      await tx.insert(accounts).values([
        { id: ordinaryAccountA, ownerId: ownerA, institutionId: institutionA, name: "Projection source A", kind: "checking", currency: "CAD" },
        { id: ordinaryAccountB, ownerId: ownerB, institutionId: institutionB, name: "Projection source B", kind: "checking", currency: "CAD" },
        { id: ordinaryAccountA2, ownerId: ownerA, institutionId: institutionA, name: "Projection source A2", kind: "checking", currency: "CAD" },
      ]);
      await tx.insert(investmentAccounts).values([
        { id: investmentAccountA, ownerId: ownerA, institutionId: institutionA, accountId: ordinaryAccountA, name: "Projection investment A", kind: "registered", currency: "CAD" },
        { id: investmentAccountB, ownerId: ownerB, institutionId: institutionB, accountId: ordinaryAccountB, name: "Projection investment B", kind: "registered", currency: "CAD" },
        { id: investmentAccountA2, ownerId: ownerA, institutionId: institutionA, accountId: ordinaryAccountA2, name: "Projection investment A2", kind: "registered", currency: "CAD" },
      ]);
      await tx.insert(investmentSnapshots).values([
        { id: investmentSnapshotA, ownerId: ownerA, investmentAccountId: investmentAccountA, asOf: "2026-08-05", balanceMinor: 100_000, currency: "CAD" },
        { id: investmentSnapshotAAfterBaseline, ownerId: ownerA, investmentAccountId: investmentAccountA, asOf: "2026-08-20", balanceMinor: 150_000, currency: "CAD" },
        { id: investmentSnapshotB, ownerId: ownerB, investmentAccountId: investmentAccountB, asOf: "2026-08-05", balanceMinor: 50_000, currency: "CAD" },
      ]);
      await tx.insert(accountContributionRules).values([
        { id: monthlyRuleA, ownerId: ownerA, accountId: ordinaryAccountA, amountMinor: 10_000, frequency: "monthly", startsOn: "2026-09-01", isEnabled: true },
        { id: weeklyRuleA, ownerId: ownerA, accountId: ordinaryAccountA, amountMinor: 3_000, frequency: "weekly", startsOn: "2026-09-01", isEnabled: true },
        { id: annualRuleA, ownerId: ownerA, accountId: ordinaryAccountA, amountMinor: 4_000, frequency: "annual", startsOn: "2026-09-01", isEnabled: true },
        { id: disabledBiweeklyRuleA, ownerId: ownerA, accountId: ordinaryAccountA, amountMinor: 5_000, frequency: "biweekly", startsOn: "2026-09-01", isEnabled: false },
        { id: biweeklyRuleA2, ownerId: ownerA, accountId: ordinaryAccountA2, amountMinor: 7_500, frequency: "biweekly", startsOn: "2026-09-01", isEnabled: true },
      ]);
      await tx.insert(recurringCashFlowSeries).values({ id: recurringSeriesA2, ownerId: ownerA, kind: "transfer", state: "active" });
      await tx.insert(recurringTransactions).values({
        id: recurringVersionA2,
        ownerId: ownerA,
        seriesId: recurringSeriesA2,
        fromAccountId: ordinaryAccountA,
        toAccountId: ordinaryAccountA2,
        kind: "transfer",
        frequency: "biweekly",
        description: "Projection automatic investment contribution",
        amountMinor: 5_000,
        startsOn: "2026-08-12",
        effectiveFrom: "2026-08-12",
        nextOccurrenceOn: "2026-08-12",
        currency: "CAD",
      });

      const repository = createInvestmentProjectionRepository(tx as unknown as Database);

      const sourceCounts = async () => ({
        investmentAccounts: (await tx.select({ id: investmentAccounts.id }).from(investmentAccounts).where(eq(investmentAccounts.ownerId, ownerA))).length,
        investmentSnapshots: (await tx.select({ id: investmentSnapshots.id }).from(investmentSnapshots).where(eq(investmentSnapshots.ownerId, ownerA))).length,
        contributionRules: (await tx.select({ id: accountContributionRules.id }).from(accountContributionRules).where(eq(accountContributionRules.ownerId, ownerA))).length,
        recurringSeries: (await tx.select({ id: recurringCashFlowSeries.id }).from(recurringCashFlowSeries).where(eq(recurringCashFlowSeries.ownerId, ownerA))).length,
        recurringVersions: (await tx.select({ id: recurringTransactions.id }).from(recurringTransactions).where(eq(recurringTransactions.ownerId, ownerA))).length,
      });
      const sourceCountsBefore = await sourceCounts();

      const calculatorId = await repository.createProject(ownerA, {
        mode: "calculator",
        name: "Manual calculator",
        notes: null,
        horizonYears: 3,
        manualStartingAmountMinor: 500_000,
        ratesBps: [500, 300],
      });
      const calculator = await repository.getProject(ownerA, calculatorId, "2026-08-05");
      expect(calculator).toMatchObject({
        mode: "calculator",
        manualStartingAmountMinor: 500_000,
        accountCount: 0,
        startingBalanceMinor: 500_000,
        accountSchedules: [],
        accounts: [],
      });
      expect(calculator?.annualContributionSummary).toEqual([]);
      expect(calculator?.scenarios[0]?.points[0]).toMatchObject({ year: 0, balanceMinor: 500_000, contributionsMinor: 0, growthMinor: 0 });
      expect(await tx.select({ id: investmentProjectionProjectAccounts.id }).from(investmentProjectionProjectAccounts).where(eq(investmentProjectionProjectAccounts.projectId, calculatorId))).toHaveLength(0);
      expect(await tx.select({ id: investmentProjectionProjectAccountSchedules.id }).from(investmentProjectionProjectAccountSchedules).where(eq(investmentProjectionProjectAccountSchedules.projectId, calculatorId))).toHaveLength(0);
      expect(await tx.select({ id: investmentProjectionProjectAccountScheduleOverrides.id }).from(investmentProjectionProjectAccountScheduleOverrides).where(eq(investmentProjectionProjectAccountScheduleOverrides.ownerId, ownerA))).toHaveLength(0);

      const prefill = await repository.getPortfolioSchedulePrefill(ownerA, [investmentAccountA, investmentAccountA2], "2026-08-05");
      expect(prefill).toHaveLength(2);
      expect(prefill[0]?.candidates).toEqual([
        expect.objectContaining({ ruleId: monthlyRuleA, amountMinor: 10_000, frequency: "monthly" }),
      ]);
      expect(prefill[0]?.suggested).toMatchObject({ investmentAccountId: investmentAccountA, frequency: "monthly", baseContributionMinor: 10_000, annualIncreaseBps: 0 });
      expect(prefill[1]?.candidates).toEqual([
        expect.objectContaining({ ruleId: biweeklyRuleA2, amountMinor: 7_500, frequency: "biweekly" }),
      ]);
      expect(prefill[1]?.suggested).toMatchObject({ investmentAccountId: investmentAccountA2, frequency: "biweekly", baseContributionMinor: 7_500, annualIncreaseBps: 0 });
      expect(await repository.getPortfolioSchedulePrefill(ownerA, [investmentAccountA, investmentAccountA2], "2026-08-05")).toEqual(prefill);

      await expect(repository.createProject(ownerB, {
        mode: "portfolio",
        name: "Cross-owner portfolio",
        notes: null,
        horizonYears: 3,
        accountSchedules: [{ investmentAccountId: investmentAccountA, frequency: "monthly", baseContributionMinor: 1_000, annualIncreaseBps: 0, annualOverrides: [] }],
        ratesBps: [500],
      })).rejects.toThrow(/selected investment accounts were not found/i);

      const ownerBProjectId = await repository.createProject(ownerB, {
        mode: "portfolio",
        name: "Owner B portfolio",
        notes: null,
        horizonYears: 3,
        accountSchedules: [{
          investmentAccountId: investmentAccountB,
          displayOrder: 0,
          frequency: "biweekly",
          baseContributionMinor: 5_000,
          annualIncreaseBps: 0,
          annualOverrides: [],
        }],
        ratesBps: [500],
      });
      expect(await repository.getProject(ownerA, ownerBProjectId, "2026-08-05")).toBeNull();
      expect(await repository.getProject(ownerB, ownerBProjectId, "2026-08-05")).toMatchObject({
        mode: "portfolio",
        accountCount: 1,
        startingBalanceMinor: 50_000,
      });

      const portfolioId = await repository.createProject(ownerA, {
        mode: "portfolio",
        name: "Recurring portfolio",
        notes: "Independent saved schedule",
        horizonYears: 3,
        accountSchedules: [{
          investmentAccountId: investmentAccountA,
          displayOrder: 0,
          frequency: "monthly",
          baseContributionMinor: 10_000,
          annualIncreaseBps: 1_000,
          contributionSource: "manual",
          annualOverrides: [{ year: 2027, amountMinor: 20_000 }],
        }],
        ratesBps: [500, 300],
      });
      const portfolio = await repository.getProject(ownerA, portfolioId, "2026-08-05");
      expect(portfolio).toMatchObject({
        mode: "portfolio",
        manualStartingAmountMinor: null,
        startingBalanceMinor: 100_000,
        accountCount: 1,
        baselineDate: "2026-08-05",
      });
      expect(portfolio?.accounts[0]).toMatchObject({
        id: investmentAccountA,
        latest: { asOf: "2026-08-05", balanceMinor: 100_000 },
        schedule: { frequency: "monthly", baseContributionMinor: 10_000, annualIncreaseBps: 1_000 },
      });
      expect(portfolio?.accountSchedules[0]?.annualOverrides).toEqual([
        expect.objectContaining({ year: 2027, amountMinor: 20_000 }),
      ]);
      expect(portfolio?.annualContributionSummary.slice(0, 2)).toEqual([
        { calendarYear: 2026, biweeklyAmountMinor: null, monthlyAmountMinor: 10_000, annualContributionMinor: 40_000, eventCount: 4 },
        { calendarYear: 2027, biweeklyAmountMinor: null, monthlyAmountMinor: 20_000, annualContributionMinor: 240_000, eventCount: 12 },
      ]);
      expect(portfolio?.scenarios[0]?.points[0]).toMatchObject({ year: 0, balanceMinor: 100_000, contributionsMinor: 0 });
      expect(portfolio?.scenarios[0]?.points.at(-1)?.balanceMinor).toBeGreaterThan(100_000);

      const fixedPortfolioId = await repository.createProject(ownerA, {
        mode: "portfolio",
        name: "Fixed annual contribution portfolio",
        notes: null,
        horizonYears: 2,
        accountSchedules: [{
          investmentAccountId: investmentAccountA2,
          displayOrder: 0,
          frequency: "biweekly",
          baseContributionMinor: 23_000,
          annualIncreaseBps: 0,
          annualIncreaseMode: "fixed_amount",
          annualIncreaseMinor: 3_000,
          contributionSource: "manual",
          annualOverrides: [],
        }],
        ratesBps: [0],
      });
      const fixedPortfolio = await repository.getProject(ownerA, fixedPortfolioId, "2026-08-05");
      expect(fixedPortfolio?.accountSchedules[0]).toMatchObject({
        frequency: "biweekly",
        baseContributionMinor: 23_000,
        annualIncreaseMode: "fixed_amount",
        annualIncreaseBps: 0,
        annualIncreaseMinor: 3_000,
      });

      const automaticPortfolioId = await repository.createProject(ownerA, {
        mode: "portfolio",
        name: "Automatic dated contribution portfolio",
        notes: null,
        horizonYears: 1,
        accountSchedules: [{
          investmentAccountId: investmentAccountA2,
          displayOrder: 0,
          frequency: "biweekly",
          baseContributionMinor: 5_000,
          annualIncreaseBps: 0,
          contributionSource: "cash_flow",
          annualOverrides: [],
        }],
        ratesBps: [0],
      });
      const automaticPortfolio = await repository.getProject(ownerA, automaticPortfolioId, "2026-08-05");
      expect(automaticPortfolio?.annualContributionSummary).toEqual([
        { calendarYear: 2026, biweeklyAmountMinor: 5_000, monthlyAmountMinor: 10_833, annualContributionMinor: 55_000, eventCount: 11 },
        { calendarYear: 2027, biweeklyAmountMinor: 5_000, monthlyAmountMinor: 10_833, annualContributionMinor: 75_000, eventCount: 15 },
      ]);
      expect(automaticPortfolio?.accounts[0]?.cashFlowTransferOutEvents).toHaveLength(26);
      expect(automaticPortfolio?.accounts[0]?.cashFlowTransferOutEvents.reduce((total, event) => total + event.amountMinor, 0)).toBe(-130_000);

      const page = await repository.getPageData(ownerA, "2026-08-05");
      expect(page.projects.map((project) => project.id)).toEqual(expect.arrayContaining([portfolioId, fixedPortfolioId, automaticPortfolioId]));
      expect(page.projects.some((project) => project.id === ownerBProjectId)).toBe(false);
      const pagePortfolio = page.projects.find((project) => project.id === portfolioId);
      const pageAutomaticPortfolio = page.projects.find((project) => project.id === automaticPortfolioId);
      expect(pagePortfolio).toEqual(expect.objectContaining({
        accountSchedules: portfolio?.accountSchedules,
        warnings: portfolio?.warnings,
      }));
      expect(pageAutomaticPortfolio).toEqual(expect.objectContaining({
        accountSchedules: automaticPortfolio?.accountSchedules,
        warnings: automaticPortfolio?.warnings,
      }));
      expect(pageAutomaticPortfolio?.accounts[0]?.cashFlowTransferOutEvents).toEqual(automaticPortfolio?.accounts[0]?.cashFlowTransferOutEvents);

      await tx.update(accountContributionRules)
        .set({ amountMinor: 99_999 })
        .where(and(eq(accountContributionRules.ownerId, ownerA), eq(accountContributionRules.id, monthlyRuleA)));
      const unchangedSchedule = await repository.getProject(ownerA, portfolioId, "2026-08-05");
      expect(unchangedSchedule?.accountSchedules[0]).toMatchObject({ baseContributionMinor: 10_000, annualIncreaseBps: 1_000 });

      await expect(repository.getProject(ownerB, portfolioId, "2026-08-05")).resolves.toBeNull();
      await expect(repository.updateProject(ownerB, portfolioId, {
        mode: "portfolio",
        name: "Unauthorized update",
        notes: null,
        horizonYears: 3,
        accountSchedules: [{ investmentAccountId: investmentAccountB, frequency: "monthly", baseContributionMinor: 1_000, annualIncreaseBps: 0, annualOverrides: [] }],
        ratesBps: [500],
      })).rejects.toThrow("Investment projection project not found.");
      await expect(repository.deleteProject(ownerB, portfolioId)).rejects.toThrow("Investment projection project not found.");
      await expect(repository.getProject(ownerA, portfolioId, "2026-08-05")).resolves.not.toBeNull();

      await repository.deleteProject(ownerA, portfolioId);
      expect(await tx.select({ id: investmentProjectionProjects.id }).from(investmentProjectionProjects).where(eq(investmentProjectionProjects.id, portfolioId))).toHaveLength(0);
      expect(await tx.select({ id: investmentProjectionProjectAccounts.id }).from(investmentProjectionProjectAccounts).where(eq(investmentProjectionProjectAccounts.projectId, portfolioId))).toHaveLength(0);
      expect(await tx.select({ id: investmentProjectionProjectRates.id }).from(investmentProjectionProjectRates).where(eq(investmentProjectionProjectRates.projectId, portfolioId))).toHaveLength(0);
      expect(await tx.select({ id: investmentProjectionProjectAccountSchedules.id }).from(investmentProjectionProjectAccountSchedules).where(eq(investmentProjectionProjectAccountSchedules.projectId, portfolioId))).toHaveLength(0);
      expect(await tx.select({ id: investmentProjectionProjectAccountScheduleOverrides.id }).from(investmentProjectionProjectAccountScheduleOverrides).where(eq(investmentProjectionProjectAccountScheduleOverrides.ownerId, ownerA))).toHaveLength(0);
      expect(await repository.getProject(ownerA, calculatorId, "2026-08-05")).not.toBeNull();
      await expect(repository.getProject(ownerB, ownerBProjectId, "2026-08-05")).resolves.not.toBeNull();
      expect(await tx.select({ id: investmentProjectionProjects.id }).from(investmentProjectionProjects).where(eq(investmentProjectionProjects.id, ownerBProjectId))).toHaveLength(1);
      expect(await sourceCounts()).toEqual(sourceCountsBefore);
      expect(await tx.select({ entityType: auditEvents.entityType, action: auditEvents.action }).from(auditEvents).where(and(eq(auditEvents.ownerId, ownerA), eq(auditEvents.entityType, "investment_projection_project")))).toEqual(expect.arrayContaining([
        { entityType: "investment_projection_project", action: "created" },
        { entityType: "investment_projection_project", action: "deleted" },
      ]));

      throw rollbackMarker;
    })).rejects.toThrow(rollbackMarker.message);

    expect(await database.select({ id: users.id }).from(users).where(eq(users.id, ownerA))).toHaveLength(0);
    expect(await database.select({ id: users.id }).from(users).where(eq(users.id, ownerB))).toHaveLength(0);
    expect(await database.select({ id: investmentProjectionProjects.id }).from(investmentProjectionProjects).where(eq(investmentProjectionProjects.ownerId, ownerA))).toHaveLength(0);
    expect(await database.select({ id: investmentProjectionProjects.id }).from(investmentProjectionProjects).where(eq(investmentProjectionProjects.ownerId, ownerB))).toHaveLength(0);
  });
});
