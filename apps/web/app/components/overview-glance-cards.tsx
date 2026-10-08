import React, { type ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { SERIES_CONFIG, SERIES_ICONS, type NetWorthHistorySeriesConfig } from "./net-worth-history-data";
import type { SparklinePaths } from "./net-worth-history-geometry";

export const GLANCE_SERIES = SERIES_CONFIG.filter((series) => series.key !== "netWorth").map((series) =>
  series.key === "homeEquity" ? { ...series, metricLabel: "Home Equity" }
    : series.key === "cashOther" ? { ...series, metricLabel: "Cash & Other" }
      : series);

interface AccountGlanceCardProps {
  readonly series: NetWorthHistorySeriesConfig;
  readonly icon?: LucideIcon;
  readonly valueText: ReactNode;
  readonly changeText: ReactNode;
  readonly changeMinor: number | null;
  readonly caption: string;
  readonly sparklinePaths: SparklinePaths | null;
}

function OverviewGlanceIcon({ icon: Icon }: { readonly icon: LucideIcon }) {
  return <span className="overview-icon is-gold" aria-hidden="true"><Icon size={16} strokeWidth={1.8} /></span>;
}

export function AccountGlanceCard({ series, icon, valueText, changeText, changeMinor, caption, sparklinePaths }: AccountGlanceCardProps) {
  const Icon = icon ?? SERIES_ICONS[series.key];
  const changeDirection = changeMinor === null || changeMinor === 0 ? "is-unavailable" : changeMinor > 0 ? "is-positive" : "is-negative";
  return <article className={`overview-glance-card ${series.className}`}>
    <div className="overview-glance-card-head">
      <OverviewGlanceIcon icon={Icon} />
      <div className="overview-glance-card-name">
        <p>{series.metricLabel}</p>
        <strong>{valueText}</strong>
      </div>
      <div className="overview-glance-card-change">
        <strong className={changeDirection}>{changeText}</strong>
        <small>{caption}</small>
      </div>
    </div>
    <div className="overview-glance-card-sparkline" aria-hidden="true">
      {sparklinePaths ? (
        <svg viewBox="0 0 220 38" preserveAspectRatio="none">
          <path className="overview-glance-card-sparkline-area" d={sparklinePaths.area} />
          <path className="overview-glance-card-sparkline-line" d={sparklinePaths.line} />
        </svg>
      ) : series.key === "netWorth" ? <span className="overview-glance-card-sparkline-flat" /> : <span />}
    </div>
  </article>;
}

export function OverviewAccountsGlance({ children }: { readonly children: ReactNode }) {
  return <section className="overview-accounts-glance" aria-label="Accounts at a glance">
    <div className="overview-accounts-glance-head">
      <p className="eyebrow">Accounts at a glance</p>
      <Link href="/accounts" className="eyebrow">View all accounts →</Link>
    </div>
    <div className="overview-accounts-glance-grid">{children}</div>
  </section>;
}
