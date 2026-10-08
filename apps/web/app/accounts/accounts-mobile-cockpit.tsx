import { ChevronRight, Landmark, Wallet } from "lucide-react";
import { AnimatedLineBackground } from "../components/animated-line-background";
import { AccountManager } from "./account-manager";
import { AccountsMobileDisclosure } from "./accounts-mobile-disclosure";
import { BalanceTimeline } from "./balance-timeline";
import { RecurringContributions } from "./recurring-contributions";
import { formatTimelineDate, maskedAccountLastFour, type AccountsPresentation, type TimelineAccountPresentation, type TimelineGroupKey } from "./presentation";
import { formatMoneyMinor } from "../../lib/format-money";

function dollars(minor: number | null): string {
  return formatMoneyMinor(minor, { unavailableLabel: "—" });
}

function groupTotal(presentation: AccountsPresentation, key: TimelineGroupKey): number {
  const selectedColumnIndex = presentation.columns.findIndex((column) => column.selected);
  return selectedColumnIndex < 0 ? 0 : presentation.groups.find((group) => group.key === key)?.totals[selectedColumnIndex] ?? 0;
}

function totalForGroup(presentation: AccountsPresentation, predicate: (key: TimelineGroupKey) => boolean): number {
  const selectedColumnIndex = presentation.columns.findIndex((column) => column.selected);
  if (selectedColumnIndex < 0) return 0;
  return presentation.groups
    .filter((group) => predicate(group.key))
    .reduce((total, group) => total + (group.totals[selectedColumnIndex] ?? 0), 0);
}

function groupAccounts(presentation: AccountsPresentation, key: TimelineGroupKey): readonly TimelineAccountPresentation[] {
  return presentation.groups.find((group) => group.key === key)?.accounts ?? [];
}

function selectedCell(account: TimelineAccountPresentation, presentation: AccountsPresentation) {
  const selectedColumnIndex = presentation.columns.findIndex((column) => column.selected);
  return selectedColumnIndex < 0 ? null : account.cells[selectedColumnIndex] ?? null;
}

function MobileDateLink({ href, label, date, current }: { readonly href: string | null; readonly label: string; readonly date: string | null; readonly current?: boolean }) {
  if (!href || !date) return <span className="accounts-mobile-date-link is-disabled" aria-disabled="true"><small>{label}</small><strong>—</strong></span>;
  return <a className={`accounts-mobile-date-link${current ? " is-current" : ""}`} href={href} aria-current={current ? "date" : undefined}><small>{label}</small><strong>{formatTimelineDate(date)}</strong></a>;
}

function MobileAccountRow({ account, presentation }: { readonly account: TimelineAccountPresentation; readonly presentation: AccountsPresentation }) {
  const cell = selectedCell(account, presentation);
  const lastFour = maskedAccountLastFour(account.lastFour);
  return <details className="accounts-mobile-account-details">
    <summary className="accounts-mobile-account-summary">
      <span className="accounts-mobile-account-identity">
        <span className="accounts-mobile-account-icon" aria-hidden="true"><Wallet size={17} strokeWidth={1.8} /></span>
        <span><strong>{account.name}</strong><small>{account.institution} · {account.kindLabel}</small></span>
      </span>
      <span className="accounts-mobile-account-value"><strong>{dollars(cell?.balanceMinor ?? null)}</strong><small className={cell?.status ? `is-${cell.status}` : ""}>{cell?.statusLabel ?? "No snapshot"}</small></span>
      <ChevronRight className="accounts-mobile-account-chevron" aria-hidden="true" size={18} strokeWidth={1.8} />
    </summary>
    <div className="accounts-mobile-account-details-body">
      <div><span>As of</span><strong>{presentation.selectedDate ? formatTimelineDate(presentation.selectedDate) : "No payday selected"}</strong></div>
      <div><span>Last four</span><strong>{lastFour ?? "Not provided"}</strong></div>
      <div><span>Available cash</span><strong>{account.includeInAvailableCash ? "Included" : "Excluded"}</strong></div>
      <div><span>Planned timeline</span><strong>{account.useCashFlowPlannedTimeline ? "Cash Flow" : "Account rules"}</strong></div>
      <a className="account-secondary-button accounts-mobile-manage-link" href="#accounts-mobile-manager">Manage account</a>
    </div>
  </details>;
}

