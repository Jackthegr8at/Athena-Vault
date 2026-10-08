"use client";

import * as React from "react";
import { startTransition, useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArchiveRestore, ChartNoAxesColumnIncreasing, CheckCircle2, ChevronDown, ChevronRight, Pencil, Plus, Target, Trash2 } from "lucide-react";
import { GOAL_SAVING_PLAN_FREQUENCIES, type GoalSavingPlanFrequency } from "@athena/database/goal-saving-plans";
import type { FinancialGoalPlanView, FinancialGoalView, GoalPlanDestinationAccountView, GoalPlanSourceAccountView } from "@athena/database";
import {
  createGoalAction,
  deleteGoalAction,
  disableGoalPlanAction,
  goalPlanPreviewsAction,
  restoreGoalAction,
  saveGoalPlanAction,
  setGoalStatusAction,
  updateGoalAction,
  updateGoalProgressAction,
} from "./actions";
import { initialGoalActionState, type GoalActionState } from "./action-helpers";
import { ActionNotification, type ActionNotificationState } from "../components/action-notification";
import { ConfirmationDialog } from "../components/confirmation-dialog";
import {
  computePreviewForStart,
  computeSelectedPlanPreview,
  formatCadMinor,
  formatLongDate,
  inputAmountFromMinor,
  planFrequencyLabel,
  type GoalPlanFrequencyPreview,
  type GoalPlanPreviews,
} from "./goal-plan-utils";
import { InvestmentDropdown, type InvestmentDropdownOption } from "../investments/investment-dropdown";
import { FormDropdown } from "../components/form-dropdown";

const targetDateFormat = new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric", timeZone: "UTC" });
const DEFAULT_PLAN_FREQUENCY: GoalSavingPlanFrequency = "biweekly";

const priorityOptions: readonly InvestmentDropdownOption[] = [0, 1, 2, 3, 4, 5].map((priority) => ({ value: String(priority), label: String(priority) }));
const goalViewOptions: readonly InvestmentDropdownOption[] = [
  { value: "all", label: "All goals" },
  { value: "on-track", label: "On track" },
  { value: "planning", label: "Planning" },
  { value: "not-started", label: "Not started" },
  { value: "achieved", label: "Achieved" },
];

function FieldError({ state, field, className }: { readonly state: GoalActionState; readonly field: keyof GoalActionState["fieldErrors"]; readonly className?: string }) {
  const message = state.fieldErrors[field];
  return message ? <small className={`goals-field-error${className ? ` ${className}` : ""}`} role="alert">{message}</small> : null;
}

function GoalFormFields({ state, goal }: { readonly state: GoalActionState; readonly goal?: FinancialGoalView }) {
  return <div className="goals-form-grid">
    <label className="goals-field">
      <span>Goal name</span>
      <input name="name" type="text" required maxLength={120} defaultValue={goal?.name ?? ""} placeholder="e.g. Dream home" />
      <FieldError state={state} field="name" />
    </label>
    <label className="goals-field">
      <span>Target amount</span>
      <input name="target" type="text" required inputMode="decimal" pattern="\d+(\.\d{1,2})?" defaultValue={goal ? inputAmountFromMinor(goal.targetMinor) : ""} placeholder="0.00" />
      <FieldError state={state} field="target" />
    </label>
    <label className="goals-field">
      <span>Funded so far</span>
      <input name="current" type="text" inputMode="decimal" pattern="\d+(\.\d{1,2})?" defaultValue={goal ? inputAmountFromMinor(goal.currentMinor) : "0"} placeholder="0.00" />
      <FieldError state={state} field="current" />
    </label>
    <label className="goals-field">
      <span>Target date</span>
      <input name="targetDate" type="date" defaultValue={goal?.targetDate ?? ""} />
      <FieldError state={state} field="targetDate" />
    </label>
    <label className="goals-field">
      <span>Priority</span>
      <FormDropdown name="priority" defaultValue={String(goal?.priority ?? 0)} options={priorityOptions} floatingMinWidth={200} numeric />
      <FieldError state={state} field="priority" />
    </label>
  </div>;
}

function goalPercent(goal: FinancialGoalView): number {
  return goal.targetMinor > 0 ? Math.min(100, Math.round(goal.currentMinor * 100 / goal.targetMinor)) : 0;
}

function targetLabel(goal: FinancialGoalView): string {
  return goal.targetDate ? `Target: ${targetDateFormat.format(new Date(`${goal.targetDate}T00:00:00Z`))}` : "No target date";
}

function goalStatusMeta(goal: FinancialGoalView, plan?: FinancialGoalPlanView): { readonly label: string; readonly tone: "on-track" | "planning" | "not-started" | "achieved" } {
  if (goal.status === "achieved") return { label: "Achieved", tone: "achieved" };
  if (goal.currentMinor > 0 || plan?.enabled) return { label: "On track", tone: "on-track" };
  if (goal.priority > 0 || goal.targetDate) return { label: "Planning", tone: "planning" };
  return { label: "Not started", tone: "not-started" };
}

function GoalIcon() {
  return <Target aria-hidden="true" size={25} strokeWidth={1.7} />;
}

