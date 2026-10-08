"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { ArrowLeftRight, CalendarDays, DollarSign, Eye, Landmark, Pencil, RefreshCw, Sparkles, X, type LucideIcon } from "lucide-react";
import { createRecurringSeriesAction } from "./recurring-actions";
import { initialCashFlowActionState } from "./action-helpers";
import { InvestmentDropdown, type InvestmentDropdownOption } from "../investments/investment-dropdown";
import { FormDropdown } from "../components/form-dropdown";
import { ManagerMessage, frequencyLabel, type RecurringManagerAccountOption } from "./recurring-series-card";

const frequencies = ["weekly", "biweekly", "monthly", "quarterly", "annual"] as const;

const RECURRING_CREATE_OPEN_EVENT = "athena:open-recurring-create";

export const frequencyDropdownOptions: readonly InvestmentDropdownOption[] = frequencies.map((frequency) => ({ value: frequency, label: frequencyLabel(frequency) }));

const kindDropdownOptions: readonly InvestmentDropdownOption<"income" | "expense" | "transfer">[] = [
  { value: "income", label: "Income" },
  { value: "expense", label: "Expense" },
  { value: "transfer", label: "Transfer" },
];

const weekdayDropdownOptions: readonly InvestmentDropdownOption[] = [
  { value: "none", label: "Keep anchor weekday" },
  { value: "next_weekday", label: "Move weekends forward" },
  { value: "previous_weekday", label: "Move weekends back" },
];

export function AccountSelect({ name, value, options, required = false, onChange }: { readonly name: string; readonly value: string | null; readonly options: readonly RecurringManagerAccountOption[]; readonly required?: boolean; readonly onChange?: (value: string) => void }) {
  const dropdownOptions: readonly InvestmentDropdownOption[] = [
    { value: "", label: required ? "Choose an account" : "Base account" },
    ...options.map((account) => ({ value: account.id, label: account.label })),
  ];
  if (onChange) return <InvestmentDropdown name={name} value={value ?? ""} options={dropdownOptions} onChange={onChange} aria-required={required} floating floatingMinWidth={280} />;
  return <FormDropdown name={name} defaultValue={value ?? ""} options={dropdownOptions} required={required} floatingMinWidth={280} />;
}

export function WeekdaySelect({ value = "none", onChange }: { readonly value?: string; readonly onChange?: (value: string) => void }) {
  if (onChange) return <InvestmentDropdown name="weekdayAdjustment" value={value} options={weekdayDropdownOptions} onChange={onChange} floating floatingMinWidth={280} />;
  return <FormDropdown name="weekdayAdjustment" defaultValue={value} options={weekdayDropdownOptions} floatingMinWidth={280} />;
}

type RecurringCreateFormValues = {
  readonly name: string;
  readonly kind: "income" | "expense" | "transfer";
  readonly amount: string;
  readonly frequency: (typeof frequencies)[number];
  readonly weekdayAdjustment: "none" | "next_weekday" | "previous_weekday";
  readonly startsOn: string;
  readonly endsOn: string;
  readonly note: string;
  readonly accountId: string;
  readonly fromAccountId: string;
  readonly toAccountId: string;
};

type RecurringWeekdayAdjustment = "none" | "next_weekday" | "previous_weekday";

export function parsePreviewDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function previewDateIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addPreviewDays(value: string, days: number): string {
  const date = parsePreviewDate(value);
  if (!date) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return previewDateIso(date);
}

function adjustPreviewWeekday(value: string, adjustment: RecurringWeekdayAdjustment): string {
  const date = parsePreviewDate(value);
  if (!date) return "";
  const day = date.getUTCDay();
  if (adjustment === "next_weekday" && day === 6) date.setUTCDate(date.getUTCDate() + 2);
  if (adjustment === "next_weekday" && day === 0) date.setUTCDate(date.getUTCDate() + 1);
  if (adjustment === "previous_weekday" && day === 6) date.setUTCDate(date.getUTCDate() - 1);
  if (adjustment === "previous_weekday" && day === 0) date.setUTCDate(date.getUTCDate() - 2);
  return previewDateIso(date);
}

