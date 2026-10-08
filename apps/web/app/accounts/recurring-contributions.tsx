"use client";

import { useActionState, useCallback, useState } from "react";
import Image from "next/image";
import type { AccountContributionRuleView } from "@athena/database";
import { ArrowRight, CalendarDays, ChevronDown, CreditCard, Landmark, ListFilter, MoreHorizontal, Pencil, PiggyBank, Plus, RefreshCw, Search, TrendingUp, Wallet, type LucideIcon } from "lucide-react";
import { AnimatedLineBackground } from "../components/animated-line-background";
import { ActionNotification } from "../components/action-notification";
import { FormDropdown } from "../components/form-dropdown";
import { InvestmentDropdown, type InvestmentDropdownOption } from "../investments/investment-dropdown";
import { formatMoneyInputMinor, formatMoneyMinor } from "../../lib/format-money";
import {
  deleteContributionRuleAction,
  saveContributionRuleAction,
  updateContributionExceptionsAction,
} from "./actions";
import { initialAccountActionState, type AccountActionState } from "./action-helpers";
import type { AccountsPresentation, TimelineAccountPresentation } from "./presentation";

interface RecurringContributionsProps {
  readonly presentation: AccountsPresentation;
  readonly headingId?: string;
}

const frequencies = [
  ["weekly", "Weekly"],
  ["biweekly", "Biweekly"],
  ["monthly", "Monthly"],
  ["annual", "Annually"],
] as const;

const scopes = [
  ["rule_only", "Save rule only"],
  ["from_rule_start", "Recalculate future from rule start"],
  ["all_future", "Recalculate all future Projected cells"],
] as const;

const frequencyOptions: readonly InvestmentDropdownOption[] = frequencies.map(([value, label]) => ({ value, label }));
const scopeOptions: readonly InvestmentDropdownOption[] = scopes.map(([value, label]) => ({ value, label }));
const exceptionKindOptions: readonly InvestmentDropdownOption[] = [
  { value: "skip", label: "Skip" },
  { value: "override", label: "Override" },
  { value: "restore", label: "Restore" },
];

function dollars(minor: number | bigint): string {
  return formatMoneyMinor(minor);
}

function amountInput(minor: number): string {
  return formatMoneyInputMinor(minor);
}

function frequencyLabel(frequency: string): string {
  return frequency === "biweekly" ? "Every 2 weeks" : frequency === "weekly" ? "Every week" : frequency === "monthly" ? "Every month" : "Every year";
}

const accountRuleIconsByKind: Readonly<Record<string, LucideIcon>> = {
  savings: PiggyBank,
  credit: CreditCard,
  loan: Landmark,
  investment: TrendingUp,
};

function accountRuleTone(kind: string): "gold" | "violet" | "blue" | "green" {
  if (kind === "savings") return "violet";
  if (kind === "credit") return "blue";
  if (kind === "investment") return "green";
  return "gold";
}

function biweeklyAmount(rule: AccountContributionRuleView): bigint {
  const amount = BigInt(rule.amountMinor);
  if (rule.frequency === "weekly") return amount * 2n;
  if (rule.frequency === "monthly") return (amount * 12n + 13n) / 26n;
  if (rule.frequency === "annual") return (amount + 13n) / 26n;
  return amount;
}

const shortDate = new Intl.DateTimeFormat("en-CA", { month: "short", day: "2-digit", year: "numeric", timeZone: "UTC" });
const weekday = new Intl.DateTimeFormat("en-CA", { weekday: "long", timeZone: "UTC" });
const monthDay = new Intl.DateTimeFormat("en-CA", { month: "short", day: "2-digit", timeZone: "UTC" });

function dateLabel(iso: string | null): string {
  return iso ? shortDate.format(new Date(`${iso}T00:00:00Z`)) : "Not scheduled";
}

function weekdayLabel(iso: string): string {
  return weekday.format(new Date(`${iso}T00:00:00Z`));
}

