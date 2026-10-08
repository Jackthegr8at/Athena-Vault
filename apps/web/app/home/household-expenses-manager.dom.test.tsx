// @vitest-environment jsdom

import React from "react";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { HouseholdExpenseView } from "@athena/database";
import { changeInput, click, createDomTestRoot } from "../../test/dom";

const actions = vi.hoisted(() => ({
  archiveHouseholdExpenseAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  createHouseholdExpenseAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  deleteHouseholdExpenseAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  restoreHouseholdExpenseAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  updateHouseholdExpenseAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
}));
vi.mock("./expense-actions", () => actions);

import { HouseholdExpensesManager } from "./household-expenses-manager";

const expense: HouseholdExpenseView = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Electricity",
  category: "Utilities",
  frequency: "monthly",
  amountMinor: 8549,
  annualAmountMinor: 102588,
  accountId: null,
  accountName: null,
  startsOn: null,
  endsOn: null,
  currency: "CAD",
  isActive: true,
};
const dom = createDomTestRoot();

describe("household expenses manager", () => {
  it("clears and closes the form at the successful create boundary", async () => {
    actions.createHouseholdExpenseAction.mockResolvedValue({ ok: true, message: "Expense added.", fieldErrors: {} });
    await dom.render(<HouseholdExpensesManager expenses={[]} accounts={[]} />);
    await changeInput(dom.get<HTMLInputElement>('input[name="name"]'), "Water");
    await changeInput(dom.get<HTMLInputElement>('input[name="amount"]'), "85.49");

    await act(async () => {
      dom.get<HTMLFormElement>(".maintenance-form").requestSubmit();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(actions.createHouseholdExpenseAction).toHaveBeenCalledOnce();
    expect(dom.get<HTMLInputElement>('input[name="name"]').value).toBe("");
    expect(dom.get<HTMLInputElement>('input[name="amount"]').value).toBe("");
    expect(dom.container.textContent).toContain("Expense added.");
  });

  it("returns to a fresh add form after a successful edit", async () => {
    actions.updateHouseholdExpenseAction.mockResolvedValue({ ok: true, message: "Expense updated.", fieldErrors: {} });
    await dom.render(<HouseholdExpensesManager expenses={[expense]} accounts={[]} />);
    await click(dom.get<HTMLButtonElement>('[aria-label="Open actions for Electricity"]'));
    const editButton = Array.from(dom.container.querySelectorAll<HTMLButtonElement>(".maintenance-actions-modal-options button")).find((button) => button.textContent?.trim() === "Edit");
    if (!editButton) throw new Error("Missing edit action");
    await click(editButton);
    expect(dom.get<HTMLInputElement>('input[name="name"]').value).toBe("Electricity");

    await act(async () => {
      dom.get<HTMLFormElement>(".maintenance-form").requestSubmit();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(actions.updateHouseholdExpenseAction).toHaveBeenCalledOnce();
    expect(dom.get<HTMLInputElement>('input[name="name"]').value).toBe("");
    expect(dom.get<HTMLElement>(".home-mobile-subdisclosure-title").textContent).toBe("Add household expense");
  });

  it("preserves the delete confirmation and its cancel path", async () => {
    await dom.render(<HouseholdExpensesManager expenses={[expense]} accounts={[]} />);
    await click(dom.get<HTMLButtonElement>('[aria-label="Open actions for Electricity"]'));
    await click(dom.get<HTMLButtonElement>(".maintenance-action-menu-item.is-danger"));

    expect(dom.container.querySelector('[role="alertdialog"]')?.textContent).toContain("Delete this expense permanently?");
    await click(dom.get<HTMLButtonElement>(".maintenance-confirm-actions .maintenance-secondary-button"));
    expect(dom.container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(dom.container.querySelector('[role="dialog"]')?.textContent).toContain("Electricity");
  });
});
