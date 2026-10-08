"use client";

import { useCallback, useEffect, useRef, useState, useActionState } from "react";
import { useRouter } from "next/navigation";
import {
  archiveAnnualBudgetAction,
  archiveAnnualExpenseAction,
  createAnnualBudgetAction,
  createAnnualExpenseAction,
  moveAnnualBudgetAction,
  moveAnnualExpenseAction,
  moveAnnualExpenseRemainderAction,
  mutateAnnualExpensePaymentAction,
  saveAnnualExpenseYearOverrideAction,
  restoreAnnualBudgetAction,
  updateAnnualBudgetAction,
  updateAnnualExpenseAction,
} from "./actions";
import { initialAnnualExpenseActionState, shouldCloseSuccessfulUpdate, type AnnualExpenseActionState } from "./action-helpers";
import { filterAnnualExpenseItems } from "./annual-expense-search";
import { findNextAnnualExpenseRemainderTarget } from "./annual-expense-remainder";
import { ActionNotification } from "../components/action-notification";
import { ModuleFirstUseCard } from "../components/module-first-use-card";
import { FormDropdown } from "../components/form-dropdown";
import { InvestmentDropdown } from "../investments/investment-dropdown";
import { formatMoneyInputMinor, formatMoneyMinor } from "../../lib/format-money";

export interface AnnualExpensePaymentPresentation {
  readonly id: string;
  readonly paymentOn: string;
  readonly amountMinor: number;
  readonly note: string | null;
}

export interface AnnualExpenseOccurrencePresentation {
  readonly id: string | null;
  readonly taxYear: number;
  readonly budgetId: string;
  readonly plannedAmountMinor: number;
  readonly dueDate: string | null;
  readonly amountOverrideMinor: number | null;
  readonly note: string | null;
  readonly paidMinor: number;
  readonly remainingMinor: number;
  readonly varianceMinor: number;
  readonly status: "Unpaid" | "Partially paid" | "Paid" | "Over budget";
  readonly payments: readonly AnnualExpensePaymentPresentation[];
}

export interface AnnualExpenseItemPresentation {
  readonly id: string;
  readonly budgetId: string;
  readonly name: string;
  readonly amountMinor: number;
  readonly dueMonth: number | null;
  readonly dueDay: number | null;
  readonly isActive: boolean;
  readonly occurrence: AnnualExpenseOccurrencePresentation;
  readonly history: readonly AnnualExpenseOccurrencePresentation[];
}

export interface AnnualBudgetPresentation {
  readonly id: string;
  readonly name: string;
  readonly linkedAccountId: string;
  readonly linkedAccountName: string;
  readonly isActive: boolean;
  readonly displayOrder: number;
  readonly itemCount: number;
  readonly totalPlannedMinor: number;
  readonly totalPaidMinor: number;
  readonly totalRemainingMinor: number;
  readonly items: readonly AnnualExpenseItemPresentation[];
}

export interface AnnualBudgetForecastPresentation {
  readonly budgetId: string;
  readonly yearEndBalanceMinor: number;
  readonly lowestBalanceMinor: number;
  readonly lowestBalanceOn: string;
  readonly hasNegativeFunding: boolean;
  readonly eventCount: number;
}

export interface AnnualBudgetAccountOptionPresentation {
  readonly id: string;
  readonly name: string;
  readonly institutionName: string;
}

export interface AnnualBudgetAccountSummaryPresentation {
  readonly budgetId: string;
  readonly actualBalanceMinor: number | null;
  readonly actualAsOf: string | null;
  readonly recurringPayments: readonly { readonly amountMinor: number; readonly frequency: string }[];
}

export interface AnnualExpenseManagerProps {
  readonly taxYear: number;
  readonly todayIso: string;
  readonly availableYears: readonly number[];
  readonly budgets: readonly AnnualBudgetPresentation[];
  readonly forecasts: readonly AnnualBudgetForecastPresentation[];
  readonly budgetAccounts: readonly AnnualBudgetAccountSummaryPresentation[];
  readonly eligibleAccounts: readonly AnnualBudgetAccountOptionPresentation[];
  readonly firstUse?: boolean;
}

const dollars = (minor: number): string => formatMoneyMinor(minor);
const amountInput = (minor: number): string => formatMoneyInputMinor(Math.abs(minor));
const dueLabel = (date: string | null): string => date ? new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)) : "Flexible";
const dueLabelWithYear = (date: string | null): string => date ? new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)) : "Flexible";
const statusClass = (status: AnnualExpenseOccurrencePresentation["status"]): string => status === "Over budget" ? "annual-status annual-status--negative" : status === "Paid" ? "annual-status annual-status--positive" : "annual-status";
const accountLabel = (account: AnnualBudgetAccountOptionPresentation): string => `${account.name} · ${account.institutionName}`;
const frequencyLabel = (frequency: string): string => frequency === "biweekly" ? "biweekly" : frequency === "weekly" ? "weekly" : frequency === "monthly" ? "monthly" : frequency === "annual" ? "annual" : frequency;

function updateAccountOptions(budget: AnnualBudgetPresentation, eligibleAccounts: readonly AnnualBudgetAccountOptionPresentation[]): readonly AnnualBudgetAccountOptionPresentation[] {
  const current = { id: budget.linkedAccountId, name: budget.linkedAccountName, institutionName: "Current linked account" };
  const seen = new Set<string>();
  return [current, ...eligibleAccounts].filter((account) => {
    if (seen.has(account.id)) return false;
    seen.add(account.id);
    return true;
  });
}

function ActionMessage({ state }: { readonly state: AnnualExpenseActionState }) {
  if (!state.message) return null;
  return <p className={`annual-action-message ${state.ok ? "is-success" : "is-error"}`} role={state.ok ? "status" : "alert"} aria-live="polite">{state.message}</p>;
}

function FieldError({ message }: { readonly message?: string }) {
  return message ? <p className="annual-field-error" role="alert">{message}</p> : null;
}

type ManageTab = "template" | "year" | "payments" | "remainder" | "transfer";

const manageTabs: readonly { readonly id: ManageTab; readonly label: string }[] = [
  { id: "template", label: "Template" },
  { id: "year", label: "This year" },
  { id: "payments", label: "Payments" },
  { id: "remainder", label: "Move remainder" },
  { id: "transfer", label: "Move & archive" },
];

type BudgetFilter = "all" | "other" | string;