function monthDayLabel(iso: string): { readonly month: string; readonly day: string } {
  const formatted = monthDay.formatToParts(new Date(`${iso}T00:00:00Z`));
  return { month: formatted.find((part) => part.type === "month")?.value ?? "—", day: formatted.find((part) => part.type === "day")?.value ?? "—" };
}

function FieldError({ message }: { readonly message?: string }) {
  return message ? <p className="account-field-error" role="alert">{message}</p> : null;
}

function RuleForm({
  accountId,
  rule,
  accountOptions,
  presentation,
  action,
  state,
  pending,
  onCancel,
}: {
  readonly accountId: string;
  readonly rule: AccountContributionRuleView | null;
  readonly accountOptions?: readonly TimelineAccountPresentation[];
  readonly presentation: AccountsPresentation;
  readonly action: (formData: FormData) => void;
  readonly state: AccountActionState;
  readonly pending: boolean;
  readonly onCancel: () => void;
}) {
  return <form action={action} className="contribution-rule-form">
    {rule ? <input type="hidden" name="id" value={rule.id} /> : null}
    {accountOptions ? <div className="account-field contribution-account-select-field"><label htmlFor={`contribution-account-${accountId || "new"}`}>Destination account</label><FormDropdown id={`contribution-account-${accountId || "new"}`} name="accountId" defaultValue={accountId || (accountOptions[0]?.id ?? "")} options={accountOptions.map((option) => ({ value: option.id, label: `${option.name} · ${option.institution}` }))} floatingMinWidth={320} /></div> : <input type="hidden" name="accountId" value={accountId} />}
    <div className="contribution-form-fields">
      <div className="account-field">
        <label htmlFor={`contribution-amount-${accountId}`}>Amount (CAD)</label>
        <input id={`contribution-amount-${accountId}`} name="amount" type="text" inputMode="decimal" pattern="^\d+(\.\d{1,2})?$" required defaultValue={rule ? amountInput(rule.amountMinor) : ""} placeholder="250.00" aria-describedby={state.fieldErrors.amount ? `contribution-amount-${accountId}-error` : undefined} />
        <FieldError message={state.fieldErrors.amount} />
      </div>
      <div className="account-field">
        <label htmlFor={`contribution-frequency-${accountId}`}>Frequency</label>
        <FormDropdown id={`contribution-frequency-${accountId}`} name="frequency" defaultValue={rule?.frequency ?? "biweekly"} options={frequencyOptions} floatingMinWidth={240} />
        <FieldError message={state.fieldErrors.frequency} />
      </div>
      <div className="account-field">
        <label htmlFor={`contribution-start-${accountId}`}>Start date</label>
        <input id={`contribution-start-${accountId}`} name="startsOn" type="date" required defaultValue={rule?.startsOn ?? presentation.todayIso} />
        <FieldError message={state.fieldErrors.startsOn} />
      </div>
      <div className="account-field">
        <label htmlFor={`contribution-end-${accountId}`}>End date <span className="field-optional">optional</span></label>
        <input id={`contribution-end-${accountId}`} name="endsOn" type="date" defaultValue={rule?.endsOn ?? ""} />
        <FieldError message={state.fieldErrors.endsOn} />
      </div>
      <label className="contribution-enabled-field"><input name="isEnabled" type="checkbox" defaultChecked={rule?.isEnabled ?? true} /> <span>Enabled</span></label>
      <div className="account-field contribution-scope-field">
        <label htmlFor={`contribution-scope-${accountId}`}>After save</label>
        <FormDropdown id={`contribution-scope-${accountId}`} name="recalculationScope" defaultValue="from_rule_start" options={scopeOptions} floatingMinWidth={320} />
        <FieldError message={state.fieldErrors.recalculationScope} />
      </div>
    </div>
    <div className="account-form-actions">
      <button className="account-primary-button" type="submit" disabled={pending}>{pending ? "Saving…" : rule ? "Save rule" : "Add rule"}</button>
      {rule ? <button className="account-secondary-button" type="button" onClick={onCancel} disabled={pending}>Cancel</button> : null}
    </div>
  </form>;
}

