import {
  type NetWorthHistoryPhase,
  type NetWorthHistoryPoint,
} from "@athena/finance-engine";
import {
  parseIsoDate,
  SERIES_CONFIG,
  stackBandForPoint,
  valueForPoint,
  visualValueForPoint,
  type NetWorthHistorySeriesConfig,
  type PointValueKey,
} from "./net-worth-history-data";

export const CHART_WIDTH = 1000;
export const CHART_HEIGHT = 260;
export const CHART_MARGIN = { top: 24, right: 24, bottom: 40, left: 66 } as const;
export const CHART_TOOLTIP_WIDTH = 188;
export const CHART_TOOLTIP_HEIGHT = 126;

export interface ChartPosition {
  readonly x: number;
  readonly yByKey: Partial<Record<PointValueKey, number>>;
}

export interface ChartGeometry {
  readonly positions: readonly ChartPosition[];
  readonly axisTicks: readonly number[];
  readonly dateTickIndices: readonly number[];
  readonly plotTop: number;
  readonly plotBottom: number;
  readonly lowerBound: number;
  readonly upperBound: number;
}

export interface SeriesPath {
  readonly phase: NetWorthHistoryPhase;
  readonly d: string;
}

export interface SparklinePaths {
  readonly line: string;
  readonly area: string;
}


export function buildDateTickIndices(points: readonly NetWorthHistoryPoint[]): readonly number[] {
  if (points.length === 0) return [];

  const monthlyIndices: number[] = [];
  let previousMonth = "";
  points.forEach((point, index) => {
    const month = point.asOf.slice(0, 7);
    if (month !== previousMonth) {
      monthlyIndices.push(index);
      previousMonth = month;
    }
  });

  const lastIndex = points.length - 1;
  const lastMonthlyIndex = monthlyIndices[monthlyIndices.length - 1];
  if (lastMonthlyIndex !== lastIndex) {
    if (lastMonthlyIndex !== undefined && points[lastMonthlyIndex]?.asOf.slice(0, 7) === points[lastIndex]?.asOf.slice(0, 7)) {
      monthlyIndices[monthlyIndices.length - 1] = lastIndex;
    } else {
      monthlyIndices.push(lastIndex);
    }
  }
  if (monthlyIndices.length <= 12) return monthlyIndices;

  return Array.from({ length: 12 }, (_, index) => monthlyIndices[Math.round((index * (monthlyIndices.length - 1)) / 11)]!)
    .filter((pointIndex, position, indices) => indices.indexOf(pointIndex) === position);
}

export function niceAxisStep(targetStep: number): number {
  if (!Number.isFinite(targetStep) || targetStep <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(targetStep));
  const normalized = targetStep / magnitude;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return Math.max(1, Math.round(multiplier * magnitude));
}

/**
 * Map a calendar date onto the chart's horizontal date axis.
 *
 * The history can contain irregularly spaced points, so using an array index
 * would make the visual timeline inaccurate and could pin the projection
 * boundary to an unrelated historical sample. Dates outside the visible
 * range are clamped to the plot edges.
 */
export function chartXForDate(
  asOf: string,
  points: readonly NetWorthHistoryPoint[],
  plotLeft: number,
  plotRight: number,
): number | null {
  const firstPoint = points[0];
  const lastPoint = points.at(-1);
  if (!firstPoint || !lastPoint) return null;

  const firstTime = parseIsoDate(firstPoint.asOf).getTime();
  const lastTime = parseIsoDate(lastPoint.asOf).getTime();
  const targetTime = parseIsoDate(asOf).getTime();
  if (![firstTime, lastTime, targetTime].every(Number.isFinite)) return null;
  if (lastTime <= firstTime) return (plotLeft + plotRight) / 2;

  const ratio = Math.min(1, Math.max(0, (targetTime - firstTime) / (lastTime - firstTime)));
  return plotLeft + ratio * (plotRight - plotLeft);
}

export function buildChartGeometry(points: readonly NetWorthHistoryPoint[]): ChartGeometry {
  const plotLeft = CHART_MARGIN.left;
  const plotRight = CHART_WIDTH - CHART_MARGIN.right;
  const plotTop = CHART_MARGIN.top;
  const plotBottom = CHART_HEIGHT - CHART_MARGIN.bottom;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;
  const values: number[] = [];

  for (const point of points) {
    for (const series of SERIES_CONFIG) {
      const band = stackBandForPoint(point, series.key);
      if (band !== null) values.push(band.lowerMinor, band.upperMinor);
    }
  }

  const dataMinimum = values.length > 0 ? Math.min(...values) : 0;
  const dataMaximum = values.length > 0 ? Math.max(...values) : 1;
  const targetStep = niceAxisStep((dataMaximum - Math.min(0, dataMinimum)) / 4);
  const lowerBound = dataMinimum >= 0 ? 0 : Math.floor(dataMinimum / targetStep) * targetStep;
  const upperBound = Math.max(targetStep, Math.ceil(dataMaximum / targetStep) * targetStep);
  const displayRange = upperBound - lowerBound || 1;
  const yFor = (valueMinor: number): number => plotBottom - ((valueMinor - lowerBound) / displayRange) * plotHeight;
  const positions = points.map((point, index) => {
    const x = chartXForDate(point.asOf, points, plotLeft, plotRight)
      ?? (points.length <= 1 ? plotLeft + plotWidth / 2 : plotLeft + (index / (points.length - 1)) * plotWidth);
    const yByKey: Partial<Record<PointValueKey, number>> = {};
    for (const series of SERIES_CONFIG) {
      const valueMinor = visualValueForPoint(point, series);
      if (valueMinor !== null) yByKey[series.valueKey] = yFor(valueMinor);
    }
    return { x, yByKey };
  });

  return {
    positions,
    axisTicks: Array.from({ length: 5 }, (_, index) => upperBound - (displayRange * index) / 4),
    dateTickIndices: buildDateTickIndices(points),
    plotTop,
    plotBottom,
    lowerBound,
    upperBound,
  };
}