function MobileAccountGroup({ groupKey, label, presentation }: { readonly groupKey: TimelineGroupKey; readonly label: string; readonly presentation: AccountsPresentation }) {
  const accounts = groupAccounts(presentation, groupKey).filter((account) => account.isActive);
  if (accounts.length === 0) return null;
  return <section className="accounts-mobile-account-group" aria-labelledby={`accounts-mobile-group-${groupKey}`}>
    <div className="accounts-mobile-group-heading"><h3 id={`accounts-mobile-group-${groupKey}`}>{label}</h3><span>{accounts.length}</span></div>
    <div className="accounts-mobile-account-items">{accounts.map((account) => <MobileAccountRow account={account} presentation={presentation} key={account.id} />)}</div>
  </section>;
}

function MobileTimelinePreview({ presentation }: { readonly presentation: AccountsPresentation }) {
  const selectedColumnIndex = presentation.columns.findIndex((column) => column.selected);
  const selectedAccounts = presentation.groups.flatMap((group) => group.accounts).filter((account) => account.isActive);
  const accountsWithValues = selectedAccounts.filter((account) => (selectedColumnIndex >= 0 ? account.cells[selectedColumnIndex]?.balanceMinor != null : false));
  const previewAccounts = accountsWithValues.slice(0, 6);

  return <div className="accounts-mobile-timeline-preview accounts-mobile-only">
    <div className="accounts-mobile-timeline-preview-head">
      <div><p className="eyebrow">Selected payday</p><strong>{presentation.selectedDate ? formatTimelineDate(presentation.selectedDate) : "No payday selected"}</strong></div>
      <span className={`timeline-status-badge is-${presentation.selectedState}`}>{presentation.selectedStateLabel}</span>
    </div>
    <div className="accounts-mobile-timeline-total"><span>All accounts</span><strong>{dollars(presentation.selectedTotalMinor)}</strong></div>
    {previewAccounts.length > 0 ? <ul className="accounts-mobile-timeline-list">
      {previewAccounts.map((account) => {
        const cell = selectedColumnIndex >= 0 ? account.cells[selectedColumnIndex] : null;
        return <li key={account.id}><span><strong>{account.name}</strong><small>{account.institution}</small></span><b>{dollars(cell?.balanceMinor ?? null)}</b></li>;
      })}
    </ul> : <p className="accounts-mobile-timeline-empty">No balance snapshots are available for this payday.</p>}
    {accountsWithValues.length > previewAccounts.length ? <p className="accounts-mobile-timeline-note">Showing {previewAccounts.length} of {accountsWithValues.length} accounts. Open the full editor for every row.</p> : null}
  </div>;
}

export interface AccountsMobileCockpitProps {
  readonly presentation: AccountsPresentation;
  readonly showArchived: boolean;
  readonly kindOptions: readonly { readonly code: string; readonly label: string }[];
  readonly previousHref: string | null;
  readonly todayHref: string | null;
  readonly nextHref: string | null;
  readonly archiveHref: string;
}

/**
 * Renders the phone-only cockpit surfaces plus the single mounted instances of
 * the shared editors. Each editor sits inside an AccountsMobileDisclosure that
 * is transparent on desktop and collapsible on phones, so the same React tree
 * serves both breakpoints.
 */
