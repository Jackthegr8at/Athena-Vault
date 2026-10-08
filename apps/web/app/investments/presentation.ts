import type { InvestmentProjectionProjectView } from "@athena/database";
import { INVESTMENTS_PAGE_HELP_CONTENT, type InvestmentsPageHelpActionId, type PageHelpSnapshot } from "../components/page-help-content";

type InvestmentsHelpProject = Pick<InvestmentProjectionProjectView, "mode" | "accountCount"> & {
  readonly accountSchedules: readonly unknown[];
  readonly rates: readonly unknown[];
  readonly warnings: readonly unknown[];
};

export interface InvestmentsHelpSnapshotInput {
  readonly projects: readonly InvestmentsHelpProject[];
  readonly investmentAccountCount: number;
  readonly rdspAccountCount?: number;
  readonly holdingCount?: number;
}

export function buildInvestmentsHelpSnapshot(input: InvestmentsHelpSnapshotInput): PageHelpSnapshot {
  const calculatorPlans = input.projects.filter((project) => project.mode === "calculator");
  const portfolioPlans = input.projects.filter((project) => project.mode === "portfolio");
  const contributionSchedules = portfolioPlans.reduce((total, project) => total + project.accountSchedules.length, 0);
  const plansNeedingReview = input.projects.filter((project) => project.warnings.length > 0);
  const rdspAccountCount = input.rdspAccountCount ?? 0;
  const holdingCount = input.holdingCount ?? 0;

  let actionId: InvestmentsPageHelpActionId;
  if (input.projects.length === 0) actionId = "create";
  else if (portfolioPlans.some((project) => project.accountCount === 0) || (portfolioPlans.length > 0 && input.investmentAccountCount === 0)) actionId = "accounts";
  else if (portfolioPlans.some((project) => project.accountSchedules.length === 0)) actionId = "schedules";
  else actionId = "review";

  return {
    items: [
      { label: INVESTMENTS_PAGE_HELP_CONTENT.snapshotLabels.rdspAccounts, value: String(rdspAccountCount) },
      { label: INVESTMENTS_PAGE_HELP_CONTENT.snapshotLabels.holdings, value: String(holdingCount) },
      { label: INVESTMENTS_PAGE_HELP_CONTENT.snapshotLabels.projectionProjects, value: String(input.projects.length) },
      { label: INVESTMENTS_PAGE_HELP_CONTENT.snapshotLabels.calculatorPlans, value: String(calculatorPlans.length) },
      { label: INVESTMENTS_PAGE_HELP_CONTENT.snapshotLabels.portfolioPlans, value: String(portfolioPlans.length) },
      { label: INVESTMENTS_PAGE_HELP_CONTENT.snapshotLabels.investmentAccounts, value: String(input.investmentAccountCount) },
      { label: INVESTMENTS_PAGE_HELP_CONTENT.snapshotLabels.contributionSchedules, value: String(contributionSchedules) },
      { label: INVESTMENTS_PAGE_HELP_CONTENT.snapshotLabels.plansNeedingReview, value: String(plansNeedingReview.length) },
    ],
    action: {
      label: INVESTMENTS_PAGE_HELP_CONTENT.actionLabels[actionId],
      href: actionId === "accounts" ? "/accounts" : "/investments",
    },
  };
}
