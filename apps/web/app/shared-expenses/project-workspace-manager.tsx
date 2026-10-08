"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import type { SharedProjectSummaryView } from "@athena/database";
import {
  cloneProjectAction,
  createProjectExpenseAction,
  createProjectParticipantAction,
  deleteProjectExpenseAction,
  deleteProjectParticipantAction,
  setProjectArchivedAction,
  updateProjectAction,
  updateProjectExpenseAction,
  updateProjectParticipantAction,
} from "./actions";
import { initialProjectActionState, type ProjectActionField, type ProjectActionState } from "./action-helpers";
import { formatMoneyInputMinor, formatMoneyMinor, formatSignedMoneyMinor } from "../../lib/format-money";

export interface ProjectWorkspacePresentation {
  readonly id: string;
  readonly name: string;
  readonly projectYear: number;
  readonly ownerParticipates: boolean;
  readonly note: string | null;
  readonly archived: boolean;
  readonly summary: SharedProjectSummaryView;
  readonly expenses: readonly {
    readonly id: string;
    readonly projectId: string;
    readonly description: string;
    readonly expenseOn: string | null;
    readonly quantity: number;
    readonly amountMinor: number;
    readonly totalMinor: number;
    readonly note: string | null;
  }[];
  readonly participants: readonly {
    readonly id: string;
    readonly projectId: string;
    readonly name: string;
    readonly paidMinor: number;
    readonly owedMinor: number | null;
    readonly remainingMinor: number | null;
    readonly extraMinor: number | null;
    readonly status: "unpaid" | "partial" | "paid" | "extra";
  }[];
}

function money(value: number | null): string {
  return formatMoneyMinor(value, { unavailableLabel: "-" });
}

function moneyInput(value: number | null): string {
  if (value === null) return "";
  return formatMoneyInputMinor(value);
}

function signedMoney(value: number | null): string {
  return formatSignedMoneyMinor(value, { unavailableLabel: "-" });
}

function fieldError(state: ProjectActionState, field: ProjectActionField): string | null {
  return state.fieldErrors[field] ?? null;
}

function ActionMessage({ state }: { readonly state: ProjectActionState }) {
  return state.message ? <p className={`project-action-message ${state.ok ? "is-success" : "is-error"}`} role="status">{state.message}</p> : null;
}

function FieldError({ state, field }: { readonly state: ProjectActionState; readonly field: ProjectActionField }) {
  const message = fieldError(state, field);
  return message ? <span className="project-field-error">{message}</span> : null;
}

function useRefreshAfterSuccess(state: ProjectActionState): void {
  const router = useRouter();
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [router, state]);
}

function participantStatusLabel(status: ProjectWorkspacePresentation["participants"][number]["status"]): string {
  return ({ unpaid: "Unpaid", partial: "Partial", paid: "Paid", extra: "Extra" } as const)[status];
}

export function quickPaidCheckboxChecked(participant: Pick<ProjectWorkspacePresentation["participants"][number], "status" | "paidMinor" | "owedMinor">): boolean {
  return participant.status === "paid" || participant.status === "extra";
}

function ProjectDetailsForm({ project }: { readonly project: ProjectWorkspacePresentation }) {
  const [open, setOpen] = useState(false);
  const updateProjectAndClose = useCallback(async (previousState: ProjectActionState, formData: FormData): Promise<ProjectActionState> => {
    const result = await updateProjectAction(previousState, formData);
    if (result.ok) setOpen(false);
    return result;
  }, []);
  const [state, action, pending] = useActionState(updateProjectAndClose, initialProjectActionState);
  useRefreshAfterSuccess(state);
  return <>
    <details className="project-details-editor" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="project-secondary-button">{open ? "Close edit" : "Edit project details"}</summary>
    </details>
    {open ? <form action={action} className="project-inline-form project-details-form">
      <input type="hidden" name="projectId" value={project.id} />
      <label>Project name<input name="name" required maxLength={120} defaultValue={project.name} /><FieldError state={state} field="name" /></label>
      <label>Year<input name="year" type="number" min={1900} max={2200} required defaultValue={project.projectYear} /><FieldError state={state} field="year" /></label>
      <label className="project-checkbox-label"><input name="ownerParticipates" type="checkbox" value="true" defaultChecked={project.ownerParticipates} /> I participate in the split</label>
      <label className="project-field-wide">Note <span>(optional)</span><textarea name="projectNote" maxLength={500} rows={2} defaultValue={project.note ?? ""} /><FieldError state={state} field="projectNote" /></label>
      <div className="project-form-actions"><button className="project-primary-button" type="submit" disabled={pending}>{pending ? "Saving..." : "Save details"}</button><ActionMessage state={state} /></div>
    </form> : null}
  </>;
}

