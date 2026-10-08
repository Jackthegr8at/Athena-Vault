import type { CashFlowItem, CashFlowProjectionMovementKind, ChainedCashFlowPeriodProjection } from "@athena/finance-engine";
import { CASH_FLOW_PAGE_HELP_CONTENT, type CashFlowPageHelpActionId, type PageHelpSnapshot } from "../components/page-help-content";

export interface CashFlowWindowRange {
  readonly start: number;
  readonly end: number;
}

export type CashFlowDetailGroup = "income" | "expense" | "transfer-in" | "transfer-out";

export type CashFlowFirstUseStep = "account" | "timeline" | null;

export function cashFlowFirstUseStep(input: { readonly accountCount: number; readonly totalPeriodCount: number }): CashFlowFirstUseStep {
  if (input.accountCount === 0) return "account";
  if (input.totalPeriodCount === 0) return "timeline";
  return null;
}

export type CashFlowHelpBalanceStatus = "Recorded" | "Not recorded";

export interface CashFlowHelpSnapshotInput {
  readonly accountCount: number;
  readonly totalPeriodCount: number;
  readonly anchors: readonly {
    readonly status: "actual" | "planned";
    readonly isGenerated: boolean;
  }[];
  readonly recurringSeries: readonly {
    readonly kind: "income" | "expense" | "transfer";
    readonly state: "active" | "paused" | "ended";
  }[];
}

export type CashFlowHelpSnapshot = PageHelpSnapshot;

const CASH_FLOW_PAGE_HELP_ACTION_HREFS: Readonly<Record<CashFlowPageHelpActionId, string>> = {
  account: "/accounts",
  timeline: "/cash-flow",
  balance: "/accounts",
  recurring: "/cash-flow/recurring?first=1",
  projection: "/cash-flow",
};

function hasCashFlowHelpBalance(input: CashFlowHelpSnapshotInput): boolean {
  return input.anchors.some((anchor) => anchor.status === "actual" || (anchor.status === "planned" && !anchor.isGenerated));
}

function isCashFlowHelpRecurringMovement(series: CashFlowHelpSnapshotInput["recurringSeries"][number]): boolean {
  return series.state !== "ended" && (series.kind === "income" || series.kind === "expense");
}

export function buildCashFlowHelpSnapshot(input: CashFlowHelpSnapshotInput): PageHelpSnapshot {
  const firstUseStep = cashFlowFirstUseStep({ accountCount: input.accountCount, totalPeriodCount: input.totalPeriodCount });
  const hasBalance = hasCashFlowHelpBalance(input);
  const recurringMovementCount = input.recurringSeries.filter(isCashFlowHelpRecurringMovement).length;
  let actionId: CashFlowPageHelpActionId;
  if (firstUseStep === "account") actionId = "account";
  else if (firstUseStep === "timeline") actionId = "timeline";
  else if (!hasBalance) actionId = "balance";
  else if (recurringMovementCount === 0) actionId = "recurring";
  else actionId = "projection";
  const currentBalanceStatus: CashFlowHelpBalanceStatus = hasBalance ? "Recorded" : "Not recorded";

  return {
    items: [
      { label: CASH_FLOW_PAGE_HELP_CONTENT.snapshotLabels.activeAccounts, value: String(input.accountCount) },
      { label: CASH_FLOW_PAGE_HELP_CONTENT.snapshotLabels.payPeriods, value: String(input.totalPeriodCount) },
      { label: CASH_FLOW_PAGE_HELP_CONTENT.snapshotLabels.currentBalance, value: currentBalanceStatus },
      { label: CASH_FLOW_PAGE_HELP_CONTENT.snapshotLabels.recurringMovements, value: String(recurringMovementCount) },
    ],
    action: {
      label: CASH_FLOW_PAGE_HELP_CONTENT.actionLabels[actionId],
      href: CASH_FLOW_PAGE_HELP_ACTION_HREFS[actionId],
    },
  };
}

export type CashFlowPeriodTimelineMetricLabel = "Opening" | "Income" | "Spending" | "Transfers in" | "Transfers out" | "Available ending" | "Change";

export interface CashFlowPeriodTimelineMetric {
  readonly label: CashFlowPeriodTimelineMetricLabel;
  readonly amountMinor: number | null;
  readonly emphasis?: "positive" | "negative";
  /** When true, format amount as +$x / -$x (ending − opening style). */
  readonly signed?: boolean;
}

