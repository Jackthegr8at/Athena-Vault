import "./annual-expenses.css";
import {
  addIsoDays,
  getAnnualExpensesReadModel,
  occurrencesBetween,
  toTorontoDateIso,
  withDatabaseObservation,
  type AccountTimelineAccountView,
  type AnnualBudgetSummary,
} from "@athena/database";
import { projectAnnualBudget, type AnnualBudgetProjection } from "@athena/finance-engine";
import { preload } from "react-dom";
import { CalendarDays, Target, Wallet } from "lucide-react";
import { ModulePage } from "../components/module-page";
import { ModuleFirstUseCard } from "../components/module-first-use-card";
import { AnimatedLineBackground } from "../components/animated-line-background";
import { ANNUAL_EXPENSES_PAGE_HELP_CONTENT } from "../components/page-help-content";
import { withAuthenticatedPageDatabase } from "../../lib/server/owner-database";
import { hasPageHelpSeen } from "../../lib/server/page-help";
import { AnnualExpenseManager, type AnnualBudgetAccountSummaryPresentation, type AnnualBudgetForecastPresentation, type AnnualBudgetPresentation, type AnnualExpenseItemPresentation, type AnnualExpenseOccurrencePresentation } from "./annual-expense-manager";
import { buildAnnualExpensesHelpSnapshot } from "./presentation";

export const dynamic = "force-dynamic";

interface AnnualExpensesSearchParams {
  readonly year?: string | string[];
}


function occurrencePresentation(occurrence: AnnualBudgetSummary["budgets"][number]["items"][number]["occurrence"]): AnnualExpenseOccurrencePresentation {
  return {
    id: occurrence.id,
    taxYear: occurrence.taxYear,
    budgetId: occurrence.budgetId,
    plannedAmountMinor: occurrence.plannedAmountMinor,
    dueDate: occurrence.dueDate,
    amountOverrideMinor: occurrence.amountOverrideMinor,
    note: occurrence.note,
    paidMinor: occurrence.paidMinor,
    remainingMinor: occurrence.remainingMinor,
    varianceMinor: occurrence.varianceMinor,
    status: occurrence.status,
    payments: occurrence.payments.map((payment) => ({ id: payment.id, paymentOn: payment.paymentOn, amountMinor: payment.amountMinor, note: payment.note })),
  };
}

function itemPresentation(item: AnnualBudgetSummary["budgets"][number]["items"][number]): AnnualExpenseItemPresentation {
  return {
    id: item.id,
    budgetId: item.budgetId,
    name: item.name,
    amountMinor: item.amountMinor,
    dueMonth: item.dueMonth,
    dueDay: item.dueDay,
    isActive: item.isActive,
    occurrence: occurrencePresentation(item.occurrence),
    history: item.history.map(occurrencePresentation),
  };
}

function budgetPresentation(budget: AnnualBudgetSummary["budgets"][number]): AnnualBudgetPresentation {
  return {
    id: budget.id,
    name: budget.name,
    linkedAccountId: budget.linkedAccountId,
    linkedAccountName: budget.linkedAccountName,
    isActive: budget.isActive,
    displayOrder: budget.displayOrder,
    itemCount: budget.itemCount,
    totalPlannedMinor: budget.totalPlannedMinor,
    totalPaidMinor: budget.totalPaidMinor,
    totalRemainingMinor: budget.totalRemainingMinor,
    items: budget.items.map(itemPresentation),
  };
}

