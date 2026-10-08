import { describe, expect, it } from "vitest";
import { buildAnnualExpensesHelpSnapshot } from "./presentation";

const budget = {
  isActive: true,
  items: [{
    isActive: true,
    occurrence: { status: "Paid" as const },
  }],
};

describe("Annual expenses page help presentation", () => {
  it("points a workspace without an account or budget to Accounts", () => {
    expect(buildAnnualExpensesHelpSnapshot({ taxYear: 2026, budgets: [], forecastCount: 0, eligibleAccountCount: 0 }).action).toEqual({ label: "Add funding account", href: "/accounts" });
  });

  it("follows the budget, expense, payment, and forecast setup path", () => {
    expect(buildAnnualExpensesHelpSnapshot({ taxYear: 2026, budgets: [], forecastCount: 0, eligibleAccountCount: 1 }).action).toEqual({ label: "Create annual budget", href: "/annual-expenses#annual-expenses-first-budget-heading" });
    expect(buildAnnualExpensesHelpSnapshot({ taxYear: 2026, budgets: [{ isActive: false, items: [] }], forecastCount: 0, eligibleAccountCount: 1 }).action).toEqual({ label: "Create annual budget", href: "/annual-expenses#annual-budget-management-title" });
    expect(buildAnnualExpensesHelpSnapshot({ taxYear: 2026, budgets: [{ isActive: true, items: [] }], forecastCount: 0, eligibleAccountCount: 0 }).action).toEqual({ label: "Add annual expense", href: "/annual-expenses#annual-template-panel" });
    expect(buildAnnualExpensesHelpSnapshot({ taxYear: 2026, budgets: [{ isActive: true, items: [{ isActive: true, occurrence: { status: "Partially paid" as const } }] }], forecastCount: 1, eligibleAccountCount: 0 }).action).toEqual({ label: "Review annual payments", href: "/annual-expenses" });
    expect(buildAnnualExpensesHelpSnapshot({ taxYear: 2026, budgets: [budget], forecastCount: 0, eligibleAccountCount: 0 }).action).toEqual({ label: "Review funding forecast", href: "/annual-expenses" });
  });

  it("reports planning counts without exposing amounts", () => {
    expect(buildAnnualExpensesHelpSnapshot({ taxYear: 2027, budgets: [budget, { isActive: false, items: [{ isActive: true, occurrence: { status: "Unpaid" as const } }] }], forecastCount: 1, eligibleAccountCount: 2 })).toEqual({
      items: [
        { label: "Planning year", value: "2027" },
        { label: "Active budgets", value: "1" },
        { label: "Archived budgets", value: "1" },
        { label: "Active yearly expenses", value: "1" },
        { label: "Expenses needing payment", value: "0" },
        { label: "Funding forecasts", value: "1/1" },
        { label: "Available funding accounts", value: "2" },
      ],
      action: { label: "Review annual plan", href: "/annual-expenses" },
    });
  });
});
