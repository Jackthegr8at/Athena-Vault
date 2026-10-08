"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CashFlowAccountView, InvestmentProjectionAvailableAccountView } from "@athena/database";
import { updateInvestmentCashFlowAccountLinkAction } from "./actions";
import { initialInvestmentProjectionActionState } from "./action-helpers";
import {
  accountLabel,
  cashFlowAccountLabel,
  cashFlowCurrentAmountMinor,
  cashFlowEventTotalMinor,
  cashFlowEvents,
  cashFlowSources,
  cashFlowTransferOutEvents,
  cashFlowTransferOutTotalMinor,
  frequencyLabel,
  minorToText,
  money,
  type EditableOverride,
  type EditableSchedule,
} from "./investment-calculation";
import { ActionMessage, FieldError } from "./investment-readouts";
import { InvestmentDropdown, type InvestmentDropdownOption } from "./investment-dropdown";

const MANUAL_FREQUENCY_OPTIONS: readonly InvestmentDropdownOption<"monthly" | "biweekly">[] = [
  { value: "monthly", label: "Monthly" },
  { value: "biweekly", label: "Every 2 weeks" },
];

function CashFlowSourceSummary({
  account,
  cashFlowAccounts,
  onUseManualOverride,
}: {
  readonly account: InvestmentProjectionAvailableAccountView;
  readonly cashFlowAccounts: readonly CashFlowAccountView[];
  readonly onUseManualOverride: () => void;
}) {
  const sources = cashFlowSources(account);
  const events = cashFlowEvents(account);
  const transferOutEvents = cashFlowTransferOutEvents(account);
  const previewEvents = events.slice(0, 6);
  const previewTransferOutEvents = transferOutEvents.slice(0, 6);
  const currentAmount = cashFlowCurrentAmountMinor(account);
  const eventTotal = cashFlowEventTotalMinor(account);
  const transferOutTotal = cashFlowTransferOutTotalMinor(account);
  const primarySource = sources[0];
  const primaryRouteLabel = primarySource ? [...new Set(primarySource.routes.map((route) => `${cashFlowAccountLabel(cashFlowAccounts, route.fromAccountId)} → ${cashFlowAccountLabel(cashFlowAccounts, route.toAccountId)}`))].join(" · ") : null;
  const warnings = Array.isArray(account.cashFlowWarnings) ? account.cashFlowWarnings : [];
  const router = useRouter();
  const [linkState, linkFormAction, linkPending] = useActionState(updateInvestmentCashFlowAccountLinkAction, initialInvestmentProjectionActionState);
  const [cashFlowAccountId, setCashFlowAccountId] = useState(account.cashFlowAccountId ?? "");
  const [destinationEditorOpen, setDestinationEditorOpen] = useState(false);
  const destinationEditorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (linkState.ok) router.refresh();
  }, [linkState.ok, router]);

  useEffect(() => {
    if (!destinationEditorOpen) return;
    function closeDestinationEditor(event: PointerEvent): void {
      if (destinationEditorRef.current && event.target instanceof Node && !destinationEditorRef.current.contains(event.target)) {
        setDestinationEditorOpen(false);
      }
    }
    function closeDestinationEditorOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") setDestinationEditorOpen(false);
    }
    document.addEventListener("pointerdown", closeDestinationEditor);
    document.addEventListener("keydown", closeDestinationEditorOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeDestinationEditor);
      document.removeEventListener("keydown", closeDestinationEditorOnEscape);
    };
  }, [destinationEditorOpen]);

  function saveCashFlowLink(): void {
    const formData = new FormData();
    formData.set("investmentAccountId", account.id);
    formData.set("cashFlowAccountId", cashFlowAccountId);
    linkFormAction(formData);
  }

  const detected = account.cashFlowLinkSource === "detected";
  return <div className={`investment-source-summary ${destinationEditorOpen ? "is-destination-menu-open" : ""}`} aria-live="polite">
    <div className="investment-source-summary-header">
      <div className="investment-source-summary-heading">
        <strong>{accountLabel(account)}{primarySource?.name ? ` (${primarySource.name})` : ""}</strong>
        <small>{primarySource ? `${frequencyLabel(primarySource.frequency)}${primarySource.firstOccurrenceOn && primarySource.lastOccurrenceOn ? ` · ${primarySource.firstOccurrenceOn} → ${primarySource.lastOccurrenceOn}` : ""}` : "Active recurring Cash Flow sources · Automatic contributions currently total $0.00"}</small>
        {primaryRouteLabel ? <small>{primaryRouteLabel}</small> : null}
      </div>
      <span className="investment-count-badge">{sources.length} active source{sources.length === 1 ? "" : "s"}</span>
      <div className="investment-source-link-form">
        <button className="navy-action-button investment-source-link-save-button" type="button" onClick={saveCashFlowLink} disabled={linkPending}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 5h11l3 3v11H5z" /><path d="M8 5v5h8V5M8 19v-5h8v5" /></svg>{linkPending ? "Saving…" : "Save Cash Flow link"}</button><ActionMessage state={linkState} />
      </div>
    </div>
    <p className="investment-visually-hidden">{sources.length > 1 ? "All matching sources are aggregated by effective transfer date before projection." : "Future planned transfers are read by effective transfer date before projection."}</p>
    <div className="investment-source-summary-metrics">
      <div>
        <span>Combined current source amount</span>
        <strong>{money(currentAmount)}</strong>
      </div>
      <div className="investment-source-summary-destination">
        <span>Destination account</span>
        <div className="investment-source-summary-destination-control" ref={destinationEditorRef}>
          <button className="investment-source-summary-destination-trigger" type="button" onClick={() => setDestinationEditorOpen((open) => !open)} disabled={linkPending} aria-haspopup="listbox" aria-expanded={destinationEditorOpen} aria-controls={`cash-flow-destination-options-${account.id}`}>
            <strong>{cashFlowAccountLabel(cashFlowAccounts, cashFlowAccountId)}</strong>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 16.5-.8 3.3 3.3-.8L18.2 7.3a2.1 2.1 0 0 0-3-3z" /><path d="m13.5 5.5 5 5" /></svg>
          </button>
          {destinationEditorOpen ? <div className="investment-source-summary-destination-menu" id={`cash-flow-destination-options-${account.id}`} role="listbox" aria-label={`Cash Flow destination account for ${account.name}`}>
            <button type="button" role="option" aria-selected={cashFlowAccountId === ""} onClick={() => { setCashFlowAccountId(""); setDestinationEditorOpen(false); }}>Not linked</button>
            {cashFlowAccounts.map((cashFlowAccount) => <button key={cashFlowAccount.id} type="button" role="option" aria-selected={cashFlowAccountId === cashFlowAccount.id} onClick={() => { setCashFlowAccountId(cashFlowAccount.id); setDestinationEditorOpen(false); }}>{cashFlowAccountLabel(cashFlowAccounts, cashFlowAccount.id)}</button>)}
          </div> : null}
        </div>
        <small className="investment-visually-hidden">{detected ? "Detected from an active recurring transfer destination. Save the link to keep this mapping explicit." : "Link this investment account to the operational Cash Flow account that recurring transfers target."}</small>
        <FieldError state={linkState} field="cashFlowAccountId" />
      </div>
      <div>
        <span>Source schedule</span>
        <strong>{primarySource ? frequencyLabel(primarySource.frequency) : "No active source"}</strong>
        <small>{primarySource?.firstOccurrenceOn ? `First on ${primarySource.firstOccurrenceOn}` : "No scheduled start"}</small>
      </div>
      <div>
        <span>Projected total through horizon</span>
        <strong>{money(eventTotal)}</strong>
        <small>{primarySource?.lastOccurrenceOn ? `through ${primarySource.lastOccurrenceOn}` : "No projected events"}</small>
      </div>
      <div>
        <span>Aggregated events</span>
        <strong>{events.length}</strong>
        <small>planned events</small>
      </div>
    </div>
    {sources.length > 0 ? <ul className="investment-source-list">
      {sources.map((source) => <li key={source.seriesId}>
        <span>
          <strong>{source.name}</strong>
          <small>{frequencyLabel(source.frequency)} · {source.occurrenceCount} planned {source.occurrenceCount === 1 ? "event" : "events"}{source.firstOccurrenceOn && source.lastOccurrenceOn ? ` · ${source.firstOccurrenceOn} → ${source.lastOccurrenceOn}` : ""}</small>
          <small>{[...new Set(source.routes.map((route) => `${cashFlowAccountLabel(cashFlowAccounts, route.fromAccountId)} → ${cashFlowAccountLabel(cashFlowAccounts, route.toAccountId)}`))].join(" · ")}</small>
        </span>
        <span className="investment-source-amount">
          <strong>{money(source.amountMinor)}</strong>
          <small>{money(source.totalAmountMinor)} through horizon</small>
        </span>
      </li>)}
    </ul> : <p className="investment-empty-note">No active monthly or biweekly recurring Cash Flow transfer currently targets this investment account.</p>}
    <div className="investment-source-actions">
      <button className="investment-secondary-button" type="button" onClick={onUseManualOverride}>Use manual override</button>
      <small>Copies the combined current source amount into a saved Investments-only schedule.</small>
    </div>
    {events.length > 0 ? <details className="investment-source-events">
      <summary>Preview aggregated events <span>{events.length} dates · {money(eventTotal)} through horizon</span></summary>
      <ul className="investment-source-event-list">
        {previewEvents.map((event) => <li key={event.on}><span>{event.on}</span><strong>{money(event.amountMinor)}</strong></li>)}
      </ul>
      {events.length > previewEvents.length ? <small>Showing the first {previewEvents.length} dates; the full event stream is used for the projection.</small> : null}
    </details> : null}
    {transferOutEvents.length > 0 ? <details className="investment-source-events">
      <summary>Funding-account transfer outflows <span>{transferOutEvents.length} dates · {money(transferOutTotal)} through horizon</span></summary>
      <ul className="investment-source-event-list">
        {previewTransferOutEvents.map((event) => <li key={`${event.seriesId}-${event.versionId}-${event.scheduledOccurrenceOn}`}><span>{event.effectiveDate} · {cashFlowAccountLabel(cashFlowAccounts, event.fromAccountId)}</span><strong>{money(event.amountMinor)}</strong></li>)}
      </ul>
      <small>These negative movements remain in Cash Flow on the funding account. They are not subtracted again from the investment projection.</small>
      {transferOutEvents.length > previewTransferOutEvents.length ? <small>Showing the first {previewTransferOutEvents.length} dates; the full funding outflow stream is used by Cash Flow.</small> : null}
    </details> : null}
    {warnings.length > 0 ? <div className="investment-form-warning" role="status"><strong>Cash Flow review</strong><ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : null}
  </div>;
}

