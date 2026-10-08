// @vitest-environment jsdom

import React, { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecurringCashFlowSeriesView } from "@athena/database";
import { changeInput, click, createDomTestRoot } from "../../test/dom";

const recurringActions = vi.hoisted(() => {
  const idle = { ok: false, message: "" };
  return {
    changeRecurringSeriesVersionAction: vi.fn(async () => idle),
    createRecurringSeriesAction: vi.fn(async () => idle),
    deleteRecurringSeriesAction: vi.fn(async () => idle),
    deleteRecurringSeriesVersionAction: vi.fn(async () => idle),
    editRecurringSeriesVersionAction: vi.fn(async () => idle),
    endRecurringSeriesAction: vi.fn(async () => idle),
    generateRecurringOccurrencesAction: vi.fn(async () => idle),
    renameRecurringSeriesAction: vi.fn(async () => idle),
    restoreRecurringOccurrenceAction: vi.fn(async () => idle),
    setRecurringSeriesStateAction: vi.fn(async () => idle),
    setRecurringTransferCountsAsExpenseAction: vi.fn(async () => idle),
    updateRecurringOverrideGroupAction: vi.fn(async () => idle),
    updateRecurringSeriesEntirelyAction: vi.fn(async () => idle),
  };
});

vi.mock("./recurring-actions", () => recurringActions);

import { RecurringCashFlowManager, RecurringCreateHeaderAction } from "./recurring-manager";

function series(index: number): RecurringCashFlowSeriesView {
  const id = `series-${String(index).padStart(2, "0")}`;
  const versionId = `version-${id}`;
  const startsOn = "2026-09-01";
  return {
    id,
    kind: "expense",
    state: "active",
    endedOn: null,
    homeHouseholdFrequency: null,
    firstOccurrenceOn: startsOn,
    nextOccurrenceOn: `2026-09-${String(index + 1).padStart(2, "0")}`,
    activeVersionId: versionId,
    versions: [{
      id: versionId,
      seriesId: id,
      name: `Series ${String(index).padStart(2, "0")}`,
      kind: "expense",
      accountId: "account-1",
      fromAccountId: null,
      toAccountId: null,
      amountMinor: 12_500,
      frequency: "monthly",
      weekdayAdjustment: "none",
      startsOn,
      endsOn: null,
      effectiveFrom: startsOn,
      effectiveTo: null,
      countsAsExpense: false,
      versionNote: null,
      nextOccurrenceOn: `2026-09-${String(index + 1).padStart(2, "0")}`,
      status: "planned",
      isCurrent: true,
    }],
    exceptions: [],
  };
}

const accountOptions = [{ id: "account-1", label: "Main account" }];
const dom = createDomTestRoot();