export function AnnualExpenseManager({ taxYear, todayIso, availableYears, budgets, forecasts, budgetAccounts, eligibleAccounts, firstUse = false }: AnnualExpenseManagerProps) {
  const router = useRouter();
  const [manageId, setManageId] = useState<string | null>(null);
  const [showBudgetControls, setShowBudgetControls] = useState(false);
  const [manageTab, setManageTab] = useState<ManageTab>("template");
  const [budgetFilter, setBudgetFilter] = useState<BudgetFilter>("all");
  const [templateAmountChanged, setTemplateAmountChanged] = useState(false);
  const [showUpdateMessage, setShowUpdateMessage] = useState(false);
  const [budgetUpdateRowId, setBudgetUpdateRowId] = useState<string | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  const [showMobileAddForm, setShowMobileAddForm] = useState(false);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [expenseSearchByBudget, setExpenseSearchByBudget] = useState<Record<string, string>>({});
  const createExpenseWithReset = useCallback(async (previous: AnnualExpenseActionState, formData: FormData): Promise<AnnualExpenseActionState> => {
    const next = await createAnnualExpenseAction(previous, formData);
    if (next.ok) {
      setFormVersion((version) => version + 1);
      setShowMobileAddForm(false);
    }
    return next;
  }, []);
  const paymentWithReset = useCallback(async (previous: AnnualExpenseActionState, formData: FormData): Promise<AnnualExpenseActionState> => {
    const next = await mutateAnnualExpensePaymentAction(previous, formData);
    if (next.ok) setEditingPaymentId(null);
    return next;
  }, []);
  const [createState, createAction, createPending] = useActionState(createExpenseWithReset, initialAnnualExpenseActionState);
  const [updateState, updateAction, updatePending] = useActionState(updateAnnualExpenseAction, initialAnnualExpenseActionState);
  const [overrideState, overrideAction, overridePending] = useActionState(saveAnnualExpenseYearOverrideAction, initialAnnualExpenseActionState);
  const [moveState, moveAction, movePending] = useActionState(moveAnnualExpenseAction, initialAnnualExpenseActionState);
  const [remainderState, remainderAction, remainderPending] = useActionState(moveAnnualExpenseRemainderAction, initialAnnualExpenseActionState);
  const [archiveState, archiveAction, archivePending] = useActionState(archiveAnnualExpenseAction, initialAnnualExpenseActionState);
  const [paymentState, paymentAction, paymentPending] = useActionState(paymentWithReset, initialAnnualExpenseActionState);
  const [budgetCreateState, budgetCreateAction, budgetCreatePending] = useActionState(createAnnualBudgetAction, initialAnnualExpenseActionState);
  const [budgetMoveState, budgetMoveAction, budgetMovePending] = useActionState(moveAnnualBudgetAction, initialAnnualExpenseActionState);
  const [budgetUpdateState, budgetUpdateAction, budgetUpdatePending] = useActionState(updateAnnualBudgetAction, initialAnnualExpenseActionState);
  const [budgetArchiveState, budgetArchiveAction, budgetArchivePending] = useActionState(archiveAnnualBudgetAction, initialAnnualExpenseActionState);
  const [budgetRestoreState, budgetRestoreAction, budgetRestorePending] = useActionState(restoreAnnualBudgetAction, initialAnnualExpenseActionState);
  const activeBudgets = budgets.filter((budget) => budget.isActive);
  const archivedBudgets = budgets.filter((budget) => !budget.isActive);
  const noActiveBudgets = activeBudgets.length === 0;
  const namedBudgetFilters = activeBudgets.slice(0, 3);
  const otherBudgetIds = new Set(activeBudgets.slice(3).map((budget) => budget.id));
  const visibleBudgets = budgetFilter === "all"
    ? budgets
    : budgetFilter === "other"
      ? budgets.filter((budget) => otherBudgetIds.has(budget.id))
      : budgets.filter((budget) => budget.id === budgetFilter);
  const manageItem = manageId ? budgets.flatMap((budget) => budget.items).find((item) => item.id === manageId) ?? null : null;
  const manageBudget = manageItem ? budgets.find((budget) => budget.id === manageItem.budgetId) ?? null : null;
  const manageRemainderTarget = manageItem && manageBudget
    ? findNextAnnualExpenseRemainderTarget(manageItem, manageBudget.items, taxYear)
    : null;
  const previousUpdateStateRef = useRef(updateState);
  const previousRemainderStateRef = useRef(remainderState);

  useEffect(() => {
    if (shouldCloseSuccessfulUpdate(previousUpdateStateRef.current, updateState, updatePending, showUpdateMessage)) closeManage();
    previousUpdateStateRef.current = updateState;
  }, [showUpdateMessage, updatePending, updateState]);

  useEffect(() => {
    if (!movePending && moveState.ok) closeManage();
  }, [movePending, moveState.ok]);

  useEffect(() => {
    if (remainderState !== previousRemainderStateRef.current && !remainderPending && remainderState.ok) closeManage();
    previousRemainderStateRef.current = remainderState;
  }, [remainderPending, remainderState]);

  useEffect(() => {
    if (!archivePending && archiveState.ok) closeManage();
  }, [archivePending, archiveState.ok]);

  useEffect(() => {
    if (!manageId) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") closeManage(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [manageId]);

  if (firstUse) {
    return <section className="annual-budget-manager annual-budget-manager--first-use" aria-label="Create your first annual expense budget">
      <ModuleFirstUseCard
        headingId="annual-expenses-first-budget-heading"
        title="Create your first annual budget"
        description="Choose the active account that should hold this reserve. You can add yearly expenses after the budget is saved."
        supportingText="Funding account → annual budget → yearly expense"
        seed="annual-expenses-first-budget"
      >
        <form action={budgetCreateAction} className="module-first-use-form annual-budget-first-use-form">
          <div className="annual-budget-first-use-fields">
            <label>Budget name<input name="name" required maxLength={120} placeholder="e.g. Travel reserve" /></label>
            <label>Funding account<FormDropdown name="linkedAccountId" defaultValue="" required disabled={eligibleAccounts.length === 0} options={[{ value: "", label: "Select an active account" }, ...eligibleAccounts.map((account) => ({ value: account.id, label: accountLabel(account) }))]} floatingMinWidth={280} /></label>
          </div>
          <button className="annual-primary-button" type="submit" disabled={budgetCreatePending || eligibleAccounts.length === 0}>{budgetCreatePending ? "Creating…" : "Create budget"}<span aria-hidden="true">→</span></button>
          <FieldError message={budgetCreateState.fieldErrors.name ?? budgetCreateState.fieldErrors.linkedAccountId} />
          <ActionMessage state={budgetCreateState} />
        </form>
      </ModuleFirstUseCard>
    </section>;
  }

  function openManage(itemId: string) {
    const item = budgets.flatMap((budget) => budget.items).find((candidate) => candidate.id === itemId) ?? null;
    const budget = item ? budgets.find((candidate) => candidate.id === item.budgetId) ?? null : null;
    const remainderTarget = item && budget ? findNextAnnualExpenseRemainderTarget(item, budget.items, taxYear) : null;
    setManageId(itemId);
    setManageTab(item && item.occurrence.remainingMinor > 0 && remainderTarget ? "remainder" : "template");
    setEditingPaymentId(null);
    setTemplateAmountChanged(false);
    setShowUpdateMessage(false);
  }

  function closeManage() {
    setManageId(null);
    setEditingPaymentId(null);
    setTemplateAmountChanged(false);
    setShowUpdateMessage(false);
  }

  function closeMobileAddForm() {
    if (!createPending) setShowMobileAddForm(false);
  }

  function changeYear(value: string) {
    const nextYear = Number(value);
    if (!Number.isInteger(nextYear)) return;
    router.push(`/annual-expenses?year=${encodeURIComponent(String(nextYear))}`);
  }

  return <section className="annual-budget-manager" aria-label="Annual expense budgets">
    <div className="annual-planning-toolbar">
      <div className="annual-planning-year-control">
        <label htmlFor="annual-tax-year">Planning year</label>
        <InvestmentDropdown id="annual-tax-year" value={String(taxYear)} options={availableYears.map((year) => ({ value: String(year), label: String(year) }))} onChange={(value) => changeYear(value)} aria-label="Planning year" floating floatingMinWidth={120} numeric />
      </div>
      <div className="annual-budget-filter-controls" aria-label="Filter annual budgets">
        <button className={`annual-budget-filter${budgetFilter === "all" ? " is-active" : ""}`} type="button" onClick={() => setBudgetFilter("all")} aria-pressed={budgetFilter === "all"}>All <span>{activeBudgets.length}</span></button>
        {namedBudgetFilters.map((budget) => (
          <button className={`annual-budget-filter${budgetFilter === budget.id ? " is-active" : ""}`} type="button" key={budget.id} onClick={() => setBudgetFilter(budget.id)} aria-pressed={budgetFilter === budget.id}>{budget.name} <span>{budget.itemCount}</span></button>
        ))}
        {activeBudgets.length > 3 ? <button className={`annual-budget-filter${budgetFilter === "other" ? " is-active" : ""}`} type="button" onClick={() => setBudgetFilter("other")} aria-pressed={budgetFilter === "other"}>Others <span>{activeBudgets.length - 3}</span></button> : null}
      </div>
      <label className="annual-mobile-budget-select" htmlFor="annual-budget-view">
        <span>View budget</span>
        <InvestmentDropdown id="annual-budget-view" value={budgetFilter} options={[{ value: "all", label: `All budgets (${activeBudgets.length})` }, ...namedBudgetFilters.map((budget) => ({ value: budget.id, label: `${budget.name} (${budget.itemCount})` })), ...(activeBudgets.length > 3 ? [{ value: "other", label: `Other budgets (${activeBudgets.length - 3})` }] : [])]} onChange={setBudgetFilter} aria-label="View budget" floating floatingMinWidth={240} />
      </label>
      <button className="annual-secondary-button annual-manage-budgets-button" type="button" onClick={() => setShowBudgetControls((visible) => !visible)} aria-expanded={showBudgetControls || noActiveBudgets}>{showBudgetControls || noActiveBudgets ? "Hide" : "Manage"}<span aria-hidden="true">→</span></button>
    </div>

    <button className="annual-primary-button annual-mobile-add-trigger" type="button" onClick={() => setShowMobileAddForm(true)} disabled={createPending || activeBudgets.length === 0}>
      <span>{activeBudgets.length === 0 ? "Create a budget first" : "Add annual expense"}</span>
      <span aria-hidden="true">+</span>
    </button>

    {showBudgetControls || noActiveBudgets ? <section className="annual-budget-management card section-card" aria-labelledby="annual-budget-management-title">
      <div className="annual-budget-management-bar"><div><p className="eyebrow">Owner controls</p><h3 id="annual-budget-management-title" className="card-title">Budgets <span className="annual-budget-count">{budgets.length}</span></h3><p className="card-subtitle">Reorder, rename, link, archive, or create funding budgets.</p></div></div>
      {showBudgetControls || noActiveBudgets ? <>
      <div className={`annual-budget-management-grid${archivedBudgets.length > 0 ? " has-archived" : ""}`}>
        <div className="annual-budget-management-column">
          <div className="annual-budget-list-heading"><h4>Active</h4><span className="annual-budget-count">{activeBudgets.length}</span></div>
          {activeBudgets.length > 0 ? <div className="annual-budget-manage-list">{activeBudgets.map((budget, index) => <article className="annual-budget-manage-row" key={budget.id}>
            <div className="annual-budget-manage-summary"><div><strong>{budget.name}</strong><span>{budget.linkedAccountName}</span></div><div className="annual-budget-order-actions"><form action={budgetMoveAction}><input type="hidden" name="id" value={budget.id} /><input type="hidden" name="direction" value="up" /><button className="annual-secondary-button" type="submit" disabled={budgetMovePending || index === 0} aria-label={`Move ${budget.name} up`}>↑</button></form><form action={budgetMoveAction}><input type="hidden" name="id" value={budget.id} /><input type="hidden" name="direction" value="down" /><button className="annual-secondary-button" type="submit" disabled={budgetMovePending || index === activeBudgets.length - 1} aria-label={`Move ${budget.name} down`}>↓</button></form></div></div>
            <form action={budgetUpdateAction} className="annual-budget-manage-form" onSubmit={() => setBudgetUpdateRowId(budget.id)}>
              <input type="hidden" name="id" value={budget.id} />
              <label>Budget name<input name="name" required maxLength={120} defaultValue={budget.name} /></label>
              <label>Funding account<FormDropdown name="linkedAccountId" defaultValue={budget.linkedAccountId} required options={updateAccountOptions(budget, eligibleAccounts).map((account) => ({ value: account.id, label: accountLabel(account) }))} floatingMinWidth={280} /></label>
              <button className="annual-secondary-button" type="submit" disabled={budgetUpdatePending}>{budgetUpdatePending ? "Saving…" : "Save changes"}</button>
              <FieldError message={budgetUpdateState.fieldErrors.name ?? budgetUpdateState.fieldErrors.linkedAccountId} />
              {budgetUpdateRowId === budget.id && !budgetUpdatePending ? <ActionMessage state={budgetUpdateState} /> : null}
            </form>
            <details className="annual-budget-danger-details"><summary>Archive budget</summary><form action={budgetArchiveAction} className="annual-inline-form"><input type="hidden" name="id" value={budget.id} /><input type="hidden" name="confirm" value="true" /><p className="annual-confirm-copy">This releases <strong>{budget.linkedAccountName}</strong> for another budget and preserves this budget&apos;s history.</p><button className="annual-danger-button" type="submit" disabled={budgetArchivePending}>{budgetArchivePending ? "Archiving…" : "Confirm archive"}</button><FieldError message={budgetArchiveState.fieldErrors.confirm} /></form></details>
          </article>)}</div> : <p className="annual-budget-manage-empty">No active budgets. Create one below to add annual-expense items.</p>}
        </div>
        {archivedBudgets.length > 0 ? <div className="annual-budget-management-column">
          <div className="annual-budget-list-heading"><h4>Archived</h4><span className="annual-budget-count">{archivedBudgets.length}</span></div>
          <div className="annual-budget-manage-list">{archivedBudgets.map((budget) => <article className="annual-budget-manage-row is-archived" key={budget.id}>
            <div className="annual-budget-manage-summary"><strong>{budget.name}</strong><span>Former account: {budget.linkedAccountName}</span></div>
            <form action={budgetRestoreAction} className="annual-budget-manage-form">
              <input type="hidden" name="id" value={budget.id} />
              <input type="hidden" name="confirm" value="true" />
              <label>Restore with account<FormDropdown name="linkedAccountId" defaultValue="" options={[{ value: "", label: "Use former account when eligible" }, ...eligibleAccounts.map((account) => ({ value: account.id, label: accountLabel(account) }))]} floatingMinWidth={280} /></label>
              <button className="annual-secondary-button" type="submit" disabled={budgetRestorePending || eligibleAccounts.length === 0}>{budgetRestorePending ? "Restoring…" : "Restore budget"}</button>
              {eligibleAccounts.length === 0 ? <p className="annual-confirm-copy">No active unassigned account is available.</p> : null}
              <FieldError message={budgetRestoreState.fieldErrors.linkedAccountId ?? budgetRestoreState.fieldErrors.confirm} />
            </form>
          </article>)}</div>
        </div> : null}
      </div>
      <div className="annual-budget-create">
        <div><h4>Create a budget</h4><p className="card-subtitle">Choose an active account that is not already funding another active budget.</p></div>
        <form action={budgetCreateAction} className="annual-budget-create-form">
          <label>Budget name<input name="name" required maxLength={120} placeholder="e.g. Travel reserve" /></label>
          <label>Funding account<FormDropdown name="linkedAccountId" defaultValue="" required disabled={eligibleAccounts.length === 0} options={[{ value: "", label: "Select an active account" }, ...eligibleAccounts.map((account) => ({ value: account.id, label: accountLabel(account) }))]} floatingMinWidth={280} /></label>
          <button className="annual-primary-button" type="submit" disabled={budgetCreatePending || eligibleAccounts.length === 0}>{budgetCreatePending ? "Creating…" : "Create budget"}</button>
          {eligibleAccounts.length === 0 ? <p className="annual-confirm-copy">All active accounts are assigned, or no active accounts exist.</p> : null}
          <FieldError message={budgetCreateState.fieldErrors.name ?? budgetCreateState.fieldErrors.linkedAccountId} />
          <ActionMessage state={budgetCreateState} />
        </form>
      </div>
      <ActionNotification state={budgetMoveState} /><ActionNotification state={budgetArchiveState} /><ActionNotification state={budgetRestoreState} />
      </> : null}
    </section> : null}

    <div id="annual-template-panel" className="annual-template-panel card section-card">
      <div className="card-head annual-template-panel-head">
        <div><h3 className="card-title" id="annual-template-panel-title">Add annual expense</h3><p className="card-subtitle">Each item belongs to one budget and uses integer CAD minor units.</p></div>
        <button className="annual-primary-button navy-action-button annual-add-item-button" type="submit" form="annual-expense-form" disabled={createPending || activeBudgets.length === 0}><span>{createPending ? "Saving…" : activeBudgets.length === 0 ? "Create a budget first" : "Add item"}</span><span className="navy-action-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg></span></button>
      </div>
      <form id="annual-expense-form" key={`new-${formVersion}`} action={createAction} className="annual-form-grid">
        <input type="hidden" name="taxYear" value={taxYear} />
        <input type="hidden" name="fromYear" value={taxYear} />
        <div className="annual-field"><label htmlFor="annual-name">Item name</label><input id="annual-name" name="name" required maxLength={120} /><FieldError message={createState.fieldErrors.name} /></div>
        <div className="annual-field"><label htmlFor="annual-amount">Default planned amount</label><input id="annual-amount" name="amount" type="text" inputMode="decimal" pattern="^\d+(\.\d{1,2})?$" placeholder="0.00" required /><FieldError message={createState.fieldErrors.amount} /></div>
        <div className="annual-field"><label htmlFor="annual-budget">Budget</label><FormDropdown id="annual-budget" name="budgetId" defaultValue={activeBudgets[0]?.id ?? ""} disabled={activeBudgets.length === 0} options={activeBudgets.map((budget) => ({ value: budget.id, label: budget.name }))} floatingMinWidth={240} /><FieldError message={createState.fieldErrors.budgetId} /></div>
        <div className="annual-field"><label htmlFor="annual-due-month">Due month</label><input id="annual-due-month" name="dueMonth" type="number" min={1} max={12} required /><FieldError message={createState.fieldErrors.dueMonth} /></div>
        <div className="annual-field"><label htmlFor="annual-due-day">Due day <span>(optional)</span></label><input id="annual-due-day" name="dueDay" type="number" min={1} max={31} /><FieldError message={createState.fieldErrors.dueDay} /></div>
        <ActionMessage state={createState} />
      </form>
    </div>

    {showMobileAddForm ? <div className="annual-mobile-sheet-layer" role="presentation" onClick={closeMobileAddForm}>
      <section className="annual-mobile-sheet" role="dialog" aria-modal="true" aria-labelledby="annual-mobile-add-title" onClick={(event) => event.stopPropagation()}>
        <div className="annual-mobile-sheet-head">
          <div><p className="eyebrow">{taxYear} planning</p><h3 className="card-title" id="annual-mobile-add-title">Add annual expense</h3><p className="card-subtitle">Add one item to a funding budget.</p></div>
          <button className="annual-mobile-sheet-close" type="button" onClick={closeMobileAddForm} aria-label="Close add annual expense">✕</button>
        </div>
        <form id="annual-expense-form-mobile" key={`mobile-new-${formVersion}`} action={createAction} className="annual-mobile-expense-form">
          <input type="hidden" name="taxYear" value={taxYear} />
          <input type="hidden" name="fromYear" value={taxYear} />
          <div className="annual-field"><label htmlFor="annual-mobile-name">Item name</label><input id="annual-mobile-name" name="name" required maxLength={120} autoFocus /><FieldError message={createState.fieldErrors.name} /></div>
          <div className="annual-field"><label htmlFor="annual-mobile-amount">Planned amount</label><input id="annual-mobile-amount" name="amount" type="text" inputMode="decimal" pattern="^\d+(\.\d{1,2})?$" placeholder="0.00" required /><FieldError message={createState.fieldErrors.amount} /></div>
          <div className="annual-field"><label htmlFor="annual-mobile-budget">Budget</label><FormDropdown id="annual-mobile-budget" name="budgetId" defaultValue={activeBudgets[0]?.id ?? ""} disabled={activeBudgets.length === 0} options={activeBudgets.map((budget) => ({ value: budget.id, label: budget.name }))} floatingMinWidth={240} /><FieldError message={createState.fieldErrors.budgetId} /></div>
          <div className="annual-field"><label htmlFor="annual-mobile-due-month">Due month</label><input id="annual-mobile-due-month" name="dueMonth" type="number" min={1} max={12} required /><FieldError message={createState.fieldErrors.dueMonth} /></div>
          <div className="annual-field"><label htmlFor="annual-mobile-due-day">Due day <span>(optional)</span></label><input id="annual-mobile-due-day" name="dueDay" type="number" min={1} max={31} /><FieldError message={createState.fieldErrors.dueDay} /></div>
          <div className="annual-mobile-sheet-actions"><button className="annual-primary-button" type="submit" disabled={createPending}>{createPending ? "Saving…" : "Add expense"}</button><button className="annual-secondary-button" type="button" onClick={closeMobileAddForm} disabled={createPending}>Cancel</button></div>
          <ActionMessage state={createState} />
        </form>
      </section>
    </div> : null}

    <div className="annual-budget-sections">
      {visibleBudgets.map((budget) => {
        const forecast = forecasts.find((entry) => entry.budgetId === budget.id);
        const accountSummary = budgetAccounts.find((entry) => entry.budgetId === budget.id);
        const expenseSearch = expenseSearchByBudget[budget.id] ?? "";
        const filteredItems = filterAnnualExpenseItems(budget.items, expenseSearch);
        const setExpenseSearch = (value: string) => setExpenseSearchByBudget((current) => ({ ...current, [budget.id]: value }));
        const emptyExpenseMessage = expenseSearch.trim().length > 0
          ? `No annual expenses match “${expenseSearch.trim()}” in this budget.`
          : `No items in this budget for ${taxYear}.`;
        return <article className={`annual-budget-card card section-card ${budget.isActive ? "" : "is-archived"}`} key={budget.id}>
          <div className="annual-budget-header"><div><p className="eyebrow">{budget.isActive ? "Active budget" : "Archived budget"}</p><h3 className="card-title">{budget.name}</h3><p className="card-subtitle">Linked account: <strong>{budget.linkedAccountName}</strong></p><div className="annual-budget-account-summary"><span><small>Actual balance</small><strong>{accountSummary?.actualBalanceMinor === null || accountSummary?.actualBalanceMinor === undefined ? "—" : dollars(accountSummary.actualBalanceMinor)}</strong><em>{accountSummary?.actualAsOf ? `as of ${accountSummary.actualAsOf}` : "No actual anchor"}</em></span><span><small>Recurring payment</small><strong>{accountSummary?.recurringPayments.length ? accountSummary.recurringPayments.map((payment) => `${dollars(payment.amountMinor)} ${frequencyLabel(payment.frequency)}`).join(" · ") : "—"}</strong><em>{accountSummary?.recurringPayments.length ? "enabled rules" : "No enabled rule"}</em></span></div></div><div className="annual-budget-total"><span>{taxYear} planned</span><strong>{dollars(budget.totalPlannedMinor)}</strong></div></div>
          <div className="annual-budget-metrics" aria-label={`${budget.name} summary`}><div><span>Paid</span><strong>{dollars(budget.totalPaidMinor)}</strong></div><div><span>Remaining</span><strong>{dollars(budget.totalRemainingMinor)}</strong></div><div><span>Year-end forecast</span><strong className={forecast?.hasNegativeFunding ? "negative-text" : "positive-text"}>{forecast ? dollars(forecast.yearEndBalanceMinor) : "—"}</strong></div><div><span>Lowest forecast</span><strong className={forecast?.hasNegativeFunding ? "negative-text" : ""}>{forecast ? `${dollars(forecast.lowestBalanceMinor)} · ${forecast.lowestBalanceOn}` : "—"}</strong></div></div>
          <div className="annual-mobile-budget-card">
            <div className="annual-mobile-budget-summary"><div><p className="eyebrow">{budget.isActive ? "Active budget" : "Archived budget"}</p><h3 className="card-title">{budget.name}</h3><p className="card-subtitle">{budget.linkedAccountName}</p></div><span className={`annual-mobile-forecast-pill${forecast?.hasNegativeFunding ? " is-negative" : ""}`}>{forecast?.hasNegativeFunding ? "Needs funding" : "On track"}</span></div>
            <div className="annual-mobile-budget-totals" aria-label={`${budget.name} totals`}><div><span>Planned</span><strong>{dollars(budget.totalPlannedMinor)}</strong></div><div><span>Paid</span><strong>{dollars(budget.totalPaidMinor)}</strong></div><div><span>Remaining</span><strong className={budget.totalRemainingMinor < 0 ? "negative-text" : ""}>{dollars(budget.totalRemainingMinor)}</strong></div></div>
            <div className="annual-budget-expense-search">
              <label className="annual-budget-expense-search-label" htmlFor={`annual-budget-expense-search-${budget.id}`}>Search expenses in {budget.name}</label>
              <div className="annual-budget-expense-search-control">
                <input id={`annual-budget-expense-search-${budget.id}`} type="search" value={expenseSearch} onChange={(event) => setExpenseSearch(event.target.value)} placeholder="Search by expense name" autoComplete="off" />
                {expenseSearch ? <button className="annual-secondary-button annual-budget-expense-search-clear" type="button" onClick={() => setExpenseSearch("")}>Clear</button> : null}
              </div>
              <p className="annual-budget-expense-search-meta" aria-live="polite">{expenseSearch.trim() ? `${filteredItems.length} of ${budget.items.length} expenses shown` : `${budget.items.length} ${budget.items.length === 1 ? "expense" : "expenses"}`}</p>
            </div>
            <details className="annual-mobile-budget-details" open={expenseSearch.trim().length > 0 || budgetFilter !== "all" || visibleBudgets.length === 1}><summary><span>Budget details</span><span>{budget.itemCount} items</span></summary>
              <div className="annual-mobile-budget-meta"><span><small>Actual balance</small><strong>{accountSummary?.actualBalanceMinor === null || accountSummary?.actualBalanceMinor === undefined ? "—" : dollars(accountSummary.actualBalanceMinor)}</strong><em>{accountSummary?.actualAsOf ? `as of ${accountSummary.actualAsOf}` : "No actual anchor"}</em></span><span><small>Recurring payment</small><strong>{accountSummary?.recurringPayments.length ? accountSummary.recurringPayments.map((payment) => `${dollars(payment.amountMinor)} ${frequencyLabel(payment.frequency)}`).join(" · ") : "—"}</strong><em>{accountSummary?.recurringPayments.length ? "enabled rules" : "No enabled rule"}</em></span><span><small>Year-end forecast</small><strong className={forecast?.hasNegativeFunding ? "negative-text" : "positive-text"}>{forecast ? dollars(forecast.yearEndBalanceMinor) : "—"}</strong><em>{forecast ? `Lowest ${dollars(forecast.lowestBalanceMinor)} · ${forecast.lowestBalanceOn}` : "No forecast"}</em></span></div>
              {filteredItems.length > 0 ? <ul className="annual-mobile-expense-list">{filteredItems.map((item) => <li key={item.id} className={`annual-mobile-expense-item${item.isActive ? "" : " is-archived"}`}><div className="annual-mobile-expense-main"><div><span className="annual-mobile-expense-due">{dueLabel(item.occurrence.dueDate)}</span><strong>{item.name}</strong>{!item.isActive ? <span className="annual-archived-label">Archived</span> : null}</div><strong className={item.occurrence.remainingMinor < 0 ? "negative-text" : ""}>{dollars(item.occurrence.remainingMinor)}</strong></div><div className="annual-mobile-expense-stats"><span>Planned {dollars(item.occurrence.plannedAmountMinor)}</span><span>Paid {dollars(item.occurrence.paidMinor)}</span><span className={statusClass(item.occurrence.status)}>{item.occurrence.status}</span></div><div className="annual-mobile-expense-actions">{item.occurrence.payments.length > 0 ? <details className="annual-mobile-payment-details"><summary>Payment history ({item.occurrence.payments.length})</summary><ul>{item.occurrence.payments.map((payment) => <li key={payment.id}><span>{payment.paymentOn}</span><strong>{dollars(payment.amountMinor)}</strong></li>)}</ul></details> : <span className="annual-mobile-no-payments">No payments yet</span>}<div><button className="annual-secondary-button annual-manage-trigger" type="button" onClick={() => openManage(item.id)}>Manage</button>{item.occurrence.id && item.occurrence.remainingMinor > 0 ? <form action={paymentAction}><input type="hidden" name="mode" value="create" /><input type="hidden" name="annualExpenseValueId" value={item.occurrence.id} /><input type="hidden" name="paymentOn" value={todayIso} /><input type="hidden" name="amount" value={amountInput(item.occurrence.remainingMinor)} /><input type="hidden" name="note" value="Quick payment" /><input type="hidden" name="confirm" value="true" /><button className="annual-primary-button annual-quick-paid-trigger" type="submit" disabled={paymentPending}>{paymentPending ? "Saving…" : "Mark paid"}</button></form> : null}</div></div></li>)}</ul> : <div className="annual-empty">{emptyExpenseMessage}</div>}
            </details>
          </div>
          {filteredItems.length > 0 ? <div className="annual-table-wrap"><table className="annual-budget-table"><caption className="sr-only">{budget.name} annual expenses for {taxYear}</caption><thead><tr><th scope="col">Item</th><th scope="col">Due</th><th scope="col">Planned</th><th scope="col">Paid</th><th scope="col">Remaining</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead><tbody>{filteredItems.map((item) => <tr key={item.id} className={!item.isActive ? "is-archived" : undefined}><th scope="row">{item.name}{!item.isActive ? <span className="annual-archived-label">Archived</span> : null}</th><td>{dueLabel(item.occurrence.dueDate)}</td><td>{dollars(item.occurrence.plannedAmountMinor)}</td><td>{dollars(item.occurrence.paidMinor)}</td><td>{dollars(item.occurrence.remainingMinor)}</td><td>{item.occurrence.payments.length > 0 ? <details className="annual-payment-details"><summary className="annual-payment-summary" aria-label={`${item.occurrence.status}; show payment details for ${item.name}`}><span className={statusClass(item.occurrence.status)}>{item.occurrence.status}</span><span className="annual-payment-disclosure">Payments</span></summary><div className="annual-payment-popover"><strong className="annual-payment-popover-heading">Payment details</strong><ul className="annual-payment-popover-list">{item.occurrence.payments.map((payment) => <li key={payment.id}><span>{payment.paymentOn}</span><strong>{dollars(payment.amountMinor)}</strong></li>)}</ul></div></details> : <span className={statusClass(item.occurrence.status)}>{item.occurrence.status}</span>}</td><td><div className="annual-item-actions"><button className="annual-secondary-button annual-manage-trigger" type="button" onClick={() => openManage(item.id)}>Manage</button>{item.occurrence.id && item.occurrence.remainingMinor > 0 ? <form action={paymentAction}><input type="hidden" name="mode" value="create" /><input type="hidden" name="annualExpenseValueId" value={item.occurrence.id} /><input type="hidden" name="paymentOn" value={todayIso} /><input type="hidden" name="amount" value={amountInput(item.occurrence.remainingMinor)} /><input type="hidden" name="note" value="Quick payment" /><input type="hidden" name="confirm" value="true" /><button className="annual-primary-button annual-quick-paid-trigger" type="submit" disabled={paymentPending}>{paymentPending ? "Saving…" : "Mark paid"}</button></form> : null}</div></td></tr>)}</tbody></table></div> : <div className="annual-empty">{emptyExpenseMessage}</div>}
        </article>;
      })}
    </div>

    {manageItem && manageBudget ? <div className="annual-modal-layer" role="presentation" onClick={closeManage}>
      <div className="annual-modal" role="dialog" aria-modal="true" aria-labelledby="annual-manage-title" onClick={(event) => event.stopPropagation()}>
        <header className="annual-modal-head">
          <div className="annual-modal-heading">
            <p className="eyebrow">{manageBudget.name} · {taxYear}</p>
            <h3 className="card-title" id="annual-manage-title">{manageItem.name}</h3>
          </div>
          <button className="annual-modal-close" type="button" onClick={closeManage} aria-label="Close manage dialog">✕</button>
        </header>

        <div className="annual-modal-stats">
          <div><span>Due</span><strong>{dueLabel(manageItem.occurrence.dueDate)}</strong></div>
          <div><span>Planned</span><strong>{dollars(manageItem.occurrence.plannedAmountMinor)}</strong></div>
          <div><span>Paid</span><strong>{dollars(manageItem.occurrence.paidMinor)}</strong></div>
          <div><span>Remaining</span><strong>{dollars(manageItem.occurrence.remainingMinor)}</strong></div>
          <div><span>Status</span><strong><span className={statusClass(manageItem.occurrence.status)}>{manageItem.occurrence.status}</span></strong></div>
        </div>

        <nav className="annual-modal-tabs" aria-label="Manage sections">
          {manageTabs.map((tab) => <button key={tab.id} className={`annual-modal-tab${manageTab === tab.id ? " is-active" : ""}`} type="button" onClick={() => setManageTab(tab.id)} aria-pressed={manageTab === tab.id}>{tab.label}{tab.id === "payments" ? ` (${manageItem.occurrence.payments.length})` : ""}</button>)}
        </nav>

        <div className="annual-modal-body">
          {manageTab === "template" ? <form key={`template-${manageItem.id}`} action={updateAction} onSubmit={() => setShowUpdateMessage(true)} className="annual-modal-form">
            <input type="hidden" name="id" value={manageItem.id} />
            <input type="hidden" name="taxYear" value={taxYear} />
            <input type="hidden" name="fromYear" value={taxYear} />
            <input type="hidden" name="budgetId" value={manageItem.budgetId} />
            <input type="hidden" name="amountChanged" value={templateAmountChanged ? "true" : "false"} />
            <label>Item name<input name="name" required maxLength={120} defaultValue={manageItem.name} /></label>
            <label>Default planned amount<input name="amount" type="text" inputMode="decimal" pattern="^\d+(\.\d{1,2})?$" required defaultValue={amountInput(manageItem.amountMinor)} onChange={() => setTemplateAmountChanged(true)} /></label>
            <label>Due month<input name="dueMonth" type="number" min={1} max={12} required defaultValue={manageItem.dueMonth ?? ""} /></label>
            <label>Due day <span className="annual-modal-optional">optional</span><input name="dueDay" type="number" min={1} max={31} defaultValue={manageItem.dueDay ?? ""} /></label>
            <p className="annual-modal-help">Template values apply to every year unless a year override exists.</p>
            <div className="annual-modal-actions">
              <button className="annual-primary-button" type="submit" disabled={updatePending}>{updatePending ? "Saving…" : "Save template"}</button>
              <button className="annual-secondary-button" type="button" onClick={closeManage} disabled={updatePending}>Cancel</button>
            </div>
            <FieldError message={updateState.fieldErrors.name ?? updateState.fieldErrors.amount ?? updateState.fieldErrors.dueMonth ?? updateState.fieldErrors.dueDay} />
            {showUpdateMessage ? <ActionMessage state={updateState} /> : null}
          </form> : null}

          {manageTab === "year" ? <form key={`year-${manageItem.id}`} action={overrideAction} className="annual-modal-form">
            <input type="hidden" name="annualExpenseId" value={manageItem.id} />
            <input type="hidden" name="taxYear" value={taxYear} />
            <label>Planned amount<input name="plannedAmount" type="text" inputMode="decimal" defaultValue={amountInput(manageItem.occurrence.plannedAmountMinor)} /></label>
            <label>Due date<input name="dueDate" type="date" defaultValue={manageItem.occurrence.dueDate ?? ""} /></label>
            <label className="annual-modal-field-wide">Note<input name="note" type="text" maxLength={240} defaultValue={manageItem.occurrence.note ?? ""} /></label>
            <label className="annual-modal-field-wide">Apply to<FormDropdown name="scope" defaultValue="current_year" options={[{ value: "current_year", label: `${taxYear} only` }, { value: "this_and_future", label: `${taxYear} and future years` }]} floatingMinWidth={280} numeric /></label>
            <div className="annual-modal-actions">
              <button className="annual-primary-button" type="submit" disabled={overridePending}>{overridePending ? "Saving…" : "Save year"}</button>
            </div>
            <FieldError message={overrideState.fieldErrors.plannedAmount ?? overrideState.fieldErrors.dueDate} />
            <ActionMessage state={overrideState} />
          </form> : null}

          {manageTab === "payments" ? (manageItem.occurrence.id ? <div className="annual-modal-payments">
            {manageItem.occurrence.remainingMinor > 0 ? <div className="annual-quick-paid">
              <div><strong>Quick payment</strong><span>Mark the full remaining amount as paid today ({todayIso}).</span></div>
              <form action={paymentAction}>
                <input type="hidden" name="mode" value="create" />
                <input type="hidden" name="annualExpenseValueId" value={manageItem.occurrence.id} />
                <input type="hidden" name="paymentOn" value={todayIso} />
                <input type="hidden" name="amount" value={amountInput(manageItem.occurrence.remainingMinor)} />
                <input type="hidden" name="note" value="Quick payment" />
                <input type="hidden" name="confirm" value="true" />
                <button className="annual-primary-button" type="submit" disabled={paymentPending}>{paymentPending ? "Saving…" : `Mark paid · ${dollars(manageItem.occurrence.remainingMinor)}`}</button>
              </form>
            </div> : null}
            <div className="annual-modal-payment-list">
              {manageItem.occurrence.payments.length > 0 ? manageItem.occurrence.payments.map((payment) => <div className="annual-payment-row" key={payment.id}>
                <span>{payment.paymentOn}</span>
                <strong>{dollars(payment.amountMinor)}</strong>
                <span>{payment.note ?? "—"}</span>
                <button className="annual-secondary-button" type="button" onClick={() => setEditingPaymentId(payment.id)}>Edit</button>
                <form action={paymentAction}><input type="hidden" name="mode" value="delete" /><input type="hidden" name="paymentId" value={payment.id} /><input type="hidden" name="confirm" value="true" /><button className="annual-danger-button" type="submit" disabled={paymentPending}>Delete</button></form>
              </div>) : <p className="annual-modal-help">No payments recorded for {taxYear}.</p>}
            </div>
            <form key={`payment-${manageItem.occurrence.id}-${editingPaymentId ?? "new"}`} action={paymentAction} className="annual-modal-form">
              <input type="hidden" name="mode" value={editingPaymentId ? "update" : "create"} />
              <input type="hidden" name="paymentId" value={editingPaymentId ?? ""} />
              <input type="hidden" name="annualExpenseValueId" value={manageItem.occurrence.id} />
              <input type="hidden" name="confirm" value="true" />
              <label>Payment date<input name="paymentOn" type="date" required defaultValue={editingPaymentId ? manageItem.occurrence.payments.find((payment) => payment.id === editingPaymentId)?.paymentOn ?? "" : ""} /></label>
              <label>Amount<input name="amount" type="text" inputMode="decimal" required defaultValue={editingPaymentId ? amountInput(manageItem.occurrence.payments.find((payment) => payment.id === editingPaymentId)?.amountMinor ?? 0) : ""} /></label>
              <label className="annual-modal-field-wide">Note<input name="note" type="text" maxLength={240} defaultValue={editingPaymentId ? manageItem.occurrence.payments.find((payment) => payment.id === editingPaymentId)?.note ?? "" : ""} /></label>
              <div className="annual-modal-actions">
                <button className="annual-primary-button" type="submit" disabled={paymentPending}>{paymentPending ? "Saving…" : editingPaymentId ? "Save payment" : "Add payment"}</button>
                {editingPaymentId ? <button className="annual-secondary-button" type="button" onClick={() => setEditingPaymentId(null)}>Cancel</button> : null}
              </div>
              <FieldError message={paymentState.fieldErrors.amount ?? paymentState.fieldErrors.paymentOn} />
              <ActionMessage state={paymentState} />
            </form>
          </div> : <p className="annual-modal-help">Save this year first to record a payment.</p>) : null}

          {manageTab === "remainder" ? <section className="annual-remainder-transfer-panel" aria-labelledby="annual-remainder-transfer-title">
            <div className="annual-remainder-transfer-heading">
              <p className="eyebrow">Carry forward unused funds</p>
              <h4 id="annual-remainder-transfer-title">Move the unused amount to the next matching expense</h4>
              <p className="annual-modal-help">Move the unused amount from this expense to the next active <strong>{manageItem.name}</strong> expense in this budget. Payments already recorded stay with this expense.</p>
            </div>
            {manageItem.occurrence.remainingMinor > 0 && manageRemainderTarget ? <>
              <div className="annual-remainder-transfer-summary">
                <div>
                  <span>From</span>
                  <strong>{dueLabelWithYear(manageItem.occurrence.dueDate)}</strong>
                  <small>{dollars(manageItem.occurrence.remainingMinor)} remaining after payments</small>
                </div>
                <span className="annual-remainder-transfer-arrow" aria-hidden="true">→</span>
                <div>
                  <span>Next {manageItem.name}</span>
                  <strong>{dueLabelWithYear(manageRemainderTarget.occurrence.dueDate)}</strong>
                  <small>{dollars(manageRemainderTarget.occurrence.plannedAmountMinor)} planned + {dollars(manageItem.occurrence.remainingMinor)} remainder</small>
                </div>
              </div>
              <form action={remainderAction} className="annual-modal-form annual-remainder-transfer-form">
                <input type="hidden" name="annualExpenseId" value={manageItem.id} />
                <input type="hidden" name="taxYear" value={taxYear} />
                <input type="hidden" name="confirm" value="true" />
                <p className="annual-modal-help">This changes only the two planned amounts. It does not create a payment or alter the payment ledger.</p>
                <div className="annual-modal-actions">
                  <button className="annual-primary-button" type="submit" disabled={remainderPending}>{remainderPending ? "Moving…" : `Move ${dollars(manageItem.occurrence.remainingMinor)} to ${dueLabelWithYear(manageRemainderTarget.occurrence.dueDate)}`}</button>
                  <button className="annual-secondary-button" type="button" onClick={() => setManageTab("template")} disabled={remainderPending}>Keep amount here</button>
                </div>
                <FieldError message={remainderState.fieldErrors.confirm ?? remainderState.fieldErrors.annualExpenseId ?? remainderState.fieldErrors.taxYear} />
                <ActionMessage state={remainderState} />
              </form>
            </> : <div className="annual-remainder-transfer-empty">
              <strong>{manageItem.occurrence.remainingMinor > 0 ? "No later matching occurrence found" : "No positive remainder to move"}</strong>
              <p>{manageItem.occurrence.remainingMinor > 0 ? `There is no later active ${manageItem.name} expense in this budget with a due date.` : "Record a payment or adjust this expense before trying to move its unused amount."}</p>
            </div>}
          </section> : null}

          {manageTab === "transfer" ? <div className="annual-modal-split">
            <form key={`move-${manageItem.id}`} action={moveAction} className="annual-modal-form">
              <input type="hidden" name="annualExpenseId" value={manageItem.id} />
              <input type="hidden" name="fromYear" value={taxYear} />
              <input type="hidden" name="confirm" value="true" />
              <label className="annual-modal-field-wide">Move to budget<FormDropdown name="targetBudgetId" defaultValue={activeBudgets.find((target) => target.id !== manageItem.budgetId)?.id ?? ""} disabled={activeBudgets.filter((target) => target.id !== manageItem.budgetId).length === 0} options={activeBudgets.filter((target) => target.id !== manageItem.budgetId).map((target) => ({ value: target.id, label: target.name }))} floatingMinWidth={240} /></label>
              <p className="annual-modal-help">Paid history remains with its original budget.</p>
              <div className="annual-modal-actions">
                <button className="annual-secondary-button" type="submit" disabled={movePending || activeBudgets.filter((target) => target.id !== manageItem.budgetId).length === 0}>{movePending ? "Moving…" : "Confirm move"}</button>
              </div>
              <FieldError message={moveState.fieldErrors.confirm} />
              <ActionMessage state={moveState} />
            </form>
            <form key={`archive-${manageItem.id}`} action={archiveAction} className="annual-modal-form annual-modal-form-danger">
              <input type="hidden" name="annualExpenseId" value={manageItem.id} />
              <input type="hidden" name="archived" value={manageItem.isActive ? "true" : "false"} />
              <input type="hidden" name="confirm" value="true" />
              <p className="annual-modal-help">{manageItem.isActive ? "Archiving hides this item from planning while keeping its history and payments." : "Restoring returns this item to the active plan."}</p>
              <div className="annual-modal-actions">
                <button className="annual-danger-button" type="submit" disabled={archivePending}>{archivePending ? "Saving…" : manageItem.isActive ? "Archive item" : "Restore item"}</button>
              </div>
              <ActionMessage state={archiveState} />
            </form>
          </div> : null}
        </div>
      </div>
    </div> : null}
  </section>;
}
