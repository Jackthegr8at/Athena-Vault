"use client";

import { useActionState, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { RecurringCashFlowSeriesView } from "@athena/database";
import { recurringCashFlowOccurrencesBetween } from "@athena/database/recurring-cash-flow";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  changeRecurringSeriesVersionAction,
  deleteRecurringSeriesAction,
  deleteRecurringSeriesVersionAction,
  editRecurringSeriesVersionAction,
  endRecurringSeriesAction,
  generateRecurringOccurrencesAction,
  restoreRecurringOccurrenceAction,
  setRecurringSeriesStateAction,
  setRecurringTransferCountsAsExpenseAction,
  updateRecurringOverrideGroupAction,
} from "./recurring-actions";
import { initialCashFlowActionState, type CashFlowActionState } from "./action-helpers";
import { ModuleFirstUseCard } from "../components/module-first-use-card";
import { ActionNotification, type ActionNotificationState } from "../components/action-notification";
import { InvestmentDropdown, type InvestmentDropdownOption } from "../investments/investment-dropdown";
import { RecurringCreateDialog, addPreviewDays, parsePreviewDate } from "./recurring-create-dialog";
import { RecurringSeriesDialogs } from "./recurring-series-dialogs";
export { RecurringCreateHeaderAction } from "./recurring-create-dialog";
import { RecurringSeriesCard, dollars, frequencyLabel, recurringSeriesAnchorId, seriesInitial, type RecurringDetailEditor, type RecurringManagerAccountOption, type RecurringVersionView } from "./recurring-series-card";

export function recurringSeriesHref(seriesId: string): string {
  return `/cash-flow/recurring#${recurringSeriesAnchorId(seriesId)}`;
}



export interface RecurringCashFlowManagerProps {
  readonly series: readonly RecurringCashFlowSeriesView[];
  readonly accountOptions: readonly RecurringManagerAccountOption[];
  readonly todayIso: string;
}





function subscribeToLocationChange(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
}

function getLocationHash(): string {
  return window.location.hash;
}

function seriesIdFromHash(hash: string): string {
  const prefix = "#recurring-series-";
  return hash.startsWith(prefix) ? hash.slice(prefix.length) : "";
}






const statusFilterOptions: readonly InvestmentDropdownOption[] = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "ended", label: "Ended" },
];
const kindFilterOptions: readonly InvestmentDropdownOption[] = [
  { value: "all", label: "All types" },
  { value: "income", label: "Income" },
  { value: "expense", label: "Expense" },
  { value: "transfer", label: "Transfer" },
];
const sortOptions: readonly InvestmentDropdownOption[] = [
  { value: "next", label: "Next payment" },
  { value: "name", label: "Name" },
  { value: "amount", label: "Amount" },
];

function currentVersion(series: RecurringCashFlowSeriesView) {
  return series.versions.find((version) => version.isCurrent) ?? series.versions.at(-1) ?? null;
}

function seriesDisplayName(series: RecurringCashFlowSeriesView): string {
  return currentVersion(series)?.name ?? "Unnamed series";
}

function seriesAccountLabel(series: RecurringCashFlowSeriesView, accountOptions: readonly RecurringManagerAccountOption[]): string {
  const version = currentVersion(series);
  if (!version) return "No account";
  if (version.kind === "transfer") {
    const from = accountOptions.find((candidate) => candidate.id === version.fromAccountId)?.label ?? "Unknown source";
    const to = accountOptions.find((candidate) => candidate.id === version.toAccountId)?.label ?? "Unknown destination";
    return `${from} → ${to}`;
  }
  return version.accountId
    ? accountOptions.find((candidate) => candidate.id === version.accountId)?.label ?? "Unknown account"
    : "Unassigned";
}

function sortSeriesForManager(series: readonly RecurringCashFlowSeriesView[]): RecurringCashFlowSeriesView[] {
  return [...series].sort((left, right) => {
    const leftEnded = left.state === "ended" ? 1 : 0;
    const rightEnded = right.state === "ended" ? 1 : 0;
    if (leftEnded !== rightEnded) return leftEnded - rightEnded;
    return seriesDisplayName(left).localeCompare(seriesDisplayName(right), "en") || left.id.localeCompare(right.id);
  });
}

type RecurringStatusFilter = "all" | "active" | "paused" | "ended";
type RecurringKindFilter = "all" | "income" | "expense" | "transfer";
type RecurringSort = "next" | "name" | "amount";