describe("RecurringCashFlowManager derived and keyed state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", window.location.pathname);
  });

  it("opens first-use creation and closes it when series data arrives", async () => {
    await dom.render(<RecurringCashFlowManager series={[]} accountOptions={accountOptions} todayIso="2026-09-22" />);
    expect(dom.container.querySelector("[role='dialog']")).not.toBeNull();
    expect(dom.get<HTMLInputElement>('input[name="kind"]').value).toBe("income");
    expect(dom.get<HTMLInputElement>('input[name="frequency"]').value).toBe("biweekly");
    expect(dom.get<HTMLInputElement>('input[name="accountId"]').value).toBe("account-1");
    expect(dom.get<HTMLInputElement>('input[name="startsOn"]').value).toBe("2026-09-22");
    expect(dom.get<HTMLElement>(".recurring-create-dialog").textContent).toContain("Add a recurring payment series");

    await dom.render(<RecurringCashFlowManager series={[series(1)]} accountOptions={accountOptions} todayIso="2026-09-22" />);
    expect(dom.container.querySelector("[role='dialog']")).toBeNull();
  });

  it("keeps filter pagination at page one and selects a matching detail", async () => {
    await dom.render(<RecurringCashFlowManager series={Array.from({ length: 12 }, (_, index) => series(index + 1))} accountOptions={accountOptions} todayIso="2026-09-22" />);
    await click(dom.get<HTMLButtonElement>("button[aria-label='Next page']"));
    expect(dom.get<HTMLElement>(".recurring-series-pagination").textContent).toContain("2 / 2");

    await changeInput(dom.get<HTMLInputElement>("input[aria-label='Search recurring series']"), "Series 01");
    expect(dom.get<HTMLElement>(".recurring-series-pagination").textContent).toContain("1 / 1");
    expect(dom.get<HTMLElement>(".recurring-series-detail").textContent).toContain("Series 01");
  });

  it("selects a series addressed by the initial URL fragment", async () => {
    window.history.replaceState(null, "", "#recurring-series-series-12");
    await dom.render(<RecurringCashFlowManager series={Array.from({ length: 12 }, (_, index) => series(index + 1))} accountOptions={accountOptions} todayIso="2026-09-22" />);

    expect(dom.get<HTMLElement>(".recurring-series-detail").textContent).toContain("Series 12");
    expect(dom.get<HTMLElement>(".recurring-series-pagination").textContent).toContain("2 / 2");
  });

  it("opens and closes the standard series-creation dialog from the header action", async () => {
    await dom.render(<>
      <RecurringCreateHeaderAction />
      <RecurringCashFlowManager series={[series(1)]} accountOptions={accountOptions} todayIso="2026-09-22" />
    </>);
    await click(dom.get<HTMLButtonElement>("button.recurring-header-create"));

    const dialog = dom.get<HTMLElement>("section.recurring-create-dialog");
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.textContent).toContain("Series details");
    expect(dialog.textContent).toContain("Schedule settings");
    expect(dialog.textContent).toContain("Occurrence preview");
    expect(dom.get<HTMLInputElement>('input[name="kind"]').value).toBe("expense");
    expect(dom.get<HTMLInputElement>('input[name="frequency"]').value).toBe("monthly");
    expect(dom.get<HTMLTextAreaElement>('textarea[name="note"]').maxLength).toBe(250);
    await click(dom.get<HTMLButtonElement>('button[aria-label="Close add recurring series"]'));
    expect(dom.container.querySelector("section.recurring-create-dialog")).toBeNull();
  });

  it("keeps destructive delete errors inside the required-confirmation dialog", async () => {
    recurringActions.deleteRecurringSeriesAction.mockResolvedValueOnce({ ok: false, message: "Protected Cash Flow rows remain." });
    await dom.render(<RecurringCashFlowManager series={[series(1)]} accountOptions={accountOptions} todayIso="2026-09-22" />);
    const deleteOption = [...dom.container.querySelectorAll<HTMLButtonElement>("button.recurring-detail-option")]
      .find((button) => button.textContent?.includes("Delete series and all linked rows"));
    if (!deleteOption) throw new Error("Missing delete-series action");
    await click(deleteOption);

    const dialog = document.body.querySelector<HTMLDialogElement>('dialog[aria-labelledby]');
    expect(dialog?.textContent).toContain("This cannot be undone.");
    expect(dialog?.textContent).toContain("including planned, Actual, manual, generated, and excluded rows");
    const confirmation = dialog?.querySelector<HTMLInputElement>('input[name="confirm"]');
    expect(confirmation?.required).toBe(true);
    const form = dialog?.querySelector<HTMLFormElement>("form.recurring-delete-form");
    if (!form) throw new Error("Missing series-delete form");

    await click(confirmation!);
    await act(async () => {
      form.requestSubmit();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(recurringActions.deleteRecurringSeriesAction).toHaveBeenCalledOnce();
    expect(document.body.querySelector('dialog[aria-labelledby]')).not.toBeNull();
    expect(document.body.querySelector('dialog[aria-labelledby] [role="alert"]')?.textContent)
      .toBe("Protected Cash Flow rows remain.");
    expect(dom.container.querySelector('[role="status"]')).toBeNull();
  });

  it("closes a version-delete dialog and promotes the action result", async () => {
    recurringActions.deleteRecurringSeriesVersionAction.mockResolvedValue({ ok: true, message: "Version removed" });
    const current = series(1);
    const currentVersion = current.versions[0];
    if (!currentVersion) throw new Error("Missing recurring version fixture");
    const priorVersion = {
      ...currentVersion,
      id: "version-prior",
      name: "Prior series name",
      effectiveFrom: "2026-08-01",
      effectiveTo: "2026-08-31",
      endsOn: "2026-08-31",
      isCurrent: false,
      nextOccurrenceOn: "2026-08-20",
    };
    const entry: RecurringCashFlowSeriesView = { ...current, versions: [priorVersion, currentVersion] };
    await dom.render(<RecurringCashFlowManager series={[entry]} accountOptions={accountOptions} todayIso="2026-09-22" />);

    const historyButton = [...dom.container.querySelectorAll<HTMLButtonElement>("button.recurring-detail-option")].find((button) => button.textContent?.includes("Show history"));
    if (!historyButton) throw new Error("Missing history action");
    await click(historyButton);
    await click(document.body.querySelector<HTMLButtonElement>(".recurring-history-action-button.is-danger")!);
    const dialog = document.body.querySelector<HTMLDialogElement>("dialog[role='dialog']");
    expect(dialog).not.toBeNull();
    await click(dialog!.querySelector<HTMLInputElement>("input[name='confirm']")!);
    const form = dialog!.querySelector<HTMLFormElement>("form");
    if (!form) throw new Error("Missing version-delete form");
    await act(async () => {
      form.requestSubmit();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.body.querySelector("dialog[role='dialog']")).toBeNull();
    expect(dom.container.textContent).toContain("Version removed");
  });
});
