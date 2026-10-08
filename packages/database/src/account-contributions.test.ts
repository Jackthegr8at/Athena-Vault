import { describe, expect, it } from "vitest";
import {
  calculateProjectedBalances,
  calculateProjectedTimeline,
  contributionForPeriod,
  nextContributionOccurrence,
  occurrencesBetween,
  type ContributionRuleSchedule,
} from "./account-contributions";

const rule = (overrides: Partial<ContributionRuleSchedule> = {}): ContributionRuleSchedule => ({
  id: "rule-1",
  amountMinor: 1000,
  frequency: "weekly",
  startsOn: "2026-08-03",
  endsOn: null,
  isEnabled: true,
  ...overrides,
});

describe("account contribution recurrence", () => {
  it("expands weekly and biweekly occurrences at exact boundaries", () => {
    expect(occurrencesBetween(rule(), "2026-08-03", "2026-08-17")).toEqual([
      "2026-08-03", "2026-08-10", "2026-08-17",
    ]);
    expect(occurrencesBetween(rule({ frequency: "biweekly" }), "2026-08-03", "2026-08-31")).toEqual([
      "2026-08-03", "2026-08-17", "2026-08-31",
    ]);
  });

  it("clamps monthly and annual recurrence dates without drifting", () => {
    expect(occurrencesBetween(rule({ frequency: "monthly", startsOn: "2026-01-31" }), "2026-02-01", "2026-04-30")).toEqual([
      "2026-02-28", "2026-03-31", "2026-04-30",
    ]);
    expect(occurrencesBetween(rule({ frequency: "annual", startsOn: "2024-02-29" }), "2025-01-01", "2027-12-31")).toEqual([
      "2025-02-28", "2026-02-28", "2027-02-28",
    ]);
  });

  it("applies multiple contributions and exceptions within one biweekly period", () => {
    const period = { startsOn: "2026-08-06", endsOn: "2026-08-19", asOf: "2026-08-19" };
    const second = rule({ id: "rule-2", amountMinor: 2500, frequency: "monthly", startsOn: "2026-08-15" });
    expect(contributionForPeriod(period, [rule(), second])).toBe(4500);
    expect(contributionForPeriod(period, [rule(), second], [
      { ruleId: "rule-1", occurrenceOn: "2026-08-10", kind: "skip", amountMinor: null },
      { ruleId: "rule-2", occurrenceOn: "2026-08-15", kind: "override", amountMinor: 7000 },
    ])).toBe(8000);
    expect(nextContributionOccurrence(rule(), "2026-08-03", [
      { ruleId: "rule-1", occurrenceOn: "2026-08-03", kind: "skip", amountMinor: null },
    ])).toBe("2026-08-10");
  });
});

describe("chained projected balances", () => {
  const periods = [
    { startsOn: "2026-08-06", endsOn: "2026-08-19", asOf: "2026-08-19" },
    { startsOn: "2026-08-20", endsOn: "2026-09-02", asOf: "2026-09-02" },
    { startsOn: "2026-09-03", endsOn: "2026-09-16", asOf: "2026-09-16" },
  ];

  it("protects Actual and manual Projected anchors while chaining generated cells", () => {
    const snapshots = calculateProjectedBalances(
      [{ startsOn: "2026-07-23", endsOn: "2026-08-05", asOf: "2026-08-05" }, ...periods],
      [
        { id: "actual", asOf: "2026-08-05", balanceMinor: 10000, status: "actual", isGenerated: false },
        { id: "generated-1", asOf: "2026-08-19", balanceMinor: 10000, status: "planned", isGenerated: true },
        { id: "manual", asOf: "2026-09-02", balanceMinor: 99999, status: "planned", isGenerated: false },
        { id: "generated-2", asOf: "2026-09-16", balanceMinor: 99999, status: "planned", isGenerated: true },
      ],
      [rule({ startsOn: "2026-08-10", amountMinor: 500, frequency: "biweekly" })],
      [],
      { fromDate: "2026-08-19", futureAfter: "2026-08-05" },
    );

    expect(snapshots).toMatchObject([
      { id: "actual", balanceMinor: 10000, status: "actual", isGenerated: false },
      { id: "generated-1", balanceMinor: 10500, isGenerated: true },
      { id: "manual", balanceMinor: 99999, isGenerated: false },
      { id: "generated-2", balanceMinor: 100499, isGenerated: true },
    ]);
  });

  it("maps a monthly occurrence to the first period ending on or after its date", () => {
    expect(contributionForPeriod(periods[0]!, [rule({ frequency: "monthly", startsOn: "2026-08-15", amountMinor: 1234 })])).toBe(1234);
  });
});

