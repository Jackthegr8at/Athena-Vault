"use client";

import { useActionState, useEffect, useMemo, useState, type ReactNode, type RefObject } from "react";
import Image from "next/image";
import type { CashFlowAccountView, InvestmentProjectionAvailableAccountView, InvestmentProjectionProjectView } from "@athena/database";
import {
  createInvestmentProjectionAction,
  updateInvestmentProjectionAction,
} from "./actions";
import { initialInvestmentProjectionActionState } from "./action-helpers";
import {
  amountTextToMinor,
  EditableSchedule,
  initialSchedules,
  minorToText,
  percentFromBasisPoints,
  percentTextToBasisPoints,
  scheduleFromAccount,
  safeIntegerFromText,
  type EditableOverride,
} from "./investment-calculation";
import { ActionMessage, FieldError } from "./investment-readouts";
import { ScenarioIcon } from "./investment-icons";
import { AccountSelection } from "./investment-project-account-selection";
import { ScheduleEditor } from "./investment-project-schedule-editor";
import { InvestmentDialog } from "./investment-dialog";

const DEFAULT_RATES_BPS = [500, 400, 300, 200];
type ProjectionMode = "calculator" | "portfolio";

const PROJECTION_MODES: readonly ProjectionMode[] = ["calculator", "portfolio"];

function schedulePayload(schedule: EditableSchedule) {
  const displayOrder = typeof schedule.displayOrder === "number" && Number.isSafeInteger(schedule.displayOrder) ? schedule.displayOrder : 0;
  const annualOverrides = Array.isArray(schedule.annualOverrides) ? schedule.annualOverrides : [];
  return {
    ...(schedule.id ? { id: schedule.id } : {}),
    investmentAccountId: schedule.investmentAccountId,
    displayOrder,
    frequency: schedule.frequency,
    contributionSource: schedule.contributionSource,
    baseContributionMinor: amountTextToMinor(schedule.baseContributionText) ?? schedule.baseContributionText.trim(),
    annualIncreaseMode: schedule.annualIncreaseMode,
    annualIncreaseBps: schedule.annualIncreaseMode === "percentage" ? percentTextToBasisPoints(schedule.annualIncreaseText) ?? schedule.annualIncreaseText.trim() : 0,
    annualIncreaseMinor: schedule.annualIncreaseMode === "fixed_amount" ? amountTextToMinor(schedule.annualIncreaseText) ?? schedule.annualIncreaseText.trim() : 0,
    annualOverrides: annualOverrides.map((override) => ({
      ...(override.id ? { id: override.id } : {}),
      year: safeIntegerFromText(override.yearText) ?? override.yearText.trim(),
      amountMinor: amountTextToMinor(override.amountText) ?? override.amountText.trim(),
    })),
  };
}

function ProjectionModeIcon({ mode }: { readonly mode: ProjectionMode }) {
  return <span className="investment-mode-option-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {mode === "calculator" ? <><rect x="5" y="3.5" width="14" height="17" rx="2" /><path d="M8 7h8M8 11h2M14 11h2M8 15h2M14 15h2M8 18h8" /></> : <><path d="M12 3a9 9 0 1 1-6.36 2.64" /><path d="M12 7v5l3 2" /><path d="M4 4v5h5" /></>}
  </svg></span>;
}

const SCENARIO_DESCRIPTIONS = ["Best case", "Above average", "Average case", "Below average"] as const;

function scenarioDescription(index: number): string {
  return SCENARIO_DESCRIPTIONS[index] ?? `Scenario ${index + 1}`;
}

