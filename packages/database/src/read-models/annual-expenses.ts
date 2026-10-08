import { and, asc, eq, inArray } from "drizzle-orm";
import { annualExpenseDueDate, deriveAnnualExpenseValues } from "@athena/finance-engine";
import type { Database } from "../client";
import { toTorontoDateIso } from "../account-timeline";
import {
  createAnnualBudgetRepository,
  type AnnualBudgetAccountOption,
  type AnnualBudgetItemView,
  type AnnualBudgetOccurrenceView,
  type AnnualBudgetPaymentView,
  type AnnualBudgetSummary,
} from "../annual-budgets";
import { createAccountTimelineRepository, type AccountTimelineView } from "../repositories/account-timeline";
import {
  accounts,
  annualBudgets,
  annualExpenses,
  annualExpensePayments,
  annualExpenseValues,
} from "../drizzle-schema";

export interface AnnualExpensesReadModel {
  readonly initialSummary: AnnualBudgetSummary;
  readonly eligibleAccounts: readonly AnnualBudgetAccountOption[];
  readonly years: readonly number[];
  readonly taxYear: number;
  readonly summary: AnnualBudgetSummary;
  readonly projectionSummaries: readonly AnnualBudgetSummary[];
  readonly timeline: AccountTimelineView;
}

interface BudgetRow {
  readonly id: string;
  readonly name: string;
  readonly linkedAccountId: string;
  readonly linkedAccountName: string;
  readonly isActive: boolean;
  readonly displayOrder: number;
}