function seriesAmountMinor(series: RecurringCashFlowSeriesView): number | null {
  return currentVersion(series)?.amountMinor ?? null;
}

function dateDistanceLabel(dateIso: string | null, todayIso: string): string {
  if (!dateIso) return "No upcoming payment";
  const date = parsePreviewDate(dateIso);
  const today = parsePreviewDate(todayIso);
  if (!date || !today) return "Scheduled date";
  const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return days > 0 ? `In ${days} days` : `${Math.abs(days)} days ago`;
}

function sortRecurringSeries(
  series: readonly RecurringCashFlowSeriesView[],
  sort: RecurringSort,
): RecurringCashFlowSeriesView[] {
  return [...series].sort((left, right) => {
    const leftEnded = left.state === "ended" ? 1 : 0;
    const rightEnded = right.state === "ended" ? 1 : 0;
    if (leftEnded !== rightEnded) return leftEnded - rightEnded;

    if (sort === "name") {
      return seriesDisplayName(left).localeCompare(seriesDisplayName(right), "en") || left.id.localeCompare(right.id);
    }

    if (sort === "amount") {
      const amountDifference = (seriesAmountMinor(right) ?? -1) - (seriesAmountMinor(left) ?? -1);
      if (amountDifference !== 0) return amountDifference;
    } else {
      const leftNext = left.nextOccurrenceOn ?? "9999-12-31";
      const rightNext = right.nextOccurrenceOn ?? "9999-12-31";
      const nextDifference = leftNext.localeCompare(rightNext);
      if (nextDifference !== 0) return nextDifference;
    }

    return seriesDisplayName(left).localeCompare(seriesDisplayName(right), "en") || left.id.localeCompare(right.id);
  });
}

function scrollToSeriesAnchor(seriesId: string): void {
  const node = document.getElementById(recurringSeriesAnchorId(seriesId));
  if (!node) return;
  node.scrollIntoView({ behavior: "smooth", block: "center" });
  node.classList.add("is-anchor-target");
  window.setTimeout(() => node.classList.remove("is-anchor-target"), 1800);
}















































function previousRecurringOccurrence(version: RecurringVersionView, beforeDate: string): string {
  const endDate = addPreviewDays(beforeDate, -1);
  if (!endDate || endDate < version.startsOn) return "";
  return recurringCashFlowOccurrencesBetween(version, version.startsOn, endDate).at(-1) ?? "";
}



interface RecurringSeriesListRowProps {
  readonly entry: RecurringCashFlowSeriesView;
  readonly accountOptions: readonly RecurringManagerAccountOption[];
  readonly selected: boolean;
  readonly onSelect: (seriesId: string) => void;
}

function RecurringSeriesListRow({ entry, accountOptions, selected, onSelect }: RecurringSeriesListRowProps) {
  const version = currentVersion(entry);
  const name = seriesDisplayName(entry);
  const account = seriesAccountLabel(entry, accountOptions);

  return <li className={selected ? "is-selected" : undefined}>
    <button
      className={`recurring-series-list-row is-${entry.state}${selected ? " is-selected" : ""}`}
      type="button"
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(entry.id)}
    >
      <span className="recurring-series-list-avatar" aria-hidden="true">{seriesInitial(name)}</span>
      <span className="recurring-series-list-copy"><strong>{name}</strong><small>{version ? `${version.kind} · ${frequencyLabel(version.frequency)} · ${account}` : "No effective version"}</small></span>
      <span className="recurring-series-list-state"><span className={`recurring-series-state-dot is-${entry.state}`} aria-hidden="true" />{entry.state}</span>
      <span className="recurring-series-list-next"><small>Next</small><strong>{entry.nextOccurrenceOn ?? "—"}</strong><span className="recurring-series-list-amount">{version ? <><strong>{dollars(version.amountMinor)}</strong><em>· {frequencyLabel(version.frequency)}</em></> : "—"}</span></span>
      <span className="recurring-series-list-chevron" aria-hidden="true">›</span>
    </button>
  </li>;
}

interface RecurringSeriesCardManagerProps {
  readonly entry: RecurringCashFlowSeriesView;
  readonly accountOptions: readonly RecurringManagerAccountOption[];
  readonly todayIso: string;
  readonly endOfYear: string;
  readonly onNotification: (state: CashFlowActionState) => void;
}

