import { describe, expect, it } from "vitest";
import { buildSalariesHelpSnapshot } from "./presentation";

const baseInput = {
  salaryYearCount: 1,
  selectedTaxYear: 2026,
  currentTaxYear: 2026,
  hasSelectedYear: true,
  selectedYearStatus: "in_progress" as const,
  snapshotCount: 0,
  hasOfficialFederalTotal: false,
  hasRrqObservation: false,
};

describe("Salaries page help", () => {
  it("routes the selected tax-year setup to the right next action", () => {
    expect(buildSalariesHelpSnapshot({ ...baseInput, hasSelectedYear: false }).action).toEqual({ label: "Create salary year", href: "/salaries?year=2026" });
    expect(buildSalariesHelpSnapshot({ ...baseInput, selectedTaxYear: 2025, currentTaxYear: 2026, hasSelectedYear: false }).action).toEqual({ label: "Add finalized income", href: "/salaries?year=2025" });
    expect(buildSalariesHelpSnapshot(baseInput).action).toEqual({ label: "Add salary snapshot", href: "/salaries?year=2026" });
    expect(buildSalariesHelpSnapshot({ ...baseInput, selectedYearStatus: "finalized", snapshotCount: 10, hasOfficialFederalTotal: true, hasRrqObservation: true }).action).toEqual({ label: "Review salary ledger", href: "/salaries?year=2026" });
  });

  it("keeps the snapshot owner-safe and describes optional RRQ data without exposing amounts", () => {
    const snapshot = buildSalariesHelpSnapshot({ ...baseInput, salaryYearCount: 3, snapshotCount: 4, hasRrqObservation: true });

    expect(snapshot.items).toEqual([
      { label: "Salary years", value: "3" },
      { label: "Selected tax year", value: "2026" },
      { label: "Ledger status", value: "In progress" },
      { label: "Pay-stub snapshots", value: "4" },
      { label: "Official federal total", value: "Not recorded" },
      { label: "RRQ tracker", value: "Observed" },
    ]);
  });
});