function GoalProgressRing({ percent, label }: { readonly percent: number; readonly label: string }) {
  const radius = 31;
  const circumference = 2 * Math.PI * radius;
  return <div className="goals-progress-ring" role="img" aria-label={`${label}: ${percent}% funded`}>
    <svg viewBox="0 0 76 76" aria-hidden="true" focusable="false">
      <circle className="goals-progress-ring-track" cx="38" cy="38" r={radius} />
      <circle className="goals-progress-ring-value" cx="38" cy="38" r={radius} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - percent / 100)} />
    </svg>
    <strong>{percent}%</strong>
  </div>;
}

type GoalView = "all" | "on-track" | "planning" | "not-started" | "achieved";

function sortGoals(goals: readonly FinancialGoalView[]): FinancialGoalView[] {
  return [...goals].sort((left, right) => {
    const leftDate = left.targetDate ?? "9999-12-31";
    const rightDate = right.targetDate ?? "9999-12-31";
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    return left.name.localeCompare(right.name);
  });
}

function goalMatchesView(goal: FinancialGoalView, plan: FinancialGoalPlanView | undefined, view: GoalView): boolean {
  return view === "all" || goalStatusMeta(goal, plan).tone === view;
}

function frequencyPreview(previews: readonly GoalPlanFrequencyPreview[], frequency: GoalSavingPlanFrequency): GoalPlanFrequencyPreview | undefined {
  return previews.find((preview) => preview.frequency === frequency);
}

function PlanRequiredCards({
  previews,
  pending,
  selectedFrequency,
  onSelectFrequency,
}: {
  readonly previews: readonly GoalPlanFrequencyPreview[];
  readonly pending?: boolean;
  readonly selectedFrequency: GoalSavingPlanFrequency;
  readonly onSelectFrequency: (frequency: GoalSavingPlanFrequency) => void;
}) {
  return <div className="goals-plan-required-grid" role="group" aria-label="Choose a contribution frequency">
    {GOAL_SAVING_PLAN_FREQUENCIES.map((frequency) => {
      const preview = frequencyPreview(previews, frequency);
      const selected = selectedFrequency === frequency;
      return <button
        className={`goals-plan-required-card${selected ? " is-selected" : ""}`}
        type="button"
        key={frequency}
        aria-pressed={selected}
        onClick={() => onSelectFrequency(frequency)}
      >
        <span className="goals-plan-required-label">{planFrequencyLabel(frequency)}</span>
        <strong>{pending ? "Calculating…" : preview?.requiredAmountMinor === null || preview?.requiredAmountMinor === undefined ? "—" : formatCadMinor(preview.requiredAmountMinor)}</strong>
        <small>{pending ? "Plan preview loading" : preview?.occurrences ? `${preview.occurrences} contributions` : "No future contributions"}</small>
        {selected ? <span className="goals-plan-required-check" aria-hidden="true"><CheckCircle2 size={14} strokeWidth={2.4} /></span> : null}
      </button>;
    })}
  </div>;
}

type SelectedPlanStatus = ReturnType<typeof computeSelectedPlanPreview> | { readonly status: "loading"; readonly shortfallMinor: null; readonly completionDate: null };

function planStatusMessage(status: SelectedPlanStatus, targetDate: string | null): string {
  if (status.status === "loading") return "Calculating the plan preview…";
  if (status.status === "target-reached") return "Target already reached.";
  if (status.status === "no-occurrence") return "This frequency has no contribution date before the target.";
  if (status.status === "empty") return "Enter a positive contribution amount.";
  if (status.status === "shortfall") return `Short by ${formatCadMinor(status.shortfallMinor ?? 0)} at the target date.`;
  if (status.status === "ahead") return `Ahead of pace — reaches the target on ${status.completionDate ? formatLongDate(status.completionDate) : "an earlier date"}.`;
  if (status.status === "on-pace") return `On pace — reaches the target on ${targetDate ? formatLongDate(targetDate) : "the target date"}.`;
  return "Set a recurring contribution to reach this goal.";
}