function RecurringSeriesCardManager({ entry, accountOptions, todayIso, endOfYear, onNotification }: RecurringSeriesCardManagerProps) {
  const [detailMenuOpen, setDetailMenuOpen] = useState(false);
  const [activeEditor, setActiveEditor] = useState<RecurringDetailEditor | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [historyVersionId, setHistoryVersionId] = useState<string | null>(null);
  const closeEditor = useCallback((): void => {
    setActiveEditor(null);
    setActiveGroupId(null);
    setHistoryVersionId(null);
  }, []);
  const versionFeedbackAction = useCallback(async (previousState: CashFlowActionState, formData: FormData): Promise<CashFlowActionState> => {
    const nextState = await changeRecurringSeriesVersionAction(previousState, formData);
    if (nextState.ok && nextState.message) {
      closeEditor();
      onNotification(nextState);
    }
    return nextState;
  }, [closeEditor, onNotification]);
  const deleteFeedbackAction = useCallback(async (previousState: CashFlowActionState, formData: FormData): Promise<CashFlowActionState> => {
    const nextState = await deleteRecurringSeriesAction(previousState, formData);
    if (nextState.ok && nextState.message) {
      closeEditor();
      onNotification(nextState);
    }
    return nextState;
  }, [closeEditor, onNotification]);
  const versionDeleteFeedbackAction = useCallback(async (previousState: CashFlowActionState, formData: FormData): Promise<CashFlowActionState> => {
    const nextState = await deleteRecurringSeriesVersionAction(previousState, formData);
    if (nextState.message) {
      closeEditor();
      onNotification(nextState);
    }
    return nextState;
  }, [closeEditor, onNotification]);
  const historyEditFeedbackAction = useCallback(async (previousState: CashFlowActionState, formData: FormData): Promise<CashFlowActionState> => {
    const nextState = await editRecurringSeriesVersionAction(previousState, formData);
    if (nextState.ok && nextState.message) {
      closeEditor();
      onNotification(nextState);
    }
    return nextState;
  }, [closeEditor, onNotification]);
  const [versionState, versionAction, versionPending] = useActionState(versionFeedbackAction, initialCashFlowActionState);
  const [stateState, stateAction, statePending] = useActionState(setRecurringSeriesStateAction, initialCashFlowActionState);
  const [countsAsExpenseState, countsAsExpenseAction, countsAsExpensePending] = useActionState(setRecurringTransferCountsAsExpenseAction, initialCashFlowActionState);
  const [endState, endAction, endPending] = useActionState(endRecurringSeriesAction, initialCashFlowActionState);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteFeedbackAction, initialCashFlowActionState);
  const [, versionDeleteAction, versionDeletePending] = useActionState(versionDeleteFeedbackAction, initialCashFlowActionState);
  const [historyEditState, historyEditAction, historyEditPending] = useActionState(historyEditFeedbackAction, initialCashFlowActionState);
  const [generationState, generationAction, generationPending] = useActionState(generateRecurringOccurrencesAction, initialCashFlowActionState);
  const [groupState, groupAction, groupPending] = useActionState(updateRecurringOverrideGroupAction, initialCashFlowActionState);
  const [restoreState, restoreAction, restorePending] = useActionState(restoreRecurringOccurrenceAction, initialCashFlowActionState);
  const version = currentVersion(entry);
  const account = version?.kind === "transfer"
    ? `${accountOptions.find((candidate) => candidate.id === version.fromAccountId)?.label ?? "Unknown source"} → ${accountOptions.find((candidate) => candidate.id === version.toAccountId)?.label ?? "Unknown destination"}`
    : version?.accountId ? accountOptions.find((candidate) => candidate.id === version.accountId)?.label ?? "Unknown account" : "Unassigned";
  const activeGroups = [...new Set(entry.exceptions.filter((exception) => exception.isActive && exception.overrideGroupId).map((exception) => exception.overrideGroupId!))];
  const individualExceptions = entry.exceptions.filter((exception) => exception.isActive && !exception.overrideGroupId);
  const activeExceptionCount = entry.exceptions.filter((exception) => exception.isActive).length;
  const detailTitleId = `recurring-detail-title-${entry.id}`;
  const activeGroupException = activeGroupId ? entry.exceptions.find((exception) => exception.overrideGroupId === activeGroupId && exception.isActive) ?? null : null;
  const openEditor = (editor: RecurringDetailEditor): void => {
    setDetailMenuOpen(false);
    setActiveEditor(editor);
  };
  const openVersionEditor = (history?: RecurringVersionView): void => {
    setDetailMenuOpen(false);
    setHistoryVersionId(history?.id ?? null);
    setActiveEditor("version");
  };
  const openVersionDelete = (history: RecurringVersionView): void => {
    setDetailMenuOpen(false);
    setHistoryVersionId(history.id);
    setActiveEditor("version-delete");
  };
  const historyVersion = historyVersionId ? entry.versions.find((candidate) => candidate.id === historyVersionId) ?? null : null;
  const versionFormSource = historyVersion ?? version;
  const currentVersionNextOccurrence = version?.nextOccurrenceOn ?? "";
  const versionPreviousEnd = version && currentVersionNextOccurrence ? previousRecurringOccurrence(version, currentVersionNextOccurrence) : "";

  const dialogs = <RecurringSeriesDialogs
    data={{
      entry, accountOptions, todayIso, endOfYear, version, historyVersion, versionFormSource,
      versionPreviousEnd, currentVersionNextOccurrence, activeGroupId, activeGroupException, activeEditor,
    }}
    actions={{
      version: { state: versionState, action: versionAction, pending: versionPending },
      historyEdit: { state: historyEditState, action: historyEditAction, pending: historyEditPending },
      deleteSeries: { state: deleteState, action: deleteAction, pending: deletePending },
      versionDelete: { action: versionDeleteAction, pending: versionDeletePending },
      group: { state: groupState, action: groupAction, pending: groupPending },
      restore: { state: restoreState, action: restoreAction, pending: restorePending },
      end: { state: endState, action: endAction, pending: endPending },
      generate: { state: generationState, action: generationAction, pending: generationPending },
    }}
    onClose={closeEditor}
    onOpenVersionEditor={openVersionEditor}
    onOpenVersionDelete={openVersionDelete}
  />;
  return <RecurringSeriesCard
    entry={entry}
    version={version}
    account={account}
    nextPaymentDistance={dateDistanceLabel(entry.nextOccurrenceOn, todayIso)}
    activeGroups={activeGroups}
    individualExceptions={individualExceptions}
    activeExceptionCount={activeExceptionCount}
    detailTitleId={detailTitleId}
    detailMenuOpen={detailMenuOpen}
    onDetailMenuOpenChange={setDetailMenuOpen}
    onOpenEditor={openEditor}
    onOpenVersionEditor={openVersionEditor}
    onOpenGroupEditor={(groupId) => { setActiveGroupId(groupId); setActiveEditor("group"); }}
    actions={{
      pause: { state: stateState, action: stateAction, pending: statePending },
      countsAsExpense: { state: countsAsExpenseState, action: countsAsExpenseAction, pending: countsAsExpensePending },
      restore: { action: restoreAction, pending: restorePending },
    }}
  >{dialogs}</RecurringSeriesCard>;
}

