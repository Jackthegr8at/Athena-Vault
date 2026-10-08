import type { FormHTMLAttributes, ReactNode } from "react";
import { ArrowLeftRight, CalendarDays, ChevronRight, History, Landmark, Layers, MoreHorizontal, Pause, Pencil, Play, RefreshCw, Square, Trash2, TriangleAlert, type LucideIcon } from "lucide-react";
import type { RecurringCashFlowSeriesView } from "@athena/database";
import { formatMoneyMinor } from "../../lib/format-money";
import type { CashFlowActionState } from "./action-helpers";

export function recurringSeriesAnchorId(seriesId: string): string {
  return `recurring-series-${seriesId}`;
}

export interface RecurringManagerAccountOption {
  readonly id: string;
  readonly label: string;
}

export type RecurringVersionView = RecurringCashFlowSeriesView["versions"][number];

export type RecurringDetailEditor = "rename" | "version" | "entire" | "history" | "version-delete" | "delete" | "end" | "regenerate" | "group";

export const dollars = (minor: number) => formatMoneyMinor(minor);

export function frequencyLabel(frequency: string): string {
  return frequency.charAt(0).toUpperCase() + frequency.slice(1);
}

export function seriesInitial(name: string): string {
  const firstCharacter = [...name.trim()][0];
  return firstCharacter?.toUpperCase() ?? "S";
}

export function ManagerMessage({ state }: { readonly state: CashFlowActionState }) {
  return state.message ? <p className={`cash-flow-action-message ${state.ok ? "is-success" : "is-error"}`} role={state.ok ? "status" : "alert"}>{state.message}</p> : null;
}

function RecurringDetailOption({ icon: Icon, title, description, danger = false, onClick }: { readonly icon: LucideIcon; readonly title: string; readonly description: string; readonly danger?: boolean; readonly onClick: () => void }) {
  return <button className={`recurring-detail-option${danger ? " is-danger" : ""}`} type="button" onClick={onClick} aria-haspopup="dialog"><span className="recurring-detail-option-icon"><Icon aria-hidden="true" size={19} strokeWidth={1.8} /></span><span className="recurring-detail-option-copy"><strong>{title}</strong><small>{description}</small></span><ChevronRight className="recurring-detail-option-chevron" aria-hidden="true" size={17} strokeWidth={1.8} /></button>;
}

type RecurringCardFormAction = NonNullable<FormHTMLAttributes<HTMLFormElement>["action"]>;
type RecurringCardAction = { readonly state: CashFlowActionState; readonly action: RecurringCardFormAction; readonly pending: boolean };

export interface RecurringSeriesCardPresentationProps {
  readonly entry: RecurringCashFlowSeriesView;
  readonly version: RecurringVersionView | null;
  readonly account: string;
  readonly nextPaymentDistance: string;
  readonly activeGroups: readonly string[];
  readonly individualExceptions: RecurringCashFlowSeriesView["exceptions"];
  readonly activeExceptionCount: number;
  readonly detailTitleId: string;
  readonly detailMenuOpen: boolean;
  readonly onDetailMenuOpenChange: (open: boolean) => void;
  readonly onOpenEditor: (editor: RecurringDetailEditor) => void;
  readonly onOpenVersionEditor: (history?: RecurringVersionView) => void;
  readonly onOpenGroupEditor: (groupId: string) => void;
  readonly actions: {
    readonly pause: RecurringCardAction;
    readonly countsAsExpense: RecurringCardAction;
    readonly restore: { readonly action: RecurringCardFormAction; readonly pending: boolean };
  };
  readonly children?: ReactNode;
}

