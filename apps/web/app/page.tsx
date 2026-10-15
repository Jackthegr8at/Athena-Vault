import "./overview.css";
import { preload } from "react-dom";
import { createPageHelpRepository, getDashboardReadModel, toTorontoDateIso, withDatabaseObservation, type CashFlowPeriodData } from "@athena/database";
import { money, projectChainedCashFlow } from "@athena/finance-engine";
import { DashboardClient, type DashboardCurrentPeriodSummary, type DashboardInitialData, type DashboardTimelineItem } from "./components/dashboard-client";
import { forwardCashFlowPeriodBounds } from "./cash-flow/period-windows";
import { alignNetWorthHistoryCurrentPoint, calculateLiveNetWorthBreakdown } from "./net-worth";
import { getServerDatabase } from "../lib/server/database";
import { withAuthenticatedPageDatabase } from "../lib/server/owner-database";
import { getPrimaryOwnerId } from "../lib/server/auth-setup";
import { getOnboardingSnapshot } from "../lib/server/onboarding";
import { ownerDisplayLabel } from "./owner-presentation";

export const dynamic = "force-dynamic";

function toTimeline(periods: readonly CashFlowPeriodData[]): readonly DashboardTimelineItem[] {
  return periods.flatMap((period) => [
    ...period.transactions.map((transaction) => ({
      id: transaction.id,
      periodId: period.period.id,
      date: transaction.transactionDate,
      name: transaction.description,
      note: `${transaction.category ?? transaction.kind} · ${transaction.accountName} · ${transaction.status}`,
      category: transaction.category,
      kind: transaction.kind === "income" ? "income" as const : "expense" as const,
      status: transaction.status,
      amountMinor: transaction.amountMinor,
      positive: transaction.kind === "income",
    })),
    ...period.transfers.map((transfer) => ({
      id: transfer.id,
      periodId: period.period.id,
      date: transfer.transferDate,
      name: transfer.description,
      note: `Transfer · ${transfer.fromAccountName} -> ${transfer.toAccountName} · ${transfer.status}`,
      category: "Transfer",
      kind: "transfer" as const,
      status: transfer.status,
      amountMinor: transfer.amountMinor,
      positive: false,
    })),
  ]).sort((left, right) => left.date.localeCompare(right.date)).slice(0, 12);
}

function displayDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

function greetingForHour(hour: number): string {
  if (hour < 3) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good night";
}

function torontoHour(now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", hour: "numeric", hourCycle: "h23" }).format(now));
}

