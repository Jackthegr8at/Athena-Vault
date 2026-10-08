// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { changeInput, click, createDomTestRoot } from "../../test/dom";
import type { AnnualExpenseManagerProps } from "./annual-expense-manager";

const mocks = vi.hoisted(() => {
  const idleState = { ok: false, message: "", fieldErrors: {} };
  return {
    archiveAnnualBudgetAction: vi.fn(async () => idleState),
    archiveAnnualExpenseAction: vi.fn(async () => idleState),
    createAnnualBudgetAction: vi.fn(async () => idleState),
    createAnnualExpenseAction: vi.fn(async () => idleState),
    moveAnnualBudgetAction: vi.fn(async () => idleState),
    moveAnnualExpenseAction: vi.fn(async () => idleState),
    moveAnnualExpenseRemainderAction: vi.fn(async () => idleState),
    mutateAnnualExpensePaymentAction: vi.fn(async () => idleState),
    saveAnnualExpenseYearOverrideAction: vi.fn(async () => idleState),
    restoreAnnualBudgetAction: vi.fn(async () => idleState),
    updateAnnualBudgetAction: vi.fn(async () => idleState),
    updateAnnualExpenseAction: vi.fn(async () => idleState),
  };
});

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));

vi.mock("./actions", () => mocks);
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { AnnualExpenseManager } from "./annual-expense-manager";

const payment = { id: "payment-1", paymentOn: "2026-02-01", amountMinor: 2_000, note: "Deposit" };
const occurrence = {
  id: "occurrence-1",
  taxYear: 2026,
  budgetId: "budget-1",
  plannedAmountMinor: 5_000,
  dueDate: "2026-12-01",
  amountOverrideMinor: null,
  note: null,
  paidMinor: 2_000,
  remainingMinor: 3_000,
  varianceMinor: 0,
  status: "Partially paid" as const,
  payments: [payment],
};

const props = {
  taxYear: 2026,
  todayIso: "2026-09-22",
  availableYears: [2026],
  budgets: [{
    id: "budget-1",
    name: "Home reserve",
    linkedAccountId: "account-1",
    linkedAccountName: "Chequing",
    isActive: true,
    displayOrder: 0,
    itemCount: 1,
    totalPlannedMinor: 5_000,
    totalPaidMinor: 2_000,
    totalRemainingMinor: 3_000,
    items: [{
      id: "expense-1",
      budgetId: "budget-1",
      name: "Insurance",
      amountMinor: 5_000,
      dueMonth: 12,
      dueDay: 1,
      isActive: true,
      occurrence,
      history: [occurrence],
    }],
  }],
  forecasts: [{ budgetId: "budget-1", yearEndBalanceMinor: 0, lowestBalanceMinor: 0, lowestBalanceOn: "2026-12-31", hasNegativeFunding: false, eventCount: 1 }],
  budgetAccounts: [{ budgetId: "budget-1", actualBalanceMinor: 10_000, actualAsOf: "2026-09-16", recurringPayments: [] }],
  eligibleAccounts: [{ id: "account-1", name: "Chequing", institutionName: "North Bank" }],
} satisfies AnnualExpenseManagerProps;

const dom = createDomTestRoot();

