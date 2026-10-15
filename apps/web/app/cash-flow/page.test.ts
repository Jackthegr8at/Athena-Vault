import React, { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ownerId: "00000000-0000-0000-0000-000000000001",
  repository: {
    getPeriodWindow: vi.fn(),
    listRecurringSeries: vi.fn(),
    listExcludedExpenses: vi.fn(),
    countExcludedExpenses: vi.fn(async () => 0),
  },
  createCashFlowRepository: vi.fn(),
  addIsoDays: vi.fn(),
  toTorontoDateIso: vi.fn(),
  recurringCashFlowOccurrencesBetween: vi.fn(),
  withAuthenticatedPageDatabase: vi.fn(),
  modulePage: vi.fn(),
  firstUseCard: vi.fn(),
  timelineSetup: vi.fn(),
  cashFlowClient: vi.fn(),
}));

vi.mock("@athena/database", () => ({
  addIsoDays: mocks.addIsoDays,
  createCashFlowRepository: mocks.createCashFlowRepository,
  recurringCashFlowOccurrencesBetween: mocks.recurringCashFlowOccurrencesBetween,
  toTorontoDateIso: mocks.toTorontoDateIso,
}));
vi.mock("@athena/finance-engine", () => ({ money: (value: number) => value, projectChainedCashFlow: vi.fn() }));
vi.mock("../components/module-page", () => ({ ModulePage: mocks.modulePage }));
vi.mock("../components/module-first-use-card", () => ({ ModuleFirstUseCard: mocks.firstUseCard }));
vi.mock("./initial-timeline-setup", () => ({ InitialCashFlowTimelineSetup: mocks.timelineSetup }));
vi.mock("./client", () => ({ CashFlowClient: mocks.cashFlowClient }));
vi.mock("../../lib/server/owner-database", () => ({ withAuthenticatedPageDatabase: mocks.withAuthenticatedPageDatabase }));
vi.mock("../../lib/server/page-help", () => ({ hasPageHelpSeen: vi.fn(async () => true) }));

import { createCashFlowRepository } from "@athena/database";
import CashFlowPage from "./page";

type CashFlowWindow = Awaited<ReturnType<ReturnType<typeof createCashFlowRepository>["getPeriodWindow"]>>;

function periodWindow(overrides: Partial<CashFlowWindow> = {}): CashFlowWindow {
  return {
    periods: [],
    accounts: [],
    anchors: [],
    paydayChecks: [],
    paydayNotes: [],
    projectionTransactions: [],
    projectionTransfers: [],
    selectedPeriodId: null,
    currentPeriodId: null,
    currentPeriodPayDate: null,
    totalPeriodCount: 0,
    ...overrides,
  };
}

function renderModulePage({ active, title, help, children }: {
  readonly active: string;
  readonly title: string;
  readonly help: { readonly snapshot: { readonly items: readonly { readonly label: string; readonly value: string }[]; readonly action: { readonly label: string; readonly href: string } } };
  readonly children?: ReactNode;
}) {
  return React.createElement("main", { "data-active-module": active },
    React.createElement("h1", null, title),
    React.createElement("dl", { "aria-label": "Cash Flow snapshot" }, ...help.snapshot.items.flatMap(({ label, value }) => [
      React.createElement("dt", { key: `${label}-label` }, label),
      React.createElement("dd", { key: `${label}-value` }, value),
    ])),
    React.createElement("a", { href: help.snapshot.action.href }, help.snapshot.action.label),
    children,
  );
}

