import type { HomeHouseholdCashFlowLinkView, HomeHouseholdFrequency, HomeMortgageTermView } from "@athena/database";
import Image from "next/image";
import type { ReactNode } from "react";
import {
  ArrowLeftRight,
  ArrowRight,
  CalendarDays,
  ChevronDown,
  House,
  Landmark,
  Receipt,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { HouseholdCashFlowControls, type AccountOption } from "./household-cash-flow-cards";
import { HomeMobileDetailsLink } from "./home-mobile-details-link";
import { AnimatedLineBackground } from "../components/animated-line-background";
import { formatMoneyMinor } from "../../lib/format-money";

function dollars(minor: number | null): string {
  return formatMoneyMinor(minor, { unavailableLabel: "—" });
}

function displayDate(iso: string | null): string {
  if (!iso) return "Not configured";
  return new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

function rateLabel(annualRateBps: number): string {
  return `${(annualRateBps / 100).toFixed(2)}%`;
}

function mortgageStatusLabel(status: string | null): string {
  if (status === "actual") return "Actual balance";
  if (status === "estimated") return "Estimated balance";
  if (status === "projected") return "Projected balance";
  return "No balance recorded";
}

type HomeOverviewIconTone = "navy" | "gold" | "positive" | "neutral" | "ring-gold";

function householdLinkFor(links: readonly HomeHouseholdCashFlowLinkView[], frequency: HomeHouseholdFrequency) {
  return links.find((link) => link.frequency === frequency) ?? null;
}

function HomeOverviewIcon({ icon: Icon, tone = "gold" }: { readonly icon: LucideIcon; readonly tone?: HomeOverviewIconTone }) {
  return <span className={`home-overview-icon is-${tone}`} aria-hidden="true"><Icon size={18} strokeWidth={1.8} /></span>;
}

function HomeSummaryMetric({ icon, label, value, detail, action, tone = "gold" }: { readonly icon: LucideIcon; readonly label: string; readonly value: string; readonly detail: string; readonly action?: ReactNode; readonly tone?: HomeOverviewIconTone }) {
  return <div className="home-summary-metric">
    <HomeOverviewIcon icon={icon} tone={tone} />
    <div>
      <small>{label}</small>
      <strong>{value}</strong>
      {detail ? <span>{detail}</span> : null}
      {action}
    </div>
  </div>;
}

function HomeGlanceRow({ icon, label, value, note, tone = "gold" }: { readonly icon: LucideIcon; readonly label: string; readonly value: string; readonly note?: string; readonly tone?: HomeOverviewIconTone }) {
  return <div className="home-glance-row">
    <HomeOverviewIcon icon={icon} tone={tone} />
    <div><span>{label}</span>{note ? <small>{note}</small> : null}</div>
    <strong>{value}</strong>
  </div>;
}

export interface HomeOverviewTopProps {
  readonly monthlyMinor: number;
  readonly biweeklyMinor: number;
  readonly annualMinor: number;
  readonly homeEquityMinor: number | null;
  readonly latestPropertyValueMinor: number | null;
  readonly mortgageBalanceMinor: number | null;
  readonly mortgageStatus: string | null;
  readonly mortgageTerm: HomeMortgageTermView | null;
  readonly liabilityMinor: number;
  readonly cashFlowHref: string;
  readonly cashFlowLinked: boolean;
  readonly householdCashFlowLinks: readonly HomeHouseholdCashFlowLinkView[];
  readonly householdCashFlowAccounts: readonly AccountOption[];
  readonly todayIso: string;
}

export function HomeOverviewTop({
  monthlyMinor,
  biweeklyMinor,
  annualMinor,
  homeEquityMinor,
  latestPropertyValueMinor,
  mortgageBalanceMinor,
  mortgageStatus,
  mortgageTerm,
  liabilityMinor,
  cashFlowHref,
  cashFlowLinked,
  householdCashFlowLinks,
  householdCashFlowAccounts,
  todayIso,
}: HomeOverviewTopProps) {
  const monthlyCashFlowLink = householdLinkFor(householdCashFlowLinks, "monthly");
  const biweeklyCashFlowLink = householdLinkFor(householdCashFlowLinks, "biweekly");
  const anyHouseholdLinked = householdCashFlowLinks.some((link) => link.seriesState !== "ended");
  return <>
    <section className="home-overview-top" aria-label="Home overview summary">
      <article className="home-summary-hero">
        <div className="home-summary-content">
          <p className="eyebrow">Household summary</p>
          <h2>Your household obligations at a glance</h2>
          <div className="home-summary-value">{dollars(monthlyMinor)} <span>/ month</span></div>
          <p className="home-summary-caption">Recurring costs plus one maintenance reserve</p>
          <HouseholdCashFlowControls
            compact
            frequency="monthly"
            amountMinor={monthlyMinor}
            link={monthlyCashFlowLink}
            anyHouseholdLinked={anyHouseholdLinked}
            accounts={householdCashFlowAccounts}
            todayIso={todayIso}
          />
        </div>
        <div className="home-summary-metrics">
          <HomeSummaryMetric
            icon={CalendarDays}
            label="Bi-weekly costs"
            value={dollars(biweeklyMinor)}
            detail=""
            action={<HouseholdCashFlowControls compact frequency="biweekly" amountMinor={biweeklyMinor} link={biweeklyCashFlowLink} anyHouseholdLinked={anyHouseholdLinked} accounts={householdCashFlowAccounts} todayIso={todayIso} />}
            tone="ring-gold"
          />
          <HomeSummaryMetric icon={Receipt} label="Annual costs" value={dollars(annualMinor)} detail="Annual household reserve" tone="ring-gold" />
          <HomeSummaryMetric icon={TrendingUp} label="Home equity" value={dollars(homeEquityMinor)} detail="Market value minus mortgage" tone="ring-gold" />
        </div>
      </article>

      <div className="home-overview-side">
        <div className="home-liabilities-card-container">
          <article className="home-liabilities-card">
            <div className="home-liabilities-summary">
              <div className="home-liabilities-heading"><HomeOverviewIcon icon={Landmark} tone="navy" /><div><p className="eyebrow">Liabilities snapshot</p><strong>{dollars(liabilityMinor)}</strong></div></div>
              <span>Current balances from Database</span>
            </div>
            <div className="home-cash-flow-summary">
              <div className="home-cash-flow-heading"><HomeOverviewIcon icon={ArrowLeftRight} tone="gold" /><div><small>All recurring costs are linked in</small><strong>Cash Flow</strong></div></div>
              <a href={cashFlowHref}>{cashFlowLinked ? "View in Cash Flow" : "Open Cash Flow"}<ArrowRight aria-hidden="true" size={15} strokeWidth={1.8} /></a>
            </div>
          </article>
        </div>

        <article className="home-glance-card">
          <Image src="/brand/athena-vault-background-mountains-houses.png" alt="" width={713} height={459} sizes="300px" className="home-glance-art" aria-hidden="true" loading="eager" fetchPriority="high" />
          <div className="home-glance-head"><p className="eyebrow">At a glance</p></div>
          <div className="home-glance-list">
            <HomeGlanceRow icon={ArrowLeftRight} label="Cash Flow coverage" value={cashFlowLinked ? "Covered" : "Not linked"} tone={cashFlowLinked ? "positive" : "neutral"} />
            <HomeGlanceRow icon={House} label="Property value" value={dollars(latestPropertyValueMinor)} note="Latest confirmed value" />
            <HomeGlanceRow icon={Receipt} label="Mortgage balance" value={dollars(mortgageBalanceMinor)} note={mortgageStatusLabel(mortgageStatus)} />
          </div>
          {mortgageTerm ? <p className="home-glance-source">Payment {dollars(mortgageTerm.paymentMinor)} · {rateLabel(mortgageTerm.annualRateBps)} · renewal {displayDate(mortgageTerm.renewalOn)}</p> : <p className="home-glance-source">All values are owner-scoped and synced from the Database.</p>}
        </article>
      </div>
    </section>

    <section className="home-overview-mobile" aria-label="Home pulse">
      <article className="home-mobile-pulse">
        <AnimatedLineBackground lineCount={7} opacity={0.24} speed={18} scale={1.08} strokeWidth={1.05} density={0.95} drift={0.18} waveAmplitude={32} pulseStrength={0.74} direction="right-to-left" color="#9F9270" accentColor="#E0C681" seed="home-mobile-pulse" className="animated-line-background--home-mobile" />
        <div className="home-mobile-pulse-copy">
          <p className="eyebrow">Home pulse</p>
          <h2>Household costs</h2>
          <div className="home-mobile-pulse-value">{dollars(monthlyMinor)} <span>/ month</span></div>
          <p>Recurring household costs plus annual maintenance reserve.</p>
        </div>
        <div className="home-mobile-pulse-actions">
          <a href={cashFlowHref} className="home-mobile-primary-action">{cashFlowLinked ? "View in Cash Flow" : "Open Cash Flow"}<ArrowRight aria-hidden="true" size={16} strokeWidth={1.9} /></a>
          <details className="home-mobile-automation">
            <summary>
              <span className="home-mobile-automation-copy">
                <span className="home-mobile-automation-label">Cash Flow automation</span>
                <span className="home-mobile-automation-meta">{anyHouseholdLinked ? "Household total linked" : "Optional setup"}</span>
              </span>
              <ChevronDown className="home-mobile-automation-chevron" aria-hidden="true" size={18} strokeWidth={1.8} />
            </summary>
            <div className="home-mobile-pulse-controls" aria-label="Household Cash Flow actions">
              <HouseholdCashFlowControls compact frequency="monthly" amountMinor={monthlyMinor} link={monthlyCashFlowLink} anyHouseholdLinked={anyHouseholdLinked} accounts={householdCashFlowAccounts} todayIso={todayIso} />
              <HouseholdCashFlowControls compact frequency="biweekly" amountMinor={biweeklyMinor} link={biweeklyCashFlowLink} anyHouseholdLinked={anyHouseholdLinked} accounts={householdCashFlowAccounts} todayIso={todayIso} />
            </div>
          </details>
        </div>
        <div className="home-mobile-pulse-stats" role="group" aria-label="Home financial snapshot">
          <div><span>Bi-weekly</span><strong>{dollars(biweeklyMinor)}</strong></div>
          <div><span>Annual reserve</span><strong>{dollars(annualMinor)}</strong></div>
          <div><span>Home equity</span><strong>{dollars(homeEquityMinor)}</strong></div>
        </div>
      </article>
      <article className="home-mobile-snapshot" id="home-property-summary">
        <div className="home-mobile-snapshot-head">
          <div><p className="eyebrow">At a glance</p><h3>Property &amp; mortgage</h3></div>
          <span className={`home-mobile-status ${cashFlowLinked ? "is-positive" : "is-neutral"}`}>{cashFlowLinked ? "Cash Flow linked" : "Needs linking"}</span>
        </div>
        <div className="home-mobile-snapshot-list">
          <div><span>Property value</span><strong>{dollars(latestPropertyValueMinor)}</strong></div>
          <div><span>Mortgage balance</span><strong>{dollars(mortgageBalanceMinor)}</strong></div>
          <div><span>Other liabilities</span><strong>{dollars(liabilityMinor)}</strong></div>
        </div>
        <p className="home-mobile-snapshot-note">{mortgageTerm ? `Payment ${dollars(mortgageTerm.paymentMinor)} · ${rateLabel(mortgageTerm.annualRateBps)} · renewal ${displayDate(mortgageTerm.renewalOn)}` : "All values are owner-scoped and synced from the Database."}</p>
        <HomeMobileDetailsLink targetId="home-property-details" className="home-mobile-text-action">Manage home details</HomeMobileDetailsLink>
      </article>
    </section>
  </>;
}
