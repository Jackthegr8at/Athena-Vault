"use client";

import { useActionState, useCallback, useState } from "react";
import { Plus, TrendingUp, Wallet } from "lucide-react";
import {
  createMaintenanceItemAction,
  deleteMaintenanceItemAction,
  updateMaintenanceItemAction,
} from "./actions";
import { initialMaintenanceActionState, type MaintenanceActionState } from "./action-helpers";
import { HomeMobileSubdisclosure } from "./home-mobile-subdisclosure";
import { ActionNotification } from "../components/action-notification";
import { FormDropdown } from "../components/form-dropdown";
import { formatMoneyInputMinor, formatMoneyMinor } from "../../lib/format-money";

type MaintenanceFrequency = "weekly" | "biweekly" | "monthly" | "annual";

interface MaintenanceItem {
  readonly id: string;
  readonly name: string;
  readonly amountMinor: number;
  readonly frequency: MaintenanceFrequency;
  readonly annualizedAmountMinor: number;
}

interface MaintenanceSummary {
  readonly amountMinor: number;
  readonly annualAmountMinor: number;
}

export interface MaintenanceManagerProps {
  readonly items: readonly MaintenanceItem[];
  readonly summary: MaintenanceSummary | null;
}

const frequencyOptions: readonly { value: MaintenanceFrequency; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Bi-weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "annual", label: "Annually" },
];

const dollars = (minor: number) => formatMoneyMinor(minor);
const amountInput = (minor: number) => formatMoneyInputMinor(minor);
const frequencyLabel = (frequency: MaintenanceFrequency) => frequencyOptions.find((option) => option.value === frequency)?.label ?? frequency;

function ActionMessage({ state }: { state: MaintenanceActionState }) {
  if (!state.message) return null;
  return <p className={`maintenance-message ${state.ok ? "is-success" : "is-error"}`} role={state.ok ? "status" : "alert"} aria-live="polite">{state.message}</p>;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <p className="maintenance-field-error" id={id} role="alert">{message}</p> : null;
}

