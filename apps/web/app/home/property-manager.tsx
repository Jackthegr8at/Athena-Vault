"use client";

import { startTransition, useActionState, useCallback, useState } from "react";
import type { HomeTimelineRow, HomeView, HouseholdExpenseView } from "@athena/database";
import { MoreHorizontal, Plus } from "lucide-react";
import {
  createHomeAction,
  deleteHomeValueAction,
  deleteMortgageAnchorAction,
  saveMortgageTermsAction,
  upsertHomeValueAction,
  upsertMortgageAnchorAction,
} from "./property-actions";
import { initialPropertyActionState, type PropertyActionState } from "./property-state";
import { HomeMobileDisclosure } from "./home-mobile-disclosure";
import { HomeMobileSubdisclosure } from "./home-mobile-subdisclosure";
import { ActionNotification } from "../components/action-notification";
import { FormDropdown } from "../components/form-dropdown";
import { type InvestmentDropdownOption } from "../investments/investment-dropdown";
import { ModuleFirstUseCard } from "../components/module-first-use-card";
import { ConfirmationDialog } from "../components/confirmation-dialog";
import { formatMoneyInputMinor, formatMoneyMinor } from "../../lib/format-money";

type PaymentExpenseOption = Pick<HouseholdExpenseView, "id" | "name" | "amountMinor">;

export interface HomePropertyManagerProps {
  readonly home: HomeView | null;
  readonly paymentExpenses: readonly PaymentExpenseOption[];
  readonly todayIso: string;
  readonly firstUse?: boolean;
}

function dollars(minor: number | null): string {
  return formatMoneyMinor(minor, { unavailableLabel: "—" });
}

function amountInput(minor: number | null): string {
  if (minor === null) return "";
  return formatMoneyInputMinor(minor);
}

function rateInput(annualRateBps: number): string {
  return `${Math.floor(annualRateBps / 100)}.${String(annualRateBps % 100).padStart(2, "0")}`;
}

function displayDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

const compoundingOptions: readonly InvestmentDropdownOption[] = [
  { value: "", label: "Select contract convention", disabled: true },
  { value: "canadian_semi_annual", label: "Canadian nominal, semi-annual" },
  { value: "annual", label: "Nominal, annual" },
  { value: "monthly", label: "Nominal, monthly" },
];

function statusLabel(status: HomeTimelineRow["mortgageStatus"]): string {
  if (status === "actual") return "Actual";
  if (status === "estimated") return "Estimated";
  if (status === "projected") return "Projected";
  return "No balance";
}

function ActionMessage({ state }: { readonly state: PropertyActionState }) {
  if (!state.message) return null;
  return <p className={`maintenance-message ${state.ok ? "is-success" : "is-error"}`} role={state.ok ? "status" : "alert"} aria-live="polite">{state.message}</p>;
}

function FieldError({ id, message }: { readonly id: string; readonly message?: string }) {
  return message ? <p className="maintenance-field-error" id={id} role="alert">{message}</p> : null;
}

function FieldLabel({ htmlFor, text, help }: { readonly htmlFor: string; readonly text: string; readonly help: string }) {
  return <label htmlFor={htmlFor}><span>{text}</span><span className="field-help" title={help} tabIndex={0} aria-label={`${text}: ${help}`}>!</span></label>;
}

function HomeEmptyState({ firstUse = false }: { readonly firstUse?: boolean }) {
  const [state, action, pending] = useActionState(createHomeAction, initialPropertyActionState);
  if (firstUse) {
    return <ModuleFirstUseCard
      headingId="home-first-use-heading"
      title="Bring your home picture into focus"
      description="Create the Home profile first. Then add a confirmed property value or mortgage terms when you are ready."
      secondaryHref="/"
      secondaryLabel="Back to overview"
      supportingText="Home profile → property value → mortgage details"
      seed="home-first-use"
    >
      <form action={action} className="module-first-use-form">
        <button className="account-primary-button" type="submit" disabled={pending}>{pending ? "Creating…" : "Create Home profile"}<span aria-hidden="true">→</span></button>
        {state.message ? <p className={`maintenance-message ${state.ok ? "is-success" : "is-error"}`} role={state.ok ? "status" : "alert"}>{state.message}</p> : null}
      </form>
    </ModuleFirstUseCard>;
  }
  return <section className="card section-card home-property-card" aria-labelledby="home-profile-heading">
    <div className="card-head">
      <div>
        <h2 className="card-title" id="home-profile-heading">Home property</h2>
        <p className="card-subtitle">No property record exists yet. Create the empty Home profile, then add confirmed values and mortgage terms.</p>
      </div>
    </div>
    <form action={action} className="maintenance-form-actions home-property-create-form">
      <button className="maintenance-primary-button" type="submit" disabled={pending}>{pending ? "Creating…" : "Create Home profile"}</button>
      <ActionMessage state={state} />
    </form>
  </section>;
}

