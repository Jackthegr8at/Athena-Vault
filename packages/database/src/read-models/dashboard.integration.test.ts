import { describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../client";
import { expectIntegrationRollback } from "../integration-test-helpers";
import { toTorontoDateIso } from "../account-timeline";
import {
  accounts,
  annualBudgets,
  annualExpenses,
  annualExpenseValues,
  balanceSnapshots,
  cashFlowPeriods,
  homes,
  homeValueSnapshots,
  institutions,
  investmentAccounts,
  investmentScenarios,
  investmentSnapshots,
  users,
} from "../drizzle-schema";
import { getDashboardReadModel } from "./dashboard";

const connectionString = process.env.DATABASE_URL;
const database = connectionString ? createDatabase(connectionString) : undefined;

const ownerA = "00000000-0000-0000-0000-0000000000da";
const ownerB = "00000000-0000-0000-0000-0000000000db";

describe.skipIf(!database)("getDashboardReadModel (integration)", () => {
  it("isolates every dashboard collection to owner A and preserves integer minor units", async () => {
    if (!database) return;
    const rollbackMarker = new Error("dashboard integration rollback");
    const asOf = toTorontoDateIso();
    const currentYear = Number(asOf.slice(0, 4));

    await expectIntegrationRollback(
      database.transaction(async (tx) => {
        await tx.insert(users).values([
          { id: ownerA, email: "dashboard-owner-a@athena-vault.local" },
          { id: ownerB, email: "dashboard-owner-b@athena-vault.local" },
        ]);

        const [aInstitution] = await tx
          .insert(institutions)
          .values({ ownerId: ownerA, name: "A Bank", currency: "CAD" })
          .returning({ id: institutions.id });
        const [bInstitution] = await tx
          .insert(institutions)
          .values({ ownerId: ownerB, name: "B Bank", currency: "CAD" })
          .returning({ id: institutions.id });
        if (!aInstitution || !bInstitution) throw new Error("Institution insert failed");

        const [aAccount] = await tx
          .insert(accounts)
          .values({
            ownerId: ownerA,
            institutionId: aInstitution.id,
            name: "A Checking",
            kind: "checking",
            currency: "CAD",
          })
          .returning({ id: accounts.id });
        const [bAccount] = await tx
          .insert(accounts)
          .values({
            ownerId: ownerB,
            institutionId: bInstitution.id,
            name: "B Checking",
            kind: "checking",
            currency: "CAD",
          })
          .returning({ id: accounts.id });
        if (!aAccount || !bAccount) throw new Error("Account insert failed");

        await tx.insert(balanceSnapshots).values([
          {
            ownerId: ownerA,
            accountId: aAccount.id,
            asOf,
            balanceMinor: 50_000,
            status: "actual",
            isGenerated: false,
            currency: "CAD",
          },
          {
            ownerId: ownerB,
            accountId: bAccount.id,
            asOf,
            balanceMinor: 20_000,
            status: "actual",
            isGenerated: false,
            currency: "CAD",
          },
        ]);

        const [aBudget] = await tx
          .insert(annualBudgets)
          .values({
            ownerId: ownerA,
            name: "A Budget",
            linkedAccountId: aAccount.id,
          })
          .returning({ id: annualBudgets.id });
        const [bBudget] = await tx
          .insert(annualBudgets)
          .values({
            ownerId: ownerB,
            name: "B Budget",
            linkedAccountId: bAccount.id,
          })
          .returning({ id: annualBudgets.id });
        if (!aBudget || !bBudget) throw new Error("Budget insert failed");

        const [aExpense] = await tx
          .insert(annualExpenses)
          .values({
            ownerId: ownerA,
            budgetId: aBudget.id,
            accountId: aAccount.id,
            name: "A Insurance",
            amountMinor: 10_000,
            dueMonth: 4,
            dueDay: 15,
            currency: "CAD",
          })
          .returning({ id: annualExpenses.id });
        const [bExpense] = await tx
          .insert(annualExpenses)
          .values({
            ownerId: ownerB,
            budgetId: bBudget.id,
            accountId: bAccount.id,
            name: "B Insurance",
            amountMinor: 100_000,
            dueMonth: 4,
            dueDay: 15,
            currency: "CAD",
          })
          .returning({ id: annualExpenses.id });
        if (!aExpense || !bExpense) throw new Error("Expense insert failed");

        await tx.insert(annualExpenseValues).values([
          {
            ownerId: ownerA,
            annualExpenseId: aExpense.id,
            budgetId: aBudget.id,
            taxYear: currentYear,
            amountMinor: 11_000,
            fundedMinor: 0,
            currency: "CAD",
          },
          {
            ownerId: ownerB,
            annualExpenseId: bExpense.id,
            budgetId: bBudget.id,
            taxYear: currentYear,
            amountMinor: 99_000,
            fundedMinor: 0,
            currency: "CAD",
          },
        ]);

        const [aInvestmentAccount] = await tx
          .insert(investmentAccounts)
          .values({
            ownerId: ownerA,
            institutionId: aInstitution.id,
            name: "A RRSP",
            kind: "retirement",
            currency: "CAD",
          })
          .returning({ id: investmentAccounts.id });
        const [bInvestmentAccount] = await tx
          .insert(investmentAccounts)
          .values({
            ownerId: ownerB,
            institutionId: bInstitution.id,
            name: "B RRSP",
            kind: "retirement",
            currency: "CAD",
          })
          .returning({ id: investmentAccounts.id });
        if (!aInvestmentAccount || !bInvestmentAccount) throw new Error("Investment account insert failed");

        await tx.insert(investmentSnapshots).values([
          {
            ownerId: ownerA,
            investmentAccountId: aInvestmentAccount.id,
            asOf,
            balanceMinor: 100_000,
            contributionMinor: 1_000,
            withdrawalMinor: 0,
            currency: "CAD",
          },
          {
            ownerId: ownerB,
            investmentAccountId: bInvestmentAccount.id,
            asOf,
            balanceMinor: 200_000,
            contributionMinor: 2_000,
            withdrawalMinor: 0,
            currency: "CAD",
          },
        ]);

        await tx.insert(investmentScenarios).values([
          {
            ownerId: ownerA,
            investmentAccountId: aInvestmentAccount.id,
            name: "A Accepted",
            startsOn: asOf,
            initialValueMinor: 100_000,
            periodicContributionMinor: 1_200,
            annualReturnBps: 500,
            horizonYears: 10,
            status: "accepted",
            currency: "CAD",
          },
          {
            ownerId: ownerB,
            investmentAccountId: bInvestmentAccount.id,
            name: "B Accepted",
            startsOn: asOf,
            initialValueMinor: 200_000,
            periodicContributionMinor: 9_000,
            annualReturnBps: 500,
            horizonYears: 10,
            status: "accepted",
            currency: "CAD",
          },
        ]);

        const [aPeriod] = await tx
          .insert(cashFlowPeriods)
          .values({
            ownerId: ownerA,
            label: "A Current",
            startsOn: asOf,
            endsOn: asOf,
            payDate: asOf,
            openingBalanceMinor: 0,
            status: "actual",
            currency: "CAD",
          })
          .returning({ id: cashFlowPeriods.id });
        if (!aPeriod) throw new Error("Cash-flow period insert failed");

        await tx.insert(cashFlowPeriods).values({
          ownerId: ownerB,
          label: "B Future",
          startsOn: "2030-01-01",
          endsOn: "2030-01-31",
          payDate: "2030-01-15",
          openingBalanceMinor: 0,
          status: "planned",
          currency: "CAD",
        });

        const [aHome] = await tx
          .insert(homes)
          .values({ ownerId: ownerA, name: "A Home", currency: "CAD" })
          .returning({ id: homes.id });
        const [bHome] = await tx
          .insert(homes)
          .values({ ownerId: ownerB, name: "B Home", currency: "CAD" })
          .returning({ id: homes.id });
        if (!aHome || !bHome) throw new Error("Home insert failed");

        await tx.insert(homeValueSnapshots).values([
          {
            ownerId: ownerA,
            homeId: aHome.id,
            asOf,
            marketValueMinor: 1_000_000,
          },
          {
            ownerId: ownerB,
            homeId: bHome.id,
            asOf,
            marketValueMinor: 2_000_000,
          },
        ]);

        const model = await getDashboardReadModel(tx as unknown as Database, ownerA, asOf);

        expect(model.periodWindow.totalPeriodCount).toBe(1);
        expect(model.periodWindow.periods).toHaveLength(1);
        expect(model.periodWindow.periods[0]?.period.label).toBe("A Current");
        expect(model.periodWindow.periods[0]?.period.status).toBe("actual");
        expect(model.periodWindow.periods[0]?.transactions).toHaveLength(0);
        expect(model.periodWindow.periods[0]?.transfers).toHaveLength(0);
        expect(
          model.periodWindow.periods.every((p) => !p.period.label.includes("B Future")),
        ).toBe(true);

        expect(model.periodWindow.accounts).toHaveLength(1);
        expect(model.periodWindow.accounts[0]?.name).toBe("A Checking");
        expect(model.periodWindow.accounts[0]?.institution).toBe("A Bank");
        expect(
          model.periodWindow.accounts.every((a) => a.institution !== "B Bank"),
        ).toBe(true);

        expect(model.periodWindow.anchors).toHaveLength(1);
        expect(model.periodWindow.anchors[0]?.accountId).toBe(aAccount.id);
        expect(model.periodWindow.anchors[0]?.balanceMinor).toBe(50_000);
        expect(model.periodWindow.anchors[0]?.status).toBe("actual");
        expect(
          model.periodWindow.anchors.every((a) => a.accountId !== bAccount.id),
        ).toBe(true);

        expect(model.upcomingPeriods).toHaveLength(1);
        expect(model.upcomingPeriods[0]?.period.id).toBe(aPeriod.id);
        expect(
          model.upcomingPeriods.every((p) => p.period.label !== "B Future"),
        ).toBe(true);

        expect(model.annual.expenses).toHaveLength(1);
        expect(model.annual.expenses[0]?.name).toBe("A Insurance");
        expect(model.annual.expenses[0]?.accountName).toBe("A Checking");
        expect(model.annual.expenses[0]?.values[0]?.amountMinor).toBe(11_000);
        expect(model.annual.expenses[0]?.values[0]?.fundedMinor).toBe(0);
        expect(model.annual.currentYear).toBe(currentYear);
        expect(model.annual.currentTotalMinor).toBe(11_000);
        expect(model.annual.baseTotalMinor).toBe(10_000);
        expect(model.annual.fundedMinor).toBe(0);
        expect(model.annual.remainingMinor).toBe(11_000);
        expect(Number.isSafeInteger(model.annual.currentTotalMinor)).toBe(true);
        expect(Number.isSafeInteger(model.annual.baseTotalMinor)).toBe(true);
        expect(Number.isSafeInteger(model.annual.remainingMinor)).toBe(true);

        expect(model.investments.accounts).toHaveLength(1);
        expect(model.investments.accounts[0]?.name).toBe("A RRSP");
        expect(model.investments.accounts[0]?.latest?.balanceMinor).toBe(100_000);
        expect(model.investments.accounts[0]?.latest?.contributionMinor).toBe(1_000);
        expect(model.investments.currentValueMinor).toBe(100_000);
        expect(model.investments.monthlyContributionMinor).toBe(1_200);
        expect(model.investments.scenarios).toHaveLength(1);
        expect(model.investments.scenarios[0]?.name).toBe("A Accepted");
        expect(
          model.investments.accounts.every((a) => a.name !== "B RRSP"),
        ).toBe(true);
        expect(
          model.investments.scenarios.every((s) => s.name !== "B Accepted"),
        ).toBe(true);
        expect(Number.isSafeInteger(model.investments.currentValueMinor)).toBe(true);
        expect(Number.isSafeInteger(model.investments.monthlyContributionMinor)).toBe(true);

        expect(model.accounts).toHaveLength(1);
        expect(model.accounts[0]?.name).toBe("A Checking");
        expect(model.accounts[0]?.institution).toBe("A Bank");
        expect(model.accounts[0]?.balanceMinor).toBe(50_000);
        expect(model.accounts[0]?.asOf).toBe(asOf);
        expect(Number.isSafeInteger(model.accounts[0]?.balanceMinor ?? 0)).toBe(true);
        expect(
          model.accounts.every((a) => a.institution !== "B Bank"),
        ).toBe(true);

        expect(model.home).not.toBeNull();
        expect(model.home?.name).toBe("A Home");
        expect(model.home?.currency).toBe("CAD");
        expect(model.home?.currentEquityMinor).toBe(1_000_000);
        expect(model.home?.mortgageConfigured).toBe(false);
        expect(model.home?.values[0]?.marketValueMinor).toBe(1_000_000);

        expect(model.netWorthHistory.currency).toBe("CAD");
        expect(model.netWorthHistory.points.some((p) => p.netWorthMinor !== null)).toBe(true);
        expect(
          model.netWorthHistory.points.every((p) =>
            Number.isSafeInteger(p.netWorthMinor ?? 0),
          ),
        ).toBe(true);
        expect(
          model.netWorthHistory.points.every((p) =>
            Number.isSafeInteger(p.cashOtherMinor ?? 0),
          ),
        ).toBe(true);
        expect(
          model.netWorthHistory.points.every((p) =>
            Number.isSafeInteger(p.investmentsMinor ?? 0),
          ),
        ).toBe(true);
        expect(
          model.netWorthHistory.points.every((p) =>
            Number.isSafeInteger(p.homeEquityMinor ?? 0),
          ),
        ).toBe(true);
        expect(
          model.netWorthHistory.points.every((p) => (p.cashOtherMinor ?? 0) <= 50_000),
        ).toBe(true);
        expect(
          model.netWorthHistory.points.every(
            (p) => (p.investmentsMinor ?? 0) <= 100_000,
          ),
        ).toBe(true);
        expect(
          model.netWorthHistory.points.every(
            (p) => (p.homeEquityMinor ?? 0) <= 1_000_000,
          ),
        ).toBe(true);
        expect(
          model.netWorthHistory.points.every(
            (p) => (p.netWorthMinor ?? 0) <= 1_150_000,
          ),
        ).toBe(true);

        throw rollbackMarker;
      }),
      rollbackMarker,
    );
  });
});
