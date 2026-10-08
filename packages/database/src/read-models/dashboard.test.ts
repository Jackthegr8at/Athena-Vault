import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Database } from "../client";
import { getDashboardReadModel, type DashboardReadModel } from "./dashboard";

const cashFlowRepo = vi.hoisted(() => ({
  listPeriods: vi.fn(),
  getPeriodWindow: vi.fn(),
  listUpcoming: vi.fn(),
}));
const createCashFlowRepository = vi.hoisted(() => vi.fn(() => cashFlowRepo));

const accountRepo = vi.hoisted(() => ({
  listWithLatestBalances: vi.fn(),
}));
const createAccountRepository = vi.hoisted(() => vi.fn(() => accountRepo));

const annualRepo = vi.hoisted(() => ({
  getSummary: vi.fn(),
}));
const createAnnualExpenseRepository = vi.hoisted(() => vi.fn(() => annualRepo));

const investmentRepo = vi.hoisted(() => ({
  getSummary: vi.fn(),
}));
const createInvestmentRepository = vi.hoisted(() => vi.fn(() => investmentRepo));

const homeRepo = vi.hoisted(() => ({
  getHome: vi.fn(),
}));
const createHomeRepository = vi.hoisted(() => vi.fn(() => homeRepo));

const netWorthRepo = vi.hoisted(() => ({
  getHistory: vi.fn(),
}));
const createNetWorthHistoryRepository = vi.hoisted(() => vi.fn(() => netWorthRepo));

vi.mock("../repositories/cash-flow", () => ({ createCashFlowRepository }));
vi.mock("../drizzle-repositories", () => ({ createAccountRepository }));
vi.mock("../repositories/annual-expenses", () => ({ createAnnualExpenseRepository }));
vi.mock("../repositories/investment", () => ({ createInvestmentRepository }));
vi.mock("../home", () => ({ createHomeRepository }));
vi.mock("../net-worth-history", () => ({ createNetWorthHistoryRepository }));

const owner = "00000000-0000-0000-0000-0000000000da";
const asOf = "2026-09-02";
const fakeDb = {} as Database;