function QuickToggle({ rule, action, pending }: { readonly rule: AccountContributionRuleView; readonly action: (formData: FormData) => void; readonly pending: boolean }) {
  return <form action={action} className="contribution-inline-form">
    <input type="hidden" name="id" value={rule.id} />
    <input type="hidden" name="accountId" value={rule.accountId} />
    <input type="hidden" name="amount" value={amountInput(rule.amountMinor)} />
    <input type="hidden" name="frequency" value={rule.frequency} />
    <input type="hidden" name="startsOn" value={rule.startsOn} />
    <input type="hidden" name="endsOn" value={rule.endsOn ?? ""} />
    <input type="hidden" name="isEnabled" value={rule.isEnabled ? "false" : "true"} />
    <input type="hidden" name="recalculationScope" value="from_rule_start" />
    <button className="account-secondary-button" type="submit" disabled={pending}>{rule.isEnabled ? "Disable" : "Enable"}</button>
  </form>;
}

function RuleRow({
  rule,
  account,
  action,
  deleteAction,
  exceptionAction,
  savePending,
  deletePending,
  exceptionPending,
  onEdit,
  deleteCandidate,
  onDeleteCandidate,
  menuOpen,
  onMenuToggle,
}: {
  readonly rule: AccountContributionRuleView;
  readonly account: TimelineAccountPresentation;
  readonly action: (formData: FormData) => void;
  readonly deleteAction: (formData: FormData) => void;
  readonly exceptionAction: (formData: FormData) => void;
  readonly savePending: boolean;
  readonly deletePending: boolean;
  readonly exceptionPending: boolean;
  readonly onEdit: () => void;
  readonly deleteCandidate: boolean;
  readonly onDeleteCandidate: (value: boolean) => void;
  readonly menuOpen: boolean;
  readonly onMenuToggle: () => void;
}) {
  const AccountIcon = accountRuleIconsByKind[account.kind] ?? Wallet;
  const accountTone = accountRuleTone(account.kind);
  return <article className="contribution-rule-row">
    <div className="contribution-rule-summary">
      <div className="contribution-rule-account">
        <span className={`contribution-rule-account-icon is-${accountTone}`}><AccountIcon aria-hidden="true" size={17} strokeWidth={1.8} /></span>
        <div><strong>{account.name}</strong><span className="contribution-rule-account-meta"><span>{account.institution}</span><span className="contribution-rule-gold-dots" aria-hidden="true"><i /><i /></span><span>{account.kindLabel}</span></span><span className="contribution-rule-exception-summary"><CalendarDays aria-hidden="true" size={13} strokeWidth={1.8} /> Exceptions: {rule.exceptions.length ? `${rule.exceptions.length} date${rule.exceptions.length === 1 ? "" : "s"}` : "None"}</span></div>
      </div>
      <div className="contribution-rule-amount"><strong>{dollars(rule.amountMinor)}</strong><span>{frequencyLabel(rule.frequency)}</span></div>
      <div className="contribution-rule-next"><span><CalendarDays aria-hidden="true" size={13} strokeWidth={1.8} /> Next run</span><strong>{rule.nextOccurrenceOn ?? "None"}</strong></div>
      <span className={`account-status-badge ${rule.isEnabled ? "is-enabled" : "is-archived"}`}>{rule.isEnabled ? "Enabled" : "Disabled"}</span>
      <button className="account-secondary-button contribution-edit-button" type="button" onClick={onEdit} disabled={savePending} aria-label={`Edit ${account.name} rule`}><Pencil aria-hidden="true" size={15} strokeWidth={1.8} /></button>
      <div className="contribution-rule-menu">
        <button className="account-secondary-button contribution-more-button" type="button" onClick={onMenuToggle} aria-label={`More actions for ${account.name} rule`} aria-expanded={menuOpen}><MoreHorizontal aria-hidden="true" size={17} strokeWidth={1.8} /></button>
        {menuOpen ? <div className="contribution-rule-menu-popover" role="menu">
          <QuickToggle rule={rule} action={action} pending={savePending} />
          <button className="account-danger-button" type="button" onClick={() => onDeleteCandidate(!deleteCandidate)} disabled={deletePending}>{deleteCandidate ? "Cancel delete" : "Delete"}</button>
        </div> : null}
      </div>
    </div>
    {deleteCandidate ? <div className="account-confirm contribution-confirm" role="alertdialog" aria-label="Confirm recurring contribution deletion">
      <span>Delete this rule and its occurrence exceptions?</span>
      <form action={deleteAction} className="account-confirm-actions">
        <input type="hidden" name="ruleId" value={rule.id} />
        <button className="account-danger-button" type="submit" disabled={deletePending}>{deletePending ? "Deleting…" : "Confirm delete"}</button>
        <button className="account-secondary-button" type="button" onClick={() => onDeleteCandidate(false)} disabled={deletePending}>Cancel</button>
      </form>
    </div> : null}
    <details className="contribution-exception-details">
      <summary>Manage exceptions</summary>
      <div className="contribution-exception-panel">
        <div>
          <strong>Exceptions</strong>
          <span className="contribution-exception-help">Use one or more ISO dates, separated by commas or lines.</span>
        </div>
        {rule.exceptions.length > 0 ? <ul className="contribution-exception-list">{rule.exceptions.map((exception) => <li key={exception.id}><span>{exception.occurrenceOn}</span><span className={`account-status-badge ${exception.kind === "skip" ? "is-archived" : "is-enabled"}`}>{exception.kind === "skip" ? "Skipped" : `Override ${dollars(exception.amountMinor ?? 0)}`}</span></li>)}</ul> : <span className="contribution-exception-empty">No exceptions.</span>}
        <form action={exceptionAction} className="contribution-exception-form">
          <input type="hidden" name="ruleId" value={rule.id} />
          <input name="occurrenceDates" type="text" placeholder="2026-08-14, 2026-08-28" aria-label="Occurrence dates" required />
          <FormDropdown name="kind" defaultValue="skip" options={exceptionKindOptions} ariaLabel="Exception action" floatingMinWidth={220} />
          <input name="amountOverride" type="text" inputMode="decimal" placeholder="Override CAD" aria-label="Override amount" />
          <button className="account-secondary-button" type="submit" disabled={exceptionPending}>{exceptionPending ? "Saving…" : "Apply"}</button>
        </form>
      </div>
    </details>
  </article>;
}

