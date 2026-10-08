import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Database } from "../client";
import { toTorontoDateIso } from "../account-timeline";
import {
  annualBudgets,
  annualExpenses,
  annualExpensePayments,
  annualExpenseValues,
} from "../drizzle-schema";
import type { AnnualBudgetAccountOption } from "../annual-budgets";
import type { AccountTimelineView } from "../repositories/account-timeline";
import { getAnnualExpensesReadModel } from "./annual-expenses";

const ownerA = "00000000-0000-0000-0000-0000000000ea";

function fakeDatabase(tables: ReadonlyMap<object, unknown[]>) {
  function createBuilder() {
    let table: object | null = null;
    return {
      from(t: object) {
        table = t;
        return this;
      },
      innerJoin() {
        return this;
      },
      where() {
        return this;
      },
      orderBy() {
        return this;
      },
      then(
        onFulfilled?: ((value: unknown[]) => unknown) | null,
        onRejected?: ((reason: unknown) => unknown) | null,
      ) {
        const rows = table ? (tables.get(table) ?? []) : [];
        return Promise.resolve(rows).then(onFulfilled as never, onRejected as never);
      },
    };
  }

  return { select: () => createBuilder() } as unknown as Database;
}

const eligibleAccounts = vi.hoisted(() =>
  vi.fn(async () => [] as readonly AnnualBudgetAccountOption[]),
);
const getTimeline = vi.hoisted(() =>
  vi.fn(
    async () =>
      ({
        accounts: [],
        institutions: [],
        paydays: [],
        selectedPayday: null,
        selectedValues: {},
      }) as AccountTimelineView,
  ),
);
const createAnnualBudgetRepository = vi.hoisted(() =>
  vi.fn(() => ({ listEligibleFundingAccounts: eligibleAccounts })),
);
const createAccountTimelineRepository = vi.hoisted(() =>
  vi.fn(() => ({ getTimeline })),
);

vi.mock("../annual-budgets", () => ({ createAnnualBudgetRepository }));
vi.mock("../repositories/account-timeline", () => ({ createAccountTimelineRepository }));