export function RecurringCashFlowManager({ series, accountOptions, todayIso }: RecurringCashFlowManagerProps) {
  const recurringPageSize = 10;
  const endOfYear = `${todayIso.slice(0, 4)}-12-31`;
  const orderedSeries = useMemo(() => sortSeriesForManager(series), [series]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<RecurringStatusFilter>("all");
  const [notification, setNotification] = useState<ActionNotificationState>({ ok: false, message: "" });
  const [kindFilter, setKindFilter] = useState<RecurringKindFilter>("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [sort, setSort] = useState<RecurringSort>("next");
  const [pageState, setPageState] = useState<{ readonly filterKey: string; readonly page: number }>({ filterKey: "", page: 1 });
  const [selectedSeries, setSelectedSeries] = useState<{ readonly hash: string; readonly id: string } | null>(null);
  const [jumpMenuOpen, setJumpMenuOpen] = useState(false);
  const activeSeriesCount = orderedSeries.filter((entry) => entry.state !== "ended").length;
  const hasNoSeries = orderedSeries.length === 0;
  const hasFilters = Boolean(query.trim()) || statusFilter !== "all" || kindFilter !== "all" || accountFilter !== "all" || sort !== "next";
  const filteredSeries = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const matchingSeries = orderedSeries.filter((entry) => {
      const version = currentVersion(entry);
      if (statusFilter !== "all" && entry.state !== statusFilter) return false;
      if (kindFilter !== "all" && version?.kind !== kindFilter) return false;
      if (accountFilter !== "all") {
        const accountIds = version?.kind === "transfer"
          ? [version.fromAccountId, version.toAccountId]
          : [version?.accountId];
        if (!accountIds.includes(accountFilter)) return false;
      }
      if (!normalizedQuery) return true;
      const searchableText = `${seriesDisplayName(entry)} ${version?.kind ?? ""} ${version?.frequency ?? ""} ${seriesAccountLabel(entry, accountOptions)}`.toLocaleLowerCase();
      return searchableText.includes(normalizedQuery);
    });
    return sortRecurringSeries(matchingSeries, sort);
  }, [accountFilter, accountOptions, kindFilter, orderedSeries, query, sort, statusFilter]);
  const pageCount = Math.max(1, Math.ceil(filteredSeries.length / recurringPageSize));
  const locationHash = useSyncExternalStore(subscribeToLocationChange, getLocationHash, () => "");
  const hashSeriesId = seriesIdFromHash(locationHash);
  const hashEntry = filteredSeries.find((entry) => entry.id === hashSeriesId) ?? null;
  const hashEntryId = hashEntry?.id;
  const selectedEntry = (selectedSeries?.hash === locationHash
    ? filteredSeries.find((entry) => entry.id === selectedSeries.id)
    : null) ?? hashEntry ?? filteredSeries[0] ?? null;
  const selectedIndex = selectedEntry ? filteredSeries.findIndex((entry) => entry.id === selectedEntry.id) : -1;
  const selectionPage = selectedIndex >= 0 ? Math.floor(selectedIndex / recurringPageSize) + 1 : 1;
  const filterKey = JSON.stringify([accountFilter, kindFilter, query, sort, statusFilter]);
  const page = pageState.filterKey === filterKey ? pageState.page : selectionPage;
  const currentPage = Math.max(1, Math.min(page, pageCount));
  const setPage = (nextPage: number | ((currentPage: number) => number)): void => {
    setPageState((current) => {
      const currentPage = current.filterKey === filterKey ? current.page : selectionPage;
      return { filterKey, page: typeof nextPage === "function" ? nextPage(currentPage) : nextPage };
    });
  };
  const visibleSeries = filteredSeries.slice((currentPage - 1) * recurringPageSize, currentPage * recurringPageSize);
  const rangeStart = filteredSeries.length === 0 ? 0 : (currentPage - 1) * recurringPageSize + 1;
  const rangeEnd = Math.min(currentPage * recurringPageSize, filteredSeries.length);
  const jumpLinks = useMemo(
    () => orderedSeries.map((entry) => ({
      id: entry.id,
      name: seriesDisplayName(entry),
      account: seriesAccountLabel(entry, accountOptions),
      state: entry.state,
      home: entry.homeHouseholdFrequency ?? null,
    })),
    [orderedSeries, accountOptions],
  );
  const jumpListRef = useRef<HTMLDivElement>(null);
  // Keep the first render visually stable; the layout effect then tightens
  // this count to the exact width available before the browser paints.
  const [visibleJumpCount, setVisibleJumpCount] = useState(Math.min(5, jumpLinks.length));
  const visibleJumpLinks = jumpLinks.slice(0, visibleJumpCount);
  const overflowJumpLinks = jumpLinks.slice(visibleJumpCount);

  const resetFilters = (): void => {
    setQuery("");
    setStatusFilter("all");
    setKindFilter("all");
    setAccountFilter("all");
    setSort("next");
    setSelectedSeries(null);
  };

  const selectSeries = (seriesId: string): void => {
    setJumpMenuOpen(false);
    setSelectedSeries({ hash: locationHash, id: seriesId });
    const matchingIndex = filteredSeries.findIndex((entry) => entry.id === seriesId);
    if (matchingIndex >= 0) setPage(Math.floor(matchingIndex / recurringPageSize) + 1);
    const href = `#${recurringSeriesAnchorId(seriesId)}`;
    window.history.replaceState(null, "", href);
    if (window.matchMedia("(max-width: 1100px)").matches) {
      window.requestAnimationFrame(() => scrollToSeriesAnchor(seriesId));
    }
  };

  useLayoutEffect(() => {
    const list = jumpListRef.current;
    if (!list) return;

    const measure = (): void => {
      const availableWidth = list.clientWidth;
      const items = Array.from(list.querySelectorAll<HTMLElement>("[data-recurring-jump-measure]"));
      if (availableWidth <= 0 || items.length === 0) return;
      const gap = Number.parseFloat(window.getComputedStyle(list).columnGap) || 0;
      const widths = items.map((item) => item.offsetWidth);
      const allWidth = widths.reduce((total, width) => total + width, 0) + gap * Math.max(0, widths.length - 1);
      if (allWidth <= availableWidth) {
        setVisibleJumpCount(jumpLinks.length);
        return;
      }

      // Reserve enough space for the inline overflow control, including its
      // icon and a two-digit count, before admitting another visible chip.
      const moreControlWidth = 96;
      let usedWidth = 0;
      let visibleCount = 0;
      for (const width of widths) {
        const nextWidth = usedWidth + (visibleCount > 0 ? gap : 0) + width;
        const widthWithMore = nextWidth + gap + moreControlWidth;
        if (widthWithMore > availableWidth) break;
        usedWidth = nextWidth;
        visibleCount += 1;
      }
      setVisibleJumpCount(visibleCount);
    };

    const frame = window.requestAnimationFrame(measure);
    if (typeof ResizeObserver === "undefined") {
      return () => window.cancelAnimationFrame(frame);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [jumpLinks]);

  useEffect(() => {
    if (!hashEntryId) return;
    // Wait a frame so layout is ready after navigation.
    const frame = window.requestAnimationFrame(() => scrollToSeriesAnchor(hashEntryId));
    return () => window.cancelAnimationFrame(frame);
  }, [hashEntryId]);

  return <div className="recurring-manager">
    {hasNoSeries ? <ModuleFirstUseCard headingId="recurring-first-use-heading" title="Add your first income" description="Start with a paycheque or other recurring income so Cash Flow can build a useful rhythm around your main account." actionHref="#recurring-create" actionLabel="Add first income" supportingText="Main account → recurring income → planned occurrences" seed="recurring-first-use" /> : null}

    {!hasNoSeries ? <>
      <div className="recurring-workspace-grid">
        <section className="recurring-series-list-panel" aria-labelledby="recurring-series-list-title">
          <div className={`recurring-panel-header recurring-series-list-header${hasFilters ? " has-filter-clear" : ""}`}>
            <div className="recurring-manager-toolbar" role="search" aria-label="Recurring series filters">
              <label className="recurring-toolbar-search"><span className="sr-only">Search recurring series</span><input type="search" value={query} onChange={(event) => { setSelectedSeries(null); setQuery(event.target.value); }} placeholder="Search series…" aria-label="Search recurring series" /></label>
              <label className="recurring-toolbar-control"><span>Status</span><InvestmentDropdown value={statusFilter} options={statusFilterOptions} onChange={(value) => { setSelectedSeries(null); setStatusFilter(value as RecurringStatusFilter); }} aria-label="Filter by status" floating floatingMinWidth={200} /></label>
              <label className="recurring-toolbar-control"><span>Type</span><InvestmentDropdown value={kindFilter} options={kindFilterOptions} onChange={(value) => { setSelectedSeries(null); setKindFilter(value as RecurringKindFilter); }} aria-label="Filter by type" floating floatingMinWidth={200} /></label>
              <label className="recurring-toolbar-control"><span>Account</span><InvestmentDropdown value={accountFilter} options={[{ value: "all", label: "All accounts" }, ...accountOptions.map((account) => ({ value: account.id, label: account.label }))]} onChange={(value) => { setSelectedSeries(null); setAccountFilter(value); }} aria-label="Filter by account" floating floatingMinWidth={240} /></label>
            </div>
            {hasFilters ? <button className="recurring-toolbar-clear" type="button" onClick={resetFilters} aria-label="Clear recurring series filters" title="Clear filters"><svg aria-hidden="true" viewBox="0 0 20 20" fill="none"><path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></button> : null}
          </div>
          <div className="recurring-series-list-head"><h4 id="recurring-series-list-title">{hasFilters ? `${filteredSeries.length} matching series` : `${activeSeriesCount} active series`}</h4><label className="recurring-sort-control"><span>Sort by:</span><InvestmentDropdown value={sort} options={sortOptions} onChange={(value) => setSort(value as RecurringSort)} aria-label="Sort recurring series" floating floatingMinWidth={180} /></label></div>
          {filteredSeries.length > 0 ? <ul className="recurring-series-list">{visibleSeries.map((entry) => <RecurringSeriesListRow key={entry.id} entry={entry} accountOptions={accountOptions} selected={selectedEntry?.id === entry.id} onSelect={selectSeries} />)}</ul> : <div className="recurring-series-empty"><strong>No matching series</strong><p>Adjust the search or filters to see another recurring schedule.</p><button className="account-secondary-button" type="button" onClick={resetFilters}>Clear filters</button></div>}
          {filteredSeries.length > 0 ? <div className="recurring-series-pagination"><span>Showing {rangeStart}–{rangeEnd} of {filteredSeries.length}</span><div><button className="account-secondary-button" type="button" aria-label="Previous page" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={currentPage === 1}>‹</button><span aria-current="page">{currentPage} / {pageCount}</span><button className="account-secondary-button" type="button" aria-label="Next page" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={currentPage === pageCount}>›</button></div></div> : null}
        </section>
        <section className="recurring-series-detail-panel" aria-label="Selected recurring series">
          {jumpLinks.length > 0 ? <nav className="recurring-panel-header recurring-series-jump" aria-label="Jump to recurring series">
            <div className="recurring-series-jump-head"><strong>Jump to series</strong><span>{activeSeriesCount} active · {filteredSeries.length} shown</span></div>
            <div ref={jumpListRef} className="recurring-series-jump-list">
              <div className="recurring-series-jump-measure" aria-hidden="true">{jumpLinks.map((link) => <span key={link.id} className={`recurring-series-jump-chip${link.state === "ended" ? " is-ended" : ""}${link.home ? " is-home" : ""}`} data-recurring-jump-measure><span className="recurring-series-jump-chip-text"><strong>{link.name}</strong><em>{link.account}</em></span>{link.home ? <small>Home</small> : null}{link.state !== "active" ? <small>{link.state}</small> : null}</span>)}</div>
              {visibleJumpLinks.map((link) => <a key={link.id} className={`recurring-series-jump-chip${link.state === "ended" ? " is-ended" : ""}${link.home ? " is-home" : ""}`} href={`#${recurringSeriesAnchorId(link.id)}`} onClick={(event) => { event.preventDefault(); selectSeries(link.id); }}><span className="recurring-series-jump-chip-text"><strong>{link.name}</strong><em>{link.account}</em></span>{link.home ? <small>Home</small> : null}{link.state !== "active" ? <small>{link.state}</small> : null}</a>)}
              {overflowJumpLinks.length > 0 ? <details className="recurring-series-jump-more-wrap" open={jumpMenuOpen} onToggle={(event) => setJumpMenuOpen(event.currentTarget.open)}><summary className="recurring-series-jump-chip recurring-series-jump-more">+{overflowJumpLinks.length} more<ChevronDown aria-hidden="true" size={15} strokeWidth={1.8} /></summary><div className="recurring-series-jump-more-menu" aria-label="More recurring series">{overflowJumpLinks.map((link) => <a key={link.id} className={`recurring-series-jump-more-item${link.state === "ended" ? " is-ended" : ""}`} href={`#${recurringSeriesAnchorId(link.id)}`} onClick={(event) => { event.preventDefault(); selectSeries(link.id); }}><span><strong>{link.name}</strong><small>{link.account}</small></span><ChevronRight aria-hidden="true" size={15} strokeWidth={1.8} /></a>)}</div></details> : null}
            </div>
          </nav> : null}
          {selectedEntry ? <RecurringSeriesCardManager key={selectedEntry.id} entry={selectedEntry} accountOptions={accountOptions} todayIso={todayIso} endOfYear={endOfYear} onNotification={setNotification} /> : <div className="recurring-series-detail-empty"><strong>Select a recurring series</strong><p>Series details and available actions will appear here.</p></div>}
        </section>
      </div>
    </> : <p className="insight">No recurring Cash Flow series have been added.</p>}

    <RecurringCreateDialog key={hasNoSeries ? "first-use" : "standard"} accountOptions={accountOptions} todayIso={todayIso} open={hasNoSeries} firstUse={hasNoSeries} />
    <ActionNotification state={notification} />
  </div>;
}
