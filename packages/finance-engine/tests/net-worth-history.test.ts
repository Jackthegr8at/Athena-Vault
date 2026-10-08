import { describe, expect, it } from "vitest";
import {
  NET_WORTH_HISTORY_DEFAULT_PROJECTED_MONTHS,
  NET_WORTH_HISTORY_DEFAULT_RANGE,
  addMinorUnitsSafely,
  addNetWorthHistoryMonths,
  aggregateNetWorthHistoryAccountValues,
  buildNetWorthHistoryModel,
  calculateHomeEquityMinor,
  calculateNetWorthHistoryChanges,
  calculateNetWorthHistoryTotalMinor,
  classifyNetWorthAccountKind,
  getNetWorthHistoryRangeWindow,
  isValidNetWorthHistoryIsoDate,
  normalizeNetWorthHistoryTimeline,
  selectNetWorthHistoryRange,
  subtractMinorUnitsSafely,
  type NetWorthHistoryComponentValue,
  type NetWorthHistoryPoint,
} from "../src/index";

const actual = (asOf: string, valueMinor: number | null): NetWorthHistoryComponentValue => ({ asOf, phase: "actual", valueMinor });
const projected = (asOf: string, valueMinor: number | null): NetWorthHistoryComponentValue => ({ asOf, phase: "projected", valueMinor });