export function pathForCoordinates(coordinates: readonly { readonly x: number; readonly y: number }[]): string {
  if (coordinates.length === 0) return "";
  if (coordinates.length === 1) {
    const coordinate = coordinates[0]!;
    return `M ${coordinate.x.toFixed(2)} ${coordinate.y.toFixed(2)}`;
  }

  const tension = 0.16;
  const first = coordinates[0]!;
  let path = `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`;

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const previous = coordinates[index - 1] ?? coordinates[index]!;
    const current = coordinates[index]!;
    const next = coordinates[index + 1]!;
    const following = coordinates[index + 2] ?? next;
    const controlOne = {
      x: current.x + (next.x - previous.x) * tension,
      y: current.y + (next.y - previous.y) * tension,
    };
    const controlTwo = {
      x: next.x - (following.x - current.x) * tension,
      y: next.y - (following.y - current.y) * tension,
    };
    path += ` C ${controlOne.x.toFixed(2)} ${controlOne.y.toFixed(2)}, ${controlTwo.x.toFixed(2)} ${controlTwo.y.toFixed(2)}, ${next.x.toFixed(2)} ${next.y.toFixed(2)}`;
  }

  return path;
}

export function buildFilledAreaPaths(
  points: readonly NetWorthHistoryPoint[],
  geometry: ChartGeometry,
  series: NetWorthHistorySeriesConfig,
): readonly string[] {
  const paths: string[] = [];
  let upperCoordinates: { readonly x: number; readonly y: number }[] = [];
  let lowerCoordinates: { readonly x: number; readonly y: number }[] = [];
  const displayRange = geometry.upperBound - geometry.lowerBound || 1;
  const yFor = (valueMinor: number): number => geometry.plotBottom
    - ((valueMinor - geometry.lowerBound) / displayRange) * (geometry.plotBottom - geometry.plotTop);

  const flush = () => {
    if (upperCoordinates.length >= 2 && lowerCoordinates.length === upperCoordinates.length) {
      const upperPath = pathForCoordinates(upperCoordinates);
      const lowerPath = pathForCoordinates([...lowerCoordinates].reverse()).replace(/^M/, "L");
      paths.push(`${upperPath} ${lowerPath} Z`);
    }
    upperCoordinates = [];
    lowerCoordinates = [];
  };

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const position = geometry.positions[index];
    const band = point ? stackBandForPoint(point, series.key) : null;
    if (!position || band === null) {
      flush();
      continue;
    }
    upperCoordinates.push({ x: position.x, y: yFor(band.upperMinor) });
    lowerCoordinates.push({ x: position.x, y: yFor(band.lowerMinor) });
  }
  flush();
  return paths;
}

export function buildSeriesPaths(
  points: readonly NetWorthHistoryPoint[],
  geometry: ChartGeometry,
  series: NetWorthHistorySeriesConfig,
): readonly SeriesPath[] {
  const paths: SeriesPath[] = [];
  let currentPhase: NetWorthHistoryPhase | null = null;
  let currentCoordinates: { readonly x: number; readonly y: number }[] = [];

  const flush = () => {
    if (currentCoordinates.length >= 2 && currentPhase !== null) {
      paths.push({ phase: currentPhase, d: pathForCoordinates(currentCoordinates) });
    }
  };

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const position = geometry.positions[index];
    if (!point || !position) continue;
    const y = position.yByKey[series.valueKey];
    if (y === undefined) {
      flush();
      currentPhase = null;
      currentCoordinates = [];
      continue;
    }

    const coordinate = { x: position.x, y };
    if (currentPhase === null) {
      currentPhase = point.phase;
      currentCoordinates = [coordinate];
    } else if (currentPhase !== point.phase) {
      const previousCoordinate = currentCoordinates[currentCoordinates.length - 1];
      flush();
      currentPhase = point.phase;
      currentCoordinates = previousCoordinate ? [previousCoordinate, coordinate] : [coordinate];
    } else {
      currentCoordinates.push(coordinate);
    }
  }
  flush();
  return paths;
}

export function buildSparklinePaths(points: readonly NetWorthHistoryPoint[], series: NetWorthHistorySeriesConfig): SparklinePaths | null {
  const values = points
    .map((point, index) => ({ index, valueMinor: valueForPoint(point, series) }))
    .filter((entry): entry is { readonly index: number; readonly valueMinor: number } => entry.valueMinor !== null);
  if (values.length < 2) return null;

  const minimum = Math.min(...values.map((entry) => entry.valueMinor));
  const maximum = Math.max(...values.map((entry) => entry.valueMinor));
  const range = maximum - minimum || 1;
  const width = 220;
  const height = 38;
  // Normalize to the first and last available values so the trend line fills
  // the card instead of leaving dead space when early points are unavailable.
  const firstIndex = values[0]!.index;
  const lastIndex = values[values.length - 1]!.index;
  const span = lastIndex - firstIndex;
  const xFor = (index: number) => span <= 0 ? width / 2 : ((index - firstIndex) / span) * width;
  const yFor = (valueMinor: number) => height - 4 - ((valueMinor - minimum) / range) * (height - 8);
  const coordinates = values.map((entry) => ({ x: xFor(entry.index), y: yFor(entry.valueMinor) }));
  const line = pathForCoordinates(coordinates);
  const first = coordinates[0]!;
  const last = coordinates[coordinates.length - 1]!;
  return {
    line,
    area: `${line} L ${last.x.toFixed(2)} ${height} L ${first.x.toFixed(2)} ${height} Z`,
  };
}
