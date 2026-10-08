import type { Database } from "../client";
import { accounts } from "../drizzle-schema";
import { createAccountRepository } from "../drizzle-repositories";
import { createAnnualExpenseRepository, type AnnualExpenseSummary } from "../repositories/annual-expenses";
import { createCashFlowRepository, type CashFlowPeriodData, type CashFlowPeriodView, type CashFlowPeriodWindow } from "../repositories/cash-flow";
import { toTorontoDateIso } from "../account-timeline";
import { createHomeRepository, type HomeView } from "../home";
import { createInvestmentRepository, type InvestmentAccountView, type InvestmentScenarioView } from "../repositories/investment";
import { createNetWorthHistoryRepository } from "../net-worth-history";
import { addNetWorthHistoryMonths, isValidNetWorthHistoryIsoDate, NET_WORTH_HISTORY_DEFAULT_PROJECTED_MONTHS, type NetWorthHistoryModel } from "@athena/finance-engine";

export interface DashboardAccountView {
  readonly id: string;
  readonly name: string;
  readonly institution: string;
  readonly kind: (typeof accounts.$inferSelect)["kind"];
  readonly currency: (typeof accounts.$inferSelect)["currency"];
  readonly includeInAvailableCash: boolean;
  readonly asOf: string | null;
  readonly balanceMinor: number | null;
  readonly isActive: boolean;
}

export interface InvestmentSummaryView {
  readonly accounts: readonly InvestmentAccountView[];
  readonly scenarios: readonly InvestmentScenarioView[];
  readonly currentValueMinor: number;
  readonly monthlyContributionMinor: number;
}

export interface DashboardReadModel {
  readonly periodWindow: CashFlowPeriodWindow;
  readonly upcomingPeriods: readonly CashFlowPeriodData[];
  readonly annual: AnnualExpenseSummary;
  readonly investments: InvestmentSummaryView;
  readonly accounts: readonly DashboardAccountView[];
  readonly home: HomeView | null;
  readonly netWorthHistory: NetWorthHistoryModel;
}

const DASHBOARD_PAST_PERIODS = 2;
const DASHBOARD_FUTURE_PERIODS = 3;
const DASHBOARD_UPCOMING_LIMIT = 4;

/**
 * Rebuilds `cashFlow.listUpcoming(ownerId, asOfIso)` from the already-fetched
 * period list and window. Returns null when the window cannot prove it holds
 * every period the upcoming list needs, so the caller can fall back to the
 * batched `listUpcoming` repository call.
 */
function upcomingPeriodsFromWindow(
  periods: readonly CashFlowPeriodView[],
  periodWindow: CashFlowPeriodWindow,
  asOfIso: string,
): readonly CashFlowPeriodData[] | null {
  const upcomingById = new Map(periodWindow.periods.map((entry) => [entry.period.id, entry] as const));
  const upcoming: CashFlowPeriodData[] = [];
  for (const period of periods) {
    if (period.endsOn < asOfIso) continue;
    const data = upcomingById.get(period.id);
    if (!data) return null;
    upcoming.push(data);
    if (upcoming.length >= DASHBOARD_UPCOMING_LIMIT) break;
  }
  return upcoming;
}

export async function getDashboardReadModel(
  database: Database,
  ownerId: string,
  asOfIso: string,
): Promise<DashboardReadModel> {
  const cashFlow = createCashFlowRepository(database);
  const accountRepository = createAccountRepository(database);
  const annualRepository = createAnnualExpenseRepository(database);
  const investmentRepository = createInvestmentRepository(database);
  const homeRepository = createHomeRepository(database);
  const netWorthHistoryRepository = createNetWorthHistoryRepository(database);

  const forecastThrough = isValidNetWorthHistoryIsoDate(asOfIso)
    ? addNetWorthHistoryMonths(asOfIso, NET_WORTH_HISTORY_DEFAULT_PROJECTED_MONTHS)
    : undefined;
  const todayIso = toTorontoDateIso();
  const homeTimelineThrough = forecastThrough === undefined
    ? undefined
    : forecastThrough >= todayIso ? forecastThrough : todayIso;
  const cashFlowPeriodsPromise = cashFlow.listPeriods(ownerId);
  const homePromise = homeTimelineThrough === undefined
    ? homeRepository.getHome(ownerId)
    : homeRepository.getHome(ownerId, { timelineThrough: homeTimelineThrough });
  const [periods, periodWindow, annual, investments, accounts, home, netWorthHistory] = await Promise.all([
    cashFlowPeriodsPromise,
    cashFlow.getPeriodWindow(ownerId, { asOfIso, pastPeriods: DASHBOARD_PAST_PERIODS, futurePeriods: DASHBOARD_FUTURE_PERIODS }, cashFlowPeriodsPromise),
    annualRepository.getSummary(ownerId),
    investmentRepository.getSummary(ownerId),
    accountRepository.listWithLatestBalances(ownerId, asOfIso),
    homePromise,
    netWorthHistoryRepository.getHistory(ownerId, {
      evaluationDate: asOfIso,
      preloaded: { home: homePromise, periods: cashFlowPeriodsPromise },
    }),
  ]);
  const upcomingPeriods = upcomingPeriodsFromWindow(periods, periodWindow, asOfIso)
    ?? await cashFlow.listUpcoming(ownerId, asOfIso, DASHBOARD_UPCOMING_LIMIT, periods);

  return {
    periodWindow,
    upcomingPeriods,
    annual,
    investments,
    accounts,
    home,
    netWorthHistory,
  };
}
