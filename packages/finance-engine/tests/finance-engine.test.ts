import { describe, expect, it } from "vitest";
import {
  allocateAnnualExpenses,
  InvestmentProjectionValidationError,
  money,
  projectCashFlow,
  projectInvestment,
  projectInvestmentCalculator,
  projectInvestmentPortfolio,
  prepareInvestmentContributionEvents,
  projectScheduledInvestment,
  summarizeInvestmentAnnualContributions,
} from "../src/index";

describe("cash-flow engine", () => {
  it("keeps transfers outside income and expense totals", () => {
    const result = projectCashFlow({ id: "p1", label: "Next pay", payDate: "2026-08-14", openingBalance: money(100000), items: [
      { id: "i", label: "Pay", account: "Tangerine", amount: money(200000), kind: "income", planned: true },
      { id: "e", label: "Rent", account: "Tangerine", amount: money(120000), kind: "expense", planned: true },
      { id: "t", label: "To savings", account: "Wealthsimple", amount: money(50000), kind: "transfer", direction: "out", planned: true },
    ] });
    expect(result.income).toBe(200000);
    expect(result.expenses).toBe(120000);
    expect(result.transfers).toBe(-50000);
    expect(result.transferOut).toBe(50000);
    expect(result.endingBalance).toBe(130000);
  });

  it("applies incoming transfers without classifying them as income", () => {
    const result = projectCashFlow({ id: "p2", label: "Transfer", payDate: "2026-08-14", openingBalance: money(100000), items: [
      { id: "t", label: "From savings", account: "Tangerine", amount: money(25000), kind: "transfer", direction: "in", planned: true },
    ] });
    expect(result.income).toBe(0);
    expect(result.transferIn).toBe(25000);
    expect(result.endingBalance).toBe(125000);
  });
});