function ProjectCloneControl({ project }: { readonly project: ProjectWorkspacePresentation }) {
  const [state, action, pending] = useActionState(cloneProjectAction, initialProjectActionState);
  const [open, setOpen] = useState(false);
  return <>
    <details className="project-clone-editor" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="project-secondary-button">{open ? "Close template" : "Use as template"}</summary>
    </details>
    {open ? <form action={action} className="project-inline-form project-clone-form">
      <input type="hidden" name="sourceProjectId" value={project.id} />
      <label>Project name<input name="name" required maxLength={120} defaultValue={project.name} /><FieldError state={state} field="name" /></label>
      <label>Year<input name="year" type="number" min={1900} max={2200} required defaultValue={project.projectYear} /><FieldError state={state} field="year" /></label>
      <p className="project-clone-help">Expenses are copied; participant payments start at $0.00.</p>
      <div className="project-form-actions"><button className="project-primary-button" type="submit" disabled={pending}>{pending ? "Creating..." : "Create project"}</button><button className="project-secondary-button" type="button" onClick={() => setOpen(false)} disabled={pending}>Cancel</button><ActionMessage state={state} /></div>
    </form> : null}
  </>;
}

function ArchiveControl({ project }: { readonly project: ProjectWorkspacePresentation }) {
  const [state, action, pending] = useActionState(setProjectArchivedAction, initialProjectActionState);
  useRefreshAfterSuccess(state);
  return <details className="project-lifecycle-control">
    <summary className="project-secondary-button">{project.archived ? "Restore project" : "Archive project"}</summary>
    <form action={action} className="project-confirm-form">
      <input type="hidden" name="projectId" value={project.id} />
      <input type="hidden" name="archived" value={String(!project.archived)} />
      <label className="project-checkbox-label"><input name="confirm" type="checkbox" value="true" required /> Confirm {project.archived ? "restoring" : "archiving"} this project</label>
      <button className="project-secondary-button" type="submit" disabled={pending}>{pending ? "Saving..." : project.archived ? "Restore" : "Archive"}</button>
      <FieldError state={state} field="confirm" /><ActionMessage state={state} />
    </form>
  </details>;
}

function ExpenseForm({ projectId, expense, onSuccess }: { readonly projectId: string; readonly expense?: ProjectWorkspacePresentation["expenses"][number]; readonly onSuccess?: () => void }) {
  const saveExpenseAction = expense ? updateProjectExpenseAction : createProjectExpenseAction;
  const saveExpenseAndNotify = useCallback(async (previousState: ProjectActionState, formData: FormData): Promise<ProjectActionState> => {
    const result = await saveExpenseAction(previousState, formData);
    if (result.ok) onSuccess?.();
    return result;
  }, [onSuccess, saveExpenseAction]);
  const [state, action, pending] = useActionState(saveExpenseAndNotify, initialProjectActionState);
  useRefreshAfterSuccess(state);
  return <form action={action} className="project-inline-form">
    <input type="hidden" name="projectId" value={projectId} />
    {expense ? <input type="hidden" name="expenseId" value={expense.id} /> : null}
    <label>Description<input name="description" required maxLength={240} defaultValue={expense?.description ?? ""} /><FieldError state={state} field="description" /></label>
    <label>Date <span>(optional)</span><input name="expenseOn" type="date" defaultValue={expense?.expenseOn ?? ""} /><FieldError state={state} field="expenseOn" /></label>
    <label>Quantity <span>(optional)</span><input name="quantity" type="number" inputMode="numeric" min={1} step={1} placeholder="1" defaultValue={expense ? expense.quantity : ""} /><FieldError state={state} field="quantity" /></label>
    <label>Unit amount<input name="amount" inputMode="decimal" required placeholder="712.43" defaultValue={expense ? moneyInput(expense.amountMinor) : ""} /><FieldError state={state} field="amount" /></label>
    <label className="project-field-wide">Note <span>(optional)</span><input name="note" maxLength={500} defaultValue={expense?.note ?? ""} /><FieldError state={state} field="note" /></label>
    <div className="project-form-actions"><button className="project-primary-button" type="submit" disabled={pending}>{pending ? "Saving..." : expense ? "Save expense" : "Add expense"}</button><ActionMessage state={state} /></div>
  </form>;
}

