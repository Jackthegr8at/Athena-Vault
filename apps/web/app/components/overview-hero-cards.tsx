import React from "react";
import Link from "next/link";
import { ArrowRight, Coins, TrendingDown, TrendingUp } from "lucide-react";
import { formatMoneyMinor, formatSignedMoneyMinor } from "../../lib/format-money";
import { formatFullDate } from "./net-worth-history-data";

const dollars = (minor: number) => formatMoneyMinor(minor);
const signedDollars = (minor: number) => formatSignedMoneyMinor(minor, { zeroSign: "+" });

function OverviewMoney({ value }: { readonly value: string }) {
  return <span className="overview-money">{value}</span>;
}

function statusClass(status: string): string {
  if (status === "actual") return "is-actual";
  if (status === "projected" || status === "planned") return "is-projected";
  return "is-mixed";
}

interface NetWorthHeroCardProps {
  readonly netWorthMinor: number;
  readonly changeMinor: number | null;
  readonly changePercentText: string | null;
  readonly changeFromAsOf: string | null;
  readonly homeEquityMinor: number;
  readonly homeShare: number | null;
  readonly investmentsMinor: number | null;
  readonly investmentsShare: number | null;
  readonly monthlyContributionMinor: number;
}

export function NetWorthHeroCard({
  netWorthMinor,
  changeMinor,
  changePercentText,
  changeFromAsOf,
  homeEquityMinor,
  homeShare,
  investmentsMinor,
  investmentsShare,
  monthlyContributionMinor,
}: NetWorthHeroCardProps) {
  return <article className="card hero-card overview-net-worth-hero" style={{ backgroundImage: 'url("/brand/overview_back_hero.png")', backgroundSize: "cover", backgroundPosition: "center" }}>
    <div className="overview-hero-copy">
      <div className="eyebrow">Total net worth</div>
      <div className="hero-value"><OverviewMoney value={dollars(netWorthMinor)} /></div>
      {changeMinor !== null ? (
        <div className={`overview-hero-change ${changeMinor > 0 ? "is-positive" : changeMinor < 0 ? "is-negative" : "is-unavailable"}`}>
          {changeMinor < 0 ? <TrendingDown aria-hidden="true" size={16} strokeWidth={1.8} /> : <TrendingUp aria-hidden="true" size={16} strokeWidth={1.8} />}
          <strong><OverviewMoney value={signedDollars(changeMinor)} /></strong>
          {changePercentText ? <span>{changePercentText}</span> : null}
          {changeFromAsOf ? <small>vs. {formatFullDate(changeFromAsOf)}</small> : null}
        </div>
      ) : <div className="overview-hero-change is-unavailable"><small>No prior data</small></div>}
      <div className="hero-caption">Financial accounts plus current Home equity</div>
      <div className="hero-footer">
        <div className="mini-stat">
          <small>Home equity</small>
          <strong><OverviewMoney value={dollars(homeEquityMinor)} /></strong>
          {homeShare !== null ? <span className="hero-share">{homeShare}% of net worth</span> : null}
        </div>
        <div className="mini-stat">
          <small>Investments</small>
          <strong><OverviewMoney value={investmentsMinor === null ? "Unavailable" : dollars(investmentsMinor)} /></strong>
          <span className="hero-share">{investmentsShare !== null ? `${investmentsShare}% of net worth` : <><OverviewMoney value={dollars(monthlyContributionMinor)} /> monthly contribution</>}</span>
        </div>
      </div>
    </div>
    <p className="overview-hero-motto">
      PRUDENCE
      <br />
      BUILDS
      <br />
      FREEDOM
    </p>
  </article>;
}

interface NearTermCashCardProps {
  readonly currentPeriod: {
    readonly status: string;
    readonly href: string;
    readonly changeMinor: number | null;
    readonly availableBeforeNextPayMinor: number | null;
  } | null;
  readonly periodProgress: number | null;
}

export function NearTermCashCard({ currentPeriod, periodProgress }: NearTermCashCardProps) {
  const availableMinor = currentPeriod?.availableBeforeNextPayMinor ?? null;
  const changeMinor = currentPeriod?.changeMinor ?? null;
  const changeTone = changeMinor === null || changeMinor === 0
    ? "is-unavailable"
    : changeMinor > 0 ? "is-positive" : "is-negative";
  return <article className="card overview-ops-card">
    <div className="overview-ops-head">
      <div className="overview-ops-heading">
        <span className="overview-icon is-gold" aria-hidden="true"><Coins size={16} strokeWidth={1.8} /></span>
        <div>
          <p className="eyebrow">Near-term cash</p>
        </div>
      </div>
      {currentPeriod ? (
        <span className={`timeline-status-badge overview-period-status ${statusClass(currentPeriod.status)}`}>
          Current
        </span>
      ) : null}
    </div>
    <div className="overview-ops-value"><OverviewMoney value={availableMinor === null ? "Unavailable" : dollars(availableMinor)} /></div>
    {currentPeriod ? (
      <Link href={currentPeriod.href} className="overview-ops-caption overview-ops-period-link">
        Available before next pay <ArrowRight aria-hidden="true" size={16} strokeWidth={1.8} />
      </Link>
    ) : <p className="overview-ops-caption">No current period available</p>}
    <div className="overview-ops-divider" aria-hidden="true" />
    <div className="overview-ops-meta">
      {currentPeriod ? (
        <div>
          <small>Period change</small>
          <span className={`overview-hero-change overview-period-change-row ${changeTone}`}>
            {changeMinor === null ? null : changeMinor < 0
              ? <TrendingDown aria-hidden="true" size={16} strokeWidth={1.8} />
              : <TrendingUp aria-hidden="true" size={16} strokeWidth={1.8} />}
            <strong className="overview-period-change-amount">
              {changeMinor === null ? "—" : <OverviewMoney value={signedDollars(changeMinor)} />}
            </strong>
          </span>
          <span>vs. previous period</span>
        </div>
      ) : null}
      {periodProgress !== null ? (
        <div>
          <small>Period progress</small>
          <strong>{periodProgress}%</strong>
          <span>of total net worth</span>
          <div className="overview-ops-progress" aria-hidden="true"><span style={{ width: `${periodProgress}%` }} /></div>
        </div>
      ) : null}
    </div>
  </article>;
}