function GoalPlanSection({
  goal,
  plan,
  destinationAccounts,
  sourceAccounts,
  previews,
  previewsPending = false,
  todayIso,
  readOnly,
  initialOpen = false,
  onActionResult,
}: {
  readonly goal: FinancialGoalView;
  readonly plan: FinancialGoalPlanView | undefined;
  readonly destinationAccounts: readonly GoalPlanDestinationAccountView[];
  readonly sourceAccounts: readonly GoalPlanSourceAccountView[];
  readonly previews: readonly GoalPlanFrequencyPreview[];
  readonly previewsPending?: boolean;
  readonly todayIso: string;
  readonly readOnly: boolean;
  readonly initialOpen?: boolean;
  readonly onActionResult: (state: ActionNotificationState) => void;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [frequency, setFrequency] = useState<GoalSavingPlanFrequency>(plan?.frequency ?? DEFAULT_PLAN_FREQUENCY);
  const [amountText, setAmountText] = useState(() => {
    if (plan) return inputAmountFromMinor(plan.amountMinor);
    const preview = frequencyPreview(previews, DEFAULT_PLAN_FREQUENCY);
    return preview?.requiredAmountMinor != null ? inputAmountFromMinor(preview.requiredAmountMinor) : "";
  });
  const [amountEdited, setAmountEdited] = useState(Boolean(plan));
  const defaultStart = frequencyPreview(previews, DEFAULT_PLAN_FREQUENCY)?.defaultStartsOn ?? "";
  const [startsOn, setStartsOn] = useState(() => plan?.startsOn ?? defaultStart);
  const [startsOnEdited, setStartsOnEdited] = useState(Boolean(plan));
  const [sourceAccountId, setSourceAccountId] = useState<string>(() => plan?.sourceAccountId ?? "");
  const [countsAsExpense, setCountsAsExpense] = useState<boolean>(() => !!plan?.countsAsExpense);
  const [destinationAccountId, setDestinationAccountId] = useState<string>(() => plan?.accountId ?? destinationAccounts[0]?.id ?? "");
  const [destinationEdited, setDestinationEdited] = useState(() => Boolean(plan));
  const saveFeedbackAction = useCallback(async (previousState: GoalActionState, formData: FormData): Promise<GoalActionState> => {
    const nextState = await saveGoalPlanAction(previousState, formData);
    if (nextState.message) onActionResult(nextState);
    return nextState;
  }, [onActionResult]);
  const disableFeedbackAction = useCallback(async (previousState: GoalActionState, formData: FormData): Promise<GoalActionState> => {
    const nextState = await disableGoalPlanAction(previousState, formData);
    if (nextState.message) onActionResult(nextState);
    return nextState;
  }, [onActionResult]);
  const [saveState, saveAction, savePending] = useActionState(saveFeedbackAction, initialGoalActionState);
  const [, disableAction, disablePending] = useActionState(disableFeedbackAction, initialGoalActionState);
  const configured = Boolean(plan);
  const destination = plan ? destinationAccounts.find((account) => account.id === plan.accountId) : undefined;
  const source = plan?.sourceAccountId ? sourceAccounts.find((account) => account.id === plan.sourceAccountId) : undefined;
  const targetReached = goal.currentMinor >= goal.targetMinor;
  const activePlan = Boolean(plan?.enabled && (plan.cashFlowSeriesId !== null || plan.ruleEnabled));
  const basePreview = goal.targetDate ? frequencyPreview(previews, frequency) : undefined;
  const effectiveStartsOn = startsOnEdited ? startsOn : basePreview?.defaultStartsOn ?? "";
  const selectedPreview = basePreview && goal.targetDate && effectiveStartsOn
    ? computePreviewForStart({
      targetMinor: goal.targetMinor,
      currentMinor: goal.currentMinor,
      targetDate: goal.targetDate,
      todayIso,
      startsOn: effectiveStartsOn,
      frequency,
    })
    : undefined;
  const effectiveAmountText = amountEdited
    ? amountText
    : selectedPreview?.requiredAmountMinor != null ? inputAmountFromMinor(selectedPreview.requiredAmountMinor) : "";
  const selectedStatus: SelectedPlanStatus = previewsPending
    ? { status: "loading", shortfallMinor: null, completionDate: null }
    : selectedPreview && goal.targetDate
    ? computeSelectedPlanPreview(effectiveAmountText, selectedPreview, goal.targetDate)
    : { status: "no-occurrence" as const, shortfallMinor: null, completionDate: null };
  const planToggleEnabled = !activePlan;
  const destinationUnavailable = Boolean(plan && !destination);
  const sourceUnavailable = Boolean(plan?.sourceAccountId && !source);
  const sourceRequired = Boolean(plan?.sourceRequired);
  const effectiveDestinationAccountId = destinationEdited ? destinationAccountId : destinationAccounts[0]?.id ?? "";

  const openEditor = () => {
    setOpen(true);
    const nextFrequency = plan?.frequency ?? DEFAULT_PLAN_FREQUENCY;
    const nextPreview = frequencyPreview(previews, nextFrequency);
    setFrequency(nextFrequency);
    setAmountEdited(Boolean(plan));
    setStartsOnEdited(Boolean(plan));
    setStartsOn(plan?.startsOn ?? nextPreview?.defaultStartsOn ?? "");
    setAmountText(
      plan
        ? inputAmountFromMinor(plan.amountMinor)
        : (nextPreview?.requiredAmountMinor != null ? inputAmountFromMinor(nextPreview.requiredAmountMinor) : "")
    );
    setSourceAccountId(plan?.sourceAccountId ?? "");
    setDestinationAccountId(plan?.accountId ?? destinationAccounts[0]?.id ?? "");
    setDestinationEdited(Boolean(plan));
    setCountsAsExpense(!!plan?.countsAsExpense);
  };

  const selectFrequency = (nextFrequency: GoalSavingPlanFrequency) => {
    setFrequency(nextFrequency);
    setAmountEdited(false);
  };
  const planSummary = () => {
    if (previewsPending && goal.targetDate) return "Calculating the plan preview…";
    if (!configured) return "Set a recurring contribution to reach this goal";
    if (sourceRequired) return "Source account required";
    if (sourceUnavailable) return "Source account unavailable. Reconfigure this plan to continue contributions.";
    if (destinationUnavailable) return "Destination account unavailable. Reconfigure this plan to continue contributions.";
    const sourceName = source?.name ?? plan?.sourceAccountName ?? "Source account";
    const destinationName = destination?.name ?? plan?.accountName ?? "Destination account";
    return `Saving ${formatCadMinor(plan!.amountMinor)} ${plan!.frequency === "biweekly" ? "every 2 weeks" : `every ${plan!.frequency}`} from ${sourceName} to ${destinationName}`;
  };
  const sourceAccountOptions: readonly InvestmentDropdownOption[] = [
    { value: "", label: "Select a source account", disabled: true },
    ...(sourceUnavailable && plan?.sourceAccountId ? [{ value: plan.sourceAccountId, label: "Unavailable source account", disabled: true }] : []),
    ...sourceAccounts.map((account) => ({ value: account.id, label: `${account.name} · ${account.institution}` })),
  ];
  const destinationAccountOptions: readonly InvestmentDropdownOption[] = [
    { value: "", label: "Select an account", disabled: true },
    ...(destinationUnavailable && plan?.accountId ? [{ value: plan.accountId, label: "Unavailable destination account", disabled: true }] : []),
    ...destinationAccounts.map((account) => ({ value: account.id, label: `${account.name} · ${account.institution}` })),
  ];


  if (readOnly) {
    return <section className="goals-plan-summary" aria-label={`Saving plan for ${goal.name}`}>
      <div className="goals-plan-summary-head"><strong>Plan savings</strong><span>{configured && activePlan ? "Active" : configured ? "Disabled" : "Not configured"}</span></div>
      {configured ? <p>{planSummary()}</p> : <p>Set a recurring contribution to reach this goal.</p>}
    </section>;
  }

  return <section className={`goals-plan${open ? " is-open" : ""}`} aria-label={`Saving plan for ${goal.name}`}>
    <button className="goals-plan-toggle" type="button" aria-expanded={open} onClick={() => open ? setOpen(false) : openEditor()}>
      <span><strong>Plan savings</strong><small>{planSummary()}</small></span>
      <ChevronDown aria-hidden="true" size={17} />
    </button>
    {open ? <div className="goals-plan-editor">
      <div className="goals-plan-heading">
        <div><strong>{targetReached ? "Target already reached" : "Build a saving pace"}</strong><small>{goal.targetDate ? `${formatCadMinor(Math.max(goal.targetMinor - goal.currentMinor, 0))} remaining · target ${formatLongDate(goal.targetDate)}` : "Add a target date to calculate a plan."}</small></div>
        {configured ? <span className={`goals-plan-state${activePlan ? " is-active" : ""}`}>{activePlan ? "Active" : "Disabled"}</span> : null}
      </div>
      <PlanRequiredCards previews={previews} pending={previewsPending} selectedFrequency={frequency} onSelectFrequency={selectFrequency} />
      <form className="goals-plan-form" action={saveAction}>
        <input type="hidden" name="goalId" value={goal.id} />
        <input type="hidden" name="frequency" value={frequency} />
        <FieldError state={saveState} field="frequency" className="goals-plan-frequency-error" />
        <div className="goals-field"><span id={`goal-source-account-label-${goal.id}`}>Source account</span><InvestmentDropdown name="sourceAccountId" value={sourceAccountId} options={sourceAccountOptions} onChange={setSourceAccountId} disabled={sourceAccounts.length === 0} floating floatingMinWidth={380} aria-labelledby={`goal-source-account-label-${goal.id}`} /><FieldError state={saveState} field="sourceAccountId" /></div>
        <div className="goals-field"><span id={`goal-destination-account-label-${goal.id}`}>Destination account</span><InvestmentDropdown name="accountId" value={effectiveDestinationAccountId} options={destinationAccountOptions} onChange={(value) => { setDestinationAccountId(value); setDestinationEdited(true); }} disabled={destinationAccounts.length === 0} floating floatingMinWidth={380} aria-labelledby={`goal-destination-account-label-${goal.id}`} /><FieldError state={saveState} field="accountId" /></div>
        <label className="goals-field"><span>Start date</span><input name="startsOn" type="date" min={todayIso} max={goal.targetDate ?? undefined} value={effectiveStartsOn} onChange={(event) => { setStartsOn(event.target.value); setStartsOnEdited(true); }} disabled={!goal.targetDate} /><FieldError state={saveState} field="startsOn" /></label>
        <label className="goals-field"><span>Contribution amount</span><input name="amount" type="text" inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={effectiveAmountText} onChange={(event) => { setAmountText(event.target.value); setAmountEdited(true); }} placeholder="250.00" disabled={targetReached || !goal.targetDate} /><FieldError state={saveState} field="amount" /></label>
        <label className="goals-field goals-plan-expense"><input name="countsAsExpense" type="checkbox" value="on" checked={countsAsExpense} onChange={(event) => setCountsAsExpense(event.target.checked)} /><span>Count transfer as an expense</span></label>
        <p className={`goals-plan-preview is-${selectedStatus.status}`} role="status">{planStatusMessage(selectedStatus, goal.targetDate)}</p>
        {sourceRequired && !sourceAccountId ? <p className="goals-plan-unavailable" role="alert">Source account required</p> : null}
        {sourceUnavailable ? <p className="goals-plan-unavailable" role="alert">Source account unavailable. Reconfigure this plan to continue contributions.</p> : null}
        {destinationUnavailable ? <p className="goals-plan-unavailable" role="alert">Destination account unavailable. Reconfigure this plan to continue contributions.</p> : null}
        {configured ? <input type="hidden" name="enabled" value={planToggleEnabled ? "true" : "false"} /> : null}
        <div className="goals-plan-actions"><button className="navy-action-button" type="submit" disabled={savePending || previewsPending || targetReached || !goal.targetDate || destinationAccounts.length === 0 || sourceAccounts.length === 0}>{savePending ? "Saving…" : "Save plan"}</button><button className="account-secondary-button" type="button" onClick={() => setOpen(false)} disabled={savePending || disablePending}>Cancel</button>{configured ? <button className="goals-danger-button" type="submit" formAction={disableAction} disabled={disablePending}><span>{disablePending ? (planToggleEnabled ? "Enabling…" : "Disabling…") : (planToggleEnabled ? "Enable plan" : "Disable plan")}</span></button> : null}</div>
        {destinationAccounts.length === 0 ? <p className="goals-plan-unavailable" role="alert">Destination account unavailable. Add an active CAD asset account first.</p> : null}
        {sourceAccounts.length === 0 ? <p className="goals-plan-unavailable" role="alert">Source account unavailable. Add an active CAD asset account visible in Cash Flow first.</p> : null}
      </form>
    </div> : null}
  </section>;
}

type GoalCardProps = {
  readonly goal: FinancialGoalView;
  readonly plan?: FinancialGoalPlanView;
  readonly destinationAccounts: readonly GoalPlanDestinationAccountView[];
  readonly sourceAccounts: readonly GoalPlanSourceAccountView[];
  readonly previews: readonly GoalPlanFrequencyPreview[];
  readonly previewsPending?: boolean;
  readonly todayIso: string;
  readonly readOnly: boolean;
  readonly featured?: boolean;
  readonly onActionResult: (state: ActionNotificationState) => void;
};

function GoalCard({ goal, plan, destinationAccounts, sourceAccounts, previews, previewsPending = false, todayIso, readOnly, featured = false, onActionResult }: GoalCardProps) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingAchieved, setConfirmingAchieved] = useState(false);
  const editFeedbackAction = useCallback(async (previousState: GoalActionState, formData: FormData): Promise<GoalActionState> => {
    const nextState = await updateGoalAction(previousState, formData);
    if (nextState.ok) setEditing(false);
    if (nextState.message) onActionResult(nextState);
    return nextState;
  }, [onActionResult]);
  const progressFeedbackAction = useCallback(async (previousState: GoalActionState, formData: FormData): Promise<GoalActionState> => {
    const nextState = await updateGoalProgressAction(previousState, formData);
    if (nextState.message) onActionResult(nextState);
    return nextState;
  }, [onActionResult]);
  const statusFeedbackAction = useCallback(async (previousState: GoalActionState, formData: FormData): Promise<GoalActionState> => {
    const nextState = await setGoalStatusAction(previousState, formData);
    if (nextState.message) onActionResult(nextState);
    return nextState;
  }, [onActionResult]);
  const deleteFeedbackAction = useCallback(async (previousState: GoalActionState, formData: FormData): Promise<GoalActionState> => {
    const nextState = await deleteGoalAction(previousState, formData);
    if (nextState.ok) setConfirmingDelete(false);
    if (nextState.message) onActionResult(nextState);
    return nextState;
  }, [onActionResult]);
  const [editState, editAction, editPending] = useActionState(editFeedbackAction, initialGoalActionState);
  const [progressState, progressAction, progressPending] = useActionState(progressFeedbackAction, initialGoalActionState);
  const [, statusAction, statusPending] = useActionState(statusFeedbackAction, initialGoalActionState);
  const [, deleteAction, deletePending] = useActionState(deleteFeedbackAction, initialGoalActionState);
  const stopFormRef = useRef<HTMLFormElement>(null);
  const preserveFormRef = useRef<HTMLFormElement>(null);
  const percent = goalPercent(goal);
  const achieved = goal.status === "achieved";

  const confirmDelete = () => {
    const formData = new FormData();
    formData.set("id", goal.id);
    formData.set("confirm", "true");
    startTransition(() => deleteAction(formData));
  };

  return <article id={featured ? `goal-${goal.id}` : undefined} className={`card section-card goals-card${featured ? " goals-card--featured" : ""}${achieved ? " goals-card--achieved" : ""}`}>
    <div className="goals-card-header">
      <div className="goals-goal-heading"><span className="goals-goal-icon"><GoalIcon /></span><div><h3 className="goals-card-title">{goal.name}</h3><p className="goals-card-subtitle">{targetLabel(goal)}{achieved ? " · Achieved" : ""}</p></div></div>
      <div className="goals-card-header-actions"><GoalProgressRing percent={percent} label={goal.name} /></div>
    </div>
    <div className="goals-insight"><Target aria-hidden="true" size={21} /><span><strong>{formatCadMinor(goal.currentMinor)} funded</strong> of a {formatCadMinor(goal.targetMinor)} target.</span></div>
    <GoalPlanSection key={`${goal.id}:${plan ? JSON.stringify([plan.id, plan.accountId, plan.sourceAccountId, plan.amountMinor, plan.frequency, plan.startsOn, plan.countsAsExpense]) : "unconfigured"}`} goal={goal} plan={plan} destinationAccounts={destinationAccounts} sourceAccounts={sourceAccounts} previews={previews} previewsPending={previewsPending} todayIso={todayIso} readOnly={readOnly} initialOpen={featured && Boolean(plan)} onActionResult={onActionResult} />
    {readOnly ? null : <>
      <form className="goals-progress-form" action={progressAction}><input type="hidden" name="id" value={goal.id} /><label className="goals-field goals-progress-field"><span>Update funded amount</span><input name="current" type="text" inputMode="decimal" pattern="\d+(\.\d{1,2})?" defaultValue={inputAmountFromMinor(goal.currentMinor)} aria-label={`Funded amount for ${goal.name}`} /></label><button className="account-secondary-button" type="submit" disabled={progressPending}>{progressPending ? "Saving…" : "Update"}</button></form>
      <FieldError state={progressState} field="current" />
      {progressState.message && !progressState.ok ? <p className="goals-message" role="alert">{progressState.message}</p> : null}
      <div className="goals-card-actions"><button className="account-secondary-button" type="button" onClick={() => { setEditing((current) => !current); setConfirmingDelete(false); }}><Pencil aria-hidden="true" size={14} /> {editing ? "Close" : "Edit"}</button>{!achieved ? <button className="account-secondary-button" type="button" onClick={() => setConfirmingAchieved(true)} disabled={statusPending}><CheckCircle2 aria-hidden="true" size={14} /> Mark achieved</button> : null}<form action={statusAction} className="goals-inline-action"><input type="hidden" name="id" value={goal.id} /><input type="hidden" name="status" value="archived" /><button className="account-secondary-button" type="submit" disabled={statusPending}><Archive aria-hidden="true" size={14} /> Archive</button></form><button className="account-secondary-button" type="button" aria-haspopup="dialog" onClick={() => setConfirmingDelete(true)} disabled={deletePending}><Trash2 aria-hidden="true" size={14} /> Delete</button></div>
      <form ref={stopFormRef} action={statusAction} className="goals-hidden-form"><input type="hidden" name="id" value={goal.id} /><input type="hidden" name="status" value="achieved" /><input type="hidden" name="stopContributions" value="true" /></form><form ref={preserveFormRef} action={statusAction} className="goals-hidden-form"><input type="hidden" name="id" value={goal.id} /><input type="hidden" name="status" value="achieved" /><input type="hidden" name="stopContributions" value="false" /></form>
      {editing ? <form className="goals-edit-form" action={editAction}><input type="hidden" name="id" value={goal.id} /><GoalFormFields state={editState} goal={goal} /><div className="goals-form-actions"><button className="navy-action-button" type="submit" disabled={editPending}>{editPending ? "Saving…" : "Save goal"}</button><button className="account-secondary-button" type="button" onClick={() => setEditing(false)}>Cancel</button></div>{editState.message && !editState.ok ? <p className="goals-message" role="alert">{editState.message}</p> : null}</form> : null}
      {confirmingDelete ? <ConfirmationDialog
        open
        title={`Permanently delete ${goal.name}?`}
        description={`This permanently removes ${goal.name}, its plans, and all funding history. If you only want to stop scheduled contributions, disable the plan instead.`}
        confirmLabel="Delete goal"
        tone="danger"
        pending={deletePending}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmingDelete(false)}
      /> : null}
      <ConfirmationDialog open={confirmingAchieved} title="Mark this goal achieved?" description="Choose whether the linked recurring contribution should continue after this goal is marked achieved." confirmLabel="Mark achieved and stop contributions" secondaryLabel="Mark achieved only" tone="default" pending={statusPending} onCancel={() => setConfirmingAchieved(false)} onConfirm={() => stopFormRef.current?.requestSubmit()} onSecondary={() => preserveFormRef.current?.requestSubmit()} />
    </>}
  </article>;
}

