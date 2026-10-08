"use client";

import { useActionState, useEffect, useState, type FormEvent } from "react";
import type { HomeHouseholdCashFlowLinkView, HomeHouseholdFrequency } from "@athena/database";
import { createHomeHouseholdCashFlowSeriesAction, syncHomeHouseholdCashFlowAmountAction } from "./cash-flow-actions";
import { initialHouseholdExpenseActionState } from "./expense-state";
import { FormDropdown } from "../components/form-dropdown";
import { InvestmentDropdown, type InvestmentDropdownOption } from "../investments/investment-dropdown";
import { ActionNotification } from "../components/action-notification";
import { formatMoneyInputMinor, formatMoneyMinor } from "../../lib/format-money";

export interface AccountOption {
  readonly id: string;
  readonly name: string;
  readonly institution: string;
}

export interface HouseholdCashFlowCardsProps {
  readonly monthlyMinor: number;
  readonly biweeklyMinor: number;
  readonly links: readonly HomeHouseholdCashFlowLinkView[];
  readonly accounts: readonly AccountOption[];
  readonly todayIso: string;
}

const dollars = (minor: number) => formatMoneyMinor(minor);

const kindOptions: readonly InvestmentDropdownOption<"expense" | "transfer">[] = [
  { value: "transfer", label: "Transfer (can count as spending)" },
  { value: "expense", label: "Expense" },
];

const weekdayOptions: readonly InvestmentDropdownOption[] = [
  { value: "none", label: "Keep anchor weekday" },
  { value: "next_weekday", label: "Move weekends forward" },
  { value: "previous_weekday", label: "Move weekends back" },
];

function linkFor(links: readonly HomeHouseholdCashFlowLinkView[], frequency: HomeHouseholdFrequency) {
  return links.find((link) => link.frequency === frequency) ?? null;
}

function Message({ ok, message }: { readonly ok: boolean; readonly message: string }) {
  if (!message) return null;
  return <p className={`cash-flow-action-message ${ok ? "is-success" : "is-error"}`} role={ok ? "status" : "alert"}>{message}</p>;
}

