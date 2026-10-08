import type { AnnualExpenseOccurrencePresentation } from "./annual-expense-manager";
import { ANNUAL_EXPENSES_PAGE_HELP_CONTENT, type AnnualExpensesPageHelpActionId, type PageHelpSnapshot } from "../components/page-help-content";

type AnnualExpensesHelpBudget = {
  readonly isActive: boolean;
  readonly items: readonly {
    readonly isActive: boolean;
    readonly occurrence: Pick<AnnualExpenseOccurrencePresentation, "status">;
  }[];
};

export interface AnnualExpensesHelpSnapshotInput {
  readonly taxYear: number;
  readonly budgets: readonly AnnualExpensesHelpBudget[];
  readonly forecastCount: number;
  readonly eligibleAccountCount: number;
}

type AnnualExpensesStaticPageHelpActionId = Exclude<AnnualExpensesPageHelpActionId, "budget">;

const ANNUAL_EXPENSES_PAGE_HELP_ACTION_HREFS: Readonly<Record<AnnualExpensesStaticPageHelpActionId, string>> = {
  account: "/accounts",
  expense: "/annual-expenses#annual-template-panel",
  payment: "/annual-expenses",
  forecast: "/annual-expenses",
  review: "/annual-expenses",
};

export function buildAnnualExpensesHelpSnapshot(input: AnnualExpensesHelpSnapshotInput): PageHelpSnapshot {
  const activeBudgets = input.budgets.filter((budget) => budget.isActive);
  const activeItems = activeBudgets.flatMap((budget) => budget.items.filter((item) => item.isActive));
  const archivedBudgets = input.budgets.length - activeBudgets.length;
  const expensesNeedingPayment = activeItems.filter((item) => item.occurrence.status === "Unpaid" || item.occurrence.status === "Partially paid");

  let actionId: AnnualExpensesPageHelpActionId;
  if (activeBudgets.length === 0 && input.eligibleAccountCount === 0) actionId = "account";
  else if (activeBudgets.length === 0) actionId = "budget";
  else if (activeItems.length === 0) actionId = "expense";
  else if (expensesNeedingPayment.length > 0) actionId = "payment";
  else if (input.forecastCount < activeBudgets.length) actionId = "forecast";
  else actionId = "review";

  const actionHref = actionId === "budget"
    ? input.budgets.length === 0
      ? "/annual-expenses#annual-expenses-first-budget-heading"
      : "/annual-expenses#annual-budget-management-title"
    : ANNUAL_EXPENSES_PAGE_HELP_ACTION_HREFS[actionId];

  return {
    items: [
      { label: ANNUAL_EXPENSES_PAGE_HELP_CONTENT.snapshotLabels.planningYear, value: String(input.taxYear) },
      { label: ANNUAL_EXPENSES_PAGE_HELP_CONTENT.snapshotLabels.activeBudgets, value: String(activeBudgets.length) },
      { label: ANNUAL_EXPENSES_PAGE_HELP_CONTENT.snapshotLabels.archivedBudgets, value: String(archivedBudgets) },
      { label: ANNUAL_EXPENSES_PAGE_HELP_CONTENT.snapshotLabels.activeExpenses, value: String(activeItems.length) },
      { label: ANNUAL_EXPENSES_PAGE_HELP_CONTENT.snapshotLabels.expensesNeedingPayment, value: String(expensesNeedingPayment.length) },
      { label: ANNUAL_EXPENSES_PAGE_HELP_CONTENT.snapshotLabels.forecasts, value: `${input.forecastCount}/${activeBudgets.length}` },
      { label: ANNUAL_EXPENSES_PAGE_HELP_CONTENT.snapshotLabels.availableFundingAccounts, value: String(input.eligibleAccountCount) },
    ],
    action: {
      label: ANNUAL_EXPENSES_PAGE_HELP_CONTENT.actionLabels[actionId],
      href: actionHref,
    },
  };
}