function projectionForBudget(
  budget: AnnualBudgetSummary["budgets"][number],
  account: AccountTimelineAccountView | undefined,
  taxYear: number,
  todayIso: string,
  summaries: readonly AnnualBudgetSummary[],
): AnnualBudgetProjection | null {
  if (!account) return null;
  const yearStart = `${taxYear}-01-01`;
  const forecastEnd = `${taxYear}-12-31`;
  const actualSnapshots = account.snapshots.filter((snapshot) => snapshot.status === "actual").sort((left, right) => left.asOf.localeCompare(right.asOf));
  const anchor = [...actualSnapshots].reverse().find((snapshot) => snapshot.asOf <= todayIso);
  if (!anchor || anchor.asOf > forecastEnd) return null;
  const forecastStart = anchor.asOf > yearStart ? anchor.asOf : yearStart;
  const contributions = account.contributionRules.flatMap((rule) => occurrencesBetween(rule, addIsoDays(anchor.asOf, 1), forecastEnd).flatMap((occurredOn) => {
    const exception = rule.exceptions.find((candidate) => candidate.occurrenceOn === occurredOn);
    if (exception?.kind === "skip") return [];
    return [{ id: `${rule.id}:${occurredOn}`, occurredOn, amountMinor: exception?.kind === "override" ? (exception.amountMinor ?? 0) : rule.amountMinor }];
  }));
  const occurrences = summaries.flatMap((summary) => {
    const yearBudget = summary.budgets.find((candidate) => candidate.id === budget.id);
    return yearBudget?.items.filter((item) => item.isActive).map((item) => ({
      id: item.occurrence.id ?? `${item.id}:${summary.taxYear}`,
      name: item.name,
      plannedAmountMinor: item.occurrence.plannedAmountMinor,
      dueDate: item.occurrence.dueDate ?? `${summary.taxYear}-12-31`,
      payments: item.occurrence.payments.map((payment) => ({ id: payment.id, paymentOn: payment.paymentOn, amountMinor: payment.amountMinor })),
    })) ?? [];
  });
  return projectAnnualBudget({
    budgetId: budget.id,
    forecastStart,
    forecastEnd,
    anchor: { asOf: anchor.asOf, balanceMinor: anchor.balanceMinor },
    contributions,
    occurrences,
  });
}

function forecastPresentation(budgetId: string, projection: AnnualBudgetProjection | null): AnnualBudgetForecastPresentation | null {
  return projection ? {
    budgetId,
    yearEndBalanceMinor: projection.yearEndBalanceMinor,
    lowestBalanceMinor: projection.lowestBalanceMinor,
    lowestBalanceOn: projection.lowestBalanceOn,
    hasNegativeFunding: projection.hasNegativeFunding,
    eventCount: projection.events.length,
  } : null;
}

function AnnualPlanningHero({
  taxYear,
  activeItemCount,
  activeBudgetCount,
  forecastCount,
}: {
  readonly taxYear: number;
  readonly activeItemCount: number;
  readonly activeBudgetCount: number;
  readonly forecastCount: number;
}) {
  return <section className="annual-planning-hero" aria-labelledby="annual-planning-title">
    <AnimatedLineBackground lineCount={9} opacity={0.55} speed={18} scale={1.18} strokeWidth={1.15} density={1.05} drift={0.22} waveAmplitude={36} pulseStrength={0.78} direction="left-to-right" color="#61452d" accentColor="#976c3c" seed="annual-planning" className="animated-line-background--annual-planning" />
    <div className="annual-planning-content">
      <p className="eyebrow"><span className="font-numeric">{taxYear}</span> annual planning</p>
      <h1 id="annual-planning-title"><span className="font-numeric">{taxYear}</span> annual planning</h1>
      <div className="annual-planning-active"><strong>{activeItemCount}</strong><span>active yearly expenses</span></div>
      <p>Track and manage planned expenses across your funding envelopes with confidence and clarity.</p>
    </div>
    <div className="annual-planning-stats">
      <div className="annual-planning-stat"><span className="annual-planning-stat-icon"><Wallet aria-hidden="true" size={16} strokeWidth={1.8} /></span><span><strong>{activeBudgetCount}</strong><small>budgets</small></span></div>
      <div className="annual-planning-stat"><span className="annual-planning-stat-icon"><Target aria-hidden="true" size={16} strokeWidth={1.8} /></span><span><strong>{forecastCount}/{activeBudgetCount}</strong><small>forecast anchors</small></span></div>
      <div className="annual-planning-stat"><span className="annual-planning-stat-icon"><CalendarDays aria-hidden="true" size={16} strokeWidth={1.8} /></span><span><strong>{taxYear}</strong><small>planning year</small></span></div>
    </div>
  </section>;
}

