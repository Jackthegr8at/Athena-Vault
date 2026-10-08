"use client";

import { useActionState, useCallback, useState } from "react";
import type { HouseholdExpenseView } from "@athena/database";
import { CarFront, Droplets, FileText, House, MoreHorizontal, Receipt, ShieldCheck, Umbrella, Wifi } from "lucide-react";
import {
  archiveHouseholdExpenseAction,
  createHouseholdExpenseAction,
  deleteHouseholdExpenseAction,
  restoreHouseholdExpenseAction,
  updateHouseholdExpenseAction,
} from "./expense-actions";
import { initialHouseholdExpenseActionState, type HouseholdExpenseActionState } from "./expense-state";
import { HomeMobileSubdisclosure } from "./home-mobile-subdisclosure";
import { ActionNotification } from "../components/action-notification";
import { FormDropdown } from "../components/form-dropdown";
import { type InvestmentDropdownOption } from "../investments/investment-dropdown";
import { formatMoneyInputMinor, formatMoneyMinor } from "../../lib/format-money";

type Frequency = HouseholdExpenseView["frequency"];

interface AccountOption {
  readonly id: string;
  readonly name: string;
  readonly institution: string | null;
}

export interface HouseholdExpensesManagerProps {
  readonly expenses: readonly HouseholdExpenseView[];
  readonly accounts: readonly AccountOption[];
}

const frequencyOptions: readonly { value: Frequency; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Bi-weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annually" },
];

const dollars = (minor: number) => formatMoneyMinor(minor);
const amountInput = (minor: number) => formatMoneyInputMinor(minor);
const frequencyLabel = (frequency: Frequency) => frequencyOptions.find((option) => option.value === frequency)?.label ?? frequency;

function ExpenseIcon({ expense }: { readonly expense: HouseholdExpenseView }) {
  const text = `${expense.name} ${expense.category ?? ""}`.toLowerCase();
  const iconProps = { size: 17, strokeWidth: 1.8 } as const;
  const icon = /insurance|assurance|security|sécurité/.test(text) ? <ShieldCheck {...iconProps} />
    : /hydro|water|eau|electric|electricity/.test(text) ? <Droplets {...iconProps} />
      : /internet|wifi|wi-fi|telus|bell/.test(text) ? <Wifi {...iconProps} />
        : /tax|school|scolaire|document|permit/.test(text) ? <FileText {...iconProps} />
          : /car|vehicle|voiture|fuel|gas|auto/.test(text) ? <CarFront {...iconProps} />
            : /season|lawn|pelouse|garden|outdoor/.test(text) ? <Umbrella {...iconProps} />
              : /home|house|maison|mortgage|property|maintenance/.test(text) ? <House {...iconProps} />
                : <Receipt {...iconProps} />;
  return <span className="maintenance-expense-icon" aria-hidden="true">{icon}</span>;
}

function ActionMessage({ state }: { state: HouseholdExpenseActionState }) {
  if (!state.message) return null;
  return <p className={`maintenance-message ${state.ok ? "is-success" : "is-error"}`} role={state.ok ? "status" : "alert"} aria-live="polite">{state.message}</p>;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <p className="maintenance-field-error" id={id} role="alert">{message}</p> : null;
}

interface ExpenseRowProps {
  readonly expense: HouseholdExpenseView;
  readonly onOpenActions: (expense: HouseholdExpenseView) => void;
  readonly actionPending: boolean;
}

function ExpenseRow({ expense, onOpenActions, actionPending }: ExpenseRowProps) {
  const accountLabel = expense.accountName ?? "Unassigned";
  return <tr className={expense.isActive ? undefined : "account-row-archived"}>
    <th scope="row" data-label="Expense">
      <div className="maintenance-expense-cell">
        <ExpenseIcon expense={expense} />
        <span className="maintenance-expense-name">{expense.name}{!expense.isActive ? <span className="account-status-badge is-archived" style={{ marginLeft: 8 }}>Archived</span> : null}</span>
      </div>
    </th>
    <td data-label="Category">{expense.category ?? "—"}</td>
    <td data-label="Frequency"><span className={`maintenance-frequency-badge is-${expense.frequency}`}>{frequencyLabel(expense.frequency)}</span></td>
    <td data-label="Amount">{dollars(expense.amountMinor)}</td>
    <td data-label="Annual">{dollars(expense.annualAmountMinor)}</td>
    <td data-label="Account">{accountLabel}</td>
    <td data-label="Actions">
      <button
        className="maintenance-actions-button"
        type="button"
        onClick={() => onOpenActions(expense)}
        disabled={actionPending}
        aria-label={`Open actions for ${expense.name}`}
        aria-haspopup="dialog"
      >
        <MoreHorizontal aria-hidden="true" size={20} strokeWidth={2.2} />
      </button>
    </td>
  </tr>;
}

