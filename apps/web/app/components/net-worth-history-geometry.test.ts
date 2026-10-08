import { describe, expect, it } from "vitest";
import type { NetWorthHistoryPoint } from "@athena/finance-engine";
import {
  buildChartGeometry,
  buildFilledAreaPaths,
  buildSeriesPaths,
  buildSparklinePaths,
  chartXForDate,
  CHART_MARGIN,
  CHART_WIDTH,
  pathForCoordinates,
} from "./net-worth-history-geometry";
import { SERIES_CONFIG } from "./net-worth-history-data";

const points: readonly NetWorthHistoryPoint[] = [
  {
    asOf: "2026-06-01",
    phase: "actual",
    isFirstProjected: false,
    cashOtherMinor: null,
    homeEquityMinor: null,
    investmentsMinor: null,
    netWorthMinor: 0,
  },
  {
    asOf: "2026-06-11",
    phase: "projected",
    isFirstProjected: true,
    cashOtherMinor: null,
    homeEquityMinor: null,
    investmentsMinor: null,
    netWorthMinor: 100_000,
  },
];

const netWorthSeries = SERIES_CONFIG.find((series) => series.key === "netWorth")!;

describe("net-worth-history-geometry", () => {
  it("maps dates and values to exact desktop chart coordinates", () => {
    const geometry = buildChartGeometry(points);

    expect(chartXForDate("2026-06-06", points, CHART_MARGIN.left, CHART_WIDTH - CHART_MARGIN.right)).toBe(521);
    expect(geometry).toEqual({
      positions: [
        { x: 66, yByKey: { netWorthMinor: 220 } },
        { x: 976, yByKey: { netWorthMinor: 24 } },
      ],
      axisTicks: [100_000, 75_000, 50_000, 25_000, 0],
      dateTickIndices: [1],
      plotTop: 24,
      plotBottom: 220,
      lowerBound: 0,
      upperBound: 100_000,
    });
  });

  it("produces stable exact SVG curve, series, and filled-area paths", () => {
    const geometry = buildChartGeometry(points);
    const line = "M 66.00 220.00 C 211.60 188.64, 830.40 55.36, 976.00 24.00";

    expect(pathForCoordinates([{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }])).toBe(
      "M 0.00 0.00 C 8.00 8.00, 34.00 50.00, 50.00 50.00 C 66.00 50.00, 92.00 8.00, 100.00 0.00",
    );
    expect(buildSeriesPaths(points, geometry, netWorthSeries)).toEqual([{ phase: "projected", d: line }]);
    expect(buildFilledAreaPaths(points, geometry, netWorthSeries)).toEqual([
      `${line} L 976.00 220.00 C 830.40 220.00, 211.60 220.00, 66.00 220.00 Z`,
    ]);
  });

  it("builds sparkline paths at exact viewBox positions", () => {
    expect(buildSparklinePaths([
      { ...points[0]!, netWorthMinor: 100 },
      { ...points[1]!, netWorthMinor: 200 },
    ], netWorthSeries)).toEqual({
      line: "M 0.00 34.00 C 35.20 29.20, 184.80 8.80, 220.00 4.00",
      area: "M 0.00 34.00 C 35.20 29.20, 184.80 8.80, 220.00 4.00 L 220.00 38 L 0.00 38 Z",
    });
  });
});