function GoalsOverviewCard({ goals }: { readonly goals: readonly FinancialGoalView[] }) {
  const fundedMinor = goals.reduce((total, goal) => total + goal.currentMinor, 0);
  const targetMinor = goals.reduce((total, goal) => total + goal.targetMinor, 0);
  const percent = targetMinor > 0 ? Math.min(100, Math.round(fundedMinor * 100 / targetMinor)) : 0;
  return <article className="card section-card goals-side-summary goals-side-summary--overview" aria-labelledby="goals-overview-heading">
    <div className="goals-overview-head">
      <span className="goals-overview-icon"><ChartNoAxesColumnIncreasing aria-hidden="true" size={27} strokeWidth={1.9} /></span>
      <div className="goals-overview-title"><h3 id="goals-overview-heading">Goals overview</h3><p>A snapshot of your progress.</p></div>
    </div>
    <div className="goals-overview-metrics"><div><strong>{goals.length}</strong><span>Total goals</span></div><div><strong>{formatCadMinor(fundedMinor)}</strong><span>Total funded</span></div><div><strong>{percent}%</strong><span>Overall progress</span></div></div>
  </article>;
}

function GoalsPromoCard() {
  return <article className="card goals-promo-card">
    <div className="goals-promo-copy"><p className="eyebrow">Longer tomorrows</p><h3>Your goals today shape a freer tomorrow.</h3><span className="goals-promo-rule" aria-hidden="true" /><p>Thoughtful planning turns today&apos;s choices into tomorrow&apos;s opportunities.</p></div>
  </article>;
}

