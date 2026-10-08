import { useActionState, type FormHTMLAttributes } from "react";
import { Pencil, Trash2, TriangleAlert } from "lucide-react";
import type { InvestmentDropdownOption } from "../investments/investment-dropdown";
import type { RecurringCashFlowSeriesView } from "@athena/database";
import { FormDropdown } from "../components/form-dropdown";
import { formatMoneyInputMinor } from "../../lib/format-money";
import { ManagerMessage, dollars, type RecurringDetailEditor, type RecurringManagerAccountOption, type RecurringVersionView } from "./recurring-series-card";
import { AccountSelect, WeekdaySelect, frequencyDropdownOptions } from "./recurring-create-dialog";
import { RecurringDetailDialog } from "./recurring-detail-dialog";
import { initialCashFlowActionState, type CashFlowActionState } from "./action-helpers";
import { renameRecurringSeriesAction, updateRecurringSeriesEntirelyAction } from "./recurring-actions";





function RenameSeriesForm({ seriesId, currentName }: { readonly seriesId: string; readonly currentName: string }) {
  const [renameState, renameAction, renamePending] = useActionState(renameRecurringSeriesAction, initialCashFlowActionState);

  return <form className="cash-flow-record-form-grid recurring-detail-dialog-form" action={renameAction}>
    <input type="hidden" name="seriesId" value={seriesId} /><input type="hidden" name="confirm" value="true" />
    <label>Name<input name="name" required maxLength={240} defaultValue={currentName} /></label><div className="cash-flow-record-modal-actions"><button className="account-primary-button" type="submit" disabled={renamePending}>{renamePending ? "Renaming…" : "Rename series"}</button></div><ManagerMessage state={renameState} />
  </form>;
}

function EntireSeriesForm({ seriesId, version, accountOptions }: { readonly seriesId: string; readonly version: RecurringVersionView; readonly accountOptions: readonly RecurringManagerAccountOption[] }) {
  const [wholeState, wholeAction, wholePending] = useActionState(updateRecurringSeriesEntirelyAction, initialCashFlowActionState);
  const formKey = `whole-${seriesId}-${version.id}-${version.name}-${version.amountMinor}-${version.accountId ?? ""}-${version.fromAccountId ?? ""}-${version.toAccountId ?? ""}-${version.frequency}-${version.weekdayAdjustment}-${version.startsOn}-${version.nextOccurrenceOn}-${version.endsOn ?? ""}`;

  return <form key={formKey} className="cash-flow-record-form-grid recurring-detail-dialog-form" action={wholeAction}>
    <input type="hidden" name="seriesId" value={seriesId} /><input type="hidden" name="kind" value={version.kind} /><input type="hidden" name="confirm" value="true" />
    <label>Name<input name="name" required defaultValue={version.name} /></label><label>Amount<input name="amount" type="number" min="0.01" step="0.01" required defaultValue={formatMoneyInputMinor(version.amountMinor)} /></label>
    {version.kind === "transfer" ? <><label>From account (all linked rows)<AccountSelect name="fromAccountId" value={version.fromAccountId} options={accountOptions} required /></label><label>To account (all linked rows)<AccountSelect name="toAccountId" value={version.toAccountId} options={accountOptions} required /></label><label className="cash-flow-record-field-wide recurring-delete-confirmation"><input name="countsAsExpense" type="checkbox" value="true" defaultChecked={version.countsAsExpense === true} /> <span>Count as spending (still a transfer for balances)</span></label></> : <label>Account (all linked rows)<AccountSelect name="accountId" value={version.accountId} options={accountOptions} required /></label>}
    <label>Frequency<FormDropdown name="frequency" defaultValue={version.frequency} options={frequencyDropdownOptions} floatingMinWidth={240} /></label><label>Weekday rule<WeekdaySelect value={version.weekdayAdjustment} /></label><label>First occurrence<input name="startsOn" type="date" required defaultValue={version.startsOn} /></label><label>End occurrence (optional)<input name="endsOn" type="date" defaultValue={version.endsOn ?? ""} /></label><label className="cash-flow-record-field-wide">Note<textarea name="note" maxLength={500} defaultValue="" /></label><div className="cash-flow-record-modal-actions recurring-entire-series-actions"><button className="account-primary-button" type="submit" disabled={wholePending}>{wholePending ? "Saving…" : "Save entire series"}</button></div><ManagerMessage state={wholeState} />
  </form>;
}

const groupKindDropdownOptions: readonly InvestmentDropdownOption[] = [
  { value: "override", label: "Override" },
  { value: "skip", label: "Skip" },
];

const groupStatusDropdownOptions: readonly InvestmentDropdownOption[] = [
  { value: "", label: "Base status" },
  { value: "planned", label: "Planned" },
];

