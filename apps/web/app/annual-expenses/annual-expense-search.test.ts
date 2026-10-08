import { describe, expect, it } from "vitest";
import { filterAnnualExpenseItems } from "./annual-expense-search";

const items = [
  {
    id: "rent",
    budgetId: "budget",
    name: "Apartment rent",
    amountMinor: 120000,
    dueMonth: 1,
    dueDay: 15,
    isActive: true,
    occurrence: { id: "rent-value", taxYear: 2026, budgetId: "budget", plannedAmountMinor: 120000, dueDate: "2026-01-15", amountOverrideMinor: null, note: null, paidMinor: 0, remainingMinor: 120000, varianceMinor: 0, status: "Unpaid" as const, payments: [] },
    history: [],
  },
  {
    id: "insurance",
    budgetId: "budget",
    name: "Home insurance",
    amountMinor: 90000,
    dueMonth: 4,
    dueDay: null,
    isActive: true,
    occurrence: { id: "insurance-value", taxYear: 2026, budgetId: "budget", plannedAmountMinor: 90000, dueDate: "2026-04-01", amountOverrideMinor: null, note: "Renewal", paidMinor: 90000, remainingMinor: 0, varianceMinor: 0, status: "Paid" as const, payments: [] },
    history: [],
  },
] as const;

describe("annual expense search", () => {
  it("returns every item for an empty query", () => {
    expect(filterAnnualExpenseItems(items, "  ")).toEqual(items);
  });

  it("matches item names case-insensitively without changing the source list", () => {
    expect(filterAnnualExpenseItems(items, "RENT").map((item) => item.id)).toEqual(["rent"]);
    expect(items).toHaveLength(2);
  });

  it("matches useful item metadata such as due dates, notes, and status", () => {
    expect(filterAnnualExpenseItems(items, "2026-04").map((item) => item.id)).toEqual(["insurance"]);
    expect(filterAnnualExpenseItems(items, "renewal").map((item) => item.id)).toEqual(["insurance"]);
    expect(filterAnnualExpenseItems(items, "paid").map((item) => item.id)).toEqual(["insurance"]);
    expect(filterAnnualExpenseItems(items, "unpaid").map((item) => item.id)).toEqual(["rent"]);
  });
});