function bigintSafeReference(left: number, right: number, operation: "add" | "subtract", label: string): number {
  const result = operation === "add" ? BigInt(left) + BigInt(right) : BigInt(left) - BigInt(right);
  if (result < BigInt(Number.MIN_SAFE_INTEGER) || result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${label} is outside the safe integer range.`);
  }
  return Number(result);
}

function completeInput(overrides: Partial<{
  evaluationDate: string;
  projectedThrough: string | null;
  investments: readonly NetWorthHistoryComponentValue[];
  cashOther: readonly NetWorthHistoryComponentValue[];
  liabilities: readonly NetWorthHistoryComponentValue[];
  homeEquity: readonly NetWorthHistoryComponentValue[];
}> = {}) {
  return {
    evaluationDate: "2026-08-22",
    projectedThrough: "2027-02-22",
    investments: [actual("2026-08-22", 100_000)],
    cashOther: [actual("2026-08-22", 200_000)],
    liabilities: [],
    homeEquity: [actual("2026-08-22", 300_000)],
    ...overrides,
  };
}

describe("net-worth account classification", () => {
  it("classifies approved investment kinds and keeps Other in cash/other", () => {
    for (const kind of ["crypto", "rrsp", "tfsa", "non_registered", "investment", "fhsa", "resp", "rdsp"]) {
      expect(classifyNetWorthAccountKind(kind)).toBe("investment");
    }
    for (const kind of ["credit", "loan"]) expect(classifyNetWorthAccountKind(kind)).toBe("liability");
    for (const kind of ["checking", "savings", "cash", "other", "unrecognized"]) {
      expect(classifyNetWorthAccountKind(kind)).toBe("cashOther");
    }
    expect(classifyNetWorthAccountKind(" RRSP ")).toBe("investment");
  });

  it("aggregates RDSP balances into Investments", () => {
    const series = aggregateNetWorthHistoryAccountValues([
      { asOf: "2026-08-22", phase: "actual", kind: "rdsp", balanceMinor: 75_000 },
    ]);

    expect(series).toEqual({
      investments: [actual("2026-08-22", 75_000)],
      cashOther: [],
      liabilities: [],
    });
  });

  it("aggregates account values without adding inactive accounts", () => {
    const series = aggregateNetWorthHistoryAccountValues([
      { asOf: "2026-08-22", phase: "actual", kind: "checking", balanceMinor: 100_000 },
      { asOf: "2026-08-22", phase: "actual", kind: "other", balanceMinor: 10_000 },
      { asOf: "2026-08-22", phase: "actual", kind: "investment", balanceMinor: 200_000 },
      { asOf: "2026-08-22", phase: "actual", kind: "credit", balanceMinor: 50_000 },
      { asOf: "2026-08-22", phase: "actual", kind: "loan", balanceMinor: 25_000, isActive: false },
    ]);
    expect(series).toEqual({
      investments: [actual("2026-08-22", 200_000)],
      cashOther: [actual("2026-08-22", 110_000)],
      liabilities: [actual("2026-08-22", 50_000)],
    });

    const [point] = normalizeNetWorthHistoryTimeline({
      ...completeInput(),
      investments: series.investments,
      cashOther: series.cashOther,
      liabilities: series.liabilities,
      homeEquity: [actual("2026-08-22", 0)],
    });
    expect(point?.cashOtherMinor).toBe(110_000);
    expect(point?.investmentsMinor).toBe(200_000);
    expect(point?.netWorthMinor).toBe(260_000);
  });

  it("does not let an account without a balance hide known balances in the same bucket", () => {
    const series = aggregateNetWorthHistoryAccountValues([
      { asOf: "2026-08-22", phase: "actual", kind: "checking", balanceMinor: 125_000 },
      { asOf: "2026-08-22", phase: "actual", kind: "savings", balanceMinor: null },
      { asOf: "2026-08-22", phase: "actual", kind: "investment", balanceMinor: null },
    ]);

    expect(series.cashOther).toEqual([actual("2026-08-22", 125_000)]);
    expect(series.investments).toEqual([actual("2026-08-22", null)]);
  });
});

describe("safe net-worth arithmetic", () => {
  it("calculates home equity with negative and zero results and preserves unavailable inputs", () => {
    expect(calculateHomeEquityMinor(500_000, 300_000)).toBe(200_000);
    expect(calculateHomeEquityMinor(100_000, 150_000)).toBe(-50_000);
    expect(calculateHomeEquityMinor(100_000, 100_000)).toBe(0);
    expect(calculateHomeEquityMinor(null, 100_000)).toBeNull();
    expect(calculateHomeEquityMinor(100_000, null)).toBeNull();
  });

  it("subtracts liabilities exactly and returns null for an unavailable component", () => {
    expect(calculateNetWorthHistoryTotalMinor({
      cashOtherMinor: 110_000,
      investmentsMinor: 200_000,
      homeEquityMinor: 300_000,
      liabilitiesMinor: 50_000,
    })).toBe(560_000);
    expect(calculateNetWorthHistoryTotalMinor({
      cashOtherMinor: 110_000,
      investmentsMinor: 200_000,
      homeEquityMinor: null,
      liabilitiesMinor: 50_000,
    })).toBeNull();
  });

  it("rejects unsafe inputs and results instead of using floating-point arithmetic", () => {
    expect(() => addMinorUnitsSafely(Number.MAX_SAFE_INTEGER, 1)).toThrow(RangeError);
    expect(() => subtractMinorUnitsSafely(0, Number.MAX_SAFE_INTEGER)).not.toThrow();
    expect(() => subtractMinorUnitsSafely(Number.MIN_SAFE_INTEGER, 1)).toThrow(RangeError);
    expect(() => calculateHomeEquityMinor(Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER)).toThrow(RangeError);
    expect(() => calculateNetWorthHistoryTotalMinor({
      cashOtherMinor: Number.MAX_SAFE_INTEGER,
      investmentsMinor: Number.MAX_SAFE_INTEGER,
      homeEquityMinor: 0,
      liabilitiesMinor: 0,
    })).toThrow(RangeError);
    expect(() => aggregateNetWorthHistoryAccountValues([
      { asOf: "2026-08-22", phase: "actual", kind: "cash", balanceMinor: Number.MAX_SAFE_INTEGER },
      { asOf: "2026-08-22", phase: "actual", kind: "cash", balanceMinor: 1 },
    ])).toThrow(RangeError);
  });
  it("matches the BigInt reference at safe-integer boundaries and mixed signs", () => {
    const max = Number.MAX_SAFE_INTEGER;
    const cases = [
      [max, max],
      [max, max - 1],
      [max, -(max - 1)],
      [-max, -max],
      [-max, -(max - 1)],
      [-max, max - 1],
      [max - 1, -max],
    ] as const;

    for (const [left, right] of cases) {
      for (const operation of ["add", "subtract"] as const) {
        const label = operation === "add" ? "Minor-unit sum" : "Minor-unit difference";
        let expected: number | RangeError;
        try {
          expected = bigintSafeReference(left, right, operation, label);
        } catch (error) {
          expected = error as RangeError;
        }
        const calculate = operation === "add" ? addMinorUnitsSafely : subtractMinorUnitsSafely;
        if (expected instanceof RangeError) {
          expect(() => calculate(left, right)).toThrow(expected.message);
        } else {
          expect(calculate(left, right)).toBe(expected);
        }
      }
    }
  });
});

describe("normalized net-worth history", () => {
  it("combines dates chronologically, carries sparse values, keeps liabilities separate, and marks the projected boundary", () => {
    const points = normalizeNetWorthHistoryTimeline({
      evaluationDate: "2026-08-22",
      projectedThrough: "2027-02-22",
      investments: [
        actual("2025-08-22", 100_000),
        actual("2026-01-22", 125_000),
        projected("2026-09-22", 130_000),
      ],
      cashOther: [
        actual("2025-08-22", 200_000),
        actual("2026-04-22", 180_000),
        projected("2026-09-22", 190_000),
      ],
      liabilities: [
        actual("2025-08-22", 50_000),
        projected("2026-09-22", 45_000),
      ],
      homeEquity: [
        actual("2025-08-22", 300_000),
        actual("2026-01-22", 320_000),
        projected("2026-09-22", 330_000),
      ],
    });

    expect(points.map((point) => point.asOf)).toEqual([
      "2025-08-22",
      "2026-01-22",
      "2026-04-22",
      "2026-09-22",
    ]);
    expect(points).toMatchObject([
      { asOf: "2025-08-22", phase: "actual", netWorthMinor: 550_000, isFirstProjected: false },
      { asOf: "2026-01-22", phase: "actual", investmentsMinor: 125_000, homeEquityMinor: 320_000, netWorthMinor: 595_000 },
      { asOf: "2026-04-22", phase: "actual", investmentsMinor: 125_000, cashOtherMinor: 180_000, netWorthMinor: 575_000 },
      { asOf: "2026-09-22", phase: "projected", investmentsMinor: 130_000, cashOtherMinor: 190_000, homeEquityMinor: 330_000, netWorthMinor: 605_000, isFirstProjected: true },
    ]);
  });

  it("preserves null component availability instead of converting it to zero", () => {
    const points = normalizeNetWorthHistoryTimeline({
      ...completeInput(),
      investments: [actual("2026-08-22", null), actual("2026-09-22", 10_000)],
      homeEquity: [actual("2026-08-22", 100_000), actual("2026-09-22", null)],
    });
    expect(points[0]).toMatchObject({ investmentsMinor: null, homeEquityMinor: 100_000, netWorthMinor: null });
    expect(points[1]).toMatchObject({ investmentsMinor: 10_000, homeEquityMinor: null, netWorthMinor: null });
  });

  it("aggregates same-date component values safely and uses projected status when any source is projected", () => {
    const points = normalizeNetWorthHistoryTimeline({
      ...completeInput(),
      investments: [actual("2026-08-22", 100_000), projected("2026-08-22", 25_000)],
      homeEquity: [actual("2026-08-22", 300_000)],
    });
    expect(points).toEqual([expect.objectContaining({
      asOf: "2026-08-22",
      phase: "projected",
      investmentsMinor: 125_000,
      netWorthMinor: 625_000,
      isFirstProjected: true,
    })]);
  });
  it("keeps source component values immutable while selecting retains normalized projection markers", () => {
    const investments = [actual("2026-08-22", 100_000), projected("2026-09-22", 110_000)];
    const input = completeInput({ investments });
    const before = investments.map((value) => ({ ...value }));
    const points = normalizeNetWorthHistoryTimeline(input);

    expect(investments).toEqual(before);
    expect(points[1]?.isFirstProjected).toBe(true);
    const selected = selectNetWorthHistoryRange(points, {
      evaluationDate: "2026-08-22",
      projectedThrough: "2026-09-22",
      selectedRange: "1m",
    });
    expect(selected[1]).toBe(points[1]);
    expect(selected[1]?.isFirstProjected).toBe(true);
  });
});

describe("net-worth history windows and changes", () => {
  const historyInput = {
    evaluationDate: "2026-08-22",
    investments: [
      actual("2024-01-01", 100_000),
      actual("2025-08-22", 110_000),
      actual("2026-02-22", 120_000),
      actual("2026-08-22", 130_000),
      projected("2026-09-22", 140_000),
      projected("2027-02-22", 150_000),
    ],
    cashOther: [actual("2024-01-01", 100_000)],
    liabilities: [],
    homeEquity: [actual("2024-01-01", 100_000)],
  } as const;

  it("defaults to one year of history plus six projected months", () => {
    const model = buildNetWorthHistoryModel(historyInput);
    expect(NET_WORTH_HISTORY_DEFAULT_RANGE).toBe("1y");
    expect(NET_WORTH_HISTORY_DEFAULT_PROJECTED_MONTHS).toBe(6);
    expect(model).toMatchObject({
      evaluationDate: "2026-08-22",
      historicalFrom: "2025-08-22",
      projectedThrough: "2027-02-22",
      selectedRange: "1y",
      defaultRange: "1y",
      firstProjectedAsOf: "2026-09-22",
    });
    expect(model.points.map((point) => point.asOf)).toEqual([
      "2025-08-22",
      "2026-02-22",
      "2026-08-22",
      "2026-09-22",
      "2027-02-22",
    ]);
  });

  it.each([
    ["1m", ["2026-08-22", "2026-09-22", "2027-02-22"]],
    ["3m", ["2026-08-22", "2026-09-22", "2027-02-22"]],
    ["6m", ["2026-02-22", "2026-08-22", "2026-09-22", "2027-02-22"]],
    ["1y", ["2025-08-22", "2026-02-22", "2026-08-22", "2026-09-22", "2027-02-22"]],
    ["all", ["2024-01-01", "2025-08-22", "2026-02-22", "2026-08-22", "2026-09-22", "2027-02-22"]],
  ] as const)("selects the %s window after normalizing the shared timeline", (range, expectedDates) => {
    const model = buildNetWorthHistoryModel({ ...historyInput, selectedRange: range });
    expect(model.points.map((point) => point.asOf)).toEqual(expectedDates);
    expect(model.points.at(-1)?.asOf).toBe("2027-02-22");
  });

  it("returns negative, zero, and unavailable summary changes without losing endpoint dates", () => {
    const points: NetWorthHistoryPoint[] = [
      {
        asOf: "2026-01-01",
        phase: "actual",
        isFirstProjected: false,
        netWorthMinor: 500_000,
        investmentsMinor: 100_000,
        homeEquityMinor: 200_000,
        cashOtherMinor: null,
      },
      {
        asOf: "2026-02-01",
        phase: "projected",
        isFirstProjected: true,
        netWorthMinor: 450_000,
        investmentsMinor: 100_000,
        homeEquityMinor: 250_000,
        cashOtherMinor: 100_000,
      },
    ];
    expect(calculateNetWorthHistoryChanges(points)).toEqual([
      { component: "netWorth", changeMinor: -50_000, fromAsOf: "2026-01-01", toAsOf: "2026-02-01" },
      { component: "investments", changeMinor: 0, fromAsOf: "2026-01-01", toAsOf: "2026-02-01" },
      { component: "homeEquity", changeMinor: 50_000, fromAsOf: "2026-01-01", toAsOf: "2026-02-01" },
      { component: "cashOther", changeMinor: 0, fromAsOf: "2026-02-01", toAsOf: "2026-02-01" },
    ]);
  });
  it("requires chronological inputs while allowing duplicate dates", () => {
    const duplicateDatePoints: NetWorthHistoryPoint[] = [
      {
        asOf: "2026-01-01",
        phase: "actual",
        isFirstProjected: false,
        netWorthMinor: 100,
        investmentsMinor: 100,
        homeEquityMinor: 0,
        cashOtherMinor: 0,
      },
      {
        asOf: "2026-01-01",
        phase: "actual",
        isFirstProjected: false,
        netWorthMinor: 150,
        investmentsMinor: 150,
        homeEquityMinor: 0,
        cashOtherMinor: 0,
      },
    ];
    expect(selectNetWorthHistoryRange(duplicateDatePoints, {
      evaluationDate: "2026-01-01",
      projectedThrough: "2026-01-01",
      selectedRange: "all",
    })).toHaveLength(2);
    expect(() => calculateNetWorthHistoryChanges([
      { ...duplicateDatePoints[0]!, asOf: "2026-02-01" },
      duplicateDatePoints[0]!,
    ])).toThrow("Net-worth history points must be chronological.");
  });
  it("keeps the global first-projected marker when a range starts after the projected boundary", () => {
    const points = normalizeNetWorthHistoryTimeline(historyInput);
    const selected = selectNetWorthHistoryRange(points, {
      // The window starts after the global first-projected point (2026-09-22),
      // so the normalized markers pass through unchanged.
      evaluationDate: "2026-11-01",
      projectedThrough: "2027-02-22",
      selectedRange: "1m",
    });
    expect(selected.map((point) => point.asOf)).toEqual(["2027-02-22"]);
    expect(selected.every((point) => point.isFirstProjected === false)).toBe(true);
    expect(selected[0]).toBe(points.at(-1));
  });
});

describe("deterministic ISO-date handling", () => {
  it("validates Gregorian dates and clamps month offsets deterministically", () => {
    expect(isValidNetWorthHistoryIsoDate("2024-02-29")).toBe(true);
    expect(isValidNetWorthHistoryIsoDate("2026-02-29")).toBe(false);
    expect(isValidNetWorthHistoryIsoDate("2026-02-30")).toBe(false);
    expect(isValidNetWorthHistoryIsoDate("2026-8-02")).toBe(false);
    expect(addNetWorthHistoryMonths("2024-02-29", -12)).toBe("2023-02-28");
    expect(addNetWorthHistoryMonths("2026-08-31", 6)).toBe("2027-02-28");
    expect(getNetWorthHistoryRangeWindow({
      evaluationDate: "2026-08-22",
      projectedThrough: "2027-02-22",
      selectedRange: "3m",
    })).toEqual({ fromAsOf: "2026-05-22", throughAsOf: "2027-02-22" });
  });

  it("rejects invalid dates and reversed projection windows", () => {
    expect(() => normalizeNetWorthHistoryTimeline(completeInput({
      investments: [actual("2026-02-29", 100_000)],
    }))).toThrow(RangeError);
    expect(() => normalizeNetWorthHistoryTimeline(completeInput({
      projectedThrough: "2026-08-21",
    }))).toThrow(RangeError);
    expect(() => selectNetWorthHistoryRange([], {
      evaluationDate: "2026-08-22",
      projectedThrough: "2026-08-21",
      selectedRange: "1m",
    })).toThrow(RangeError);
  });
});
