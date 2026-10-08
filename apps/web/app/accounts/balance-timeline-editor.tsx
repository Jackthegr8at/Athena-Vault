import React, { type KeyboardEvent } from "react";
import { ConfirmationDialog } from "../components/confirmation-dialog";
import { InvestmentDropdown, type InvestmentDropdownOption } from "../investments/investment-dropdown";
import { type AccountActionState } from "./action-helpers";
import type { TimelineAccountPresentation, TimelineColumnPresentation } from "./presentation";

const timelineStatusOptions: readonly InvestmentDropdownOption<"actual" | "planned">[] = [
  { value: "actual", label: "Confirmed" },
  { value: "planned", label: "Projected" },
];

export interface BalanceTimelineConfirmationState {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly tone: "default" | "danger";
  readonly onConfirm: () => void;
}

export function BalanceTimelineConfirmation({
  confirmation,
  onCancel,
}: {
  readonly confirmation: BalanceTimelineConfirmationState | null;
  readonly onCancel: () => void;
}) {
  if (!confirmation) return null;
  return <ConfirmationDialog
    open
    title={confirmation.title}
    description={confirmation.description}
    confirmLabel={confirmation.confirmLabel}
    tone={confirmation.tone}
    onConfirm={confirmation.onConfirm}
    onCancel={onCancel}
  />;
}

export function BalanceTimelineEditor({
  account,
  column,
  action,
  noteAction,
  draftBalance,
  draftStatus,
  draftNote,
  pending,
  notePending,
  deletePending,
  state,
  noteState,
  onBalanceChange,
  onStatusChange,
  onNoteChange,
  onCancel,
  onRequestDelete,
  onKeyDown,
}: {
  readonly account: TimelineAccountPresentation;
  readonly column: TimelineColumnPresentation;
  readonly action: (formData: FormData) => void;
  readonly noteAction: (formData: FormData) => void;
  readonly draftBalance: string;
  readonly draftStatus: "actual" | "planned";
  readonly draftNote: string;
  readonly pending: boolean;
  readonly notePending: boolean;
  readonly deletePending: boolean;
  readonly state: AccountActionState;
  readonly noteState: AccountActionState;
  readonly onBalanceChange: (value: string) => void;
  readonly onStatusChange: (value: "actual" | "planned") => void;
  readonly onNoteChange: (value: string) => void;
  readonly onCancel: () => void;
  readonly onRequestDelete: () => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLFormElement>) => void;
}) {
  const disableEditor = pending || notePending || deletePending;
  const confirmFormId = `confirm-balance-${account.id}-${column.date}`;
  const noteFormId = `note-balance-${account.id}-${column.date}`;
  return <div className="timeline-cell-editor-shell">
    <form action={action} className="timeline-cell-editor" onKeyDown={onKeyDown}>
      <input type="hidden" name="accountId" value={account.id} />
      <input type="hidden" name="asOf" value={column.date} />
      <label className="sr-only" htmlFor={`balance-${account.id}-${column.date}`}>Balance for {account.name} on {column.label}</label>
      <input id={`balance-${account.id}-${column.date}`} name="balance" type="text" inputMode="decimal" pattern="^-?\d+(\.\d{1,2})?$" value={draftBalance} onChange={(event) => onBalanceChange(event.target.value)} aria-invalid={Boolean(state.fieldErrors.balance)} autoFocus disabled={disableEditor} />
      <label className="sr-only" htmlFor={`status-${account.id}-${column.date}`}>Status for {account.name} on {column.label}</label>
      {column.isFuture ? <>
        <input id={`status-${account.id}-${column.date}`} className="timeline-status-readonly" type="text" value="Projected" disabled readOnly aria-disabled="true" />
        <input type="hidden" name="status" value="planned" />
      </> : <InvestmentDropdown id={`status-${account.id}-${column.date}`} name="status" value={draftStatus} options={timelineStatusOptions} onChange={(value) => onStatusChange(value)} disabled={disableEditor} floating floatingMinWidth={200} />}
      <label className="timeline-cell-note-field" htmlFor={`note-${account.id}-${column.date}`}>
        <span>Period note</span>
        <textarea id={`note-${account.id}-${column.date}`} name="note" value={draftNote} onChange={(event) => onNoteChange(event.target.value)} maxLength={500} rows={3} placeholder="Why was this balance different?" disabled={disableEditor} />
        <div className="timeline-cell-note-actions">
          <small>{draftNote.length}/500</small>
          <button className="account-secondary-button" type="submit" form={noteFormId} disabled={disableEditor}>{notePending ? "Saving note…" : "Save note"}</button>
        </div>
      </label>
      <div className="timeline-cell-editor-actions">
        <button className="account-primary-button" type="submit" disabled={disableEditor}>{pending ? "Saving…" : "Save"}</button>
        {!column.isFuture ? <button className="account-secondary-button" type="submit" form={confirmFormId} disabled={disableEditor} aria-label="Confirm and save balance">{pending ? "Saving…" : "Confirm"}</button> : null}
        <button className="account-secondary-button" type="button" onClick={onCancel} disabled={disableEditor}>Cancel</button>
      </div>
      {state.fieldErrors.balance ? <span className="timeline-cell-error" role="alert">{state.fieldErrors.balance}</span> : null}
      {state.fieldErrors.note ? <span className="timeline-cell-error" role="alert">{state.fieldErrors.note}</span> : null}
      {noteState.message ? <span className={`timeline-cell-message ${noteState.ok ? "is-success" : "is-error"}`} role={noteState.ok ? "status" : "alert"}>{noteState.message}</span> : null}
    </form>
    {!column.isFuture ? <form id={confirmFormId} action={action} className="timeline-cell-confirm-form">
      <input type="hidden" name="accountId" value={account.id} />
      <input type="hidden" name="asOf" value={column.date} />
      <input type="hidden" name="balance" value={draftBalance} />
      <input type="hidden" name="status" value="actual" />
      <input type="hidden" name="note" value={draftNote} />
    </form> : null}
    <form id={noteFormId} action={noteAction} className="timeline-cell-note-form">
      <input type="hidden" name="accountId" value={account.id} />
      <input type="hidden" name="asOf" value={column.date} />
      <input type="hidden" name="note" value={draftNote} />
    </form>
    <div className="timeline-cell-delete-form">
      <button className="account-danger-button" type="button" disabled={disableEditor} aria-haspopup="dialog" onClick={onRequestDelete}>{deletePending ? "Resetting…" : "Reset"}</button>
    </div>
  </div>;
}
