import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type NetWorthHistoryModel } from "@athena/finance-engine";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateOnboardingStateAction: vi.fn(async () => ({ ok: false, message: "", state: null })),
  updateOwnerDisplayNameAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  usePathname: vi.fn(() => "/"),
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() })),
}));

vi.mock("../onboarding-actions", () => ({ updateOnboardingStateAction: mocks.updateOnboardingStateAction }));
vi.mock("../overview-actions", () => ({ updateOwnerDisplayNameAction: mocks.updateOwnerDisplayNameAction }));
vi.mock("./page-help-actions", () => ({ markPageHelpSeen: vi.fn(async () => undefined) }));
vi.mock("next/navigation", () => ({ usePathname: mocks.usePathname, useRouter: mocks.useRouter }));

import { DashboardClient, type DashboardInitialData } from "./dashboard-client";

vi.stubGlobal("React", React);

const history: NetWorthHistoryModel = {
  currency: "CAD",
  evaluationDate: "2026-09-14",
  historicalFrom: "2026-08-01",
  projectedThrough: "2026-10-01",
  firstProjectedAsOf: "2026-10-01",
  selectedRange: "1y",
  defaultRange: "1y",
  points: [
    { asOf: "2026-08-01", phase: "actual", isFirstProjected: false, netWorthMinor: 24_000, investmentsMinor: 7_500, homeEquityMinor: 12_000, cashOtherMinor: 4_500 },
    { asOf: "2026-09-01", phase: "actual", isFirstProjected: false, netWorthMinor: 25_000, investmentsMinor: 8_000, homeEquityMinor: 12_000, cashOtherMinor: 5_000 },
    { asOf: "2026-10-01", phase: "projected", isFirstProjected: true, netWorthMinor: 26_000, investmentsMinor: 8_500, homeEquityMinor: 12_000, cashOtherMinor: 5_500 },
  ],
  changes: [],
};

const data: DashboardInitialData = {
  isDemo: false,
  ownerLabel: "Jack",
  ownerDisplayName: "Jack",
  greeting: "Good morning",
  dateLabel: "Monday, September 14, 2026",
  todayIso: "2026-09-14",
  activeAccountCount: 2,
  totalPeriodCount: 4,
  hasCurrentBalance: true,
  hasActiveRecurringMovement: true,
  hasHomeProfile: true,
  currentPeriod: {
    id: "period-1",
    label: "Pay period 1",
    payDate: "2026-09-16",
    payDateLabel: "Sep 16, 2026",
    startsOn: "2026-09-02",
    endsOn: "2026-09-15",
    rangeLabel: "Sep 02, 2026 – Sep 15, 2026",
    status: "actual",
    openingBalanceMinor: 10_000,
    incomeMinor: 5_000,
    spendingMinor: 1_250,
    transfersInMinor: 0,
    transfersOutMinor: 500,
    changeMinor: 3_250,
    availableBeforeNextPayMinor: 13_250,
    href: "/cash-flow?period=period-1",
  },
  timeline: [
    { id: "movement-income", periodId: "period-1", date: "2026-09-10", name: "Paycheque", note: "Salary · Main chequing · actual", category: "Salary", kind: "income", status: "actual", amountMinor: 5_000, positive: true },
    { id: "movement-expense", periodId: "period-1", date: "2026-09-12", name: "Groceries", note: "Groceries · Main chequing · planned", category: "Groceries", kind: "expense", status: "planned", amountMinor: 1_250, positive: false },
  ],
  annual: { year: 2026, totalMinor: 12_000, fundedMinor: 4_000, remainingMinor: 8_000 },
  investments: { monthlyContributionMinor: 500 },
  homeEquityMinor: 12_000,
  liabilitiesMinor: 2_000,
  netWorthMinor: 25_000,
  netWorthHistory: history,
  nextPeriodId: "period-1",
  onboarding: { state: "active", account: true, balance: false, recurring: false, completedCount: 1, nextStepId: "balance" },
  overviewHelpSeen: true,
};

