// @vitest-environment jsdom

import React from "react";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { changeInput, click, createDomTestRoot } from "../../test/dom";

const actions = vi.hoisted(() => {
  const idle = { ok: false, message: "", fieldErrors: {} };
  return {
    createGoalAction: vi.fn(async () => idle),
    updateGoalAction: vi.fn(async () => idle),
    updateGoalProgressAction: vi.fn(async () => idle),
    setGoalStatusAction: vi.fn(async () => idle),
    deleteGoalAction: vi.fn(async () => idle),
    restoreGoalAction: vi.fn(async () => idle),
    saveGoalPlanAction: vi.fn(async () => idle),
    disableGoalPlanAction: vi.fn(async () => idle),
    goalPlanPreviewsAction: vi.fn(),
  };
});
vi.mock("./actions", () => actions);
import { computePreviewForStart } from "./goal-plan-utils";
import { GoalsManager } from "./goals-manager";
import type { FinancialGoalPlanView, FinancialGoalView } from "@athena/database";

const goal: FinancialGoalView = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Emergency reserve",
  targetMinor: 625000,
  currentMinor: 0,
  targetDate: "2026-11-19",
  priority: 1,
  status: "active",
  currency: "CAD",
};
const previews = {
  [goal.id]: [
    { frequency: "biweekly" as const, occurrenceDates: ["2026-09-17", "2026-10-01", "2026-10-15", "2026-10-29", "2026-11-12"], occurrences: 5, remainingMinor: 625000, requiredAmountMinor: 125000, defaultStartsOn: "2026-09-17" },
  ],
};
const props = {
  goals: [goal],
  plans: [],
  destinationAccounts: [{ id: "33333333-3333-4333-8333-333333333333", name: "Savings", institution: "Bank", kind: "savings", currency: "CAD" }],
  sourceAccounts: [{ id: "44444444-4444-4444-8444-444444444444", name: "Checking", institution: "Bank", kind: "checking", currency: "CAD", isVisibleInCashFlow: true }],
  previews,
  todayIso: "2026-09-11",
  readOnly: false,
} as const;
const configuredPlan: FinancialGoalPlanView = {
  id: "77777777-7777-4777-8777-777777777777",
  goalId: goal.id,
  contributionRuleId: null,
  cashFlowSeriesId: null,
  accountId: "33333333-3333-4333-8333-333333333333",
  sourceAccountId: "44444444-4444-4444-8444-444444444444",
  enabled: true,
  ruleEnabled: true,
  amountMinor: 125000,
  frequency: "biweekly",
  startsOn: "2026-09-17",
  endsOn: goal.targetDate,
  countsAsExpense: false,
  sourceRequired: true,
  goalName: goal.name,
  targetMinor: goal.targetMinor,
  targetDate: goal.targetDate,
  priority: goal.priority,
  goalStatus: goal.status,
  currency: goal.currency,
  accountName: "Savings",
  accountKind: "savings",
  institutionName: "Bank",
  sourceAccountName: "Checking",
  sourceAccountKind: "checking",
  sourceInstitutionName: "Bank",
  sourceIsVisibleInCashFlow: true,
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
};
const alternateDestinationAccount = { id: "66666666-6666-4666-8666-666666666666", name: "Vault", institution: "Bank", kind: "savings", currency: "CAD" } as const;
const dom = createDomTestRoot();
describe("goal plan editor", () => {
  it("initializes a new plan amount from the default biweekly preview", async () => {
    await dom.render(React.createElement(GoalsManager, props));
    await click(dom.get<HTMLButtonElement>(".goals-plan-toggle"));

    expect(dom.get<HTMLInputElement>('input[name="startsOn"]').value).toBe("2026-09-17");
    expect(dom.get<HTMLInputElement>('input[name="amount"]').value).toBe("1250.00");
    const overridePreview = computePreviewForStart({
      targetMinor: goal.targetMinor,
      currentMinor: goal.currentMinor,
      targetDate: goal.targetDate!,
      todayIso: props.todayIso,
      startsOn: "2026-10-01",
      frequency: "biweekly",
    });
    expect(overridePreview.requiredAmountMinor).toBe(156250);
  });

  it("uses the frequency preview cards as the form selector", async () => {
    await dom.render(React.createElement(GoalsManager, props));
    await click(dom.get<HTMLButtonElement>(".goals-plan-toggle"));

    const cards = dom.container.querySelectorAll<HTMLButtonElement>(".goals-plan-required-card");
    expect(cards).toHaveLength(3);
    expect(dom.get<HTMLDivElement>(".goals-plan-required-grid").getAttribute("aria-label")).toBe("Choose a contribution frequency");
    expect(dom.get<HTMLInputElement>('input[name="frequency"]').value).toBe("biweekly");
    expect(dom.get<HTMLButtonElement>(".goals-plan-required-card.is-selected").textContent).toContain("Biweekly");

    await click(cards[0]!);

    expect(dom.get<HTMLInputElement>('input[name="frequency"]').value).toBe("weekly");
    expect(dom.get<HTMLButtonElement>(".goals-plan-required-card.is-selected").textContent).toContain("Weekly");
    expect(dom.get<HTMLButtonElement>(".goals-plan-required-card.is-selected").getAttribute("aria-pressed")).toBe("true");
  });
  it("preserves edited plan fields when identical plan values rerender", async () => {
    const configuredProps = {
      ...props,
      destinationAccounts: [...props.destinationAccounts, alternateDestinationAccount],
      plans: [configuredPlan],
    } as const;
    await dom.render(React.createElement(GoalsManager, configuredProps));
    const toggle = dom.get<HTMLButtonElement>(".goals-plan-toggle");
    await click(toggle);
    await click(dom.get<HTMLButtonElement>(".goals-plan-toggle"));

    const destination = dom.get<HTMLButtonElement>(`[role="combobox"][aria-labelledby^="goal-destination-account-label-${goal.id}"]`);
    const amount = dom.get<HTMLInputElement>('input[name="amount"]');
    await click(destination);
    const alternateOption = [...document.body.querySelectorAll<HTMLButtonElement>("[role='option']")].find((option) => option.textContent?.includes("Vault"));
    if (!alternateOption) throw new Error("Missing alternate destination option");
    await click(alternateOption);
    await changeInput(amount, "275.50");
    expect(dom.get<HTMLInputElement>('input[name="accountId"]').value).toBe(alternateDestinationAccount.id);
    expect(amount.value).toBe("275.50");

    await dom.render(React.createElement(GoalsManager, { ...configuredProps, plans: [{ ...configuredPlan }] }));

    expect(dom.get<HTMLInputElement>('input[name="accountId"]').value).toBe(alternateDestinationAccount.id);
    expect(dom.get<HTMLInputElement>('input[name="amount"]').value).toBe("275.50");
  });

  it("derives untouched suggested amount and date from refreshed previews", async () => {
    await dom.render(React.createElement(GoalsManager, props));
    await click(dom.get<HTMLButtonElement>(".goals-plan-toggle"));
    expect(dom.get<HTMLInputElement>('input[name="amount"]').value).toBe("1250.00");
    expect(dom.get<HTMLInputElement>('input[name="startsOn"]').value).toBe("2026-09-17");

    const updatedPreviews = {
      [goal.id]: [{ ...previews[goal.id]![0]!, requiredAmountMinor: 156250, defaultStartsOn: "2026-10-01" }],
    };
    await dom.render(React.createElement(GoalsManager, { ...props, previews: updatedPreviews }));
    expect(dom.get<HTMLInputElement>('input[name="amount"]').value).toBe("1562.50");
    expect(dom.get<HTMLInputElement>('input[name="startsOn"]').value).toBe("2026-10-01");
  });

  it("refreshes an open plan editor when persisted plan values change", async () => {
    const configuredProps = { ...props, plans: [configuredPlan] } as const;
    await dom.render(React.createElement(GoalsManager, configuredProps));
    await changeInput(dom.get<HTMLInputElement>('input[name="amount"]'), "275.50");

    await dom.render(React.createElement(GoalsManager, {
      ...configuredProps,
      plans: [{ ...configuredPlan, amountMinor: 180000, startsOn: "2026-10-01" }],
    }));

    expect(dom.get<HTMLInputElement>('input[name="amount"]').value).toBe("1800.00");
    expect(dom.get<HTMLInputElement>('input[name="startsOn"]').value).toBe("2026-10-01");
  });

  it("closes the goal editor and promotes a successful save result", async () => {
    actions.updateGoalAction.mockResolvedValue({ ok: true, message: "Goal saved.", fieldErrors: {} });
    await dom.render(React.createElement(GoalsManager, props));
    const editButton = [...dom.container.querySelectorAll<HTMLButtonElement>(".goals-card-actions button")].find((button) => button.textContent?.includes("Edit"));
    if (!editButton) throw new Error("Missing goal edit action");
    await click(editButton);
    const form = dom.get<HTMLFormElement>(".goals-edit-form");
    await act(async () => {
      form.requestSubmit();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(actions.updateGoalAction).toHaveBeenCalledOnce();
    expect(dom.container.querySelector(".goals-edit-form")).toBeNull();
    expect(dom.container.textContent).toContain("Goal saved.");
  });

  it("promotes an other goal, shows pending preview state, and applies the fetched preview", async () => {
    actions.goalPlanPreviewsAction.mockClear();
    const otherGoal: FinancialGoalView = { ...goal, id: "55555555-5555-4555-8555-555555555555", name: "Travel fund", currentMinor: 20000, targetMinor: 100000, targetDate: "2027-03-19" };
    const otherPlan: FinancialGoalPlanView = { ...configuredPlan, goalId: otherGoal.id, goalName: otherGoal.name, targetMinor: otherGoal.targetMinor, targetDate: otherGoal.targetDate };
    type PreviewResult = { readonly ok: true; readonly previews: readonly { readonly frequency: "biweekly"; readonly occurrenceDates: readonly string[]; readonly occurrences: number; readonly remainingMinor: number; readonly requiredAmountMinor: number; readonly defaultStartsOn: string }[] };
    let resolvePreview!: (result: PreviewResult) => void;
    const previewPromise = new Promise<PreviewResult>((resolve) => { resolvePreview = resolve; });
    actions.goalPlanPreviewsAction.mockImplementationOnce(() => previewPromise);
    await dom.render(React.createElement(GoalsManager, { ...props, goals: [goal, otherGoal], plans: [otherPlan], previews }));

    await click(dom.get<HTMLButtonElement>(".goals-other-row"));
    expect(dom.container.textContent).toContain("Calculating the plan preview…");
    expect(actions.goalPlanPreviewsAction).toHaveBeenCalledWith(otherGoal.id);

    await act(async () => {
      resolvePreview({
        ok: true,
        previews: [{ frequency: "biweekly", occurrenceDates: ["2026-09-17"], occurrences: 1, remainingMinor: 80000, requiredAmountMinor: 80000, defaultStartsOn: "2026-09-17" }],
      });
      await Promise.resolve();
    });
    expect(dom.get<HTMLButtonElement>(".goals-plan-required-card.is-selected").textContent).toContain("$800.00");
    expect(dom.get<HTMLHeadingElement>(".goals-card-title").textContent).toBe("Travel fund");
    expect(dom.get<HTMLButtonElement>(".goals-other-row").textContent).toContain("Emergency reserve");
    expect(dom.container.querySelector(".goals-other-detail")).toBeNull();
  });

  it("reports a failed on-demand preview fetch without retrying in a loop", async () => {
    actions.goalPlanPreviewsAction.mockClear();
    const otherGoal: FinancialGoalView = { ...goal, id: "55555555-5555-4555-8555-555555555555", name: "Travel fund", currentMinor: 20000, targetMinor: 100000, targetDate: "2027-03-19" };
    actions.goalPlanPreviewsAction.mockResolvedValueOnce({ ok: false as const, message: "That goal was not found." });
    await dom.render(React.createElement(GoalsManager, { ...props, goals: [goal, otherGoal], previews }));
    await click(dom.get<HTMLButtonElement>(".goals-other-row"));

    expect(actions.goalPlanPreviewsAction).toHaveBeenCalledOnce();
    expect(dom.container.textContent).toContain("That goal was not found.");
  });

  it("opens goal deletion in the shared confirmation dialog", async () => {
    await dom.render(React.createElement(GoalsManager, props));

    const deleteButton = Array.from(dom.container.querySelectorAll<HTMLButtonElement>(".goals-card-actions > button")).find((button) => button.textContent?.includes("Delete"));
    if (!deleteButton) throw new Error("Missing delete button");
    await click(deleteButton);

    const dialog = document.body.querySelector<HTMLDialogElement>(".confirmation-dialog");
    expect(dialog?.textContent).toContain("Permanently delete Emergency reserve?");
    expect(dialog?.textContent).toContain("its plans, and all funding history");
    expect(dom.container.querySelector(".goals-confirm")).toBeNull();

    await click(document.body.querySelector<HTMLButtonElement>(".confirmation-dialog__cancel")!);
    expect(document.body.querySelector(".confirmation-dialog")).toBeNull();
  });

  it("closes the delete dialog and reports success from the delete action", async () => {
    actions.deleteGoalAction.mockResolvedValue({ ok: true, message: "Goal deleted.", fieldErrors: {} });
    await dom.render(React.createElement(GoalsManager, props));

    const deleteButton = Array.from(dom.container.querySelectorAll<HTMLButtonElement>(".goals-card-actions > button")).find((button) => button.textContent?.includes("Delete"));
    if (!deleteButton) throw new Error("Missing delete button");
    await click(deleteButton);
    await click(document.body.querySelector<HTMLButtonElement>(".confirmation-dialog__confirm")!);

    expect(actions.deleteGoalAction).toHaveBeenCalledOnce();
    expect(document.body.querySelector(".confirmation-dialog")).toBeNull();
    expect(dom.container.textContent).toContain("Goal deleted.");
  });

  it("reports a successful restore at the action boundary", async () => {
    actions.restoreGoalAction.mockResolvedValue({ ok: true, message: "Goal restored.", fieldErrors: {} });
    const archivedGoal: FinancialGoalView = { ...goal, id: "55555555-5555-4555-8555-555555555555", name: "Travel fund", status: "archived" };
    await dom.render(React.createElement(GoalsManager, { ...props, goals: [goal, archivedGoal] }));
    await click(dom.get<HTMLButtonElement>(".goals-archived-toggle"));
    await click(dom.get<HTMLButtonElement>(".goals-grid--archived .goals-inline-action button"));

    expect(actions.restoreGoalAction).toHaveBeenCalledOnce();
    expect(dom.container.textContent).toContain("Goal restored.");
  });
});