export function cashFlowPeriodTimelineMetrics(
  projection: Pick<ChainedCashFlowPeriodProjection, "openingBalanceMinor" | "incomeMinor" | "spendingMinor" | "transfersInMinor" | "transfersOutMinor" | "endingBalanceMinor">,
): readonly CashFlowPeriodTimelineMetric[] {
  const changeMinor =
    projection.openingBalanceMinor === null || projection.endingBalanceMinor === null
      ? null
      : projection.endingBalanceMinor - projection.openingBalanceMinor;
  return [
    { label: "Opening", amountMinor: projection.openingBalanceMinor },
    { label: "Income", amountMinor: projection.incomeMinor, emphasis: "positive" },
    { label: "Spending", amountMinor: projection.spendingMinor, emphasis: "negative" },
    { label: "Transfers in", amountMinor: projection.transfersInMinor },
    { label: "Transfers out", amountMinor: projection.transfersOutMinor },
    { label: "Available ending", amountMinor: projection.endingBalanceMinor },
    {
      label: "Change",
      amountMinor: changeMinor,
      emphasis: changeMinor === null ? undefined : changeMinor >= 0 ? "positive" : "negative",
      signed: true,
    },
  ];
}

export function cashFlowItemGroup(item: Pick<CashFlowItem, "kind" | "direction">): CashFlowDetailGroup {
  if (item.kind === "income") return "income";
  if (item.kind === "expense") return "expense";
  return item.direction === "in" ? "transfer-in" : "transfer-out";
}

export function cashFlowItemSignedAmount(item: Pick<CashFlowItem, "amount" | "kind" | "direction">): number {
  return item.kind === "income" || item.direction === "in" ? item.amount : -item.amount;
}

export function orderCashFlowItems(items: readonly CashFlowItem[]): readonly CashFlowItem[] {
  const priority: Record<CashFlowDetailGroup, number> = { income: 0, "transfer-in": 1, expense: 2, "transfer-out": 3 };
  return [...items].sort((left, right) => (left.date ?? "").localeCompare(right.date ?? "") || priority[cashFlowItemGroup(left)] - priority[cashFlowItemGroup(right)] || left.id.localeCompare(right.id));
}

export function compactCashFlowWindowRange(
  selectedIndex: number,
  totalCount: number,
  pastPeriods = 2,
  futurePeriods = 3,
  showAll = false,
): CashFlowWindowRange {
  if (totalCount <= 0) return { start: 0, end: 0 };
  if (showAll) return { start: 0, end: totalCount };
  const index = Math.max(0, Math.min(selectedIndex, totalCount - 1));
  const past = Math.max(0, pastPeriods);
  const future = Math.max(0, futurePeriods);
  return {
    start: Math.max(0, index - past),
    end: Math.min(totalCount, index + future + 1),
  };
}

export function cashFlowBalanceDifference(endingBalanceMinor: number, nextOpeningBalanceMinor: number | null): number | null {
  return nextOpeningBalanceMinor === null ? null : nextOpeningBalanceMinor - endingBalanceMinor;
}

export function cashFlowProjectionBalanceDifference(endingBalanceMinor: number | null, nextOpeningBalanceMinor: number | null): number | null {
  return endingBalanceMinor === null || nextOpeningBalanceMinor === null
    ? null
    : cashFlowBalanceDifference(endingBalanceMinor, nextOpeningBalanceMinor);
}

export function cashFlowPaydayVariance(projectedBalanceMinor: number | null, observedBalanceMinor: number | null): number | null {
  return cashFlowProjectionBalanceDifference(projectedBalanceMinor, observedBalanceMinor);
}

export function cashFlowProjectionMovementLabel(kind: CashFlowProjectionMovementKind): string {
  if (kind === "anchor") return "Balance anchor";
  if (kind === "income") return "Income";
  if (kind === "expense") return "Spending";
  return kind === "transfer-in" ? "Transfer in" : "Transfer out";
}

/** Display sections for account-card movement lists (Income / Spending / Transfers). */
export type CashFlowMovementSection = "income" | "spending" | "transfer" | "anchor";

const CASH_FLOW_MOVEMENT_SECTION_ORDER: readonly CashFlowMovementSection[] = ["income", "spending", "transfer", "anchor"];