export default async function AnnualExpensesPage({ searchParams }: { readonly searchParams?: Promise<AnnualExpensesSearchParams> }) {
  preload("/brand/athena-vault-background-expenses.svg", { as: "image" });
  preload("/brand/backgrounds/annual-expenses.png", { as: "image" });
  const params = searchParams ? await searchParams : {};
  const todayIso = toTorontoDateIso();
  const year = Array.isArray(params.year) ? params.year[0] : params.year;
  const { eligibleAccounts, years, taxYear, summary, projectionSummaries, timeline, pageHelpSeen } = await withDatabaseObservation("annual-expenses-page", async () => {
    return await withAuthenticatedPageDatabase(async (database, user) => {
      const [readModel, pageHelpSeen] = await Promise.all([
        getAnnualExpensesReadModel(database, user.owner.id, year, todayIso),
        hasPageHelpSeen(database, user, ANNUAL_EXPENSES_PAGE_HELP_CONTENT.pageId),
      ]);
      return { ...readModel, pageHelpSeen };
    }, { requireTwoFactor: true });
  });
  const budgetAccounts: readonly AnnualBudgetAccountSummaryPresentation[] = summary.budgets.map((budget) => {
    const account = timeline.accounts.find((candidate) => candidate.id === budget.linkedAccountId);
    const actual = [...(account?.snapshots ?? [])].reverse().find((snapshot) => snapshot.status === "actual" && snapshot.asOf <= todayIso);
    return {
      budgetId: budget.id,
      actualBalanceMinor: actual?.balanceMinor ?? null,
      actualAsOf: actual?.asOf ?? null,
      recurringPayments: (account?.contributionRules ?? []).filter((rule) => rule.isEnabled).map((rule) => ({ amountMinor: rule.amountMinor, frequency: rule.frequency })),
    };
  });
  const forecasts = summary.budgets.filter((budget) => budget.isActive).map((budget) => forecastPresentation(budget.id, projectionForBudget(budget, timeline.accounts.find((account) => account.id === budget.linkedAccountId), taxYear, todayIso, projectionSummaries))).filter((forecast): forecast is AnnualBudgetForecastPresentation => forecast !== null);
  const budgets = summary.budgets.map(budgetPresentation);
  const activeItems = budgets.filter((budget) => budget.isActive).reduce((total, budget) => total + budget.itemCount, 0);
  const annualExpensesHelp = {
    content: ANNUAL_EXPENSES_PAGE_HELP_CONTENT,
    snapshot: buildAnnualExpensesHelpSnapshot({
      taxYear,
      budgets,
      forecastCount: forecasts.length,
      eligibleAccountCount: eligibleAccounts.length,
    }),
  };

  if (budgets.length === 0 && eligibleAccounts.length === 0) {
    return <ModulePage active="Annual expenses" mainClassName="annual-expenses-page editorial-module-page" eyebrow="Annual budgets" title="Annual expenses" subtitle="Owner-managed funding envelopes with auditable yearly values, payments, and forecasts." help={annualExpensesHelp} pageHelpSeen={pageHelpSeen}>
      <ModuleFirstUseCard headingId="annual-expenses-first-account-heading" title="Add an account before planning expenses" description="Annual expenses need an active, unassigned funding account. Add one in Accounts, then come back to create your first budget." actionHref="/accounts" actionLabel="Add account" supportingText="Account → annual budget → planned expense" seed="annual-expenses-first-account" />
    </ModulePage>;
  }
  const isFirstUse = budgets.length === 0;

  return <ModulePage active="Annual expenses" mainClassName="annual-expenses-page editorial-module-page" eyebrow="Annual budgets" title="Annual expenses" subtitle="Owner-managed funding envelopes with auditable yearly values, payments, and forecasts." help={annualExpensesHelp} pageHelpSeen={pageHelpSeen}>
    {!isFirstUse ? <AnnualPlanningHero taxYear={taxYear} activeItemCount={activeItems} activeBudgetCount={budgets.filter((budget) => budget.isActive).length} forecastCount={forecasts.length} /> : null}
    <AnnualExpenseManager taxYear={taxYear} todayIso={todayIso} availableYears={years} budgets={budgets} forecasts={forecasts} budgetAccounts={budgetAccounts} eligibleAccounts={eligibleAccounts} firstUse={isFirstUse} />
  </ModulePage>;
}
