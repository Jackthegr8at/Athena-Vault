import { describe, expect, it } from "vitest";
import { buildHomeHelpSnapshot, buildHouseholdPresentation, shouldShowHomeFirstUse } from "./presentation";

const expense = (input: Partial<Parameters<typeof buildHouseholdPresentation>[0][number]> & Pick<Parameters<typeof buildHouseholdPresentation>[0][number], "name" | "category" | "frequency" | "amountMinor" | "annualAmountMinor">) => ({
  id: input.id ?? input.name,
  name: input.name,
  category: input.category,
  frequency: input.frequency,
  amountMinor: input.amountMinor,
  annualAmountMinor: input.annualAmountMinor,
  accountId: null,
  accountName: null,
  startsOn: null,
  endsOn: null,
  currency: "CAD" as const,
  isActive: input.isActive ?? true,
});

describe("Household presentation", () => {
  it("builds a contextual Home guide snapshot and follows the first useful action", () => {
    const base = { hasHome: true, propertyValueCount: 1, activeExpenseCount: 1, maintenanceItemCount: 0, hasActiveHouseholdCashFlowLink: true };
    expect(buildHomeHelpSnapshot({ ...base, hasHome: false }).action).toEqual({ label: "Create Home profile", href: "/home" });
    expect(buildHomeHelpSnapshot({ ...base, propertyValueCount: 0 }).action).toEqual({ label: "Add property value", href: "/home" });
    expect(buildHomeHelpSnapshot({ ...base, activeExpenseCount: 0 }).action).toEqual({ label: "Add household expense", href: "/home" });
    expect(buildHomeHelpSnapshot({ ...base, hasActiveHouseholdCashFlowLink: false }).action).toEqual({ label: "Connect household Cash Flow", href: "/home" });
    expect(buildHomeHelpSnapshot(base).action).toEqual({ label: "Review Home timeline", href: "/home" });
    expect(buildHomeHelpSnapshot(base).items).toEqual([
      { label: "Home profile", value: "Configured" },
      { label: "Property value", value: "Recorded" },
      { label: "Active household expenses", value: "1" },
      { label: "Annual-maintenance items", value: "0" },
      { label: "Cash Flow link", value: "Connected" },
    ]);
  });

  it("shows the Home first-use route only when the owner has no Home data", () => {
    expect(shouldShowHomeFirstUse({ hasHome: false, activeExpenseCount: 0, maintenanceItemCount: 0, liabilityCount: 0, hasActiveHouseholdCashFlowLink: false })).toBe(true);
    expect(shouldShowHomeFirstUse({ hasHome: true, activeExpenseCount: 0, maintenanceItemCount: 0, liabilityCount: 0, hasActiveHouseholdCashFlowLink: false })).toBe(false);
    expect(shouldShowHomeFirstUse({ hasHome: false, activeExpenseCount: 1, maintenanceItemCount: 0, liabilityCount: 0, hasActiveHouseholdCashFlowLink: false })).toBe(false);
    expect(shouldShowHomeFirstUse({ hasHome: false, activeExpenseCount: 0, maintenanceItemCount: 0, liabilityCount: 0, hasActiveHouseholdCashFlowLink: true })).toBe(false);
  });

  it("keeps ordinary expenses plus exactly one corrected Annual maintenance summary", () => {
    const result = buildHouseholdPresentation([
      expense({ name: "Rent", category: "home", frequency: "monthly", amountMinor: 10000, annualAmountMinor: 120000 }),
      expense({ name: "Property tax", category: "home", frequency: "annual", amountMinor: 500, annualAmountMinor: 500 }),
      expense({ name: "Annual maintenance", category: "annual-maintenance", frequency: "monthly", amountMinor: 8600, annualAmountMinor: 86000 }),
      expense({ name: "Neige", category: "annual-maintenance", frequency: "annual", amountMinor: 46000, annualAmountMinor: 46000 }),
    ], { id: "summary", name: "Annual maintenance", category: "annual-maintenance", frequency: "monthly", amountMinor: 7167, annualAmountMinor: 86000, currency: "CAD" });

    expect(result.displayedExpenses.map((item) => item.name)).toEqual(["Annual maintenance", "Property tax", "Rent"]);
    expect(result.displayedExpenses.filter((item) => item.category === "annual-maintenance")).toHaveLength(1);
    expect(result.displayedExpenses[0]).toMatchObject({ amountMinor: 7167, annualAmountMinor: 86000 });
    expect(result.monthlyMinor).toBe(17208);
    expect(result.annualMinor).toBe(206500);
    expect(result.biweeklyMinor).toBe(7942);
  });

  it("normalizes biweekly expenses into the monthly household cost", () => {
    const result = buildHouseholdPresentation([
      expense({ name: "Mortgage", category: "home", frequency: "biweekly", amountMinor: 64252, annualAmountMinor: 64252 * 26 }),
      expense({ name: "Internet", category: "home", frequency: "monthly", amountMinor: 10000, annualAmountMinor: 120000 }),
    ], null);

    expect(result.monthlyMinor).toBe(Math.round((64252 * 26 + 120000) / 12));
    expect(result.biweeklyMinor).toBe(64252 + Math.round(120000 / 26));
  });

  it("rounds monthly and biweekly totals half up with exact integer arithmetic", () => {
    const annual = (annualAmountMinor: number) => buildHouseholdPresentation([
      expense({ name: "Expense", category: "home", frequency: "annual", amountMinor: annualAmountMinor, annualAmountMinor }),
    ], null);

    // Positive half ties round up for both divisors.
    expect(annual(18).monthlyMinor).toBe(2); // 18 / 12 = 1.5
    expect(annual(13).biweeklyMinor).toBe(1); // 13 / 26 = 0.5

    // Negative half ties mirror positive half-up rounding away from zero.
    expect(annual(-18).monthlyMinor).toBe(-2); // -18 / 12 = -1.5
    expect(annual(-13).biweeklyMinor).toBe(-1); // -13 / 26 = -0.5

    // Negative non-ties still round to the nearest integer, not toward zero.
    expect(annual(-24).monthlyMinor).toBe(-2); // -24 / 12 = -2 exactly
    expect(annual(-39).monthlyMinor).toBe(-3); // -39 / 12 = -3.25
    expect(annual(-25).biweeklyMinor).toBe(-1); // -25 / 26 ≈ -0.96

    // Near-max-safe-integer totals stay exact.
    expect(annual(Number.MAX_SAFE_INTEGER).monthlyMinor).toBe(750599937895083);
    expect(annual(Number.MAX_SAFE_INTEGER).biweeklyMinor).toBe(346430740566961);
  });
});
