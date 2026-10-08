import type { RecurringCashFlowSeriesView } from "@athena/database";
import { RECURRING_PAYMENTS_PAGE_HELP_CONTENT, type PageHelpSnapshot, type RecurringPaymentsPageHelpActionId } from "../components/page-help-content";

type RecurringPaymentsHelpSeries = Pick<RecurringCashFlowSeriesView, "id" | "state"> & {
  readonly versions: readonly unknown[];
  readonly exceptions: readonly { readonly isActive: boolean }[];
};

export interface RecurringPaymentsHelpSnapshotInput {
  readonly series: readonly RecurringPaymentsHelpSeries[];
  readonly accountCount: number;
  readonly periodCount: number;
}

const RECURRING_PAYMENTS_PAGE_HELP_ACTION_HREFS: Readonly<Record<RecurringPaymentsPageHelpActionId, string>> = {
  account: "/accounts",
  income: "/cash-flow/recurring#recurring-create",
  exceptions: "/cash-flow/recurring",
  review: "/cash-flow/recurring",
};

export function buildRecurringPaymentsHelpSnapshot(input: RecurringPaymentsHelpSnapshotInput): PageHelpSnapshot {
  const activeSchedules = input.series.filter((entry) => entry.state !== "ended");
  const pausedSchedules = input.series.filter((entry) => entry.state === "paused");
  const endedSchedules = input.series.filter((entry) => entry.state === "ended");
  const scheduleVersions = input.series.reduce((total, entry) => total + entry.versions.length, 0);
  const activeExceptions = input.series.reduce((total, entry) => total + entry.exceptions.filter((exception) => exception.isActive).length, 0);
  const exceptionSeries = activeSchedules.find((entry) => entry.exceptions.some((exception) => exception.isActive)) ?? null;

  let actionId: RecurringPaymentsPageHelpActionId;
  if (input.accountCount === 0) actionId = "account";
  else if (activeSchedules.length === 0) actionId = "income";
  else if (activeExceptions > 0) actionId = "exceptions";
  else actionId = "review";

  const actionHref = actionId === "exceptions" && exceptionSeries
    ? `/cash-flow/recurring#recurring-series-${exceptionSeries.id}`
    : RECURRING_PAYMENTS_PAGE_HELP_ACTION_HREFS[actionId];

  return {
    items: [
      { label: RECURRING_PAYMENTS_PAGE_HELP_CONTENT.snapshotLabels.availableAccounts, value: String(input.accountCount) },
      { label: RECURRING_PAYMENTS_PAGE_HELP_CONTENT.snapshotLabels.activeSchedules, value: String(activeSchedules.length) },
      { label: RECURRING_PAYMENTS_PAGE_HELP_CONTENT.snapshotLabels.pausedSchedules, value: String(pausedSchedules.length) },
      { label: RECURRING_PAYMENTS_PAGE_HELP_CONTENT.snapshotLabels.endedSchedules, value: String(endedSchedules.length) },
      { label: RECURRING_PAYMENTS_PAGE_HELP_CONTENT.snapshotLabels.scheduleVersions, value: String(scheduleVersions) },
      { label: RECURRING_PAYMENTS_PAGE_HELP_CONTENT.snapshotLabels.activeExceptions, value: String(activeExceptions) },
      { label: RECURRING_PAYMENTS_PAGE_HELP_CONTENT.snapshotLabels.cashFlowPeriods, value: String(input.periodCount) },
    ],
    action: {
      label: RECURRING_PAYMENTS_PAGE_HELP_CONTENT.actionLabels[actionId],
      href: actionHref,
    },
  };
}