interface ExpenseRow {
  readonly id: string;
  readonly budgetId: string;
  readonly name: string;
  readonly amountMinor: number;
  readonly dueMonth: number | null;
  readonly dueDay: number | null;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface ValueRow {
  readonly id: string;
  readonly annualExpenseId: string;
  readonly budgetId: string;
  readonly taxYear: number;
  readonly amountMinor: number;
  readonly amountOverrideMinor: number | null;
  readonly dueMonthOverride: number | null;
  readonly dueDayOverride: number | null;
  readonly note: string | null;
  readonly fundedMinor: number;
}

function assertOwnerId(ownerId: string): void {
  if (!ownerId.trim()) throw new RangeError("Owner ID is required.");
}

function effectiveDueDate(taxYear: number, dueMonth: number | null, dueDay: number | null): string | null {
  return dueMonth === null ? null : annualExpenseDueDate(taxYear, dueMonth, dueDay);
}

function occurrenceView(
  value: {
    readonly id: string | null;
    readonly taxYear: number;
    readonly budgetId: string;
    readonly amountMinor: number;
    readonly amountOverrideMinor: number | null;
    readonly dueMonthOverride: number | null;
    readonly dueDayOverride: number | null;
    readonly note: string | null;
    readonly fundedMinor: number;
  },
  template: {
    readonly amountMinor: number;
    readonly dueMonth: number | null;
    readonly dueDay: number | null;
  },
  payments: readonly AnnualBudgetPaymentView[],
): AnnualBudgetOccurrenceView {
  const dueMonth = value.dueMonthOverride ?? template.dueMonth;
  const dueDay = value.dueDayOverride ?? template.dueDay;
  const plannedAmountMinor = value.amountOverrideMinor ?? value.amountMinor;
  const derived = deriveAnnualExpenseValues(plannedAmountMinor, payments);
  return {
    id: value.id,
    taxYear: value.taxYear,
    budgetId: value.budgetId,
    plannedAmountMinor,
    templateAmountMinor: template.amountMinor,
    dueMonth,
    dueDay,
    dueDate: effectiveDueDate(value.taxYear, dueMonth, dueDay),
    amountOverrideMinor: value.amountOverrideMinor,
    dueDateOverridden: value.dueMonthOverride !== null || value.dueDayOverride !== null,
    note: value.note,
    legacyFundedMinor: value.fundedMinor,
    ...derived,
    payments,
  };
}

function buildAnnualBudgetSummary(
  taxYear: number,
  budgetRows: readonly BudgetRow[],
  expenseRows: readonly ExpenseRow[],
  valuesByExpense: ReadonlyMap<string, readonly ValueRow[]>,
  paymentsByValue: ReadonlyMap<string, readonly AnnualBudgetPaymentView[]>,
): AnnualBudgetSummary {
  const items = expenseRows.map<AnnualBudgetItemView>((expense) => {
    const history = (valuesByExpense.get(expense.id) ?? []).map((value) =>
      occurrenceView(value, expense, paymentsByValue.get(value.id) ?? []),
    );
    const storedOccurrence = history.find((value) => value.taxYear === taxYear);
    const occurrence =
      storedOccurrence ??
      occurrenceView(
        {
          id: null,
          taxYear,
          budgetId: expense.budgetId,
          amountMinor: expense.amountMinor,
          amountOverrideMinor: null,
          dueMonthOverride: null,
          dueDayOverride: null,
          note: null,
          fundedMinor: 0,
        },
        expense,
        [],
      );
    return {
      id: expense.id,
      budgetId: expense.budgetId,
      name: expense.name,
      amountMinor: expense.amountMinor,
      dueMonth: expense.dueMonth,
      dueDay: expense.dueDay,
      isActive: expense.isActive,
      createdAt: expense.createdAt,
      updatedAt: expense.updatedAt,
      occurrence,
      history,
    };
  });

  return {
    taxYear,
    budgets: budgetRows.map((budget) => {
      const budgetItems = items
        .filter((item) => item.occurrence.budgetId === budget.id)
        .sort(
          (left, right) =>
            (left.occurrence.dueDate ?? "9999-12-31").localeCompare(right.occurrence.dueDate ?? "9999-12-31") ||
            left.name.localeCompare(right.name) ||
            left.id.localeCompare(right.id),
        );
      const activeItems = budgetItems.filter((item) => item.isActive);
      return {
        ...budget,
        itemCount: activeItems.length,
        totalPlannedMinor: activeItems.reduce((sum, item) => sum + item.occurrence.plannedAmountMinor, 0),
        totalPaidMinor: activeItems.reduce((sum, item) => sum + item.occurrence.paidMinor, 0),
        totalRemainingMinor: activeItems.reduce((sum, item) => sum + item.occurrence.remainingMinor, 0),
        items: budgetItems,
      };
    }),
  };
}

function parseSelectedYear(input: string | undefined | null, availableYears: readonly number[], currentYear: number): number {
  if (input == null) return currentYear;
  const parsed = Number(input);
  return Number.isInteger(parsed) && availableYears.includes(parsed) ? parsed : currentYear;
}

/**
 * Owner-scoped read model for the annual-expenses page.
 *
 * Loads all owner budget, expense, value and payment rows in a single batched
 * pass, then derives every requested yearly summary in memory. This eliminates
 * the previous N+1 `getSummary(ownerId, year)` calls while preserving the
 * exact `AnnualBudgetSummary` contract, timeline ordering, integer minor units,
 * Actual vs planned rows, and owner predicates.
 *
 * The function operates on the already owner-scoped `Database` transaction and
 * does not open a transaction, span separate transactions, or mutate data.
 */
export async function getAnnualExpensesReadModel(
  db: Database,
  ownerId: string,
  selectedYear?: string | null,
  todayIso = toTorontoDateIso(),
): Promise<AnnualExpensesReadModel> {
  assertOwnerId(ownerId);

  const currentYear = Number(todayIso.slice(0, 4));

  const [budgetRows, expenseRows, valueRows, eligibleAccounts, timeline] = await Promise.all([
    db
      .select({
        id: annualBudgets.id,
        name: annualBudgets.name,
        linkedAccountId: annualBudgets.linkedAccountId,
        linkedAccountName: accounts.name,
        isActive: annualBudgets.isActive,
        displayOrder: annualBudgets.displayOrder,
      })
      .from(annualBudgets)
      .innerJoin(accounts, and(eq(accounts.id, annualBudgets.linkedAccountId), eq(accounts.ownerId, ownerId)))
      .where(eq(annualBudgets.ownerId, ownerId))
      .orderBy(asc(annualBudgets.displayOrder), asc(annualBudgets.id)) as unknown as Promise<BudgetRow[]>,
    db
      .select({
        id: annualExpenses.id,
        budgetId: annualExpenses.budgetId,
        name: annualExpenses.name,
        amountMinor: annualExpenses.amountMinor,
        dueMonth: annualExpenses.dueMonth,
        dueDay: annualExpenses.dueDay,
        isActive: annualExpenses.isActive,
        createdAt: annualExpenses.createdAt,
        updatedAt: annualExpenses.updatedAt,
      })
      .from(annualExpenses)
      .innerJoin(annualBudgets, and(eq(annualBudgets.id, annualExpenses.budgetId), eq(annualBudgets.ownerId, ownerId)))
      .where(eq(annualExpenses.ownerId, ownerId))
      .orderBy(asc(annualExpenses.name), asc(annualExpenses.id)) as unknown as Promise<ExpenseRow[]>,
    db
      .select({
        id: annualExpenseValues.id,
        annualExpenseId: annualExpenseValues.annualExpenseId,
        budgetId: annualExpenseValues.budgetId,
        taxYear: annualExpenseValues.taxYear,
        amountMinor: annualExpenseValues.amountMinor,
        amountOverrideMinor: annualExpenseValues.amountOverrideMinor,
        dueMonthOverride: annualExpenseValues.dueMonthOverride,
        dueDayOverride: annualExpenseValues.dueDayOverride,
        note: annualExpenseValues.note,
        fundedMinor: annualExpenseValues.fundedMinor,
      })
      .from(annualExpenseValues)
      .where(eq(annualExpenseValues.ownerId, ownerId))
      .orderBy(asc(annualExpenseValues.taxYear), asc(annualExpenseValues.id)) as unknown as Promise<ValueRow[]>,
    createAnnualBudgetRepository(db).listEligibleFundingAccounts(ownerId),
    createAccountTimelineRepository(db).getTimeline(ownerId, { includeArchived: true }),
  ]);

  const valueIds = valueRows.map((row) => row.id);
  const paymentRows =
    valueIds.length === 0
      ? []
      : await db
          .select({
            id: annualExpensePayments.id,
            annualExpenseValueId: annualExpensePayments.annualExpenseValueId,
            paymentOn: annualExpensePayments.paymentOn,
            amountMinor: annualExpensePayments.amountMinor,
            note: annualExpensePayments.note,
            createdAt: annualExpensePayments.createdAt,
            updatedAt: annualExpensePayments.updatedAt,
          })
          .from(annualExpensePayments)
          .where(and(eq(annualExpensePayments.ownerId, ownerId), inArray(annualExpensePayments.annualExpenseValueId, valueIds)))
          .orderBy(asc(annualExpensePayments.paymentOn), asc(annualExpensePayments.id));

  const paymentsByValue = new Map<string, AnnualBudgetPaymentView[]>();
  for (const row of paymentRows) {
    const values = paymentsByValue.get(row.annualExpenseValueId) ?? [];
    values.push(row);
    paymentsByValue.set(row.annualExpenseValueId, values);
  }

  const valuesByExpense = new Map<string, ValueRow[]>();
  for (const row of valueRows) {
    const values = valuesByExpense.get(row.annualExpenseId) ?? [];
    values.push(row);
    valuesByExpense.set(row.annualExpenseId, values);
  }

  const availableYears = new Set<number>([currentYear - 1, currentYear, currentYear + 1]);
  for (const row of valueRows) availableYears.add(row.taxYear);
  const years = [...availableYears].sort((left, right) => left - right);

  const taxYear = parseSelectedYear(selectedYear, years, currentYear);

  const initialSummary = buildAnnualBudgetSummary(currentYear, budgetRows, expenseRows, valuesByExpense, paymentsByValue);
  const selectedSummary =
    taxYear === currentYear
      ? initialSummary
      : buildAnnualBudgetSummary(taxYear, budgetRows, expenseRows, valuesByExpense, paymentsByValue);

  const projectionSummaries: AnnualBudgetSummary[] = [];
  if (taxYear >= currentYear) {
    for (let year = currentYear; year <= taxYear; year++) {
      if (year === currentYear) {
        projectionSummaries.push(initialSummary);
      } else if (year === taxYear) {
        projectionSummaries.push(selectedSummary);
      } else {
        projectionSummaries.push(buildAnnualBudgetSummary(year, budgetRows, expenseRows, valuesByExpense, paymentsByValue));
      }
    }
  } else {
    projectionSummaries.push(selectedSummary);
  }

  return {
    initialSummary,
    eligibleAccounts,
    years,
    taxYear,
    summary: selectedSummary,
    projectionSummaries,
    timeline,
  };
}
