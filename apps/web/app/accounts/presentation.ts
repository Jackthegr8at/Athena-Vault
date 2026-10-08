import {
  accountKindLabel,
  accountTimelineDedicatedOtherSectionKeys,
  accountTimelineSectionForAccount,
  accountTimelineSectionKeyForCustomTypeLabel,
  ACCOUNT_TIMELINE_SECTION_LABELS,
  ACCOUNT_TIMELINE_SECTION_ORDER,
  derivePeriodState,
  isLiabilityAccountKind,
  isLiquidAccountKind,
  navigatePayday,
  normalizeIsoDates,
  periodPositionLabel,
  selectClosestPaydayOnOrBefore,
  snapshotStatusDisplayLabel,
  normalizeAccountCustomTypeLabel,
} from "@athena/database/account-timeline";
import type { AccountTimelineSectionKey, PeriodState, SnapshotStatus } from "@athena/database/account-timeline";
import type { AccountContributionRuleView } from "@athena/database";
import { ACCOUNTS_PAGE_HELP_CONTENT, type AccountsPageHelpActionId, type PageHelpSnapshot } from "../components/page-help-content";
import { formatSignedMoneyMinor } from "../../lib/format-money";

export interface AccountTimelinePresentationInput {
  readonly accounts: readonly {
    readonly id: string;
    readonly name: string;
    readonly institution: string;
    readonly kind: string;
    readonly customTypeLabel: string | null;
    readonly lastFour?: string | null;
    readonly groupName?: string | null;
    readonly timelineOrder?: number;
    readonly isActive: boolean;
    readonly includeInAvailableCash: boolean;
    readonly useCashFlowPlannedTimeline?: boolean;
    readonly snapshots: readonly {
      readonly id: string;
      readonly asOf: string;
      readonly balanceMinor: number;
      readonly status: SnapshotStatus;
      readonly isGenerated?: boolean;
      readonly note?: string | null;
    }[];
    readonly notes?: readonly {
      readonly asOf: string;
      readonly note: string;
    }[];
    readonly contributionRules?: readonly AccountContributionRuleView[];
  }[];
  readonly paydays: readonly string[];
}

export type TimelineGroupKey = AccountTimelineSectionKey;

export interface TimelineColumnPresentation {
  readonly date: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly state: PeriodState;
  readonly stateLabel: string;
  readonly selected: boolean;
  readonly isPastOrCurrent: boolean;
  readonly isFuture: boolean;
}

export type TimelineDeltaTone = "favorable" | "unfavorable" | "neutral";

export interface TimelineDeltaPresentation {
  readonly deltaMinor: number;
  readonly tone: TimelineDeltaTone;
}

export interface TimelineCellPresentation {
  readonly snapshotId: string | null;
  readonly balanceMinor: number | null;
  readonly status: SnapshotStatus | null;
  readonly statusLabel: string | null;
  readonly projectionSource: "generated" | "manual" | null;
  readonly note?: string | null;
  readonly delta: TimelineDeltaPresentation | null;
}

export interface TimelineAccountPresentation {
  readonly id: string;
  readonly name: string;
  readonly institution: string;
  readonly kind: string;
  readonly kindLabel: string;
  readonly lastFour: string | null;
  readonly group: TimelineGroupKey;
  readonly isActive: boolean;
  readonly includeInAvailableCash: boolean;
  readonly useCashFlowPlannedTimeline: boolean;
  readonly timelineOrder: number;
  readonly contributionRules: readonly AccountContributionRuleView[];
  readonly cells: readonly TimelineCellPresentation[];
}

export interface TimelineGroupPresentation {
  readonly key: TimelineGroupKey;
  readonly label: string;
  readonly accounts: readonly TimelineAccountPresentation[];
  readonly totals: readonly number[];
  readonly totalDeltas: readonly (TimelineDeltaPresentation | null)[];
}

export interface TimelineNavigationPresentation {
  readonly previous: string | null;
  readonly today: string | null;
  readonly next: string | null;
  readonly latest: string | null;
}

export interface AccountsPresentation {
  readonly todayIso: string;
  readonly selectedDate: string | null;
  readonly columns: readonly TimelineColumnPresentation[];
  readonly groups: readonly TimelineGroupPresentation[];
  readonly navigation: TimelineNavigationPresentation;
  readonly liquidTotalMinor: number;
  readonly totalTimeline: readonly number[];
  readonly selectedTotalMinor: number;
  readonly selectedLiquidTotalMinor: number;
  readonly activeAccountCount: number;
  readonly visibleAccountCount: number;
  readonly selectedState: PeriodState;
  readonly selectedStateLabel: string;
  readonly pastPeriods: number;
  readonly futurePeriods: number;
  readonly totalPeriodCount: number;
}

