import { describe, expect, it } from "vitest";
import {
  annualExpenseDueDate,
  applyAnnualBudgetEventsToTimeline,
  deriveAnnualExpenseValues,
  moveAnnualExpenseRemainder,
  projectAnnualBudget,
} from "../src/index";

describe("annual budget projection", () => {
  it("keeps budgets independent and orders contributions, payments, and withdrawals", () => {
    const first = projectAnnualBudget({
      budgetId: "fund",
      forecastStart: "2026-01-01",
      forecastEnd: "2026-12-31",
      anchor: { asOf: "2026-01-01", balanceMinor: 10000 },
      contributions: [{ id: "deposit", occurredOn: "2026-03-01", amountMinor: 5000 }],
      occurrences: [{
        id: "tax",
        name: "Tax",
        plannedAmountMinor: 7000,
        dueDate: "2026-03-01",
        payments: [{ id: "tax-payment", paymentOn: "2026-03-01", amountMinor: 2000 }],
      }],
    });
    const second = projectAnnualBudget({
      budgetId: "home",
      forecastStart: "2026-01-01",
      forecastEnd: "2026-12-31",
      anchor: { asOf: "2026-01-01", balanceMinor: 20000 },
      contributions: [],
      occurrences: [{ id: "food", name: "Food", plannedAmountMinor: 3000, dueDate: "2026-04-01", payments: [] }],
    });

    expect(first.events.map((event) => `${event.kind}:${event.date}:${event.balanceMinor}`)).toEqual([
      "contribution:2026-03-01:15000",
      "payment:2026-03-01:13000",
      "withdrawal:2026-03-01:8000",
    ]);
    expect(first.yearEndBalanceMinor).toBe(8000);
    expect(second.yearEndBalanceMinor).toBe(17000);
    expect(first.budgetId).not.toBe(second.budgetId);
  });

  it("uses the first day for month-only dates and clamps invalid month days", () => {
    expect(annualExpenseDueDate(2026, 4)).toBe("2026-04-01");
    expect(annualExpenseDueDate(2026, 2, 31)).toBe("2026-02-28");
  });

  it("derives partial, paid, over-budget, remaining, and variance values", () => {
    expect(deriveAnnualExpenseValues(10000, [])).toMatchObject({ paidMinor: 0, remainingMinor: 10000, varianceMinor: 10000, status: "Unpaid" });
    expect(deriveAnnualExpenseValues(10000, [{ amountMinor: 2500 }, { amountMinor: 1500 }])).toMatchObject({ paidMinor: 4000, remainingMinor: 6000, varianceMinor: 6000, status: "Partially paid" });
    expect(deriveAnnualExpenseValues(10000, [{ amountMinor: 10000 }]).status).toBe("Paid");
    expect(deriveAnnualExpenseValues(10000, [{ amountMinor: 11000 }])).toMatchObject({ remainingMinor: 0, varianceMinor: -1000, status: "Over budget" });
  });

  it("moves the full remaining amount from the source into the next planned amount", () => {
    expect(moveAnnualExpenseRemainder(15_000, 10_000, 15_000)).toEqual({
      sourcePlannedAmountMinor: 10_000,
      targetPlannedAmountMinor: 20_000,
      amountMovedMinor: 5_000,
    });
  });

  it("rejects an empty or over-budget remainder transfer", () => {
    expect(() => moveAnnualExpenseRemainder(10_000, 10_000, 15_000)).toThrow("no remaining amount");
    expect(() => moveAnnualExpenseRemainder(10_000, 11_000, 15_000)).toThrow("over-budget");
  });

  it("uses all payments through the due date to reduce the scheduled withdrawal", () => {
    const result = projectAnnualBudget({
      budgetId: "fund",
      forecastStart: "2026-01-01",
      forecastEnd: "2026-12-31",
      anchor: { asOf: "2026-01-01", balanceMinor: 50000 },
      contributions: [],
      occurrences: [{
        id: "insurance",
        name: "Insurance",
        plannedAmountMinor: 12000,
        dueDate: "2026-06-01",
        payments: [
          { id: "p1", paymentOn: "2026-02-01", amountMinor: 3000 },
          { id: "p2", paymentOn: "2026-06-01", amountMinor: 2000 },
        ],
      }],
    });
    expect(result.events.filter((event) => event.kind === "withdrawal")).toEqual([
      expect.objectContaining({ amountMinor: 7000, date: "2026-06-01" }),
    ]);
    expect(result.yearEndBalanceMinor).toBe(38000);
  });

  it("does not replay payments or withdrawals on or before the latest actual anchor", () => {
    const result = projectAnnualBudget({
      budgetId: "fund",
      forecastStart: "2026-08-01",
      forecastEnd: "2026-12-31",
      anchor: { asOf: "2026-08-01", balanceMinor: 20000 },
      contributions: [{ id: "historical-deposit", occurredOn: "2026-07-20", amountMinor: 5000 }],
      occurrences: [{
        id: "historical",
        name: "Historical",
        plannedAmountMinor: 9000,
        dueDate: "2026-07-31",
        payments: [{ id: "historical-payment", paymentOn: "2026-07-15", amountMinor: 9000 }],
      }],
    });
    expect(result.events).toEqual([]);
    expect(result.yearEndBalanceMinor).toBe(20000);
  });

  it("reserves unpaid expenses that are already overdue at the actual anchor", () => {
    const result = projectAnnualBudget({
      budgetId: "fund",
      forecastStart: "2026-08-05",
      forecastEnd: "2026-12-31",
      anchor: { asOf: "2026-08-05", balanceMinor: 10000 },
      contributions: [],
      occurrences: [{ id: "dentist", name: "Dentist", plannedAmountMinor: 10000, dueDate: "2026-02-01", payments: [] }],
    });

    expect(result.events).toEqual([expect.objectContaining({ date: "2026-08-05", kind: "withdrawal", amountMinor: 10000 })]);
    expect(result.yearEndBalanceMinor).toBe(0);
  });

  it("counts a late payment once instead of double-counting the overdue expense", () => {
    const result = projectAnnualBudget({
      budgetId: "fund",
      forecastStart: "2026-08-05",
      forecastEnd: "2026-12-31",
      anchor: { asOf: "2026-08-05", balanceMinor: 10000 },
      contributions: [],
      occurrences: [{ id: "dentist", name: "Dentist", plannedAmountMinor: 10000, dueDate: "2026-02-01", payments: [{ id: "payment", paymentOn: "2026-08-07", amountMinor: 10000 }] }],
    });

    expect(result.events).toEqual([expect.objectContaining({ date: "2026-08-07", kind: "payment", amountMinor: 10000 })]);
    expect(result.yearEndBalanceMinor).toBe(0);
  });

  it("detects negative funding and its lowest balance date", () => {
    const result = projectAnnualBudget({
      budgetId: "fund",
      forecastStart: "2026-01-01",
      forecastEnd: "2026-12-31",
      anchor: { asOf: "2026-01-01", balanceMinor: 1000 },
      contributions: [],
      occurrences: [{ id: "large", name: "Large", plannedAmountMinor: 2500, dueDate: "2026-02-01", payments: [] }],
    });
    expect(result.lowestBalanceMinor).toBe(-1500);
    expect(result.lowestBalanceOn).toBe("2026-02-01");
    expect(result.hasNegativeFunding).toBe(true);
  });

  it("applies annual expense events to generated account timeline snapshots", () => {
    const result = applyAnnualBudgetEventsToTimeline(
      [
        { asOf: "2026-08-01", balanceMinor: 10000, status: "actual", isGenerated: false },
        { asOf: "2026-08-19", balanceMinor: 12000, status: "planned", isGenerated: true },
        { asOf: "2026-09-02", balanceMinor: 13000, status: "planned", isGenerated: true },
      ],
      { asOf: "2026-08-01", balanceMinor: 10000 },
      [{ date: "2026-08-20", kind: "withdrawal", amountMinor: 2500 }],
    );
    expect(result).toMatchObject([
      { asOf: "2026-08-01", balanceMinor: 10000 },
      { asOf: "2026-08-19", balanceMinor: 12000 },
      { asOf: "2026-09-02", balanceMinor: 10500 },
    ]);
  });
  it("rejects invalid snapshot dates before adjusting the timeline", () => {
    const snapshots = [
      { asOf: "2026-08-01", balanceMinor: 10000, status: "actual" as const, isGenerated: false },
    ];
    const anchor = { asOf: "2026-08-01", balanceMinor: 10000 };

    expect(applyAnnualBudgetEventsToTimeline(snapshots, anchor, [])).toEqual(snapshots);
    for (const invalid of ["2026-02-30", "2026-8-01", "0099-01-01"]) {
      expect(() => applyAnnualBudgetEventsToTimeline(
        [{ ...snapshots[0]!, asOf: invalid }],
        anchor,
        [],
      )).toThrow(new RangeError("Snapshot date must be a valid ISO date."));
    }
    expect(() => applyAnnualBudgetEventsToTimeline(
      [{ ...snapshots[0]!, asOf: "2026-08-01" }, { ...snapshots[0]!, asOf: "not-a-date" }],
      anchor,
      [],
    )).toThrow(RangeError);
  });
});