describe("getAnnualExpensesReadModel (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an empty owner id", async () => {
    await expect(getAnnualExpensesReadModel({} as Database, "")).rejects.toThrow(
      "Owner ID is required.",
    );
    expect(createAnnualBudgetRepository).not.toHaveBeenCalled();
    expect(createAccountTimelineRepository).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only owner id", async () => {
    await expect(getAnnualExpensesReadModel({} as Database, "   ")).rejects.toThrow(
      "Owner ID is required.",
    );
  });

  it("loads the current-year summary by default and preserves integer minor units", async () => {
    const todayIso = toTorontoDateIso();
    const currentYear = Number(todayIso.slice(0, 4));
    const budgetId = "30000000-0000-0000-0000-0000000000e1";
    const expenseId = "40000000-0000-0000-0000-0000000000e1";
    const valueId = "50000000-0000-0000-0000-0000000000e1";

    const db = fakeDatabase(
      new Map<object, unknown[]>([
        [
          annualBudgets,
          [
            {
              id: budgetId,
              name: "Budget A",
              linkedAccountId: "20000000-0000-0000-0000-0000000000e1",
              linkedAccountName: "Linked A1",
              isActive: true,
              displayOrder: 0,
            },
          ],
        ],
        [
          annualExpenses,
          [
            {
              id: expenseId,
              budgetId,
              name: "Insurance",
              amountMinor: 10_000,
              dueMonth: 4,
              dueDay: 15,
              isActive: true,
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
              updatedAt: new Date("2026-01-01T00:00:00.000Z"),
            },
          ],
        ],
        [
          annualExpenseValues,
          [
            {
              id: valueId,
              annualExpenseId: expenseId,
              budgetId,
              taxYear: currentYear,
              amountMinor: 12_000,
              amountOverrideMinor: 11_000,
              dueMonthOverride: 3,
              dueDayOverride: 10,
              note: null,
              fundedMinor: 0,
            },
          ],
        ],
        [annualExpensePayments, []],
      ]),
    );

    const model = await getAnnualExpensesReadModel(db, ownerA);

    expect(model.taxYear).toBe(currentYear);
    expect(model.years).toContain(currentYear);
    expect(model.years).toEqual(model.years.slice().sort((a, b) => a - b));
    expect(model.initialSummary).toBe(model.summary);

    expect(model.summary.budgets).toHaveLength(1);
    const budget = model.summary.budgets[0]!;
    expect(budget).toMatchObject({
      id: budgetId,
      name: "Budget A",
      itemCount: 1,
      totalPlannedMinor: 11_000,
      totalPaidMinor: 0,
      totalRemainingMinor: 11_000,
    });

    expect(Number.isSafeInteger(budget.totalPlannedMinor)).toBe(true);
    expect(Number.isSafeInteger(budget.totalPaidMinor)).toBe(true);
    expect(Number.isSafeInteger(budget.totalRemainingMinor)).toBe(true);

    const occurrence = budget.items[0]!.occurrence;
    expect(occurrence).toMatchObject({
      taxYear: currentYear,
      plannedAmountMinor: 11_000,
      templateAmountMinor: 10_000,
      paidMinor: 0,
      remainingMinor: 11_000,
      dueDate: `${currentYear}-03-10`,
    });
    expect(Number.isSafeInteger(occurrence.plannedAmountMinor)).toBe(true);
    expect(Number.isSafeInteger(occurrence.paidMinor)).toBe(true);
    expect(Number.isSafeInteger(occurrence.remainingMinor)).toBe(true);

    expect(createAnnualBudgetRepository).toHaveBeenCalledWith(db);
    expect(eligibleAccounts).toHaveBeenCalledWith(ownerA);
    expect(createAccountTimelineRepository).toHaveBeenCalledWith(db);
    expect(getTimeline).toHaveBeenCalledWith(ownerA, { includeArchived: true });
  });

  it("selects a future year and returns ordered projection summaries", async () => {
    const todayIso = toTorontoDateIso();
    const currentYear = Number(todayIso.slice(0, 4));
    const futureYear = currentYear + 3;
    const budgetId = "30000000-0000-0000-0000-0000000000e2";
    const expenseId = "40000000-0000-0000-0000-0000000000e2";

    const db = fakeDatabase(
      new Map<object, unknown[]>([
        [
          annualBudgets,
          [
            {
              id: budgetId,
              name: "Budget A",
              linkedAccountId: "account-a",
              linkedAccountName: "A",
              isActive: true,
              displayOrder: 0,
            },
          ],
        ],
        [
          annualExpenses,
          [
            {
              id: expenseId,
              budgetId,
              name: "Insurance",
              amountMinor: 10_000,
              dueMonth: 4,
              dueDay: 15,
              isActive: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
        ],
        [
          annualExpenseValues,
          [
            {
              id: "50000000-0000-0000-0000-0000000000e2",
              annualExpenseId: expenseId,
              budgetId,
              taxYear: currentYear,
              amountMinor: 12_000,
              amountOverrideMinor: null,
              dueMonthOverride: null,
              dueDayOverride: null,
              note: null,
              fundedMinor: 0,
            },
            {
              id: "50000000-0000-0000-0000-0000000000e3",
              annualExpenseId: expenseId,
              budgetId,
              taxYear: futureYear,
              amountMinor: 15_000,
              amountOverrideMinor: null,
              dueMonthOverride: null,
              dueDayOverride: null,
              note: null,
              fundedMinor: 0,
            },
          ],
        ],
        [annualExpensePayments, []],
      ]),
    );

    const model = await getAnnualExpensesReadModel(db, ownerA, String(futureYear));

    expect(model.taxYear).toBe(futureYear);
    expect(model.years).toContain(futureYear);
    expect(model.projectionSummaries).toHaveLength(futureYear - currentYear + 1);
    expect(model.projectionSummaries[0]?.taxYear).toBe(currentYear);
    expect(model.projectionSummaries.at(-1)?.taxYear).toBe(futureYear);
    expect(
      model.projectionSummaries.every((summary) => summary.budgets.length === 1),
    ).toBe(true);
    expect(model.initialSummary.taxYear).toBe(currentYear);
    expect(model.summary.taxYear).toBe(futureYear);
  });

  it("selects a historical year and returns a single projection summary", async () => {
    const todayIso = toTorontoDateIso();
    const currentYear = Number(todayIso.slice(0, 4));
    const historicalYear = currentYear - 1;
    const budgetId = "30000000-0000-0000-0000-0000000000e3";
    const expenseId = "40000000-0000-0000-0000-0000000000e3";

    const db = fakeDatabase(
      new Map<object, unknown[]>([
        [
          annualBudgets,
          [
            {
              id: budgetId,
              name: "Budget A",
              linkedAccountId: "account-a",
              linkedAccountName: "A",
              isActive: true,
              displayOrder: 0,
            },
          ],
        ],
        [
          annualExpenses,
          [
            {
              id: expenseId,
              budgetId,
              name: "Insurance",
              amountMinor: 10_000,
              dueMonth: 4,
              dueDay: 15,
              isActive: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
        ],
        [
          annualExpenseValues,
          [
            {
              id: "50000000-0000-0000-0000-0000000000e4",
              annualExpenseId: expenseId,
              budgetId,
              taxYear: historicalYear,
              amountMinor: 9_000,
              amountOverrideMinor: null,
              dueMonthOverride: null,
              dueDayOverride: null,
              note: null,
              fundedMinor: 0,
            },
          ],
        ],
        [annualExpensePayments, []],
      ]),
    );

    const model = await getAnnualExpensesReadModel(db, ownerA, String(historicalYear));

    expect(model.taxYear).toBe(historicalYear);
    expect(model.projectionSummaries).toHaveLength(1);
    expect(model.projectionSummaries[0]?.taxYear).toBe(historicalYear);
    expect(model.initialSummary.taxYear).toBe(currentYear);
  });

  it("falls back to the current year for an unavailable selected year", async () => {
    const todayIso = toTorontoDateIso();
    const currentYear = Number(todayIso.slice(0, 4));
    const budgetId = "30000000-0000-0000-0000-0000000000e4";
    const expenseId = "40000000-0000-0000-0000-0000000000e4";

    const db = fakeDatabase(
      new Map<object, unknown[]>([
        [
          annualBudgets,
          [
            {
              id: budgetId,
              name: "Budget A",
              linkedAccountId: "account-a",
              linkedAccountName: "A",
              isActive: true,
              displayOrder: 0,
            },
          ],
        ],
        [
          annualExpenses,
          [
            {
              id: expenseId,
              budgetId,
              name: "Insurance",
              amountMinor: 10_000,
              dueMonth: 4,
              dueDay: 15,
              isActive: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
        ],
        [
          annualExpenseValues,
          [
            {
              id: "50000000-0000-0000-0000-0000000000e5",
              annualExpenseId: expenseId,
              budgetId,
              taxYear: currentYear,
              amountMinor: 12_000,
              amountOverrideMinor: null,
              dueMonthOverride: null,
              dueDayOverride: null,
              note: null,
              fundedMinor: 0,
            },
          ],
        ],
        [annualExpensePayments, []],
      ]),
    );

    const model = await getAnnualExpensesReadModel(db, ownerA, "1999");
    expect(model.taxYear).toBe(currentYear);
  });
});