interface ExpenseActionsModalProps {
  readonly expense: HouseholdExpenseView;
  readonly onClose: () => void;
  readonly onEdit: (expense: HouseholdExpenseView) => void;
  readonly archiveAction: (formData: FormData) => void;
  readonly restoreAction: (formData: FormData) => void;
  readonly deleteAction: (formData: FormData) => void;
  readonly archivePending: boolean;
  readonly restorePending: boolean;
  readonly deletePending: boolean;
}

function ExpenseActionsModal({
  expense,
  onClose,
  onEdit,
  archiveAction,
  restoreAction,
  deleteAction,
  archivePending,
  restorePending,
  deletePending,
}: ExpenseActionsModalProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const actionPending = archivePending || restorePending || deletePending;

  return <div className="maintenance-modal-backdrop" role="presentation" onClick={onClose}>
    <div className="maintenance-actions-modal" role="dialog" aria-modal="true" aria-labelledby="household-expense-actions-title" onClick={(event) => event.stopPropagation()}>
      <div className="maintenance-actions-modal-head">
        <div>
          <p className="eyebrow">Household expense</p>
          <h3 className="maintenance-form-title" id="household-expense-actions-title">{expense.name}</h3>
        </div>
        <button className="maintenance-secondary-button" type="button" onClick={onClose} disabled={actionPending}>Close</button>
      </div>
      {confirmDelete ? (
        <div className="maintenance-actions-confirmation" role="alertdialog" aria-label={`Confirm deletion of ${expense.name}`}>
          <p>Delete this expense permanently? This cannot be undone.</p>
          <form action={deleteAction} onSubmit={onClose} className="maintenance-confirm-actions">
            <input type="hidden" name="id" value={expense.id} />
            <button className="maintenance-danger-button" type="submit" disabled={deletePending}>{deletePending ? "Deleting…" : "Delete"}</button>
            <button className="maintenance-secondary-button" type="button" onClick={() => setConfirmDelete(false)} disabled={deletePending}>Cancel</button>
          </form>
        </div>
      ) : (
        <div className="maintenance-actions-modal-options">
          {expense.isActive ? (
            <>
              <button className="maintenance-action-menu-item" type="button" onClick={() => { onEdit(expense); onClose(); }} disabled={actionPending}>Edit</button>
              <form action={archiveAction} onSubmit={onClose}>
                <input type="hidden" name="id" value={expense.id} />
                <button className="maintenance-action-menu-item" type="submit" disabled={actionPending}>{archivePending ? "Archiving…" : "Archive"}</button>
              </form>
            </>
          ) : (
            <form action={restoreAction} onSubmit={onClose}>
              <input type="hidden" name="id" value={expense.id} />
              <button className="maintenance-action-menu-item" type="submit" disabled={actionPending}>{restorePending ? "Restoring…" : "Restore"}</button>
            </form>
          )}
          <button className="maintenance-action-menu-item is-danger" type="button" onClick={() => setConfirmDelete(true)} disabled={actionPending}>Delete</button>
        </div>
      )}
    </div>
  </div>;
}

