"use client";

import { startTransition, useActionState, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronUp, CreditCard, Landmark, MoreHorizontal, PiggyBank, Plus, Wallet, type LucideIcon } from "lucide-react";
import { ActionNotification } from "../components/action-notification";
import { ConfirmationDialog } from "../components/confirmation-dialog";
import { FormDropdown } from "../components/form-dropdown";
import { InvestmentDropdown, type InvestmentDropdownOption } from "../investments/investment-dropdown";
import {
  archiveAccountAction,
  createAccountAction,
  deleteAccountAction,
  restoreAccountAction,
  updateAccountAvailableCashAction,
  updateAccountCashFlowPlannedTimelineAction,
  updateAccountAction,
} from "./actions";
import { initialAccountActionState, type AccountActionState } from "./action-helpers";
import { maskedAccountLastFour, type AccountsPresentation, type TimelineAccountPresentation } from "./presentation";

interface AccountKindOption {
  readonly code: string;
  readonly label: string;
}

export interface AccountManagerProps {
  readonly presentation: AccountsPresentation;
  readonly kindOptions: readonly AccountKindOption[];
  readonly headingId?: string;
  readonly firstUse?: boolean;
  readonly formPrefix?: string;
}

const moneyPattern = "^-?\\d+(\\.\\d{1,2})?$";

const initialStatusOptions: readonly InvestmentDropdownOption[] = [
  { value: "", label: "Auto based on date" },
  { value: "actual", label: "Confirmed" },
  { value: "planned", label: "Projected" },
];

const accountIconsByKind: Readonly<Record<string, LucideIcon>> = {
  savings: PiggyBank,
  credit: CreditCard,
  loan: CreditCard,
  checking: Landmark,
};

function ActionMessage({ state }: { readonly state: AccountActionState }) {
  if (!state.message) return null;
  return <p className={`account-message ${state.ok ? "is-success" : "is-error"}`} role={state.ok ? "status" : "alert"} aria-live="polite">{state.message}</p>;
}

function FieldError({ id, message }: { readonly id: string; readonly message?: string }) {
  return message ? <p className="account-field-error" id={id} role="alert">{message}</p> : null;
}

function AccountFields({
  prefix,
  account,
  kindOptions,
  selectedKind,
  onKindChange,
  state,
}: {
  readonly prefix: string;
  readonly account: TimelineAccountPresentation | null;
  readonly kindOptions: readonly AccountKindOption[];
  readonly selectedKind: string;
  readonly onKindChange: (kind: string) => void;
  readonly state: AccountActionState;
}) {
  const isRdspAccount = selectedKind === "rdsp";
  const kindDropdownOptions: readonly InvestmentDropdownOption[] = kindOptions.map((option) => ({ value: option.code, label: option.label }));
  return <div className="account-form-fields">
    <div className="account-field account-field-wide">
      <label htmlFor={`${prefix}-name`}>Account name</label>
      <input id={`${prefix}-name`} name="name" type="text" required maxLength={120} defaultValue={account?.name ?? ""} placeholder={account ? undefined : "Enter account name"} aria-describedby={state.fieldErrors.name ? `${prefix}-name-error` : undefined} />
      <FieldError id={`${prefix}-name-error`} message={state.fieldErrors.name} />
    </div>
    <div className="account-field">
      <label htmlFor={`${prefix}-institution`}>Institution</label>
      <input id={`${prefix}-institution`} name="institutionName" type="text" required maxLength={120} defaultValue={account?.institution ?? ""} placeholder={account ? undefined : "Enter institution"} aria-describedby={state.fieldErrors.institutionName ? `${prefix}-institution-error` : undefined} />
      <FieldError id={`${prefix}-institution-error`} message={state.fieldErrors.institutionName} />
    </div>
    <div className="account-field">
      <label htmlFor={`${prefix}-last-four`}>Account last four</label>
      <input id={`${prefix}-last-four`} name="lastFour" type="text" inputMode={isRdspAccount ? "text" : "numeric"} pattern={isRdspAccount ? "[A-Za-z0-9]{4}" : "[0-9]{4}"} maxLength={4} autoCapitalize={isRdspAccount ? "characters" : undefined} defaultValue={account?.lastFour ?? ""} placeholder={isRdspAccount ? "A12B" : "4242"} onInput={(event) => { if (isRdspAccount) event.currentTarget.value = event.currentTarget.value.toUpperCase(); }} aria-describedby={state.fieldErrors.lastFour ? `${prefix}-last-four-error` : `${prefix}-last-four-help`} />
      <small className="account-form-help" id={`${prefix}-last-four-help`}>{isRdspAccount ? "Only the last four letters or numbers are stored." : "Only the last four digits are stored."}</small>
      <FieldError id={`${prefix}-last-four-error`} message={state.fieldErrors.lastFour} />
    </div>
    <div className="account-field">
      <label htmlFor={`${prefix}-kind`}>Account type</label>
      <InvestmentDropdown id={`${prefix}-kind`} name="kind" value={selectedKind} onChange={onKindChange} options={kindDropdownOptions} floating floatingMinWidth={240} aria-describedby={state.fieldErrors.kind ? `${prefix}-kind-error` : undefined} aria-invalid={Boolean(state.fieldErrors.kind)} />
      <FieldError id={`${prefix}-kind-error`} message={state.fieldErrors.kind} />
    </div>
    {selectedKind === "other" ? <div className="account-field">
      <label htmlFor={`${prefix}-custom-type`}>Custom type label</label>
      <input id={`${prefix}-custom-type`} name="customTypeLabel" type="text" maxLength={80} defaultValue={account?.kind === "other" ? account.kindLabel : ""} placeholder="For example, collectible" aria-describedby={state.fieldErrors.customTypeLabel ? `${prefix}-custom-type-error` : undefined} />
      <FieldError id={`${prefix}-custom-type-error`} message={state.fieldErrors.customTypeLabel} />
    </div> : null}
  </div>;
}

