"use client";

import { Fragment, memo, startTransition, useActionState, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, ChevronDown, Landmark, LockKeyhole, ShieldCheck, ShoppingCart, TrendingUp, Wallet, type LucideIcon } from "lucide-react";
import { type CashFlowAccountPeriodProjection, type CashFlowItem, type CashFlowProjectionMovement, type ChainedCashFlowPeriodProjection, type PayPeriod } from "@athena/finance-engine";
import { createCashFlowTransactionAction, excludeCashFlowExpenseAction, recordCashFlowPaydayBalanceAction, resetCashFlowPaydayBalanceAction, restoreCashFlowExpenseAction, toggleCashFlowAccountVisibilityAction, updateCashFlowPaydayNoteAction, updateCashFlowRecordAction } from "./actions";
import { applyRecurringOccurrenceExceptionAction, restoreRecurringOccurrenceAction } from "./recurring-actions";
import { focusIfConnected, initialCashFlowActionState, shouldCloseSuccessfulAction } from "./action-helpers";
import { AnimatedLineBackground } from "../components/animated-line-background";
import { ActionNotification } from "../components/action-notification";
import { ConfirmationDialog } from "../components/confirmation-dialog";
import { FormDropdown } from "../components/form-dropdown";
import { InvestmentDropdown, type InvestmentDropdownOption } from "../investments/investment-dropdown";
import { cashFlowCurrentPeriodHref, cashFlowPaydayVariance, cashFlowPeriodHref, cashFlowPeriodTimelineMetrics, cashFlowProjectionMovementLabel, groupCashFlowMovementsBySection } from "./presentation";
import { buildCashFlowRecurringOptions, getCashFlowOccurrenceEditorModel, type CashFlowRecurringOption } from "./recurring-editor";
import { useDeferredDetails } from "./use-deferred-details";
import { isRecurringDetails, isExcludedDetails } from "./deferred-detail-types";
import { expandCashFlowRecurringRangeOptions, type CashFlowRecurringRangeSegment } from "./recurring-range-options";
import { recurringSeriesHref } from "./recurring-manager";
import { periodPositionLabel, periodStateLabel } from "@athena/database/account-timeline";
import { formatMoneyInputMinor, formatMoneyMinor, formatSignedMoneyMinor } from "../../lib/format-money";

const dollars = (minor: number) => formatMoneyMinor(minor);
const cashFlowDateFormatter = new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const displayDate = (iso: string) => cashFlowDateFormatter.format(new Date(`${iso}T00:00:00Z`));
function NumericDate({ iso }: { readonly iso: string }) {
  const parts = cashFlowDateFormatter.formatToParts(new Date(`${iso}T00:00:00Z`));
  return <>{parts.map((part, index) => part.type === "day" || part.type === "year"
    ? <span className="font-numeric" key={`${part.type}-${index}`}>{part.value}</span>
    : part.value)}</>;
}
const compactViewportQuery = "(max-width: 720px)";

function subscribeCompactViewport(onChange: () => void): () => void {
  const query = window.matchMedia(compactViewportQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getCompactViewportSnapshot(): boolean {
  return typeof window !== "undefined" && window.matchMedia(compactViewportQuery).matches;
}

const transactionKindOptions: readonly InvestmentDropdownOption<"income" | "expense">[] = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
];
const exceptionKindOptions: readonly InvestmentDropdownOption[] = [
  { value: "override", label: "Override" },
  { value: "skip", label: "Skip" },
];
const statusOverrideOptions: readonly InvestmentDropdownOption[] = [
  { value: "planned", label: "Planned" },
];

export type SerializedPayPeriod = PayPeriod & { startsOn: string; endsOn: string; status: string };
export type { CashFlowRecurringOption } from "./recurring-editor";
export type RecurringCashFlowItem = CashFlowItem & { readonly recurringSeriesId?: string; readonly recurringOccurrenceId?: string; readonly scheduledOccurrenceOn?: string; readonly generated?: boolean; readonly recurringState?: "regular" | "modified" | "skipped" | "actual" | "manual" };
export interface SerializedCashFlowPaydayCheck { readonly id: string; readonly accountId: string; readonly payDate: string; readonly projectedBalanceMinor: number; readonly actualBalanceMinor: number; readonly varianceMinor: number; readonly note?: string | null }
export type SerializedCashFlowMovement = Omit<Pick<CashFlowProjectionMovement, "recordId" | "date" | "kind" | "amountMinor" | "description" | "countsAsExpense">, "description"> & { readonly description?: string };
export type SerializedCashFlowAccountPeriodProjection = Omit<CashFlowAccountPeriodProjection, "movements"> & { readonly movements: readonly SerializedCashFlowMovement[] };
export type SerializedCashFlowProjection = Omit<ChainedCashFlowPeriodProjection, "accounts"> & { readonly accounts: readonly SerializedCashFlowAccountPeriodProjection[] };
export interface SerializedCashFlowPeriod { readonly period: Omit<SerializedPayPeriod, "items"> & { readonly items: readonly RecurringCashFlowItem[] }; readonly editableIncomeId: string | null; readonly projection: SerializedCashFlowProjection; readonly observedMainAccountBalanceMinor: number | null; readonly paydayCheck: SerializedCashFlowPaydayCheck | null; readonly paydayNote: string | null }
export interface CashFlowAccountOption { readonly id: string; readonly label: string; readonly includeInAvailableCash: boolean; readonly isVisibleInCashFlow: boolean }
export interface SerializedExcludedExpense { readonly id: string; readonly accountName: string; readonly recurringTransactionId: string | null; readonly transactionDate: string; readonly status: "actual" | "planned"; readonly description: string; readonly category: string | null; readonly amountMinor: number }
interface CashFlowClientProps { readonly initialPeriods: readonly SerializedCashFlowPeriod[]; readonly selectedPeriodId: string; readonly currentPeriodId: string | null; readonly currentPeriodPayDate: string | null; readonly totalPeriodCount: number; readonly showAll: boolean; readonly todayIso: string; readonly accountOptions: readonly CashFlowAccountOption[]; readonly paydayCheckAccountId: string | null; readonly visibleAccountIds: readonly string[]; readonly showAllAccounts: boolean; readonly recurringOptions: readonly CashFlowRecurringOption[]; readonly excludedExpenses: readonly SerializedExcludedExpense[]; readonly recurringRangeSegments: readonly CashFlowRecurringRangeSegment[]; readonly deferredDetails?: boolean; readonly excludedExpenseCount?: number; readonly relevantRecurringVersionIds?: readonly string[] }
interface NewCashFlowTransactionDraft { readonly accountId: string; readonly accountName: string; readonly transactionDate: string; readonly kind: "income" | "expense"; readonly description: string; readonly amount: string }

type MovementItemIndex = ReadonlyMap<string, RecurringCashFlowItem>;

function movementItemKey(recordId: string, direction?: "in" | "out"): string {
  return `${recordId}:${direction ?? "record"}`;
}

function buildMovementItemIndex(items: readonly RecurringCashFlowItem[]): MovementItemIndex {
  const index = new Map<string, RecurringCashFlowItem>();
  for (const item of items) index.set(movementItemKey(item.recordId ?? item.id, item.direction), item);
  return index;
}

function movementItem(movement: Pick<CashFlowProjectionMovement, "kind" | "recordId">, index: MovementItemIndex): RecurringCashFlowItem | null {
  if (movement.kind === "anchor") return null;
  const direction = movement.kind === "transfer-in" ? "in" : movement.kind === "transfer-out" ? "out" : undefined;
  return index.get(movementItemKey(movement.recordId, direction)) ?? null;
}
function movementSignedAmount(movement: Pick<CashFlowProjectionMovement, "kind" | "amountMinor">): number | null { if (movement.kind === "anchor") return null; return movement.kind === "income" || movement.kind === "transfer-in" ? movement.amountMinor : -movement.amountMinor; }
function periodStateClass(status: string): string { return status === "actual" ? "is-actual" : status === "projected" ? "is-projected" : "is-mixed"; }
function formatTimelineMetricAmount(metric: { readonly amountMinor: number | null; readonly signed?: boolean }): string {
  if (metric.amountMinor === null) return "Unavailable";
  if (metric.signed) return formatSignedMoneyMinor(metric.amountMinor, { zeroSign: "+" });
  return dollars(metric.amountMinor);
}
function formatSignedChange(amountMinor: number | null): string {
  return formatSignedMoneyMinor(amountMinor, { zeroSign: "+" });
}
function cashFlowChangeClass(amountMinor: number | null): string | undefined {
  if (amountMinor === null) return undefined;
  return amountMinor >= 0 ? "cash-flow-change is-up" : "cash-flow-change is-down";
}
function periodProgressPercent(startsOn: string, endsOn: string, todayIso: string): number {
  const start = Date.parse(`${startsOn}T00:00:00Z`);
  const end = Date.parse(`${endsOn}T00:00:00Z`);
  const today = Date.parse(`${todayIso}T00:00:00Z`);
  const total = end - start;
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round(((today - start) / total) * 100)));
}
function CashFlowSummaryMetric({ icon: Icon, label, value, className }: { readonly icon: LucideIcon; readonly label: string; readonly value: string; readonly className?: string }) {
  return <div className="cash-flow-summary-metric">
    <span className="cash-flow-summary-icon"><Icon aria-hidden="true" size={18} strokeWidth={1.8} /></span>
    <span><small>{label}</small><strong className={className}>{value}</strong></span>
  </div>;
}