function ContributionSourceIcon({ source }: { readonly source: "cash_flow" | "manual" }) {
  return <span className="investment-contribution-source-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {source === "cash_flow" ? <><circle cx="12" cy="12" r="8.5" /><path d="M12 10v6" /><path d="M12 7.5h.01" /></> : <><path d="m4 16.5-.8 3.3 3.3-.8L18.2 7.3a2.1 2.1 0 0 0-3-3z" /><path d="m13.5 5.5 5 5" /></>}
  </svg></span>;
}

export function ScheduleEditor({
  account,
  cashFlowAccounts,
  schedule,
  onChange,
  onAddOverride,
  onChangeOverride,
  onRemoveOverride,
}: {
  readonly account: InvestmentProjectionAvailableAccountView;
  readonly cashFlowAccounts: readonly CashFlowAccountView[];
  readonly schedule: EditableSchedule;
  readonly onChange: (changes: Partial<EditableSchedule>) => void;
  readonly onAddOverride: () => void;
  readonly onChangeOverride: (index: number, changes: Partial<EditableOverride>) => void;
  readonly onRemoveOverride: (index: number) => void;
}) {
  const automatic = schedule.contributionSource === "cash_flow";
  const currentAmount = cashFlowCurrentAmountMinor(account);

  function switchContributionSource(source: EditableSchedule["contributionSource"]): void {
    onChange(source === "manual"
      ? { contributionSource: source, baseContributionText: minorToText(currentAmount) || "0.00" }
      : { contributionSource: source });
  }

  return <fieldset className="investment-schedule-editor">
    <legend className="investment-visually-hidden"><strong>{accountLabel(account)}</strong><span>{automatic ? "Cash Flow-linked" : "Manual override"} · {account.latest ? `Current ${money(account.latest.balanceMinor)}` : "No current snapshot"}</span></legend>
    <div className="investment-contribution-source-picker">
      <div className="investment-contribution-source-heading"><strong>Contribution source</strong><small>Choose how contributions will be sourced for this project.</small></div>
      <div className="investment-contribution-source-options">
        <label className={`investment-contribution-source-option ${automatic ? "is-selected" : ""}`}>
          <input type="radio" name={`contribution-source-${account.id}`} value="cash_flow" checked={automatic} onChange={() => switchContributionSource("cash_flow")} aria-label={`Cash Flow contribution source for ${account.name}`} />
          <ContributionSourceIcon source="cash_flow" />
          <span><strong>Cash Flow (automatic)</strong><small>Read active sources</small></span>
        </label>
        <label className={`investment-contribution-source-option ${!automatic ? "is-selected" : ""}`}>
          <input type="radio" name={`contribution-source-${account.id}`} value="manual" checked={!automatic} onChange={() => switchContributionSource("manual")} aria-label={`Manual override contribution source for ${account.name}`} />
          <ContributionSourceIcon source="manual" />
          <span><strong>Manual override</strong><small>Use current amount only</small></span>
        </label>
      </div>
    </div>
    {automatic ? <CashFlowSourceSummary account={account} cashFlowAccounts={cashFlowAccounts} onUseManualOverride={() => switchContributionSource("manual")} /> : <div className="investment-manual-schedule-panel">
      <p><strong>Manual schedule</strong> This saved planning value is independent of Cash Flow. Use the selector above to return to automatic sources.</p>
      <div className="investment-form-grid">
        <div className="investment-field"><span id={`investment-frequency-label-${account.id}`}>Frequency</span><InvestmentDropdown value={schedule.frequency} options={MANUAL_FREQUENCY_OPTIONS} onChange={(frequency) => onChange({ frequency })} aria-labelledby={`investment-frequency-label-${account.id}`} /></div>
        <label className="investment-field"><span>Manual base contribution (CAD)</span><input type="text" inputMode="decimal" value={schedule.baseContributionText} onChange={(event) => onChange({ baseContributionText: event.target.value })} aria-label={`Manual base contribution for ${account.name}`} /></label>
      </div>
    </div>}
    <FieldError state={initialInvestmentProjectionActionState} field="accountSchedules" />
    <div className="investment-annual-assumptions">
      <fieldset className="investment-segmented-field">
        <legend>Annual increase mode</legend>
        <div className="investment-segmented-options">
          <label className={schedule.annualIncreaseMode === "percentage" ? "is-selected" : ""}><input type="radio" name={`annual-increase-mode-${account.id}`} value="percentage" checked={schedule.annualIncreaseMode === "percentage"} onChange={() => onChange({ annualIncreaseMode: "percentage", annualIncreaseText: "0.00" })} aria-label={`Percentage annual increase for ${account.name}`} /><span>%</span>Percentage</label>
          <label className={schedule.annualIncreaseMode === "fixed_amount" ? "is-selected" : ""}><input type="radio" name={`annual-increase-mode-${account.id}`} value="fixed_amount" checked={schedule.annualIncreaseMode === "fixed_amount"} onChange={() => onChange({ annualIncreaseMode: "fixed_amount", annualIncreaseText: "0.00" })} aria-label={`Fixed amount annual increase for ${account.name}`} /><span>$</span>Fixed amount</label>
        </div>
      </fieldset>
      <label className="investment-field investment-annual-increase-field">
        <span>{schedule.annualIncreaseMode === "fixed_amount" ? "Annual increase (CAD)" : "Annual increase (%)"}</span>
        <span className="investment-annual-increase-row">
          <span className="investment-annual-increase-input">
            <input type="text" inputMode="decimal" value={schedule.annualIncreaseText} onChange={(event) => onChange({ annualIncreaseText: event.target.value })} aria-label={`${schedule.annualIncreaseMode === "fixed_amount" ? "Fixed annual increase" : "Percentage annual increase"} for ${account.name}`} />
            <b>{schedule.annualIncreaseMode === "fixed_amount" ? "CAD" : "%"}</b>
          </span>
          <small>{schedule.annualIncreaseMode === "fixed_amount" ? "Added to each contribution event in the calendar year." : "Applied to each contribution event in the calendar year."}</small>
        </span>
      </label>
    </div>
    <p className="investment-form-hint">Annual increases and overrides are Investments-only assumptions. In automatic mode they apply to the aggregated Cash Flow event stream without changing Cash Flow.</p>
    <details className="investment-annual-overrides" open={schedule.annualOverrides.length > 0}>
      <summary>Annual overrides ({schedule.annualOverrides.length})</summary>
      <p className="investment-form-hint">An override replaces the contribution amount for each event in that calendar year.</p>
      <div className="investment-rate-grid">
        {schedule.annualOverrides.map((override, index) => <div key={override.id ?? `${schedule.investmentAccountId}-override-${index}`} className="investment-field">
          <label><span>Year</span><input type="text" inputMode="numeric" value={override.yearText} onChange={(event) => onChangeOverride(index, { yearText: event.target.value })} aria-label={`Override year ${index + 1} for ${account.name}`} /></label>
          <label><span>Contribution/event (CAD)</span><input type="text" inputMode="decimal" value={override.amountText} onChange={(event) => onChangeOverride(index, { amountText: event.target.value })} aria-label={`Override amount ${index + 1} for ${account.name}`} /></label>
          <button className="investment-text-button" type="button" onClick={() => onRemoveOverride(index)}>Remove</button>
        </div>)}
      </div>
      <button className="investment-secondary-button" type="button" onClick={onAddOverride} disabled={schedule.annualOverrides.length >= 35}>Add annual override</button>
    </details>
  </fieldset>;
}
