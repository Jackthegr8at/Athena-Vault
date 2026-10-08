import { SALARIES_PAGE_HELP_CONTENT, type PageHelpSnapshot, type SalariesPageHelpActionId } from "../components/page-help-content";

export type SalariesHelpYearStatus = "in_progress" | "finalized" | null;

export interface SalariesHelpSnapshotInput {
  readonly salaryYearCount: number;
  readonly selectedTaxYear: number;
  readonly currentTaxYear: number;
  readonly hasSelectedYear: boolean;
  readonly selectedYearStatus: SalariesHelpYearStatus;
  readonly snapshotCount: number;
  readonly hasOfficialFederalTotal: boolean;
  readonly hasRrqObservation: boolean;
}

const SALARIES_PAGE_HELP_ACTION_HREFS: Readonly<Record<SalariesPageHelpActionId, (input: SalariesHelpSnapshotInput) => string>> = {
  create: (input) => `/salaries?year=${input.selectedTaxYear}`,
  finalized: (input) => `/salaries?year=${input.selectedTaxYear}`,
  snapshot: (input) => `/salaries?year=${input.selectedTaxYear}`,
  review: (input) => `/salaries?year=${input.selectedTaxYear}`,
};

function ledgerStatus(input: SalariesHelpSnapshotInput): string {
  if (!input.hasSelectedYear) return "Not started";
  return input.selectedYearStatus === "finalized" ? "Finalized" : "In progress";
}

function rrqStatus(input: SalariesHelpSnapshotInput): string {
  if (!input.hasSelectedYear) return "Not started";
  return input.hasRrqObservation ? "Observed" : "Needs observation";
}

export function buildSalariesHelpSnapshot(input: SalariesHelpSnapshotInput): PageHelpSnapshot {
  let actionId: SalariesPageHelpActionId;
  if (!input.hasSelectedYear) actionId = input.selectedTaxYear < input.currentTaxYear ? "finalized" : "create";
  else if (input.selectedYearStatus === "in_progress") actionId = "snapshot";
  else actionId = "review";

  return {
    items: [
      { label: SALARIES_PAGE_HELP_CONTENT.snapshotLabels.salaryYears, value: String(input.salaryYearCount) },
      { label: SALARIES_PAGE_HELP_CONTENT.snapshotLabels.selectedYear, value: String(input.selectedTaxYear) },
      { label: SALARIES_PAGE_HELP_CONTENT.snapshotLabels.ledgerStatus, value: ledgerStatus(input) },
      { label: SALARIES_PAGE_HELP_CONTENT.snapshotLabels.payStubSnapshots, value: String(input.snapshotCount) },
      { label: SALARIES_PAGE_HELP_CONTENT.snapshotLabels.officialFederalTotal, value: input.hasOfficialFederalTotal ? "Recorded" : "Not recorded" },
      { label: SALARIES_PAGE_HELP_CONTENT.snapshotLabels.rrqTracker, value: rrqStatus(input) },
    ],
    action: {
      label: SALARIES_PAGE_HELP_CONTENT.actionLabels[actionId],
      href: SALARIES_PAGE_HELP_ACTION_HREFS[actionId](input),
    },
  };
}
