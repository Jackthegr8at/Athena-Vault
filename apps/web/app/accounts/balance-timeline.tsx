"use client";

import { startTransition, useActionState, useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { confirmPeriodAction, deleteBalanceSnapshotAction, extendAccountTimelineAction, recalculateProjectionsAction, reorderAccountsAction, updateAccountBalanceNoteAction, upsertBalanceSnapshotAction } from "./actions";
import { ActionNotification } from "../components/action-notification";
import { InvestmentDropdown, type InvestmentDropdownOption } from "../investments/investment-dropdown";
import { formatMoneyInputMinor, formatMoneyMinor } from "../../lib/format-money";
import { initialAccountActionState, type AccountActionState } from "./action-helpers";
import {
  formatTimelineDate,
  formatTimelineDelta,
  type AccountsPresentation,
  type TimelineGroupPresentation,
  type TimelineAccountPresentation,
  type TimelineCellPresentation,
  type TimelineColumnPresentation,
} from "./presentation";
import { BalanceTimelineConfirmation, BalanceTimelineEditor, type BalanceTimelineConfirmationState } from "./balance-timeline-editor";
import { AccountReorderRows, AccountTimelineTable, TimelineDeltaBadge } from "./balance-timeline-rows";

export interface BalanceTimelineProps {
  readonly presentation: AccountsPresentation;
  readonly showArchived: boolean;
  readonly headingId?: string;
}

export type InlineEditKeyboardAction = "save" | "cancel" | "none";

const periodCountOptions: readonly InvestmentDropdownOption[] = [0, 1, 2, 3, 4, 5, 6, 8, 12].map((count) => ({ value: String(count), label: String(count) }));

export function inlineEditKey(accountId: string, date: string): string {
  return `${accountId}:${date}`;
}

export function inlineEditKeyboardAction(key: string, shiftKey = false): InlineEditKeyboardAction {
  if (key === "Escape") return "cancel";
  if (key === "Enter" && !shiftKey) return "save";
  return "none";
}

function dollars(minor: number | null): string {
  return formatMoneyMinor(minor, { unavailableLabel: "—" });
}

function amountInput(minor: number | null): string {
  if (minor === null) return "";
  return formatMoneyInputMinor(minor);
}

function timelineHref(date: string | null, showArchived: boolean, presentation: AccountsPresentation): string {
  const params = new URLSearchParams();
  if (date) params.set("selected", date);
  if (showArchived) params.set("archived", "1");
  params.set("past", String(presentation.pastPeriods));
  params.set("future", String(presentation.futurePeriods));
  return `?${params.toString()}`;
}

function StatusBadge({ status, label, projectionSource }: { readonly status: TimelineCellPresentation["status"]; readonly label: string | null; readonly projectionSource: TimelineCellPresentation["projectionSource"] }) {
  if (!status || !label) return <span className="timeline-status-badge is-empty">No snapshot</span>;
  const sourceLabel = status === "planned" ? (projectionSource === "generated" ? " · Auto" : " · Anchor") : "";
  return <span className={`timeline-status-badge is-${status}`} title={projectionSource === "manual" ? "Manual projected override; following periods chain from this anchor." : undefined}>{label}{sourceLabel}</span>;
}

type EditorPosition = {
  readonly session: number;
  readonly top: number;
  readonly left: number;
  readonly width: number;
};

function CellContent({
  account,
  column,
  cell,
  paydayCheckManaged,
  editorSession,
  action,
  noteAction,
  editing,
  draftBalance,
  draftStatus,
  draftNote,
  pending,
  notePending,
  deletePending,
  state,
  noteState,
  onOpen,
  onBalanceChange,
  onStatusChange,
  onNoteChange,
  onCancel,
  onRequestDelete,
  onKeyDown,
}: {
  readonly account: TimelineAccountPresentation;
  readonly column: TimelineColumnPresentation;
  readonly cell: TimelineCellPresentation;
  readonly paydayCheckManaged: boolean;
  readonly editorSession: number | null;
  readonly action: (formData: FormData) => void;
  readonly noteAction: (formData: FormData) => void;
  readonly editing: boolean;
  readonly draftBalance: string;
  readonly draftStatus: "actual" | "planned";
  readonly draftNote: string;
  readonly pending: boolean;
  readonly notePending: boolean;
  readonly deletePending: boolean;
  readonly state: AccountActionState;
  readonly noteState: AccountActionState;
  readonly onOpen: () => void;
  readonly onBalanceChange: (value: string) => void;
  readonly onStatusChange: (value: "actual" | "planned") => void;
  readonly onNoteChange: (value: string) => void;
  readonly onCancel: () => void;
  readonly onRequestDelete: () => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLFormElement>) => void;
}) {
  const router = useRouter();
  const editorAnchorRef = useRef<HTMLButtonElement>(null);
  const [editorNode, setEditorNode] = useState<HTMLDivElement | null>(null);
  const [editorPosition, setEditorPosition] = useState<EditorPosition | null>(null);

  useEffect(() => {
    if (!editing || paydayCheckManaged || !editorNode || editorSession === null) return;
    const session = editorSession;
    const updatePosition = () => {
      const anchor = editorAnchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const viewportWidth = Math.max(window.innerWidth, 24);
      const width = Math.min(236, viewportWidth - 24);
      const editorHeight = editorNode.getBoundingClientRect().height;
      const maxLeft = Math.max(12, viewportWidth - width - 12);
      const left = Math.min(Math.max(12, rect.left + (rect.width - width) / 2), maxLeft);
      const below = rect.bottom + 8;
      const top = below + editorHeight <= window.innerHeight - 12
        ? below
        : Math.max(12, rect.top - editorHeight - 8);
      setEditorPosition((previous) => previous?.session === session && previous.top === top && previous.left === left && previous.width === width ? previous : { session, top, left, width });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [editing, paydayCheckManaged, editorNode, editorSession]);

  const deltaLabel = cell.delta ? `, change ${formatTimelineDelta(cell.delta.deltaMinor)}` : "";
  const label = paydayCheckManaged
    ? `Use Cash Flow Payday Check to record ${account.name} balance on ${column.label}`
    : `Edit ${account.name} balance on ${column.label}${deltaLabel}`;
  const handleOpen = () => {
    if (paydayCheckManaged) {
      router.push("/cash-flow");
      return;
    }
    onOpen();
  };
  const editor = editing && !paydayCheckManaged && typeof document !== "undefined"
    ? createPortal(
      <div
        ref={setEditorNode}
        className="timeline-cell-editor-popover"
        role="dialog"
        aria-label={`Edit ${account.name} balance on ${column.label}`}
        style={editorSession !== null && editorPosition?.session === editorSession ? { top: editorPosition.top, left: editorPosition.left, width: editorPosition.width } : { top: -10000, left: 0, width: "min(236px, calc(100vw - 24px))", visibility: "hidden" }}
      >
        <BalanceTimelineEditor account={account} column={column} action={action} noteAction={noteAction} draftBalance={draftBalance} draftStatus={draftStatus} draftNote={draftNote} pending={pending} notePending={notePending} deletePending={deletePending} state={state} noteState={noteState} onBalanceChange={onBalanceChange} onStatusChange={onStatusChange} onNoteChange={onNoteChange} onCancel={onCancel} onRequestDelete={onRequestDelete} onKeyDown={onKeyDown} />
      </div>,
      document.body,
    )
    : null;

  return <>
    <button ref={editorAnchorRef} className={`timeline-cell-button${paydayCheckManaged ? " is-payday-check-managed" : ""}`} type="button" onClick={handleOpen} disabled={!account.isActive} aria-label={label} title={paydayCheckManaged ? "Open Cash Flow Payday Check to record this balance." : undefined} aria-expanded={editing}>
      <TimelineDeltaBadge delta={cell.delta} />
      <span className="timeline-cell-amount">{dollars(cell.balanceMinor)}</span>
      <StatusBadge status={cell.status} label={cell.statusLabel} projectionSource={cell.projectionSource} />
    </button>
    {editor}
  </>;
}

function PeriodNavigation({ presentation, showArchived }: BalanceTimelineProps) {
  const router = useRouter();
  const { navigation, selectedDate } = presentation;
  const links: readonly { label: string; date: string | null; className: string }[] = [
    { label: "Previous", date: navigation.previous, className: "timeline-nav-button" },
    { label: "Today", date: navigation.today, className: "timeline-nav-button" },
    { label: "Next", date: navigation.next, className: "timeline-nav-button" },
    { label: "Latest", date: navigation.latest, className: "timeline-nav-button" },
  ];
  return <div className="timeline-navigation" aria-label="Timeline period navigation">
    {links.map((link) => link.date ? <a className={`${link.className}${link.date === selectedDate ? " is-selected" : ""}`} href={timelineHref(link.date, showArchived, presentation)} key={link.label} aria-current={link.date === selectedDate ? "page" : undefined}>{link.label}</a> : <span className={`${link.className} is-disabled`} key={link.label}>{link.label}</span>)}
    <div className="timeline-date-select">
      <span>Payday</span>
      {presentation.columns.length > 0 ? <InvestmentDropdown value={selectedDate ?? ""} options={presentation.columns.map((column) => ({ value: column.date, label: column.label }))} onChange={(value) => { if (value) router.push(timelineHref(value, showArchived, presentation)); }} aria-label="Select payday" floating floatingMinWidth={200} numeric /> : <span className="timeline-date-select-empty" role="status">No paydays available</span>}
    </div>
    <label className="timeline-date-select">
      <span>Past periods</span>
      <InvestmentDropdown value={String(presentation.pastPeriods)} options={periodCountOptions} onChange={(value) => {
        const count = Number(value);
        window.localStorage.setItem("athena-accounts-past-periods", String(count));
        router.push(timelineHref(selectedDate, showArchived, { ...presentation, pastPeriods: count }));
      }} aria-label="Past periods" floating floatingMinWidth={160} numeric />
    </label>
    <label className="timeline-date-select">
      <span>Future periods</span>
      <InvestmentDropdown value={String(presentation.futurePeriods)} options={periodCountOptions} onChange={(value) => {
        const count = Number(value);
        window.localStorage.setItem("athena-accounts-future-periods", String(count));
        router.push(timelineHref(selectedDate, showArchived, { ...presentation, futurePeriods: count }));
      }} aria-label="Future periods" floating floatingMinWidth={160} numeric />
    </label>
  </div>;
}

function ReorderableSection({ group }: { readonly group: TimelineGroupPresentation }) {
  const [accountIds, setAccountIds] = useState(() => group.accounts.map((account) => account.id));
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [state, action, pending] = useActionState(reorderAccountsAction, initialAccountActionState);

  const submitOrder = (nextAccountIds: readonly string[]) => {
    const formData = new FormData();
    formData.set("section", group.key);
    formData.set("accountIds", JSON.stringify(nextAccountIds));
    startTransition(() => action(formData));
  };

  const moveAccount = (accountId: string, offset: -1 | 1) => {
    const index = accountIds.indexOf(accountId);
    const nextIndex = index + offset;
    if (index < 0 || nextIndex < 0 || nextIndex >= accountIds.length || pending) return;
    const next = [...accountIds];
    [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
    setAccountIds(next);
    submitOrder(next);
  };

  const dropAccount = (sourceId: string, targetId: string) => {
    if (!sourceId || sourceId === targetId || pending) return;
    const sourceIndex = accountIds.indexOf(sourceId);
    const targetIndex = accountIds.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const next = [...accountIds];
    next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, sourceId);
    setAccountIds(next);
    setDraggedId(null);
    submitOrder(next);
  };

  return <div className="timeline-order-section">
    <div className="timeline-order-section-head"><strong>{group.label}</strong><span>{group.accounts.length} {group.accounts.length === 1 ? "account" : "accounts"}</span></div>
    <AccountReorderRows
      group={group}
      accountIds={accountIds}
      draggedId={draggedId}
      pending={pending}
      onDragStart={(accountId, event) => {
        setDraggedId(accountId);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", JSON.stringify({ section: group.key, accountId }));
      }}
      onDragEnd={() => setDraggedId(null)}
      onDragOver={(event) => { if (draggedId && accountIds.includes(draggedId)) event.preventDefault(); }}
      onDrop={(event, targetId) => {
        event.preventDefault();
        try {
          const payload = JSON.parse(event.dataTransfer.getData("text/plain")) as { section?: unknown; accountId?: unknown };
          if (payload.section === group.key && typeof payload.accountId === "string") dropAccount(payload.accountId, targetId);
        } catch {
          // Ignore drags that did not originate from an account-order item.
        }
        setDraggedId(null);
      }}
      onMove={moveAccount}
    />
    <ActionNotification state={state} />
  </div>;
}

function AccountOrdering({ presentation }: { readonly presentation: AccountsPresentation }) {
  return <details className="timeline-order-card">
    <summary><span>Reorder accounts</span><small>Drag within a section or use Move up / Move down</small></summary>
    <div className="timeline-order-body">
      <p className="timeline-toolbar-note">Accounts stay within their current section. Repeated Other labels may create a dedicated section; these controls do not move accounts between sections.</p>
      <div className="timeline-order-sections">
        {presentation.groups.map((group) => <ReorderableSection group={group} key={`${group.key}:${JSON.stringify(group.accounts.map((account) => account.id))}`} />)}
      </div>
    </div>
  </details>;
}

export function BalanceTimeline({ presentation, showArchived, headingId = "account-timeline-heading" }: BalanceTimelineProps) {
  const router = useRouter();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingSession, setEditingSession] = useState(0);
  const [draftBalance, setDraftBalance] = useState("");
  const [draftStatus, setDraftStatus] = useState<"actual" | "planned">("actual");
  const [draftNote, setDraftNote] = useState("");
  const [selectedProjectionAccountIdState, setSelectedProjectionAccountId] = useState(presentation.groups.flatMap((group) => group.accounts)[0]?.id ?? "");
  const [confirmation, setConfirmation] = useState<BalanceTimelineConfirmationState | null>(null);
  const projectionAccounts = presentation.groups.flatMap((group) => group.accounts);
  const selectedProjectionAccountId = projectionAccounts.some((account) => account.id === selectedProjectionAccountIdState)
    ? selectedProjectionAccountIdState
    : projectionAccounts[0]?.id ?? "";
  const closeEditor = useCallback(() => {
    setEditingKey(null);
    setDraftBalance("");
    setDraftStatus("actual");
    setDraftNote("");
  }, []);
  const saveSnapshotWithClose = useCallback(async (previous: AccountActionState, formData: FormData): Promise<AccountActionState> => {
    const next = await upsertBalanceSnapshotAction(previous, formData);
    if (next.ok) closeEditor();
    return next;
  }, [closeEditor]);
  const saveNoteWithClose = useCallback(async (previous: AccountActionState, formData: FormData): Promise<AccountActionState> => {
    const next = await updateAccountBalanceNoteAction(previous, formData);
    if (next.ok) closeEditor();
    return next;
  }, [closeEditor]);
  const deleteSnapshotWithClose = useCallback(async (previous: AccountActionState, formData: FormData): Promise<AccountActionState> => {
    const next = await deleteBalanceSnapshotAction(previous, formData);
    if (next.ok) closeEditor();
    return next;
  }, [closeEditor]);
  const [saveState, saveAction, savePending] = useActionState(saveSnapshotWithClose, initialAccountActionState);
  const [noteState, noteAction, notePending] = useActionState(saveNoteWithClose, initialAccountActionState);
  const [, deleteAction, deletePending] = useActionState(deleteSnapshotWithClose, initialAccountActionState);
  const [confirmState, confirmAction, confirmPending] = useActionState(confirmPeriodAction, initialAccountActionState);
  const [extendState, extendAction, extendPending] = useActionState(extendAccountTimelineAction, initialAccountActionState);
  const [recalculateState, recalculateAction, recalculatePending] = useActionState(recalculateProjectionsAction, initialAccountActionState);
  const availableCashAccounts = projectionAccounts.filter((account) => account.isActive && account.includeInAvailableCash);
  const paydayCheckAccountId = availableCashAccounts.length === 1 ? availableCashAccounts[0]!.id : null;

  useEffect(() => {
    const storedPastValue = window.localStorage.getItem("athena-accounts-past-periods");
    const storedFutureValue = window.localStorage.getItem("athena-accounts-future-periods");
    const storedPast = storedPastValue === null ? Number.NaN : Number(storedPastValue);
    const storedFuture = storedFutureValue === null ? Number.NaN : Number(storedFutureValue);
    const past = Number.isInteger(storedPast) && storedPast >= 0 && storedPast <= 24 ? storedPast : presentation.pastPeriods;
    const future = Number.isInteger(storedFuture) && storedFuture >= 0 && storedFuture <= 24 ? storedFuture : presentation.futurePeriods;
    if (past !== presentation.pastPeriods || future !== presentation.futurePeriods) {
      router.replace(timelineHref(presentation.selectedDate, showArchived, { ...presentation, pastPeriods: past, futurePeriods: future }));
    }
  }, [presentation, router, showArchived]);

  const openEditor = (account: TimelineAccountPresentation, column: TimelineColumnPresentation, cell: TimelineCellPresentation) => {
    setEditingSession((session) => session + 1);
    setEditingKey(inlineEditKey(account.id, column.date));
    setDraftBalance(amountInput(cell.balanceMinor));
    setDraftStatus(column.isFuture ? "planned" : "actual");
    setDraftNote(cell.note ?? "");
  };

  const requestDelete = (account: TimelineAccountPresentation, column: TimelineColumnPresentation) => {
    const formData = new FormData();
    formData.set("accountId", account.id);
    formData.set("asOf", column.date);
    setConfirmation({
      title: "Reset this balance?",
      description: "The value will be removed and future projections will recalculate.",
      confirmLabel: "Reset",
      tone: "danger",
      onConfirm: () => {
        setConfirmation(null);
        startTransition(() => deleteAction(formData));
      },
    });
  };

  const requestRecalculation = (scope: "account" | "all") => {
    const formData = new FormData();
    formData.set("accountId", selectedProjectionAccountId);
    formData.set("scope", scope);
    setConfirmation({
      title: scope === "account" ? "Recalculate this account?" : "Recalculate all accounts?",
      description: "Confirmed and manual projected balances will be preserved.",
      confirmLabel: scope === "account" ? "Recalculate" : "Recalculate all",
      tone: "default",
      onConfirm: () => {
        setConfirmation(null);
        startTransition(() => recalculateAction(formData));
      },
    });
  };

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    const action = inlineEditKeyboardAction(event.key, event.shiftKey);
    if (action === "cancel") {
      event.preventDefault();
      closeEditor();
    } else if (action === "save") {
      event.preventDefault();
      event.currentTarget.requestSubmit();
    }
  };

  const timelineColumnCount = Math.max(presentation.columns.length, 1);
  const timelineColumnWidth = `min(180px, calc((100% - 220px) / ${timelineColumnCount}))`;
  const timelineTableMinWidth = `${220 + timelineColumnCount * 120}px`;
  const timelineTableStyle = { "--timeline-column-width": timelineColumnWidth, "--timeline-table-min-width": timelineTableMinWidth } as CSSProperties;
  const selectedColumn = presentation.columns.find((column) => column.date === presentation.selectedDate);

  return <section className="card section-card account-timeline-card" aria-labelledby={headingId}>
    <div className="account-timeline-header">
      <div>
        <p className="eyebrow">Account balances</p>
        <h2 className="card-title" id={headingId}>Biweekly balance timeline</h2>
        <p className="card-subtitle">Select a cell to edit. Changes require Save or Enter; Cancel or Escape restores the draft.</p>
      </div>
      <div className="timeline-period-summary">
        <span className={`timeline-status-badge is-${presentation.selectedDate ? presentation.selectedState : "empty"}`}>{presentation.selectedDate ? presentation.selectedStateLabel : "No payday"}</span>
        <strong>{formatTimelineDate(presentation.selectedDate)}</strong>
      </div>
    </div>

    <PeriodNavigation presentation={presentation} showArchived={showArchived} />
    <AccountOrdering presentation={presentation} />
    <div className="timeline-toolbar">
      <span className="timeline-toolbar-note">Past and current values default to Confirmed. Future values default to Projected.</span>
      {selectedColumn && !selectedColumn.isFuture ? <form action={confirmAction} className="timeline-confirm-form">
        <input type="hidden" name="asOf" value={selectedColumn.date} />
        <button className="account-secondary-button" type="submit" disabled={confirmPending}>{confirmPending ? "Confirming…" : "Confirm selected period"}</button>
      </form> : null}
    </div>
    <div className="timeline-recalculation-toolbar">
      {projectionAccounts.length > 0 ? <div className="timeline-recalculation-form">
        <label className="timeline-date-select">
          <span>Recalculate projections for</span>
          <InvestmentDropdown name="accountId" value={selectedProjectionAccountId} options={projectionAccounts.map((account) => ({ value: account.id, label: `${account.name} · ${account.institution}` }))} onChange={setSelectedProjectionAccountId} aria-label="Account to recalculate" floating floatingMinWidth={300} />
        </label>
        <div className="timeline-recalculation-actions">
          <button className="account-secondary-button" type="button" disabled={recalculatePending} aria-haspopup="dialog" onClick={() => requestRecalculation("account")}>{recalculatePending ? "Recalculating…" : "This account"}</button>
          <button className="account-primary-button" type="button" disabled={recalculatePending} aria-haspopup="dialog" onClick={() => requestRecalculation("all")}>{recalculatePending ? "Recalculating…" : "All accounts"}</button>
        </div>
      </div> : <span className="timeline-toolbar-note">Add an account with a balance anchor before repairing projections.</span>}
    </div>
    <ActionNotification state={recalculateState} />
    <div className="timeline-extension-toolbar">
      <form action={extendAction} className="timeline-extension-form">
        <label className="timeline-date-select">
          <span>Extend timeline to</span>
          <input type="date" name="throughDate" defaultValue={`${presentation.todayIso.slice(0, 4)}-12-31`} aria-label="Extend timeline to" />
        </label>
        <button className="account-secondary-button" type="submit" disabled={extendPending}>{extendPending ? "Extending…" : "Extend"}</button>
      </form>
      <span className="timeline-toolbar-note">{presentation.totalPeriodCount} periods available; visibility is relative to the selected period.</span>
    </div>
    <ActionNotification state={saveState} />
    <ActionNotification state={confirmState} />
    <ActionNotification state={extendState} />

    <AccountTimelineTable
      presentation={presentation}
      tableStyle={timelineTableStyle}
      isEditing={(account, column) => editingKey === inlineEditKey(account.id, column.date)}
      renderCell={({ account, column, cell }) => {
        const editing = editingKey === inlineEditKey(account.id, column.date);
        return <CellContent account={account} column={column} cell={cell} paydayCheckManaged={paydayCheckAccountId === account.id && column.isPastOrCurrent} editorSession={editing ? editingSession : null} action={saveAction} noteAction={noteAction} editing={editing} draftBalance={draftBalance} draftStatus={draftStatus} draftNote={draftNote} pending={savePending} notePending={notePending} deletePending={deletePending} state={saveState} noteState={noteState} onOpen={() => openEditor(account, column, cell)} onBalanceChange={setDraftBalance} onStatusChange={setDraftStatus} onNoteChange={setDraftNote} onCancel={closeEditor} onRequestDelete={() => requestDelete(account, column)} onKeyDown={handleEditorKeyDown} />;
      }}
    />
    <BalanceTimelineConfirmation confirmation={confirmation} onCancel={() => setConfirmation(null)} />
  </section>;
}