type RecurringSeriesDialogFormAction = NonNullable<FormHTMLAttributes<HTMLFormElement>["action"]>;
type RecurringSeriesDialogAction = { readonly state: CashFlowActionState; readonly action: RecurringSeriesDialogFormAction; readonly pending: boolean };

interface RecurringSeriesDialogData {
  readonly entry: RecurringCashFlowSeriesView;
  readonly accountOptions: readonly RecurringManagerAccountOption[];
  readonly todayIso: string;
  readonly endOfYear: string;
  readonly version: RecurringVersionView | null;
  readonly historyVersion: RecurringVersionView | null;
  readonly versionFormSource: RecurringVersionView | null;
  readonly versionPreviousEnd: string;
  readonly currentVersionNextOccurrence: string;
  readonly activeGroupId: string | null;
  readonly activeGroupException: RecurringCashFlowSeriesView["exceptions"][number] | null;
  readonly activeEditor: RecurringDetailEditor | null;
}

interface RecurringSeriesDialogsProps {
  readonly data: RecurringSeriesDialogData;
  readonly actions: {
    readonly version: RecurringSeriesDialogAction;
    readonly historyEdit: RecurringSeriesDialogAction;
    readonly deleteSeries: RecurringSeriesDialogAction;
    readonly versionDelete: { readonly action: RecurringSeriesDialogFormAction; readonly pending: boolean };
    readonly group: RecurringSeriesDialogAction;
    readonly restore: RecurringSeriesDialogAction;
    readonly end: RecurringSeriesDialogAction;
    readonly generate: RecurringSeriesDialogAction;
  };
  readonly onClose: () => void;
  readonly onOpenVersionEditor: (history?: RecurringVersionView) => void;
  readonly onOpenVersionDelete: (history: RecurringVersionView) => void;
}