export function cashFlowMovementSection(
  kind: CashFlowProjectionMovementKind,
  countsAsExpense = false,
): CashFlowMovementSection {
  if (kind === "income") return "income";
  if (kind === "expense" || (kind === "transfer-out" && countsAsExpense)) return "spending";
  if (kind === "transfer-in" || kind === "transfer-out") return "transfer";
  return "anchor";
}

export function cashFlowMovementSectionLabel(section: CashFlowMovementSection): string {
  if (section === "income") return "Income";
  if (section === "spending") return "Spending";
  if (section === "transfer") return "Transfers";
  return "Balance anchors";
}

export function groupCashFlowMovementsBySection<T extends { readonly kind: CashFlowProjectionMovementKind; readonly countsAsExpense?: boolean }>(
  movements: readonly T[],
): readonly { readonly section: CashFlowMovementSection; readonly label: string; readonly movements: readonly T[] }[] {
  const buckets = new Map<CashFlowMovementSection, T[]>();
  for (const movement of movements) {
    const section = cashFlowMovementSection(movement.kind, movement.countsAsExpense === true);
    const list = buckets.get(section);
    if (list) list.push(movement);
    else buckets.set(section, [movement]);
  }
  return CASH_FLOW_MOVEMENT_SECTION_ORDER
    .filter((section) => (buckets.get(section)?.length ?? 0) > 0)
    .map((section) => ({
      section,
      label: cashFlowMovementSectionLabel(section),
      movements: buckets.get(section)!,
    }));
}

export function cashFlowPeriodHref(periodId: string, showAll: boolean, showAllAccounts = false): string {
  const params = new URLSearchParams({ period: periodId });
  if (showAll) params.set("view", "all");
  if (showAllAccounts) params.set("accounts", "all");
  return `/cash-flow?${params.toString()}`;
}

export function cashFlowCurrentPeriodHref(currentPeriodId: string | null, selectedPeriodId: string, showAll: boolean, showAllAccounts = false): string | null {
  if (!currentPeriodId || currentPeriodId === selectedPeriodId) return null;
  return cashFlowPeriodHref(currentPeriodId, showAll, showAllAccounts);
}

export type RecurringOccurrenceDisplayState = "regular" | "modified" | "skipped" | "actual" | "manual";

export function recurringOccurrenceDisplayState(input: {
  readonly generated: boolean;
  readonly planned: boolean;
  readonly hasException: boolean;
  readonly skipped?: boolean;
}): RecurringOccurrenceDisplayState {
  if (!input.planned) return "actual";
  if (!input.generated) return "manual";
  if (input.skipped) return "skipped";
  if (input.hasException) return "modified";
  return "regular";
}

export function recurringRangeLabel(endingOccurrenceOn: string, occurrenceCount: number): string {
  return `Through ${endingOccurrenceOn} (${occurrenceCount} planned)`;
}

export const recurringCashFlowManagerPath = "/cash-flow/recurring";

export interface RecurringCashFlowSummarySeries {
  readonly id: string;
  readonly kind: "income" | "expense" | "transfer";
  readonly state: string;
  readonly nextOccurrenceOn: string | null;
  readonly versions: readonly {
    readonly name: string;
    readonly amountMinor: number;
    readonly frequency: string;
    readonly isCurrent: boolean;
  }[];
}

export interface RecurringCashFlowSummaryItem {
  readonly id: string;
  readonly kind: "income" | "expense" | "transfer";
  readonly state: string;
  readonly name: string;
  readonly amountMinor: number | null;
  readonly frequency: string | null;
  readonly nextOccurrenceOn: string | null;
}

export function recurringCashFlowSummaryItems(
  series: readonly RecurringCashFlowSummarySeries[],
): readonly RecurringCashFlowSummaryItem[] {
  return series
    .filter((entry) => entry.state !== "ended")
    .map((entry) => {
      const version = entry.versions.find((candidate) => candidate.isCurrent) ?? entry.versions.at(-1) ?? null;
      return {
        id: entry.id,
        kind: entry.kind,
        state: entry.state,
        name: version?.name ?? "Unnamed series",
        amountMinor: version?.amountMinor ?? null,
        frequency: version?.frequency ?? null,
        nextOccurrenceOn: entry.nextOccurrenceOn,
      };
    })
    .sort((left, right) => (left.nextOccurrenceOn ?? "9999-12-31").localeCompare(right.nextOccurrenceOn ?? "9999-12-31") || left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}
