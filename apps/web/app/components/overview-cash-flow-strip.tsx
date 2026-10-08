import React, { type ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowDownLeft, ArrowUp, ArrowUpRight, CalendarDays, TrendingDown, TrendingUp, Wallet, type LucideIcon } from "lucide-react";
import { formatMoneyMinor, formatSignedMoneyMinor } from "../../lib/format-money";

const dollars = (minor: number) => formatMoneyMinor(minor);
const signedDollars = (minor: number) => formatSignedMoneyMinor(minor, { zeroSign: "+" });

function OverviewMoney({ value }: { readonly value: string }) {
  return <span className="overview-money">{value}</span>;
}

function moneyOrUnavailable(minor: number | null): string {
  return minor === null ? "Unavailable" : dollars(minor);
}

type OverviewIconTone = "navy" | "gold" | "positive" | "expense";

function OverviewIcon({ icon: Icon, tone = "navy" }: { readonly icon: LucideIcon; readonly tone?: OverviewIconTone }) {
  return <span className={`overview-icon is-${tone}`} aria-hidden="true"><Icon size={16} strokeWidth={1.8} /></span>;
}

function MetricCell({ label, value, icon, tone = "navy", emphasis }: {
  readonly label: string;
  readonly value: ReactNode;
  readonly icon: LucideIcon;
  readonly tone?: OverviewIconTone;
  readonly emphasis?: "positive" | "negative" | "up" | "down";
}) {
  const className = emphasis === "positive" || emphasis === "up"
    ? emphasis === "up" ? "cash-flow-change is-up" : "positive"
    : emphasis === "negative" || emphasis === "down"
      ? emphasis === "down" ? "cash-flow-change is-down" : "negative"
      : undefined;
  return <div className="overview-period-metric">
    <OverviewIcon icon={icon} tone={tone} />
    <div className="overview-period-metric-content">
      <small>{label}</small>
      <strong className={className}>{value}</strong>
    </div>
  </div>;
}

interface CashFlowPeriod {
  readonly label: string;
  readonly rangeLabel: string;
  readonly status: string;
  readonly payDateLabel: string;
  readonly href: string;
  readonly openingBalanceMinor: number | null;
  readonly incomeMinor: number;
  readonly spendingMinor: number;
  readonly transfersInMinor: number;
  readonly transfersOutMinor: number;
  readonly changeMinor: number | null;
}

function statusClass(status: string): string {
  if (status === "actual") return "is-actual";
  if (status === "projected" || status === "planned") return "is-projected";
  return "is-mixed";
}

export function CashFlowStrip({ period }: { readonly period: CashFlowPeriod | null }) {
  if (!period) {
    return <article className="card overview-current-period-card overview-cash-flow-strip">
      <div className="card-head">
        <div>
          <h3 className="card-title">Current period</h3>
          <p className="card-subtitle">No current period</p>
        </div>
      </div>
      <div className="insight"><strong>No current period:</strong> Database has no pay period available for today.</div>
    </article>;
  }

  const changeEmphasis = period.changeMinor === null
    ? undefined
    : period.changeMinor >= 0 ? "up" as const : "down" as const;
  const changeIcon = period.changeMinor !== null && period.changeMinor < 0 ? TrendingDown : TrendingUp;
  const changeTone: OverviewIconTone = period.changeMinor === null ? "navy" : period.changeMinor >= 0 ? "positive" : "expense";

  return <article className="card overview-current-period-card overview-cash-flow-strip">
    <div className="overview-current-period-head overview-cash-flow-strip-head">
      <div>
        <p className="eyebrow">Cash flow</p>
        <h3 className="card-title">Current period</h3>
        <p className="card-subtitle">{period.label} · {period.rangeLabel}</p>
      </div>
      <div className="overview-current-period-head-meta overview-cash-flow-strip-head-meta">
        <div className="overview-current-period-status-date">
          <span className={`timeline-status-badge overview-period-status ${statusClass(period.status)}`}>Current</span>
          <div className="period-date overview-period-date"><CalendarDays aria-hidden="true" size={15} strokeWidth={1.8} />{period.payDateLabel}</div>
        </div>
        <Link href={period.href} className="account-secondary-button overview-open-cash-flow">Open in Cash Flow<ArrowUpRight aria-hidden="true" size={15} strokeWidth={1.8} /></Link>
      </div>
    </div>

    <div className="overview-current-period-metrics overview-cash-flow-strip-metrics">
      <MetricCell icon={Wallet} tone="navy" label="Opening" value={<OverviewMoney value={moneyOrUnavailable(period.openingBalanceMinor)} />} />
      <MetricCell icon={ArrowUp} tone="gold" label="Income" value={<OverviewMoney value={dollars(period.incomeMinor)} />} emphasis="positive" />
      <MetricCell icon={ArrowDown} tone="gold" label="Spending" value={<OverviewMoney value={dollars(period.spendingMinor)} />} emphasis="negative" />
      <MetricCell icon={ArrowDownLeft} tone="gold" label="Transfers in" value={<OverviewMoney value={dollars(period.transfersInMinor)} />} />
      <MetricCell icon={ArrowUpRight} tone="gold" label="Transfers out" value={<OverviewMoney value={dollars(period.transfersOutMinor)} />} />
      <MetricCell
        icon={changeIcon}
        tone={changeTone}
        label="Change"
        value={<OverviewMoney value={period.changeMinor === null ? "Unavailable" : signedDollars(period.changeMinor)} />}
        emphasis={changeEmphasis}
      />
    </div>
  </article>;
}