function AccountEditForm({ account, kindOptions, onClose }: { readonly account: TimelineAccountPresentation; readonly kindOptions: readonly AccountKindOption[]; readonly onClose: () => void }) {
  const [state, action, pending] = useActionState(updateAccountAction, initialAccountActionState);
  const [selectedKind, setSelectedKind] = useState(account.kind);
  useEffect(() => {
    if (state.ok) onClose();
  }, [onClose, state.ok]);
  return <form action={action} className="account-inline-edit-form">
    <input type="hidden" name="id" value={account.id} />
    <AccountFields prefix="inline-edit-account" account={account} kindOptions={kindOptions} selectedKind={selectedKind} onKindChange={setSelectedKind} state={state} />
    <div className="account-form-actions">
      <button className="account-primary-button" type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</button>
      <button className="account-secondary-button" type="button" onClick={onClose} disabled={pending}>Cancel</button>
      <ActionMessage state={state} />
    </div>
  </form>;
}

function SnapshotFields({ prefix, state, todayIso }: { readonly prefix: string; readonly state: AccountActionState; readonly todayIso: string }) {
  return <fieldset className="account-snapshot-fields">
    <legend>Optional opening balance</legend>
    <p className="account-form-help">Leave the amount blank to create the account without a new balance snapshot.</p>
    <div className="account-form-fields account-form-fields-snapshot">
      <div className="account-field">
        <label htmlFor={`${prefix}-balance`}>Balance (CAD)</label>
        <input id={`${prefix}-balance`} name="initialBalance" type="text" inputMode="decimal" pattern={moneyPattern} placeholder="0.00" aria-describedby={state.fieldErrors.initialBalance ? `${prefix}-balance-error` : undefined} />
        <FieldError id={`${prefix}-balance-error`} message={state.fieldErrors.initialBalance} />
      </div>
      <div className="account-field">
        <label htmlFor={`${prefix}-balance-date`}>Balance date</label>
        <input id={`${prefix}-balance-date`} name="initialBalanceDate" type="date" defaultValue={todayIso} aria-describedby={state.fieldErrors.initialBalanceDate ? `${prefix}-balance-date-error` : undefined} />
        <FieldError id={`${prefix}-balance-date-error`} message={state.fieldErrors.initialBalanceDate} />
      </div>
      <div className="account-field">
        <label htmlFor={`${prefix}-balance-status`}>Snapshot status</label>
        <FormDropdown id={`${prefix}-balance-status`} name="initialStatus" defaultValue="" options={initialStatusOptions} floatingMinWidth={240} describedBy={state.fieldErrors.initialStatus ? `${prefix}-balance-status-error` : undefined} invalid={Boolean(state.fieldErrors.initialStatus)} />
        <FieldError id={`${prefix}-balance-status-error`} message={state.fieldErrors.initialStatus} />
      </div>
    </div>
  </fieldset>;
}