export function HouseholdExpensesManager({ expenses, accounts }: HouseholdExpensesManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionMenuExpense, setActionMenuExpense] = useState<HouseholdExpenseView | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  const createFeedbackAction = useCallback(async (previousState: HouseholdExpenseActionState, formData: FormData): Promise<HouseholdExpenseActionState> => {
    const nextState = await createHouseholdExpenseAction(previousState, formData);
    if (nextState.ok) {
      setEditingId(null);
      setFormVersion((version) => version + 1);
    }
    return nextState;
  }, []);
  const updateFeedbackAction = useCallback(async (previousState: HouseholdExpenseActionState, formData: FormData): Promise<HouseholdExpenseActionState> => {
    const nextState = await updateHouseholdExpenseAction(previousState, formData);
    if (nextState.ok) {
      setEditingId(null);
      setFormVersion((version) => version + 1);
    }
    return nextState;
  }, []);
  const [createState, createAction, createPending] = useActionState(createFeedbackAction, initialHouseholdExpenseActionState);
  const [updateState, updateAction, updatePending] = useActionState(updateFeedbackAction, initialHouseholdExpenseActionState);
  const [archiveState, archiveAction, archivePending] = useActionState(archiveHouseholdExpenseAction, initialHouseholdExpenseActionState);
  const [restoreState, restoreAction, restorePending] = useActionState(restoreHouseholdExpenseAction, initialHouseholdExpenseActionState);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteHouseholdExpenseAction, initialHouseholdExpenseActionState);
  const editingItem = editingId ? expenses.find((expense) => expense.id === editingId) ?? null : null;
  const formState = editingId ? updateState : createState;
  const formPending = editingId ? updatePending : createPending;
  const activeExpenses = expenses.filter((expense) => expense.isActive);
  const archivedExpenses = expenses.filter((expense) => !expense.isActive);
  const accountOptions: readonly InvestmentDropdownOption[] = [
    { value: "", label: "Unassigned" },
    ...accounts.map((account) => ({ value: account.id, label: account.institution ? `${account.name} — ${account.institution}` : account.name })),
  ];

  return <section className="home-household-expenses" aria-labelledby="household-expenses-heading">
    <div className="home-household-expenses-grid">
      <HomeMobileSubdisclosure
        eyebrow="Manage"
        title={editingItem ? "Edit household expense" : "Add household expense"}
        meta={editingItem ? "Editing" : "New expense"}
        defaultOpen={Boolean(editingItem)}
      >
      <div className="maintenance-form-panel home-household-expense-form">
      <div className="card-head">
        <div>
          <h4 className="maintenance-form-title">{editingItem ? "Edit household expense" : "Add household expense"}</h4>
          <p className="card-subtitle">Amounts are per occurrence and shown in CAD.</p>
        </div>
      </div>
      <form key={`${editingId ?? "new"}-${formVersion}`} action={editingId ? updateAction : createAction} className="maintenance-form">
        {editingId ? <input type="hidden" name="id" value={editingId} /> : null}
        <div className="maintenance-form-fields home-household-primary-fields">
          <div className="maintenance-field">
            <label htmlFor="expense-name">Name</label>
            <input id="expense-name" name="name" type="text" required maxLength={120} defaultValue={editingItem?.name ?? ""} aria-describedby={formState.fieldErrors.name ? "expense-name-error" : undefined} />
            <FieldError id="expense-name-error" message={formState.fieldErrors.name} />
          </div>
          <div className="maintenance-field">
            <label htmlFor="expense-category">Category</label>
            <input id="expense-category" name="category" type="text" maxLength={80} defaultValue={editingItem?.category ?? ""} placeholder="e.g. home" aria-describedby={formState.fieldErrors.category ? "expense-category-error" : undefined} />
            <FieldError id="expense-category-error" message={formState.fieldErrors.category} />
          </div>
          <div className="maintenance-field home-household-amount-field">
            <label htmlFor="expense-amount">Amount per occurrence (CAD)</label>
            <input id="expense-amount" name="amount" type="text" inputMode="decimal" pattern="^\d+(\.\d{1,2})?$" placeholder="0.00" required defaultValue={editingItem ? amountInput(editingItem.amountMinor) : ""} aria-describedby={formState.fieldErrors.amount ? "expense-amount-error" : undefined} />
            <FieldError id="expense-amount-error" message={formState.fieldErrors.amount} />
          </div>
        </div>
        <div className="maintenance-form-fields home-household-secondary-fields">
          <div className="maintenance-field">
            <label htmlFor="expense-frequency">Frequency</label>
            <FormDropdown id="expense-frequency" name="frequency" defaultValue={editingItem?.frequency ?? "monthly"} options={frequencyOptions} describedBy={formState.fieldErrors.frequency ? "expense-frequency-error" : undefined} invalid={Boolean(formState.fieldErrors.frequency)} />
            <FieldError id="expense-frequency-error" message={formState.fieldErrors.frequency} />
          </div>
          <div className="maintenance-field">
            <label htmlFor="expense-account">Account</label>
            <FormDropdown id="expense-account" name="accountId" defaultValue={editingItem?.accountId ?? ""} options={accountOptions} describedBy={formState.fieldErrors.accountId ? "expense-account-error" : undefined} invalid={Boolean(formState.fieldErrors.accountId)} />
            <FieldError id="expense-account-error" message={formState.fieldErrors.accountId} />
          </div>
        </div>
        <div className="maintenance-form-actions">
          <button className="maintenance-primary-button navy-action-button" type="submit" disabled={formPending}>
            <span>{formPending ? "Saving…" : editingItem ? "Save changes" : "Add expense"}</span>
            {!editingItem ? <span className="navy-action-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg></span> : null}
          </button>
          {editingItem ? <button className="maintenance-secondary-button" type="button" onClick={() => setEditingId(null)} disabled={formPending}>Cancel</button> : null}
        </div>
        <ActionMessage state={formState} />
      </form>
      </div>
      </HomeMobileSubdisclosure>
      <div className="home-household-ledger-card">
        <div className="home-household-ledger-header">
          <div>
            <p className="eyebrow">Household ledger</p>
            <h3 className="card-title" id="household-expenses-heading">Household expenses</h3>
            <p className="card-subtitle">Editable recurring and annual household expenses linked to an account.</p>
          </div>
          <span className="home-household-ledger-count">{activeExpenses.length} active expense{activeExpenses.length === 1 ? "" : "s"}</span>
        </div>

    {activeExpenses.length > 0 ? <div className="maintenance-table-wrap">
      <table className="maintenance-table">
        <caption className="sr-only">Active household expenses</caption>
        <thead><tr><th scope="col">Expense</th><th scope="col">Category</th><th scope="col">Frequency</th><th scope="col">Amount</th><th scope="col">Annual</th><th scope="col">Account</th><th scope="col">Actions</th></tr></thead>
        <tbody>{activeExpenses.map((expense) => <ExpenseRow
          key={expense.id}
          expense={expense}
          onOpenActions={setActionMenuExpense}
          actionPending={archivePending || restorePending || deletePending}
        />)}</tbody>
      </table>
    </div> : <div className="maintenance-empty">No active household expenses yet. Add the first one above.</div>}

    {archivedExpenses.length > 0 ? <div className="maintenance-table-wrap" style={{ marginTop: 18 }}>
      <button className="maintenance-secondary-button" type="button" onClick={() => setShowArchived((show) => !show)}>{showArchived ? "Hide archived" : `Show archived (${archivedExpenses.length})`}</button>
      {showArchived ? <table className="maintenance-table" style={{ marginTop: 12 }}>
        <caption className="sr-only">Archived household expenses</caption>
        <thead><tr><th scope="col">Expense</th><th scope="col">Category</th><th scope="col">Frequency</th><th scope="col">Amount</th><th scope="col">Annual</th><th scope="col">Account</th><th scope="col">Actions</th></tr></thead>
        <tbody>{archivedExpenses.map((expense) => <ExpenseRow
          key={expense.id}
          expense={expense}
          onOpenActions={setActionMenuExpense}
          actionPending={archivePending || restorePending || deletePending}
        />)}</tbody>
      </table> : null}
    </div> : null}
        </div>
    </div>
    <ActionNotification state={archiveState} />
    <ActionNotification state={restoreState} />
    <ActionNotification state={deleteState} />
    {actionMenuExpense ? <ExpenseActionsModal
      expense={actionMenuExpense}
      onClose={() => setActionMenuExpense(null)}
      onEdit={(item) => setEditingId(item.id)}
      archiveAction={archiveAction}
      restoreAction={restoreAction}
      deleteAction={deleteAction}
      archivePending={archivePending}
      restorePending={restorePending}
      deletePending={deletePending}
    /> : null}
  </section>;
}
