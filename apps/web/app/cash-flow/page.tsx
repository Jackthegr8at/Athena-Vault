import "./cash-flow.css";
import { preload } from "react-dom";
import { money, projectChainedCashFlow } from "@athena/finance-engine";
import { addIsoDays, createCashFlowRepository, recurringCashFlowOccurrencesBetween, toTorontoDateIso } from "@athena/database";
import { CashFlowClient, type RecurringCashFlowItem, type SerializedCashFlowMovement, type SerializedCashFlowPeriod } from "./client";
import { ModulePage } from "../components/module-page";
import { CASH_FLOW_PAGE_HELP_CONTENT } from "../components/page-help-content";
import { forwardCashFlowPeriodBounds } from "./period-windows";
import { buildCashFlowRecurringOptions } from "./recurring-editor";
import { buildCashFlowRecurringRangeSegments } from "./recurring-range-segments";
import type { CashFlowRecurringRangeSegment } from "./recurring-range-options";
import { buildCashFlowHelpSnapshot, cashFlowFirstUseStep } from "./presentation";
import { withAuthenticatedPageDatabase } from "../../lib/server/owner-database";
import { hasPageHelpSeen } from "../../lib/server/page-help";
import { ModuleFirstUseCard } from "../components/module-first-use-card";
import { InitialCashFlowTimelineSetup } from "./initial-timeline-setup";

export const dynamic = "force-dynamic";

type PeriodData = Awaited<ReturnType<ReturnType<typeof createCashFlowRepository>["getPeriodWindow"]>>["periods"][number];