describe("projection repair calculation", () => {
  const periods = [
    { startsOn: "2026-08-05", endsOn: "2026-08-05", asOf: "2026-08-05" },
    { startsOn: "2026-08-06", endsOn: "2026-08-19", asOf: "2026-08-19" },
    { startsOn: "2026-08-20", endsOn: "2026-09-02", asOf: "2026-09-02" },
    { startsOn: "2026-09-03", endsOn: "2026-09-16", asOf: "2026-09-16" },
  ];

  it("fills missing future cells, applies exceptions, and chains after a manual anchor", () => {
    const result = calculateProjectedTimeline(
      periods,
      [
        { id: "actual", asOf: "2026-08-05", balanceMinor: 10000, status: "actual", isGenerated: false },
        { id: "manual", asOf: "2026-09-02", balanceMinor: 20000, status: "planned", isGenerated: false },
        { id: "generated", asOf: "2026-09-16", balanceMinor: 20000, status: "planned", isGenerated: true },
      ],
      [rule({ amountMinor: 500, frequency: "biweekly", startsOn: "2026-08-10" })],
      [{ ruleId: "rule-1", occurrenceOn: "2026-08-10", kind: "override", amountMinor: 700 }],
      { fromDate: "2026-08-06", futureAfter: "2026-08-05" },
    );

    expect(result).toMatchObject([
      { id: "actual", asOf: "2026-08-05", balanceMinor: 10000, status: "actual", isGenerated: false },
      { id: null, asOf: "2026-08-19", balanceMinor: 10700, status: "planned", isGenerated: true },
      { id: "manual", asOf: "2026-09-02", balanceMinor: 20000, status: "planned", isGenerated: false },
      { id: "generated", asOf: "2026-09-16", balanceMinor: 20500, status: "planned", isGenerated: true },
    ]);
  });

  it("does not invent a projection when no snapshot anchor exists", () => {
    expect(calculateProjectedTimeline(periods, [], [rule()], [], { fromDate: "2026-08-06", futureAfter: "2026-08-05" })).toEqual([]);
  });

  it("resets generated cells to zero when the anchor before them is removed", () => {
    const result = calculateProjectedTimeline(
      periods,
      [
        { id: "generated-1", asOf: "2026-08-19", balanceMinor: 85000, status: "planned", isGenerated: true },
        { id: "generated-2", asOf: "2026-09-02", balanceMinor: 85000, status: "planned", isGenerated: true },
        { id: "generated-3", asOf: "2026-09-16", balanceMinor: 85000, status: "planned", isGenerated: true },
      ],
      [],
      [],
      { fromDate: "2026-08-19", futureAfter: "2026-08-05" },
    );

    expect(result).toMatchObject([
      { id: "generated-1", asOf: "2026-08-19", balanceMinor: 0, status: "planned", isGenerated: true },
      { id: "generated-2", asOf: "2026-09-02", balanceMinor: 0, status: "planned", isGenerated: true },
      { id: "generated-3", asOf: "2026-09-16", balanceMinor: 0, status: "planned", isGenerated: true },
    ]);
  });
});