function ExpenseRow({ projectId, expense }: { readonly projectId: string; readonly expense: ProjectWorkspacePresentation["expenses"][number] }) {
  const [editing, setEditing] = useState(false);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteProjectExpenseAction, initialProjectActionState);
  useRefreshAfterSuccess(deleteState);
  return <>
    <tr>
      <th scope="row" data-label="Date / description">{expense.description}<small>{expense.expenseOn ?? "Undated"}{expense.note ? ` - ${expense.note}` : ""}</small></th>
      <td data-label="Quantity">{expense.quantity}</td>
      <td data-label="Unit amount">{money(expense.amountMinor)}</td>
      <td data-label="Total">{money(expense.totalMinor)}</td>
      <td data-label="Actions"><div className="project-row-actions"><button className="project-secondary-button" type="button" onClick={() => setEditing((open) => !open)}>{editing ? "Close" : "Edit"}</button><details><summary className="project-danger-button">Delete</summary><form action={deleteAction} className="project-confirm-popover"><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="expenseId" value={expense.id} /><label className="project-checkbox-label"><input name="confirm" type="checkbox" value="true" required /> Confirm</label><button className="project-danger-button" type="submit" disabled={deletePending}>{deletePending ? "Deleting..." : "Delete expense"}</button><FieldError state={deleteState} field="confirm" /><ActionMessage state={deleteState} /></form></details></div></td>
    </tr>
    {editing ? <tr className="project-edit-row"><td colSpan={5}><ExpenseForm projectId={projectId} expense={expense} /></td></tr> : null}
  </>;
}

function QuickPaidForm({ projectId, participant }: { readonly projectId: string; readonly participant: ProjectWorkspacePresentation["participants"][number] }) {
  const [checked, setChecked] = useState(() => quickPaidCheckboxChecked(participant));
  const paidInputRef = useRef<HTMLInputElement>(null);
  const [state, action, pending] = useActionState(updateProjectParticipantAction, initialProjectActionState);
  useRefreshAfterSuccess(state);
  const share = participant.owedMinor;
  return <form action={action} className="project-quick-paid-form">
    <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="participantId" value={participant.id} /><input type="hidden" name="participantName" value={participant.name} />
    <input ref={paidInputRef} type="hidden" name="paidAmount" value={checked && share !== null ? moneyInput(share) : "0"} />
    <label className="project-paid-checkbox"><input type="checkbox" checked={checked} disabled={pending || share === null} onChange={(event) => { const next = event.currentTarget.checked; setChecked(next); if (paidInputRef.current) paidInputRef.current.value = next && share !== null ? moneyInput(share) : "0"; event.currentTarget.form?.requestSubmit(); }} /> Paid</label>
    <ActionMessage state={state} />
  </form>;
}

function ParticipantForm({ projectId, participant }: { readonly projectId: string; readonly participant: ProjectWorkspacePresentation["participants"][number] }) {
  const [state, action, pending] = useActionState(updateProjectParticipantAction, initialProjectActionState);
  useRefreshAfterSuccess(state);
  return <form action={action} className="project-inline-form">
    <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="participantId" value={participant.id} />
    <label>Name<input name="participantName" required maxLength={120} defaultValue={participant.name} /><FieldError state={state} field="participantName" /></label>
    <label>Paid amount<input name="paidAmount" inputMode="decimal" required defaultValue={moneyInput(participant.paidMinor)} /><FieldError state={state} field="paidAmount" /></label>
    <div className="project-form-actions"><button className="project-primary-button" type="submit" disabled={pending}>{pending ? "Saving..." : "Save payment"}</button><ActionMessage state={state} /></div>
  </form>;
}

