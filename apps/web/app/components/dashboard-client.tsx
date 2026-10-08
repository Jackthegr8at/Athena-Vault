"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  ArrowRight,
  Briefcase,
  CheckCircle2,
  CalendarDays,
  Clock,
  CreditCard,
  PiggyBank,
  Plane,
  Receipt,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react";
import { type NetWorthHistoryModel, type NetWorthHistoryPoint } from "@athena/finance-engine";
import { cashFlowPeriodHref } from "../cash-flow/presentation";
import { formatMoneyMinor, formatSignedMoneyMinor } from "../../lib/format-money";
import { GettingStartedCard } from "./getting-started-card";
import { OVERVIEW_PAGE_HELP_CONTENT } from "./page-help-content";
import { PageHelpDrawer } from "./page-help-drawer";
import { updateOwnerDisplayNameAction } from "../overview-actions";
import { initialOverviewActionState } from "../overview-action-helpers";
import { buildOverviewHelpSnapshot } from "../overview-presentation";
import type { OnboardingSnapshot } from "../onboarding-types";
import { AppMobileNav } from "./app-mobile-nav";
import { AppSidebar } from "./app-shell";
import { useAutoDismiss } from "./use-auto-dismiss";
import { UserMenu } from "./user-menu";
import { NetWorthHistoryChart } from "./net-worth-history-chart";
import {
  metricPercent,
  metricSnapshot,
  type MetricSnapshot,
  SERIES_CONFIG,
  type NetWorthHistorySeriesConfig,
} from "./net-worth-history-data";
import { buildSparklinePaths } from "./net-worth-history-geometry";
import { NearTermCashCard, NetWorthHeroCard } from "./overview-hero-cards";
import { AccountGlanceCard, GLANCE_SERIES, OverviewAccountsGlance } from "./overview-glance-cards";
import { CashFlowStrip } from "./overview-cash-flow-strip";

const dollars = (minor: number) => formatMoneyMinor(minor);
const signedDollars = (minor: number) => formatSignedMoneyMinor(minor, { zeroSign: "+" });

function OverviewMoney({ value }: { readonly value: string }) {
  return <span className="overview-money">{value}</span>;
}

export type DashboardMovementKind = "income" | "expense" | "transfer";

export interface DashboardTimelineItem {
  readonly id: string;
  readonly periodId: string;
  readonly date: string;
  readonly name: string;
  readonly note: string;
  readonly category: string | null;
  readonly kind: DashboardMovementKind;
  readonly status: string;
  readonly amountMinor: number;
  readonly positive: boolean;
}

export interface DashboardCurrentPeriodSummary {
  readonly id: string;
  readonly label: string;
  readonly payDate: string;
  readonly payDateLabel: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly rangeLabel: string;
  readonly status: string;
  readonly openingBalanceMinor: number | null;
  readonly incomeMinor: number;
  readonly spendingMinor: number;
  readonly transfersInMinor: number;
  readonly transfersOutMinor: number;
  readonly changeMinor: number | null;
  readonly availableBeforeNextPayMinor: number | null;
  readonly href: string;
}

export interface DashboardInitialData {
  readonly isDemo: boolean;
  readonly ownerLabel: string;
  readonly ownerDisplayName: string | null;
  readonly greeting: string;
  readonly dateLabel: string;
  readonly todayIso: string;
  readonly activeAccountCount: number;
  readonly totalPeriodCount: number;
  readonly hasCurrentBalance: boolean;
  readonly hasActiveRecurringMovement: boolean;
  readonly hasHomeProfile: boolean;
  readonly currentPeriod: DashboardCurrentPeriodSummary | null;
  readonly timeline: readonly DashboardTimelineItem[];
  readonly annual: { readonly year: number; readonly totalMinor: number; readonly fundedMinor: number; readonly remainingMinor: number };
  readonly investments: { readonly monthlyContributionMinor: number };
  readonly homeEquityMinor: number;
  readonly liabilitiesMinor: number;
  readonly netWorthMinor: number;
  readonly netWorthHistory: NetWorthHistoryModel;
  readonly nextPeriodId: string | null;
  readonly onboarding: OnboardingSnapshot | null;
  readonly overviewHelpSeen: boolean;
}