export function RecurringSeriesDialogs({ data, actions, onClose, onOpenVersionEditor, onOpenVersionDelete }: RecurringSeriesDialogsProps) {
  const { entry, accountOptions, todayIso, endOfYear, version, historyVersion, versionFormSource, versionPreviousEnd, currentVersionNextOccurrence, activeGroupId, activeGroupException, activeEditor } = data;
  const { state: versionState, action: versionAction, pending: versionPending } = actions.version;
  const { state: historyEditState, action: historyEditAction, pending: historyEditPending } = actions.historyEdit;
  const { state: deleteState, action: deleteAction, pending: deletePending } = actions.deleteSeries;
  const { action: versionDeleteAction, pending: versionDeletePending } = actions.versionDelete;
  const { state: groupState, action: groupAction, pending: groupPending } = actions.group;
  const { state: restoreState, action: restoreAction, pending: restorePending } = actions.restore;
  const { state: endState, action: endAction, pending: endPending } = actions.end;
  const { state: generationState, action: generationAction, pending: generationPending } = actions.generate;
  const closeEditor = onClose;
  const openVersionEditor = onOpenVersionEditor;
  const openVersionDelete = onOpenVersionDelete;
  return <>
    {activeEditor === "rename" ? <RecurringDetailDialog title="Rename series" description="Change the name that appears across Cash Flow." onClose={closeEditor}><RenameSeriesForm seriesId={entry.id} currentName={version?.name ?? ""} /></RecurringDetailDialog> : null}
    {activeEditor === "version" && (historyVersion || entry.state !== "ended") && version && versionFormSource ? <RecurringDetailDialog title={historyVersion ? "Edit history version" : "Create a new version"} description={historyVersion ? "Update this saved version and its scheduled range. Protected Cash Flow rows are never rewritten." : "This change applies to this series and future linked Cash Flow rows."} onClose={closeEditor}><form key={`version-${entry.id}-${versionFormSource.id}-${historyVersion ? "history" : "future"}`} className="cash-flow-record-form-grid recurring-detail-dialog-form" action={historyVersion ? historyEditAction : versionAction}>
       <input type="hidden" name="seriesId" value={entry.id} /><input type="hidden" name="kind" value={versionFormSource.kind} />{historyVersion ? <><input type="hidden" name="versionId" value={historyVersion.id} /><input type="hidden" name="confirm" value="true" /></> : null}
       <label>Name<input name="name" required defaultValue={versionFormSource.name} /></label><label>Amount<input name="amount" type="number" min="0.01" step="0.01" required defaultValue={formatMoneyInputMinor(versionFormSource.amountMinor)} /></label>
       {versionFormSource.kind === "transfer" ? <><label>From account<AccountSelect name="fromAccountId" value={versionFormSource.fromAccountId} options={accountOptions} required /></label><label>To account<AccountSelect name="toAccountId" value={versionFormSource.toAccountId} options={accountOptions} required /></label><label className="cash-flow-record-field-wide recurring-delete-confirmation"><input name="countsAsExpense" type="checkbox" value="true" defaultChecked={versionFormSource.countsAsExpense === true} /> <span>Count as spending (still a transfer for balances)</span></label></> : <label>Account<AccountSelect name="accountId" value={versionFormSource.accountId} options={accountOptions} required /></label>}
       <label>Frequency<FormDropdown name="frequency" defaultValue={versionFormSource.frequency} options={frequencyDropdownOptions} floatingMinWidth={240} /></label><label>Weekday rule<WeekdaySelect value={versionFormSource.weekdayAdjustment} /></label>
       {historyVersion ? <><label>Version starts on<input name="startsOn" type="date" required defaultValue={historyVersion.effectiveFrom} /></label><label>Version ends on<input name="endsOn" type="date" required={Boolean(historyVersion.effectiveTo)} defaultValue={historyVersion.effectiveTo ?? ""} /></label></> : <><label>Last current occurrence before the new version<input name="previousEndsOn" type="date" required defaultValue={versionPreviousEnd} /></label><label>New version starts on<input name="newScheduleStartsOn" type="date" required defaultValue={currentVersionNextOccurrence} /></label><label>New schedule ends (optional)<input name="endsOn" type="date" defaultValue="" /></label></>}
       <label className="cash-flow-record-field-wide">Version note<textarea name="versionNote" maxLength={500} rows={2} defaultValue={versionFormSource.versionNote ?? ""} /></label><p className="recurring-version-edit-note">{historyVersion ? "This updates editable generated planned occurrences. Actual, manual, excluded, or overridden rows stay unchanged." : "The new version follows the current schedule from the dates above. The selected history entry remains unchanged."}</p><div className="cash-flow-record-modal-actions recurring-entire-series-actions"><button className="account-primary-button" type="submit" disabled={historyVersion ? historyEditPending : versionPending}>{historyVersion ? (historyEditPending ? "Saving…" : "Save history version") : (versionPending ? "Saving…" : "Save new version")}</button></div>{!(historyVersion ? historyEditState : versionState).ok && <ManagerMessage state={historyVersion ? historyEditState : versionState} />}
     </form></RecurringDetailDialog> : null}
    {activeEditor === "entire" && entry.state !== "ended" && version ? <RecurringDetailDialog title="Edit entire series" description="Update every Cash Flow row linked to this recurring series." onClose={closeEditor}><EntireSeriesForm seriesId={entry.id} version={version} accountOptions={accountOptions} /></RecurringDetailDialog> : null}
    {activeEditor === "group" && activeGroupId && activeGroupException ? <RecurringDetailDialog title="Edit grouped range" description="Update or restore the recurring exception dates in this group." onClose={closeEditor}><form className="cash-flow-record-form-grid recurring-detail-dialog-form" action={groupAction}>
      <input type="hidden" name="overrideGroupId" value={activeGroupId} /><label>Type<FormDropdown name="kind" defaultValue={activeGroupException.kind ?? "override"} options={groupKindDropdownOptions} floatingMinWidth={220} /></label><label>Status<FormDropdown name="statusOverride" defaultValue={activeGroupException.statusOverride ?? ""} options={groupStatusDropdownOptions} floatingMinWidth={220} /></label><label>Common amount<input name="amountOverride" type="number" min="0.01" step="0.01" defaultValue={activeGroupException.amountOverrideMinor ? formatMoneyInputMinor(activeGroupException.amountOverrideMinor) : ""} /></label><label>Account<AccountSelect name="accountOverrideId" value={activeGroupException.accountOverrideId ?? null} options={accountOptions} /></label><label className="cash-flow-record-field-wide">Group note<textarea name="note" maxLength={500} rows={2} defaultValue={activeGroupException.note ?? ""} /></label><div className="cash-flow-record-modal-actions"><button className="account-primary-button" type="submit" disabled={groupPending}>{groupPending ? "Saving…" : "Edit group"}</button></div><ManagerMessage state={groupState} />
    </form><form className="recurring-detail-dialog-secondary-form" action={restoreAction}><input type="hidden" name="seriesId" value={entry.id} /><input type="hidden" name="occurrenceId" value="" /><input type="hidden" name="overrideGroupId" value={activeGroupId} /><input type="hidden" name="scope" value="group" /><input type="hidden" name="confirm" value="true" /><button className="account-secondary-button" type="submit" disabled={restorePending}>{restorePending ? "Restoring…" : "Restore entire group"}</button><ManagerMessage state={restoreState} /></form></RecurringDetailDialog> : null}
    {activeEditor === "history" ? <RecurringDetailDialog title="Series history" description="Review the versions and changes recorded for this recurring series." onClose={closeEditor}><div className="recurring-history-dialog-list">{entry.versions.map((history) => <div className="recurring-history-row" key={history.id}><span className="recurring-history-row-copy"><strong>{history.name}</strong><small>{history.effectiveFrom}{history.effectiveTo ? ` to ${history.effectiveTo}` : " onward"} · {history.frequency} · {history.weekdayAdjustment}</small></span><span className="recurring-history-row-side"><strong className="recurring-history-row-amount">{dollars(history.amountMinor)}</strong><span className="recurring-history-row-actions">{history.isCurrent ? <span className="recurring-history-current">Current</span> : <><button className="recurring-history-action-button" type="button" onClick={() => openVersionEditor(history)}><Pencil aria-hidden="true" size={14} strokeWidth={1.8} />Edit</button><button className="recurring-history-action-button is-danger" type="button" onClick={() => openVersionDelete(history)}><Trash2 aria-hidden="true" size={14} strokeWidth={1.8} />Delete</button></>}</span></span>{history.versionNote ? <em>{history.versionNote}</em> : null}</div>)}</div></RecurringDetailDialog> : null}
    {activeEditor === "version-delete" && historyVersion && !historyVersion.isCurrent ? <RecurringDetailDialog title="Delete recurring version" description="Remove this saved version without deleting the recurring series." onClose={closeEditor} variant="danger" icon={TriangleAlert}>
      <form className="recurring-delete-form" action={versionDeleteAction}>
        <input type="hidden" name="seriesId" value={entry.id} /><input type="hidden" name="versionId" value={historyVersion.id} />
        <div className="recurring-delete-warning"><TriangleAlert aria-hidden="true" size={22} strokeWidth={1.8} /><p>Deleting <strong>{historyVersion.name}</strong> removes only its generated planned Cash Flow rows. Actual, manual, excluded, and overridden records are protected, and the rest of the recurring series stays intact.</p></div>
        <label className="recurring-delete-confirmation"><input name="confirm" type="checkbox" value="true" required /><span>I understand that this version and its generated planned rows will be removed.</span></label>
        <div className="recurring-delete-actions"><button type="button" className="account-secondary-button" onClick={closeEditor}>Cancel</button><button type="submit" className="account-danger-button" disabled={versionDeletePending}>{versionDeletePending ? "Deleting…" : "Delete version"}</button></div>
      </form>
    </RecurringDetailDialog> : null}
    {activeEditor === "delete" ? <RecurringDetailDialog title="Delete series and linked rows" description="This permanently deletes the recurring series and every Cash Flow row linked to it." onClose={closeEditor} variant="danger" icon={TriangleAlert}>
      <form className="recurring-delete-form" action={deleteAction}>
        <input type="hidden" name="seriesId" value={entry.id} />
        <div className="recurring-delete-warning">
          <TriangleAlert aria-hidden="true" size={22} strokeWidth={1.8} />
          <p>Deleting <strong>{version?.name ?? "this series"}</strong> will remove the recurring series and every Cash Flow row linked to it, including planned, Actual, manual, generated, and excluded rows. This cannot be undone.</p>
        </div>
        <label className="recurring-delete-confirmation">
          <input name="confirm" type="checkbox" value="true" required />
          <span>I understand that this cannot be undone.</span>
        </label>
        <div className="recurring-delete-actions">
          <button type="button" className="account-secondary-button" onClick={closeEditor}>Cancel</button>
          <button type="submit" className="account-danger-button" disabled={deletePending}>{deletePending ? "Deleting…" : "Delete series and linked rows"}</button>
        </div>
        <ManagerMessage state={deleteState} />
      </form>
    </RecurringDetailDialog> : null}
    {activeEditor === "end" ? <RecurringDetailDialog title="End series" description="Choose the last occurrence to keep in this recurring series." onClose={closeEditor}><form className="cash-flow-record-form-grid recurring-detail-dialog-form" action={endAction}><input type="hidden" name="seriesId" value={entry.id} /><label>End on<input name="endingOccurrenceOn" type="date" defaultValue={version?.nextOccurrenceOn ?? todayIso} required /></label><input type="hidden" name="confirm" value="true" /><div className="cash-flow-record-modal-actions"><button className="account-danger-button" type="submit" disabled={endPending}>{endPending ? "Ending…" : "End series"}</button></div><ManagerMessage state={endState} /></form></RecurringDetailDialog> : null}
    {activeEditor === "regenerate" ? <RecurringDetailDialog title="Regenerate occurrences" description="Choose how far ahead planned occurrences should be generated." onClose={closeEditor}><form className="cash-flow-record-form-grid recurring-detail-dialog-form" action={generationAction}><input type="hidden" name="seriesId" value={entry.id} /><label>Generate through<input name="throughDate" type="date" defaultValue={endOfYear} required /></label><div className="cash-flow-record-modal-actions"><button className="account-primary-button" type="submit" disabled={generationPending}>{generationPending ? "Generating…" : "Regenerate"}</button></div><ManagerMessage state={generationState} /></form></RecurringDetailDialog> : null}
  </>;
}