function ParticipantRow({ projectId, participant }: { readonly projectId: string; readonly participant: ProjectWorkspacePresentation["participants"][number] }) {
  const [editing, setEditing] = useState(false);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteProjectParticipantAction, initialProjectActionState);
  useRefreshAfterSuccess(deleteState);
  const difference = participant.extraMinor && participant.extraMinor > 0 ? `Extra ${money(participant.extraMinor)}` : `Remaining ${money(participant.remainingMinor)}`;
  return <>
    <tr>
      <th scope="row" data-label="Participant">{participant.name}<small>{participantStatusLabel(participant.status)}</small></th>
      <td data-label="Owed">{money(participant.owedMinor)}</td>
      <td data-label="Paid"><div className="project-paid-cell"><QuickPaidForm key={`${participant.id}:${participant.status}:${participant.paidMinor}:${participant.owedMinor ?? "unavailable"}`} projectId={projectId} participant={participant} /><span>{money(participant.paidMinor)}</span></div></td>
      <td data-label="Remaining / extra"><span className={`project-status project-status--${participant.status}`}>{difference}</span></td>
      <td data-label="Actions"><div className="project-row-actions"><button className="project-secondary-button" type="button" onClick={() => setEditing((open) => !open)}>{editing ? "Close" : "Edit"}</button><details><summary className="project-danger-button">Delete</summary><form action={deleteAction} className="project-confirm-popover"><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="participantId" value={participant.id} /><label className="project-checkbox-label"><input name="confirm" type="checkbox" value="true" required /> Confirm</label><button className="project-danger-button" type="submit" disabled={deletePending}>{deletePending ? "Deleting..." : "Delete participant"}</button><FieldError state={deleteState} field="confirm" /><ActionMessage state={deleteState} /></form></details></div></td>
    </tr>
    {editing ? <tr className="project-edit-row"><td colSpan={5}><ParticipantForm projectId={projectId} participant={participant} /></td></tr> : null}
  </>;
}

function NewParticipantForm({ projectId }: { readonly projectId: string }) {
  const [state, action, pending] = useActionState(createProjectParticipantAction, initialProjectActionState);
  useRefreshAfterSuccess(state);
  return <form action={action} className="project-inline-form"><input type="hidden" name="projectId" value={projectId} /><label>Name<input name="participantName" required maxLength={120} /><FieldError state={state} field="participantName" /></label><label>Paid amount<input name="paidAmount" inputMode="decimal" defaultValue="0.00" required /><FieldError state={state} field="paidAmount" /></label><div className="project-form-actions"><button className="project-primary-button" type="submit" disabled={pending}>{pending ? "Adding..." : "Add participant"}</button><ActionMessage state={state} /></div></form>;
}

function SummaryBand({ summary }: { readonly summary: SharedProjectSummaryView }) {
  const metrics: readonly [string, string][] = [
    ["Expenses", money(summary.totalExpensesMinor)], ["Share / person", money(summary.sharePerPersonMinor)], ["Expected from others", money(summary.expectedFromOthersMinor)], ["Received", money(summary.receivedFromOthersMinor)],
    ["Outstanding", money(summary.outstandingMinor)], ["Overpayment", money(summary.overpaymentReceivedMinor)], ["Rounding difference", signedMoney(summary.roundingDifferenceMinor)], ["Net cash result", signedMoney(summary.netCashResultMinor)],
  ];
  const secondaryMetrics = metrics.filter(([label]) => !PRIMARY_MOBILE_SUMMARY_LABELS.has(label));
  return <div className="project-summary-band" aria-label="Project summary">
    {metrics.map(([label, value]) => <div key={label} className={`project-summary-metric ${PRIMARY_MOBILE_SUMMARY_LABELS.has(label) ? "project-summary-metric--primary" : "project-summary-metric--secondary"}`}><span>{label}</span><strong>{value}</strong></div>)}
    <details className="project-mobile-summary-details project-mobile-only"><summary>View more totals <span aria-hidden="true">⌄</span></summary><div className="project-mobile-summary-secondary">{secondaryMetrics.map(([label, value]) => <div key={label} className="project-summary-metric project-summary-metric--secondary"><span>{label}</span><strong>{value}</strong></div>)}</div></details>
    <p className="project-summary-note">{summary.canCalculate ? summary.ownerShareMinor === null ? "Owner is not included in the split." : `Owner share: ${money(summary.ownerShareMinor)} (not collectible).` : "Add a participant or choose I participate in the project split to calculate a share."}</p>
  </div>;
}