function AddDialog({
  frequency,
  amountMinor,
  accounts,
  todayIso,
  onClose,
}: {
  readonly frequency: HomeHouseholdFrequency;
  readonly amountMinor: number;
  readonly accounts: readonly AccountOption[];
  readonly todayIso: string;
  readonly onClose: () => void;
}) {
  const [kind, setKind] = useState<"expense" | "transfer">("transfer");
  const [state, action, pending] = useActionState(createHomeHouseholdCashFlowSeriesAction, initialHouseholdExpenseActionState);
  const label = frequency === "biweekly" ? "Bi-weekly" : "Monthly";
  const defaultName = frequency === "biweekly" ? "Household costs (bi-weekly)" : "Household costs (monthly)";
  const accountOptions = (placeholder: string): readonly InvestmentDropdownOption[] => [
    { value: "", label: placeholder },
    ...accounts.map((account) => ({ value: account.id, label: `${account.name} · ${account.institution}` })),
  ];

  useEffect(() => {
    if (state.ok && state.message) onClose();
  }, [state.ok, state.message, onClose]);

  return (
    <div className="cash-flow-record-backdrop" role="presentation" onClick={onClose}>
      <form
        className="cash-flow-record-modal"
        action={action}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          if (pending) event.preventDefault();
        }}
      >
        <div className="cash-flow-record-modal-head">
          <div>
            <p className="eyebrow">Home → Cash Flow</p>
            <h3>Add {label.toLowerCase()} household total</h3>
          </div>
          <button className="account-secondary-button" type="button" onClick={onClose}>Close</button>
        </div>
        <input type="hidden" name="confirm" value="true" />
        <input type="hidden" name="homeHouseholdFrequency" value={frequency} />
        <input type="hidden" name="frequency" value={frequency} />
        <div className="cash-flow-record-form-grid">
          <label>Name<input name="name" required maxLength={240} defaultValue={defaultName} /></label>
          <label>Amount<input name="amount" type="number" min="0.01" step="0.01" required defaultValue={formatMoneyInputMinor(amountMinor)} /></label>
          <label>Type
            <InvestmentDropdown name="kind" value={kind} options={kindOptions} onChange={(value) => setKind(value)} floating floatingMinWidth={280} />
          </label>
          <label>Weekday rule
            <FormDropdown name="weekdayAdjustment" defaultValue="none" options={weekdayOptions} floatingMinWidth={280} />
          </label>
          <label>Start / first occurrence<input name="startsOn" type="date" required defaultValue={todayIso} /></label>
          <label>Next occurrence<input name="nextOccurrenceOn" type="date" required defaultValue={todayIso} /></label>
          {kind === "transfer" ? (
            <>
              <label>From account
                <FormDropdown name="fromAccountId" defaultValue="" options={accountOptions("Choose source")} floatingMinWidth={320} />
              </label>
              <label>To account
                <FormDropdown name="toAccountId" defaultValue="" options={accountOptions("Choose destination")} floatingMinWidth={320} />
              </label>
              <label className="cash-flow-record-field-wide recurring-delete-confirmation">
                <input name="countsAsExpense" type="checkbox" value="true" defaultChecked />
                <span>Count as spending in Cash Flow (still a transfer for balances)</span>
              </label>
              <input type="hidden" name="accountId" value="" />
            </>
          ) : (
            <>
              <label>Account
                <FormDropdown name="accountId" defaultValue="" options={accountOptions("Choose account")} floatingMinWidth={320} />
              </label>
              <input type="hidden" name="fromAccountId" value="" />
              <input type="hidden" name="toAccountId" value="" />
            </>
          )}
          <label className="cash-flow-record-field-wide">Note<textarea name="note" maxLength={500} rows={2} placeholder="Optional" /></label>
        </div>
        <div className="cash-flow-record-modal-actions">
          <button className="account-primary-button" type="submit" disabled={pending}>{pending ? "Adding…" : "Add to Cash Flow"}</button>
          <button className="account-secondary-button" type="button" onClick={onClose}>Cancel</button>
        </div>
        <Message ok={state.ok} message={state.message} />
      </form>
    </div>
  );
}

export interface HouseholdCashFlowControlsProps {
  readonly frequency: HomeHouseholdFrequency;
  readonly amountMinor: number;
  readonly link: HomeHouseholdCashFlowLinkView | null;
  readonly anyHouseholdLinked: boolean;
  readonly accounts: readonly AccountOption[];
  readonly todayIso: string;
  readonly compact?: boolean;
}