function GoalOtherRow({ goal, plan, onSelectGoal }: { readonly goal: FinancialGoalView; readonly plan?: FinancialGoalPlanView; readonly onSelectGoal: (goalId: string) => void }) {
  const percent = goalPercent(goal);
  const status = goalStatusMeta(goal, plan);
  return <button id={`goal-${goal.id}`} className="goals-other-row" type="button" onClick={() => onSelectGoal(goal.id)}>
    <span className="goals-other-row-content">
      <span className="goals-other-icon"><GoalIcon /></span>
      <span className="goals-other-name"><strong>{goal.name}</strong></span>
      <span className="goals-other-target">{targetLabel(goal)}</span>
      <span className="goals-other-funded"><strong>{formatCadMinor(goal.currentMinor)}</strong><small>of {formatCadMinor(goal.targetMinor)}</small></span>
      <span className="goals-other-progress"><span><i style={{ width: `${percent}%` }} /></span></span>
      <span className="goals-other-percent">{percent}%</span>
      <span className={`goals-status-pill is-${status.tone}`}>{status.tone === "on-track" ? <span className="goals-status-dot" aria-hidden="true" /> : null}{status.label}</span>
      <ChevronRight className="goals-other-chevron" aria-hidden="true" size={20} />
    </span>
  </button>;
}