describe("investment engine", () => {
  it("grows a balance with contributions", () => {
    const result = projectInvestment({ initialValue: money(500000), monthlyContribution: money(10000), annualRateBps: 500, years: 1, compoundingPeriodsPerYear: 12 });
    expect(result[1]?.balance).toBeGreaterThan(620000);
    expect(result[1]?.contributions).toBe(120000);
  });

  it("rejects negative initial values and monthly contributions", () => {
    expect(() => projectInvestment({ initialValue: money(-1), monthlyContribution: money(10000), annualRateBps: 500, years: 1, compoundingPeriodsPerYear: 12 })).toThrow(InvestmentProjectionValidationError);
    expect(() => projectInvestment({ initialValue: money(500000), monthlyContribution: money(-1), annualRateBps: 500, years: 1, compoundingPeriodsPerYear: 12 })).toThrow(InvestmentProjectionValidationError);
  });

  it("projects scheduled contributions after monthly interest", () => {
    const result = projectScheduledInvestment({
      initialValue: money(100000),
      monthlyContributions: Array.from({ length: 12 }, () => money(10000)),
      annualRateBps: 1200,
      years: 1,
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ year: 0, balance: 100000, contributions: 0, growth: 0 });
    expect(result[1]?.contributions).toBe(120000);
    expect(result[1]?.balance).toBe(239507);
    expect(result[1]?.growth).toBe(19507);
  });

  it("accepts an exact biweekly schedule and preserves zero months", () => {
    const result = projectScheduledInvestment({
      initialValue: money(0),
      monthlyContributions: [money(20000), ...Array.from({ length: 11 }, () => money(0))],
      annualRateBps: 0,
      years: 1,
    });
    expect(result[1]?.balance).toBe(20000);
    expect(result[1]?.contributions).toBe(20000);
  });

  it("rejects an incomplete schedule and unsafe values", () => {
    expect(() => projectScheduledInvestment({ initialValue: money(0), monthlyContributions: [], annualRateBps: 500, years: 1 })).toThrow("full projection horizon");
    expect(() => projectScheduledInvestment({ initialValue: money(0), monthlyContributions: Array.from({ length: 12 }, () => money(0)), annualRateBps: 10_001, years: 1 })).toThrow("between -100% and 100%");
  });

  it("keeps calculator year zero as the starting balance and uses fixed-point growth", () => {
    const result = projectInvestmentCalculator({ initialValue: money(500000), annualRateBps: 500, years: 1 });
    expect(result[0]).toEqual({ year: 0, balance: 500000, contributions: 0, growth: 0 });
    expect(result[1]).toEqual({ year: 1, balance: 525581, contributions: 0, growth: 25581 });
  });

  it("uses dated contribution events instead of the periodic schedule", () => {
    const result = projectInvestmentPortfolio({
      baselineDate: "2026-01-15",
      years: 1,
      annualRateBps: 0,
      accounts: [{
        accountId: "cash-flow",
        initialValue: money(0),
        schedule: { frequency: "monthly", baseContributionMinor: money(999999), annualIncreaseBps: 0 },
        contributionEvents: [
          { on: "2026-01-15", amountMinor: money(500000) },
          { on: "2026-01-20", amountMinor: money(10000) },
          { on: "2026-02-10", amountMinor: money(5000) },
          { on: "2026-02-10", amountMinor: money(2500) },
        ],
      }],
    });

    expect(result[1]?.accounts[0]).toMatchObject({ balance: 17500, contributions: 17500, growth: 0 });
  });

  it("compounds portfolio balances monthly for dated contribution projections", () => {
    const result = projectInvestmentPortfolio({
      baselineDate: "2026-01-15",
      years: 1,
      annualRateBps: 1200,
      accounts: [{
        accountId: "monthly-compounding",
        initialValue: money(100000),
        schedule: { frequency: "monthly", baseContributionMinor: money(0), annualIncreaseBps: 0 },
        contributionEvents: [],
      }],
    });

    expect(result[1]?.accounts[0]).toMatchObject({ balance: 112684, contributions: 0, growth: 12684 });
  });

  it("applies percentage and fixed annual adjustments to dated contributions", () => {
    const events = [
      { on: "2026-01-15", amountMinor: money(10000) },
      { on: "2027-01-15", amountMinor: money(10000) },
      { on: "2028-01-15", amountMinor: money(10000) },
    ];
    const result = projectInvestmentPortfolio({
      baselineDate: "2026-01-01",
      years: 3,
      annualRateBps: 0,
      accounts: [
        {
          accountId: "percentage",
          initialValue: money(0),
          schedule: { frequency: "monthly", baseContributionMinor: money(0), annualIncreaseBps: 1000 },
          contributionEvents: events,
        },
        {
          accountId: "fixed",
          initialValue: money(0),
          schedule: {
            frequency: "monthly",
            baseContributionMinor: money(0),
            annualIncreaseBps: 0,
            annualIncreaseMode: "fixed_amount",
            annualIncreaseMinor: money(3000),
          },
          contributionEvents: events,
        },
      ],
    });

    expect(result[1]?.accounts.map((account) => account.contributions)).toEqual([10000, 10000]);
    expect(result[2]?.accounts.map((account) => account.contributions)).toEqual([21000, 23000]);
    expect(result[3]?.accounts.map((account) => account.contributions)).toEqual([33100, 39000]);
  });

  it("supports monthly and biweekly recurring contribution schedules", () => {
    const monthly = projectInvestmentPortfolio({
      baselineDate: "2026-01-01",
      years: 1,
      annualRateBps: 0,
      accounts: [{
        accountId: "monthly",
        initialValue: money(0),
        schedule: { frequency: "monthly", baseContributionMinor: money(10000), annualIncreaseBps: 0 },
      }],
    });
    const biweekly = projectInvestmentPortfolio({
      baselineDate: "2026-01-01",
      years: 1,
      annualRateBps: 0,
      accounts: [{
        accountId: "biweekly",
        initialValue: money(0),
        schedule: { frequency: "biweekly", baseContributionMinor: money(5000), annualIncreaseBps: 0 },
      }],
    });

    expect(monthly[1]?.balance).toBe(120000);
    expect(monthly[1]?.contributions).toBe(120000);
    expect(biweekly[1]?.balance).toBe(130000);
    expect(biweekly[1]?.contributions).toBe(130000);
  });

  it("applies January 1 increases and carries fixed overrides forward", () => {
    const result = projectInvestmentPortfolio({
      baselineDate: "2026-06-15",
      years: 2,
      annualRateBps: 0,
      accounts: [{
        accountId: "celi",
        initialValue: money(0),
        schedule: {
          frequency: "monthly",
          baseContributionMinor: money(10000),
          annualIncreaseBps: 1000,
          annualOverrides: [{ year: 2027, amountMinor: money(30000) }],
        },
      }],
    });

    expect(result[1]?.contributions).toBe(240000);
    expect(result[2]?.contributions).toBe(618000);
    expect(result[2]?.accounts[0]?.contributions).toBe(618000);
  });

  it("applies a fixed contribution increase once per calendar year for monthly and biweekly schedules", () => {
    const result = projectInvestmentPortfolio({
      baselineDate: "2026-12-31",
      years: 2,
      annualRateBps: 0,
      accounts: [
        {
          accountId: "monthly-fixed",
          initialValue: money(0),
          schedule: {
            frequency: "monthly",
            baseContributionMinor: money(23000),
            annualIncreaseBps: 0,
            annualIncreaseMode: "fixed_amount",
            annualIncreaseMinor: money(3000),
            startDate: "2026-01-01",
          },
        },
        {
          accountId: "biweekly-fixed",
          initialValue: money(0),
          schedule: {
            frequency: "biweekly",
            baseContributionMinor: money(23000),
            annualIncreaseBps: 0,
            annualIncreaseMode: "fixed_amount",
            annualIncreaseMinor: money(3000),
            startDate: "2026-01-01",
          },
        },
      ],
    });

    // 2027 uses $260 per period, then 2028 uses $290 per period.
    expect(result[1]?.accounts[0]?.contributions).toBe(312000);
    expect(result[2]?.accounts[0]?.contributions).toBe(660000);
    expect(result[1]?.accounts[1]?.contributions).toBe(676000);
    expect(result[2]?.accounts[1]?.contributions).toBe(1_430_000);
  });

  it("lets a fixed annual override take precedence for its calendar year", () => {
    const result = projectInvestmentPortfolio({
      baselineDate: "2026-12-31",
      years: 2,
      annualRateBps: 0,
      accounts: [{
        accountId: "fixed-override",
        initialValue: money(0),
        schedule: {
          frequency: "monthly",
          baseContributionMinor: money(23000),
          annualIncreaseBps: 0,
          annualIncreaseMode: "fixed_amount",
          annualIncreaseMinor: money(3000),
          annualOverrides: [{ year: 2027, amountMinor: money(40000) }],
        },
      }],
    });

    expect(result[1]?.accounts[0]?.contributions).toBe(480000);
    // The fixed annual increase resumes from the overridden $400 base in 2028.
    expect(result[2]?.accounts[0]?.contributions).toBe(996000);
  });

  it("summarizes a partial automatic year and a full future calendar year", () => {
    const eventDates = Array.from({ length: 44 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 8, 5));
      date.setUTCDate(date.getUTCDate() + index * 14);
      return date.toISOString().slice(0, 10);
    });
    const summaries = summarizeInvestmentAnnualContributions({
      baselineDate: "2026-08-23",
      years: 2,
      accounts: [{
        accountId: "automatic-biweekly",
        schedule: { frequency: "biweekly", baseContributionMinor: money(0), annualIncreaseBps: 300 },
        contributionEvents: eventDates.map((on) => ({ on, amountMinor: money(12_668) })),
      }],
    });

    expect(summaries[0]).toEqual({ calendarYear: 2026, biweeklyAmountMinor: 12_668, monthlyAmountMinor: 27_447, annualContributionMinor: 114_012, eventCount: 9 });
    expect(summaries[1]).toEqual({ calendarYear: 2027, biweeklyAmountMinor: 13_048, monthlyAmountMinor: 28_271, annualContributionMinor: 339_248, eventCount: 26 });
  });

  it("summarizes manual percentage increases across partial and final calendar years", () => {
    const summaries = summarizeInvestmentAnnualContributions({
      baselineDate: "2026-08-23",
      years: 2,
      accounts: [{
        accountId: "manual-monthly",
        schedule: { frequency: "monthly", baseContributionMinor: money(10_000), annualIncreaseBps: 1_000 },
      }],
    });

    expect(summaries).toEqual([
      { calendarYear: 2026, biweeklyAmountMinor: null, monthlyAmountMinor: 10_000, annualContributionMinor: 40_000, eventCount: 4 },
      { calendarYear: 2027, biweeklyAmountMinor: null, monthlyAmountMinor: 11_000, annualContributionMinor: 132_000, eventCount: 12 },
      { calendarYear: 2028, biweeklyAmountMinor: null, monthlyAmountMinor: 12_100, annualContributionMinor: 96_800, eventCount: 8 },
    ]);
  });

  it("applies fixed annual increases and gives calendar-year overrides precedence", () => {
    const summaries = summarizeInvestmentAnnualContributions({
      baselineDate: "2026-08-23",
      years: 2,
      accounts: [{
        accountId: "fixed-monthly",
        schedule: {
          frequency: "monthly",
          baseContributionMinor: money(10_000),
          annualIncreaseBps: 0,
          annualIncreaseMode: "fixed_amount",
          annualIncreaseMinor: money(1_000),
          annualOverrides: [{ year: 2027, amountMinor: money(15_000) }],
        },
      }],
    });

    expect(summaries).toEqual([
      { calendarYear: 2026, biweeklyAmountMinor: null, monthlyAmountMinor: 10_000, annualContributionMinor: 40_000, eventCount: 4 },
      { calendarYear: 2027, biweeklyAmountMinor: null, monthlyAmountMinor: 15_000, annualContributionMinor: 180_000, eventCount: 12 },
      { calendarYear: 2028, biweeklyAmountMinor: null, monthlyAmountMinor: 16_000, annualContributionMinor: 128_000, eventCount: 8 },
    ]);
  });

  it("aggregates monthly and biweekly schedules into cadence and payment totals", () => {
    const summaries = summarizeInvestmentAnnualContributions({
      baselineDate: "2026-08-23",
      years: 1,
      accounts: [
        { accountId: "monthly", schedule: { frequency: "monthly", baseContributionMinor: money(10_000), annualIncreaseBps: 0 } },
        { accountId: "biweekly", schedule: { frequency: "biweekly", baseContributionMinor: money(5_000), annualIncreaseBps: 0 } },
      ],
    });

    expect(summaries).toEqual([
      { calendarYear: 2026, biweeklyAmountMinor: 5_000, monthlyAmountMinor: 20_833, annualContributionMinor: 85_000, eventCount: 13 },
      { calendarYear: 2027, biweeklyAmountMinor: 5_000, monthlyAmountMinor: 20_833, annualContributionMinor: 165_000, eventCount: 25 },
    ]);
  });

  it("returns no annual contribution rows for calculator-shaped empty account input", () => {
    expect(summarizeInvestmentAnnualContributions({ baselineDate: "2026-08-23", years: 1, accounts: [] })).toEqual([]);
  });

  it("does not contribute before a late schedule start and aggregates mixed accounts", () => {
    const result = projectInvestmentPortfolio({
      baselineDate: "2026-01-01",
      years: 1,
      annualRateBps: 0,
      accounts: [
        {
          accountId: "monthly",
          initialValue: money(100000),
          schedule: { frequency: "monthly", baseContributionMinor: money(10000), annualIncreaseBps: 0 },
        },
        {
          accountId: "late",
          initialValue: money(200000),
          schedule: { frequency: "monthly", baseContributionMinor: money(7000), annualIncreaseBps: 0, startDate: "2026-07-01" },
        },
        {
          accountId: "biweekly",
          initialValue: money(300000),
          schedule: { frequency: "biweekly", baseContributionMinor: money(5000), annualIncreaseBps: 0 },
        },
      ],
    });

    expect(result[0]?.balance).toBe(600000);
    expect(result[1]?.accounts.map((account) => account.contributions)).toEqual([120000, 49000, 130000]);
    expect(result[1]?.contributions).toBe(299000);
    expect(result[1]?.balance).toBe(899000);
  });

  it("accumulates every event in a clamped monthly period", () => {
    const result = projectInvestmentPortfolio({
      baselineDate: "2026-01-30",
      years: 1,
      annualRateBps: 0,
      accounts: [{
        accountId: "clamped-monthly",
        initialValue: money(0),
        schedule: { frequency: "monthly", baseContributionMinor: money(10_000), annualIncreaseBps: 0, startDate: "2026-01-31" },
      }],
    });

    expect(result[1]?.accounts[0]?.contributions).toBe(120_000);
    expect(result[1]?.contributions).toBe(120_000);
  });

  it("supports zero and negative returns while rejecting invalid schedules and overflow", () => {
    const negative = projectInvestmentCalculator({ initialValue: money(100000), annualRateBps: -1000, years: 1 });
    expect(negative[1]?.balance).toBeLessThan(100000);

    expect(() => projectInvestmentPortfolio({
      baselineDate: "2026-01-01",
      years: 0,
      annualRateBps: 0,
      accounts: [{ accountId: "invalid", initialValue: money(0), schedule: { frequency: "monthly", baseContributionMinor: money(0), annualIncreaseBps: 0 } }],
    })).toThrow(InvestmentProjectionValidationError);

    expect(() => projectInvestmentPortfolio({
      baselineDate: "2026-01-01",
      years: 1,
      annualRateBps: 0,
      accounts: [{ accountId: "overflow", initialValue: money(Number.MAX_SAFE_INTEGER), schedule: { frequency: "monthly", baseContributionMinor: money(1), annualIncreaseBps: 0 } }],
    })).toThrow(/safe integer range/);
  });
  it("keeps manual and dated projections identical when contribution events are prepared once", () => {
    const input = {
      baselineDate: "2026-01-31",
      years: 2,
      accounts: [
        {
          accountId: "manual",
          initialValue: money(100_000),
          schedule: { frequency: "monthly" as const, baseContributionMinor: money(10_000), annualIncreaseBps: 500 },
        },
        {
          accountId: "dated",
          initialValue: money(200_000),
          schedule: { frequency: "monthly" as const, baseContributionMinor: money(1), annualIncreaseBps: 1_000 },
          contributionEvents: [
            { on: "2026-03-31", amountMinor: money(5_000) },
            { on: "2026-04-30", amountMinor: money(6_000) },
            { on: "2027-02-28", amountMinor: money(7_000) },
          ],
        },
      ],
    };
    const prepared = prepareInvestmentContributionEvents(input);
    for (const annualRateBps of [0, 500]) {
      expect(projectInvestmentPortfolio({ ...input, annualRateBps })).toEqual(
        projectInvestmentPortfolio({ ...input, annualRateBps }, prepared),
      );
    }
    expect(summarizeInvestmentAnnualContributions(input, prepared)).toEqual(
      summarizeInvestmentAnnualContributions(input),
    );
  });

  it("keeps events exactly on a prior boundary exclusive and supports both cadences", () => {
    const monthly = projectInvestmentPortfolio({
      baselineDate: "2026-01-31",
      years: 1,
      annualRateBps: 0,
      accounts: [{
        accountId: "monthly",
        initialValue: money(0),
        schedule: { frequency: "monthly", baseContributionMinor: money(0), annualIncreaseBps: 0 },
        contributionEvents: [
          { on: "2026-01-31", amountMinor: money(9_999) },
          { on: "2026-02-28", amountMinor: money(10_000) },
          { on: "2026-03-31", amountMinor: money(20_000) },
        ],
      }],
    });
    const biweekly = projectInvestmentPortfolio({
      baselineDate: "2026-01-01",
      years: 1,
      annualRateBps: 0,
      accounts: [{
        accountId: "biweekly",
        initialValue: money(0),
        schedule: { frequency: "biweekly", baseContributionMinor: money(0), annualIncreaseBps: 0 },
        contributionEvents: [
          { on: "2026-01-15", amountMinor: money(4_000) },
          { on: "2026-01-29", amountMinor: money(5_000) },
        ],
      }],
    });

    expect(monthly[1]?.accounts[0]?.contributions).toBe(30_000);
    expect(biweekly[1]?.accounts[0]?.contributions).toBe(9_000);
  });
});

describe("annual expense funding", () => {
  it("allocates remaining funding across the remaining pay periods", () => {
    const [expense] = allocateAnnualExpenses([{ id: "trip", label: "Travel", account: "Reserve", amount: money(150000), dueDate: "2027-04-01", funded: money(48000) }], 26);
    expect(expense?.remaining).toBe(102000);
    expect(expense?.perPayPeriod).toBe(3924);
    expect(expense?.status).toBe("attention");
  });
});
