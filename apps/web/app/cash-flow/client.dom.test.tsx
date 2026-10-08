// @vitest-environment jsdom

import React, { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { money, projectChainedCashFlow } from "@athena/finance-engine";
import { changeInput, click, createDomTestRoot } from "../../test/dom";
import { CashFlowClient, type SerializedCashFlowPeriod } from "./client";
import type { CashFlowActionState } from "./action-helpers";

const actions = vi.hoisted(() => {
  const idleState = { ok: false, message: "", fieldErrors: {} };
  return {
    createCashFlowTransactionAction: vi.fn(async () => idleState),
    excludeCashFlowExpenseAction: vi.fn(async () => idleState),
    recordCashFlowPaydayBalanceAction: vi.fn(async () => idleState),
    resetCashFlowPaydayBalanceAction: vi.fn(async (_previousState: CashFlowActionState, _formData: FormData) => idleState),
    restoreCashFlowExpenseAction: vi.fn(async () => idleState),
    toggleCashFlowAccountVisibilityAction: vi.fn(async () => idleState),
    updateCashFlowPaydayNoteAction: vi.fn(async (_previousState: CashFlowActionState, _formData: FormData) => idleState),
    updateCashFlowRecordAction: vi.fn(async () => idleState),
  };
});

const recurringActions = vi.hoisted(() => {
  const idleState = { ok: false, message: "", fieldErrors: {} };
  return {
    applyRecurringOccurrenceExceptionAction: vi.fn(async () => idleState),
    restoreRecurringOccurrenceAction: vi.fn(async () => idleState),
  };
});

vi.mock("./actions", () => actions);
vi.mock("./recurring-actions", () => recurringActions);

function makePeriod(id: string, payDate: string, paydayNote: string | null): SerializedCashFlowPeriod {
  const projection = projectChainedCashFlow({
    accounts: [{ id: "main", name: "Main account", includeInAvailableCash: true }],
    anchors: [{ id: `anchor-${id}`, accountId: "main", asOf: payDate, balanceMinor: money(10_000), source: "actual" }],
    transactions: [],
    transfers: [],
    periods: [{ id, label: payDate, startsOn: payDate, endsOn: payDate, payDate }],
  }).periods[0];
  if (!projection) throw new Error("Missing cash-flow projection fixture");
  return {
    period: { id, label: payDate, payDate, startsOn: payDate, endsOn: payDate, openingBalance: money(10_000), status: "actual", items: [] },
    editableIncomeId: null,
    projection,
    observedMainAccountBalanceMinor: 10_000,
    paydayCheck: null,
    paydayNote,
  };
}

function clientProps(initialPeriods: readonly SerializedCashFlowPeriod[], selectedPeriodId: string) {
  const selected = initialPeriods.find((entry) => entry.period.id === selectedPeriodId);
  return {
    initialPeriods,
    selectedPeriodId,
    currentPeriodId: selectedPeriodId,
    currentPeriodPayDate: selected?.period.payDate ?? null,
    totalPeriodCount: initialPeriods.length,
    showAll: true,
    todayIso: "2026-10-01",
    accountOptions: [{ id: "main", label: "Main account", includeInAvailableCash: true, isVisibleInCashFlow: true }],
    paydayCheckAccountId: "main",
    visibleAccountIds: [],
    showAllAccounts: false,
    recurringOptions: [],
    excludedExpenses: [],
    recurringRangeSegments: [],
  };
}

const dom = createDomTestRoot();

describe("CashFlowClient responsive and period-scoped state", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts the account and payday details collapsed on compact viewports", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
      matches: query === "(max-width: 720px)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    const period = makePeriod("period-a", "2026-09-16", "Payday note");
    await dom.render(React.createElement(CashFlowClient, clientProps([period], period.period.id)));

    expect(dom.get<HTMLButtonElement>(".cash-flow-payday-check-mobile-toggle").getAttribute("aria-expanded")).toBe("false");
    expect(dom.get<HTMLDetailsElement>("details.cash-flow-account-details").open).toBe(false);
  });

  it("resets the payday-note draft when the selected period changes", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    const first = makePeriod("period-a", "2026-09-16", "Saved note A");
    const second = makePeriod("period-b", "2026-09-30", "Saved note B");
    await dom.render(React.createElement(CashFlowClient, clientProps([first, second], first.period.id)));
    await click(dom.get<HTMLButtonElement>(".cash-flow-payday-note-toggle"));
    const draft = dom.get<HTMLTextAreaElement>("#cash-flow-payday-note-field-main-2026-09-16");
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (!setValue) throw new Error("Missing native textarea value setter");
    await act(async () => {
      setValue.call(draft, "Unsaved draft for period A");
      draft.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await dom.render(React.createElement(CashFlowClient, clientProps([first, second], second.period.id)));
    await click(dom.get<HTMLButtonElement>(".cash-flow-payday-note-toggle"));

    expect(dom.get<HTMLTextAreaElement>("#cash-flow-payday-note-field-main-2026-09-30").value).toBe("Saved note B");
  });

  it("preserves an unsaved payday balance when the saved note changes", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    const period = makePeriod("period-a", "2026-09-16", "Saved note");
    await dom.render(React.createElement(CashFlowClient, clientProps([period], period.period.id)));

    await changeInput(dom.get<HTMLInputElement>("#cash-flow-payday-balance"), "12345.67");
    await click(dom.get<HTMLButtonElement>(".cash-flow-payday-note-toggle"));
    const noteDraft = dom.get<HTMLTextAreaElement>("#cash-flow-payday-note-field-main-2026-09-16");
    const setTextAreaValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (!setTextAreaValue) throw new Error("Missing native textarea value setter");
    await act(async () => {
      setTextAreaValue.call(noteDraft, "Updated note");
      noteDraft.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(dom.get<HTMLButtonElement>(".cash-flow-payday-note-actions button"));

    expect(actions.updateCashFlowPaydayNoteAction).toHaveBeenCalledOnce();
    expect(actions.updateCashFlowPaydayNoteAction.mock.calls[0]?.[1].get("note")).toBe("Updated note");

    const updatedPeriod = makePeriod("period-a", "2026-09-16", "Updated note");
    await dom.render(React.createElement(CashFlowClient, clientProps([updatedPeriod], updatedPeriod.period.id)));

    expect(dom.get<HTMLInputElement>("#cash-flow-payday-balance").value).toBe("12345.67");
    await click(dom.get<HTMLButtonElement>(".cash-flow-payday-note-toggle"));
    expect(dom.get<HTMLTextAreaElement>("#cash-flow-payday-note-field-main-2026-09-16").value).toBe("Updated note");
  });

  it("renders Current navigation, selected period roles, and decorative card artwork", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    const past = makePeriod("period-a", "2026-09-16", null);
    const current = makePeriod("period-b", "2026-09-30", null);
    await dom.render(React.createElement(CashFlowClient, {
      ...clientProps([past, current], past.period.id),
      currentPeriodId: current.period.id,
      currentPeriodPayDate: current.period.payDate,
      showAllAccounts: true,
    }));

    const currentLink = dom.get<HTMLAnchorElement>("a.cash-flow-current-period-control");
    expect(currentLink.getAttribute("href")).toBe("/cash-flow?period=period-b&view=all&accounts=all");
    const rows = dom.container.querySelectorAll<HTMLAnchorElement>("a.cash-flow-period-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.getAttribute("aria-current")).toBe("page");
    expect(rows[0]!.querySelector(".cash-flow-period-date small")?.textContent).toBe("Past");
    expect(rows[1]!.querySelector(".cash-flow-period-date small")?.textContent).toBe("Current");
    expect(rows[0]!.querySelector(".cash-flow-period-desktop-metrics")).not.toBeNull();
    expect(rows[0]!.querySelector(".cash-flow-period-mobile-summary")).not.toBeNull();

    const artwork = dom.get<SVGSVGElement>("svg.cash-flow-selected-period-art");
    expect(artwork.getAttribute("aria-hidden")).toBe("true");
    expect(artwork.getAttribute("data-direction")).toBe("left-to-right");
    expect(artwork.querySelector("image.animated-line-background__mobile-art")?.getAttribute("href"))
      .toBe("/brand/back-lines.svg");
  });

  it("shows observed-balance controls only once the selected payday is current", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    const past = makePeriod("period-a", "2026-09-16", null);
    const future = makePeriod("period-b", "2026-10-14", null);
    await dom.render(React.createElement(CashFlowClient, {
      ...clientProps([past, future], past.period.id),
      currentPeriodId: past.period.id,
      currentPeriodPayDate: past.period.payDate,
    }));
    expect(dom.get<HTMLInputElement>('.cash-flow-payday-check-form input[name="asOf"]').value).toBe("2026-09-16");

    await dom.render(React.createElement(CashFlowClient, {
      ...clientProps([past, future], future.period.id),
      currentPeriodId: past.period.id,
      currentPeriodPayDate: past.period.payDate,
    }));
    expect(dom.container.querySelector(".cash-flow-payday-check-form")).toBeNull();
    expect(dom.get<HTMLElement>(".cash-flow-payday-check-guidance").textContent)
      .toContain("Observed balances become available when Oct 14, 2026 is current.");
    const futureRow = dom.container.querySelector<HTMLAnchorElement>('a.cash-flow-period-row[href*="period-b"]');
    expect(futureRow?.querySelector(".cash-flow-period-date small")?.textContent).toBe("Projected");
  });

  it("requires the accessible confirmation dialog before resetting an observed balance", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    const period = makePeriod("period-a", "2026-09-16", null);
    await dom.render(React.createElement(CashFlowClient, clientProps([period], period.period.id)));

    await click(dom.get<HTMLButtonElement>(".cash-flow-payday-check-reset-form button"));
    const dialog = document.body.querySelector<HTMLDialogElement>(".confirmation-dialog");
    expect(dialog?.getAttribute("role")).toBe("alertdialog");
    expect(dialog?.textContent).toContain("Reset this observed payday balance?");
    expect(dialog?.textContent).toContain("Future projections will recalculate from the previous anchor.");
    await click(document.body.querySelector<HTMLButtonElement>(".confirmation-dialog__cancel")!);
    expect(document.body.querySelector(".confirmation-dialog")).toBeNull();
    expect(actions.resetCashFlowPaydayBalanceAction).not.toHaveBeenCalled();

    await click(dom.get<HTMLButtonElement>(".cash-flow-payday-check-reset-form button"));
    await click(document.body.querySelector<HTMLButtonElement>(".confirmation-dialog__confirm")!);

    expect(actions.resetCashFlowPaydayBalanceAction).toHaveBeenCalledOnce();
    const call = actions.resetCashFlowPaydayBalanceAction.mock.calls[0];
    expect(call?.[1].get("accountId")).toBe("main");
    expect(call?.[1].get("asOf")).toBe("2026-09-16");
  });
});