export interface GoalsManagerProps {
  readonly goals: readonly FinancialGoalView[];
  readonly plans: readonly FinancialGoalPlanView[];
  readonly destinationAccounts: readonly GoalPlanDestinationAccountView[];
  readonly sourceAccounts: readonly GoalPlanSourceAccountView[];
  readonly previews: GoalPlanPreviews;
  readonly todayIso: string;
  readonly readOnly: boolean;
}

export function GoalsManager({ goals, plans, destinationAccounts, sourceAccounts, previews, todayIso, readOnly }: GoalsManagerProps) {
  const [createState, createAction, createPending] = useActionState(createGoalAction, initialGoalActionState);
  const [showCreate, setShowCreate] = useState(!readOnly);
  const [showArchived, setShowArchived] = useState(false);
  const [goalView, setGoalView] = useState<GoalView>("all");
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const selectionRequestedRef = useRef(false);
  const featuredSectionRef = useRef<HTMLElement | null>(null);
  const [notification, setNotification] = useState<ActionNotificationState>({ ok: false, message: "" });
  const restoreFeedbackAction = useCallback(async (previousState: GoalActionState, formData: FormData): Promise<GoalActionState> => {
    const nextState = await restoreGoalAction(previousState, formData);
    if (nextState.message) setNotification(nextState);
    return nextState;
  }, []);
  const [, restoreAction, restorePending] = useActionState(restoreFeedbackAction, initialGoalActionState);
  const planByGoal = useMemo(() => new Map(plans.map((plan) => [plan.goalId, plan])), [plans]);
  const activeGoals = useMemo(() => goals.filter((goal) => goal.status !== "archived"), [goals]);
  const archivedGoals = useMemo(() => goals.filter((goal) => goal.status === "archived"), [goals]);
  const featuredGoal = activeGoals.find((goal) => goal.id === selectedGoalId) ?? activeGoals[0];
  const otherGoals = useMemo(() => sortGoals(activeGoals.filter((goal) => goal.id !== featuredGoal?.id)), [activeGoals, featuredGoal?.id]);
  const visibleOtherGoals = useMemo(() => otherGoals.filter((goal) => goalMatchesView(goal, planByGoal.get(goal.id), goalView)), [otherGoals, planByGoal, goalView]);
  const goalDetailProps = { destinationAccounts, sourceAccounts, todayIso, readOnly, onActionResult: setNotification };
  const [fetchedPreviews, setFetchedPreviews] = useState<GoalPlanPreviews>({});
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const previewRequestsRef = useRef(new Map<string, Promise<void>>());
  const failedPreviewIdsRef = useRef(new Set<string>());
  const featuredPreviews = featuredGoal ? previews[featuredGoal.id] ?? fetchedPreviews[featuredGoal.id] : undefined;
  const previewsPending = featuredGoal ? featuredPreviews === undefined && previewLoadingId === featuredGoal.id : false;
  const loadGoalPreviews = useCallback((goalId: string) => {
    if (previewRequestsRef.current.has(goalId)) return;
    failedPreviewIdsRef.current.delete(goalId);
    setPreviewLoadingId(goalId);
    const request = goalPlanPreviewsAction(goalId).then((result) => {
      if (result.ok) {
        setFetchedPreviews((current) => ({ ...current, [goalId]: result.previews }));
      } else {
        failedPreviewIdsRef.current.add(goalId);
        setNotification({ ok: false, message: result.message });
      }
      setPreviewLoadingId((current) => (current === goalId ? null : current));
    }).catch(() => {
      failedPreviewIdsRef.current.add(goalId);
      setNotification({ ok: false, message: "We couldn't calculate the goal plan preview. Try again." });
      setPreviewLoadingId((current) => (current === goalId ? null : current));
    }).finally(() => {
      previewRequestsRef.current.delete(goalId);
    });
    previewRequestsRef.current.set(goalId, request);
  }, []);
  useEffect(() => {
    if (!selectionRequestedRef.current) return;
    selectionRequestedRef.current = false;
    featuredSectionRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [selectedGoalId]);
  useEffect(() => {
    if (readOnly || !featuredGoal || featuredPreviews !== undefined || previewLoadingId === featuredGoal.id || failedPreviewIdsRef.current.has(featuredGoal.id)) return;
    loadGoalPreviews(featuredGoal.id);
  }, [readOnly, featuredGoal, featuredPreviews, previewLoadingId, loadGoalPreviews]);
  const selectGoal = (goalId: string) => {
    selectionRequestedRef.current = true;
    if (!readOnly && previews[goalId] === undefined && fetchedPreviews[goalId] === undefined) {
      failedPreviewIdsRef.current.delete(goalId);
      loadGoalPreviews(goalId);
    }
    setSelectedGoalId(goalId);
  };
  return <div className="goals-workspace">
    {readOnly ? <div className="goals-read-only-notice" role="status"><strong>Shared demo workspace</strong><span>Goals can be viewed here but cannot be changed.</span></div> : <section className="card section-card goals-create-card" aria-labelledby="goals-create-heading"><div className="goals-create-head"><span className="goals-create-icon"><Plus aria-hidden="true" size={30} strokeWidth={1.7} /></span><div className="goals-create-heading"><h3 id="goals-create-heading">Add a goal</h3><p>Set a target, track funding, and keep the plan visible.</p></div><div className="goals-create-actions">{showCreate ? <><button className="navy-action-button" type="submit" form="goals-create-form" disabled={createPending}>{createPending ? "Saving…" : "Save goal"}</button><button className="account-secondary-button" type="button" onClick={() => setShowCreate(false)}>Cancel</button></> : <button className="account-secondary-button" type="button" onClick={() => setShowCreate(true)} aria-expanded={showCreate}><Plus aria-hidden="true" size={15} /> New goal</button>}</div></div>{showCreate ? <form id="goals-create-form" action={createAction} className="goals-create-form"><GoalFormFields state={createState} /><button className="goals-form-submit-fallback" type="submit" aria-hidden="true" tabIndex={-1}>Save goal</button>{createState.message && !createState.ok ? <p className="goals-message" role="alert">{createState.message}</p> : null}</form> : null}</section>}
    {featuredGoal ? <section ref={featuredSectionRef} className="goals-dashboard" aria-label="Active goals overview"><div className="goals-feature-column"><GoalCard key={featuredGoal.id} {...goalDetailProps} goal={featuredGoal} plan={planByGoal.get(featuredGoal.id)} previews={featuredPreviews ?? []} previewsPending={previewsPending} featured /></div><aside className="goals-side-column"><GoalsOverviewCard goals={activeGoals} /><GoalsPromoCard /></aside></section> : null}
    {otherGoals.length > 0 ? <section className="card section-card goals-other-card" aria-labelledby="goals-other-heading"><div className="goals-other-head"><h2 id="goals-other-heading">All goals</h2><label className="goals-other-view"><span>View:</span><InvestmentDropdown value={goalView} options={goalViewOptions} onChange={(value) => setGoalView(value as GoalView)} aria-label="Filter goals" floating floatingMinWidth={180} /></label></div><div className="goals-other-list">{visibleOtherGoals.length > 0 ? visibleOtherGoals.map((goal) => <GoalOtherRow key={goal.id} goal={goal} plan={planByGoal.get(goal.id)} onSelectGoal={selectGoal} />) : <p className="goals-other-empty">No goals match this view.</p>}</div></section> : null}
    {archivedGoals.length > 0 ? <section className="goals-archived-section" aria-label="Archived goals"><button className="goals-archived-toggle" type="button" aria-expanded={showArchived} onClick={() => setShowArchived((current) => !current)}><Archive aria-hidden="true" size={15} /> Archived goals ({archivedGoals.length})</button>{showArchived ? <div className="section-grid goals-grid goals-grid--archived">{archivedGoals.map((goal) => <article className="card section-card goals-card goals-card--archived" key={goal.id}><div className="card-head"><div><h3 className="card-title">{goal.name}</h3><p className="card-subtitle">{targetLabel(goal)} · Archived</p></div><span className="period-date">{goal.targetMinor > 0 ? Math.min(100, Math.round(goal.currentMinor * 100 / goal.targetMinor)) : 0}%</span></div><div className="progress" style={{ marginTop: 28 }}><span className="gold" style={{ width: `${goal.targetMinor > 0 ? Math.min(100, Math.round(goal.currentMinor * 100 / goal.targetMinor)) : 0}%` }} /></div><div className="insight"><strong>{formatCadMinor(goal.currentMinor)} funded</strong> of a {formatCadMinor(goal.targetMinor)} target.</div><form action={restoreAction} className="goals-inline-action"><input type="hidden" name="id" value={goal.id} /><button className="account-secondary-button" type="submit" disabled={restorePending}><ArchiveRestore aria-hidden="true" size={14} /> Restore</button></form></article>)}</div> : null}</section> : null}
    <ActionNotification state={notification} />
  </div>;
}