function monthlyPreviewDate(anchor: Date, monthOffset: number): string {
  const targetMonth = anchor.getUTCFullYear() * 12 + anchor.getUTCMonth() + monthOffset;
  const year = Math.floor(targetMonth / 12);
  const month = targetMonth - year * 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return previewDateIso(new Date(Date.UTC(year, month, Math.min(anchor.getUTCDate(), lastDay))));
}

function adjustedOccurrencePreview(startsOn: string, weekdayAdjustment: RecurringWeekdayAdjustment): string {
  return adjustPreviewWeekday(startsOn, weekdayAdjustment);
}

function nextOccurrencePreview(form: Pick<RecurringCreateFormValues, "startsOn" | "frequency" | "weekdayAdjustment">): string {
  const anchor = parsePreviewDate(form.startsOn);
  const firstOccurrenceOn = adjustedOccurrencePreview(form.startsOn, form.weekdayAdjustment);
  if (!anchor || !firstOccurrenceOn) return "";
  const intervalDays = form.frequency === "weekly" ? 7 : form.frequency === "biweekly" ? 14 : null;
  const monthInterval = form.frequency === "monthly" ? 1 : form.frequency === "quarterly" ? 3 : 12;
  for (let index = 1; index < 100; index += 1) {
    const normal = intervalDays === null ? monthlyPreviewDate(anchor, index * monthInterval) : addPreviewDays(form.startsOn, index * intervalDays);
    const adjusted = adjustPreviewWeekday(normal, form.weekdayAdjustment);
    if (adjusted > firstOccurrenceOn) return adjusted;
  }
  return "";
}

const recurringPreviewWeekdayFormatter = new Intl.DateTimeFormat("en-CA", { weekday: "long", timeZone: "UTC" });

function recurringPreviewWeekday(value: string): string {
  const date = parsePreviewDate(value);
  return date ? recurringPreviewWeekdayFormatter.format(date) : "—";
}

function RecurringCreateField({ label, icon: Icon, className, children }: { readonly label: string; readonly icon: LucideIcon; readonly className?: string; readonly children: ReactNode }) {
  return <label className={`recurring-create-field${className ? ` ${className}` : ""}`}><span className="recurring-create-field-label">{label}</span><div className="recurring-create-control"><Icon aria-hidden="true" size={17} strokeWidth={1.8} />{children}</div></label>;
}

function RecurringCreateSection({ icon: Icon, title, description, children, className }: { readonly icon: LucideIcon; readonly title: string; readonly description: string; readonly children: ReactNode; readonly className?: string }) {
  return <section className={`recurring-create-section${className ? ` ${className}` : ""}`}><header className="recurring-create-section-header"><span className="recurring-create-section-icon"><Icon aria-hidden="true" size={22} strokeWidth={1.7} /></span><div><h2>{title}</h2><p>{description}</p></div></header>{children}</section>;
}

function RecurringCreateRail() {
  const benefits: readonly { readonly title: string; readonly description: string; readonly icon: LucideIcon }[] = [
    { title: "Choose your cadence", description: "Pick how often it repeats and which weekday it falls on.", icon: RefreshCw },
    { title: "Anchor the schedule", description: "We'll build occurrences based on your chosen anchor date.", icon: CalendarDays },
    { title: "Stay in control", description: "You can edit, pause or end this series at any time.", icon: Pencil },
  ];

  return <aside className="recurring-create-rail">
    <div className="recurring-create-brand"><Image src="/brand/athena-vault-helmet.svg" alt="" aria-hidden="true" width={42} height={62} /><span>ATHENA VAULT</span></div>
    <div className="recurring-create-rail-copy"><h1 id="recurring-create-title">Add a recurring payment series</h1><p>Create a rule that automatically schedules this payment on a recurring basis.</p></div>
    <div className="recurring-create-benefits">{benefits.map(({ title, description, icon: Icon }) => <div className="recurring-create-benefit" key={title}><span className="recurring-create-benefit-icon"><Icon aria-hidden="true" size={18} strokeWidth={1.8} /></span><div><strong>{title}</strong><p>{description}</p></div></div>)}</div>
    <div className="recurring-create-rail-art" aria-hidden="true" />
  </aside>;
}