describe("Overview presentation", () => {
  it("renders the net-worth hero, current-period actions, semantic movement rows, and guide", () => {
    const markup = renderToStaticMarkup(React.createElement(DashboardClient, { data, isAdmin: false }));

    expect(markup).toContain("DISCIPLINE TODAY. A RICHER TOMORROW.");
    expect(markup).toContain("Good morning,");
    expect(markup).toContain('overview-greeting-name">Jack.');
    expect(markup).toContain("A HIGHER STANDARD FOR WHAT&#x27;S POSSIBLE.");
    expect(markup).toContain('class="main module-page-art module-page-art-overview"');
    expect(markup).toContain("overview-net-worth-hero");
    expect(markup).toContain("/brand/overview_back_hero.png");
    expect(markup).toContain("overview-hero-change");
    expect(markup).toContain("$250.00");
    expect(markup).toContain("Available before next pay");
    expect(markup).toContain('href="/cash-flow?period=period-1"');
    expect(markup).toContain("overview-accounts-glance");
    expect(markup).toContain("Accounts at a glance");
    expect(markup).toContain("overview-glance-card is-investments");
    expect(markup).toContain("overview-glance-card is-home-equity");
    expect(markup).toContain("overview-glance-card is-cash-other");
    expect(markup).toContain("overview-glance-card is-liabilities");
    expect(markup).toContain("Investments");
    expect(markup).toContain("Home Equity");
    expect(markup).toContain("Cash &amp; Other");
    expect(markup).toContain("Liabilities");
    expect(markup).toContain("Opening");
    expect(markup).toContain("Income");
    expect(markup).toContain("Spending");
    expect(markup).toContain("Transfers in");
    expect(markup).toContain("Transfers out");
    expect(markup).toContain("Change");
    expect(markup).toContain("Open in Cash Flow");
    expect(markup).toContain("overview-analysis-grid");
    expect(markup).toContain("overview-perspective-card");
    expect(markup).toContain("overview-perspective-art");
    expect(markup).toContain("A calmer relationship with money. A fuller life.");
    expect(markup).toContain('href="/investments"');
    expect(markup).toContain("overview-cash-flow-strip");
    expect(markup).toContain("Wealth gives you the freedom to live a more examined life.");
    expect(markup).toContain("— Athena Vault");
    expect(markup).toContain("PRUDENCE");
    expect(markup).toContain("BUILDS");
    expect(markup).toContain("FREEDOM");
    expect(markup).toContain("Upcoming movements");
    expect(markup).toContain("Groceries");
    expect(markup).toContain("overview-movement-badge is-expense");
    expect(markup).toContain("overview-movement-status is-planned");
    expect(markup).toContain("Build your financial starting point");
    expect(markup).toContain('aria-label="Open Overview help"');
  });

  it("mounts each interactive overview surface once for responsive recomposition", () => {
    const markup = renderToStaticMarkup(React.createElement(DashboardClient, { data, isAdmin: false }));
    const count = (needle: string): number => markup.split(needle).length - 1;

    expect(count('class="net-worth-history-card')).toBe(1);
    expect(count('class="timeline-row')).toBe(data.timeline.length);
    expect(count('class="card overview-ops-card')).toBe(1);
    expect(count('class="card overview-current-period-card overview-cash-flow-strip"')).toBe(1);
    expect(count('class="overview-mobile-breakdown"')).toBe(1);

    expect(markup).toContain('href="/cash-flow?period=period-1"');
    expect(markup).toContain("Available before next pay");
    expect(markup).toContain("View account breakdown");
    expect(markup).toContain("Cash &amp; other");
    expect(markup).toContain("Liabilities");
    expect(markup).not.toContain("overview-mobile-body");
    expect(markup).not.toContain("overview-mobile-history-card");
    expect(markup).not.toContain("overview-mobile-upcoming-card");
  });

  it("derives period progress from todayIso rather than the host clock", () => {
    vi.useFakeTimers();
    try {
      // Host clock sits near the start of the fixture period (2026-09-02 → 2026-09-15).
      vi.setSystemTime(new Date("2026-09-05T12:00:00Z"));
      const markup = renderToStaticMarkup(React.createElement(DashboardClient, { data, isAdmin: false }));

      // todayIso 2026-09-14 is 12 of 13 days elapsed → 92%; the host clock would imply 23%.
      expect(markup).toContain("<strong>92%</strong>");
      expect(markup).not.toContain("<strong>23%</strong>");
    } finally {
      vi.useRealTimers();
    }
  });

});
