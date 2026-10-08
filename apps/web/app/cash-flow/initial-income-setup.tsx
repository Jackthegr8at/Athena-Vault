"use client";

import { useActionState, useState } from "react";
import { createInitialCashFlowIncomeAction } from "./recurring-actions";
import { initialCashFlowActionState } from "./action-helpers";
import { InvestmentDropdown, type InvestmentDropdownOption } from "../investments/investment-dropdown";

interface InitialIncomeAccountOption {
  readonly id: string;
  readonly label: string;
}

interface InitialIncomeSetupProps {
  readonly accountOptions: readonly InitialIncomeAccountOption[];
  readonly todayIso: string;
  readonly defaultThroughDate: string;
  readonly hasExistingTimeline: boolean;
}

type InitialIncomeForm = {
  readonly name: string;
  readonly accountId: string;
  readonly amount: string;
  readonly frequency: "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";
  readonly startsOn: string;
  readonly throughDate: string;
  readonly note: string;
};

const frequencies: InitialIncomeForm["frequency"][] = ["weekly", "biweekly", "monthly", "quarterly", "annual"];

const frequencyDropdownOptions: readonly InvestmentDropdownOption<InitialIncomeForm["frequency"]>[] = frequencies.map((frequency) => ({ value: frequency, label: frequency }));

function addDays(value: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function InitialCashFlowIncomeSetup({ accountOptions, todayIso, defaultThroughDate, hasExistingTimeline }: InitialIncomeSetupProps) {
  const [state, action, pending] = useActionState(createInitialCashFlowIncomeAction, initialCashFlowActionState);
  const [form, setForm] = useState<InitialIncomeForm>({
    name: "",
    accountId: accountOptions[0]?.id ?? "",
    amount: "",
    frequency: "biweekly",
    startsOn: todayIso,
    throughDate: defaultThroughDate,
    note: "",
  });
  const updateField = <K extends keyof InitialIncomeForm>(field: K, value: InitialIncomeForm[K]): void => {
    setForm((current) => ({ ...current, [field]: value }));
  };
  const accountDropdownOptions: readonly InvestmentDropdownOption[] = [
    { value: "", label: "Choose an account", disabled: true },
    ...accountOptions.map((account) => ({ value: account.id, label: account.label })),
  ];

  return <form className="cash-flow-initial-income-form" action={action}>
    <div className="cash-flow-initial-income-fields">
      <label htmlFor="cash-flow-income-name">Income name
        <input id="cash-flow-income-name" name="name" type="text" maxLength={240} placeholder="Paycheque or salary" value={form.name} onChange={(event) => updateField("name", event.target.value)} required />
      </label>
      <label htmlFor="cash-flow-income-account">Deposit account
        <InvestmentDropdown id="cash-flow-income-account" name="accountId" value={form.accountId} onChange={(value) => updateField("accountId", value)} options={accountDropdownOptions} floating floatingMinWidth={300} aria-required />
      </label>
      <label htmlFor="cash-flow-income-amount">Amount (CAD)
        <input id="cash-flow-income-amount" name="amount" type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="0.00" value={form.amount} onChange={(event) => updateField("amount", event.target.value)} required />
      </label>
      <label htmlFor="cash-flow-income-frequency">Frequency
        <InvestmentDropdown id="cash-flow-income-frequency" name="frequency" value={form.frequency} onChange={(value) => updateField("frequency", value)} options={frequencyDropdownOptions} floating floatingMinWidth={220} />
      </label>
      <label htmlFor="cash-flow-income-starts-on">First payday
        <input id="cash-flow-income-starts-on" name="startsOn" type="date" value={form.startsOn} onChange={(event) => {
          const startsOn = event.target.value;
          setForm((current) => ({ ...current, startsOn, throughDate: current.throughDate < startsOn ? addDays(startsOn, 364) : current.throughDate }));
        }} required />
      </label>
      <label htmlFor="cash-flow-income-through-date">Plan through
        <input id="cash-flow-income-through-date" name="throughDate" type="date" value={form.throughDate} onChange={(event) => updateField("throughDate", event.target.value)} required />
      </label>
      <label className="cash-flow-initial-income-field-wide" htmlFor="cash-flow-income-note">Note (optional)
        <textarea id="cash-flow-income-note" name="note" maxLength={500} rows={2} placeholder="For example, regular take-home pay" value={form.note} onChange={(event) => updateField("note", event.target.value)} />
      </label>
    </div>
    <p className="cash-flow-initial-income-help">{hasExistingTimeline ? "This adds the recurring income to the existing Cash Flow periods and generates planned occurrences automatically." : "This creates the Cash Flow periods and generates planned income occurrences automatically."} It does not add sample data or a starting balance.</p>
    <button className="account-primary-button" type="submit" disabled={pending}>{pending ? "Creating…" : "Create income and Cash Flow"}</button>
    {state.message ? <p className={`cash-flow-action-message ${state.ok ? "is-success" : "is-error"}`} role={state.ok ? "status" : "alert"}>{state.message}</p> : null}
  </form>;
}
