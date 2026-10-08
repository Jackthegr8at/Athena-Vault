// @vitest-environment jsdom

import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { click, createDomTestRoot } from "../../test/dom";

const actionMocks = vi.hoisted(() => {
  const idleState = { ok: false, message: "", fieldErrors: {} };
  return {
    confirmPeriodAction: vi.fn(async () => idleState),
    deleteBalanceSnapshotAction: vi.fn(async (_previousState: typeof idleState, _formData: FormData) => idleState),
    extendAccountTimelineAction: vi.fn(async () => idleState),
    recalculateProjectionsAction: vi.fn(async () => idleState),
    reorderAccountsAction: vi.fn(async () => idleState),
    updateAccountBalanceNoteAction: vi.fn(async () => idleState),
    upsertBalanceSnapshotAction: vi.fn(async () => idleState),
  };
});

const routerMocks = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));

vi.mock("./actions", () => actionMocks);
vi.mock("next/navigation", () => ({ useRouter: () => routerMocks }));

import { ActionNotification } from "../components/action-notification";
import { BalanceTimeline, inlineEditKey, inlineEditKeyboardAction } from "./balance-timeline";
import { buildAccountsPresentation, type AccountTimelinePresentationInput } from "./presentation";

function timelinePresentation(firstAccountName = "Account A", accountAIncludedInAvailableCash = false, firstAccountId = "account-a") {
  const accounts: AccountTimelinePresentationInput["accounts"] = [
    {
      id: firstAccountId,
      name: firstAccountName,
      institution: "North Bank",
      kind: "checking",
      customTypeLabel: null,
      lastFour: "4242",
      isActive: true,
      includeInAvailableCash: accountAIncludedInAvailableCash,
      snapshots: [
        { id: "snapshot-a-current", asOf: "2026-09-02", balanceMinor: 10_000, status: "actual" },
        { id: "snapshot-a-future", asOf: "2026-09-16", balanceMinor: 11_000, status: "planned", isGenerated: true },
      ],
    },
    {
      id: "account-b",
      name: "Account B",
      institution: "North Bank",
      kind: "savings",
      customTypeLabel: null,
      isActive: true,
      includeInAvailableCash: false,
      snapshots: [
        { id: "snapshot-b-current", asOf: "2026-09-02", balanceMinor: 5_000, status: "actual" },
        { id: "snapshot-b-future", asOf: "2026-09-16", balanceMinor: 5_200, status: "planned", isGenerated: true },
      ],
    },
  ];
  return buildAccountsPresentation(
    { paydays: ["2026-09-02", "2026-09-16"], accounts },
    { todayIso: "2026-09-14", selectedDate: "2026-09-02" },
  );
}

function emptyPresentation() {
  return buildAccountsPresentation({ paydays: [], accounts: [] }, { todayIso: "2026-09-14" });
}

const dom = createDomTestRoot();