type AccountMenuPosition = {
  readonly session: number;
  readonly top: number;
  readonly left: number;
  readonly width: number;
};

function AccountRow({
  account,
  kindOptions,
  editing,
  menuOpen,
  menuSession,
  onMenuToggle,
  onCloseEdit,
  onEdit,
  onArchive,
  archivePending,
  onDelete,
  deletePending,
  restoreAction,
  restorePending,
  availabilityAction,
  availabilityPending,
  plannedTimelineAction,
  plannedTimelinePending,
}: {
  readonly account: TimelineAccountPresentation;
  readonly kindOptions: readonly AccountKindOption[];
  readonly editing: boolean;
  readonly menuOpen: boolean;
  readonly menuSession: number | null;
  readonly onMenuToggle: () => void;
  readonly onCloseEdit: () => void;
  readonly onEdit: (account: TimelineAccountPresentation) => void;
  readonly onArchive: (account: TimelineAccountPresentation) => void;
  readonly archivePending: boolean;
  readonly onDelete: (account: TimelineAccountPresentation) => void;
  readonly deletePending: boolean;
  readonly restoreAction: (formData: FormData) => void;
  readonly restorePending: boolean;
  readonly availabilityAction: (formData: FormData) => void;
  readonly availabilityPending: boolean;
  readonly plannedTimelineAction: (formData: FormData) => void;
  readonly plannedTimelinePending: boolean;
}) {
  const actionsDisabled = archivePending || restorePending || deletePending;
  const AccountIcon = accountIconsByKind[account.kind] ?? Wallet;
  const maskedLastFour = maskedAccountLastFour(account.lastFour);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<AccountMenuPosition | null>(null);
  const menuId = `account-row-menu-${account.id}`;

  useEffect(() => {
    if (!menuOpen || menuSession === null) return;
    const session = menuSession;

    function updateMenuPosition(): void {
      const anchor = menuButtonRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const viewportWidth = Math.max(window.innerWidth, 24);
      const measuredWidth = menuRef.current?.offsetWidth ?? 190;
      const width = Math.min(measuredWidth, Math.max(0, viewportWidth - 24));
      const maxLeft = Math.max(12, viewportWidth - width - 12);
      const left = Math.min(Math.max(12, rect.right - width), maxLeft);
      const menuHeight = menuRef.current?.offsetHeight ?? 132;
      const below = rect.bottom + 6;
      const top = below + menuHeight <= window.innerHeight - 12
        ? below
        : Math.max(12, rect.top - menuHeight - 6);
      setMenuPosition((previous) => previous?.session === session && previous.top === top && previous.left === left && previous.width === width ? previous : { session, top, left, width });
    }

    function dismissMenu(event: PointerEvent): void {
      if (event.target instanceof Node && (menuRef.current?.contains(event.target) || menuButtonRef.current?.contains(event.target))) return;
      onMenuToggle();
    }

    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") onMenuToggle();
    }

    updateMenuPosition();
    document.addEventListener("pointerdown", dismissMenu);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      document.removeEventListener("pointerdown", dismissMenu);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [menuOpen, menuSession, onMenuToggle]);

  const activeMenuPosition = menuOpen && menuPosition?.session === menuSession ? menuPosition : null;
  const menu = menuOpen && typeof document !== "undefined"
    ? createPortal(
      <div ref={menuRef} id={menuId} className="account-row-menu-popover account-row-menu-popover-floating" role="menu" aria-label={`Actions for ${account.name}`} style={activeMenuPosition ? { top: activeMenuPosition.top, left: activeMenuPosition.left, width: activeMenuPosition.width } : { top: -10000, left: 0, width: "min(190px, calc(100vw - 24px))", visibility: "hidden" }}>
        {account.isActive ? <>
          <button className="account-menu-item" type="button" role="menuitem" onClick={() => { onMenuToggle(); onEdit(account); }}>Edit account</button>
          <button className="account-menu-item" type="button" role="menuitem" onClick={() => { onMenuToggle(); onArchive(account); }}>Archive account</button>
          <button className="account-menu-item is-danger" type="button" role="menuitem" onClick={() => { onMenuToggle(); onDelete(account); }}>Delete account</button>
        </> : <>
          <form action={restoreAction} onSubmit={onMenuToggle}>
            <input type="hidden" name="id" value={account.id} />
            <button className="account-menu-item" type="submit" role="menuitem" disabled={restorePending || deletePending}>{restorePending ? "Restoring…" : "Restore account"}</button>
          </form>
          <button className="account-menu-item is-danger" type="button" role="menuitem" onClick={() => { onMenuToggle(); onDelete(account); }}>Delete account</button>
        </>}
      </div>,
      document.body,
    )
    : null;

  return <>
    <tr className={account.isActive ? undefined : "account-row-archived"}>
    <th scope="row">
      <div className="account-row-identity">
        <span className="account-row-icon" aria-hidden="true"><AccountIcon size={17} strokeWidth={1.8} /></span>
        <span className="account-row-copy"><span className="account-row-name">{account.name}</span><span className="account-row-institution">{account.institution}</span>{maskedLastFour ? <span className="account-row-last-four">{maskedLastFour}</span> : null}</span>
      </div>
      {!account.isActive ? <span className="account-status-badge is-archived">Archived</span> : null}
    </th>
    <td><span className="account-kind-badge">{account.kindLabel}</span></td>
    <td>
      {account.isActive ? <div className="account-cash-flow-settings">
        <form action={availabilityAction} className="account-setting-form">
          <input type="hidden" name="accountId" value={account.id} />
          <label className="account-setting-control">
            <span className="account-setting-copy"><strong>Available cash</strong><small className={account.includeInAvailableCash ? "is-enabled" : undefined}>{account.includeInAvailableCash ? "Included" : "Excluded"}</small></span>
            <span className="account-setting-switch"><input className="account-setting-toggle" name="includeInAvailableCash" type="checkbox" defaultChecked={account.includeInAvailableCash} disabled={availabilityPending} onChange={(event) => event.currentTarget.form?.requestSubmit()} aria-label={`Include ${account.name} in available cash`} /><span className="account-setting-switch-track" aria-hidden="true" /></span>
          </label>
        </form>
        <form action={plannedTimelineAction} className="account-setting-form">
          <input type="hidden" name="accountId" value={account.id} />
          <label className="account-setting-control">
            <span className="account-setting-copy"><strong>Planned timeline</strong><small className={account.useCashFlowPlannedTimeline ? "is-enabled" : undefined}>{account.useCashFlowPlannedTimeline ? "Cash Flow" : "Account rules"}</small></span>
            <span className="account-setting-switch"><input className="account-setting-toggle" name="useCashFlowPlannedTimeline" type="checkbox" defaultChecked={account.useCashFlowPlannedTimeline} disabled={plannedTimelinePending} onChange={(event) => event.currentTarget.form?.requestSubmit()} aria-label={`Use Cash Flow planned timeline for ${account.name}`} /><span className="account-setting-switch-track" aria-hidden="true" /></span>
          </label>
        </form>
      </div> : <span className="account-form-help">Restore to configure</span>}
    </td>
    <td>
      <div className="account-row-actions">
        <div className="account-row-menu">
          <button ref={menuButtonRef} className="account-row-menu-trigger account-secondary-button" type="button" onClick={onMenuToggle} disabled={actionsDisabled || restorePending} aria-label={`More actions for ${account.name}`} aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuId}>
            <MoreHorizontal aria-hidden="true" size={19} strokeWidth={2.1} />
            <span className="account-row-menu-label">Actions</span>
          </button>
        </div>
      </div>
    </td>
  </tr>
  {menu}
  {editing ? <tr className="account-edit-row"><td colSpan={4}><div className="account-inline-edit-card">
    <div className="account-inline-edit-heading"><strong>Edit {account.name}</strong><span>Update account details without changing balance history.</span></div>
    <AccountEditForm account={account} kindOptions={kindOptions} onClose={onCloseEdit} />
  </div></td></tr> : null}
  </>;
}