export default async function Dashboard() {
  preload("/brand/overview_back_top.png", { as: "image" });
  preload("/brand/overview_back_hero.png", { as: "image" });
  const asOfIso = toTorontoDateIso();
  const { periodWindow, upcomingPeriods, annual, investments, accounts, home, netWorthHistory, onboarding, overviewHelpSeen, user, primaryId } = await withDatabaseObservation("dashboard-page", async () => {
    return withAuthenticatedPageDatabase(async (database, user) => {
      const pageHelp = createPageHelpRepository(database);
      const dashboardPromise = getDashboardReadModel(database, user.owner.id, asOfIso);
      const [dashboard, onboarding, overviewHelpSeen, primaryId] = await Promise.all([
        dashboardPromise,
        dashboardPromise.then((dashboard) => getOnboardingSnapshot(database, user.owner.id, {
          hasAccount: dashboard.periodWindow.accounts.some((account) => account.isActive),
          hasBalance: dashboard.periodWindow.anchors.length > 0,
          hasRecurring: dashboard.periodWindow.projectionTransactions.some((transaction) => transaction.recurringSeriesId !== null && (transaction.kind === "income" || transaction.kind === "expense")),
        })).catch(() => null),
        pageHelp.hasSeen(user.owner.id, "overview"),
        getPrimaryOwnerId(getServerDatabase()),
      ]);
      return { ...dashboard, onboarding, overviewHelpSeen, user, primaryId };
    }, { requireTwoFactor: true });
  });

  const forwardBounds = forwardCashFlowPeriodBounds(periodWindow.periods.map((entry) => entry.period));
  const forwardPeriods = periodWindow.periods.map((entry, index) => ({ ...entry.period, ...forwardBounds[index]! }));

  const chain = projectChainedCashFlow({
    accounts: periodWindow.accounts.map((account) => ({
      id: account.id,
      name: account.name,
      currency: account.currency,
      includeInAvailableCash: account.includeInAvailableCash,
    })),
    anchors: periodWindow.anchors.map((anchor) => ({
      id: anchor.id,
      accountId: anchor.accountId,
      asOf: anchor.asOf,
      balanceMinor: money(anchor.balanceMinor),
      source: anchor.status === "actual" ? "actual" as const : "manual" as const,
    })),
    transactions: periodWindow.projectionTransactions.flatMap((transaction) => (
      transaction.kind === "income" || transaction.kind === "expense"
        ? [{
          id: transaction.id,
          accountId: transaction.accountId,
          transactionDate: transaction.transactionDate,
          kind: transaction.kind,
          amountMinor: money(transaction.amountMinor),
          status: transaction.status,
          description: transaction.description,
        }]
        : []
    )),
    transfers: periodWindow.projectionTransfers.map((transfer) => ({
      id: transfer.id,
      fromAccountId: transfer.fromAccountId,
      toAccountId: transfer.toAccountId,
      transferDate: transfer.transferDate,
      amountMinor: money(transfer.amountMinor),
      status: transfer.status,
      description: transfer.description,
      countsAsExpense: transfer.countsAsExpense,
    })),
    periods: forwardPeriods.map((period) => ({
      id: period.id,
      label: period.label,
      startsOn: period.startsOn,
      endsOn: period.endsOn,
      payDate: period.payDate,
    })),
  });

  const selectedPeriodData = forwardPeriods.find((period) => period.id === periodWindow.selectedPeriodId)
    ?? forwardPeriods[0]
    ?? null;
  const selectedProjection = selectedPeriodData
    ? chain.periods.find((entry) => entry.period.id === selectedPeriodData.id) ?? null
    : null;

  const changeMinor = selectedProjection && selectedProjection.openingBalanceMinor !== null && selectedProjection.endingBalanceMinor !== null
    ? selectedProjection.endingBalanceMinor - selectedProjection.openingBalanceMinor
    : null;

  const currentPeriod: DashboardCurrentPeriodSummary | null = selectedPeriodData && selectedProjection
    ? {
      id: selectedPeriodData.id,
      label: "Current",
      payDate: selectedPeriodData.payDate,
      payDateLabel: displayDate(selectedPeriodData.payDate),
      startsOn: selectedPeriodData.startsOn,
      endsOn: selectedPeriodData.endsOn,
      rangeLabel: `${displayDate(selectedPeriodData.startsOn)} – ${displayDate(selectedPeriodData.endsOn)}`,
      status: selectedPeriodData.status,
      openingBalanceMinor: selectedProjection.openingBalanceMinor,
      incomeMinor: selectedProjection.incomeMinor,
      spendingMinor: selectedProjection.spendingMinor,
      transfersInMinor: selectedProjection.transfersInMinor,
      transfersOutMinor: selectedProjection.transfersOutMinor,
      changeMinor,
      availableBeforeNextPayMinor: selectedProjection.availableBeforeNextPayMinor,
      href: `/cash-flow?period=${encodeURIComponent(selectedPeriodData.id)}`,
    }
    : null;

  const homeEquityMinor = home?.currentEquityMinor ?? 0;
  const liveNetWorth = calculateLiveNetWorthBreakdown(accounts, homeEquityMinor);
  const hasCurrentBalance = onboarding?.balance ?? periodWindow.anchors.length > 0;
  const hasActiveRecurringMovement = onboarding?.recurring ?? periodWindow.projectionTransactions.some((transaction) => transaction.recurringSeriesId !== null && (transaction.kind === "income" || transaction.kind === "expense"));
  const data: DashboardInitialData = {
    isDemo: user.owner.isDemo,
    ownerLabel: ownerDisplayLabel(user.owner),
    ownerDisplayName: user.owner.displayName,
    greeting: greetingForHour(torontoHour()),
    dateLabel: new Intl.DateTimeFormat("en-CA", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${asOfIso}T00:00:00Z`)),
    todayIso: asOfIso,
    activeAccountCount: periodWindow.accounts.length,
    totalPeriodCount: periodWindow.totalPeriodCount,
    hasCurrentBalance,
    hasActiveRecurringMovement,
    hasHomeProfile: home !== null,
    currentPeriod,
    timeline: toTimeline(upcomingPeriods),
    nextPeriodId: upcomingPeriods[0]?.period.id ?? null,
    annual: { year: annual.currentYear, totalMinor: annual.currentTotalMinor, fundedMinor: annual.fundedMinor, remainingMinor: annual.remainingMinor },
    investments: { monthlyContributionMinor: investments.monthlyContributionMinor },
    homeEquityMinor,
    liabilitiesMinor: liveNetWorth.liabilitiesMinor,
    netWorthMinor: liveNetWorth.netWorthMinor,
    netWorthHistory: alignNetWorthHistoryCurrentPoint(netWorthHistory, liveNetWorth),
    netWorthPaydays: [...new Set(periodWindow.periods.map(entry => entry.period.payDate).filter(date => date <= asOfIso))].sort().slice(-2),
    onboarding,
    overviewHelpSeen,
  };
  const isAdmin = Boolean(primaryId) && user.authUserId === primaryId;
  return <DashboardClient data={data} isAdmin={isAdmin} />;
}