describe("timeline cell editor keyboard contract", () => {
  it("uses a stable account/date key", () => {
    expect(inlineEditKey("account-1", "2026-08-05")).toBe("account-1:2026-08-05");
  });

  it("maps Enter to explicit save and Escape to cancel without blur behavior", () => {
    expect(inlineEditKeyboardAction("Enter")).toBe("save");
    expect(inlineEditKeyboardAction("Enter", true)).toBe("none");
    expect(inlineEditKeyboardAction("Escape")).toBe("cancel");
    expect(inlineEditKeyboardAction("Tab")).toBe("none");
  });

  it("renders fluid timeline columns, masked account identity, and period navigation", async () => {
    localStorage.clear();
    await dom.render(React.createElement(BalanceTimeline, { presentation: timelinePresentation(), showArchived: false }));

    const table = dom.get<HTMLTableElement>("table.account-timeline-table");
    expect(table.classList.contains("is-fluid")).toBe(true);
    expect(table.querySelectorAll("thead th")).toHaveLength(3);
    expect(dom.container.textContent).toContain("•••• 4242");
    expect(dom.get('[aria-label="Timeline period navigation"]')).not.toBeNull();
  });

  it("keeps a reordered account order through metadata-only presentation refreshes", async () => {
    localStorage.clear();
    await dom.render(React.createElement(BalanceTimeline, { presentation: timelinePresentation(), showArchived: false }));
    await click(dom.get<HTMLDetailsElement>("details.timeline-order-card").querySelector("summary") as HTMLElement);

    const moveDown = dom.get<HTMLButtonElement>('button[aria-label^="Move Account A down"]');
    await click(moveDown);
    const orderedNames = () => Array.from(dom.container.querySelectorAll(".timeline-order-name strong")).map((element) => element.textContent);
    expect(orderedNames()).toEqual(["Account B", "Account A"]);

    await dom.render(React.createElement(BalanceTimeline, { presentation: timelinePresentation("Account A refreshed"), showArchived: false }));
    expect(orderedNames()).toEqual(["Account B", "Account A refreshed"]);
  });

  it("resets optimistic ordering when the account identity set changes", async () => {
    localStorage.clear();
    await dom.render(React.createElement(BalanceTimeline, { presentation: timelinePresentation(), showArchived: false }));
    await click(dom.get<HTMLDetailsElement>("details.timeline-order-card").querySelector("summary") as HTMLElement);
    await click(dom.get<HTMLButtonElement>('button[aria-label^="Move Account A down"]'));

    const orderedNames = () => Array.from(dom.container.querySelectorAll(".timeline-order-name strong")).map((element) => element.textContent);
    expect(orderedNames()).toEqual(["Account B", "Account A"]);

    await dom.render(React.createElement(BalanceTimeline, { presentation: timelinePresentation("Account A replacement", false, "account-a-replacement"), showArchived: false }));
    expect(orderedNames()).toEqual(["Account A replacement", "Account B"]);
  });

  it("closes the balance editor at the successful save boundary", async () => {
    localStorage.clear();
    actionMocks.upsertBalanceSnapshotAction.mockResolvedValueOnce({ ok: true, message: "Balance saved.", fieldErrors: {} });
    await dom.render(React.createElement(BalanceTimeline, { presentation: timelinePresentation(), showArchived: false }));
    const firstAccountRow = dom.container.querySelector<HTMLTableRowElement>("tbody tr:not(.timeline-group-row):not(.timeline-total-row)");
    if (!firstAccountRow) throw new Error("Missing account row");
    await click(firstAccountRow.querySelectorAll<HTMLButtonElement>(".timeline-cell-button")[0]!);

    const form = document.body.querySelector<HTMLFormElement>(".timeline-cell-editor");
    if (!form) throw new Error("Missing balance editor form");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(document.body.querySelector('[role="dialog"].timeline-cell-editor-popover')).toBeNull();
  });

  it("opens an accessible editor outside the table and keeps projected cells read-only", async () => {
    localStorage.clear();
    await dom.render(React.createElement(BalanceTimeline, { presentation: timelinePresentation(), showArchived: false }));
    const firstAccountRow = dom.container.querySelector<HTMLTableRowElement>("tbody tr:not(.timeline-group-row):not(.timeline-total-row)");
    if (!firstAccountRow) throw new Error("Missing account row");
    const buttons = firstAccountRow.querySelectorAll<HTMLButtonElement>(".timeline-cell-button");
    await click(buttons[0]!);

    expect(document.body.querySelector<HTMLInputElement>('input[name="balance"]')?.value).toBe("100.00");

    const editor = document.body.querySelector('[role="dialog"].timeline-cell-editor-popover');
    expect(editor?.textContent).toContain("Period note");
    expect(editor?.textContent).toContain("Save note");
    expect(editor?.textContent).toContain("Confirm");
    expect(editor?.querySelector('input[name="status"]')).not.toBeNull();

    await click(buttons[1]!);
    const projectedEditor = document.body.querySelector('[role="dialog"].timeline-cell-editor-popover');
    const readonlyStatus = projectedEditor?.querySelector<HTMLInputElement>(".timeline-status-readonly");
    expect(readonlyStatus?.value).toBe("Projected");
    expect(readonlyStatus?.disabled).toBe(true);
    expect(readonlyStatus?.getAttribute("aria-disabled")).toBe("true");
    expect(projectedEditor?.querySelector('input[type="hidden"][name="status"][value="planned"]')).not.toBeNull();
    expect(projectedEditor?.querySelector('button[aria-label="Confirm and save balance"]')).toBeNull();
  });

  it("exposes confirmation actions and accessible notification states through rendered UI", async () => {
    localStorage.clear();
    await dom.render(React.createElement(BalanceTimeline, { presentation: timelinePresentation(), showArchived: false }));
    const recalculateButtons = dom.container.querySelectorAll<HTMLButtonElement>(".timeline-recalculation-actions button");
    await click(recalculateButtons[0]!);
    expect(document.body.querySelector(".confirmation-dialog")?.textContent).toContain("Recalculate this account?");
    await click(document.body.querySelector<HTMLButtonElement>(".confirmation-dialog__cancel")!);
    expect(document.body.querySelector(".confirmation-dialog")).toBeNull();

    const notification = renderToStaticMarkup(React.createElement(ActionNotification, { state: { ok: true, message: "Balance saved." } }));
    expect(notification).toContain('role="status"');
    expect(notification).toContain('aria-label="Dismiss notification"');
  });

  it("requires the accessible confirmation dialog before resetting a saved balance", async () => {
    localStorage.clear();
    actionMocks.deleteBalanceSnapshotAction.mockClear();
    await dom.render(React.createElement(BalanceTimeline, { presentation: timelinePresentation(), showArchived: false }));
    const firstAccountRow = dom.container.querySelector<HTMLTableRowElement>("tbody tr:not(.timeline-group-row):not(.timeline-total-row)");
    if (!firstAccountRow) throw new Error("Missing account row");
    await click(firstAccountRow.querySelectorAll<HTMLButtonElement>(".timeline-cell-button")[0]!);

    await click(document.body.querySelector<HTMLButtonElement>(".timeline-cell-delete-form button")!);
    const dialog = document.body.querySelector<HTMLDialogElement>(".confirmation-dialog");
    expect(dialog?.getAttribute("role")).toBe("alertdialog");
    expect(dialog?.textContent).toContain("Reset this balance?");
    expect(dialog?.textContent).toContain("The value will be removed and future projections will recalculate.");
    await click(document.body.querySelector<HTMLButtonElement>(".confirmation-dialog__cancel")!);
    expect(document.body.querySelector(".confirmation-dialog")).toBeNull();
    expect(actionMocks.deleteBalanceSnapshotAction).not.toHaveBeenCalled();

    await click(document.body.querySelector<HTMLButtonElement>(".timeline-cell-delete-form button")!);
    await click(document.body.querySelector<HTMLButtonElement>(".confirmation-dialog__confirm")!);

    expect(actionMocks.deleteBalanceSnapshotAction).toHaveBeenCalledOnce();
    const formData = actionMocks.deleteBalanceSnapshotAction.mock.calls[0]?.[1];
    expect(formData?.get("accountId")).toBe("account-a");
    expect(formData?.get("asOf")).toBe("2026-09-02");
    expect(document.body.querySelector(".confirmation-dialog")).toBeNull();
  });

  it("renders an explicit empty payday state when no periods exist", async () => {
    localStorage.clear();
    await dom.render(React.createElement(BalanceTimeline, { presentation: emptyPresentation(), showArchived: false }));
    expect(dom.container.textContent).toContain("No paydays available");
    expect(dom.container.textContent).toContain("No payday columns are available yet.");
  });

  it("pushes Cash Flow from the single available-cash account timeline cell", async () => {
    localStorage.clear();
    routerMocks.push.mockClear();
    await dom.render(React.createElement(BalanceTimeline, { presentation: timelinePresentation("Account A", true), showArchived: false }));

    await click(dom.get<HTMLButtonElement>("button.is-payday-check-managed"));

    expect(routerMocks.push).toHaveBeenCalledWith("/cash-flow");
  });

  it("replaces the current route when stored timeline periods need normalization", async () => {
    localStorage.setItem("athena-accounts-past-periods", "24");
    localStorage.setItem("athena-accounts-future-periods", "0");
    routerMocks.replace.mockClear();
    await dom.render(React.createElement(BalanceTimeline, { presentation: timelinePresentation(), showArchived: false }));

    expect(routerMocks.replace).toHaveBeenCalledTimes(1);
    expect(routerMocks.replace.mock.calls[0]?.[0]).toContain("?selected=2026-09-02");
    expect(routerMocks.replace.mock.calls[0]?.[0]).toContain("&past=24");
    expect(routerMocks.replace.mock.calls[0]?.[0]).toContain("&future=0");
  });
});