export function AccountManager({ presentation, kindOptions, headingId = "account-manager-heading", firstUse = false, formPrefix = "new-account" }: AccountManagerProps) {
  const isFirstUse = firstUse;
  const [editingAccount, setEditingAccount] = useState<TimelineAccountPresentation | null>(null);
  const [archiveCandidate, setArchiveCandidate] = useState<TimelineAccountPresentation | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<TimelineAccountPresentation | null>(null);
  const [openMenuAccountId, setOpenMenuAccountId] = useState<string | null>(null);
  const [openMenuSession, setOpenMenuSession] = useState(0);
  const [showCreateForm, setShowCreateForm] = useState(presentation.activeAccountCount === 0);
  const [selectedKind, setSelectedKind] = useState("checking");
  const [formVersion, setFormVersion] = useState(0);
  const createAccountWithSuccess = useCallback(async (previousState: AccountActionState, formData: FormData): Promise<AccountActionState> => {
    const nextState = await createAccountAction(previousState, formData);
    if (nextState.ok) {
      setFormVersion((version) => version + 1);
      setShowCreateForm(false);
    }
    return nextState;
  }, []);
  const [createState, createAction, createPending] = useActionState(createAccountWithSuccess, initialAccountActionState);
  const [archiveState, archiveAction, archivePending] = useActionState(archiveAccountAction, initialAccountActionState);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteAccountAction, initialAccountActionState);
  const [restoreState, restoreAction, restorePending] = useActionState(restoreAccountAction, initialAccountActionState);
  const [availabilityState, availabilityAction, availabilityPending] = useActionState(updateAccountAvailableCashAction, initialAccountActionState);
  const [plannedTimelineState, plannedTimelineAction, plannedTimelinePending] = useActionState(updateAccountCashFlowPlannedTimelineAction, initialAccountActionState);

  const openForEdit = (account: TimelineAccountPresentation) => {
    setOpenMenuAccountId(null);
    setEditingAccount(account);
    setArchiveCandidate(null);
    setDeleteCandidate(null);
  };

  const toggleAccountMenu = (accountId: string) => {
    if (openMenuAccountId === accountId) {
      setOpenMenuAccountId(null);
      return;
    }
    setOpenMenuSession((session) => session + 1);
    setOpenMenuAccountId(accountId);
  };

  const confirmArchive = () => {
    if (!archiveCandidate) return;
    const formData = new FormData();
    formData.set("id", archiveCandidate.id);
    setArchiveCandidate(null);
    startTransition(() => archiveAction(formData));
  };

  const confirmDelete = () => {
    if (!deleteCandidate) return;
    const formData = new FormData();
    formData.set("id", deleteCandidate.id);
    setDeleteCandidate(null);
    startTransition(() => deleteAction(formData));
  };

  const submitCreate = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => createAction(formData));
  };

  const createFormOpen = isFirstUse || showCreateForm || presentation.activeAccountCount === 0;

  return <section className={`card section-card account-manager-card${isFirstUse ? " is-first-use" : ""}`} aria-labelledby={headingId}>
    <div className="card-head account-manager-card-header">
      <div>
        <h2 className="card-title account-manager-card-title" id={headingId}>{isFirstUse ? "Create your main account" : "Manage accounts"}</h2>
        <p className="card-subtitle">{isFirstUse ? "Start with one account to unlock your balance timeline, summaries, and projections. You can add the opening balance now or later." : "Add owner-scoped accounts here. Edit, archive, restore, and delete from each account’s action menu."}</p>
      </div>
      <div className="account-manager-card-actions">
        {isFirstUse ? <span className="account-first-use-badge">First step</span> : <span className="period-date account-active-count"><span className="account-active-count-dot" aria-hidden="true" />{presentation.activeAccountCount} active</span>}
        {presentation.activeAccountCount > 0 && !createFormOpen ? <button className="navy-action-button account-add-account-button" type="button" onClick={() => setShowCreateForm(true)}><span className="navy-action-icon" aria-hidden="true"><Plus size={14} strokeWidth={2.5} /></span><span>Add account</span></button> : null}
      </div>
    </div>

    {createFormOpen ? <div className="account-form-panel account-create-panel">
      <div className="account-create-panel-head">
        <div className="account-create-panel-heading">
          <span className="account-create-panel-icon" aria-hidden="true"><Landmark size={19} strokeWidth={1.7} /></span>
          <div><h3 className="account-form-title">{isFirstUse ? "Create your main account" : "Add an account"}</h3><p className="card-subtitle">{isFirstUse ? "Use the details you know. This first account will be included in available cash and use the Cash Flow planned timeline." : "All amounts are CAD minor-unit values behind the form."}</p></div>
        </div>
        <ChevronUp className="account-create-panel-chevron" aria-hidden="true" size={17} strokeWidth={2} />
      </div>
      <form key={`${formPrefix}-${formVersion}`} action={createAction} onSubmit={submitCreate} className="account-form">
        <AccountFields prefix={formPrefix} account={null} kindOptions={kindOptions} selectedKind={selectedKind} onKindChange={setSelectedKind} state={createState} />
        <SnapshotFields prefix={formPrefix} state={createState} todayIso={presentation.todayIso} />
        <div className="account-form-actions">
          <button className="navy-action-button account-form-add-button" type="submit" disabled={createPending}><span className="navy-action-icon" aria-hidden="true"><Plus size={14} strokeWidth={2.5} /></span><span>{createPending ? "Saving…" : isFirstUse ? "Create main account" : "Add account"}</span></button>
          {presentation.activeAccountCount > 0 ? <button className="account-secondary-button" type="button" onClick={() => setShowCreateForm(false)} disabled={createPending}>Cancel</button> : null}
        </div>
      </form>
      <ActionNotification state={createState} />
    </div> : null}

    {!isFirstUse ? <div className="account-table-wrap">
      <table className="account-table">
        <caption className="sr-only">Visible accounts</caption>
        <thead><tr><th scope="col">Account</th><th scope="col">Type</th><th scope="col">Cash Flow</th><th scope="col">Actions</th></tr></thead>
        <tbody>{presentation.groups.flatMap((group) => group.accounts).map((account) => <AccountRow
          key={account.id}
          account={account}
          kindOptions={kindOptions}
          editing={editingAccount?.id === account.id}
          menuOpen={openMenuAccountId === account.id}
          menuSession={openMenuAccountId === account.id ? openMenuSession : null}
          onMenuToggle={() => toggleAccountMenu(account.id)}
          onCloseEdit={() => setEditingAccount(null)}
          onEdit={openForEdit}
          onArchive={(candidate) => {
            setOpenMenuAccountId(null);
            setDeleteCandidate(null);
            setArchiveCandidate((current) => current?.id === candidate.id ? null : candidate);
          }}
          archivePending={archivePending}
          onDelete={(candidate) => {
            setOpenMenuAccountId(null);
            setArchiveCandidate(null);
            setDeleteCandidate((current) => current?.id === candidate.id ? null : candidate);
          }}
          deletePending={deletePending}
          restoreAction={restoreAction}
          restorePending={restorePending}
          availabilityAction={availabilityAction}
          availabilityPending={availabilityPending}
          plannedTimelineAction={plannedTimelineAction}
          plannedTimelinePending={plannedTimelinePending}
        />)}</tbody>
      </table>
    </div> : null}
    {!isFirstUse && presentation.visibleAccountCount === 0 ? <div className="account-empty">No accounts are visible. Add an account or show archived accounts from the timeline controls.</div> : null}
    {!isFirstUse ? <>
      <ActionNotification state={archiveState} />
      <ActionNotification state={deleteState} />
      <ActionNotification state={restoreState} />
      <ActionNotification state={availabilityState} />
      <ActionNotification state={plannedTimelineState} />
    </> : null}
    {archiveCandidate ? <ConfirmationDialog
      open
      title={`Archive ${archiveCandidate.name}?`}
      description="Its balance history will stay preserved and the account can be restored later."
      confirmLabel="Archive account"
      tone="danger"
      pending={archivePending}
      onConfirm={confirmArchive}
      onCancel={() => setArchiveCandidate(null)}
    /> : null}
    {deleteCandidate ? <ConfirmationDialog
      open
      title={`Permanently delete ${deleteCandidate.name}?`}
      description="This cannot be undone. Accounts with transfers, recurring transaction versions, or linked annual budgets cannot be deleted."
      confirmLabel="Delete account"
      tone="danger"
      pending={deletePending}
      onConfirm={confirmDelete}
      onCancel={() => setDeleteCandidate(null)}
    /> : null}
  </section>;
}