describe("Cash Flow route first-use paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    mocks.toTorontoDateIso.mockReturnValue("2026-09-22");
    mocks.addIsoDays.mockImplementation((_date: string, days: number) => days === 364 ? "2027-09-21" : "2026-09-22");
    mocks.recurringCashFlowOccurrencesBetween.mockReturnValue([]);
    mocks.createCashFlowRepository.mockReturnValue(mocks.repository);
    mocks.repository.getPeriodWindow.mockResolvedValue(periodWindow());
    mocks.repository.listRecurringSeries.mockResolvedValue([]);
    mocks.repository.listExcludedExpenses.mockResolvedValue([]);
    mocks.withAuthenticatedPageDatabase.mockImplementation(async (
      callback: (database: unknown, user: unknown) => Promise<unknown>,
    ) => callback({}, { owner: { id: mocks.ownerId } }));
    mocks.modulePage.mockImplementation(renderModulePage);
    mocks.firstUseCard.mockImplementation(({ title, description, actionHref, actionLabel, children }: {
      readonly title: string;
      readonly description: string;
      readonly actionHref?: string;
      readonly actionLabel?: string;
      readonly children?: ReactNode;
    }) => React.createElement("section", null,
      React.createElement("h2", null, title),
      React.createElement("p", null, description),
      actionHref ? React.createElement("a", { href: actionHref }, actionLabel) : null,
      children,
    ));
    mocks.timelineSetup.mockImplementation(({ todayIso, defaultThroughDate }: { readonly todayIso: string; readonly defaultThroughDate: string }) =>
      React.createElement("output", { "data-today": todayIso, "data-through": defaultThroughDate }, "Timeline setup"));
    mocks.cashFlowClient.mockImplementation(() => React.createElement("output", null, "Cash Flow projection"));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("uses authenticated owner-scoped reads and routes an owner without accounts to Accounts", async () => {
    const page = await CashFlowPage({ searchParams: Promise.resolve({ period: ["missing", "ignored"], view: ["all"] }) });
    const html = renderToStaticMarkup(page);

    expect(mocks.withAuthenticatedPageDatabase).toHaveBeenCalledWith(expect.any(Function), { requireTwoFactor: true });
    expect(mocks.createCashFlowRepository).toHaveBeenCalledWith({});
    expect(mocks.repository.getPeriodWindow).toHaveBeenCalledWith(mocks.ownerId, {
      asOfIso: "2026-09-22",
      selectedPeriodId: "missing",
      includeAll: true,
    });
    expect(html).toContain("Create your main account first");
    expect(html).toContain('href="/accounts"');
    expect(html).toContain('aria-label="Cash Flow snapshot"');
    expect(html).toContain("Active accounts");
  });

  it("routes an account with no periods to the labelled timeline setup with the default horizon", async () => {
    mocks.repository.getPeriodWindow.mockResolvedValueOnce(periodWindow({
      accounts: [{ id: "account-1", name: "Main account", institution: "North Bank", kind: "checking", currency: "CAD", isActive: true, includeInAvailableCash: true, isVisibleInCashFlow: true }],
    }));

    const page = await CashFlowPage({});
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Set up your Cash Flow rhythm");
    expect(html).toContain('data-today="2026-09-22"');
    expect(html).toContain('data-through="2027-09-21"');
    expect(mocks.addIsoDays).toHaveBeenCalledWith("2026-09-22", 364);
    expect(html).toContain("Set up Cash Flow rhythm");
  });

  it("keeps the unavailable-period route actionable when an owner already has a timeline", async () => {
    mocks.repository.getPeriodWindow.mockResolvedValueOnce(periodWindow({
      periods: [{ period: { id: "period-1", label: "Sep 30, 2026", startsOn: "2026-09-16", endsOn: "2026-09-30", payDate: "2026-09-30", openingBalanceMinor: 0, currency: "CAD", status: "planned" }, transactions: [], transfers: [] }],
      accounts: [{ id: "account-1", name: "Main account", institution: "North Bank", kind: "checking", currency: "CAD", isActive: true, includeInAvailableCash: true, isVisibleInCashFlow: true }],
      totalPeriodCount: 1,
    }));

    const page = await CashFlowPage({ searchParams: Promise.resolve({ period: "unknown" }) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Choose a Cash Flow period");
    expect(html).toContain('href="/cash-flow"');
    expect(mocks.cashFlowClient).not.toHaveBeenCalled();
  });
});