export function shouldShowAccountsFirstUse(
  presentation: Pick<AccountsPresentation, "activeAccountCount" | "visibleAccountCount">,
): boolean {
  return presentation.activeAccountCount === 0 && presentation.visibleAccountCount === 0;
}

const ACCOUNTS_PAGE_HELP_ACTION_HREFS: Readonly<Record<AccountsPageHelpActionId, string>> = {
  account: "/accounts",
  timeline: "/cash-flow",
  balance: "/accounts",
  availableCash: "/accounts",
  timelineReview: "/accounts",
};

function hasAccountsHelpBalance(presentation: Pick<AccountsPresentation, "columns" | "selectedDate" | "groups">): boolean {
  const selectedColumnIndex = presentation.columns.findIndex((column) => column.selected);
  if (!presentation.selectedDate || selectedColumnIndex < 0) return false;
  return presentation.groups
    .flatMap((group) => group.accounts)
    .filter((account) => account.isActive)
    .some((account) => {
      const cell = account.cells[selectedColumnIndex];
      return cell?.balanceMinor !== null && cell?.balanceMinor !== undefined && cell.projectionSource !== "generated";
    });
}

export function buildAccountsHelpSnapshot(presentation: Pick<AccountsPresentation, "activeAccountCount" | "totalPeriodCount" | "columns" | "selectedDate" | "groups">): PageHelpSnapshot {
  const activeAccounts = presentation.groups.flatMap((group) => group.accounts).filter((account) => account.isActive);
  const availableCashAccountCount = activeAccounts.filter((account) => account.includeInAvailableCash).length;
  const hasBalance = hasAccountsHelpBalance(presentation);
  let actionId: AccountsPageHelpActionId;
  if (presentation.activeAccountCount === 0) actionId = "account";
  else if (presentation.totalPeriodCount === 0) actionId = "timeline";
  else if (!hasBalance) actionId = "balance";
  else if (availableCashAccountCount === 0) actionId = "availableCash";
  else actionId = "timelineReview";

  return {
    items: [
      { label: ACCOUNTS_PAGE_HELP_CONTENT.snapshotLabels.activeAccounts, value: String(presentation.activeAccountCount) },
      { label: ACCOUNTS_PAGE_HELP_CONTENT.snapshotLabels.payPeriods, value: String(presentation.totalPeriodCount) },
      { label: ACCOUNTS_PAGE_HELP_CONTENT.snapshotLabels.currentBalance, value: hasBalance ? "Recorded" : "Not recorded" },
      { label: ACCOUNTS_PAGE_HELP_CONTENT.snapshotLabels.availableCashAccounts, value: String(availableCashAccountCount) },
    ],
    action: {
      label: ACCOUNTS_PAGE_HELP_CONTENT.actionLabels[actionId],
      href: ACCOUNTS_PAGE_HELP_ACTION_HREFS[actionId],
    },
  };
}

const statusLabel = (status: SnapshotStatus | null): string | null => {
  if (!status) return null;
  return snapshotStatusDisplayLabel(status);
};

const displayDate = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const shortDisplayDate = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});

export function calculateTimelineDelta(
  currentMinor: number | null,
  previousMinor: number | null,
  isLiability = false,
): TimelineDeltaPresentation | null {
  if (currentMinor === null || previousMinor === null) return null;
  const deltaMinor = currentMinor - previousMinor;
  const tone: TimelineDeltaTone = deltaMinor === 0
    ? "neutral"
    : isLiability
      ? (deltaMinor < 0 ? "favorable" : "unfavorable")
      : (deltaMinor > 0 ? "favorable" : "unfavorable");
  return { deltaMinor, tone };
}

export function formatTimelineDelta(deltaMinor: number): string {
  return formatSignedMoneyMinor(deltaMinor, { zeroSign: "±" });
}

export function formatTimelineDate(iso: string | null): string {
  return iso ? displayDate.format(new Date(`${iso}T00:00:00Z`)) : "No payday selected";
}

export function formatTimelineShortDate(iso: string): string {
  return shortDisplayDate.format(new Date(`${iso}T00:00:00Z`));
}

export function maskedAccountLastFour(lastFour: string | null | undefined): string | null {
  return lastFour ? `•••• ${lastFour}` : null;
}

export function groupKeyForAccountKind(
  kind: string,
  customTypeLabel?: string | null,
  dedicatedOtherSections?: ReadonlySet<TimelineGroupKey>,
): TimelineGroupKey {
  return accountTimelineSectionForAccount(kind, customTypeLabel, dedicatedOtherSections);
}