function HomeValueEditor({
  home,
  todayIso,
  editingDate,
  onEditingDateChange,
}: {
  readonly home: HomeView;
  readonly todayIso: string;
  readonly editingDate: string | null;
  readonly onEditingDateChange: (date: string | null) => void;
}) {
  const [formVersion, setFormVersion] = useState(0);
  const saveValueFeedbackAction = useCallback(async (previousState: PropertyActionState, formData: FormData): Promise<PropertyActionState> => {
    const nextState = await upsertHomeValueAction(previousState, formData);
    if (nextState.ok) {
      onEditingDateChange(null);
      setFormVersion((version) => version + 1);
    }
    return nextState;
  }, [onEditingDateChange]);
  const deleteValueFeedbackAction = useCallback(async (previousState: PropertyActionState, formData: FormData): Promise<PropertyActionState> => {
    const nextState = await deleteHomeValueAction(previousState, formData);
    if (nextState.ok) {
      onEditingDateChange(null);
      setFormVersion((version) => version + 1);
    }
    return nextState;
  }, [onEditingDateChange]);
  const [state, action, pending] = useActionState(saveValueFeedbackAction, initialPropertyActionState);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteValueFeedbackAction, initialPropertyActionState);
  const [removeAsOf, setRemoveAsOf] = useState<string | null>(null);
  const activeEditingDate = home.values.find((value) => value.asOf === editingDate)?.asOf ?? null;
  const editingValue = activeEditingDate ? home.values.find((value) => value.asOf === activeEditingDate) ?? null : null;

  const confirmRemove = () => {
    if (!removeAsOf) return;
    const formData = new FormData();
    formData.set("asOf", removeAsOf);
    setRemoveAsOf(null);
    startTransition(() => deleteAction(formData));
  };

  return <section className="card section-card home-property-card home-property-history-card" aria-labelledby="home-values-heading">
    <div className="card-head">
      <div>
        <h2 className="card-title" id="home-values-heading">Property value history</h2>
        <p className="card-subtitle">Enter a confirmed market value at any date. The latest value carries forward until another value is entered.</p>
      </div>
      <span className="period-date">{home.values.length} saved</span>
    </div>
    <HomeMobileSubdisclosure
      eyebrow="Manage"
      title={editingValue ? "Edit market value" : "Add market value"}
      meta={editingValue ? displayDate(editingValue.asOf) : "New value"}
      defaultOpen={Boolean(editingValue)}
    >
    <div className="maintenance-form-panel">
      <form key={`${activeEditingDate ?? "new"}-${formVersion}`} action={action} className="maintenance-form">
        <div className="maintenance-form-fields home-property-form-fields">
          <div className="maintenance-field">
            <label htmlFor="home-value-date">As of</label>
            <input id="home-value-date" name="asOf" type="date" required defaultValue={activeEditingDate ?? todayIso} aria-describedby={state.fieldErrors.asOf ? "home-value-date-error" : undefined} />
            <FieldError id="home-value-date-error" message={state.fieldErrors.asOf} />
          </div>
          <div className="maintenance-field">
            <label htmlFor="home-market-value">Market value (CAD)</label>
            <input id="home-market-value" name="marketValue" type="text" inputMode="decimal" pattern="^\d+(\.\d{1,2})?$" placeholder="0.00" required defaultValue={amountInput(editingValue?.marketValueMinor ?? null)} aria-describedby={state.fieldErrors.marketValue ? "home-market-value-error" : undefined} />
            <FieldError id="home-market-value-error" message={state.fieldErrors.marketValue} />
          </div>
          <div className="maintenance-form-actions home-inline-form-actions">
            <button className="maintenance-primary-button" type="submit" disabled={pending}>{pending ? "Saving…" : editingValue ? "Save value" : "Add value"}</button>
            {editingValue ? <button className="maintenance-secondary-button" type="button" onClick={() => onEditingDateChange(null)} disabled={pending}>Cancel</button> : null}
          </div>
        </div>
        <ActionMessage state={state} />
      </form>
    </div>
    </HomeMobileSubdisclosure>
    {home.values.length > 0 ? <div className="maintenance-table-wrap home-history-table-wrap">
      <table className="maintenance-table home-history-table">
        <caption className="sr-only">Saved property market values</caption>
        <thead><tr><th scope="col">As of</th><th scope="col">Market value</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{home.values.map((value) => <tr key={value.id}>
          <th scope="row" data-label="As of">{displayDate(value.asOf)}</th>
          <td data-label="Market value">{dollars(value.marketValueMinor)}</td>
          <td data-label="Actions"><div className="maintenance-row-actions">
            <button className="maintenance-secondary-button" type="button" onClick={() => onEditingDateChange(value.asOf)} disabled={pending || deletePending}>Edit</button>
            <button className="maintenance-danger-button" type="button" disabled={pending || deletePending} aria-haspopup="dialog" aria-expanded={removeAsOf === value.asOf} onClick={() => setRemoveAsOf(value.asOf)}>{deletePending ? "Removing…" : "Remove"}</button>
          </div></td>
        </tr>)}</tbody>
      </table>
    </div> : <div className="maintenance-empty">No confirmed market values yet.</div>}
    <ActionNotification state={deleteState} />
    {removeAsOf ? <ConfirmationDialog
      open
      title={`Remove the property value for ${displayDate(removeAsOf)}?`}
      description="The confirmed value will be removed from the Home history and projections."
      confirmLabel="Remove"
      tone="danger"
      pending={deletePending}
      onConfirm={confirmRemove}
      onCancel={() => setRemoveAsOf(null)}
    /> : null}
  </section>;
}

