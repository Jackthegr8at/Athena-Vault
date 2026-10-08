import { describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../client";
import { expectIntegrationRollback } from "../integration-test-helpers";
import { toTorontoDateIso } from "../account-timeline";
import { createAnnualBudgetRepository } from "../annual-budgets";
import {
  accounts,
  annualBudgets,
  annualExpensePayments,
  annualExpenses,
  annualExpenseValues,
  institutions,
  users,
} from "../drizzle-schema";
import { getAnnualExpensesReadModel } from "./annual-expenses";

const connectionString = process.env.DATABASE_URL;
const database = connectionString ? createDatabase(connectionString) : undefined;

const ownerA = "00000000-0000-0000-0000-0000000000fa";
const ownerB = "00000000-0000-0000-0000-0000000000fb";

describe.skipIf(!database)("getAnnualExpensesReadModel (integration)", () => {
  it("matches pre-refactor summary semantics and preserves integer minor units", async () => {
    if (!database) return;
    const rollbackMarker = new Error("annual-expenses integration rollback");
    const todayIso = toTorontoDateIso();
    const currentYear = Number(todayIso.slice(0, 4));

    await expectIntegrationRollback(
      database.transaction(async (tx) => {
        await tx.insert(users).values([
          { id: ownerA, email: "annual-expenses-owner@athena-vault.local" },
          { id: ownerB, email: "annual-expenses-other-owner@athena-vault.local" },
        ]);

        const [institution] = await tx
          .insert(institutions)
          .values({ ownerId: ownerA, name: "Integration Bank", currency: "CAD" })
          .returning({ id: institutions.id });
        if (!institution) throw new Error("Institution insert failed");

        const [account] = await tx
          .insert(accounts)
          .values({
            id: "20000000-0000-0000-0000-0000000000e1",
            ownerId: ownerA,
            institutionId: institution.id,
            name: "Linked",
            kind: "checking",
            currency: "CAD",
            timelineOrder: 0,
          })
          .returning({ id: accounts.id });
        if (!account) throw new Error("Account insert failed");

        const [budget] = await tx
          .insert(annualBudgets)
          .values({
            id: "30000000-0000-0000-0000-0000000000e1",
            ownerId: ownerA,
            name: "Budget A",
            linkedAccountId: account.id,
            isActive: true,
            displayOrder: 0,
          })
          .returning({ id: annualBudgets.id });
        if (!budget) throw new Error("Budget insert failed");
        const [otherInstitution] = await tx
          .insert(institutions)
          .values({ ownerId: ownerB, name: "Other Bank", currency: "CAD" })
          .returning({ id: institutions.id });
        if (!otherInstitution) throw new Error("Other institution insert failed");
        const [otherAccount] = await tx
          .insert(accounts)
          .values({
            id: "20000000-0000-0000-0000-0000000000e2",
            ownerId: ownerB,
            institutionId: otherInstitution.id,
            name: "Other linked",
            kind: "checking",
            currency: "CAD",
            timelineOrder: 0,
          })
          .returning({ id: accounts.id });
        if (!otherAccount) throw new Error("Other account insert failed");
        const [otherBudget] = await tx
          .insert(annualBudgets)
          .values({
            id: "30000000-0000-0000-0000-0000000000e2",
            ownerId: ownerB,
            name: "Other budget",
            linkedAccountId: otherAccount.id,
            isActive: true,
            displayOrder: 0,
          })
          .returning({ id: annualBudgets.id });
        if (!otherBudget) throw new Error("Other budget insert failed");

        const [otherExpense] = await tx
          .insert(annualExpenses)
          .values({
            id: "40000000-0000-0000-0000-0000000000e2",
            ownerId: ownerB,
            budgetId: otherBudget.id,
            name: "Other insurance",
            amountMinor: 20_000,
            fundedMinor: 0,
            dueMonth: 6,
            dueDay: 20,
            currency: "CAD",
            isActive: true,
          })
          .returning({ id: annualExpenses.id });
        if (!otherExpense) throw new Error("Other expense insert failed");

        const [otherValue] = await tx
          .insert(annualExpenseValues)
          .values({
            id: "50000000-0000-0000-0000-0000000000e2",
            ownerId: ownerB,
            annualExpenseId: otherExpense.id,
            budgetId: otherBudget.id,
            taxYear: currentYear,
            amountMinor: 25_000,
            amountOverrideMinor: 24_000,
            dueMonthOverride: 5,
            dueDayOverride: 25,
            fundedMinor: 0,
            currency: "CAD",
          })
          .returning({ id: annualExpenseValues.id });
        if (!otherValue) throw new Error("Other value insert failed");

        await tx.insert(annualExpensePayments).values({
          id: "60000000-0000-0000-0000-0000000000e2",
          ownerId: ownerB,
          annualExpenseValueId: otherValue.id,
          paymentOn: `${currentYear}-01-15`,
          amountMinor: 5_000,
          note: "Other owner payment",
        });


        const [expense] = await tx
          .insert(annualExpenses)
          .values({
            id: "40000000-0000-0000-0000-0000000000e1",
            ownerId: ownerA,
            budgetId: budget.id,
            name: "Insurance",
            amountMinor: 10_000,
            fundedMinor: 0,
            dueMonth: 4,
            dueDay: 15,
            currency: "CAD",
            isActive: true,
          })
          .returning({ id: annualExpenses.id });
        if (!expense) throw new Error("Expense insert failed");

        const [value] = await tx
          .insert(annualExpenseValues)
          .values({
            id: "50000000-0000-0000-0000-0000000000e1",
            ownerId: ownerA,
            annualExpenseId: expense.id,
            budgetId: budget.id,
            taxYear: currentYear,
            amountMinor: 12_000,
            amountOverrideMinor: 11_000,
            dueMonthOverride: 3,
            dueDayOverride: 10,
            fundedMinor: 0,
            currency: "CAD",
          })
          .returning({ id: annualExpenseValues.id });
        if (!value) throw new Error("Value insert failed");

        const readModel = await getAnnualExpensesReadModel(tx as unknown as Database, ownerA, undefined, todayIso);

        expect(readModel.taxYear).toBe(currentYear);
        expect(readModel.years).toContain(currentYear);
        expect(readModel.summary.budgets).toHaveLength(1);
        expect(readModel.initialSummary.budgets.map((entry) => entry.id)).toEqual([budget.id]);
        expect(readModel.timeline.accounts.every((entry) => entry.id === account.id)).toBe(true);
        const allItemIds = readModel.summary.budgets.flatMap((b) => b.items.map((item) => item.id));
        expect(allItemIds).toEqual([expense.id]);
        const summaryItem = readModel.summary.budgets[0]?.items[0];
        expect(summaryItem?.occurrence.id).toBe(value.id);
        expect(summaryItem?.history.map((entry) => entry.id)).toEqual([value.id]);
        const allPaymentIds = readModel.summary.budgets.flatMap((b) =>
          b.items.flatMap((item) => item.occurrence.payments.map((p) => p.id)),
        );
        expect(allPaymentIds).toEqual([]);

        const budgetView = readModel.summary.budgets[0]!;
        expect(budgetView).toMatchObject({
          name: "Budget A",
          itemCount: 1,
          totalPlannedMinor: 11_000,
          totalPaidMinor: 0,
          totalRemainingMinor: 11_000,
        });
        expect(Number.isSafeInteger(budgetView.totalPlannedMinor)).toBe(true);
        expect(Number.isSafeInteger(budgetView.totalPaidMinor)).toBe(true);
        expect(Number.isSafeInteger(budgetView.totalRemainingMinor)).toBe(true);

        const preRefactor = await createAnnualBudgetRepository(
          tx as unknown as Database,
        ).getSummary(ownerA, readModel.taxYear);
        expect(readModel.summary).toEqual(preRefactor);

        throw rollbackMarker;
      }),
      rollbackMarker,
    );
  });
});
