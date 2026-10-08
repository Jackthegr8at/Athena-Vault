// @vitest-environment jsdom

import React, { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SalaryYearView } from "@athena/database";
import { click, createDomTestRoot } from "../../test/dom";
import type { SalarySnapshotPresentation, SalaryYearPresentation } from "./salaries-manager";

const actions = vi.hoisted(() => {
  const idleState = { ok: false, message: "", fieldErrors: {} };
  return {
    createFinalizedSalaryYearAction: vi.fn(async (_previousState: typeof idleState, _formData: FormData) => idleState),
    createSalarySnapshotAction: vi.fn(async (_previousState: typeof idleState, _formData: FormData) => idleState),
    createSalaryYearAction: vi.fn(async (_previousState: typeof idleState, _formData: FormData) => idleState),
    deleteSalarySnapshotAction: vi.fn(async (_previousState: typeof idleState, _formData: FormData) => idleState),
    deleteSalaryYearAction: vi.fn(async (_previousState: typeof idleState, _formData: FormData) => idleState),
    finalizeSalaryYearAction: vi.fn(async (_previousState: typeof idleState, _formData: FormData) => idleState),
    reopenSalaryYearAction: vi.fn(async (_previousState: typeof idleState, _formData: FormData) => idleState),
    updateFinalFederalSalaryYearAction: vi.fn(async (_previousState: typeof idleState, _formData: FormData) => idleState),
    updateRrqYearLimitsAction: vi.fn(async (_previousState: typeof idleState, _formData: FormData) => idleState),
    updateSalarySnapshotAction: vi.fn(async (_previousState: typeof idleState, _formData: FormData) => idleState),
    updateSalaryYearAction: vi.fn(async (_previousState: typeof idleState, _formData: FormData) => idleState),
  };
});
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("./actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { SalariesManager } from "./salaries-manager";

const limits: SalaryYearView["rrqContributionTracker"]["limits"] = {
  taxYear: 2026,
  firstMaximumMinor: 450_000,
  additionalMaximumMinor: 160_000,
  ympeMinor: 7_000_000,
  yampeMinor: 8_000_000,
  firstRateBps: 600,
  additionalRateBps: 400,
  totalEmployeeMaximumMinor: 610_000,
};
const tracker: SalaryYearView["rrqContributionTracker"] = {
  status: "available",
  unavailableReason: null,
  limits,
  paidYtdMinor: 400_000,
  remainingMinor: 210_000,
  overageMinor: 0,
  completionPercent: 65.6,
  weightedPerPayMinor: 13_000,
  tierAwareForecastPerPayMinor: 14_000,
  projectedTier: "first",
  projectedCompletionPayNumber: 24,
  projectedCompletionOn: "2026-12-02",
  recentEntries: [{
    snapshotId: "salary-snapshot-latest",
    snapshotOn: "2026-08-15",
    completedPayNumber: 16,
    rrqContributionYtdMinor: 400_000,
    derivedContributionMinor: 26_000,
    derivedPayPeriodCount: 2,
    derivedPerPayMinor: 13_000,
    isReanchor: false,
  }],
  ympeProgressPercent: 72,
  yampeProgressPercent: 52,
  federalCumulativeMinor: 6_500_000,
  provincialCumulativeMinor: 6_800_000,
  provincialProjectedYearEndMinor: 10_500_000,
};

function snapshot(id: string, snapshotOn: string, federal: number, provincial: number, completedPayNumber: number): SalarySnapshotPresentation {
  return {
    id,
    salaryYearId: "salary-year-2026",
    snapshotOn,
    federalCumulativeMinor: federal,
    provincialCumulativeMinor: provincial,
    completedPayNumber,
    completedPayNumberOverride: null,
    rrqContributionYtdMinor: 400_000,
    note: null,
    federalDeltaMinor: 250_000,
    provincialDeltaMinor: 280_000,
    federalProjectedYearEndMinor: 10_000_000,
    provincialProjectedYearEndMinor: 10_500_000,
  };
}

const latestSnapshot = snapshot("salary-snapshot-latest", "2026-08-15", 6_500_000, 6_800_000, 16);
const earlierSnapshot = snapshot("salary-snapshot-earlier", "2026-08-01", 6_250_000, 6_520_000, 14);
const year: SalaryYearPresentation = {
  id: "salary-year-2026",
  taxYear: 2026,
  annualBaseMinor: 8_000_000,
  status: "in_progress",
  finalFederalMinor: null,
  payPeriodsPerYearOverride: null,
  totalPayPeriods: 26,
  paydayAnchorOn: "2026-01-07",
  note: null,
  snapshots: [latestSnapshot, earlierSnapshot],
  latestSnapshot,
  federalCumulativeMinor: 6_500_000,
  provincialCumulativeMinor: 6_800_000,
  federalProjectedYearEndMinor: 10_000_000,
  provincialProjectedYearEndMinor: 10_500_000,
  federalVarianceToBaseMinor: 2_000_000,
  rrqContributionTracker: tracker,
};

const dom = createDomTestRoot();

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("Salaries manager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    actions.updateSalarySnapshotAction.mockResolvedValue({ ok: false, message: "Snapshot could not be saved.", fieldErrors: {} });
    actions.deleteSalarySnapshotAction.mockResolvedValue({ ok: false, message: "Snapshot could not be removed.", fieldErrors: {} });
  });

  it("renders the latest-snapshot progress and RRQ paid, maximum, forecast, and threshold metrics", async () => {
    await dom.render(<SalariesManager years={[year]} selectedYear={year} availableYears={[2025, 2026, 2027]} selectedTaxYear={2026} currentTaxYear={2026} />);

    expect(dom.get<HTMLElement>('[aria-label="Salary years"]').textContent).toContain("2026");
    expect(dom.get<HTMLElement>('[aria-label="Latest salary snapshot"]').textContent).toContain("61.54% complete");
    expect(dom.get<HTMLElement>('[role="img"][aria-label="16 of 26 pay periods saved"]')).not.toBeNull();
    const rrq = dom.get<HTMLElement>('.rrq-tracker[aria-labelledby="rrq-tracker-heading"]');
    expect(rrq.querySelector("#rrq-tracker-heading")?.textContent).toBe("Employee RRQ YTD");
    expect(rrq.querySelector('[role="img"][aria-label="65.6% of RRQ maximum"]')).not.toBeNull();
    expect(rrq.querySelector(".rrq-tracker-metrics")?.textContent).toContain("Paid YTD$4,000.00");
    expect(rrq.querySelector(".rrq-tracker-metrics")?.textContent).toContain("Yearly max$6,100.00");
    expect(rrq.querySelector(".rrq-tracker-metrics")?.textContent).toContain("Remaining$2,100.00");
    expect(rrq.querySelector(".rrq-tracker-forecast")?.textContent).toContain("Pay period 24 of 26");
    expect(rrq.querySelector(".rrq-tracker-forecast")?.textContent).toContain("$140.00");
    expect(rrq.querySelector(".rrq-thresholds")?.textContent).toContain("72.0%");
    expect(rrq.querySelector(".rrq-thresholds")?.textContent).toContain("52.0%");
    expect(rrq.querySelector(".rrq-recent-table")?.textContent).toContain("Aug 15, 2026");
    expect(rrq.querySelector<HTMLButtonElement>(".rrq-limits-edit-button")?.getAttribute("aria-expanded")).toBe("false");
  });

  it("hides RRQ without clearing saved values or sending the field in salary edits", async () => {
    await dom.render(<SalariesManager preferenceScope="test-user" years={[year]} selectedYear={year} availableYears={[2026]} selectedTaxYear={2026} currentTaxYear={2026} />);
    const toggle = dom.get<HTMLButtonElement>(".salary-rrq-preference button");
    expect(toggle.textContent).toContain("Québec — RRQ/QPP");
    await click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(dom.container.querySelector(".rrq-tracker")).toBeNull();
    expect(dom.container.querySelector('[data-label="RRQ contribution YTD"]')).toBeNull();
    expect(dom.container.querySelector(".salary-snapshots-layout.is-rrq-hidden")).not.toBeNull();
    const row = dom.get<HTMLTableRowElement>(".salary-timeline-table tbody tr");
    await click(row.querySelector<HTMLButtonElement>(".salary-row-actions button")!);
    const form = dom.get<HTMLFormElement>("form.salary-inline-form");
    expect(form.querySelector('[name="rrqContributionYtd"]')).toBeNull();
    expect(dom.get<HTMLTableCellElement>(".salary-edit-row td").colSpan).toBe(7);
    await submit(form);
    expect(actions.updateSalarySnapshotAction.mock.calls[0]?.[1].has("rrqContributionYtd")).toBe(false);
    await click(toggle);
    expect(dom.get<HTMLInputElement>('form.salary-inline-form [name="rrqContributionYtd"]').value).toBe("4000.00");
    expect(latestSnapshot.rrqContributionYtdMinor).toBe(400_000);
  });

  it("remembers the display preference per user and defaults new ledgers to hidden", async () => {
    window.localStorage.setItem("athena:salary-rrq-visibility:v1:test-user", "false");
    await dom.render(<SalariesManager preferenceScope="test-user" years={[year]} selectedYear={year} availableYears={[2026]} selectedTaxYear={2026} currentTaxYear={2026} />);
    expect(dom.container.querySelector(".rrq-tracker")).toBeNull();
    await click(dom.get<HTMLButtonElement>(".salary-rrq-preference button"));
    expect(window.localStorage.getItem("athena:salary-rrq-visibility:v1:test-user")).toBe("true");
    await dom.render(<SalariesManager preferenceScope="other-user" years={[]} selectedYear={null} availableYears={[2026]} selectedTaxYear={2026} currentTaxYear={2026} />);
    expect(dom.get<HTMLButtonElement>(".salary-rrq-preference button").getAttribute("aria-pressed")).toBe("false");
    expect(dom.container.textContent).toContain("Start tracking");
    await click(dom.get<HTMLButtonElement>(".salary-rrq-preference button"));
    expect(window.localStorage.getItem("athena:salary-rrq-visibility:v1:other-user")).toBe("true");
  });

  it("omits RRQ in new snapshot forms until enabled, including ledgers without observations", async () => {
    const noRrqYear = { ...year, snapshots: year.snapshots.map((snapshot) => ({ ...snapshot, rrqContributionYtdMinor: null })) };
    await dom.render(<SalariesManager preferenceScope="test-user" years={[noRrqYear]} selectedYear={noRrqYear} availableYears={[2026]} selectedTaxYear={2026} currentTaxYear={2026} />);
    const add = Array.from(dom.container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Add salary snapshot"))!;
    await click(add);
    expect(dom.container.querySelector("#salary-federal")).not.toBeNull();
    expect(dom.container.querySelector("#salary-rrq")).toBeNull();
    await click(dom.get<HTMLButtonElement>(".salary-rrq-preference button"));
    expect(dom.container.querySelector("#salary-rrq")).not.toBeNull();
    expect(actions.createSalarySnapshotAction).not.toHaveBeenCalled();
  });

  it("keeps zero-valued RRQ observations visible by default and honors same-user storage events", async () => {
    const zeroYear = { ...year, snapshots: year.snapshots.map((snapshot) => ({ ...snapshot, rrqContributionYtdMinor: 0 })) };
    await dom.render(<SalariesManager preferenceScope="test-user" years={[zeroYear]} selectedYear={zeroYear} availableYears={[2026]} selectedTaxYear={2026} currentTaxYear={2026} />);
    expect(dom.get<HTMLButtonElement>(".salary-rrq-preference button").getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      window.localStorage.setItem("athena:salary-rrq-visibility:v1:test-user", "false");
      window.dispatchEvent(new StorageEvent("storage", { key: "athena:salary-rrq-visibility:v1:test-user" }));
    });
    expect(dom.container.querySelector(".rrq-tracker")).toBeNull();
  });

  it("ignores malformed preferences and still toggles when browser storage is blocked", async () => {
    window.localStorage.setItem("athena:salary-rrq-visibility:v1:test-user", "invalid");
    await dom.render(<SalariesManager preferenceScope="test-user" years={[year]} selectedYear={year} availableYears={[2026]} selectedTaxYear={2026} currentTaxYear={2026} />);
    expect(dom.container.querySelector(".rrq-tracker")).not.toBeNull();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage blocked"); });
    await click(dom.get<HTMLButtonElement>(".salary-rrq-preference button"));
    expect(dom.container.querySelector(".rrq-tracker")).toBeNull();
    await click(dom.get<HTMLButtonElement>(".salary-rrq-preference button"));
    expect(dom.container.querySelector(".rrq-tracker")).not.toBeNull();
  });

  it("keeps snapshot update and delete feedback/actions attached to the selected row", async () => {
    await dom.render(<SalariesManager years={[year]} selectedYear={year} availableYears={[2025, 2026, 2027]} selectedTaxYear={2026} currentTaxYear={2026} />);
    const latestRow = dom.get<HTMLTableRowElement>('.salary-timeline-table tbody tr:not(.salary-edit-row)');
    await click(latestRow.querySelector<HTMLButtonElement>(".salary-row-actions button")!);
    const editRow = latestRow.nextElementSibling as HTMLTableRowElement | null;
    const updateForm = editRow?.querySelector<HTMLFormElement>("form.salary-inline-form");
    expect(updateForm?.querySelector<HTMLInputElement>('input[name="snapshotId"]')?.value).toBe(latestSnapshot.id);
    expect(updateForm?.querySelector<HTMLInputElement>('input[name="salaryYearId"]')?.value).toBe(year.id);
    await submit(updateForm!);

    expect(actions.updateSalarySnapshotAction).toHaveBeenCalledOnce();
    expect(actions.updateSalarySnapshotAction.mock.calls[0]?.[1].get("snapshotId")).toBe(latestSnapshot.id);
    expect(editRow?.querySelector('[role="status"]')?.textContent).toBe("Snapshot could not be saved.");
    const earlierRow = Array.from(dom.container.querySelectorAll<HTMLTableRowElement>('.salary-timeline-table tbody tr:not(.salary-edit-row)'))
      .find((row) => row.querySelector("th")?.textContent === earlierSnapshot.snapshotOn);
    expect(earlierRow?.querySelector('[role="status"]')).toBeNull();

    const deleteDetails = editRow?.querySelector<HTMLDetailsElement>("details.salary-delete-details");
    if (!deleteDetails) throw new Error("Missing snapshot-delete confirmation");
    const deleteSummary = deleteDetails.querySelector<HTMLElement>("summary");
    if (!deleteSummary) throw new Error("Missing snapshot-delete control");
    await click(deleteSummary);
    const deleteForm = deleteDetails?.querySelector<HTMLFormElement>("form.salary-confirm-popover");
    const acknowledgement = deleteForm?.querySelector<HTMLInputElement>('input[name="confirm"]');
    expect(acknowledgement?.required).toBe(true);
    expect(deleteForm?.querySelector<HTMLInputElement>('input[name="snapshotId"]')?.value).toBe(latestSnapshot.id);

    await submit(deleteForm!);
    expect(actions.deleteSalarySnapshotAction).not.toHaveBeenCalled();
    await click(acknowledgement!);
    await submit(deleteForm!);

    expect(actions.deleteSalarySnapshotAction).toHaveBeenCalledOnce();
    expect(actions.deleteSalarySnapshotAction.mock.calls[0]?.[1].get("snapshotId")).toBe(latestSnapshot.id);
    expect(deleteForm?.querySelector('[role="status"]')?.textContent).toBe("Snapshot could not be removed.");
    expect(earlierRow?.querySelector('[role="status"]')).toBeNull();
  });
});