function MortgageTermsEditor({
  home,
  paymentExpenses,
  todayIso,
}: {
  readonly home: HomeView;
  readonly paymentExpenses: readonly PaymentExpenseOption[];
  readonly todayIso: string;
}) {
  const latestTerm = [...home.mortgageTerms].sort((left, right) => left.effectiveOn.localeCompare(right.effectiveOn)).at(-1) ?? null;
  const latestTermExpired = Boolean(latestTerm && latestTerm.payoffOn < todayIso);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showTermForm, setShowTermForm] = useState(home.mortgageTerms.length === 0 || latestTermExpired);
  const [formVersion, setFormVersion] = useState(0);
  const saveTermFeedbackAction = useCallback(async (previousState: PropertyActionState, formData: FormData): Promise<PropertyActionState> => {
    const nextState = await saveMortgageTermsAction(previousState, formData);
    if (nextState.ok) {
      setEditingId(null);
      setShowTermForm(false);
      setFormVersion((version) => version + 1);
    }
    return nextState;
  }, []);
  const [state, action, pending] = useActionState(saveTermFeedbackAction, initialPropertyActionState);
  const editingTerm = editingId ? home.mortgageTerms.find((term) => term.id === editingId) ?? null : null;
  const formVisible = showTermForm || Boolean(editingTerm);
  const preferredExpenseId = paymentExpenses.find((expense) => expense.name.trim().toLocaleLowerCase("en-CA") === "hypo")?.id ?? paymentExpenses[0]?.id ?? "";
  const paymentSourceOptions: readonly InvestmentDropdownOption[] = [
    { value: "", label: "Select payment source" },
    ...paymentExpenses.map((expense) => ({ value: expense.id, label: `${expense.name} — ${dollars(expense.amountMinor)} / biweekly` })),
  ];

  return <section className="card section-card home-property-card home-mortgage-settings-card" aria-labelledby="home-mortgage-settings-heading">
    <div className="card-head home-mortgage-card-head">
      <div>
        <h2 className="card-title" id="home-mortgage-settings-heading">Mortgage settings and terms</h2>
        <p className="card-subtitle">Terms are versioned by effective date. Select the existing biweekly household expense as the payment source; no cash-flow transaction is created here. When the payment source changes, save a new term version with the change date.</p>
      </div>
      <div className="home-mortgage-card-actions">
        {!formVisible ? <button className="navy-action-button" type="button" onClick={() => setShowTermForm(true)}><span className="navy-action-icon" aria-hidden="true"><Plus size={14} strokeWidth={2.5} /></span><span>Add new term</span></button> : null}
      </div>
    </div>
    {formVisible ? (
      <HomeMobileSubdisclosure eyebrow="Manage" title={editingTerm ? "Edit mortgage term" : "Add mortgage term"} meta="7 fields" defaultOpen>
        <div className="maintenance-form-panel">
          <form key={`${editingTerm?.id ?? "new"}-${formVersion}`} action={action} className="maintenance-form">
        {editingTerm ? <input type="hidden" name="id" value={editingTerm.id} /> : null}
        <div className="maintenance-form-fields home-property-form-fields home-property-form-fields-wide">
          <div className="maintenance-field">
            <FieldLabel htmlFor="mortgage-effective-on" text="Effective from" help="The date this mortgage term becomes active. Save a new term when the contract changes." />
            <input id="mortgage-effective-on" name="effectiveOn" type="date" required defaultValue={editingTerm?.effectiveOn ?? todayIso} aria-describedby={state.fieldErrors.effectiveOn ? "mortgage-effective-on-error" : undefined} />
            <FieldError id="mortgage-effective-on-error" message={state.fieldErrors.effectiveOn} />
          </div>
          <div className="maintenance-field">
            <FieldLabel htmlFor="mortgage-rate" text="Nominal annual rate (%)" help="The annual interest rate before applying the contract compounding convention." />
            <input id="mortgage-rate" name="annualRate" type="text" inputMode="decimal" pattern="^\d+(\.\d{1,2})?$" placeholder="5.49" required defaultValue={editingTerm ? rateInput(editingTerm.annualRateBps) : ""} aria-describedby={state.fieldErrors.annualRate ? "mortgage-rate-error" : undefined} />
            <FieldError id="mortgage-rate-error" message={state.fieldErrors.annualRate} />
          </div>
          <div className="maintenance-field">
            <FieldLabel htmlFor="mortgage-compounding" text="Contract compounding" help="How the lender compounds interest. This affects projected interest and principal." />
            <FormDropdown id="mortgage-compounding" name="compoundingConvention" defaultValue={editingTerm?.compoundingConvention ?? ""} options={compoundingOptions} describedBy={state.fieldErrors.compoundingConvention ? "mortgage-compounding-error" : undefined} invalid={Boolean(state.fieldErrors.compoundingConvention)} floatingMinWidth={280} />
            <FieldError id="mortgage-compounding-error" message={state.fieldErrors.compoundingConvention} />
          </div>
          <div className="maintenance-field">
            <FieldLabel htmlFor="mortgage-payment-source" text="Biweekly payment source" help="The recurring biweekly household expense used as the mortgage payment." />
            <FormDropdown id="mortgage-payment-source" name="paymentExpenseId" defaultValue={editingTerm?.paymentExpenseId ?? preferredExpenseId} options={paymentSourceOptions} describedBy={state.fieldErrors.paymentExpenseId ? "mortgage-payment-source-error" : undefined} invalid={Boolean(state.fieldErrors.paymentExpenseId)} floatingMinWidth={320} />
            <FieldError id="mortgage-payment-source-error" message={state.fieldErrors.paymentExpenseId} />
          </div>
          <div className="maintenance-field">
            <FieldLabel htmlFor="mortgage-next-payment" text="Next payment date" help="The next scheduled payment date used to begin the mortgage projection." />
            <input id="mortgage-next-payment" name="nextPaymentOn" type="date" required defaultValue={editingTerm?.nextPaymentOn ?? ""} aria-describedby={state.fieldErrors.nextPaymentOn ? "mortgage-next-payment-error" : undefined} />
            <FieldError id="mortgage-next-payment-error" message={state.fieldErrors.nextPaymentOn} />
          </div>
          <div className="maintenance-field">
            <FieldLabel htmlFor="mortgage-renewal" text="Renewal date" help="The date this mortgage term is scheduled for renewal." />
            <input id="mortgage-renewal" name="renewalOn" type="date" required defaultValue={editingTerm?.renewalOn ?? ""} aria-describedby={state.fieldErrors.renewalOn ? "mortgage-renewal-error" : undefined} />
            <FieldError id="mortgage-renewal-error" message={state.fieldErrors.renewalOn} />
          </div>
          <div className="maintenance-field">
            <FieldLabel htmlFor="mortgage-payoff" text="Remaining payoff date" help="The expected final payoff date used as the projection boundary." />
            <input id="mortgage-payoff" name="payoffOn" type="date" required defaultValue={editingTerm?.payoffOn ?? ""} aria-describedby={state.fieldErrors.payoffOn ? "mortgage-payoff-error" : undefined} />
            <FieldError id="mortgage-payoff-error" message={state.fieldErrors.payoffOn} />
          </div>
        </div>
        <div className="maintenance-form-actions">
          <button className="maintenance-primary-button" type="submit" disabled={pending || paymentExpenses.length === 0}>{pending ? "Saving…" : editingTerm ? "Save term changes" : "Save mortgage terms"}</button>
          <button className="maintenance-secondary-button" type="button" onClick={() => { setEditingId(null); setShowTermForm(false); }} disabled={pending}>Close form</button>
        </div>
        <ActionMessage state={state} />
          </form>
          {paymentExpenses.length === 0 ? <p className="home-property-note" role="note">Add or update an active household expense with biweekly frequency before saving mortgage terms.</p> : null}
        </div>
      </HomeMobileSubdisclosure>
    ) : null}
    {home.mortgageTerms.length > 0 ? <div className="maintenance-table-wrap home-history-table-wrap">
      <table className="maintenance-table home-history-table">
        <caption className="sr-only">Mortgage term versions</caption>
        <thead><tr><th scope="col">Effective</th><th scope="col">Rate / compounding</th><th scope="col">Payment source</th><th scope="col">Renewal</th><th scope="col">Payoff</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{home.mortgageTerms.map((term) => <tr key={term.id}>
          <th scope="row" data-label="Effective">{displayDate(term.effectiveOn)}</th>
          <td data-label="Rate / compounding">{rateInput(term.annualRateBps)}% · {term.compoundingConvention === "canadian_semi_annual" ? "Canadian semi-annual" : term.compoundingConvention}</td>
          <td data-label="Payment source">{term.paymentExpenseName} · {dollars(term.paymentMinor)} / biweekly</td>
          <td data-label="Renewal">{displayDate(term.renewalOn)}</td>
          <td data-label="Payoff">{displayDate(term.payoffOn)}</td>
          <td data-label="Actions"><button className="maintenance-secondary-button" type="button" onClick={() => { setEditingId(term.id); setShowTermForm(true); }} disabled={pending}>Edit</button></td>
        </tr>)}</tbody>
      </table>
    </div> : <div className="maintenance-empty">No mortgage terms saved yet.</div>}
  </section>;
}