describe("getDashboardReadModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("assembles the dashboard model from owner-scoped repository calls", async () => {
    const periods = [
      { id: "period-1", endsOn: "2026-08-19", payDate: "2026-08-19" },
      { id: "period-2", endsOn: asOf, payDate: asOf },
      { id: "period-3", endsOn: "2026-09-16", payDate: "2026-09-16" },
      { id: "period-4", endsOn: "2026-09-30", payDate: "2026-09-30" },
    ];
    const upcomingPeriods = [
      { period: periods[1], transactions: [], transfers: [] },
      { period: periods[2], transactions: [], transfers: [] },
      { period: periods[3], transactions: [], transfers: [] },
    ];
    const periodWindow = { anchors: [], paydays: [], periods: upcomingPeriods };
    const annual = { taxYear: 2026, budgets: [] };
    const investments = {
      accounts: [],
      scenarios: [],
      currentValueMinor: 0,
      monthlyContributionMinor: 0,
    };
    const accountsList = [
      {
        id: "20000000-0000-0000-0000-0000000000d1",
        name: "Chequing",
        institution: "Bank",
        kind: "checking",
        currency: "CAD",
        includeInAvailableCash: true,
        asOf,
        balanceMinor: 123_456,
        isActive: true,
      },
    ];
    const home = { id: "home-1", name: "Home" };
    const netWorthHistory = { history: [] };

    const cashFlowPeriods = Promise.resolve(periods);
    cashFlowRepo.listPeriods.mockReturnValue(cashFlowPeriods);
    cashFlowRepo.getPeriodWindow.mockResolvedValue(periodWindow);
    annualRepo.getSummary.mockResolvedValue(annual);
    investmentRepo.getSummary.mockResolvedValue(investments);
    accountRepo.listWithLatestBalances.mockResolvedValue(accountsList);
    homeRepo.getHome.mockResolvedValue(home);
    netWorthRepo.getHistory.mockResolvedValue(netWorthHistory);

    const model: DashboardReadModel = await getDashboardReadModel(fakeDb, owner, asOf);

    expect(model).toMatchObject({
      periodWindow,
      upcomingPeriods,
      annual,
      investments,
      accounts: accountsList,
      home,
      netWorthHistory,
    });

    expect(createCashFlowRepository).toHaveBeenCalledWith(fakeDb);
    expect(cashFlowRepo.listPeriods).toHaveBeenCalledWith(owner);
    expect(cashFlowRepo.getPeriodWindow).toHaveBeenCalledWith(owner, {
      asOfIso: asOf,
      pastPeriods: 2,
      futurePeriods: 3,
    }, cashFlowPeriods);
    expect(cashFlowRepo.listUpcoming).not.toHaveBeenCalled();

    expect(createAccountRepository).toHaveBeenCalledWith(fakeDb);
    expect(accountRepo.listWithLatestBalances).toHaveBeenCalledWith(owner, asOf);

    expect(createAnnualExpenseRepository).toHaveBeenCalledWith(fakeDb);
    expect(annualRepo.getSummary).toHaveBeenCalledWith(owner);

    expect(createInvestmentRepository).toHaveBeenCalledWith(fakeDb);
    expect(investmentRepo.getSummary).toHaveBeenCalledWith(owner);

    expect(createHomeRepository).toHaveBeenCalledWith(fakeDb);
    expect(homeRepo.getHome).toHaveBeenCalledWith(owner, { timelineThrough: "2027-03-02" });

    expect(createNetWorthHistoryRepository).toHaveBeenCalledWith(fakeDb);
    expect(netWorthRepo.getHistory).toHaveBeenCalledWith(owner, expect.objectContaining({
      evaluationDate: asOf,
      preloaded: expect.objectContaining({ periods: cashFlowPeriods }),
    }));
    const homePromise = homeRepo.getHome.mock.results[0]!.value;
    expect(netWorthRepo.getHistory.mock.calls[0]![1].preloaded.home).toBe(homePromise);
  });

  it("preserves integer minor units in account and investment summaries", async () => {
    cashFlowRepo.listPeriods.mockResolvedValue([]);
    cashFlowRepo.getPeriodWindow.mockResolvedValue({ anchors: [], paydays: [], periods: [] });
    cashFlowRepo.listUpcoming.mockResolvedValue([]);
    annualRepo.getSummary.mockResolvedValue({ taxYear: 2026, budgets: [] });
    investmentRepo.getSummary.mockResolvedValue({
      accounts: [],
      scenarios: [],
      currentValueMinor: 9_876_543,
      monthlyContributionMinor: 1_200_000,
    });
    accountRepo.listWithLatestBalances.mockResolvedValue([
      {
        id: "20000000-0000-0000-0000-0000000000d2",
        name: "Savings",
        institution: "Bank",
        kind: "savings",
        currency: "CAD",
        includeInAvailableCash: true,
        asOf,
        balanceMinor: 123_456,
        isActive: true,
      },
    ]);
    homeRepo.getHome.mockResolvedValue(null);
    netWorthRepo.getHistory.mockResolvedValue({ history: [] });

    const model = await getDashboardReadModel(fakeDb, owner, asOf);

    expect(model.investments.currentValueMinor).toBe(9_876_543);
    expect(model.investments.monthlyContributionMinor).toBe(1_200_000);
    expect(Number.isSafeInteger(model.investments.currentValueMinor)).toBe(true);
    expect(Number.isSafeInteger(model.investments.monthlyContributionMinor)).toBe(true);

    expect(model.accounts[0]?.balanceMinor).toBe(123_456);
    expect(Number.isSafeInteger(model.accounts[0]?.balanceMinor ?? 0)).toBe(true);
  });

  it("handles empty and null results", async () => {
    cashFlowRepo.listPeriods.mockResolvedValue([]);
    cashFlowRepo.getPeriodWindow.mockResolvedValue({ anchors: [], paydays: [], periods: [] });
    cashFlowRepo.listUpcoming.mockResolvedValue([]);
    annualRepo.getSummary.mockResolvedValue({ taxYear: 2026, budgets: [] });
    investmentRepo.getSummary.mockResolvedValue({
      accounts: [],
      scenarios: [],
      currentValueMinor: 0,
      monthlyContributionMinor: 0,
    });
    accountRepo.listWithLatestBalances.mockResolvedValue([]);
    homeRepo.getHome.mockResolvedValue(null);
    netWorthRepo.getHistory.mockResolvedValue({ history: [] });

    const model = await getDashboardReadModel(fakeDb, owner, asOf);

    expect(model.upcomingPeriods).toHaveLength(0);
    expect(model.accounts).toHaveLength(0);
    expect(model.home).toBeNull();
  });

  it("preserves timeline ordering when falling back to listUpcoming", async () => {
    const upcoming = [
      { period: { payDate: "2026-10-01" }, transactions: [], transfers: [] },
      { period: { payDate: "2026-09-15" }, transactions: [], transfers: [] },
      { period: { payDate: "2026-11-01" }, transactions: [], transfers: [] },
    ];
    const periods = [
      { id: "period-1", endsOn: "2026-10-01", payDate: "2026-10-01" },
      { id: "period-2", endsOn: "2026-10-15", payDate: "2026-10-15" },
    ];

    cashFlowRepo.listPeriods.mockResolvedValue(periods);
    cashFlowRepo.getPeriodWindow.mockResolvedValue({ anchors: [], paydays: [], periods: [] });
    cashFlowRepo.listUpcoming.mockResolvedValue(upcoming);
    annualRepo.getSummary.mockResolvedValue({ taxYear: 2026, budgets: [] });
    investmentRepo.getSummary.mockResolvedValue({
      accounts: [],
      scenarios: [],
      currentValueMinor: 0,
      monthlyContributionMinor: 0,
    });
    accountRepo.listWithLatestBalances.mockResolvedValue([]);
    homeRepo.getHome.mockResolvedValue(null);
    netWorthRepo.getHistory.mockResolvedValue({ history: [] });

    const model = await getDashboardReadModel(fakeDb, owner, asOf);

    expect(model.upcomingPeriods).toEqual(upcoming);
    expect(model.upcomingPeriods.map((p) => p.period.payDate)).toEqual([
      "2026-10-01",
      "2026-09-15",
      "2026-11-01",
    ]);
    expect(cashFlowRepo.listUpcoming).toHaveBeenCalledWith(owner, asOf, 4, periods);
  });

  it("falls back to listUpcoming when the window cannot cover an upcoming period", async () => {
    const periods = [
      { id: "period-old", endsOn: "2026-08-19", payDate: "2026-08-19" },
      { id: "period-current", endsOn: asOf, payDate: asOf },
      { id: "period-next-1", endsOn: "2026-09-16", payDate: "2026-09-16" },
      { id: "period-next-2", endsOn: "2026-09-30", payDate: "2026-09-30" },
      { id: "period-next-3", endsOn: "2026-10-14", payDate: "2026-10-14" },
      { id: "period-next-4", endsOn: "2026-10-28", payDate: "2026-10-28" },
    ];
    // Window holds only three upcoming entries; the fourth needs a fallback.
    const periodWindow = {
      anchors: [],
      paydays: [],
      periods: [
        { period: periods[1], transactions: [], transfers: [] },
        { period: periods[2], transactions: [], transfers: [] },
        { period: periods[3], transactions: [], transfers: [] },
      ],
    };
    const fallbackUpcoming = [
      { period: periods[1], transactions: [], transfers: [] },
      { period: periods[2], transactions: [], transfers: [] },
      { period: periods[3], transactions: [], transfers: [] },
      { period: periods[5], transactions: [], transfers: [] },
    ];

    cashFlowRepo.listPeriods.mockResolvedValue(periods);
    cashFlowRepo.getPeriodWindow.mockResolvedValue(periodWindow);
    cashFlowRepo.listUpcoming.mockResolvedValue(fallbackUpcoming);
    annualRepo.getSummary.mockResolvedValue({ taxYear: 2026, budgets: [] });
    investmentRepo.getSummary.mockResolvedValue({
      accounts: [],
      scenarios: [],
      currentValueMinor: 0,
      monthlyContributionMinor: 0,
    });
    accountRepo.listWithLatestBalances.mockResolvedValue([]);
    homeRepo.getHome.mockResolvedValue(null);
    netWorthRepo.getHistory.mockResolvedValue({ history: [] });

    const model = await getDashboardReadModel(fakeDb, owner, asOf);

    expect(cashFlowRepo.listUpcoming).toHaveBeenCalledWith(owner, asOf, 4, periods);
    expect(model.upcomingPeriods).toEqual(fallbackUpcoming);
  });
});