export function ProjectionForm({
  mode: formMode,
  accounts,
  cashFlowAccounts,
  project,
  onSaved,
  onCancel,
  onPendingChange,
}: {
  readonly mode: "create" | "edit";
  readonly accounts: readonly InvestmentProjectionAvailableAccountView[];
  readonly cashFlowAccounts: readonly CashFlowAccountView[];
  readonly project: InvestmentProjectionProjectView | null;
  readonly onSaved: () => void;
  readonly onCancel: () => void;
  readonly onPendingChange?: (pending: boolean) => void;
}) {
  const action = formMode === "create" ? createInvestmentProjectionAction : updateInvestmentProjectionAction;
  const [state, formAction, pending] = useActionState(action, initialInvestmentProjectionActionState);
  const [mode, setMode] = useState<ProjectionMode>(() => project?.mode ?? "calculator");
  const [name, setName] = useState(project?.name ?? "");
  const [notes, setNotes] = useState(project?.notes ?? "");
  const [horizonText, setHorizonText] = useState(String(project?.horizonYears ?? 30));
  const [manualStartingAmountText, setManualStartingAmountText] = useState(minorToText(project?.mode === "calculator" ? project.manualStartingAmountMinor ?? 0 : 0));
  const [rateTexts, setRateTexts] = useState<string[]>(() => project?.rates.length ? project.rates.map((rate) => percentFromBasisPoints(rate.rateBps)) : DEFAULT_RATES_BPS.map(percentFromBasisPoints));
  const [schedules, setSchedules] = useState<EditableSchedule[]>(() => initialSchedules(accounts, project));
  const selectedIds = useMemo(() => schedules.map((schedule) => schedule.investmentAccountId), [schedules]);

  useEffect(() => {
    if (state.ok) onSaved();
  }, [onSaved, state.ok]);

  useEffect(() => { onPendingChange?.(pending); }, [onPendingChange, pending]);

  function toggleAccount(account: InvestmentProjectionAvailableAccountView): void {
    setSchedules((current) => {
      const existing = current.some((schedule) => schedule.investmentAccountId === account.id);
      if (existing) return current.filter((schedule) => schedule.investmentAccountId !== account.id).map((schedule, displayOrder) => ({ ...schedule, displayOrder }));
      if (current.length >= 4) return current;
      return [...current, scheduleFromAccount(account, current.length)];
    });
  }

  function updateSchedule(accountId: string, changes: Partial<EditableSchedule>): void {
    setSchedules((current) => current.map((schedule) => schedule.investmentAccountId === accountId ? { ...schedule, ...changes } : schedule));
  }

  function addOverride(accountId: string): void {
    setSchedules((current) => current.map((schedule) => schedule.investmentAccountId === accountId ? { ...schedule, annualOverrides: [...schedule.annualOverrides, { yearText: String(Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric" }).format(new Date())) + 1), amountText: "0.00" }] } : schedule));
  }

  function updateOverride(accountId: string, index: number, changes: Partial<EditableOverride>): void {
    setSchedules((current) => current.map((schedule) => schedule.investmentAccountId === accountId ? { ...schedule, annualOverrides: schedule.annualOverrides.map((override, overrideIndex) => overrideIndex === index ? { ...override, ...changes } : override) } : schedule));
  }

  function removeOverride(accountId: string, index: number): void {
    setSchedules((current) => current.map((schedule) => schedule.investmentAccountId === accountId ? { ...schedule, annualOverrides: schedule.annualOverrides.filter((_, overrideIndex) => overrideIndex !== index) } : schedule));
  }

  function updateRate(index: number, value: string): void {
    setRateTexts((current) => current.map((rate, rateIndex) => rateIndex === index ? value : rate));
  }

  function addRate(): void {
    setRateTexts((current) => current.length >= 4 ? current : [...current, "1.00"]);
  }

  function removeRate(index: number): void {
    setRateTexts((current) => current.length <= 1 ? current : current.filter((_, rateIndex) => rateIndex !== index));
  }

  const serializedSchedules = JSON.stringify(schedules.map(schedulePayload));
  const serializedRates = JSON.stringify(rateTexts.map((value) => percentTextToBasisPoints(value, true) ?? value.trim()));
  const manualMinor = amountTextToMinor(manualStartingAmountText);
  const manualHiddenValue = manualMinor === null && manualStartingAmountText.trim() ? manualStartingAmountText : manualMinor === null ? "" : String(manualMinor);
  const canSubmit = !pending && (mode === "calculator" || schedules.length > 0);

  return <form action={formAction} className="investment-project-form investment-projection-modal-form">
    {project ? <input type="hidden" name="id" value={project.id} /> : null}
    <input type="hidden" name="mode" value={mode} />
    <input type="hidden" name="ratesBps" value={serializedRates} />
    {mode === "calculator" ? <input type="hidden" name="manualStartingAmountMinor" value={manualHiddenValue} /> : <input type="hidden" name="accountSchedules" value={serializedSchedules} />}

    <div className="investment-form-grid">
      <label className="investment-field"><span>Project name</span><input name="name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} placeholder="Retirement outlook" /><FieldError state={state} field="name" /></label>
      <label className="investment-field"><span>Horizon (years)</span><input name="horizonYears" type="number" min={1} max={35} value={horizonText} onChange={(event) => setHorizonText(event.target.value)} required /><FieldError state={state} field="horizonYears" /></label>
      <label className="investment-field investment-field-wide"><span>Notes <small>(optional)</small></span><textarea name="notes" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} rows={2} placeholder="What this projection is for" /><FieldError state={state} field="notes" /></label>
    </div>

    <fieldset className="investment-mode-switch">
      <legend>Planning mode</legend>
      <p className="investment-mode-description">Choose how you want to build this projection.</p>
      <div className="investment-mode-options">
        {PROJECTION_MODES.map((option) => <label key={option} className={`investment-mode-option ${mode === option ? "is-selected" : ""}`}>
          <input type="radio" name="planningModeChoice" value={option} checked={mode === option} onChange={() => setMode(option)} disabled={pending} />
          <ProjectionModeIcon mode={option} />
          <span className="investment-mode-option-copy"><strong>{option === "calculator" ? "Manual calculator" : "Portfolio planner"}</strong><small>{option === "calculator" ? "Enter your own starting amount and return scenarios." : "Use your portfolios and account data to project outcomes."}</small></span>
        </label>)}
      </div>
      <FieldError state={state} field="mode" />
    </fieldset>

    {mode === "calculator" ? <fieldset className="investment-calculator-panel">
      <div><h3>Manual starting amount</h3><p>Enter the amount you want to use as your starting point.</p></div>
      <label className="investment-money-field"><span className="investment-visually-hidden">Manual starting amount (CAD)</span><span className="investment-money-input"><b>CAD</b><input type="text" inputMode="decimal" value={manualStartingAmountText} onChange={(event) => setManualStartingAmountText(event.target.value)} placeholder="0.00" aria-label="Manual starting amount in CAD" /></span><FieldError state={state} field="manualStartingAmountMinor" /></label>
    </fieldset> : <>
      <AccountSelection accounts={accounts} selectedIds={selectedIds} onToggle={toggleAccount} />
      <FieldError state={state} field="accountSchedules" />
      {schedules.map((schedule) => {
        const account = accounts.find((candidate) => candidate.id === schedule.investmentAccountId);
        return account ? <ScheduleEditor key={schedule.investmentAccountId} account={account} cashFlowAccounts={cashFlowAccounts} schedule={schedule} onChange={(changes) => updateSchedule(schedule.investmentAccountId, changes)} onAddOverride={() => addOverride(schedule.investmentAccountId)} onChangeOverride={(index, changes) => updateOverride(schedule.investmentAccountId, index, changes)} onRemoveOverride={(index) => removeOverride(schedule.investmentAccountId, index)} /> : null;
      })}
      {schedules.length === 0 ? <p className="investment-empty-note">Select at least one investment account to add its independent portfolio schedule.</p> : null}
    </>}

    <fieldset className={`investment-scenario-editor ${mode === "portfolio" ? "is-portfolio" : ""}`}>
      <legend>Annual return scenarios</legend>
      <p className="investment-scenario-subtitle">Monthly compounding <span aria-hidden="true">·</span> Portfolio schedules may be monthly or biweekly</p>
      <div className="investment-scenario-list">
        {rateTexts.map((rate, index) => <div key={`rate-${index}`} className="investment-scenario-row">
          <ScenarioIcon index={index} />
          <span className="investment-scenario-copy"><strong>Scenario {index + 1}</strong><small>{scenarioDescription(index)}</small></span>
          <span className="investment-scenario-rate"><input type="text" inputMode="decimal" value={rate} onChange={(event) => updateRate(index, event.target.value)} aria-label={`Annual return scenario ${index + 1}`} /><b>%</b></span>
          {rateTexts.length > 1 ? <button className="investment-scenario-remove" type="button" onClick={() => removeRate(index)} aria-label={`Remove annual return scenario ${index + 1}`}><span>Remove</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button> : null}
        </div>)}
      </div>
      {rateTexts.length < 4 ? <button className="investment-add-scenario" type="button" onClick={addRate}><span aria-hidden="true">+</span>Add scenario</button> : null}
      <FieldError state={state} field="ratesBps" />
    </fieldset>

    <div className="investment-form-notice"><span aria-hidden="true">i</span><p>Rates, annual increases, and overrides are saved with the project. Automatic schedules re-read active Cash Flow sources when the project is opened; saving never creates transactions.</p></div>

    <div className="investment-form-actions investment-modal-form-actions"><button className="investment-secondary-button" type="button" onClick={onCancel} disabled={pending}>Cancel</button><button className="navy-action-button investment-modal-save-button" type="submit" disabled={!canSubmit}>{pending ? "Saving…" : formMode === "create" ? "Save projection" : "Save changes"}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h13M13 7l5 5-5 5" /></svg></button><ActionMessage state={state} /></div>
  </form>;
}

export function ProjectionModal({ title, description, pending = false, restoreFocusRef, shouldRestoreFocus, onRestoredFocus, onClose, children }: {
  readonly title: string;
  readonly description: string;
  readonly pending?: boolean;
  readonly restoreFocusRef?: RefObject<HTMLElement | null>;
  readonly shouldRestoreFocus?: () => boolean;
  readonly onRestoredFocus?: () => void;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const titleId = "investment-projection-modal-title";
  const descriptionId = "investment-projection-modal-description";
  return <InvestmentDialog backdropClassName="investment-modal-backdrop investment-projection-modal-backdrop" dialogClassName="investment-dialog investment-projection-dialog" titleId={titleId} descriptionId={descriptionId} pending={pending} dismissOnBackdrop restoreFocusRef={restoreFocusRef} shouldRestoreFocus={shouldRestoreFocus} onRestoredFocus={onRestoredFocus} onClose={onClose}>
      <aside className="investment-projection-rail">
        <div className="investment-projection-brand"><Image src="/brand/athena-vault-helmet.svg" alt="" aria-hidden="true" width={42} height={62} /><span>ATHENA VAULT</span></div>
        <div className="investment-projection-rail-copy"><p className="eyebrow">Investment planning</p><h2 id={titleId}>{title}</h2><div className="investment-projection-rail-divider" aria-hidden="true"><span /><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m12 7 3 5-3 5-3-5z" /></svg><span /></div><p id={descriptionId}>{description}</p></div>
        <div className="investment-projection-rail-note"><span aria-hidden="true">i</span><p>You can edit assumptions and scenarios anytime. Planning edits never change Cash Flow.</p></div>
        <div className="investment-projection-rail-art" aria-hidden="true" />
      </aside>
      <div className="investment-projection-content"><button className="investment-modal-close-button" type="button" onClick={onClose} disabled={pending} data-investment-dialog-initial-focus aria-label={`Close ${title}`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>{children}</div>
  </InvestmentDialog>;
}