export function RecurringSeriesCard({ entry, version, account, nextPaymentDistance, activeGroups, individualExceptions, activeExceptionCount, detailTitleId, detailMenuOpen, onDetailMenuOpenChange, onOpenEditor, onOpenVersionEditor, onOpenGroupEditor, actions, children }: RecurringSeriesCardPresentationProps) {
  const { state: stateState, action: stateAction, pending: statePending } = actions.pause;
  const { state: countsAsExpenseState, action: countsAsExpenseAction, pending: countsAsExpensePending } = actions.countsAsExpense;
  const { action: restoreAction, pending: restorePending } = actions.restore;
  const setDetailMenuOpen = onDetailMenuOpenChange;
  const openEditor = onOpenEditor;
  const openVersionEditor = onOpenVersionEditor;
  return <article className={`recurring-series-detail is-${entry.state}`} id={recurringSeriesAnchorId(entry.id)} aria-labelledby={detailTitleId}>
    <div className="recurring-detail-header"><div className="recurring-detail-title"><span className="recurring-series-avatar" aria-hidden="true">{seriesInitial(version?.name ?? "Unnamed series")}</span><div><div className="recurring-detail-name-row"><h4 id={detailTitleId}>{version?.name ?? "Unnamed series"}</h4><span className={`timeline-status-badge is-${entry.state}`}>{entry.state}</span></div><p>{version ? `${version.kind} · ${frequencyLabel(version.frequency)} · ${account}${version.kind === "transfer" && version.countsAsExpense ? " · counts as spending" : ""}${entry.homeHouseholdFrequency ? ` · Home ${entry.homeHouseholdFrequency}` : ""}` : "No effective version"}</p></div></div><details className="recurring-detail-menu-wrap" open={detailMenuOpen} onToggle={(event) => setDetailMenuOpen(event.currentTarget.open)}><summary className="recurring-detail-menu-trigger" aria-label={`More actions for ${version?.name ?? "recurring series"}`}><MoreHorizontal aria-hidden="true" size={20} strokeWidth={1.9} /></summary><div className="recurring-detail-menu-popover" role="menu" aria-label="Series actions"><button className="recurring-detail-menu-item" type="button" role="menuitem" onClick={() => openEditor("rename")}><Pencil aria-hidden="true" size={16} strokeWidth={1.8} /><span>Rename series</span></button>{entry.state !== "ended" && version?.kind === "transfer" ? <form action={countsAsExpenseAction}><input type="hidden" name="seriesId" value={entry.id} /><input type="hidden" name="countsAsExpense" value={version.countsAsExpense ? "false" : "true"} /><input type="hidden" name="confirm" value="true" /><button className="recurring-detail-menu-item" type="submit" role="menuitem" disabled={countsAsExpensePending}><ArrowLeftRight aria-hidden="true" size={16} strokeWidth={1.8} /><span>{version.countsAsExpense ? "Count as transfer" : "Count as spending"}</span></button></form> : null}</div></details></div>
    <div className="recurring-detail-facts" aria-label="Recurring series summary">
      <div className="recurring-detail-fact"><span className="recurring-detail-fact-label"><CalendarDays aria-hidden="true" size={16} strokeWidth={1.8} /><span>Next payment</span></span><strong>{entry.nextOccurrenceOn ?? "—"}</strong><small>{nextPaymentDistance}</small></div>
      <div className="recurring-detail-fact"><span className="recurring-detail-fact-label"><RefreshCw aria-hidden="true" size={16} strokeWidth={1.8} /><span>Cadence</span></span><strong>{version ? frequencyLabel(version.frequency) : "—"}</strong><small>{version?.weekdayAdjustment === "none" ? "Every scheduled period" : "Weekday adjusted"}</small></div>
      <div className="recurring-detail-fact"><span className="recurring-detail-fact-label"><Landmark aria-hidden="true" size={16} strokeWidth={1.8} /><span>Account path</span></span><strong title={account}>{account}</strong><small>{version?.kind === "transfer" ? "Transfer route" : "Linked account"}</small></div>
      <div className="recurring-detail-fact"><span className="recurring-detail-fact-label"><Layers aria-hidden="true" size={16} strokeWidth={1.8} /><span>Versions</span></span><strong>{entry.versions.length}</strong><small>Current series</small></div>
      <div className="recurring-detail-fact"><span className="recurring-detail-fact-label"><TriangleAlert aria-hidden="true" size={16} strokeWidth={1.8} /><span>Exceptions</span></span><strong>{activeExceptionCount}</strong><small>{activeExceptionCount === 0 ? "None upcoming" : "Active"}</small></div>
    </div>
    <div className="recurring-detail-actions"><h5>Actions</h5>
      <div className="recurring-detail-action-bar">
        {entry.state !== "ended" ? <form className="recurring-detail-action-form" action={stateAction}><input type="hidden" name="seriesId" value={entry.id} /><input type="hidden" name="state" value={entry.state === "paused" ? "active" : "paused"} /><input type="hidden" name="confirm" value="true" /><button className="recurring-detail-action-button" type="submit" disabled={statePending}>{entry.state === "paused" ? <Play aria-hidden="true" size={17} strokeWidth={1.9} /> : <Pause aria-hidden="true" size={17} strokeWidth={1.9} />}<span>{entry.state === "paused" ? "Resume series" : "Pause series"}</span></button></form> : null}
        {entry.state !== "ended" ? <button className="recurring-detail-action-button is-danger" type="button" onClick={() => openEditor("end")} aria-haspopup="dialog"><Square aria-hidden="true" size={17} strokeWidth={1.9} /><span>End series</span></button> : null}
        <button className="recurring-detail-action-button is-gold" type="button" onClick={() => openEditor("regenerate")} aria-haspopup="dialog"><RefreshCw aria-hidden="true" size={17} strokeWidth={1.9} /><span>Regenerate</span></button>
      </div>
      {stateState.message ? <ManagerMessage state={stateState} /> : null}
      {countsAsExpenseState.message ? <ManagerMessage state={countsAsExpenseState} /> : null}
    </div>
    <div className="recurring-detail-options" aria-label="Series management">
      <RecurringDetailOption icon={Pencil} title="Rename entire series" description="Change the name of this recurring series." onClick={() => openEditor("rename")} />
      {entry.state !== "ended" && version ? <RecurringDetailOption icon={CalendarDays} title="This and future: create a new version" description="Create a new version and link future Cash Flow rows." onClick={() => openVersionEditor()} /> : null}
      {entry.state !== "ended" && version ? <RecurringDetailOption icon={Layers} title="Entire series" description="Move all linked Cash Flow rows to new settings." onClick={() => openEditor("entire")} /> : null}
      {activeGroups.map((groupId, index) => <RecurringDetailOption key={groupId} icon={TriangleAlert} title={`Edit grouped range${activeGroups.length > 1 ? ` ${index + 1}` : ""}`} description="Update or restore the linked exception dates." onClick={() => onOpenGroupEditor(groupId)} />)}
      <RecurringDetailOption icon={History} title="Show history" description="View version history and past changes." onClick={() => openEditor("history")} />
      <RecurringDetailOption icon={Trash2} title="Delete series and all linked rows" description="Permanently delete this series and its linked Cash Flow rows." danger onClick={() => openEditor("delete")} />
    </div>
    {individualExceptions.length > 0 ? <div className="recurring-individual-exceptions"><strong>Individual exceptions</strong>{individualExceptions.map((exception) => <div className="recurring-individual-exception" key={exception.id}><span>{exception.scheduledOccurrenceOn} · {exception.kind}{exception.note ? ` · ${exception.note}` : ""}</span><form action={restoreAction}><input type="hidden" name="seriesId" value={entry.id} /><input type="hidden" name="occurrenceId" value={exception.id} /><input type="hidden" name="overrideGroupId" value="" /><input type="hidden" name="scope" value="occurrence" /><input type="hidden" name="confirm" value="true" /><button className="account-secondary-button" type="submit" disabled={restorePending}>{restorePending ? "Restoring…" : "Restore"}</button></form></div>)}</div> : null}
    {children}
  </article>;
}