describe("AnnualExpenseManager action boundaries", () => {
  it("closes the mobile add sheet after successful expense creation", async () => {
    mocks.createAnnualExpenseAction.mockResolvedValueOnce({ ok: true, message: "Expense added.", fieldErrors: {} });
    await dom.render(React.createElement(AnnualExpenseManager, props));
    await click(dom.get<HTMLButtonElement>(".annual-mobile-add-trigger"));

    const form = dom.get<HTMLFormElement>("form.annual-mobile-expense-form");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(dom.container.querySelector('[role="dialog"].annual-mobile-sheet')).toBeNull();
  });

  it("returns the payment editor to add mode after a successful payment update", async () => {
    mocks.mutateAnnualExpensePaymentAction.mockResolvedValueOnce({ ok: true, message: "Payment saved.", fieldErrors: {} });
    await dom.render(React.createElement(AnnualExpenseManager, props));
    await click(dom.get<HTMLButtonElement>("button.annual-manage-trigger"));
    const paymentsTab = Array.from(dom.container.querySelectorAll<HTMLButtonElement>(".annual-modal-tab"))
      .find((button) => button.textContent?.startsWith("Payments"));
    if (!paymentsTab) throw new Error("Missing Payments tab");
    await click(paymentsTab);
    await click(dom.get<HTMLButtonElement>(".annual-payment-row button"));

    const form = dom.get<HTMLFormElement>(".annual-modal-body form.annual-modal-form");
    expect(form.querySelector<HTMLInputElement>('input[name="mode"]')?.value).toBe("update");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(dom.get<HTMLFormElement>(".annual-modal-body form.annual-modal-form").querySelector<HTMLInputElement>('input[name="mode"]')?.value).toBe("create");
  });

  it("keeps expense searches independent for each budget", async () => {
    const baseBudget = props.budgets[0]!;
    const baseItem = baseBudget.items[0]!;
    const electricityOccurrence = {
      ...occurrence,
      id: "occurrence-electricity",
      plannedAmountMinor: 2_500,
      paidMinor: 0,
      remainingMinor: 2_500,
      varianceMinor: 2_500,
      dueDate: "2026-10-01",
      status: "Unpaid" as const,
      payments: [],
    };
    const electricity = {
      ...baseItem,
      id: "expense-electricity",
      name: "Electricity",
      amountMinor: 2_500,
      dueMonth: 10,
      occurrence: electricityOccurrence,
      history: [electricityOccurrence],
    };
    const tuitionOccurrence = {
      ...electricityOccurrence,
      id: "occurrence-tuition",
      budgetId: "budget-2",
      dueDate: "2026-09-01",
    };
    const tuition = {
      ...electricity,
      id: "expense-tuition",
      budgetId: "budget-2",
      name: "Tuition",
      occurrence: tuitionOccurrence,
      history: [tuitionOccurrence],
    };
    const internet = {
      ...tuition,
      id: "expense-internet",
      name: "Internet",
    };
    const budgets = [
      { ...baseBudget, itemCount: 2, items: [baseItem, electricity] },
      {
        ...baseBudget,
        id: "budget-2",
        name: "Education reserve",
        linkedAccountId: "account-2",
        linkedAccountName: "Savings",
        itemCount: 2,
        items: [tuition, internet],
      },
    ];
    await dom.render(React.createElement(AnnualExpenseManager, { ...props, budgets }));

    await changeInput(dom.get<HTMLInputElement>('#annual-budget-expense-search-budget-1'), "insurance");
    await changeInput(dom.get<HTMLInputElement>('#annual-budget-expense-search-budget-2'), "tuition");

    const cards = dom.container.querySelectorAll<HTMLElement>(".annual-budget-card");
    expect(cards).toHaveLength(2);
    const firstCard = cards[0]!;
    const secondCard = cards[1]!;
    expect(firstCard.textContent).toContain("Insurance");
    expect(firstCard.textContent).not.toContain("Electricity");
    expect(secondCard.textContent).toContain("Tuition");
    expect(secondCard.textContent).not.toContain("Internet");
    expect(firstCard.textContent).toContain("1 of 2 expenses shown");
    expect(secondCard.textContent).toContain("1 of 2 expenses shown");
  });

  it("submits only an explicit, confirmed next-occurrence remainder transfer", async () => {
    const baseBudget = props.budgets[0]!;
    const baseItem = baseBudget.items[0]!;
    const earlierOccurrence = {
      ...occurrence,
      id: "occurrence-earlier",
      dueDate: "2026-06-01",
      plannedAmountMinor: 5_000,
      paidMinor: 0,
      remainingMinor: 5_000,
      varianceMinor: 5_000,
      status: "Unpaid" as const,
      payments: [],
    };
    const nextInsurance = {
      ...baseItem,
      id: "expense-next-insurance",
      dueMonth: 6,
      dueDay: 1,
      occurrence: earlierOccurrence,
      history: [earlierOccurrence],
    };
    await dom.render(React.createElement(AnnualExpenseManager, {
      ...props,
      budgets: [{ ...baseBudget, itemCount: 2, items: [baseItem, nextInsurance] }],
    }));
    await click(dom.get<HTMLButtonElement>("button.annual-manage-trigger"));

    expect(dom.get<HTMLElement>("#annual-remainder-transfer-title").textContent)
      .toBe("Move the unused amount to the next matching expense");
    const form = dom.get<HTMLFormElement>("form.annual-remainder-transfer-form");
    expect(new FormData(form).get("annualExpenseId")).toBe("expense-1");
    expect(new FormData(form).get("taxYear")).toBe("2026");
    expect(new FormData(form).get("confirm")).toBe("true");
    expect(dom.get<HTMLElement>(".annual-remainder-transfer-heading").textContent)
      .toContain("Payments already recorded stay with this expense.");
    expect(form.textContent).toContain("does not create a payment or alter the payment ledger");

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(mocks.moveAnnualExpenseRemainderAction).toHaveBeenCalledOnce();
  });
});