function statusDisplayLabel(status: string): string {
  if (status === "actual") return "Actual";
  if (status === "projected" || status === "planned") return "Planned";
  if (status === "pending") return "Pending";
  if (status === "mixed") return "Mixed";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function movementKindLabel(kind: DashboardMovementKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function movementCategoryLabel(item: DashboardTimelineItem): string {
  return item.category ?? movementKindLabel(item.kind);
}

function movementStatusClass(status: string): string {
  if (status === "actual") return "is-actual";
  if (status === "planned" || status === "projected") return "is-planned";
  if (status === "pending") return "is-pending";
  return "is-neutral";
}

function moneyOrUnavailable(minor: number | null): string {
  return minor === null ? "Unavailable" : dollars(minor);
}

function periodProgressPercent(startsOn: string, endsOn: string, todayIso: string): number {
  const start = Date.parse(`${startsOn}T00:00:00Z`);
  const end = Date.parse(`${endsOn}T00:00:00Z`);
  const today = Date.parse(`${todayIso}T00:00:00Z`);
  const total = end - start;
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round(((today - start) / total) * 100)));
}

function overviewActualHistoryPoints(history: NetWorthHistoryModel | null | undefined): NetWorthHistoryPoint[] {
  if (!history) return [];
  return history.points
    .filter((point) => point.phase === "actual" && point.asOf <= history.evaluationDate)
    .sort((left, right) => left.asOf.localeCompare(right.asOf));
}

function latestActualNetWorthPoint(history: NetWorthHistoryModel | null | undefined): NetWorthHistoryPoint | undefined {
  return overviewActualHistoryPoints(history).at(-1);
}

function overviewMetricSnapshot(points: readonly NetWorthHistoryPoint[], series: NetWorthHistorySeriesConfig): MetricSnapshot & { readonly percentText: string | null } {
  const snapshot = metricSnapshot(points, series);
  const fromMinor = snapshot.changeMinor === null || snapshot.currentMinor === null ? null : snapshot.currentMinor - snapshot.changeMinor;
  return { ...snapshot, percentText: metricPercent(snapshot.changeMinor, fromMinor) };
}


function PerspectiveCard({ changeMinor }: { readonly changeMinor: number | null }) {
  const summary = changeMinor === null
    ? "Your net worth story is still taking shape, guided by steady contributions and consistent cash flow."
    : changeMinor > 0
      ? `Your net worth is up ${dollars(changeMinor)} this period, driven by strong investment performance and consistent cash flow.`
      : changeMinor < 0
        ? `Your net worth is down ${dollars(Math.abs(changeMinor))} this period; steady contributions keep the long-term plan on track.`
        : "Your net worth held steady this period, supported by consistent cash flow.";
  return (
    <article className="card overview-perspective-card">
      <span className="overview-perspective-art" aria-hidden="true" />
      <p className="eyebrow">Perspective</p>
      <h3 className="card-title">Steady progress compounds opportunity.</h3>
      <p className="overview-perspective-copy">{summary}</p>
      <Link href="/investments" className="account-primary-button overview-perspective-link">Explore your wealth <ArrowRight aria-hidden="true" size={15} strokeWidth={1.8} /></Link>
      <span className="overview-perspective-quote" aria-hidden="true">“A calmer relationship with money. A fuller life.”</span>
    </article>
  );
}

type OverviewIconTone = "navy" | "gold" | "positive" | "income" | "expense" | "transfer" | "neutral";

function OverviewIcon({ icon: Icon, tone = "gold" }: { readonly icon: LucideIcon; readonly tone?: OverviewIconTone }) {
  return <span className={`overview-icon is-${tone}`} aria-hidden="true"><Icon size={16} strokeWidth={1.8} /></span>;
}

