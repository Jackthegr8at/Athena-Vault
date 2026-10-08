import { describe, expect, it } from "vitest";
import type { NetWorthHistoryPoint } from "@athena/finance-engine";
import type { NetWorthHistorySeriesConfig } from "./net-worth-history-data";
import {
  buildChartGeometry,
  buildDateTickIndices,
  buildFilledAreaPaths,
  buildSeriesPaths,
  buildSparklinePaths,
  chartXForDate,
  CHART_MARGIN,
  CHART_WIDTH,
  niceAxisStep,
  pathForCoordinates,
} from "./net-worth-history-geometry";
import {
  addCalendarMonths,
  deriveChange,
  formatAxisMinor,
  formatFullDate,
  formatMinor,
  formatMonthDate,
  formatShortDate,
  formatSignedMinor,
  metricPercent,
  parseIsoDate,
  pointAriaLabel,
  rangeStartDate,
  safeMinorSum,
  stackBandForPoint,
  toIsoDate,
  valueForPoint,
  visualValueForPoint,
} from "./net-worth-history-data";

describe("net-worth-history-data", () => {
  const point = {
    asOf: "2026-09-01",
    netWorthMinor: 38_000,
    investmentsMinor: 15_000,
    homeEquityMinor: 17_000,
    cashOtherMinor: 5_000,
    phase: "actual",
  } as unknown as NetWorthHistoryPoint;

  const zeroPoint = {
    asOf: "2026-09-01",
    netWorthMinor: 0,
    investmentsMinor: null,
    homeEquityMinor: null,
    cashOtherMinor: null,
    phase: "actual",
  } as unknown as NetWorthHistoryPoint;

  const cashOtherSeries = {
    key: "cashOther",
    valueKey: "cashOtherMinor",
  } as unknown as NetWorthHistorySeriesConfig;

  const netWorthSeries = {
    key: "netWorth",
    valueKey: "netWorthMinor",
  } as unknown as NetWorthHistorySeriesConfig;

  it("stackBandForPoint produces the expected stacked bands", () => {
    expect(stackBandForPoint(point, "cashOther" as Parameters<typeof stackBandForPoint>[1])).toEqual({
      lowerMinor: 0,
      upperMinor: 5_000,
    });
    expect(stackBandForPoint(point, "homeEquity" as Parameters<typeof stackBandForPoint>[1])).toEqual({
      lowerMinor: 5_000,
      upperMinor: 22_000,
    });
    expect(stackBandForPoint(point, "investments" as Parameters<typeof stackBandForPoint>[1])).toEqual({
      lowerMinor: 22_000,
      upperMinor: 37_000,
    });
    expect(stackBandForPoint(point, "netWorth" as Parameters<typeof stackBandForPoint>[1])).toEqual({
      lowerMinor: 37_000,
      upperMinor: 38_000,
    });
    expect(stackBandForPoint(zeroPoint, "cashOther" as Parameters<typeof stackBandForPoint>[1])).toBe(null);
  });

  it("valueForPoint and visualValueForPoint read series values", () => {
    expect(valueForPoint(point, cashOtherSeries)).toBe(5_000);
    expect(visualValueForPoint(point, cashOtherSeries)).toBe(5_000);
    expect(valueForPoint(zeroPoint, cashOtherSeries)).toBe(null);
    expect(visualValueForPoint(zeroPoint, cashOtherSeries)).toBe(null);
    expect(visualValueForPoint(point, netWorthSeries)).toBe(38_000);
  });

  it("formatters render currency and dates for CAD", () => {
    expect(formatMinor(12345, "CAD")).toContain("123.45");
    expect(formatAxisMinor(1234500, "CAD")).toBe("$12.3K");
    expect(formatAxisMinor(4_000_000, "CAD")).toBe("$40K");
    expect(formatSignedMinor(null, "CAD")).toBe("Unavailable");
    expect(formatSignedMinor(-12345, "CAD")).toContain("−");
    expect(formatShortDate("2026-09-01")).toContain("Sep");
    expect(formatMonthDate("2026-09-01")).toContain("Sep");
    expect(formatFullDate("2026-09-01")).toContain("2026");
  });

  it("formats safe integer readouts without floating-point rounding", () => {
    const expected = "$90,071,992,547,409.91";
    expect(formatMinor(Number.MAX_SAFE_INTEGER, "CAD")).toBe(expected);
    expect(formatSignedMinor(Number.MAX_SAFE_INTEGER, "CAD")).toBe(`+${expected}`);
    expect(formatSignedMinor(-Number.MAX_SAFE_INTEGER, "CAD")).toBe(`−${expected}`);
  });

  it("parseIsoDate, toIsoDate, and addCalendarMonths handle dates", () => {
    expect(toIsoDate(parseIsoDate("2026-01-31"))).toBe("2026-01-31");
    expect(addCalendarMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addCalendarMonths("2026-12-01", 2)).toBe("2027-02-01");
    expect(rangeStartDate("2026-09-01", "1y")).toBe("2025-09-01");
    expect(rangeStartDate("2026-09-01", "all")).toBe(null);
  });

  it("niceAxisStep and buildDateTickIndices avoid zero and negative steps", () => {
    expect(niceAxisStep(0)).toBe(1);
    expect(niceAxisStep(-5)).toBe(1);
    expect(niceAxisStep(123)).toBe(200);
    expect(buildDateTickIndices([])).toEqual([]);
    expect(
      buildDateTickIndices([
        { asOf: "2026-09-01" } as unknown as NetWorthHistoryPoint,
        { asOf: "2026-10-01" } as unknown as NetWorthHistoryPoint,
        { asOf: "2026-11-01" } as unknown as NetWorthHistoryPoint,
        { asOf: "2026-12-01" } as unknown as NetWorthHistoryPoint,
      ])
    ).toEqual([0, 1, 2, 3]);
  });

  it("buildChartGeometry handles empty, single, and zero-value series", () => {
    const empty = buildChartGeometry([]);
    expect(empty.positions).toEqual([]);
    expect(empty.axisTicks).toHaveLength(5);
    expect(empty.upperBound).toBe(1);

    const single = buildChartGeometry([zeroPoint]);
    expect(single.positions).toHaveLength(1);
    expect(single.upperBound).toBeGreaterThanOrEqual(1);

    const one = buildChartGeometry([point]);
    expect(one.positions[0]?.yByKey).toBeDefined();
    expect(one.dateTickIndices).toEqual([0]);
  });

  it("maps chart positions by calendar date", () => {
    const points = [
      { ...point, asOf: "2026-06-01" },
      { ...point, asOf: "2026-06-11" },
      { ...point, asOf: "2026-07-01" },
    ] as readonly NetWorthHistoryPoint[];
    const plotRight = CHART_WIDTH - CHART_MARGIN.right;
    const geometry = buildChartGeometry(points);
    const middleX = chartXForDate("2026-06-11", points, CHART_MARGIN.left, plotRight);
    const boundaryX = chartXForDate("2026-06-06", points, CHART_MARGIN.left, plotRight);

    expect(middleX).not.toBeNull();
    expect(boundaryX).not.toBeNull();
    expect(geometry.positions[1]?.x).toBeCloseTo(middleX!);
    expect(middleX!).toBeCloseTo(CHART_MARGIN.left + (plotRight - CHART_MARGIN.left) / 3);
    expect(boundaryX!).toBeGreaterThan(geometry.positions[0]!.x);
    expect(boundaryX!).toBeLessThan(geometry.positions[1]!.x);
  });

  it("pathForCoordinates handles empty, single, and multiple points", () => {
    expect(pathForCoordinates([])).toBe("");
    expect(pathForCoordinates([{ x: 10, y: 20 }])).toBe("M 10.00 20.00");
    const path = pathForCoordinates([
      { x: 0, y: 0 },
      { x: 50, y: 50 },
      { x: 100, y: 0 },
    ]);
    expect(path.startsWith("M 0.00 0.00")).toBe(true);
    expect(path).toContain("C");
  });

  it("buildSeriesPaths and buildFilledAreaPaths handle an empty series", () => {
    const geometry = buildChartGeometry([]);
    expect(buildSeriesPaths([], geometry, netWorthSeries)).toEqual([]);
    expect(buildFilledAreaPaths([], geometry, netWorthSeries)).toEqual([]);
  });

  it("buildSparklinePaths returns null for fewer than two values", () => {
    expect(buildSparklinePaths([], netWorthSeries)).toBe(null);
    expect(buildSparklinePaths([{ netWorthMinor: null } as unknown as NetWorthHistoryPoint], netWorthSeries)).toBe(null);
    expect(buildSparklinePaths([{ netWorthMinor: 100 } as unknown as NetWorthHistoryPoint], netWorthSeries)).toBe(null);
  });

  it("deriveChange and metricPercent compute deltas and percentages", () => {
    const increasing = [point, { ...point, netWorthMinor: 48_000 } as unknown as NetWorthHistoryPoint];
    const change = deriveChange(increasing, netWorthSeries);
    expect(change.changeMinor).toBe(10_000);
    expect(change.fromAsOf).toBe(point.asOf);
    expect(change.toAsOf).toBe(point.asOf);

    expect(metricPercent(1000, 10000)).toBe("+10.0%");
    expect(metricPercent(null, 10000)).toBe(null);
    expect(metricPercent(-500, 10000)).toContain("−");
  });

  it("pointAriaLabel includes the phase and formatted value", () => {
    const label = pointAriaLabel(point, "CAD");
    expect(label).toContain("Sep");
    expect(label).toContain("$380.00");
    expect(label).toContain("Actual");
  });

  it("safeMinorSum handles empty and zero values", () => {
    expect(safeMinorSum([])).toBe(0);
    expect(safeMinorSum([1, 2, 3])).toBe(6);
  });
});