function MortgageAnchorEditor({ home, todayIso, editingDate, onEditingDateChange }: { readonly home: HomeView; readonly todayIso: string; readonly editingDate: string | null; readonly onEditingDateChange: (date: string | null) => void }) {
  const [formVersion, setFormVersion] = useState(0);
  const saveAnchorFeedbackAction = useCallback(async (previousState: PropertyActionState, formData: FormData): Promise<PropertyActionState> => {
    const nextState = await upsertMortgageAnchorAction(previousState, formData);
    if (nextState.ok) {
      onEditingDateChange(null);
      setFormVersion((version) => version + 1);
    }
    return nextState;
  }, [onEditingDateChange]);
  const deleteAnchorFeedbackAction = useCallback(async (previousState: PropertyActionState, formData: FormData): Promise<PropertyActionState> => {
    const nextState = await deleteMortgageAnchorAction(previousState, formData);
    if (nextState.ok) {
      onEditingDateChange(null);
      setFormVersion((version) => version + 1);
    }
    return nextState;
  }, [onEditingDateChange]);
  const [state, action, pending] = useActionState(saveAnchorFeedbackAction, initialPropertyActionState);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteAnchorFeedbackAction, initialPropertyActionState);
  const [removeAsOf, setRemoveAsOf] = useState<string | null>(null);
  const activeEditingDate = home.mortgageAnchors.find((anchor) => anchor.asOf === editingDate)?.asOf ?? null;
  const editingAnchor = activeEditingDate ? home.mortgageAnchors.find((anchor) => anchor.asOf === activeEditingDate) ?? null : null;

  const confirmRemove = () => {
    if (!removeAsOf) return;
    const formData = new FormData();
    formData.set("asOf", removeAsOf);
    setRemoveAsOf(null);
    startTransition(() => deleteAction(formData));
  };

  return <section className="card section-card home-property-card home-mortgage-anchors-card" aria-labelledby="home-mortgage-anchors-heading">
    <div className="card-head">
      <div>
        <h2 className="card-title" id="home-mortgage-anchors-heading">Actual mortgage balances</h2>
        <p className="card-subtitle">Confirmed principal balances remain manual anchors for future projections. Future-dated values are rejected.</p>
      </div>
      <span className="period-date">{home.mortgageAnchors.length} confirmed</span>
    </div>
    <HomeMobileSubdisclosure
      eyebrow="Manage"
      title={editingAnchor ? "Edit confirmed balance" : "Add confirmed balance"}
      meta={editingAnchor ? displayDate(editingAnchor.asOf) : "New anchor"}
      defaultOpen={Boolean(editingAnchor)}
    >
    <div className="maintenance-form-panel">
      <form key={`${activeEditingDate ?? "new"}-${formVersion}`} action={action} className="maintenance-form">
        <div className="maintenance-form-fields home-property-form-fields">
          <div className="maintenance-field">
            <label htmlFor="mortgage-anchor-date">As of</label>
            <input id="mortgage-anchor-date" name="asOf" type="date" required max={todayIso} defaultValue={activeEditingDate ?? todayIso} aria-describedby={state.fieldErrors.asOf ? "mortgage-anchor-date-error" : undefined} />
            <FieldError id="mortgage-anchor-date-error" message={state.fieldErrors.asOf} />
          </div>
          <div className="maintenance-field">
            <label htmlFor="mortgage-principal">Confirmed principal (CAD)</label>
            <input id="mortgage-principal" name="principal" type="text" inputMode="decimal" pattern="^\d+(\.\d{1,2})?$" placeholder="0.00" required defaultValue={amountInput(editingAnchor?.principalMinor ?? null)} aria-describedby={state.fieldErrors.principal ? "mortgage-principal-error" : undefined} />
            <FieldError id="mortgage-principal-error" message={state.fieldErrors.principal} />
          </div>
          <div className="maintenance-form-actions home-inline-form-actions">
            <button className="maintenance-primary-button" type="submit" disabled={pending}>{pending ? "Saving…" : editingAnchor ? "Save anchor" : "Add anchor"}</button>
            {editingAnchor ? <button className="maintenance-secondary-button" type="button" onClick={() => onEditingDateChange(null)} disabled={pending}>Cancel</button> : null}
          </div>
        </div>
        <ActionMessage state={state} />
      </form>
    </div>
    </HomeMobileSubdisclosure>
    {home.mortgageAnchors.length > 0 ? <div className="maintenance-table-wrap home-history-table-wrap">
      <table className="maintenance-table home-history-table">
        <caption className="sr-only">Confirmed mortgage principal anchors</caption>
        <thead><tr><th scope="col">As of</th><th scope="col">Principal</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{home.mortgageAnchors.map((anchor) => <tr key={anchor.id}>
          <th scope="row" data-label="As of">{displayDate(anchor.asOf)}</th>
          <td data-label="Principal">{dollars(anchor.principalMinor)}</td>
          <td data-label="Actions"><div className="maintenance-row-actions">
            <button className="maintenance-secondary-button" type="button" onClick={() => onEditingDateChange(anchor.asOf)} disabled={pending || deletePending}>Edit</button>
            <button className="maintenance-danger-button" type="button" disabled={pending || deletePending} aria-haspopup="dialog" aria-expanded={removeAsOf === anchor.asOf} onClick={() => setRemoveAsOf(anchor.asOf)}>{deletePending ? "Removing…" : "Remove"}</button>
          </div></td>
        </tr>)}</tbody>
      </table>
    </div> : <div className="maintenance-empty">No confirmed mortgage balance yet. Add the manually verified principal balance to start projections.</div>}
    <ActionNotification state={deleteState} />
    {removeAsOf ? <ConfirmationDialog
      open
      title={`Remove the confirmed mortgage balance for ${displayDate(removeAsOf)}?`}
      description="The confirmed balance will be removed from the mortgage history and projections."
      confirmLabel="Remove"
      tone="danger"
      pending={deletePending}
      onConfirm={confirmRemove}
      onCancel={() => setRemoveAsOf(null)}
    /> : null}
  </section>;
}