describe("custom account contribution calculations", () => {
  const periods = [
    { startsOn: "2026-08-06", endsOn: "2026-08-19", asOf: "2026-08-19" },
    { startsOn: "2026-08-20", endsOn: "2026-09-02", asOf: "2026-09-02" },
  ];
  const rules = [
    { id: "maison", amountMinor: 8765, frequency: "biweekly" as const, startsOn: "2026-08-05", endsOn: null, isEnabled: true },
    { id: "surplus", amountMinor: 3100, frequency: "biweekly" as const, startsOn: "2026-08-05", endsOn: null, isEnabled: true },
    { id: "voyage", amountMinor: 1504, frequency: "biweekly" as const, startsOn: "2026-08-05", endsOn: null, isEnabled: true },
    { id: "fond", amountMinor: 8587, frequency: "biweekly" as const, startsOn: "2026-08-05", endsOn: null, isEnabled: true },
    { id: "gateries", amountMinor: 2667, frequency: "biweekly" as const, startsOn: "2026-08-05", endsOn: null, isEnabled: true },
  ];

  it("prefers Cash Flow ending balances for planned generated cells and leaves actual anchors alone", () => {
    const periods = [
      { startsOn: "2026-08-05", endsOn: "2026-08-05", asOf: "2026-08-05" },
      { startsOn: "2026-08-06", endsOn: "2026-08-19", asOf: "2026-08-19" },
      { startsOn: "2026-08-20", endsOn: "2026-09-02", asOf: "2026-09-02" },
    ];
    const overrides = new Map<string, number>([
      ["2026-08-19", 42000],
      ["2026-09-02", 39000],
    ]);
    const result = calculateProjectedTimeline(
      periods,
      [
        { id: "actual", asOf: "2026-08-05", balanceMinor: 10000, status: "actual", isGenerated: false },
        { id: "generated", asOf: "2026-08-19", balanceMinor: 0, status: "planned", isGenerated: true },
      ],
      [rule()],
      [],
      { fromDate: "2026-08-06", futureAfter: "2026-08-05", endingBalanceOverridesByAsOf: overrides },
    );
    expect(result).toMatchObject([
      { id: "actual", balanceMinor: 10000, isGenerated: false },
      { id: "generated", balanceMinor: 42000, isGenerated: true },
      { id: null, asOf: "2026-09-02", balanceMinor: 39000, status: "planned", isGenerated: true },
    ]);
  });

  it("applies account-specific transfer adjustments to projected balances", () => {
    const periods = [
      { startsOn: "2026-08-05", endsOn: "2026-08-05", asOf: "2026-08-05" },
      { startsOn: "2026-08-06", endsOn: "2026-08-19", asOf: "2026-08-19" },
    ];
    const source = calculateProjectedTimeline(
      periods,
      [{ id: "actual", asOf: "2026-08-05", balanceMinor: 10000, status: "actual", isGenerated: false }],
      [],
      [],
      { fromDate: "2026-08-06", futureAfter: "2026-08-05", balanceAdjustments: [{ occurredOn: "2026-08-10", amountMinor: -3000 }] },
    );
    const destination = calculateProjectedTimeline(
      periods,
      [{ id: "actual", asOf: "2026-08-05", balanceMinor: 10000, status: "actual", isGenerated: false }],
      [],
      [],
      { fromDate: "2026-08-06", futureAfter: "2026-08-05", balanceAdjustments: [{ occurredOn: "2026-08-10", amountMinor: 3000 }] },
    );

    expect(source[1]?.balanceMinor).toBe(7000);
    expect(destination[1]?.balanceMinor).toBe(13000);
  });

  it("uses the approved integer-minor-unit biweekly contributions", () => {
    expect(rules.map((rule) => contributionForPeriod(periods[0]!, [rule]))).toEqual([8765, 3100, 1504, 8587, 2667]);
  });

  it("chains each projected cell from the previous cell and preserves manual anchors", () => {
    expect(calculateProjectedTimeline(
      [{ startsOn: "2026-08-05", endsOn: "2026-08-05", asOf: "2026-08-05" }, ...periods],
      [
        { id: "actual", asOf: "2026-08-05", balanceMinor: 36969, status: "actual", isGenerated: false },
        { id: "generated", asOf: "2026-08-19", balanceMinor: 0, status: "planned", isGenerated: true },
        { id: "manual", asOf: "2026-09-02", balanceMinor: 50000, status: "planned", isGenerated: false },
      ],
      [rules[0]!],
      [],
      { fromDate: "2026-08-06", futureAfter: "2026-08-05" },
    )).toMatchObject([
      { id: "actual", balanceMinor: 36969, isGenerated: false },
      { id: "generated", balanceMinor: 45734, isGenerated: true },
      { id: "manual", balanceMinor: 50000, isGenerated: false },
    ]);
  });
});