export function RecurringCreateHeaderAction() {
  const openCreateForm = (): void => {
    window.history.replaceState(null, "", "#recurring-create");
    window.dispatchEvent(new Event(RECURRING_CREATE_OPEN_EVENT));
  };

  return <button className="account-primary-button recurring-header-create" type="button" onClick={openCreateForm} aria-controls="recurring-create">Add recurring series</button>;
}

export function RecurringCreateDialog({ accountOptions, todayIso, open = false, firstUse = false }: { readonly accountOptions: readonly RecurringManagerAccountOption[]; readonly todayIso: string; readonly open?: boolean; readonly firstUse?: boolean }) {
  const [createState, createAction, createPending] = useActionState(createRecurringSeriesAction, initialCashFlowActionState);
  const [frequencyTouched, setFrequencyTouched] = useState(false);
  const [createOpen, setCreateOpen] = useState(open);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [form, setForm] = useState<RecurringCreateFormValues>({ name: "", kind: firstUse ? "income" : "expense", amount: "", frequency: firstUse ? "biweekly" : "monthly", weekdayAdjustment: "none", startsOn: todayIso, endsOn: "", note: "", accountId: firstUse ? accountOptions[0]?.id ?? "" : "", fromAccountId: "", toAccountId: "" });
  useEffect(() => {
    const handleOpen = (): void => setCreateOpen(true);
    window.addEventListener(RECURRING_CREATE_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(RECURRING_CREATE_OPEN_EVENT, handleOpen);
  }, []);
  useEffect(() => {
    if (!createOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setCreateOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [createOpen]);
  const updateField = <K extends keyof RecurringCreateFormValues>(field: K, value: RecurringCreateFormValues[K]): void => {
    setForm((current) => ({ ...current, [field]: value }));
  };
  const firstOccurrenceOn = adjustedOccurrencePreview(form.startsOn, form.weekdayAdjustment);
  const nextOccurrenceOn = nextOccurrencePreview(form);
  const noteLimit = 250;

  return createOpen ? <div id="recurring-create" className="recurring-create-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreateOpen(false); }}>
    <section className="recurring-create-dialog" role="dialog" aria-modal="true" aria-labelledby="recurring-create-title">
      <RecurringCreateRail />
      <div className="recurring-create-content">
        <button ref={closeButtonRef} className="recurring-create-close-button" type="button" onClick={() => setCreateOpen(false)} aria-label="Close add recurring series"><X aria-hidden="true" size={21} strokeWidth={1.8} /></button>
        <form className="recurring-create-modal-form" action={createAction}>
          <RecurringCreateSection icon={Landmark} title="Series details" description="What is this payment and where should it be recorded?">
            <div className="recurring-create-fields">
              <RecurringCreateField label="Name" icon={Landmark}><input name="name" required maxLength={240} placeholder="Rent or paycheque" value={form.name} onChange={(event) => updateField("name", event.target.value)} /></RecurringCreateField>
              <RecurringCreateField label="Kind" icon={ArrowLeftRight}><InvestmentDropdown name="kind" value={form.kind} options={kindDropdownOptions} onChange={(kind) => {
                setForm((current) => ({ ...current, kind, frequency: kind === "income" && !frequencyTouched && current.frequency === "monthly" ? "biweekly" : current.frequency }));
              }} floating floatingMinWidth={220} /></RecurringCreateField>
              {form.kind === "transfer" ? <>
                <RecurringCreateField label="From account" icon={Landmark}><AccountSelect name="fromAccountId" value={form.fromAccountId || null} options={accountOptions} required onChange={(value) => updateField("fromAccountId", value)} /></RecurringCreateField>
                <RecurringCreateField label="To account" icon={Landmark}><AccountSelect name="toAccountId" value={form.toAccountId || null} options={accountOptions} required onChange={(value) => updateField("toAccountId", value)} /></RecurringCreateField>
                <RecurringCreateField label="Amount" icon={DollarSign} className="recurring-create-field-wide"><input name="amount" type="number" min="0.01" step="0.01" required placeholder="0.00" value={form.amount} onChange={(event) => updateField("amount", event.target.value)} /></RecurringCreateField>
                <label className="recurring-create-checkbox recurring-create-field-wide"><input name="countsAsExpense" type="checkbox" value="true" /><span>Count as spending (still a transfer for balances)</span></label>
              </> : <>
                <RecurringCreateField label="Account" icon={Landmark}><AccountSelect name="accountId" value={form.accountId || null} options={accountOptions} required onChange={(value) => updateField("accountId", value)} /></RecurringCreateField>
                <RecurringCreateField label="Amount" icon={DollarSign}><input name="amount" type="number" min="0.01" step="0.01" required placeholder="0.00" value={form.amount} onChange={(event) => updateField("amount", event.target.value)} /></RecurringCreateField>
              </>}
            </div>
          </RecurringCreateSection>

          <RecurringCreateSection icon={CalendarDays} title="Schedule settings" description="Define how often and when this payment should occur.">
            <div className="recurring-create-fields">
              <RecurringCreateField label="Frequency" icon={RefreshCw}><InvestmentDropdown name="frequency" value={form.frequency} options={frequencyDropdownOptions} onChange={(frequency) => {
                setFrequencyTouched(true);
                updateField("frequency", frequency as RecurringCreateFormValues["frequency"]);
              }} floating floatingMinWidth={240} /></RecurringCreateField>
              <RecurringCreateField label="Weekday rule" icon={CalendarDays}><WeekdaySelect value={form.weekdayAdjustment} onChange={(value) => updateField("weekdayAdjustment", value as RecurringCreateFormValues["weekdayAdjustment"])} /></RecurringCreateField>
              <RecurringCreateField label="Schedule anchor" icon={CalendarDays} className="recurring-create-anchor-field"><input name="startsOn" type="date" required value={form.startsOn} onChange={(event) => updateField("startsOn", event.target.value)} /></RecurringCreateField>
              <p className="recurring-create-field-wide recurring-create-date-help">The anchor date locks in the weekday for this series.</p>
            </div>
          </RecurringCreateSection>

          <RecurringCreateSection icon={Eye} title="Occurrence preview" description="We'll schedule occurrences based on the settings above." className="recurring-create-preview-section">
            <div className="recurring-create-preview-grid">
              <div className="recurring-create-preview-card is-next-up"><div className="recurring-create-preview-card-head"><span>First occurrence</span><small>Next up</small></div><strong>{firstOccurrenceOn || "—"}</strong><em>{recurringPreviewWeekday(firstOccurrenceOn)}</em><CalendarDays aria-hidden="true" size={16} strokeWidth={1.8} /></div>
              <div className="recurring-create-preview-card"><div className="recurring-create-preview-card-head"><span>Next occurrence</span></div><strong>{nextOccurrenceOn || "—"}</strong><em>{recurringPreviewWeekday(nextOccurrenceOn)}</em><CalendarDays aria-hidden="true" size={16} strokeWidth={1.8} /></div>
              <label className="recurring-create-preview-card recurring-create-end-card"><span className="recurring-create-preview-label">End occurrence <em>(optional)</em></span><span className="recurring-create-end-control"><input name="endsOn" type="date" value={form.endsOn} onChange={(event) => updateField("endsOn", event.target.value)} /><CalendarDays aria-hidden="true" size={16} strokeWidth={1.8} /></span><small>Leave blank to continue indefinitely.</small></label>
            </div>
            <label className="recurring-create-note-field"><span className="recurring-create-note-label">Note <em>(optional)</em></span><textarea name="note" maxLength={noteLimit} rows={3} placeholder="Add any notes about this series…" value={form.note} onChange={(event) => updateField("note", event.target.value)} /><span className="recurring-create-note-meta"><small>This note is for your reference and won&apos;t affect scheduling.</small><small>{form.note.length} / {noteLimit}</small></span></label>
          </RecurringCreateSection>

          <div className="recurring-create-form-actions"><button className="account-secondary-button" type="button" onClick={() => setCreateOpen(false)} disabled={createPending}>Cancel</button><button className="account-primary-button recurring-create-submit" type="submit" disabled={createPending}><Sparkles aria-hidden="true" size={16} strokeWidth={1.8} />{createPending ? "Saving…" : "Add series"}</button><ManagerMessage state={createState} /></div>
        </form>
      </div>
    </section>
  </div> : <span id="recurring-create" className="recurring-create-anchor" aria-hidden="true" />;
}
