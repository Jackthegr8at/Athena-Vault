// @vitest-environment jsdom

import React, { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDomTestRoot } from "../../test/dom";
import { InitialCashFlowTimelineSetup } from "./initial-timeline-setup";
import { InitialCashFlowIncomeSetup } from "./initial-income-setup";

const timelineActions = vi.hoisted(() => ({
  createInitialCashFlowTimelineAction: vi.fn(async (_state: { readonly ok: boolean; readonly message: string }, _data: FormData) => ({ ok: false, message: "Review the timeline dates." })),
}));
const incomeActions = vi.hoisted(() => ({
  createInitialCashFlowIncomeAction: vi.fn(async (_state: { readonly ok: boolean; readonly message: string }, _data: FormData) => ({ ok: false, message: "Review the income details." })),
}));

vi.mock("./actions", () => timelineActions);
vi.mock("./recurring-actions", () => incomeActions);

const dom = createDomTestRoot();

describe("Cash Flow first-use setup forms", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders labelled timeline dates and keeps errors visible after submit", async () => {
    await dom.render(React.createElement(InitialCashFlowTimelineSetup, {
      todayIso: "2026-09-22",
      defaultThroughDate: "2027-09-21",
    }));

    expect(dom.get<HTMLInputElement>("#cash-flow-first-payday").value).toBe("2026-09-22");
    expect(dom.get<HTMLInputElement>("#cash-flow-through-date").value).toBe("2027-09-21");
    expect(dom.container.querySelector('label[for="cash-flow-first-payday"]')?.textContent).toContain("First payday");
    expect(dom.container.querySelector('label[for="cash-flow-through-date"]')?.textContent).toContain("Create periods through");
    expect(dom.get<HTMLElement>(".cash-flow-initial-timeline-help").textContent)
      .toContain("It does not add income, balances, sample data, or transactions.");

    const form = dom.get<HTMLFormElement>("form.cash-flow-initial-timeline-form");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(dom.get<HTMLElement>('[role="alert"]').textContent).toBe("Review the timeline dates.");
  });

  it("shows a pending timeline state while its action is unresolved", async () => {
    let resolveAction!: (state: { readonly ok: boolean; readonly message: string }) => void;
    timelineActions.createInitialCashFlowTimelineAction.mockImplementationOnce(() => new Promise((resolve) => {
      resolveAction = resolve;
    }));
    await dom.render(React.createElement(InitialCashFlowTimelineSetup, {
      todayIso: "2026-09-22",
      defaultThroughDate: "2027-09-21",
    }));

    await act(async () => {
      dom.get<HTMLFormElement>("form.cash-flow-initial-timeline-form")
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(dom.get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    expect(dom.get<HTMLButtonElement>('button[type="submit"]').textContent).toBe("Setting up…");

    await act(async () => resolveAction({ ok: false, message: "The end date must follow the first payday." }));
    expect(dom.get<HTMLElement>('[role="alert"]').textContent).toBe("The end date must follow the first payday.");
  });

  it("uses the account and biweekly income defaults and reports pending/error feedback", async () => {
    await dom.render(React.createElement(InitialCashFlowIncomeSetup, {
      accountOptions: [{ id: "main-account", label: "Main account · North Bank" }],
      todayIso: "2026-09-22",
      defaultThroughDate: "2027-09-21",
      hasExistingTimeline: false,
    }));

    expect(dom.get<HTMLInputElement>("#cash-flow-income-name").value).toBe("");
    expect(dom.get<HTMLInputElement>("#cash-flow-income-amount").value).toBe("");
    expect(dom.get<HTMLInputElement>('input[name="accountId"]').value).toBe("main-account");
    expect(dom.get<HTMLButtonElement>("#cash-flow-income-frequency").textContent)
      .toContain("biweekly");
    expect(dom.get<HTMLInputElement>("#cash-flow-income-starts-on").value).toBe("2026-09-22");
    expect(dom.get<HTMLInputElement>("#cash-flow-income-through-date").value).toBe("2027-09-21");
    expect(dom.get<HTMLElement>(".cash-flow-initial-income-help").textContent)
      .toContain("generates planned income occurrences automatically");
    expect(dom.get<HTMLElement>(".cash-flow-initial-income-help").textContent)
      .toContain("It does not add sample data or a starting balance.");

    let resolveAction!: (state: { readonly ok: boolean; readonly message: string }) => void;
    incomeActions.createInitialCashFlowIncomeAction.mockImplementationOnce(() => new Promise((resolve) => {
      resolveAction = resolve;
    }));
    await act(async () => {
      dom.get<HTMLFormElement>("form.cash-flow-initial-income-form")
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(dom.get<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    expect(dom.get<HTMLButtonElement>('button[type="submit"]').textContent).toBe("Creating…");

    await act(async () => resolveAction({ ok: false, message: "Choose an income account and valid dates." }));
    expect(dom.get<HTMLElement>('[role="alert"]').textContent).toBe("Choose an income account and valid dates.");
  });
});