type ContributionAccountGroup = { readonly key: string; readonly institution: string; readonly accounts: TimelineAccountPresentation[] };

function AccountContributionSection({
  group,
  presentation,
  saveAction,
  saveState,
  savePending,
  deleteAction,
  deletePending,
  exceptionAction,
  exceptionPending,
  editingRuleId,
  onEdit,
  onCancel,
  deleteCandidate,
  onDeleteCandidate,
  openRuleMenuId,
  onMenuToggle,
  isOpen,
  onToggle,
}: {
  readonly group: ContributionAccountGroup;
  readonly presentation: AccountsPresentation;
  readonly saveAction: (formData: FormData) => void;
  readonly saveState: AccountActionState;
  readonly savePending: boolean;
  readonly deleteAction: (formData: FormData) => void;
  readonly deletePending: boolean;
  readonly exceptionAction: (formData: FormData) => void;
  readonly exceptionPending: boolean;
  readonly editingRuleId: string | null;
  readonly onEdit: (rule: AccountContributionRuleView) => void;
  readonly onCancel: () => void;
  readonly deleteCandidate: string | null;
  readonly onDeleteCandidate: (ruleId: string, value: boolean) => void;
  readonly openRuleMenuId: string | null;
  readonly onMenuToggle: (ruleId: string) => void;
  readonly isOpen: boolean;
  readonly onToggle: (isOpen: boolean) => void;
}) {
  const groupRules = group.accounts.flatMap((account) => account.contributionRules.map((rule) => ({ account, rule })));
  const editingEntry = groupRules.find(({ rule }) => rule.id === editingRuleId) ?? null;
  const hasActiveEditor = Boolean(editingEntry);
  const activeRules = groupRules.filter(({ rule }) => rule.isEnabled);
  const activeTotalMinor = activeRules.reduce((sum, { rule }) => sum + biweeklyAmount(rule), 0n);
  const nextContribution = activeRules.map(({ rule }) => rule.nextOccurrenceOn).filter((date): date is string => date !== null).sort()[0] ?? null;
  const headerAccount = group.accounts[0];
  const AccountIcon = accountRuleIconsByKind[headerAccount?.kind ?? "checking"] ?? Wallet;
  const accountTone = accountRuleTone(headerAccount?.kind ?? "checking");
  return <details className="contribution-account" open={isOpen || hasActiveEditor} onToggle={(event) => onToggle((event.currentTarget as HTMLDetailsElement).open)}>
    <summary className="contribution-account-summary">
      <span className={`contribution-account-header-icon is-${accountTone}`}><AccountIcon aria-hidden="true" size={19} strokeWidth={1.8} /></span>
      <span className="contribution-account-header-name"><strong>{group.institution}</strong><small>{group.accounts.length === 1 && headerAccount ? `${headerAccount.kindLabel} · ${headerAccount.name}` : `${group.accounts.length} linked accounts`}</small></span>
      <span className="contribution-account-header-stat"><strong>{activeRules.length} active rule{activeRules.length === 1 ? "" : "s"}</strong><small>Active</small></span>
      <span className="contribution-account-header-stat"><strong>{dollars(activeTotalMinor)}</strong><small>Total (biweekly)</small></span>
      <span className="contribution-account-header-stat contribution-account-header-next"><strong>{dateLabel(nextContribution)}</strong><small>Next contribution</small></span>
      <span className={`account-status-badge ${activeRules.length > 0 ? "is-enabled" : "is-archived"}`}>{activeRules.length > 0 ? "Enabled" : "Disabled"}</span>
      <span className="contribution-account-chevron" aria-hidden="true"><ChevronDown size={15} strokeWidth={1.8} className={isOpen ? "is-open" : undefined} /></span>
    </summary>
    <div className="contribution-account-body">
      {groupRules.map(({ account, rule }) => editingRuleId === rule.id ? <RuleForm key={rule.id} accountId={account.id} rule={rule} presentation={presentation} action={saveAction} state={saveState} pending={savePending} onCancel={onCancel} /> : <RuleRow
        key={rule.id}
        rule={rule}
        account={account}
        action={saveAction}
        deleteAction={deleteAction}
        exceptionAction={exceptionAction}
        savePending={savePending}
        deletePending={deletePending}
        exceptionPending={exceptionPending}
        onEdit={() => onEdit(rule)}
        deleteCandidate={deleteCandidate === rule.id}
        onDeleteCandidate={(value) => onDeleteCandidate(rule.id, value)}
        menuOpen={openRuleMenuId === rule.id}
        onMenuToggle={() => onMenuToggle(rule.id)}
      />)}
    </div>
  </details>;
}