export function MaintenanceManager({ items, summary }: MaintenanceManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<MaintenanceItem | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  const createFeedbackAction = useCallback(async (previousState: MaintenanceActionState, formData: FormData): Promise<MaintenanceActionState> => {
    const nextState = await createMaintenanceItemAction(previousState, formData);
    if (nextState.ok) {
      setEditingId(null);
      setFormVersion((version) => version + 1);
    }
    return nextState;
  }, []);
  const updateFeedbackAction = useCallback(async (previousState: MaintenanceActionState, formData: FormData): Promise<MaintenanceActionState> => {
    const nextState = await updateMaintenanceItemAction(previousState, formData);
    if (nextState.ok) {
      setEditingId(null);
      setFormVersion((version) => version + 1);
    }
    return nextState;
  }, []);
  const deleteFeedbackAction = useCallback(async (previousState: MaintenanceActionState, formData: FormData): Promise<MaintenanceActionState> => {
    const nextState = await deleteMaintenanceItemAction(previousState, formData);
    if (nextState.ok) setDeleteCandidate(null);
    return nextState;
  }, []);
  const [createState, createAction, createPending] = useActionState(createFeedbackAction, initialMaintenanceActionState);
  const [updateState, updateAction, updatePending] = useActionState(updateFeedbackAction, initialMaintenanceActionState);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteFeedbackAction, initialMaintenanceActionState);
  const editingItem = editingId ? items.find((item) => item.id === editingId) ?? null : null;
  const formState = editingId ? updateState : createState;
  const formPending = editingId ? updatePending : createPending;

  return <section className="card section-card maintenance-card" aria-labelledby="maintenance-heading">
    <div className="card-head maintenance-card-head">
      <div>
        <h3 className="card-title" id="maintenance-heading">Annual maintenance</h3>
        <p className="card-subtitle">Editable reserves, annualized from each amount per occurrence.</p>
      </div>
      <span className="maintenance-item-count"><Wallet aria-hidden="true" size={15} strokeWidth={1.8} />{items.length} {items.length === 1 ? "item" : "items"}</span>
    </div>

    <div className="maintenance-summary" aria-label="Annual maintenance totals">
      <div className="maintenance-summary-metric"><span className="maintenance-summary-icon"><Wallet aria-hidden="true" size={28} strokeWidth={1.6} /></span><div><span className="maintenance-summary-label">Monthly reserve</span><strong>{dollars(summary?.amountMinor ?? 0)}</strong></div></div>
      <div className="maintenance-summary-metric"><span className="maintenance-summary-icon"><TrendingUp aria-hidden="true" size={28} strokeWidth={1.6} /></span><div><span className="maintenance-summary-label">Annual total</span><strong>{dollars(summary?.annualAmountMinor ?? 0)}</strong></div></div>
    </div>

    <HomeMobileSubdisclosure
      eyebrow="Manage"
      title={editingItem ? "Edit maintenance item" : "Add maintenance item"}
      meta={editingItem ? "Editing" : "New reserve"}
      defaultOpen={Boolean(editingItem)}
    >
    <div className="maintenance-form-panel">
      <div className="card-head">
        <div>
          <h4 className="maintenance-form-title">{editingItem ? "Edit maintenance item" : "Add maintenance item"}</h4>
          <p className="card-subtitle">Amounts are per occurrence and shown in CAD.</p>
        </div>
      </div>
      <form key={`${editingId ?? "new"}-${formVersion}`} action={editingId ? updateAction : createAction} className="maintenance-form">
        {editingId ? <input type="hidden" name="id" value={editingId} /> : null}
        <div className="maintenance-form-fields">
          <div className="maintenance-field">
            <label htmlFor="maintenance-name">Name</label>
            <input id="maintenance-name" name="name" type="text" required maxLength={120} defaultValue={editingItem?.name ?? ""} aria-describedby={formState.fieldErrors.name ? "maintenance-name-error" : undefined} />
            <FieldError id="maintenance-name-error" message={formState.fieldErrors.name} />
          </div>
          <div className="maintenance-field">
            <label htmlFor="maintenance-amount">Amount per occurrence (CAD)</label>
            <input id="maintenance-amount" name="amount" type="text" inputMode="decimal" pattern="^\d+(\.\d{1,2})?$" placeholder="0.00" required defaultValue={editingItem ? amountInput(editingItem.amountMinor) : ""} aria-describedby={formState.fieldErrors.amount ? "maintenance-amount-error" : undefined} />
            <FieldError id="maintenance-amount-error" message={formState.fieldErrors.amount} />
          </div>
          <div className="maintenance-field">
            <label htmlFor="maintenance-frequency">Frequency</label>
            <FormDropdown id="maintenance-frequency" name="frequency" defaultValue={editingItem?.frequency ?? "annual"} options={frequencyOptions} describedBy={formState.fieldErrors.frequency ? "maintenance-frequency-error" : undefined} invalid={Boolean(formState.fieldErrors.frequency)} floatingMinWidth={200} />
            <FieldError id="maintenance-frequency-error" message={formState.fieldErrors.frequency} />
          </div>
        </div>
        <div className="maintenance-form-actions">
          {editingItem ? <button className="maintenance-primary-button" type="submit" disabled={formPending}>{formPending ? "Saving…" : "Save changes"}</button> : <button className="navy-action-button" type="submit" disabled={formPending}><span>Add item</span><span className="navy-action-icon" aria-hidden="true"><Plus size={14} strokeWidth={2.5} /></span></button>}
          {editingItem ? <button className="maintenance-secondary-button" type="button" onClick={() => setEditingId(null)} disabled={formPending}>Cancel</button> : null}
        </div>
        <ActionMessage state={formState} />
      </form>
    </div>
    </HomeMobileSubdisclosure>

    {items.length > 0 ? <div className="maintenance-table-wrap">
      <table className="maintenance-table">
        <caption className="sr-only">Annual maintenance items</caption>
        <thead><tr><th scope="col">Item</th><th scope="col">Per occurrence</th><th scope="col">Frequency</th><th scope="col">Annualized</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{items.map((item) => <tr key={item.id}>
          <th scope="row" data-label="Item">{item.name}</th>
          <td data-label="Per occurrence">{dollars(item.amountMinor)}</td>
          <td data-label="Frequency">{frequencyLabel(item.frequency)}</td>
          <td data-label="Annualized">{dollars(item.annualizedAmountMinor)}</td>
          <td data-label="Actions">
            <div className="maintenance-row-actions">
              <button className="maintenance-secondary-button" type="button" onClick={() => setEditingId(item.id)} disabled={formPending || deletePending}>Edit</button>
              <button className="maintenance-danger-button" type="button" onClick={() => setDeleteCandidate(item)} disabled={formPending || deletePending}>Delete</button>
            </div>
            {deleteCandidate?.id === item.id ? <div className="maintenance-confirm" role="alertdialog" aria-label={`Confirm deletion of ${item.name}`}>
              <span>Delete {item.name}?</span>
              <form action={deleteAction} className="maintenance-confirm-actions">
                <input type="hidden" name="id" value={item.id} />
                <button className="maintenance-danger-button" type="submit" disabled={deletePending}>{deletePending ? "Deleting…" : "Delete"}</button>
                <button className="maintenance-secondary-button" type="button" onClick={() => setDeleteCandidate(null)} disabled={deletePending}>Cancel</button>
              </form>
            </div> : null}
          </td>
        </tr>)}</tbody>
      </table>
    </div> : <div className="maintenance-empty">No maintenance items yet. Add the first reserve above.</div>}
    <ActionNotification state={deleteState} />
  </section>;
}