function OverviewMovementIcon({ item }: { readonly item: DashboardTimelineItem }) {
  const category = (item.category ?? "").toLowerCase();
  if (item.kind === "transfer") return <OverviewIcon icon={ArrowLeftRight} tone="transfer" />;
  if (item.kind === "income" || /salary|income|pay/.test(category)) return <OverviewIcon icon={Briefcase} tone="income" />;
  if (/saving|goal|reserve/.test(category)) return <OverviewIcon icon={PiggyBank} tone="expense" />;
  if (/grocery|groceries|beer|food|shop|purchase/.test(category)) return <OverviewIcon icon={ShoppingCart} tone="expense" />;
  if (/travel|trip|flight|vacation/.test(category)) return <OverviewIcon icon={Plane} tone="expense" />;
  if (/annual|payment|tax|insurance/.test(category)) return <OverviewIcon icon={CalendarDays} tone="expense" />;
  return <OverviewIcon icon={Receipt} tone={item.kind === "expense" ? "expense" : "neutral"} />;
}


export function DashboardClient({ data, isAdmin }: { data: DashboardInitialData; isAdmin: boolean }) {
  const [nameDraft, setNameDraft] = useState(data.ownerDisplayName ?? data.ownerLabel);
  const [isEditingName, setIsEditingName] = useState(false);
  const [showNameResponse, setShowNameResponse] = useState(false);
  const [nameState, nameAction, namePending] = useActionState(updateOwnerDisplayNameAction, initialOverviewActionState);
  const previousNameStateRef = useRef(nameState);
  const greeting = data.greeting;
  const nameInputRef = useRef<HTMLInputElement>(null);

  const periodProgress = data.currentPeriod ? periodProgressPercent(data.currentPeriod.startsOn, data.currentPeriod.endsOn, data.todayIso) : null;

  const homeShare = data.netWorthMinor > 0 && data.homeEquityMinor > 0
    ? Math.min(100, Math.round((data.homeEquityMinor * 100) / data.netWorthMinor))
    : null;
  const actualHistoryPoints = overviewActualHistoryPoints(data.netWorthHistory);
  const latestActualPoint = latestActualNetWorthPoint(data.netWorthHistory);
  const netWorthSeries = SERIES_CONFIG.find((series) => series.key === "netWorth");
  const netWorthSnapshot = netWorthSeries ? overviewMetricSnapshot(actualHistoryPoints, netWorthSeries) : null;
  const investmentsShare = data.netWorthMinor > 0 && latestActualPoint?.investmentsMinor != null && latestActualPoint.investmentsMinor > 0
    ? Math.min(100, Math.round((latestActualPoint.investmentsMinor * 100) / data.netWorthMinor))
    : null;
  const overviewHelp = {
    content: OVERVIEW_PAGE_HELP_CONTENT,
    snapshot: buildOverviewHelpSnapshot({
      activeAccountCount: data.activeAccountCount,
      totalPeriodCount: data.totalPeriodCount,
      hasCurrentBalance: data.hasCurrentBalance,
      hasActiveRecurringMovement: data.hasActiveRecurringMovement,
      hasHomeProfile: data.hasHomeProfile,
    }),
  };

  useEffect(() => {
    const isFreshNameState = previousNameStateRef.current !== nameState;
    if (isFreshNameState) {
      setShowNameResponse(Boolean(nameState.message));
      if (!nameState.ok && nameState.fieldErrors.displayName) nameInputRef.current?.focus();
    }
    if (!namePending && nameState.ok && (isFreshNameState || showNameResponse)) setIsEditingName(false);
    previousNameStateRef.current = nameState;
  }, [namePending, nameState, showNameResponse]);

  useAutoDismiss(showNameResponse && nameState.ok, () => setShowNameResponse(false));

  return <div className="app-shell">
    <AppSidebar active="Overview" />
    <main className="main module-page-art module-page-art-overview">
      <header className="topbar overview-topbar">
        <div className="overview-greeting">
          <div className="eyebrow overview-brand-eyebrow">DISCIPLINE TODAY. A RICHER TOMORROW.</div>
          <div className="overview-greeting-row">
            <h2 className="page-title overview-greeting-title">
              <span className="overview-greeting-line">{greeting},</span>
              <span className="overview-greeting-name">{data.ownerLabel}.</span>
            </h2>
            {!isEditingName ? <button
              type="button"
              className="overview-edit-name-button"
              onClick={() => {
                setNameDraft(data.ownerDisplayName ?? data.ownerLabel);
                setShowNameResponse(false);
                setIsEditingName(true);
              }}
            >Edit name</button> : null}
          </div>
          <p className="overview-greeting-caption">
            <span className="overview-greeting-quote">“Wealth gives you the freedom to live a more examined life.”</span>
            <span className="overview-greeting-quote-source">— Athena Vault</span>
          </p>
          {isEditingName ? <form action={nameAction} className="overview-name-editor" aria-busy={namePending}>
            <div className="overview-name-field">
              <label htmlFor="overview-owner-display-name">Display name</label>
              <input
                id="overview-owner-display-name"
                name="displayName"
                type="text"
                required
                maxLength={80}
                autoFocus
                ref={nameInputRef}
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                aria-invalid={showNameResponse && Boolean(nameState.fieldErrors.displayName)}
                aria-describedby={showNameResponse && nameState.fieldErrors.displayName ? "overview-owner-display-name-error" : undefined}
              />
              {showNameResponse && nameState.fieldErrors.displayName ? <p className="account-field-error" id="overview-owner-display-name-error" role="alert">{nameState.fieldErrors.displayName}</p> : null}
            </div>
            <div className="overview-name-actions">
              <button type="submit" className="account-primary-button" disabled={namePending}>{namePending ? "Saving…" : "Save"}</button>
              <button type="button" className="account-secondary-button" disabled={namePending} onClick={() => { setIsEditingName(false); setShowNameResponse(false); }}>Cancel</button>
            </div>
          </form> : null}
          {showNameResponse && nameState.message ? <p className={`account-message overview-name-message ${nameState.ok ? "is-success" : "is-error"}`} role={nameState.ok ? "status" : "alert"} aria-live="polite">{nameState.message}</p> : null}
        </div>
        <p className="overview-topbar-aside">A HIGHER STANDARD FOR WHAT&apos;S POSSIBLE.</p>
        <div className="top-actions">
          <PageHelpDrawer {...overviewHelp} initialOpen={!data.overviewHelpSeen} demoAutoOpen={data.isDemo} />
          <UserMenu isAdmin={isAdmin} isDemo={data.isDemo} />
        </div>
      </header>

      {data.onboarding ? <GettingStartedCard snapshot={data.onboarding} /> : null}

      <div className="overview-desktop-body">
      <section className="hero-grid overview-hero-grid">
        <div className="overview-net-worth-slot">
          <NetWorthHeroCard
            netWorthMinor={data.netWorthMinor}
            changeMinor={netWorthSnapshot?.changeMinor ?? null}
            changePercentText={netWorthSnapshot?.percentText ?? null}
            changeFromAsOf={netWorthSnapshot?.fromAsOf ?? null}
            homeEquityMinor={data.homeEquityMinor}
            homeShare={homeShare}
            investmentsMinor={latestActualPoint?.investmentsMinor ?? null}
            investmentsShare={investmentsShare}
            monthlyContributionMinor={data.investments.monthlyContributionMinor}
          />
          <details className="overview-mobile-breakdown">
            <summary className="overview-mobile-breakdown-summary">View account breakdown</summary>
            <div className="overview-mobile-breakdown-list">
              <div><span>Investments</span><strong><OverviewMoney value={moneyOrUnavailable(latestActualPoint?.investmentsMinor ?? null)} /></strong></div>
              <div><span>Home equity</span><strong><OverviewMoney value={dollars(data.homeEquityMinor)} /></strong></div>
              <div><span>Cash &amp; other</span><strong><OverviewMoney value={moneyOrUnavailable(latestActualPoint?.cashOtherMinor ?? null)} /></strong></div>
              <div><span>Liabilities</span><strong><OverviewMoney value={data.liabilitiesMinor > 0 ? `−${dollars(data.liabilitiesMinor)}` : dollars(0)} /></strong></div>
            </div>
          </details>
        </div>
        <NearTermCashCard currentPeriod={data.currentPeriod} periodProgress={periodProgress} />
      </section>

      <OverviewAccountsGlance>
          {GLANCE_SERIES.map((series) => {
            const snapshot = overviewMetricSnapshot(actualHistoryPoints, series);
            return (
              <AccountGlanceCard
                key={series.key}
                series={series}
                valueText={<OverviewMoney value={moneyOrUnavailable(snapshot.currentMinor ?? (series.key === "homeEquity" ? data.homeEquityMinor : null))} />}
                changeText={<OverviewMoney value={snapshot.percentText ?? (snapshot.changeMinor === null ? "No change" : signedDollars(snapshot.changeMinor))} />}
                changeMinor={snapshot.changeMinor}
                caption={snapshot.changeMinor === null ? "No prior data" : "vs. last month"}
                sparklinePaths={buildSparklinePaths(actualHistoryPoints, series)}
              />
            );
          })}
          <AccountGlanceCard
            series={{ key: "netWorth", valueKey: "netWorthMinor", label: "Liabilities", metricLabel: "Liabilities", className: "is-liabilities" }}
            icon={CreditCard}
            valueText={<OverviewMoney value={data.liabilitiesMinor > 0 ? signedDollars(-data.liabilitiesMinor) : dollars(0)} />}
            changeText="No change"
            changeMinor={null}
            caption="Current balance"
            sparklinePaths={null}
          />
      </OverviewAccountsGlance>

      <div className="overview-analysis-grid">
        <NetWorthHistoryChart model={data.netWorthHistory} currentNetWorthMinor={data.netWorthMinor} currentLiabilitiesMinor={data.liabilitiesMinor} showMetricStack={false} showChangeSummary={false} />
        <PerspectiveCard changeMinor={netWorthSnapshot?.changeMinor ?? null} />
      </div>

      <CashFlowStrip period={data.currentPeriod} />

      <section className="card section-card overview-timeline-card">
        <div className="overview-timeline-header">
          <div>
            <p className="eyebrow">Cash flow</p>
            <h3 className="card-title">Upcoming movements</h3>
            <p className="card-subtitle">Planned and actual cash movement from upcoming periods</p>
          </div>
          <Link href={data.nextPeriodId ? cashFlowPeriodHref(data.nextPeriodId, false) : "/cash-flow"} className="eyebrow">View cash flow →</Link>
        </div>
        <div className="overview-timeline-columns" aria-hidden="true"><span>Date</span><span></span><span>Description</span><span>Category</span><span>Type</span><span>Status</span><span>Amount</span></div>
        <div className="timeline">
          {data.timeline.length > 0
            ? data.timeline.map((item) => <TimelineRow key={item.id} item={item} />)
            : <div className="insight">
              <strong className="overview-desktop-empty-copy">No timeline records:</strong>
              <strong className="overview-mobile-empty-copy">No upcoming movements:</strong>
              <span> the selected owner has no imported transactions or transfers.</span>
            </div>}
        </div>
      </section>
    </div>
    </main>
    <AppMobileNav active="Overview" isAdmin={isAdmin} isDemo={data.isDemo} />
  </div>;
}