type RuleEntry = { readonly account: TimelineAccountPresentation; readonly rule: AccountContributionRuleView };

type ContributionView = "active" | "accounts";

export function RecurringContributions({ presentation, headingId = "recurring-contributions-heading" }: RecurringContributionsProps) {
  const accounts = presentation.groups.flatMap((group) => group.accounts);
  const accountsWithRules = accounts.filter((account) => account.contributionRules.length > 0);
  const accountGroupMap = new Map<string, ContributionAccountGroup>();
  accountsWithRules.forEach((account) => {
    const key = account.institution.trim().toLocaleLowerCase() || account.id;
    const existing = accountGroupMap.get(key);
    if (existing) existing.accounts.push(account);
    else accountGroupMap.set(key, { key, institution: account.institution, accounts: [account] });
  });
  const accountGroups = [...accountGroupMap.values()];
  const activeAccounts = accounts.filter((account) => account.isActive);
  const ruleEntries: readonly RuleEntry[] = accountsWithRules.flatMap((account) => account.contributionRules.map((rule) => ({ account, rule })));
  const activeRules = ruleEntries.filter(({ rule }) => rule.isEnabled);
  const [view, setView] = useState<ContributionView>("active");
  const [showAllActive, setShowAllActive] = useState(false);
  const [query, setQuery] = useState("");
  const [accountFilter, setAccountFilter] = useState("all");
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<string | null>(null);
  const [openRuleMenuId, setOpenRuleMenuId] = useState<string | null>(null);
  const [openAccounts, setOpenAccounts] = useState<Set<string>>(() => new Set(accountGroups.slice(0, 2).map((group) => group.key)));
  const clearTransientRuleState = useCallback(() => {
    setEditingRuleId(null);
    setDeleteCandidate(null);
    setOpenRuleMenuId(null);
  }, []);
  const saveRuleWithReset = useCallback(async (previous: AccountActionState, formData: FormData): Promise<AccountActionState> => {
    const next = await saveContributionRuleAction(previous, formData);
    if (next.ok) clearTransientRuleState();
    return next;
  }, [clearTransientRuleState]);
  const deleteRuleWithReset = useCallback(async (previous: AccountActionState, formData: FormData): Promise<AccountActionState> => {
    const next = await deleteContributionRuleAction(previous, formData);
    if (next.ok) clearTransientRuleState();
    return next;
  }, [clearTransientRuleState]);
  const updateExceptionsWithReset = useCallback(async (previous: AccountActionState, formData: FormData): Promise<AccountActionState> => {
    const next = await updateContributionExceptionsAction(previous, formData);
    if (next.ok) clearTransientRuleState();
    return next;
  }, [clearTransientRuleState]);
  const [saveState, saveAction, savePending] = useActionState(saveRuleWithReset, initialAccountActionState);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteRuleWithReset, initialAccountActionState);
  const [exceptionState, exceptionAction, exceptionPending] = useActionState(updateExceptionsWithReset, initialAccountActionState);

  const toggleAccount = (accountId: string, isOpen: boolean) => {
    setOpenAccounts((previous) => {
      const next = new Set(previous);
      if (isOpen) next.add(accountId);
      else next.delete(accountId);
      return next;
    });
  };

  const openAll = () => setOpenAccounts(new Set(accountGroups.map((group) => group.key)));
  const closeAll = () => setOpenAccounts(new Set());
  const normalizedQuery = query.trim().toLowerCase();
  const filteredActiveRules = activeRules.filter(({ account }) => (accountFilter === "all" || account.id === accountFilter) && (!normalizedQuery || `${account.name} ${account.institution}`.toLowerCase().includes(normalizedQuery)));
  const visibleActiveRules = showAllActive ? filteredActiveRules : filteredActiveRules.slice(0, 4);
  const totalPerBiweeklyMinor = activeRules.reduce((sum, { rule }) => sum + biweeklyAmount(rule), 0n);
  const destinationCount = new Set(activeRules.map(({ rule }) => rule.accountId)).size;
  const upcomingRunMap = new Map<string, { readonly date: string; readonly totalMinor: bigint; readonly contributionCount: number }>();
  activeRules.forEach(({ rule }) => {
    if (!rule.nextOccurrenceOn) return;
    const current = upcomingRunMap.get(rule.nextOccurrenceOn);
    upcomingRunMap.set(rule.nextOccurrenceOn, { date: rule.nextOccurrenceOn, totalMinor: (current?.totalMinor ?? 0n) + BigInt(rule.amountMinor), contributionCount: (current?.contributionCount ?? 0) + 1 });
  });
  const upcomingRuns = [...upcomingRunMap.values()].sort((left, right) => left.date.localeCompare(right.date)).slice(0, 3);
  const renderRule = ({ account, rule }: RuleEntry) => editingRuleId === rule.id
    ? <RuleForm key={rule.id} accountId={account.id} rule={rule} presentation={presentation} action={saveAction} state={saveState} pending={savePending} onCancel={() => setEditingRuleId(null)} />
    : <RuleRow
      key={rule.id}
      rule={rule}
      account={account}
      action={saveAction}
      deleteAction={deleteAction}
      exceptionAction={exceptionAction}
      savePending={savePending}
      deletePending={deletePending}
      exceptionPending={exceptionPending}
      onEdit={() => { setOpenRuleMenuId(null); setEditingRuleId(rule.id); }}
      deleteCandidate={deleteCandidate === rule.id}
      onDeleteCandidate={(value) => setDeleteCandidate(value ? rule.id : null)}
      menuOpen={openRuleMenuId === rule.id}
      onMenuToggle={() => setOpenRuleMenuId(openRuleMenuId === rule.id ? null : rule.id)}
    />;

  return <div className="recurring-contributions-layout">
    <section className="card section-card recurring-contributions-card recurring-contributions-main" aria-labelledby={headingId}>
      <div className="recurring-contributions-hero">
        <AnimatedLineBackground lineCount={9} opacity={0.27} speed={18} scale={1.12} strokeWidth={1.2} density={1} drift={0.25} waveAmplitude={36} pulseStrength={0.82} direction="right-to-left" color="#9F9270" accentColor="#E0C681" seed="recurring-contributions" className="animated-line-background--recurring-hero" />
        <span className="recurring-contributions-hero-icon"><RefreshCw aria-hidden="true" size={30} strokeWidth={1.5} /></span>
        <div className="recurring-contributions-hero-content"><p className="eyebrow">Recurring contributions</p><h2 id={headingId}>Automate your money</h2><p>Set up recurring contributions to keep your finances on track during projections.</p></div>
        <Image src="/brand/recurring-background.png" alt="" width={2200} height={734} className="recurring-contributions-hero-art" aria-hidden="true" loading="lazy" fetchPriority="low" unoptimized />
      </div>
      <div className="contribution-tabs" role="tablist" aria-label="Recurring contribution views">
      <button className={view === "active" ? "is-active" : ""} type="button" role="tab" aria-selected={view === "active"} onClick={() => setView("active")}><ListFilter aria-hidden="true" size={17} strokeWidth={1.8} /><span>Active rules</span><small>{activeRules.length} active rules</small></button>
      <button className={view === "accounts" ? "is-active" : ""} type="button" role="tab" aria-selected={view === "accounts"} onClick={() => setView("accounts")}><Landmark aria-hidden="true" size={17} strokeWidth={1.8} /><span>By account</span></button>
    </div>
    <div className="contribution-toolbar">
      <label className="contribution-search"><Search aria-hidden="true" size={15} strokeWidth={1.8} /><span className="sr-only">Search recurring rules</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search rules…" /></label>
      <InvestmentDropdown className="contribution-account-filter" value={accountFilter} options={[{ value: "all", label: "All accounts" }, ...accountsWithRules.map((account) => ({ value: account.id, label: account.name }))]} onChange={setAccountFilter} aria-label="Filter recurring rules by account" floating floatingMinWidth={220} />
      <div className="contribution-toolbar-actions">
        <button className="account-secondary-button contribution-visibility-button" type="button" onClick={openAll} aria-label="Show all accounts">Show all</button>
        <button className="account-secondary-button contribution-visibility-button" type="button" onClick={closeAll} aria-label="Hide all accounts">Hide all</button>
        <button className="navy-action-button contribution-add-rule" type="button" onClick={() => { setView("active"); setEditingRuleId("new:global"); }}><span className="navy-action-icon" aria-hidden="true"><Plus size={14} strokeWidth={2.5} /></span><span>Add rule</span></button>
      </div>
    </div>
    <ActionNotification state={saveState} />
    <ActionNotification state={deleteState} />
    <ActionNotification state={exceptionState} />
    {view === "active" ? <>
      {editingRuleId === "new:global" ? <RuleForm accountId="" rule={null} accountOptions={activeAccounts} presentation={presentation} action={saveAction} state={saveState} pending={savePending} onCancel={() => setEditingRuleId(null)} /> : null}
      <p className="contribution-visible-count">{filteredActiveRules.length} active rule{filteredActiveRules.length === 1 ? "" : "s"}</p>
      <div className="contribution-active-list">{visibleActiveRules.map(renderRule)}</div>
      {filteredActiveRules.length === 0 ? <p className="contribution-empty">No active rules match this view. Use Add rule to create one.</p> : null}
      {activeRules.length > 4 ? <button className="contribution-view-all" type="button" onClick={() => setShowAllActive((value) => !value)}>{showAllActive ? "Show fewer rules" : `View all ${activeRules.length} rules`}<ChevronDown aria-hidden="true" size={15} strokeWidth={1.8} className={showAllActive ? "is-open" : undefined} /></button> : null}
    </> : <>
      <div className="contribution-account-list">{accountGroups.map((group) => <AccountContributionSection
        key={group.key}
        group={group}
        presentation={presentation}
        saveAction={saveAction}
        saveState={saveState}
        savePending={savePending}
        deleteAction={deleteAction}
        deletePending={deletePending}
        exceptionAction={exceptionAction}
        exceptionPending={exceptionPending}
        editingRuleId={editingRuleId}
        onEdit={(rule) => { setOpenRuleMenuId(null); setEditingRuleId(rule.id); }}
        onCancel={() => setEditingRuleId(null)}
        deleteCandidate={deleteCandidate}
        onDeleteCandidate={(ruleId, value) => setDeleteCandidate(value ? ruleId : null)}
        openRuleMenuId={openRuleMenuId}
        onMenuToggle={(ruleId) => setOpenRuleMenuId(openRuleMenuId === ruleId ? null : ruleId)}
        isOpen={openAccounts.has(group.key)}
        onToggle={(isOpen) => toggleAccount(group.key, isOpen)}
      />)}</div>
      {accountGroups.length === 0 ? <p className="contribution-empty">No accounts have recurring rules yet. Use Add rule to create one.</p> : null}
    </>}
    </section>
    <aside className="recurring-contributions-side">
      <section className="recurring-summary-card card" aria-label="Recurring summary">
        <div className="recurring-side-heading"><span className="recurring-side-icon"><TrendingUp aria-hidden="true" size={15} strokeWidth={1.8} /></span><span>Recurring summary</span></div>
        <div className="recurring-summary-grid">
          <div><strong>{activeRules.length}</strong><small>Active rules</small></div>
          <div><strong>{dollars(totalPerBiweeklyMinor)}</strong><small>Total per biweekly</small></div>
          <div><strong>{destinationCount}</strong><small>Destination accounts</small></div>
          <div><strong>{dateLabel(upcomingRuns[0]?.date ?? null)}</strong><small>Next run date</small></div>
        </div>
        <button className="recurring-next-runs" type="button" onClick={() => setView("active")}><CalendarDays aria-hidden="true" size={15} strokeWidth={1.8} /><span>Next {Math.min(3, upcomingRuns.length)} runs total</span><strong>{dollars(upcomingRuns.slice(0, 3).reduce((sum, run) => sum + run.totalMinor, 0n))}</strong><ArrowRight aria-hidden="true" size={15} strokeWidth={1.8} /></button>
      </section>
      <section className="recurring-upcoming-card card" aria-label="Upcoming recurring contribution runs">
        <div className="recurring-side-heading"><span>Upcoming runs</span></div>
        <div className="recurring-upcoming-list">{upcomingRuns.map((run) => { const date = monthDayLabel(run.date); return <div className="recurring-upcoming-row" key={run.date}><span className="recurring-upcoming-date"><small>{date.month}</small><strong>{date.day}</strong></span><span><strong>{weekdayLabel(run.date)}</strong><small>{run.contributionCount} {run.contributionCount === 1 ? "contribution" : "contributions"}</small></span><b>{dollars(run.totalMinor)}</b><ArrowRight aria-hidden="true" size={15} strokeWidth={1.8} /></div>; })}</div>
        <button className="recurring-schedule-button" type="button" onClick={() => setView("accounts")}>View full schedule<ArrowRight aria-hidden="true" size={14} strokeWidth={1.8} /></button>
      </section>
    </aside>
  </div>;
}