function TimelineTable({ home, todayIso, onEditValue, onEditAnchor }: {
  readonly home: HomeView;
  readonly todayIso: string;
  readonly onEditValue: (row: HomeTimelineRow) => void;
  readonly onEditAnchor: (row: HomeTimelineRow) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [openActionDate, setOpenActionDate] = useState<string | null>(null);
  const valueAnchorDates = new Set(home.values.map((value) => value.asOf));
  const mortgageAnchorDates = new Set(home.mortgageAnchors.map((anchor) => anchor.asOf));
  const currentIndex = home.timeline.findIndex((row) => row.asOf >= todayIso);
  const recentStartIndex = Math.max(0, (currentIndex < 0 ? home.timeline.length : currentIndex) - 4);
  const yearEnd = `${todayIso.slice(0, 4)}-12-31`;
  const visibleRows = showAll
    ? home.timeline
    : home.timeline.slice(recentStartIndex).filter((row) => row.asOf <= yearEnd);
  return <section className="card section-card home-property-card" aria-labelledby="home-timeline-heading">
    <div className="card-head home-mortgage-card-head">
      <div>
        <h2 className="card-title" id="home-timeline-heading">Biweekly Home timeline</h2>
        <p className="card-subtitle">Market value carries forward. Mortgage rows derive from the previous balance, payment source, rate, and stated compounding convention.</p>
      </div>
      <div className="home-mortgage-card-actions">
        <span className="period-date">{showAll ? `${home.timeline.length} dates` : `${visibleRows.length} of ${home.timeline.length} dates`}</span>
        <button className="maintenance-secondary-button" type="button" onClick={() => setShowAll((value) => !value)} aria-expanded={showAll}>{showAll ? "Show recent" : "Show all"}</button>
      </div>
    </div>
    {home.timeline.length > 0 ? <div className="home-timeline-viewport">
      <table className="home-timeline-table is-fluid">
        <caption className="sr-only">Home market value, mortgage projection, and equity timeline</caption>
        <thead><tr><th scope="col" className="home-timeline-date-column">Date</th><th scope="col">Market value</th><th scope="col">Mortgage principal</th><th scope="col">Mortgage status</th><th scope="col">Payment</th><th scope="col">Interest</th><th scope="col">Principal portion</th><th scope="col">Home equity</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{visibleRows.map((row) => <tr key={row.asOf}>
          <th scope="row" data-label="Date" className="home-timeline-date-column">{displayDate(row.asOf)}<small>{row.asOf}</small></th>
          <td data-label="Market value"><span className="home-timeline-amount">{dollars(row.marketValueMinor)}</span><span className={`timeline-status-badge is-${row.marketValueStatus ?? "empty"}`}>{row.marketValueStatus === "actual" ? "Actual" : row.marketValueStatus === "projected" ? "Carried" : "No value"}</span></td>
          <td data-label="Mortgage principal">{dollars(row.mortgagePrincipalMinor)}</td>
          <td data-label="Mortgage status"><span className={`timeline-status-badge is-${row.mortgageStatus ?? "empty"}`}>{statusLabel(row.mortgageStatus)}</span></td>
          <td data-label="Payment">{dollars(row.paymentMinor)}</td>
          <td data-label="Interest">{dollars(row.interestMinor)}</td>
          <td data-label="Principal portion">{dollars(row.principalPortionMinor)}</td>
          <td data-label="Home equity" className="home-equity-cell">{dollars(row.equityMinor)}</td>
          <td data-label="Actions"><div className="home-timeline-actions">
            <div className="home-timeline-action-menu">
              <button className="maintenance-actions-button" type="button" onClick={() => setOpenActionDate((current) => current === row.asOf ? null : row.asOf)} aria-label={`More actions for ${displayDate(row.asOf)}`} aria-haspopup="menu" aria-expanded={openActionDate === row.asOf}>
                <MoreHorizontal aria-hidden="true" size={19} strokeWidth={2.1} />
              </button>
              {openActionDate === row.asOf ? <div className="home-timeline-action-popover" role="menu" aria-label={`Actions for ${displayDate(row.asOf)}`}>
                <button className="maintenance-action-menu-item" type="button" role="menuitem" onClick={() => { setOpenActionDate(null); onEditValue(row); }}>{valueAnchorDates.has(row.asOf) ? "Edit house value" : "Set house value"}</button>
                {row.mortgagePrincipalMinor !== null || home.mortgageConfigured ? <button className="maintenance-action-menu-item" type="button" role="menuitem" onClick={() => { setOpenActionDate(null); onEditAnchor(row); }}>{mortgageAnchorDates.has(row.asOf) ? "Edit mortgage balance" : "Confirm mortgage balance"}</button> : null}
              </div> : null}
            </div>
          </div></td>
        </tr>)}</tbody>
      </table>
    </div> : <div className="maintenance-empty">Add a property value or mortgage anchor to begin the biweekly timeline.</div>}
  </section>;
}

export function HomePropertyManager({ home, paymentExpenses, todayIso, firstUse = false }: HomePropertyManagerProps) {
  const [editingValueDate, setEditingValueDate] = useState<string | null>(null);
  const [editingAnchorDate, setEditingAnchorDate] = useState<string | null>(null);
  if (!home) return firstUse
    ? <HomeEmptyState firstUse />
    : <HomeMobileDisclosure id="home-property-details" eyebrow="Property" title="Home property" meta="Not configured"><HomeEmptyState /></HomeMobileDisclosure>;

  const editValueRow = (row: HomeTimelineRow) => {
    setEditingValueDate(row.asOf);
    const disclosure = document.getElementById("home-property-details");
    if (disclosure?.getAttribute("data-open") !== "true") {
      disclosure?.querySelector<HTMLButtonElement>(".home-mobile-disclosure-trigger")?.click();
    }
    window.setTimeout(() => document.getElementById("home-market-value")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  };
  const editAnchorRow = (row: HomeTimelineRow) => {
    setEditingAnchorDate(row.asOf);
    const disclosure = document.getElementById("home-mortgage-anchors");
    if (disclosure?.getAttribute("data-open") !== "true") {
      disclosure?.querySelector<HTMLButtonElement>(".home-mobile-disclosure-trigger")?.click();
    }
    window.setTimeout(() => document.getElementById("mortgage-principal")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  };

  return <>
    <HomeMobileDisclosure id="home-property-details" eyebrow="Property" title="Market value history" meta={`${home.values.length} saved`}>
      <HomeValueEditor home={home} todayIso={todayIso} editingDate={editingValueDate} onEditingDateChange={setEditingValueDate} />
    </HomeMobileDisclosure>
    <HomeMobileDisclosure eyebrow="Mortgage" title="Mortgage settings" meta={`${home.mortgageTerms.length} terms`}>
      <MortgageTermsEditor home={home} paymentExpenses={paymentExpenses} todayIso={todayIso} />
    </HomeMobileDisclosure>
    <HomeMobileDisclosure id="home-mortgage-anchors" eyebrow="Mortgage" title="Confirmed balances" meta={`${home.mortgageAnchors.length} anchors`}>
      <MortgageAnchorEditor home={home} todayIso={todayIso} editingDate={editingAnchorDate} onEditingDateChange={setEditingAnchorDate} />
    </HomeMobileDisclosure>
    <HomeMobileDisclosure eyebrow="Timeline" title="Biweekly Home timeline" meta={`${home.timeline.length} dates`}>
      <TimelineTable home={home} todayIso={todayIso} onEditValue={editValueRow} onEditAnchor={editAnchorRow} />
    </HomeMobileDisclosure>
  </>;
}