function TimelineRow({ item }: { item: DashboardTimelineItem }) {
  const StatusIcon = item.status === "actual" ? CheckCircle2 : Clock;
  return (
    <div className="timeline-row">
      <div className="timeline-date"><span className="timeline-cell-label">Date</span>{item.date}</div>
      <div className="timeline-movement-icon"><OverviewMovementIcon item={item} /></div>
      <div className="timeline-description"><div className="timeline-name">{item.name}<span className="timeline-note">{item.note}</span></div></div>
      <div className="timeline-category"><span className="timeline-cell-label">Category</span>{movementCategoryLabel(item)}</div>
      <div className="timeline-type"><span className="timeline-cell-label">Type</span><span className={`overview-movement-badge is-${item.kind}`}>{movementKindLabel(item.kind)}</span></div>
      <div className="timeline-status"><span className="timeline-cell-label">Status</span><span className={`overview-movement-status ${movementStatusClass(item.status)}`}><StatusIcon aria-hidden="true" size={12} strokeWidth={1.8} />{statusDisplayLabel(item.status)}</span></div>
      <div className="timeline-amount-action">
        <div className={`amount ${item.positive ? "positive" : "negative"}`}><span className="timeline-cell-label">Amount</span><OverviewMoney value={`${item.positive ? "+" : "-"}${dollars(Math.abs(item.amountMinor))}`} /></div>
        <Link href={`/cash-flow?period=${encodeURIComponent(item.periodId)}`} className="overview-movement-link" aria-label={`Open ${item.name} in Cash Flow`}><ArrowRight aria-hidden="true" size={16} strokeWidth={1.8} /></Link>
      </div>
    </div>
  );
}