function paydayVarianceText(amountMinor: number | null): string {
  if (amountMinor === null) return "Unavailable";
  if (amountMinor === 0) return "On projection";
  return `${amountMinor > 0 ? "Over" : "Under"} projection · ${formatSignedChange(amountMinor)}`;
}

function paydayVarianceClass(amountMinor: number | null): string | undefined {
  if (amountMinor === null || amountMinor === 0) return undefined;
  return amountMinor > 0 ? "cash-flow-payday-check-variance is-over" : "cash-flow-payday-check-variance is-under";
}

function CashFlowPaydayCheck({ accountOptions, accountId, payDate, todayIso, projectedAtPaydayMinor, observedBalanceMinor, note, saveAction, noteAction, resetAction, saveState, noteState, resetState, savePending, notePending, resetPending }: {
  readonly accountOptions: readonly CashFlowAccountOption[];
  readonly accountId: string | null;
  readonly payDate: string;
  readonly todayIso: string;
  readonly projectedAtPaydayMinor: number | null;
  readonly observedBalanceMinor: number | null;
  readonly note: string | null;
  readonly saveAction: (formData: FormData) => void;
  readonly noteAction: (formData: FormData) => void;
  readonly resetAction: (formData: FormData) => void;
  readonly saveState: { readonly ok: boolean; readonly message: string };
  readonly noteState: { readonly ok: boolean; readonly message: string };
  readonly resetState: { readonly ok: boolean; readonly message: string };
  readonly savePending: boolean;
  readonly notePending: boolean;
  readonly resetPending: boolean;
}) {
  const account = accountId ? accountOptions.find((option) => option.id === accountId) ?? null : null;
  const isCompactViewport = useSyncExternalStore(subscribeCompactViewport, getCompactViewportSnapshot, () => false);
  const [uiState, setUiState] = useState(() => ({
    accountId,
    payDate,
    note: note ?? "",
    noteDraft: note ?? "",
    noteOpen: false,
    detailsOpenOverride: null as boolean | null,
    resetConfirmationOpen: false,
  }));
  if (uiState.accountId !== accountId || uiState.payDate !== payDate || uiState.note !== (note ?? "")) {
    setUiState({
      accountId,
      payDate,
      note: note ?? "",
      noteDraft: note ?? "",
      noteOpen: false,
      detailsOpenOverride: null,
      resetConfirmationOpen: false,
    });
  }
  const { noteDraft, noteOpen, detailsOpenOverride, resetConfirmationOpen } = uiState;
  const detailsOpen = detailsOpenOverride ?? !isCompactViewport;
  const noteFormId = `cash-flow-payday-note-${accountId ?? "none"}-${payDate}`;
  const noteFieldId = `cash-flow-payday-note-field-${accountId ?? "none"}-${payDate}`;
  const hasSavedNote = Boolean(note?.trim());
  const isPastOrCurrent = payDate <= todayIso;
  const variance = account && isPastOrCurrent ? cashFlowPaydayVariance(projectedAtPaydayMinor, observedBalanceMinor) : null;
  const confirmReset = () => {
    const formData = new FormData();
    formData.set("accountId", account?.id ?? "");
    formData.set("asOf", payDate);
    setUiState((current) => ({ ...current, resetConfirmationOpen: false }));
    startTransition(() => resetAction(formData));
  };
  return <section className="cash-flow-payday-check" aria-labelledby="cash-flow-payday-check-heading">
    <button className="cash-flow-payday-check-mobile-toggle" type="button" onClick={() => setUiState((current) => ({ ...current, detailsOpenOverride: !detailsOpen }))} aria-expanded={detailsOpen} aria-controls="cash-flow-payday-check-details">
      <span className="cash-flow-payday-check-mobile-copy"><strong>Payday check</strong><small>{account?.label ?? "Main available-cash account"}</small></span>
      <span className={`cash-flow-payday-check-mobile-status ${observedBalanceMinor === null ? "is-pending" : "is-confirmed"}`}>{observedBalanceMinor === null ? "Needs review" : "Confirmed"}</span>
      <ChevronDown aria-hidden="true" size={18} strokeWidth={1.8} className={detailsOpen ? "is-open" : undefined} />
    </button>
    <div className="cash-flow-payday-check-head">
      <div className="cash-flow-payday-check-title">
        <span className="cash-flow-payday-check-title-icon"><Landmark aria-hidden="true" size={22} strokeWidth={1.5} /></span>
        <div>
          <h3 id="cash-flow-payday-check-heading">Payday check</h3>
          <strong>{account?.label ?? "Main available-cash account"}</strong>
        </div>
      </div>
      {observedBalanceMinor !== null ? <div className="cash-flow-payday-check-head-actions">
        <span className="cash-flow-payday-check-confirmed"><ShieldCheck aria-hidden="true" size={15} strokeWidth={1.8} />Confirmed</span>
        <div className="cash-flow-payday-check-reset-form">
          <button className="account-secondary-button" type="button" disabled={savePending || notePending || resetPending} aria-haspopup="dialog" aria-expanded={resetConfirmationOpen} onClick={() => setUiState((current) => ({ ...current, resetConfirmationOpen: true }))}>{resetPending ? "Resetting…" : "Reset"}</button>
        </div>
      </div> : null}
    </div>
    <div id="cash-flow-payday-check-details" className={`cash-flow-payday-check-details${detailsOpen ? " is-open" : ""}`}>
    {!account ? <p className="cash-flow-payday-check-guidance">Mark exactly one active account as Included in available cash to use payday checks.</p>
      : !isPastOrCurrent ? <p className="cash-flow-payday-check-guidance">Observed balances become available when {displayDate(payDate)} is current.</p>
        : <>
          <div className="cash-flow-payday-check-grid">
            <div className="cash-flow-payday-check-column cash-flow-payday-check-projected">
              <small>Projected at payday</small>
              <strong>{projectedAtPaydayMinor === null ? "Unavailable" : dollars(projectedAtPaydayMinor)}</strong>
              <div className="cash-flow-payday-check-decoration" aria-hidden="true"><span /><span><TrendingUp size={14} strokeWidth={1.8} /></span><span /></div>
            </div>
            <div className="cash-flow-payday-check-column cash-flow-payday-check-actual">
              <form action={saveAction} className="cash-flow-payday-check-form">
                <input type="hidden" name="accountId" value={account.id} />
                <input type="hidden" name="asOf" value={payDate} />
                <input type="hidden" name="note" value={noteDraft} />
                <label htmlFor="cash-flow-payday-balance">Actual at payday</label>
                <div className="cash-flow-payday-check-input-row">
                  <input id="cash-flow-payday-balance" name="balance" type="text" inputMode="decimal" pattern="^-?\d+(\.\d{1,2})?$" placeholder="0.00" defaultValue={observedBalanceMinor === null ? "" : formatMoneyInputMinor(observedBalanceMinor)} aria-label={`Actual balance for ${account.label} on ${displayDate(payDate)}`} required disabled={savePending || notePending || resetPending} />
                  <button className="account-primary-button" type="submit" disabled={savePending || notePending || resetPending}>{savePending ? "Saving…" : "Save"}</button>
                </div>
                {noteOpen ? <label className="cash-flow-payday-note-field" htmlFor={noteFieldId}>
                  <span>Period note</span>
                  <textarea id={noteFieldId} value={noteDraft} onChange={(event) => setUiState((current) => ({ ...current, noteDraft: event.target.value }))} maxLength={500} rows={3} placeholder="Why was this balance different?" disabled={savePending || notePending || resetPending} />
                  <small>{noteDraft.length}/500</small>
                </label> : null}
              </form>
              {noteOpen ? <>
                <form id={noteFormId} action={noteAction} className="cash-flow-payday-note-form">
                  <input type="hidden" name="accountId" value={account.id} />
                  <input type="hidden" name="asOf" value={payDate} />
                  <input type="hidden" name="note" value={noteDraft} />
                </form>
                <div className="cash-flow-payday-note-actions">
                  <p className="cash-flow-payday-check-helper"><LockKeyhole aria-hidden="true" size={13} strokeWidth={2} />Enter the actual balance available on payday</p>
                  <button className="account-secondary-button" type="submit" form={noteFormId} disabled={savePending || notePending || resetPending}>{notePending ? "Saving note…" : "Save note"}</button>
                </div>
              </> : <p className="cash-flow-payday-check-helper"><LockKeyhole aria-hidden="true" size={13} strokeWidth={2} />Enter the actual balance available on payday</p>}
            </div>
            <div className="cash-flow-payday-check-column cash-flow-payday-check-variance-column">
              <div className="cash-flow-payday-check-variance-heading">
                <small>Variance</small>
                <button className="cash-flow-payday-note-toggle" type="button" onClick={() => setUiState((current) => ({ ...current, noteOpen: !current.noteOpen }))} aria-expanded={noteOpen} aria-controls={noteOpen ? noteFieldId : undefined}>{noteOpen ? "Close note" : hasSavedNote ? "Edit note" : "Add note"}</button>
              </div>
              {variance === null ? <strong>Unavailable</strong> : <><span className={`cash-flow-payday-check-variance-label ${variance > 0 ? "is-over" : variance < 0 ? "is-under" : ""}`}>{variance > 0 ? "Over projection" : variance < 0 ? "Under projection" : "On projection"}</span><strong className={paydayVarianceClass(variance)}>{formatSignedChange(variance)}</strong></>}
              <div className="cash-flow-payday-check-decoration" aria-hidden="true"><span /><span><TrendingUp size={14} strokeWidth={1.8} /></span><span /></div>
            </div>
          </div>
          <ActionNotification state={saveState} />
          {noteState.message ? <p className={`cash-flow-action-message ${noteState.ok ? "is-success" : "is-error"}`} role={noteState.ok ? "status" : "alert"}>{noteState.message}</p> : null}
          {resetState.message ? <p className={`cash-flow-action-message ${resetState.ok ? "is-success" : "is-error"}`} role={resetState.ok ? "status" : "alert"}>{resetState.message}</p> : null}
        </>}
    </div>
    {resetConfirmationOpen ? <ConfirmationDialog
      open
      title="Reset this observed payday balance?"
      description="Future projections will recalculate from the previous anchor."
      confirmLabel="Reset"
      tone="danger"
      pending={resetPending}
      onConfirm={confirmReset}
      onCancel={() => setUiState((current) => ({ ...current, resetConfirmationOpen: false }))}
    /> : null}
  </section>;
}