export function resolveTimelineSelection(
  paydays: readonly string[],
  requestedDate: string | null | undefined,
  todayIso: string,
): string | null {
  const normalized = normalizeIsoDates(paydays);
  if (requestedDate && normalized.includes(requestedDate)) return requestedDate;
  return selectClosestPaydayOnOrBefore(normalized, todayIso);
}

export function buildTimelineNavigation(
  paydays: readonly string[],
  selectedDate: string | null,
  todayIso: string,
): TimelineNavigationPresentation {
  const normalized = normalizeIsoDates(paydays);
  const resolvedToday = selectClosestPaydayOnOrBefore(normalized, todayIso);
  const selected = selectedDate && normalized.includes(selectedDate) ? selectedDate : resolvedToday;
  return {
    previous: selected ? navigatePayday(normalized, selected, "previous") : null,
    today: resolvedToday,
    next: selected ? navigatePayday(normalized, selected, "next") : null,
    latest: normalized.at(-1) ?? null,
  };
}

function sortAccounts(left: TimelineAccountPresentation, right: TimelineAccountPresentation): number {
  return left.timelineOrder - right.timelineOrder
    || left.name.localeCompare(right.name, "en-CA", { sensitivity: "base" })
    || left.id.localeCompare(right.id);
}

export function buildAccountsPresentation(
  timeline: AccountTimelinePresentationInput,
  options: { readonly todayIso: string; readonly selectedDate?: string | null; readonly pastPeriods?: number; readonly futurePeriods?: number } ,
): AccountsPresentation {
  const paydays = normalizeIsoDates(timeline.paydays);
  const selectedDate = resolveTimelineSelection(paydays, options.selectedDate, options.todayIso);
  const pastPeriods = Math.max(0, Math.min(24, options.pastPeriods ?? 3));
  const futurePeriods = Math.max(0, Math.min(24, options.futurePeriods ?? 5));
  const statusByDate = new Map<string, SnapshotStatus[]>();
  for (const account of timeline.accounts) {
    if (!account.isActive) continue;
    for (const snapshot of account.snapshots) {
      const statuses = statusByDate.get(snapshot.asOf) ?? [];
      statuses.push(snapshot.status);
      statusByDate.set(snapshot.asOf, statuses);
    }
  }

  const currentPayday = selectClosestPaydayOnOrBefore(paydays, options.todayIso);
  const allColumns = paydays.map((date): TimelineColumnPresentation => {
    const state = derivePeriodState(statusByDate.get(date) ?? []);
    const isFuture = periodPositionLabel(date, currentPayday) === "Projected";
    return {
      date,
      label: formatTimelineDate(date),
      shortLabel: formatTimelineShortDate(date),
      state,
      // Time role for humans: Past / Current / Projected (not storage Actual/Planned).
      stateLabel: periodPositionLabel(date, currentPayday),
      selected: date === selectedDate,
      isPastOrCurrent: date <= options.todayIso,
      isFuture,
    };
  });
  const selectedColumnIndex = selectedDate ? allColumns.findIndex((column) => column.date === selectedDate) : -1;
  const visibleStart = selectedColumnIndex < 0 ? 0 : Math.max(0, selectedColumnIndex - pastPeriods);
  const visibleEnd = selectedColumnIndex < 0 ? allColumns.length : Math.min(allColumns.length, selectedColumnIndex + futurePeriods + 1);
  const columns = allColumns.slice(visibleStart, visibleEnd);
  const selectedStateLabel = selectedDate
    ? periodPositionLabel(selectedDate, currentPayday)
    : "Projected";

  const dedicatedOtherSections = accountTimelineDedicatedOtherSectionKeys(timeline.accounts);
  const customSectionLabels = new Map<TimelineGroupKey, string>();
  for (const account of timeline.accounts) {
    const sectionKey = accountTimelineSectionKeyForCustomTypeLabel(account.customTypeLabel);
    if (!sectionKey || !dedicatedOtherSections.has(sectionKey)) continue;
    const label = account.groupName?.trim() || normalizeAccountCustomTypeLabel(account.customTypeLabel);
    if (label && !customSectionLabels.has(sectionKey)) customSectionLabels.set(sectionKey, label);
  }
  const dynamicGroupOrder = [...dedicatedOtherSections].sort((left, right) => (customSectionLabels.get(left) ?? left).localeCompare(customSectionLabels.get(right) ?? right, "en-CA", { sensitivity: "base" }));
  const groupOrder: readonly TimelineGroupKey[] = [...ACCOUNT_TIMELINE_SECTION_ORDER, ...dynamicGroupOrder];
  const groupLabel = (key: TimelineGroupKey): string => {
    if (key in ACCOUNT_TIMELINE_SECTION_LABELS) return ACCOUNT_TIMELINE_SECTION_LABELS[key as keyof typeof ACCOUNT_TIMELINE_SECTION_LABELS];
    return customSectionLabels.get(key) ?? "Other accounts";
  };

  const accounts = timeline.accounts.map((account): TimelineAccountPresentation => {
    const group = groupKeyForAccountKind(account.kind, account.customTypeLabel, dedicatedOtherSections);
    const snapshots = new Map(account.snapshots.map((snapshot) => [snapshot.asOf, snapshot]));
    const notes = new Map((account.notes ?? []).map((note) => [note.asOf, note.note]));
    const cells = columns.map((column) => {
      const snapshot = snapshots.get(column.date);
      const virtualCashFlow = snapshot?.id.startsWith("cf-projected:") === true;
      return {
        snapshotId: snapshot && !virtualCashFlow ? snapshot.id : null,
        balanceMinor: snapshot?.balanceMinor ?? null,
        status: snapshot?.status ?? null,
        statusLabel: statusLabel(snapshot?.status ?? null),
        projectionSource: snapshot?.status === "planned"
          ? (snapshot.isGenerated || virtualCashFlow ? "generated" : "manual")
          : null,
        note: notes.get(column.date) ?? snapshot?.note ?? null,
      } satisfies Omit<TimelineCellPresentation, "delta">;
    });
    return {
      id: account.id,
      name: account.name,
      institution: account.institution,
      kind: account.kind,
      kindLabel: accountKindLabel(account.kind, account.customTypeLabel),
      lastFour: account.lastFour ?? null,
      group,
      isActive: account.isActive,
      includeInAvailableCash: account.includeInAvailableCash,
      useCashFlowPlannedTimeline: account.useCashFlowPlannedTimeline === true,
      timelineOrder: account.timelineOrder ?? 0,
      contributionRules: account.contributionRules ?? [],
      cells: cells.map((cell, columnIndex) => ({
        ...cell,
        delta: calculateTimelineDelta(
          cell.balanceMinor,
          columnIndex > 0 ? cells[columnIndex - 1]?.balanceMinor ?? null : null,
          isLiabilityAccountKind(account.kind),
        ),
      })),
    };
  });

  const groups = groupOrder.map((key): TimelineGroupPresentation => {
    const groupAccounts = accounts.filter((account) => account.group === key).sort(sortAccounts);
    const totals = columns.map((_, columnIndex) => groupAccounts
      .filter((account) => account.isActive)
      .reduce((total, account) => {
        const balance = account.cells[columnIndex]?.balanceMinor ?? 0;
        return total + (isLiabilityAccountKind(account.kind) ? -balance : balance);
      }, 0));
    const totalDeltas = totals.map((total, columnIndex) => calculateTimelineDelta(
      total,
      columnIndex > 0 ? totals[columnIndex - 1] ?? null : null,
    ));
    return { key, label: groupLabel(key), accounts: groupAccounts, totals, totalDeltas };
  }).filter((group) => group.accounts.length > 0);

  const activeAccounts = accounts.filter((account) => account.isActive);
  const totalTimeline = columns.map((_, columnIndex) => activeAccounts.reduce((total, account) => {
    const balance = account.cells[columnIndex]?.balanceMinor ?? 0;
    return total + (isLiabilityAccountKind(account.kind) ? -balance : balance);
  }, 0));
  const selectedVisibleColumnIndex = selectedDate ? columns.findIndex((column) => column.date === selectedDate) : -1;
  const selectedTotalMinor = selectedVisibleColumnIndex < 0 ? 0 : totalTimeline[selectedVisibleColumnIndex] ?? 0;
  const selectedLiquidTotalMinor = selectedVisibleColumnIndex < 0 ? 0 : activeAccounts
    .filter((account) => isLiquidAccountKind(account.kind))
    .reduce((total, account) => total + (account.cells[selectedVisibleColumnIndex]?.balanceMinor ?? 0), 0);
  const liquidTotalMinor = selectedLiquidTotalMinor;
  const selectedState = selectedDate ? columns.find((column) => column.date === selectedDate)?.state ?? "projected" : "projected";

  return {
    todayIso: options.todayIso,
    selectedDate,
    columns,
    groups,
    navigation: buildTimelineNavigation(paydays, selectedDate, options.todayIso),
    liquidTotalMinor,
    totalTimeline,
    selectedTotalMinor,
    selectedLiquidTotalMinor,
    activeAccountCount: activeAccounts.length,
    visibleAccountCount: accounts.length,
    selectedState,
    selectedStateLabel,
    pastPeriods,
    futurePeriods,
    totalPeriodCount: paydays.length,
  };
}
