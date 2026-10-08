import { and, asc, eq } from "drizzle-orm";
import type { Database } from "../client";
import {
  accounts,
  annualExpenseValues,
  annualExpenses,
} from "../drizzle-schema";

export interface AnnualExpenseValueView {
  readonly taxYear: number;
  readonly amountMinor: number;
  readonly fundedMinor: number;
}


export interface AnnualExpenseView {
  readonly id: string;
  readonly name: string;
  readonly accountName: string | null;
  readonly amountMinor: number;
  readonly fundedMinor: number;
  readonly dueMonth: number | null;
  readonly dueDay: number | null;
  readonly currency: (typeof annualExpenses.$inferSelect)["currency"];
  readonly values: readonly AnnualExpenseValueView[];
}


export interface AnnualExpenseSummary {
  readonly expenses: readonly AnnualExpenseView[];
  readonly currentYear: number;
  readonly nextYear: number;
  readonly baseTotalMinor: number;
  readonly currentTotalMinor: number;
  readonly nextTotalMinor: number;
  readonly fundedMinor: number;
  readonly remainingMinor: number;
}


export function createAnnualExpenseRepository(db: Database) {
  async function listByOwner(ownerId: string): Promise<readonly AnnualExpenseView[]> {
    const [expenseRows, valueRows] = await Promise.all([
      db.select({
        id: annualExpenses.id,
        name: annualExpenses.name,
        accountName: accounts.name,
        amountMinor: annualExpenses.amountMinor,
        fundedMinor: annualExpenses.fundedMinor,
        dueMonth: annualExpenses.dueMonth,
        dueDay: annualExpenses.dueDay,
        currency: annualExpenses.currency,
      }).from(annualExpenses)
        .leftJoin(accounts, and(eq(accounts.id, annualExpenses.accountId), eq(accounts.ownerId, ownerId)))
        .where(eq(annualExpenses.ownerId, ownerId))
        .orderBy(asc(annualExpenses.name), asc(annualExpenses.id)),
      db.select({
        annualExpenseId: annualExpenseValues.annualExpenseId,
        taxYear: annualExpenseValues.taxYear,
        amountMinor: annualExpenseValues.amountMinor,
        fundedMinor: annualExpenseValues.fundedMinor,
      }).from(annualExpenseValues)
        .where(eq(annualExpenseValues.ownerId, ownerId))
        .orderBy(asc(annualExpenseValues.taxYear), asc(annualExpenseValues.id)),
    ]);
    const valuesByExpense = new Map<string, AnnualExpenseValueView[]>();
    for (const row of valueRows) {
      const values = valuesByExpense.get(row.annualExpenseId) ?? [];
      values.push({ taxYear: row.taxYear, amountMinor: row.amountMinor, fundedMinor: row.fundedMinor });
      valuesByExpense.set(row.annualExpenseId, values);
    }
    return expenseRows.map((row) => ({ ...row, values: valuesByExpense.get(row.id) ?? [] }));
  }

  return {
    listByOwner,
    async getSummary(ownerId: string, asOfYear = new Date().getUTCFullYear()): Promise<AnnualExpenseSummary> {
      const expenses = await listByOwner(ownerId);
      const years = [...new Set(expenses.flatMap((expense) => expense.values.map((value) => value.taxYear)))].sort((a, b) => a - b);
      const currentYear = years.filter((year) => year <= asOfYear).at(-1) ?? years[0] ?? asOfYear;
      const nextYear = years.find((year) => year > currentYear) ?? currentYear + 1;
      const totalFor = (year: number) => expenses.reduce((sum, expense) => sum + (expense.values.find((value) => value.taxYear === year)?.amountMinor ?? 0), 0);
      const fundedFor = (year: number) => expenses.reduce((sum, expense) => sum + (expense.values.find((value) => value.taxYear === year)?.fundedMinor ?? 0), 0);
      const currentTotalMinor = totalFor(currentYear);
      const fundedMinor = fundedFor(currentYear);
      return {
        expenses,
        currentYear,
        nextYear,
        baseTotalMinor: expenses.reduce((sum, expense) => sum + expense.amountMinor, 0),
        currentTotalMinor,
        nextTotalMinor: totalFor(nextYear),
        fundedMinor,
        remainingMinor: Math.max(0, currentTotalMinor - fundedMinor),
      };
    },
  };
}