export function AccountsMobileCockpit({ presentation, showArchived, kindOptions, previousHref, todayHref, nextHref, archiveHref }: AccountsMobileCockpitProps) {
  const investments = totalForGroup(presentation, (key) => key === "investment" || key.startsWith("other:"));
  const obligations = groupTotal(presentation, "credit") + groupTotal(presentation, "loan");
  const selectedState = presentation.selectedStateLabel;

  return <>
    <article className="accounts-mobile-balance-card accounts-mobile-only">
      <AnimatedLineBackground lineCount={6} opacity={0.24} speed={18} scale={1.05} strokeWidth={1.05} density={0.9} drift={0.18} waveAmplitude={30} pulseStrength={0.72} color="#9F9270" accentColor="#E0C681" seed="accounts-mobile" className="animated-line-background--accounts-mobile" />
      <div className="accounts-mobile-balance-heading">
        <div><p className="eyebrow">Current balance</p><h1>Accounts</h1></div>
        <span className={`timeline-status-badge is-${presentation.selectedState}`}>{selectedState}</span>
      </div>
      <strong className="accounts-mobile-total">{dollars(presentation.selectedTotalMinor)}</strong>
      <p className="accounts-mobile-balance-caption">All active accounts · {presentation.selectedDate ? formatTimelineDate(presentation.selectedDate) : "No payday selected"}</p>
      <div className="accounts-mobile-date-nav" aria-label="Payday navigation">
        <MobileDateLink href={previousHref} label="Previous" date={presentation.navigation.previous} />
        <MobileDateLink href={todayHref} label="Today" date={presentation.navigation.today} current={presentation.selectedDate === presentation.navigation.today} />
        <MobileDateLink href={nextHref} label="Next" date={presentation.navigation.next} />
      </div>
    </article>

    <section className="accounts-mobile-money-map accounts-mobile-only" aria-labelledby="accounts-mobile-money-map-title">
      <div className="accounts-mobile-section-heading"><div><p className="eyebrow">At a glance</p><h2 id="accounts-mobile-money-map-title">Money map</h2></div><span>{presentation.visibleAccountCount} accounts</span></div>
      <div className="accounts-mobile-money-map-list">
        <div className="accounts-mobile-map-row"><span className="accounts-mobile-map-icon is-liquid"><Wallet aria-hidden="true" size={18} strokeWidth={1.8} /></span><span><strong>Liquid accounts</strong><small>Cash available across current accounts</small></span><b>{dollars(presentation.selectedLiquidTotalMinor)}</b></div>
        <div className="accounts-mobile-map-row"><span className="accounts-mobile-map-icon is-investment"><Landmark aria-hidden="true" size={18} strokeWidth={1.8} /></span><span><strong>Investments and other assets</strong><small>Registered, non-registered, and custom placements</small></span><b>{dollars(investments)}</b></div>
        <div className="accounts-mobile-map-row"><span className="accounts-mobile-map-icon is-obligation"><Landmark aria-hidden="true" size={18} strokeWidth={1.8} /></span><span><strong>Credit and loans</strong><small>Liabilities reduce the total</small></span><b>{dollars(obligations)}</b></div>
      </div>
    </section>

    <section className="accounts-mobile-account-list accounts-mobile-only" aria-labelledby="accounts-mobile-account-list-title">
      <div className="accounts-mobile-section-heading"><div><p className="eyebrow">Your accounts</p><h2 id="accounts-mobile-account-list-title">Account balances</h2></div><a className="accounts-mobile-inline-link" href={archiveHref}>{showArchived ? "Hide archived" : "Show archived"}</a></div>
      {presentation.groups.map((group) => <MobileAccountGroup groupKey={group.key} label={group.label} presentation={presentation} key={group.key} />)}
    </section>

    <AccountsMobileDisclosure eyebrow="EDITABLE" title="Biweekly balance timeline" meta={`${selectedState} · ${presentation.selectedDate ? formatTimelineDate(presentation.selectedDate) : "No payday selected"}`}>
      <MobileTimelinePreview presentation={presentation} />
      <AccountsMobileDisclosure variant="advanced" title="Open full timeline editor" meta="Edit every account across periods">
        <BalanceTimeline presentation={presentation} showArchived={showArchived} />
      </AccountsMobileDisclosure>
    </AccountsMobileDisclosure>
    <AccountsMobileDisclosure eyebrow="AUTOMATE" title="Recurring contributions" meta="Manage account funding rules">
      <RecurringContributions presentation={presentation} />
    </AccountsMobileDisclosure>
    <AccountsMobileDisclosure id="accounts-mobile-manager" eyebrow="SETTINGS" title="Manage accounts" meta="Add, edit, archive, delete, and reorder accounts">
      <AccountManager presentation={presentation} kindOptions={kindOptions} />
    </AccountsMobileDisclosure>
  </>;
}