const PRIMARY_MOBILE_SUMMARY_LABELS = new Set(["Expenses", "Share / person", "Received", "Outstanding"]);

export function ProjectWorkspaceManager({ project }: { readonly project: ProjectWorkspacePresentation }) {
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [participantOpen, setParticipantOpen] = useState(false);
  const [mobileLedger, setMobileLedger] = useState<"expenses" | "participants">("expenses");
  return <section id="project-workspace" className="project-workspace">
    <div className="project-workspace-header"><div><Link className="project-back-link" href="/shared-expenses">&lt;- Shared Expenses</Link><div className="project-title-line"><h3>{project.name}</h3><span className={`project-status project-status--${project.archived ? "archived" : "active"}`}>{project.archived ? "Archived" : "Active"}</span></div><p>{project.projectYear}{project.note ? ` - ${project.note}` : ""}</p></div><ProjectDetailsForm project={project} /><ProjectCloneControl project={project} /><div className="project-workspace-actions"><ArchiveControl project={project} /></div></div>
    <SummaryBand summary={project.summary} />
    <div className="project-mobile-ledger-tabs project-mobile-only" role="tablist" aria-label="Project ledgers"><button type="button" role="tab" aria-selected={mobileLedger === "expenses"} aria-controls="project-expenses-panel" onClick={() => setMobileLedger("expenses")}>Expenses <span>{project.expenses.length}</span></button><button type="button" role="tab" aria-selected={mobileLedger === "participants"} aria-controls="project-participants-panel" onClick={() => setMobileLedger("participants")}>People <span>{project.participants.length}</span></button></div>
    <div className="project-tables-grid">
      <article id="project-expenses-panel" className={`project-table-panel project-ledger-panel project-ledger-panel--expenses ${mobileLedger === "expenses" ? "is-mobile-active" : ""}`}><div className="project-panel-heading"><div><span className="eyebrow">Project ledger</span><h3>Expenses</h3></div><button className="project-secondary-button" type="button" onClick={() => setExpenseOpen((open) => !open)} aria-expanded={expenseOpen}>{expenseOpen ? "Close" : "Add expense"}</button></div>{expenseOpen ? <ExpenseForm projectId={project.id} onSuccess={() => setExpenseOpen(false)} /> : null}<div className="project-table-wrap"><table className="project-detail-table"><thead><tr><th scope="col">Date / description</th><th scope="col">Quantity</th><th scope="col">Unit amount</th><th scope="col">Total</th><th scope="col">Actions</th></tr></thead><tbody>{project.expenses.length === 0 ? <tr><td colSpan={5} className="project-table-empty">No expenses yet. Add the first cost to begin the split.</td></tr> : project.expenses.map((expense) => <ExpenseRow key={expense.id} projectId={project.id} expense={expense} />)}</tbody></table></div></article>
      <article id="project-participants-panel" className={`project-table-panel project-ledger-panel project-ledger-panel--participants ${mobileLedger === "participants" ? "is-mobile-active" : ""}`}><div className="project-panel-heading"><div><span className="eyebrow">Collection ledger</span><h3>Participants</h3></div><button className="project-secondary-button" type="button" onClick={() => setParticipantOpen((open) => !open)} aria-expanded={participantOpen}>{participantOpen ? "Close" : "Add participant"}</button></div>{participantOpen ? <NewParticipantForm projectId={project.id} /> : null}<div className="project-table-wrap"><table className="project-detail-table project-participant-table"><thead><tr><th scope="col">Participant</th><th scope="col">Owed</th><th scope="col">Paid</th><th scope="col">Remaining / extra</th><th scope="col">Actions</th></tr></thead><tbody>{project.participants.length === 0 ? <tr><td colSpan={5} className="project-table-empty">No participants yet. Add people who should reimburse the owner.</td></tr> : project.participants.map((participant) => <ParticipantRow key={participant.id} projectId={project.id} participant={participant} />)}</tbody></table></div></article>
    </div>
  </section>;
}
