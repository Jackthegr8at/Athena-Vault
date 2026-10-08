import { OVERVIEW_PAGE_HELP_CONTENT, type OverviewPageHelpActionId, type PageHelpSnapshot } from "./components/page-help-content";

export interface OverviewHelpSnapshotInput {
  readonly activeAccountCount: number;
  readonly totalPeriodCount: number;
  readonly hasCurrentBalance: boolean;
  readonly hasActiveRecurringMovement: boolean;
  readonly hasHomeProfile: boolean;
}

const OVERVIEW_PAGE_HELP_ACTION_HREFS: Readonly<Record<OverviewPageHelpActionId, string>> = {
  account: "/accounts",
  timeline: "/cash-flow",
  balance: "/accounts",
  recurring: "/cash-flow/recurring?first=1",
  projection: "/cash-flow",
};

export function buildOverviewHelpSnapshot(input: OverviewHelpSnapshotInput): PageHelpSnapshot {
  let actionId: OverviewPageHelpActionId;
  if (input.activeAccountCount === 0) actionId = "account";
  else if (input.totalPeriodCount === 0) actionId = "timeline";
  else if (!input.hasCurrentBalance) actionId = "balance";
  else if (!input.hasActiveRecurringMovement) actionId = "recurring";
  else actionId = "projection";

  return {
    items: [
      { label: OVERVIEW_PAGE_HELP_CONTENT.snapshotLabels.activeAccounts, value: String(input.activeAccountCount) },
      { label: OVERVIEW_PAGE_HELP_CONTENT.snapshotLabels.payPeriods, value: String(input.totalPeriodCount) },
      { label: OVERVIEW_PAGE_HELP_CONTENT.snapshotLabels.currentBalance, value: input.hasCurrentBalance ? "Recorded" : "Not recorded" },
      { label: OVERVIEW_PAGE_HELP_CONTENT.snapshotLabels.recurringMovement, value: input.hasActiveRecurringMovement ? "Added" : "Not added" },
      { label: OVERVIEW_PAGE_HELP_CONTENT.snapshotLabels.homeProfile, value: input.hasHomeProfile ? "Configured" : "Optional" },
    ],
    action: {
      label: OVERVIEW_PAGE_HELP_CONTENT.actionLabels[actionId],
      href: OVERVIEW_PAGE_HELP_ACTION_HREFS[actionId],
    },
  };
}