export function HouseholdCashFlowControls({
  frequency,
  amountMinor,
  link,
  anyHouseholdLinked,
  accounts,
  todayIso,
  compact = false,
}: HouseholdCashFlowControlsProps) {
  const [open, setOpen] = useState(false);
  const [syncState, syncAction, syncPending] = useActionState(syncHomeHouseholdCashFlowAmountAction, initialHouseholdExpenseActionState);
  const amountDrift = link !== null && link.amountMinor !== amountMinor && link.seriesState !== "ended";
  const linked = Boolean(link && link.seriesState !== "ended");
  // Only one household total may be pushed to Cash Flow (bi-weekly or monthly), not both.
  const canAdd = !linked && !anyHouseholdLinked;
  const action = linked ? (
    <a
      className={compact ? "timeline-status-badge is-actual household-cash-flow-badge household-cash-flow-badge-link" : "account-secondary-button"}
      href={`/cash-flow/recurring#recurring-series-${link!.seriesId}`}
      title={compact ? link!.name : undefined}
    >
      {compact ? "In Cash Flow" : "Manage series"}
    </a>
  ) : canAdd ? (
    <button className="account-secondary-button" type="button" onClick={() => setOpen(true)}>Add to Cash Flow</button>
  ) : (
    <p className="household-cash-flow-locked">Household total already linked on the other card.</p>
  );
  const updateForm = amountDrift ? (
    <form className="household-cash-flow-sync-form" action={syncAction}>
      <input type="hidden" name="confirm" value="true" />
      <input type="hidden" name="homeHouseholdFrequency" value={frequency} />
      <input type="hidden" name="amount" value={formatMoneyInputMinor(amountMinor)} />
      <button className="account-primary-button" type="submit" disabled={syncPending}>
        {syncPending ? "Updating…" : `Update to ${dollars(amountMinor)}`}
      </button>
    </form>
  ) : null;

  return <>
    {compact ? (
      <div className="household-cash-flow-hero-action">{action}</div>
    ) : (
      <div className="household-cash-flow-metric-actions">{action}</div>
    )}
    {amountDrift ? (
      <div className={`household-cash-flow-sync-notice${compact ? " is-compact" : ""}`} role="note" aria-label="Cash Flow amount update available">
        <div className="household-cash-flow-sync-copy">
          <span className="household-cash-flow-sync-title">Cash Flow needs an update</span>
          <p><span>Home total</span> <span className="household-cash-flow-sync-amount">{dollars(amountMinor)}</span><span aria-hidden="true"> · </span><span>Cash Flow</span> <span className="household-cash-flow-sync-amount">{dollars(link!.amountMinor)}</span></p>
          <span className="household-cash-flow-sync-description">Updates current and future occurrences.</span>
        </div>
        {updateForm}
      </div>
    ) : null}
    <ActionNotification state={syncState} />
    {open ? <AddDialog frequency={frequency} amountMinor={amountMinor} accounts={accounts} todayIso={todayIso} onClose={() => setOpen(false)} /> : null}
  </>;
}

function MetricCard({
  frequency,
  title,
  amountMinor,
  trend,
  link,
  anyHouseholdLinked,
  accounts,
  todayIso,
}: {
  readonly frequency: HomeHouseholdFrequency;
  readonly title: string;
  readonly amountMinor: number;
  readonly trend: string;
  readonly link: HomeHouseholdCashFlowLinkView | null;
  /** True when either monthly or bi-weekly household total is already linked. */
  readonly anyHouseholdLinked: boolean;
  readonly accounts: readonly AccountOption[];
  readonly todayIso: string;
}) {
  const linked = Boolean(link && link.seriesState !== "ended");

  return (
    <article className="card metric household-cash-flow-metric">
      <div className="household-cash-flow-metric-head">
        <div className="metric-label">{title}</div>
        {linked ? <span className="timeline-status-badge is-actual household-cash-flow-badge" title={link!.name}>In Cash Flow</span> : null}
      </div>
      <strong className="metric-value">{dollars(amountMinor)}</strong>
      <div className="metric-trend">{trend}</div>
      <HouseholdCashFlowControls
        frequency={frequency}
        amountMinor={amountMinor}
        link={link}
        anyHouseholdLinked={anyHouseholdLinked}
        accounts={accounts}
        todayIso={todayIso}
      />
    </article>
  );
}

export function HouseholdCashFlowCards({ monthlyMinor, biweeklyMinor, links, accounts, todayIso }: HouseholdCashFlowCardsProps) {
  const anyHouseholdLinked = links.some((link) => link.seriesState !== "ended");
  return (
    <>
      <MetricCard
        frequency="monthly"
        title="Monthly household costs"
        amountMinor={monthlyMinor}
        trend="Recurring costs plus one maintenance reserve"
        link={linkFor(links, "monthly")}
        anyHouseholdLinked={anyHouseholdLinked}
        accounts={accounts}
        todayIso={todayIso}
      />
      <MetricCard
        frequency="biweekly"
        title="Bi-weekly household costs"
        amountMinor={biweeklyMinor}
        trend="Annual costs spread across 26 pay periods"
        link={linkFor(links, "biweekly")}
        anyHouseholdLinked={anyHouseholdLinked}
        accounts={accounts}
        todayIso={todayIso}
      />
    </>
  );
}
