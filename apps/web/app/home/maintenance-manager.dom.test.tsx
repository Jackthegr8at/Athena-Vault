// @vitest-environment jsdom

import React from "react";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { changeInput, click, createDomTestRoot } from "../../test/dom";

const actions = vi.hoisted(() => ({
  createMaintenanceItemAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  deleteMaintenanceItemAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  updateMaintenanceItemAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
}));
vi.mock("./actions", () => actions);

import { MaintenanceManager } from "./maintenance-manager";

const item = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Roof replacement",
  amountMinor: 125000,
  frequency: "annual" as const,
  annualizedAmountMinor: 125000,
};
const dom = createDomTestRoot();

describe("annual maintenance manager", () => {
  it("renders the maintenance heading, item count, reserve metrics, and add control", async () => {
    await dom.render(<MaintenanceManager items={[item]} summary={{ amountMinor: 12_500, annualAmountMinor: 150_000 }} />);

    expect(dom.get<HTMLHeadingElement>("#maintenance-heading").textContent).toBe("Annual maintenance");
    expect(dom.get<HTMLElement>(".maintenance-card-head").textContent).toContain("Editable reserves, annualized from each amount per occurrence.");
    expect(dom.get<HTMLElement>(".maintenance-item-count").textContent).toContain("1 item");
    const totals = dom.get<HTMLElement>('[aria-label="Annual maintenance totals"]');
    expect(totals.textContent).toContain("Monthly reserve");
    expect(totals.textContent).toContain("$125.00");
    expect(totals.textContent).toContain("Annual total");
    expect(totals.textContent).toContain("$1,500.00");
    expect(dom.get<HTMLButtonElement>(".maintenance-form .navy-action-button").textContent).toContain("Add item");
    expect(dom.get(".maintenance-form .navy-action-icon").getAttribute("aria-hidden")).toBe("true");
    expect(dom.get<HTMLTableElement>("table.maintenance-table caption").textContent).toBe("Annual maintenance items");
  });

  it("clears the add form after a successful create", async () => {
    actions.createMaintenanceItemAction.mockResolvedValue({ ok: true, message: "Reserve added.", fieldErrors: {} });
    await dom.render(<MaintenanceManager items={[]} summary={null} />);
    await changeInput(dom.get<HTMLInputElement>('input[name="name"]'), "Water heater");
    await changeInput(dom.get<HTMLInputElement>('input[name="amount"]'), "1250.00");

    await act(async () => {
      dom.get<HTMLFormElement>(".maintenance-form").requestSubmit();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(actions.createMaintenanceItemAction).toHaveBeenCalledOnce();
    expect(dom.get<HTMLInputElement>('input[name="name"]').value).toBe("");
    expect(dom.get<HTMLInputElement>('input[name="amount"]').value).toBe("");
    expect(dom.container.textContent).toContain("Reserve added.");
  });

  it("resets the editor after a successful update", async () => {
    actions.updateMaintenanceItemAction.mockResolvedValue({ ok: true, message: "Reserve updated.", fieldErrors: {} });
    await dom.render(<MaintenanceManager items={[item]} summary={{ amountMinor: item.amountMinor, annualAmountMinor: item.annualizedAmountMinor }} />);
    await click(Array.from(dom.container.querySelectorAll<HTMLButtonElement>(".maintenance-row-actions button")).find((button) => button.textContent === "Edit")!);
    expect(dom.get<HTMLInputElement>('input[name="name"]').value).toBe(item.name);

    await act(async () => {
      dom.get<HTMLFormElement>(".maintenance-form").requestSubmit();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(actions.updateMaintenanceItemAction).toHaveBeenCalledOnce();
    expect(dom.get<HTMLInputElement>('input[name="name"]').value).toBe("");
    expect(dom.get<HTMLElement>(".home-mobile-subdisclosure-title").textContent).toBe("Add maintenance item");
  });

  it("closes the delete confirmation only after successful deletion", async () => {
    actions.deleteMaintenanceItemAction.mockResolvedValue({ ok: true, message: "Reserve deleted.", fieldErrors: {} });
    await dom.render(<MaintenanceManager items={[item]} summary={{ amountMinor: item.amountMinor, annualAmountMinor: item.annualizedAmountMinor }} />);
    await click(Array.from(dom.container.querySelectorAll<HTMLButtonElement>(".maintenance-row-actions button")).find((button) => button.textContent === "Delete")!);
    expect(dom.container.querySelector('[role="alertdialog"]')).not.toBeNull();

    await act(async () => {
      dom.get<HTMLFormElement>(".maintenance-confirm-actions").requestSubmit();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(actions.deleteMaintenanceItemAction).toHaveBeenCalledOnce();
    expect(dom.container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(dom.container.textContent).toContain("Reserve deleted.");
  });
});