interface CashFlowSearchParams {
  readonly period?: string | string[];
  readonly view?: string | string[];
  readonly accounts?: string | string[];
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toPayPeriod(data: PeriodData): Omit<SerializedCashFlowPeriod, "projection"> {
  const items: RecurringCashFlowItem[] = [
    ...data.transactions.flatMap((transaction) => transaction.kind === "income" || transaction.kind === "expense" ? [{
      id: transaction.id,
      label: transaction.description,
      account: transaction.accountName,
      accountId: transaction.accountId ?? undefined,
      recurringTransactionId: transaction.recurringTransactionId ?? undefined,
      recurringSeriesId: transaction.recurringSeriesId ?? undefined,
      recurringOccurrenceId: transaction.recurringOccurrenceId ?? undefined,
      scheduledOccurrenceOn: transaction.scheduledOccurrenceOn ?? undefined,
      generated: transaction.isGenerated,
      recurringState: transaction.status !== "planned" ? "actual" as const : !transaction.isGenerated && transaction.recurringTransactionId ? "manual" as const : transaction.isGenerated && (transaction.recurringExceptionId || transaction.scheduledOccurrenceOn !== transaction.transactionDate) ? "modified" as const : transaction.isGenerated ? "regular" as const : undefined,
      amount: money(transaction.amountMinor),
      kind: transaction.kind,
      date: transaction.transactionDate,
      planned: transaction.status === "planned",
      ...(transaction.category ? { category: transaction.category } : {}),
    }] : []),
    ...data.transfers.flatMap((transfer) => [
      {
        id: `${transfer.id}:out`,
        recordId: transfer.id,
        recurringTransactionId: transfer.recurringTransactionId ?? undefined,
        recurringSeriesId: transfer.recurringSeriesId ?? undefined,
        recurringOccurrenceId: transfer.recurringOccurrenceId ?? undefined,
        scheduledOccurrenceOn: transfer.scheduledOccurrenceOn ?? undefined,
        generated: transfer.isGenerated,
        label: transfer.description,
        account: transfer.fromAccountName,
        accountId: transfer.fromAccountId,
        amount: money(transfer.amountMinor),
        kind: "transfer" as const,
        date: transfer.transferDate,
        direction: "out" as const,
        fromAccountId: transfer.fromAccountId,
        toAccountId: transfer.toAccountId,
        category: `To ${transfer.toAccountName}`,
        planned: transfer.status === "planned",
      },
      {
        id: `${transfer.id}:in`,
        recordId: transfer.id,
        recurringTransactionId: transfer.recurringTransactionId ?? undefined,
        recurringSeriesId: transfer.recurringSeriesId ?? undefined,
        recurringOccurrenceId: transfer.recurringOccurrenceId ?? undefined,
        scheduledOccurrenceOn: transfer.scheduledOccurrenceOn ?? undefined,
        generated: transfer.isGenerated,
        label: transfer.description,
        account: transfer.toAccountName,
        accountId: transfer.toAccountId,
        amount: money(transfer.amountMinor),
        kind: "transfer" as const,
        date: transfer.transferDate,
        direction: "in" as const,
        fromAccountId: transfer.fromAccountId,
        toAccountId: transfer.toAccountId,
        category: `From ${transfer.fromAccountName}`,
        planned: transfer.status === "planned",
      },
    ]),
  ];
  return {
    period: {
      id: data.period.id,
      label: data.period.label,
      payDate: data.period.payDate,
      startsOn: data.period.startsOn,
      endsOn: data.period.endsOn,
      status: data.period.status,
      openingBalance: money(data.period.openingBalanceMinor),
      items,
    },
    editableIncomeId: items.find((item) => item.kind === "income")?.id ?? null,
    observedMainAccountBalanceMinor: null,
    paydayCheck: null,
    paydayNote: null,
  };
}

export default async function CashFlowPage({ searchParams }: { readonly searchParams?: Promise<CashFlowSearchParams> }) {
  preload("/brand/backgrounds/cash-flow.png", { as: "image" });
  const params = searchParams ? await searchParams : {};
  const todayIso = toTorontoDateIso();
  const showAll = firstValue(params.view) === "all";
  const { window, recurringSeries, excludedExpenses, pageHelpSeen } = await withAuthenticatedPageDatabase(async (database, user) => {
    const cashFlowRepository = createCashFlowRepository(database);
    const [window, recurringSeries, excludedExpenses, pageHelpSeen] = await Promise.all([
      cashFlowRepository.getPeriodWindow(user.owner.id, {
        asOfIso: todayIso,
        selectedPeriodId: firstValue(params.period) ?? null,
        includeAll: showAll,
      }),
      cashFlowRepository.listRecurringSeries(user.owner.id, { includeHistory: true, asOfIso: todayIso }),
      cashFlowRepository.listExcludedExpenses(user.owner.id),
      hasPageHelpSeen(database, user, CASH_FLOW_PAGE_HELP_CONTENT.pageId),
    ]);
    return { window, recurringSeries, excludedExpenses, pageHelpSeen };
  }, { requireTwoFactor: true });
  const forwardBounds = forwardCashFlowPeriodBounds(window.periods.map((entry) => entry.period));
  const forwardPeriods: readonly PeriodData[] = window.periods.map((entry, index) => {
    const bounds = forwardBounds[index]!;
    return {
      period: { ...entry.period, ...bounds },
      transactions: window.projectionTransactions.filter((transaction) => transaction.transactionDate >= bounds.startsOn && transaction.transactionDate <= bounds.endsOn),
      transfers: window.projectionTransfers.filter((transfer) => transfer.transferDate >= bounds.startsOn && transfer.transferDate <= bounds.endsOn),
    };
  });
  const cashFlowHelp = {
    content: CASH_FLOW_PAGE_HELP_CONTENT,
    snapshot: buildCashFlowHelpSnapshot({
      accountCount: window.accounts.length,
      totalPeriodCount: window.totalPeriodCount,
      anchors: window.anchors.map((anchor) => ({ status: anchor.status, isGenerated: anchor.isGenerated })),
      recurringSeries: recurringSeries.map((series) => ({ kind: series.kind, state: series.state })),
    }),
  };
  const firstUseStep = cashFlowFirstUseStep({ accountCount: window.accounts.length, totalPeriodCount: window.totalPeriodCount });
  if (firstUseStep === "account") {
    return <ModulePage active="Cash flow" mainClassName="cash-flow-page" eyebrow="Projection workspace" title="Cash flow" subtitle="Review pay periods, inspect the selected period, and preview the next-pay projection." help={cashFlowHelp} pageHelpSeen={pageHelpSeen}>
      <ModuleFirstUseCard headingId="cash-flow-first-account-heading" title="Create your main account first" description="Start with the account where your regular money arrives and stays. We’ll turn on Available cash and Planned timeline for this first account so Cash Flow is ready for the next step." actionHref="/accounts" actionLabel="Create main account" supportingText="Main account → current balance → recurring income" seed="cash-flow-first-account" />
    </ModulePage>;
  }
  if (firstUseStep === "timeline") {
    return <ModulePage active="Cash flow" mainClassName="cash-flow-page" eyebrow="Projection workspace" title="Cash flow" subtitle="Review pay periods, inspect the selected period, and preview the next-pay projection." help={cashFlowHelp} pageHelpSeen={pageHelpSeen}>
      <ModuleFirstUseCard headingId="cash-flow-periods-heading" title="Set up your Cash Flow rhythm" description="Choose the first payday and how far ahead you want to plan. Once the periods exist, you can add your current balance and recurring income without creating sample financial data." label="A clear first path" supportingText="Choose payday → current balance → recurring income" seed="cash-flow-no-periods">
        <InitialCashFlowTimelineSetup todayIso={todayIso} defaultThroughDate={addIsoDays(todayIso, 364)} />
      </ModuleFirstUseCard>
    </ModulePage>;
  }
  if (!window.selectedPeriodId) {
    return <ModulePage active="Cash flow" mainClassName="cash-flow-page" eyebrow="Projection workspace" title="Cash flow" subtitle="Review pay periods, inspect the selected period, and preview the next-pay projection." help={cashFlowHelp} pageHelpSeen={pageHelpSeen}>
      <ModuleFirstUseCard headingId="cash-flow-period-selection-heading" title="Choose a Cash Flow period" description="The requested period is not available. Select one of the available pay periods to continue reviewing projections." actionHref="/cash-flow" actionLabel="Open current period" label="Workspace status" supportingText="Select a period → review movements → adjust projections" seed="cash-flow-no-selected-period" />
    </ModulePage>;
  }
  const periods = forwardPeriods.map(toPayPeriod);
  const chain = projectChainedCashFlow({
    accounts: window.accounts.map((account) => ({ id: account.id, name: account.name, currency: account.currency, includeInAvailableCash: account.includeInAvailableCash })),
    anchors: window.anchors.map((anchor) => ({
      id: anchor.id,
      accountId: anchor.accountId,
      asOf: anchor.asOf,
      balanceMinor: money(anchor.balanceMinor),
      source: anchor.status === "actual" ? "actual" as const : "manual" as const,
    })),
    transactions: window.projectionTransactions.flatMap((transaction) => transaction.kind === "income" || transaction.kind === "expense" ? [{
      id: transaction.id,
      accountId: transaction.accountId,
      transactionDate: transaction.transactionDate,
      kind: transaction.kind,
      amountMinor: money(transaction.amountMinor),
      status: transaction.status,
      description: transaction.description,
    }] : []),
    transfers: window.projectionTransfers.map((transfer) => ({
      id: transfer.id,
      fromAccountId: transfer.fromAccountId,
      toAccountId: transfer.toAccountId,
      transferDate: transfer.transferDate,
      amountMinor: money(transfer.amountMinor),
      status: transfer.status,
      description: transfer.description,
      countsAsExpense: transfer.countsAsExpense,
    })),
    periods: forwardPeriods.map((entry) => ({ id: entry.period.id, label: entry.period.label, startsOn: entry.period.startsOn, endsOn: entry.period.endsOn, payDate: entry.period.payDate })),
  });
  const availableCashAccounts = window.accounts.filter((account) => account.includeInAvailableCash);
  const paydayCheckAccount = availableCashAccounts.length === 1 ? availableCashAccounts[0] : null;
  const observedBalancesByPayday = new Map(window.anchors
    .filter((anchor) => paydayCheckAccount?.id === anchor.accountId && anchor.status === "actual")
    .map((anchor) => [anchor.asOf, anchor.balanceMinor] as const));
  const paydayChecksByPayday = new Map(window.paydayChecks
    .filter((check) => paydayCheckAccount?.id === check.accountId)
    .map((check) => [check.payDate, check] as const));
  const paydayNotesByPayday = new Map(window.paydayNotes
    .filter((note) => paydayCheckAccount?.id === note.accountId)
    .map((note) => [note.asOf, note.note] as const));
  const initialPeriods: SerializedCashFlowPeriod[] = periods.flatMap((period) => {
    const projection = chain.periods.find((candidate) => candidate.period.id === period.period.id);
    const paydayCheck = paydayCheckAccount ? paydayChecksByPayday.get(period.period.payDate) ?? null : null;
    if (!projection) return [];
    const itemKeys = new Set(period.period.items.map((item) => `${item.recordId ?? item.id}:${item.direction ?? "record"}`));
    const serializedProjection = {
      ...projection,
      accounts: projection.accounts.map((account) => ({
        ...account,
        movements: account.movements.map(({ id: _id, accountId: _accountId, planned: _planned, counterpartAccountId: _counterpartAccountId, balanceAfterMinor: _balanceAfterMinor, description, ...movement }): SerializedCashFlowMovement => {
          const direction = movement.kind === "transfer-in" ? "in" : movement.kind === "transfer-out" ? "out" : "record";
          return movement.kind !== "anchor" && itemKeys.has(`${movement.recordId}:${direction}`) ? movement : { ...movement, description };
        }),
      })),
    };
    return [{ ...period, projection: serializedProjection, observedMainAccountBalanceMinor: paydayCheckAccount ? observedBalancesByPayday.get(period.period.payDate) ?? null : null, paydayCheck, paydayNote: paydayCheck?.note ?? (paydayCheckAccount ? paydayNotesByPayday.get(period.period.payDate) ?? null : null) }];
  });
  const accountOptions = window.accounts.map((account) => ({ id: account.id, label: `${account.name} · ${account.institution}`, includeInAvailableCash: account.includeInAvailableCash, isVisibleInCashFlow: account.isVisibleInCashFlow }));
  const relevantRecurringVersionIds = new Set([
    ...forwardPeriods.flatMap((entry) => [
      ...entry.transactions.filter((transaction) => transaction.isGenerated && transaction.status === "planned").map((transaction) => transaction.recurringTransactionId),
      ...entry.transfers.filter((transfer) => transfer.isGenerated && transfer.status === "planned").map((transfer) => transfer.recurringTransactionId),
    ]),
  ].flatMap((versionId) => versionId ? [versionId] : []));
  const recurringOptions = buildCashFlowRecurringOptions(recurringSeries, relevantRecurringVersionIds);
  const serializedExcludedExpenses = excludedExpenses.map((expense) => ({
    id: expense.id,
    accountName: expense.accountName,
    recurringTransactionId: expense.recurringTransactionId,
    transactionDate: expense.transactionDate,
    status: expense.status,
    description: expense.description,
    category: expense.category,
    amountMinor: expense.amountMinor,
  }));
  const recurringRangeSegments: readonly CashFlowRecurringRangeSegment[] = buildCashFlowRecurringRangeSegments(
    recurringSeries.map((series) => ({ id: series.id, versions: series.versions.map((version) => ({ id: version.id, schedule: version })) })),
    window.projectionTransactions
      .filter((transaction) => transaction.isGenerated && transaction.status === "planned")
      .map((transaction) => ({
        recurringSeriesId: transaction.recurringSeriesId,
        recurringTransactionId: transaction.recurringTransactionId,
        scheduledOccurrenceOn: transaction.scheduledOccurrenceOn,
      })),
    recurringCashFlowOccurrencesBetween,
  );
  const selectedPeriod = forwardPeriods.find((entry) => entry.period.id === window.selectedPeriodId);
  const movingAccountIds = new Set([
    ...(selectedPeriod?.transactions.flatMap((transaction) => transaction.accountId ? [transaction.accountId] : []) ?? []),
    ...(selectedPeriod?.transfers.flatMap((transfer) => [transfer.fromAccountId, transfer.toAccountId]) ?? []),
  ]);
  const visibleAccountIds = window.accounts.filter((account) => account.isVisibleInCashFlow && (account.includeInAvailableCash || movingAccountIds.has(account.id))).map((account) => account.id);
  return (
    <ModulePage active="Cash flow" mainClassName="cash-flow-page editorial-module-page" eyebrow="Projection workspace" title="Cash flow" subtitle="Review pay periods, inspect the selected period, and preview the next-pay projection." help={cashFlowHelp} pageHelpSeen={pageHelpSeen}>
      <CashFlowClient initialPeriods={initialPeriods} selectedPeriodId={window.selectedPeriodId} currentPeriodId={window.currentPeriodId} currentPeriodPayDate={window.currentPeriodPayDate} totalPeriodCount={window.totalPeriodCount} showAll={showAll} todayIso={todayIso} accountOptions={accountOptions} paydayCheckAccountId={paydayCheckAccount?.id ?? null} visibleAccountIds={visibleAccountIds} showAllAccounts={firstValue(params.accounts) === "all"} recurringOptions={recurringOptions} excludedExpenses={serializedExcludedExpenses} recurringRangeSegments={recurringRangeSegments} />
    </ModulePage>
  );
}
