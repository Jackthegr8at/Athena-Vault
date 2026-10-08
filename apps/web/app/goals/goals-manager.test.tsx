// @vitest-environment jsdom

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { click, createDomTestRoot } from "../../test/dom";

vi.mock("./actions", () => ({
  createGoalAction: vi.fn(),
  updateGoalAction: vi.fn(),
  updateGoalProgressAction: vi.fn(),
  setGoalStatusAction: vi.fn(),
  deleteGoalAction: vi.fn(),
  restoreGoalAction: vi.fn(),
  saveGoalPlanAction: vi.fn(),
  disableGoalPlanAction: vi.fn(),
  goalPlanPreviewsAction: vi.fn(),
}));
import { GoalsManager } from "./goals-manager";
import type { FinancialGoalView } from "@athena/database";

const activeGoal: FinancialGoalView = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Emergency reserve",
  targetMinor: 1500000,
  currentMinor: 875000,
  targetDate: "2027-12-31",
  priority: 1,
  status: "active",
  currency: "CAD",
};
const archivedGoal: FinancialGoalView = { ...activeGoal, id: "22222222-2222-4222-8222-222222222222", name: "Old laptop fund", status: "archived" };
const previews = {
  [activeGoal.id]: [
    { frequency: "weekly" as const, occurrenceDates: ["2027-01-01", "2027-01-08"], occurrences: 2, remainingMinor: 625000, requiredAmountMinor: 312500, defaultStartsOn: "2027-01-01" },
    { frequency: "biweekly" as const, occurrenceDates: ["2027-01-01"], occurrences: 1, remainingMinor: 625000, requiredAmountMinor: 625000, defaultStartsOn: "2027-01-01" },
    { frequency: "monthly" as const, occurrenceDates: ["2027-01-01"], occurrences: 1, remainingMinor: 625000, requiredAmountMinor: 625000, defaultStartsOn: "2027-01-01" },
  ],
};

describe("goals workspace", () => {
  const props = {
    goals: [activeGoal],
    plans: [],
    destinationAccounts: [{ id: "33333333-3333-4333-8333-333333333333", name: "Savings", institution: "Bank", kind: "savings", currency: "CAD" }],
    sourceAccounts: [{ id: "44444444-4444-4444-8444-444444444444", name: "Checking", institution: "Bank", kind: "checking", currency: "CAD", isVisibleInCashFlow: true }],
    previews,
    todayIso: "2026-01-01",
    readOnly: false,
  } as const;

  const dom = createDomTestRoot();

  it("renders goal cards and the collapsed saving plan control", () => {
    const markup = renderToStaticMarkup(React.createElement(GoalsManager, props));
    expect(markup).toContain("Emergency reserve");
    expect(markup).toContain("Update funded amount");
    expect(markup).toContain("Plan savings");
    expect(markup).toContain("Set a recurring contribution to reach this goal");
    expect(markup).toContain("Mark achieved");
    expect(markup).toContain("Goals overview");
    expect(markup).toContain("Total goals");
    expect(markup).toContain("Total funded");
    expect(markup).toContain("Overall progress");
  });

  it("keeps additional active goals in the other goals list beside the overview", () => {
    const secondGoal: FinancialGoalView = { ...activeGoal, id: "33333333-3333-4333-8333-333333333333", name: "House down payment", currentMinor: 250000, targetMinor: 500000, targetDate: "2028-12-31" };
    const markup = renderToStaticMarkup(React.createElement(GoalsManager, {
      ...props,
      goals: [activeGoal, secondGoal],
      previews: { ...previews, [secondGoal.id]: [] },
    }));
    expect(markup).toContain("All goals");
    expect(markup).toContain('aria-label="Filter goals"');
    expect(markup).toContain("House down payment");
  });

  it("hides archived goals behind a collapsed section", () => {
    const markup = renderToStaticMarkup(React.createElement(GoalsManager, { ...props, goals: [activeGoal, archivedGoal], previews }));
    expect(markup).toContain("Archived goals (1)");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain("Old laptop fund");
  });

  it("renders read-only demo mode without mutation controls", () => {
    const markup = renderToStaticMarkup(React.createElement(GoalsManager, { ...props, readOnly: true }));
    expect(markup).toContain("Shared demo workspace");
    expect(markup).toContain("Plan savings");
    expect(markup).not.toContain("Save plan");
    expect(markup).not.toContain("Mark achieved");
    expect(markup).not.toContain("Add a goal");
  });

  it("opens the shared confirmation dialog for the achieved-goal choices", async () => {
    await dom.render(React.createElement(GoalsManager, props));
    const markAchieved = Array.from(dom.container.querySelectorAll<HTMLButtonElement>(".goals-card-actions button")).find((button) => button.textContent?.includes("Mark achieved"));
    if (!markAchieved) throw new Error("Missing Mark achieved control");

    await click(markAchieved);

    const dialog = document.body.querySelector<HTMLDialogElement>(".confirmation-dialog");
    expect(dialog?.textContent).toContain("Mark this goal achieved?");
    expect(dialog?.textContent).toContain("Mark achieved and stop contributions");
    expect(dialog?.textContent).toContain("Mark achieved only");
    expect(dialog?.getAttribute("role")).toBe("alertdialog");

    await click(document.body.querySelector<HTMLButtonElement>(".confirmation-dialog__cancel")!);
    expect(document.body.querySelector(".confirmation-dialog")).toBeNull();
  });
});