const PeriodRow = memo(function PeriodRow({ entry, selected, showAll, showAllAccounts, currentPayday, showPaydayCheck }: { readonly entry: SerializedCashFlowPeriod; readonly selected: boolean; readonly showAll: boolean; readonly showAllAccounts: boolean; readonly currentPayday: string | null; readonly showPaydayCheck: boolean }) {
  const projection = entry.projection;
  const metrics = cashFlowPeriodTimelineMetrics(projection);
  const changeMetric = metrics.find((metric) => metric.label === "Change") ?? null;
  const availableMetric = metrics.find((metric) => metric.label === "Available ending") ?? null;
  const incomeMetric = metrics.find((metric) => metric.label === "Income") ?? null;
  const spendingMetric = metrics.find((metric) => metric.label === "Spending") ?? null;
  const mainMetrics = metrics.filter((metric) => metric.label !== "Change");
  const roleLabel = periodPositionLabel(entry.period.payDate, currentPayday);
  return <a className={`cash-flow-period-row${selected ? " is-selected" : ""}${showPaydayCheck ? " has-payday-check" : ""}`} href={cashFlowPeriodHref(entry.period.id, showAll, showAllAccounts)} aria-current={selected ? "page" : undefined}>
    <span className={`cash-flow-period-marker ${selected ? "is-current" : roleLabel === "Past" ? "is-past" : "is-projected"}`} aria-hidden="true" />
    <span className="cash-flow-period-identity">
      <span className="cash-flow-period-date"><strong>{displayDate(entry.period.payDate)}</strong><small>{roleLabel}</small></span>
      <span className={`timeline-status-badge ${periodStateClass(entry.period.status)}`}>{periodStateLabel(entry.period.status)}</span>
    </span>
    <span className="cash-flow-period-desktop-metrics">
    {mainMetrics.map((metric, index) => <Fragment key={metric.label}>
      <span><small>{metric.label}</small><strong className={metric.emphasis}>{formatTimelineMetricAmount(metric)}</strong></span>
      {index === 2 ? <span className="cash-flow-period-metrics-separator is-after-three" aria-hidden="true" /> : null}
      {index === 3 ? <span className="cash-flow-period-metrics-separator is-after-four" aria-hidden="true" /> : null}
    </Fragment>)}
    {showPaydayCheck || changeMetric ? <span className="cash-flow-period-metrics-separator is-before-additional" aria-hidden="true" /> : null}
    {showPaydayCheck ? <span className="cash-flow-period-payday-check">
      <small>Payday check</small>
      {entry.paydayCheck ? <><strong>{dollars(entry.paydayCheck.projectedBalanceMinor)} → {dollars(entry.paydayCheck.actualBalanceMinor)}</strong><em className={paydayVarianceClass(entry.paydayCheck.varianceMinor)}>{paydayVarianceText(entry.paydayCheck.varianceMinor)}</em></> : <strong>Not recorded</strong>}
    </span> : null}
    {changeMetric ? <span className="cash-flow-period-change"><small>{changeMetric.label}</small><strong className={cashFlowChangeClass(changeMetric.amountMinor)}>{formatTimelineMetricAmount(changeMetric)}</strong></span> : null}
    </span>
    <span className="cash-flow-period-mobile-summary">
      <span><small>Available ending</small><strong>{availableMetric ? formatTimelineMetricAmount(availableMetric) : "Unavailable"}</strong></span>
      <span><small>Change</small><strong className={cashFlowChangeClass(changeMetric?.amountMinor ?? null)}>{changeMetric ? formatTimelineMetricAmount(changeMetric) : "Unavailable"}</strong></span>
      <small className="cash-flow-period-mobile-submetrics">{incomeMetric ? formatTimelineMetricAmount(incomeMetric) : "Unavailable"} income · {spendingMetric ? formatTimelineMetricAmount(spendingMetric) : "Unavailable"} spending</small>
    </span>
  </a>;
});
function AccountProjectionCard({ account, itemIndex, onEdit, onAdd, isVisibleInCashFlow }: { readonly account: SerializedCashFlowAccountPeriodProjection; readonly itemIndex: MovementItemIndex; readonly onEdit: (item: RecurringCashFlowItem, trigger: HTMLButtonElement) => void; readonly onAdd: (accountId: string, accountName: string) => void; readonly isVisibleInCashFlow: boolean }) {
  const changeMinor = account.openingBalanceMinor === null || account.endingBalanceMinor === null ? null : account.endingBalanceMinor - account.openingBalanceMinor;
  return <section className="cash-flow-account-group cash-flow-account-projection" aria-labelledby={`cash-flow-account-${account.accountId}`}>
    <div className="cash-flow-account-group-head">
      <div>
        <div className="cash-flow-account-group-title-row">
          <h4 id={`cash-flow-account-${account.accountId}`}>{account.accountName}</h4>
          <form action={toggleCashFlowAccountVisibilityAction} className="cash-flow-account-visibility-form">
            <input type="hidden" name="accountId" value={account.accountId} />
            <input type="hidden" name="isVisibleInCashFlow" value={isVisibleInCashFlow ? "false" : "true"} />
            <button className="cash-flow-account-visibility-button" type="submit" aria-label={`${isVisibleInCashFlow ? "Hide" : "Unhide"} ${account.accountName} in Cash Flow`}>{isVisibleInCashFlow ? "Hide" : "Unhide"}</button>
          </form>
        </div>
        <span>{account.includeInAvailableCash ? "Included in available cash" : "Excluded from available cash"}</span>
      </div>
      <div className="cash-flow-account-group-head-total">
        <strong>{account.endingBalanceMinor === null ? "Unavailable" : dollars(account.endingBalanceMinor)}</strong>
        <span className={cashFlowChangeClass(changeMinor)}>{formatSignedChange(changeMinor)}</span>
      </div>
    </div>
    <div className="cash-flow-account-balance-strip">
      <span><small>Opening</small><strong>{account.openingBalanceMinor === null ? "Unavailable" : dollars(account.openingBalanceMinor)}</strong></span>
      <span><small>Ending</small><strong>{account.endingBalanceMinor === null ? "Unavailable" : dollars(account.endingBalanceMinor)}</strong></span>
    </div>
    <div className="cash-flow-account-list-toolbar">
      <button className="cash-flow-add-button" type="button" aria-label={`Add transaction to ${account.accountName}`} onClick={() => onAdd(account.accountId, account.accountName)}>+ Add</button>
    </div>
    {account.movements.length ? (
      <div className="cash-flow-movement-sections">
        {groupCashFlowMovementsBySection(account.movements).map((group) => {
          const sectionTotalMinor = group.movements.reduce<number | null>((sum, movement) => {
            const signed = movementSignedAmount(movement);
            if (signed === null) return sum;
            return (sum ?? 0) + signed;
          }, null);
          return (
            <div className="cash-flow-detail-group" key={group.section}>
              <div className="cash-flow-detail-group-head">
                <h5>{group.label}</h5>
                <strong className={sectionTotalMinor === null ? undefined : sectionTotalMinor >= 0 ? "positive" : "negative"}>
                  {sectionTotalMinor === null ? "" : formatSignedMoneyMinor(sectionTotalMinor, { zeroSign: "+" })}
                </strong>
              </div>
              <div className="cash-flow-item-list">
                {group.movements.map((movement) => {
                  const item = movementItem(movement, itemIndex);
                  const signed = movementSignedAmount(movement);
                  return (
                    <div className="cash-flow-item-row" key={`${movement.kind}:${movement.recordId}`}>
                      <div className="cash-flow-item-main">
                        <strong>{item?.label ?? movement.description}</strong>
                        <span className="cash-flow-item-meta">{movement.date} · {movement.countsAsExpense && movement.kind === "transfer-out" ? "Spending (transfer)" : cashFlowProjectionMovementLabel(movement.kind)}</span>
                      </div>
                      {item ? (
                        <div className="cash-flow-row-actions">
                          <button className="account-secondary-button cash-flow-edit-button" type="button" onClick={(event) => onEdit(item, event.currentTarget)}>Edit</button>
                          {item.recurringSeriesId ? (
                            <a className="account-secondary-button cash-flow-edit-button" href={recurringSeriesHref(item.recurringSeriesId)}>Manage</a>
                          ) : null}
                        </div>
                      ) : null}
                      <strong className={signed === null ? undefined : signed >= 0 ? "positive" : "negative"}>
                        {signed === null ? dollars(movement.amountMinor) : formatSignedMoneyMinor(signed, { zeroSign: "+" })}
                      </strong>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    ) : <p className="insight">No dated movements in this period.</p>}
  </section>;
}
const dialogFocusableSelector = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

function ReadOnlyCashFlowField({ label, value }: { readonly label: string; readonly value: string }): React.ReactElement {
  return <label className="cash-flow-record-read-only-field">{label}<output className="cash-flow-record-read-only-value">{value}</output></label>;
}

export function CashFlowClient({ initialPeriods, selectedPeriodId, currentPeriodId, currentPeriodPayDate, totalPeriodCount, showAll, todayIso, accountOptions, paydayCheckAccountId, visibleAccountIds, showAllAccounts, recurringOptions: initialRecurringOptions, excludedExpenses: initialExcludedExpenses, recurringRangeSegments, deferredDetails = false, excludedExpenseCount, relevantRecurringVersionIds }: CashFlowClientProps) {
  const selectedEntry = initialPeriods.find((entry) => entry.period.id === selectedPeriodId) ?? initialPeriods[0];
  const isCompactViewport = useSyncExternalStore(subscribeCompactViewport, getCompactViewportSnapshot, () => false);
  const [editingItem, setEditingItem] = useState<RecurringCashFlowItem | null>(null);
  const [newTransaction, setNewTransaction] = useState<NewCashFlowTransactionDraft | null>(null);
  const [recordMessageVisible, setRecordMessageVisible] = useState(false);
  const [deleteMessageVisible, setDeleteMessageVisible] = useState(false);
  const [recordState, recordAction, recordPending] = useActionState(updateCashFlowRecordAction, initialCashFlowActionState);
  const [createTransactionState, createTransactionAction, createTransactionPending] = useActionState(createCashFlowTransactionAction, initialCashFlowActionState);
  const [deleteState, deleteAction, deletePending] = useActionState(excludeCashFlowExpenseAction, initialCashFlowActionState);
  const [restoreState, restoreAction, restorePending] = useActionState(restoreCashFlowExpenseAction, initialCashFlowActionState);
  const [paydayBalanceState, paydayBalanceAction, paydayBalancePending] = useActionState(recordCashFlowPaydayBalanceAction, initialCashFlowActionState);
  const [paydayNoteState, paydayNoteAction, paydayNotePending] = useActionState(updateCashFlowPaydayNoteAction, initialCashFlowActionState);
  const [resetPaydayBalanceState, resetPaydayBalanceAction, resetPaydayBalancePending] = useActionState(resetCashFlowPaydayBalanceAction, initialCashFlowActionState);
  const [recurringState, recurringAction, recurringPending] = useActionState(applyRecurringOccurrenceExceptionAction, initialCashFlowActionState);
  const [recurringRestoreState, recurringRestoreAction, recurringRestorePending] = useActionState(restoreRecurringOccurrenceAction, initialCashFlowActionState);
  const [latestRecurringState, setLatestRecurringState] = useState(initialCashFlowActionState);
  const [excludedOpen, setExcludedOpen] = useState(false);
  const detailScope = useMemo(() => ({ initialPeriods, recordState, createTransactionState, deleteState, restoreState, recurringState, recurringRestoreState }), [initialPeriods, recordState, createTransactionState, deleteState, restoreState, recurringState, recurringRestoreState]);
  const recurringDetails = useDeferredDetails("recurring", deferredDetails, detailScope, isRecurringDetails);
  const excludedDetails = useDeferredDetails("excluded", deferredDetails, detailScope, isExcludedDetails);
  const recurringOptions = useMemo(() => deferredDetails ? buildCashFlowRecurringOptions(recurringDetails.data ?? [], new Set(relevantRecurringVersionIds ?? [])) : initialRecurringOptions, [deferredDetails, recurringDetails.data, relevantRecurringVersionIds, initialRecurringOptions]);
  const excludedExpenses = deferredDetails ? excludedDetails.data ?? [] : initialExcludedExpenses;
  const editorReady = !deferredDetails || recurringDetails.status === "ready";
  const { status: recurringDetailStatus, load: loadRecurringDetails } = recurringDetails;
  const { status: excludedDetailStatus, load: loadExcludedDetails } = excludedDetails;
  useEffect(() => { if (editingItem && recurringDetailStatus === "idle") loadRecurringDetails(); }, [editingItem, recurringDetailStatus, loadRecurringDetails]);
  useEffect(() => { if (excludedOpen && excludedDetailStatus === "idle") loadExcludedDetails(); }, [excludedOpen, excludedDetailStatus, loadExcludedDetails]);
  const [accountDetailsOpenOverride, setAccountDetailsOpenOverride] = useState<boolean | null>(null);
  const accountDetailsOpen = accountDetailsOpenOverride ?? !isCompactViewport;
  const previousRecord = useRef(recordState); const previousCreateTransaction = useRef(createTransactionState); const previousDelete = useRef(deleteState); const previousRecurring = useRef(recurringState); const previousRestore = useRef(recurringRestoreState); const dialogRef = useRef<HTMLFormElement | null>(null); const createDialogRef = useRef<HTMLFormElement | null>(null); const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemIndex = useMemo(() => buildMovementItemIndex(selectedEntry?.period.items ?? []), [selectedEntry?.period.items]);
  useEffect(() => { if (shouldCloseSuccessfulAction(previousRecord.current, recordState, recordPending, recordMessageVisible)) { setEditingItem(null); setRecordMessageVisible(false); } previousRecord.current = recordState; }, [recordPending, recordState, recordMessageVisible]);
  useEffect(() => { if (shouldCloseSuccessfulAction(previousCreateTransaction.current, createTransactionState, createTransactionPending, true)) setNewTransaction(null); previousCreateTransaction.current = createTransactionState; }, [createTransactionPending, createTransactionState]);
  useEffect(() => { if (shouldCloseSuccessfulAction(previousDelete.current, deleteState, deletePending, deleteMessageVisible)) { setEditingItem(null); setDeleteMessageVisible(false); } previousDelete.current = deleteState; }, [deletePending, deleteState, deleteMessageVisible]);
  useEffect(() => { if (shouldCloseSuccessfulAction(previousRecurring.current, recurringState, recurringPending, true)) setEditingItem(null); if (recurringState !== previousRecurring.current) setLatestRecurringState(recurringState); previousRecurring.current = recurringState; }, [recurringPending, recurringState]);
  useEffect(() => { if (shouldCloseSuccessfulAction(previousRestore.current, recurringRestoreState, recurringRestorePending, true)) setEditingItem(null); if (recurringRestoreState !== previousRestore.current) setLatestRecurringState(recurringRestoreState); previousRestore.current = recurringRestoreState; }, [recurringRestorePending, recurringRestoreState]);
  const editingItemId = editingItem?.id;
  const editingItemDate = editingItem?.date;
  const editingSeriesId = editingItem?.recurringSeriesId;
  const editingOccurrenceDate = editingItem?.scheduledOccurrenceOn;
  const newTransactionAccountId = newTransaction?.accountId;
  useEffect(() => { if (editingItemId === undefined) { focusIfConnected(triggerRef.current); triggerRef.current = null; return; } dialogRef.current?.querySelector<HTMLElement>("[data-cash-flow-dialog-initial-focus]")?.focus(); }, [editingItemId]);
  useEffect(() => { if (newTransactionAccountId !== undefined) createDialogRef.current?.querySelector<HTMLElement>("[data-cash-flow-dialog-initial-focus]")?.focus(); }, [newTransactionAccountId]);
  useEffect(() => { if (editingItemId === undefined || !dialogRef.current || dialogRef.current.elements.namedItem("recordDate")) return; const input = document.createElement("input"); input.type = "hidden"; input.name = "recordDate"; input.value = editingItemDate ?? ""; dialogRef.current.append(input); }, [editingItemId, editingItemDate]);
  const closeEditor = useCallback(() => { if (recordPending || deletePending || recurringPending || recurringRestorePending) return; setEditingItem(null); setRecordMessageVisible(false); setDeleteMessageVisible(false); setLatestRecurringState(initialCashFlowActionState); }, [deletePending, recordPending, recurringPending, recurringRestorePending]); const openEditor = useCallback((item: RecurringCashFlowItem, trigger: HTMLButtonElement) => { triggerRef.current = trigger; setEditingItem(item); setRecordMessageVisible(false); setDeleteMessageVisible(false); setLatestRecurringState(initialCashFlowActionState); }, []);
  const closeCreateTransaction = useCallback(() => { if (createTransactionPending) return; setNewTransaction(null); }, [createTransactionPending]);
  const openCreateTransaction = useCallback((accountId: string, accountName: string) => { setNewTransaction({ accountId, accountName, transactionDate: selectedEntry?.period.startsOn ?? "", kind: "expense", description: "", amount: "" }); }, [selectedEntry?.period.startsOn]);
  const ranges = useMemo(() => {
    if (!editingSeriesId || !editingOccurrenceDate) return [];
    return expandCashFlowRecurringRangeOptions(recurringRangeSegments, editingSeriesId, editingOccurrenceDate);
  }, [editingSeriesId, editingOccurrenceDate, recurringRangeSegments]);
  if (!selectedEntry) return null;
  const period = selectedEntry.period; const projection = selectedEntry.projection; const selectedIndex = initialPeriods.findIndex((entry) => entry.period.id === selectedPeriodId); const previousEntry = selectedIndex > 0 ? initialPeriods[selectedIndex - 1] : null; const nextEntry = selectedIndex >= 0 && selectedIndex < initialPeriods.length - 1 ? initialPeriods[selectedIndex + 1] : null; const displayedAccounts = projection.accounts.filter((account) => showAllAccounts || visibleAccountIds.includes(account.accountId));
  const previousPaydayAccount = previousEntry && paydayCheckAccountId ? previousEntry.projection.accounts.find((account) => account.accountId === paydayCheckAccountId) : null;
  const selectedPaydayCheck = selectedEntry.paydayCheck;
  const projectedAtPaydayMinor = selectedPaydayCheck?.projectedBalanceMinor ?? (previousEntry && previousPaydayAccount ? previousEntry.projection.endingBalanceMinor : null);
  const observedBalanceMinor = selectedPaydayCheck?.actualBalanceMinor ?? selectedEntry.observedMainAccountBalanceMinor;
  const currentPayday = currentPeriodPayDate;
  const currentPeriodHref = cashFlowCurrentPeriodHref(currentPeriodId, selectedPeriodId, showAll, showAllAccounts);
  const isCurrentPeriod = currentPeriodId !== null && currentPeriodId === selectedPeriodId;
  const currentPeriodControl = currentPeriodHref
    ? <a className="account-primary-button cash-flow-current-period-control" href={currentPeriodHref}>Current</a>
    : <span className="account-secondary-button cash-flow-current-period-control is-active" aria-current={isCurrentPeriod ? "page" : undefined} aria-disabled="true">Current</span>;
  const selectedRoleLabel = periodPositionLabel(period.payDate, currentPayday);
  const timelineMetrics = cashFlowPeriodTimelineMetrics(projection);
  const metricFor = (label: string) => timelineMetrics.find((metric) => metric.label === label) ?? null;
  const incomeMetric = metricFor("Income");
  const spendingMetric = metricFor("Spending");
  const transfersOutMetric = metricFor("Transfers out");
  const changeMetric = metricFor("Change");
  const periodProgress = periodProgressPercent(period.startsOn, period.endsOn, todayIso);
  const editorModel = editingItem ? getCashFlowOccurrenceEditorModel(editingItem, recurringOptions) : null; const editable = editorModel?.generatedOccurrence ?? false;
  const onDialogKeyDown = (event: ReactKeyboardEvent<HTMLFormElement>) => { if (event.key === "Escape") { event.preventDefault(); closeEditor(); return; } if (event.key !== "Tab") return; const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(dialogFocusableSelector)); if (!focusable.length) return; const first = focusable[0]!; const last = focusable.at(-1)!; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } };

  return (
    <>
      <div className="cash-flow-workspace">
        <section className="cash-flow-selected-period-card">
          <AnimatedLineBackground lineCount={8} opacity={0.3} speed={16} scale={1.1} strokeWidth={1.15} density={1.1} drift={0.24} waveAmplitude={38} pulseStrength={0.86} direction="left-to-right" color="#9F9270" accentColor="#E0C681" seed="cash-flow-selected-period" className="cash-flow-selected-period-art animated-line-background--cash-flow" />
          <p className="eyebrow">Selected period</p>
          <h2><NumericDate iso={period.payDate} /></h2>
          <p>{selectedRoleLabel} · <NumericDate iso={period.startsOn} /> to <NumericDate iso={period.endsOn} /></p>
          <div className="cash-flow-period-progress" aria-hidden="true"><span style={{ width: `${periodProgress}%` }} /></div>
          <div className="cash-flow-available-summary"><p className="eyebrow">Available before next pay</p><strong>{projection.availableBeforeNextPayMinor === null ? "Unavailable" : dollars(projection.availableBeforeNextPayMinor)}</strong></div>
        </section>
        <section className="cash-flow-period-summary-card">
          <div className="cash-flow-period-controls">
            <div className="cash-flow-period-navigation" role="group" aria-label="Cash flow period navigation">
              {previousEntry ? <a className="account-secondary-button" href={cashFlowPeriodHref(previousEntry.period.id, showAll, showAllAccounts)}><ArrowLeft aria-hidden="true" size={15} strokeWidth={1.8} />Previous</a> : null}
              {currentPeriodControl}
              {nextEntry ? <a className="account-secondary-button" href={cashFlowPeriodHref(nextEntry.period.id, showAll, showAllAccounts)}>Next<ArrowRight aria-hidden="true" size={15} strokeWidth={1.8} /></a> : null}
            </div>
            <a className="account-secondary-button" href={cashFlowPeriodHref(selectedPeriodId, !showAll, showAllAccounts)}><CalendarDays aria-hidden="true" size={15} strokeWidth={1.8} />{showAll ? "Show recent" : "Show all periods"}</a>
            <a className="account-secondary-button" href={cashFlowPeriodHref(selectedPeriodId, showAll, !showAllAccounts)}>{showAllAccounts ? "Show relevant accounts" : "Show all accounts"}</a>
            <a className="account-primary-button" href="/cash-flow/recurring">Manage recurring payments</a>
          </div>
          <CashFlowPaydayCheck
            key={`${paydayCheckAccountId ?? "none"}:${period.payDate}`}
            accountOptions={accountOptions}
            accountId={paydayCheckAccountId}
            payDate={period.payDate}
            todayIso={todayIso}
            projectedAtPaydayMinor={projectedAtPaydayMinor}
            observedBalanceMinor={observedBalanceMinor}
            note={selectedEntry.paydayNote}
            saveAction={paydayBalanceAction}
            noteAction={paydayNoteAction}
            resetAction={resetPaydayBalanceAction}
            saveState={paydayBalanceState}
            noteState={paydayNoteState}
            resetState={resetPaydayBalanceState}
            savePending={paydayBalancePending}
            notePending={paydayNotePending}
            resetPending={resetPaydayBalancePending}
          />
          <div className="cash-flow-summary-metrics">
            <CashFlowSummaryMetric icon={Wallet} label="Income" value={incomeMetric ? formatTimelineMetricAmount(incomeMetric) : "Unavailable"} className="positive" />
            <CashFlowSummaryMetric icon={ShoppingCart} label="Spending" value={spendingMetric ? formatTimelineMetricAmount(spendingMetric) : "Unavailable"} className="negative" />
            <CashFlowSummaryMetric icon={ArrowRight} label="Transfers out" value={transfersOutMetric ? formatTimelineMetricAmount(transfersOutMetric) : "Unavailable"} />
            <CashFlowSummaryMetric icon={TrendingUp} label="Change" value={changeMetric ? formatTimelineMetricAmount(changeMetric) : "Unavailable"} className={cashFlowChangeClass(changeMetric?.amountMinor ?? null)} />
          </div>
        </section>
      </div>
      <section className="card section-card cash-flow-timeline-card">
        <div className="card-head"><div><h3 className="card-title">Pay-period timeline</h3><p className="card-subtitle">Showing {initialPeriods.length} of {totalPeriodCount} periods · today {displayDate(todayIso)}</p></div></div>
        <div className="cash-flow-period-list">{initialPeriods.map((entry) => <PeriodRow key={entry.period.id} entry={entry} selected={entry.period.id === selectedPeriodId} showAll={showAll} showAllAccounts={showAllAccounts} currentPayday={currentPayday} showPaydayCheck={paydayCheckAccountId !== null} />)}</div>
      </section>
      <details className="card section-card cash-flow-account-details" open={accountDetailsOpen} onToggle={(event) => setAccountDetailsOpenOverride(event.currentTarget.open)}>
        <summary className="cash-flow-details-header"><div><p className="eyebrow">Selected period</p><h3 className="card-title"><span className="cash-flow-account-details-desktop-title">Selected period details</span><span className="cash-flow-account-details-mobile-title">Account details</span></h3><p className="card-subtitle"><span className="cash-flow-account-details-desktop-subtitle">Included accounts and accounts with movements are shown by default.</span><span className="cash-flow-account-details-mobile-subtitle">Movements, balances, and account actions for this period.</span></p></div><span className="cash-flow-account-details-toggle"><span>View account movements</span><ChevronDown aria-hidden="true" size={18} strokeWidth={1.8} /></span></summary>
        <div className="cash-flow-account-groups">{displayedAccounts.length ? displayedAccounts.map((account) => <AccountProjectionCard key={account.accountId} account={account} itemIndex={itemIndex} onEdit={openEditor} onAdd={openCreateTransaction} isVisibleInCashFlow={accountOptions.find((option) => option.id === account.accountId)?.isVisibleInCashFlow ?? true} />) : <p className="insight">No accounts are visible in this view. Use “Show all accounts” above to reveal and restore an account.</p>}</div>
      </details>
      <details className="card cash-flow-excluded-disclosure" onToggle={event => setExcludedOpen(event.currentTarget.open)}>
        <summary>Excluded items ({deferredDetails ? excludedExpenseCount ?? 0 : excludedExpenses.length})</summary>
        {deferredDetails && excludedDetails.status === "loading" ? <p role="status">Loading excluded items…</p> : null}
        {deferredDetails && excludedDetails.status === "error" ? <div role="alert">Excluded items unavailable. <button type="button" onClick={excludedDetails.load}>Retry</button></div> : null}
        {excludedExpenses.map((expense) => <div className="cash-flow-excluded-row" key={expense.id}><span>{expense.description} · {expense.transactionDate} · {expense.accountName}</span><strong>{dollars(expense.amountMinor)}</strong><form action={restoreAction}><input type="hidden" name="id" value={expense.id} /><input type="hidden" name="confirm" value="true" /><button className="account-secondary-button" type="submit" disabled={restorePending}>Restore</button></form></div>)}
        {restoreState.message ? <p className="cash-flow-action-message" role={restoreState.ok ? "status" : "alert"}>{restoreState.message}</p> : null}
      </details>
      {newTransaction ? (
        <div className="cash-flow-record-backdrop" role="presentation" onClick={closeCreateTransaction}>
          <form ref={createDialogRef} className="cash-flow-record-modal" role="dialog" aria-modal="true" aria-labelledby="cash-flow-create-modal-title" action={createTransactionAction} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); closeCreateTransaction(); } }}>
            <div className="cash-flow-record-modal-head"><div><p className="eyebrow">New transaction</p><h3 id="cash-flow-create-modal-title">Add to {newTransaction.accountName}</h3></div><button className="account-secondary-button" type="button" onClick={closeCreateTransaction} data-cash-flow-dialog-initial-focus>Close</button></div>
            <input type="hidden" name="periodId" value={period.id} /><input type="hidden" name="accountId" value={newTransaction.accountId} />
            <div className="cash-flow-record-form-grid">
              <label>Type<InvestmentDropdown name="kind" value={newTransaction.kind} options={transactionKindOptions} onChange={(kind) => setNewTransaction((current) => current ? { ...current, kind } : current)} floating floatingMinWidth={220} /></label>
              <label>Date<input name="transactionDate" type="date" min={period.startsOn} max={period.endsOn} value={newTransaction.transactionDate} onChange={(event) => setNewTransaction((current) => current ? { ...current, transactionDate: event.target.value } : current)} data-cash-flow-dialog-initial-focus required /></label>
              <label className="cash-flow-record-field-wide">Name<input name="description" value={newTransaction.description} onChange={(event) => setNewTransaction((current) => current ? { ...current, description: event.target.value } : current)} required /></label>
              <label>Amount<input name="amount" type="number" min="0.01" step="0.01" value={newTransaction.amount} onChange={(event) => setNewTransaction((current) => current ? { ...current, amount: event.target.value } : current)} required /></label>
            </div>
            <div className="cash-flow-record-modal-actions"><button className="account-primary-button" type="submit" disabled={createTransactionPending}>{createTransactionPending ? "Adding…" : "Add transaction"}</button></div>
            {createTransactionState.message ? <p className={`cash-flow-action-message ${createTransactionState.ok ? "is-success" : "is-error"}`} role={createTransactionState.ok ? "status" : "alert"}>{createTransactionState.message}</p> : null}
          </form>
        </div>
      ) : null}
      {editingItem ? (
        <div className="cash-flow-record-backdrop" role="presentation" onClick={closeEditor}>
          <form ref={dialogRef} className="cash-flow-record-modal" role="dialog" aria-modal="true" aria-labelledby="cash-flow-record-modal-title" action={recordAction} onClick={(event) => event.stopPropagation()} onKeyDown={onDialogKeyDown} onSubmit={(event) => { const submitter = event.nativeEvent.submitter as HTMLElement | null; if (submitter?.getAttribute("formaction")) return; setRecordMessageVisible(true); }}>
            <div className="cash-flow-record-modal-head"><div><p className="eyebrow">{editingItem.kind === "transfer" ? "Transfer" : "Transaction"}</p><h3 id="cash-flow-record-modal-title">Edit {editingItem.label}</h3></div><button className="account-secondary-button" type="button" onClick={closeEditor} data-cash-flow-dialog-initial-focus>Close</button></div>
            {deferredDetails && recurringDetails.status !== "ready" ? <div role={recurringDetails.status === "error" ? "alert" : "status"}>{recurringDetails.status === "error" ? <>Editor details unavailable. <button type="button" onClick={recurringDetails.load}>Retry</button></> : "Loading editor details…"}</div> : null}
            <fieldset disabled={!editorReady} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <input type="hidden" name="id" value={editingItem.recordId ?? editingItem.id} /><input type="hidden" name="confirm" value="true" /><input type="hidden" name="recordKind" value={editingItem.kind === "transfer" ? "transfer" : "transaction"} />
            {editable ? <><input type="hidden" name="seriesId" value={editingItem.recurringSeriesId} /><input type="hidden" name="versionId" value={editingItem.recurringTransactionId} /><input type="hidden" name="scheduledOccurrenceOn" value={editingItem.scheduledOccurrenceOn} /><input type="hidden" name="transactionId" value={editingItem.kind === "transfer" ? "" : editingItem.recordId ?? editingItem.id} /><input type="hidden" name="transferId" value={editingItem.kind === "transfer" ? editingItem.recordId ?? editingItem.id : ""} /><input type="hidden" name="endingOccurrenceOn" value={editingItem.scheduledOccurrenceOn} /></> : null}
            <div className="cash-flow-record-form-grid">
              {editable ? <ReadOnlyCashFlowField label="Description" value={editingItem.label} /> : <label>Description<input name="description" required defaultValue={editingItem.label} /></label>}
              {editingItem.kind === "transfer" ? <>
                {editable ? <ReadOnlyCashFlowField label="Recurring series" value={editorModel?.linkedLabel ?? "Linked recurring series"} /> : null}
                <label>{editable ? "From account for this occurrence" : "From"}<FormDropdown name={editable ? "fromAccountOverrideId" : "fromAccountId"} defaultValue={editingItem.fromAccountId ?? ""} required options={accountOptions.map((account) => ({ value: account.id, label: account.label }))} floatingMinWidth={280} /></label>
                <label>{editable ? "To account for this occurrence" : "To"}<FormDropdown name={editable ? "toAccountOverrideId" : "toAccountId"} defaultValue={editingItem.toAccountId ?? ""} required options={accountOptions.map((account) => ({ value: account.id, label: account.label }))} floatingMinWidth={280} /></label>
              </> : <>
                {editable ? <ReadOnlyCashFlowField label="Account" value={editingItem.account ?? "Unassigned"} /> : <label>Account<FormDropdown name="accountId" defaultValue={editingItem.accountId ?? ""} options={accountOptions.map((account) => ({ value: account.id, label: account.label }))} floatingMinWidth={280} /></label>}
                {editorModel?.showRecurringSelector ? <label>Recurring series<FormDropdown name="recurringTransactionId" defaultValue={editingItem.recurringTransactionId ?? ""} options={[{ value: "", label: "Not linked" }, ...recurringOptions.filter((option) => option.kind === editingItem.kind).map((option) => ({ value: option.id, label: option.label }))]} floatingMinWidth={280} /></label> : editable ? <ReadOnlyCashFlowField label="Recurring series" value={editorModel?.linkedLabel ?? "Linked recurring series"} /> : null}
              </>}
              {editable ? <ReadOnlyCashFlowField label="Base amount" value={dollars(editorModel?.baseAmountMinor ?? editingItem.amount)} /> : <label>{editorModel?.amountFieldLabel ?? "Amount"}<input name={editorModel?.amountFieldName ?? "amount"} type="number" min="0.01" step="0.01" required defaultValue={formatMoneyInputMinor(editingItem.amount)} /></label>}
              {editable ? <label>{editorModel?.amountFieldLabel ?? "Amount for this occurrence"}<input name={editorModel?.amountFieldName ?? "amountOverride"} type="number" min="0.01" step="0.01" required defaultValue={formatMoneyInputMinor(editingItem.amount)} /></label> : null}
              {editable ? <>
                <label>Scope<FormDropdown name="scope" defaultValue="only_this_occurrence" options={[{ value: "only_this_occurrence", label: "Only this occurrence" }, ...ranges.map((option) => ({ value: `selected_range:${option.endingOccurrenceOn}`, label: `Through ${option.endingOccurrenceOn} (${option.occurrenceCount} planned)` }))]} floatingMinWidth={320} /></label>
                <label>Exception<FormDropdown name="kind" defaultValue="override" options={exceptionKindOptions} floatingMinWidth={220} /></label>
                <label>Override date<input name="dateOverride" type="date" defaultValue={editingItem.scheduledOccurrenceOn} /></label>
                {editingItem.kind !== "transfer" ? <label>Override account<FormDropdown name="accountOverrideId" defaultValue={editingItem.accountId ?? ""} options={[{ value: "", label: "Base account" }, ...accountOptions.map((account) => ({ value: account.id, label: account.label }))]} floatingMinWidth={280} /></label> : null}
                <label>Status<FormDropdown name="statusOverride" defaultValue="planned" options={statusOverrideOptions} floatingMinWidth={220} /></label>
              </> : null}
            </div>
            <div className="cash-flow-record-modal-actions"><button className="account-primary-button" type="submit" formAction={editable ? recurringAction : recordAction} disabled={recordPending || recurringPending}>{recurringPending ? "Saving…" : "Save changes"}</button>{editable && editingItem.recurringOccurrenceId ? <button className="account-secondary-button" type="submit" formAction={recurringRestoreAction} disabled={recurringRestorePending}>Restore occurrence</button> : null}<button className="account-secondary-button" type="button" onClick={closeEditor}>Cancel</button>{editingItem.kind === "expense" ? <button className="account-danger-button" type="submit" formAction={deleteAction} disabled={deletePending}>Exclude this period</button> : null}</div>
            {recordMessageVisible && recordState.message ? <p className="cash-flow-action-message" role={recordState.ok ? "status" : "alert"}>{recordState.message}</p> : null}
            {deleteMessageVisible && deleteState.message ? <p className="cash-flow-action-message" role={deleteState.ok ? "status" : "alert"}>{deleteState.message}</p> : null}
            {latestRecurringState.message ? <p className="cash-flow-action-message" role={latestRecurringState.ok ? "status" : "alert"}>{latestRecurringState.message}</p> : null}
            </fieldset>
          </form>
        </div>
      ) : null}
    </>
  );
}
