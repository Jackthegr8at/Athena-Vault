import { describe, expect, it } from "vitest";
import { findNextAnnualExpenseRemainderTarget } from "./annual-expense-remainder";
import type { AnnualExpenseItemPresentation } from "./annual-expense-manager";

function item(overrides: Partial<AnnualExpenseItemPresentation> & Pick<AnnualExpenseItemPresentation, "id" | "name" | "dueMonth">): AnnualExpenseItemPresentation {
  const dueDate = `2026-${String(overrides.dueMonth).padStart(2, "0")}-01`;
  const amountMinor = overrides.amountMinor ?? 15_000;
  const occurrence = overrides.occurrence ?? {
    id: `${overrides.id}-2026`,
    taxYear: 2026,
    budgetId: overrides.budgetId ?? "budget",
    plannedAmountMinor: amountMinor,
    dueDate,
    amountOverrideMinor: null,
    note: null,
    paidMinor: 0,
    remainingMinor: amountMinor,
    varianceMinor: amountMinor,
    status: "Unpaid" as const,
    payments: [],
  };
  return {
    id: overrides.id,
    budgetId: overrides.budgetId ?? "budget",
    name: overrides.name,
    amountMinor,
    dueMonth: overrides.dueMonth,
    dueDay: overrides.dueDay ?? null,
    isActive: overrides.isActive ?? true,
    occurrence,
    history: overrides.history ?? [],
  };
}

describe("annual expense remainder target", () => {
  it("chooses the next later same-name occurrence in the same budget", () => {
    const source = item({ id: "august", name: "Costco", dueMonth: 8, amountMinor: 15_000, occurrence: {
      id: "august-2026", taxYear: 2026, budgetId: "budget", plannedAmountMinor: 15_000, dueDate: "2026-08-01", amountOverrideMinor: null, note: null, paidMinor: 10_000, remainingMinor: 5_000, varianceMinor: 5_000, status: "Partially paid", payments: [],
    } });
    const target = item({ id: "october", name: "Costco", dueMonth: 10, amountMinor: 15_000 });
    const earlier = item({ id: "june", name: "Costco", dueMonth: 6 });
    expect(findNextAnnualExpenseRemainderTarget(source, [earlier, source, target], 2026)).toMatchObject({ item: { id: "october" }, occurrence: { taxYear: 2026, dueDate: "2026-10-01" } });
  });

  it("does not cross budgets, archived items, or the source item", () => {
    const source = item({ id: "source", name: "Costco", dueMonth: 8 });
    expect(findNextAnnualExpenseRemainderTarget(source, [
      source,
      item({ id: "other-budget", name: "Costco", dueMonth: 9, budgetId: "other-budget" }),
      item({ id: "archived", name: "Costco", dueMonth: 10, isActive: false }),
    ], 2026)).toBeNull();
  });

  it("can surface a next-year occurrence when no later same-year item exists", () => {
    const source = item({ id: "december", name: "Costco", dueMonth: 12 });
    const target = item({ id: "january", name: "Costco", dueMonth: 1 });
    expect(findNextAnnualExpenseRemainderTarget(source, [source, target], 2026)).toMatchObject({ item: { id: "january" }, occurrence: { taxYear: 2027, dueDate: "2027-01-01", id: null } });
  });
});
