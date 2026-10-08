import type { AnnualMaintenanceSummaryView, HouseholdExpenseView } from "@athena/database";
import { HOME_PAGE_HELP_CONTENT, type HomePageHelpActionId, type PageHelpSnapshot } from "../components/page-help-content";

export interface HouseholdPresentation {
  readonly displayedExpenses: readonly HouseholdExpenseView[];
  readonly monthlyMinor: number;
  readonly biweeklyMinor: number;
  readonly annualMinor: number;
}

export interface HomeFirstUseInput {
  readonly hasHome: boolean;
  readonly activeExpenseCount: number;
  readonly maintenanceItemCount: number;
  readonly liabilityCount: number;
  readonly hasActiveHouseholdCashFlowLink: boolean;
}

export function shouldShowHomeFirstUse(input: HomeFirstUseInput): boolean {
  return !input.hasHome
    && input.activeExpenseCount === 0
    && input.maintenanceItemCount === 0
    && input.liabilityCount === 0
    && !input.hasActiveHouseholdCashFlowLink;
}

export interface HomeHelpSnapshotInput {
  readonly hasHome: boolean;
  readonly propertyValueCount: number;
  readonly activeExpenseCount: number;
  readonly maintenanceItemCount: number;
  readonly hasActiveHouseholdCashFlowLink: boolean;
}

const HOME_PAGE_HELP_ACTION_HREFS: Readonly<Record<HomePageHelpActionId, string>> = {
  home: "/home",
  property: "/home",
  expense: "/home",
  cashFlow: "/home",
  review: "/home",
};

export function buildHomeHelpSnapshot(input: HomeHelpSnapshotInput): PageHelpSnapshot {
  let actionId: HomePageHelpActionId;
  if (!input.hasHome) actionId = "home";
  else if (input.propertyValueCount === 0) actionId = "property";
  else if (input.activeExpenseCount === 0) actionId = "expense";
  else if (!input.hasActiveHouseholdCashFlowLink) actionId = "cashFlow";
  else actionId = "review";

  return {
    items: [
      { label: HOME_PAGE_HELP_CONTENT.snapshotLabels.homeProfile, value: input.hasHome ? "Configured" : "Not configured" },
      { label: HOME_PAGE_HELP_CONTENT.snapshotLabels.propertyValue, value: input.propertyValueCount > 0 ? "Recorded" : "Not recorded" },
      { label: HOME_PAGE_HELP_CONTENT.snapshotLabels.activeExpenses, value: String(input.activeExpenseCount) },
      { label: HOME_PAGE_HELP_CONTENT.snapshotLabels.maintenanceItems, value: String(input.maintenanceItemCount) },
      { label: HOME_PAGE_HELP_CONTENT.snapshotLabels.cashFlowLink, value: input.hasActiveHouseholdCashFlowLink ? "Connected" : "Not connected" },
    ],
    action: {
      label: HOME_PAGE_HELP_CONTENT.actionLabels[actionId],
      href: HOME_PAGE_HELP_ACTION_HREFS[actionId],
    },
  };
}

const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function roundHalfUpDivide(numerator: number, divisor: number): number {
  const value = BigInt(numerator);
  const bigDivisor = BigInt(divisor);
  if (bigDivisor <= 0n) throw new RangeError("Divisor must be a positive integer.");
  const sign = value < 0n ? -1n : 1n;
  const magnitude = value < 0n ? -value : value;
  const roundedMagnitude = (2n * magnitude + bigDivisor) / (2n * bigDivisor);
  const rounded = sign * roundedMagnitude;
  if (rounded > MAX_SAFE_INTEGER_BIGINT || rounded < -MAX_SAFE_INTEGER_BIGINT) {
    throw new RangeError("Divided amount is outside the safe integer range.");
  }
  return Number(rounded);
}

export function buildHouseholdPresentation(
  expenses: readonly HouseholdExpenseView[],
  maintenanceSummary: AnnualMaintenanceSummaryView | null,
): HouseholdPresentation {
  const activeExpenses = expenses.filter((expense) => expense.isActive);
  const maintenanceExpense = activeExpenses.find((expense) => expense.category === "annual-maintenance" && expense.name === "Annual maintenance");
  const ordinaryExpenses = activeExpenses.filter((expense) => expense.category !== "annual-maintenance");
  const summaryExpense = maintenanceExpense && maintenanceSummary
    ? { ...maintenanceExpense, amountMinor: maintenanceSummary.amountMinor, annualAmountMinor: maintenanceSummary.annualAmountMinor, frequency: "monthly" as const, name: "Annual maintenance", category: "annual-maintenance" }
    : maintenanceExpense;
  const displayedExpenses = [...ordinaryExpenses, ...(summaryExpense ? [summaryExpense] : [])].sort((left, right) => left.name.localeCompare(right.name));
  const annualMinor = ordinaryExpenses.reduce((sum, expense) => sum + expense.annualAmountMinor, 0) + (maintenanceSummary?.annualAmountMinor ?? maintenanceExpense?.annualAmountMinor ?? 0);
  return {
    displayedExpenses,
    monthlyMinor: roundHalfUpDivide(annualMinor, 12),
    biweeklyMinor: roundHalfUpDivide(annualMinor, 26),
    annualMinor,
  };
}
