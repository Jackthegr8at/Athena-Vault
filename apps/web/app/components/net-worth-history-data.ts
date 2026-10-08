import { House, PiggyBank, TrendingUp, Wallet, type LucideIcon } from "lucide-react";
import {
  type NetWorthHistoryChange,
  type NetWorthHistoryComponent,
  type NetWorthHistoryModel,
  type NetWorthHistoryPhase,
  type NetWorthHistoryPoint,
  type NetWorthHistoryRange,
} from "@athena/finance-engine";
import { formatCompactMoneyMinor, formatMoneyMinor, formatSignedMoneyMinor } from "../../lib/format-money";

export type PointValueKey = "netWorthMinor" | "investmentsMinor" | "homeEquityMinor" | "cashOtherMinor";
export type NetWorthHistoryCurrency = NetWorthHistoryModel["currency"];

export interface NetWorthHistorySeriesConfig {
  readonly key: NetWorthHistoryComponent;
  readonly valueKey: PointValueKey;
  readonly label: string;
  readonly metricLabel: string;
  readonly className: string;
}

export const SERIES_CONFIG: readonly NetWorthHistorySeriesConfig[] = [
  { key: "netWorth", valueKey: "netWorthMinor", label: "Net worth", metricLabel: "Total net worth", className: "is-net-worth" },
  { key: "investments", valueKey: "investmentsMinor", label: "Investments", metricLabel: "Investments", className: "is-investments" },
  { key: "homeEquity", valueKey: "homeEquityMinor", label: "Home equity", metricLabel: "Home equity", className: "is-home-equity" },
  { key: "cashOther", valueKey: "cashOtherMinor", label: "Cash / other", metricLabel: "Cash & other", className: "is-cash-other" },
];

export const SERIES_ICONS: Record<NetWorthHistoryComponent, LucideIcon> = {
  netWorth: TrendingUp,
  investments: PiggyBank,
  homeEquity: House,
  cashOther: Wallet,
};

export const RANGE_LABELS: Record<NetWorthHistoryRange, string> = {
  "1m": "1M",
  "3m": "3M",
  "6m": "6M",
  "1y": "1Y",
  all: "All",
};

export const RANGE_MONTHS: Record<Exclude<NetWorthHistoryRange, "all">, number> = {
  "1m": 1,
  "3m": 3,
  "6m": 6,
  "1y": 12,
};


export const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
export const FULL_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

export interface StackBand {
  readonly lowerMinor: number;
  readonly upperMinor: number;
}

export function parseIsoDate(asOf: string): Date {
  const [yearText, monthText, dayText] = asOf.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)) {
    return new Date(Date.UTC(year, month - 1, day));
  }
  return new Date(`${asOf}T00:00:00.000Z`);
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addCalendarMonths(asOf: string, months: number): string {
  const source = parseIsoDate(asOf);
  const sourceDay = source.getUTCDate();
  const absoluteMonth = source.getUTCFullYear() * 12 + source.getUTCMonth() + months;
  const targetYear = Math.floor(absoluteMonth / 12);
  const targetMonth = absoluteMonth - targetYear * 12;
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return toIsoDate(new Date(Date.UTC(targetYear, targetMonth, Math.min(sourceDay, lastDayOfTargetMonth))));
}

export function formatMinor(minor: number, currency: NetWorthHistoryCurrency): string {
  return formatMoneyMinor(minor, { currency });
}

export function formatAxisMinor(minor: number, currency: NetWorthHistoryCurrency): string {
  return formatCompactMoneyMinor(minor, currency);
}

export function formatSignedMinor(minor: number | null, currency: NetWorthHistoryCurrency): string {
  return formatSignedMoneyMinor(minor, { currency, negativeSign: "−" });
}

export function formatShortDate(asOf: string): string {
  return SHORT_DATE_FORMATTER.format(parseIsoDate(asOf));
}

export function formatFullDate(asOf: string): string {
  return FULL_DATE_FORMATTER.format(parseIsoDate(asOf));
}

export function formatMonthDate(asOf: string): string {
  const date = parseIsoDate(asOf);
  const month = new Intl.DateTimeFormat("en-CA", { month: "short", timeZone: "UTC" }).format(date);
  return `${month} '${String(date.getUTCFullYear()).slice(-2)}`;
}

export function phaseLabel(phase: NetWorthHistoryPhase): string {
  return phase === "projected" ? "Projected" : "Actual";
}

export function rangeStartDate(evaluationDate: string, range: NetWorthHistoryRange): string | null {
  if (range === "all") return null;
  return addCalendarMonths(evaluationDate, -RANGE_MONTHS[range]);
}

export function valueForPoint(point: NetWorthHistoryPoint, series: NetWorthHistorySeriesConfig): number | null {
  return point[series.valueKey];
}

export function safeMinorSum(values: readonly number[]): number | null {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

export function stackBandForPoint(point: NetWorthHistoryPoint, component: NetWorthHistoryComponent): StackBand | null {
  const cash = point.cashOtherMinor ?? 0;
  const home = point.homeEquityMinor ?? 0;
  const investments = point.investmentsMinor ?? 0;

  if (component === "cashOther") {
    return point.cashOtherMinor === null ? null : { lowerMinor: 0, upperMinor: cash };
  }

  if (component === "homeEquity") {
    if (point.homeEquityMinor === null) return null;
    const upperMinor = safeMinorSum([cash, home]);
    return upperMinor === null ? null : { lowerMinor: cash, upperMinor };
  }

  const componentBase = safeMinorSum([cash, home]);
  if (componentBase === null) return null;

  if (component === "investments") {
    if (point.investmentsMinor === null) return null;
    const upperMinor = safeMinorSum([componentBase, investments]);
    return upperMinor === null ? null : { lowerMinor: componentBase, upperMinor };
  }

  if (point.netWorthMinor === null) return null;
  const componentTotal = safeMinorSum([componentBase, investments]);
  return componentTotal === null ? null : { lowerMinor: componentTotal, upperMinor: point.netWorthMinor };
}

export function visualValueForPoint(point: NetWorthHistoryPoint, series: NetWorthHistorySeriesConfig): number | null {
  return stackBandForPoint(point, series.key)?.upperMinor ?? null;
}

export function pointHasAnyValue(point: NetWorthHistoryPoint): boolean {
  return SERIES_CONFIG.some((series) => valueForPoint(point, series) !== null);
}

export function hasSeriesValue(points: readonly NetWorthHistoryPoint[], series: NetWorthHistorySeriesConfig): boolean {
  return points.some((point) => valueForPoint(point, series) !== null);
}

export function deriveChange(points: readonly NetWorthHistoryPoint[], series: NetWorthHistorySeriesConfig): NetWorthHistoryChange {
  let first: { readonly point: NetWorthHistoryPoint; readonly valueMinor: number } | null = null;
  let last: { readonly point: NetWorthHistoryPoint; readonly valueMinor: number } | null = null;

  for (const point of points) {
    const valueMinor = valueForPoint(point, series);
    if (valueMinor === null) continue;
    if (first === null) first = { point, valueMinor };
    last = { point, valueMinor };
  }

  if (first === null || last === null) {
    return { component: series.key, changeMinor: null, fromAsOf: null, toAsOf: null };
  }

  const changeMinor = last.valueMinor - first.valueMinor;
  return {
    component: series.key,
    changeMinor: Number.isSafeInteger(changeMinor) ? changeMinor : null,
    fromAsOf: first.point.asOf,
    toAsOf: last.point.asOf,
  };
}

export function visibleChanges(points: readonly NetWorthHistoryPoint[]): readonly NetWorthHistoryChange[] {
  return SERIES_CONFIG.map((series) => deriveChange(points, series));
}

export function pointAriaLabel(point: NetWorthHistoryPoint, currency: NetWorthHistoryCurrency): string {
  const values = SERIES_CONFIG.map((series) => `${series.label}: ${formatMinorValue(valueForPoint(point, series), currency)}`);
  return `${formatFullDate(point.asOf)}, ${phaseLabel(point.phase)}. ${values.join(", ")}`;
}

export function formatMinorValue(valueMinor: number | null, currency: NetWorthHistoryCurrency): string {
  return formatMoneyMinor(valueMinor, { currency });
}

export function formatMetricMinor(valueMinor: number | null, currency: NetWorthHistoryCurrency): string {
  return formatMoneyMinor(valueMinor, { currency, unavailableLabel: "Not tracked" });
}

export interface MetricSnapshot {
  readonly currentMinor: number | null;
  readonly changeMinor: number | null;
  readonly fromAsOf: string | null;
}

export function metricSnapshot(points: readonly NetWorthHistoryPoint[], series: NetWorthHistorySeriesConfig): MetricSnapshot {
  const current = [...points].reverse().find((point) => valueForPoint(point, series) !== null);
  if (!current) return { currentMinor: null, changeMinor: null, fromAsOf: null };

  const currentMinor = valueForPoint(current, series);
  if (currentMinor === null) return { currentMinor: null, changeMinor: null, fromAsOf: null };

  const comparisonCutoff = addCalendarMonths(current.asOf, -1);
  const comparison = [...points].reverse().find((point) => point.asOf <= comparisonCutoff && valueForPoint(point, series) !== null);
  const comparisonMinor = comparison ? valueForPoint(comparison, series) : null;
  const changeMinor = comparisonMinor === null ? null : currentMinor - comparisonMinor;

  return {
    currentMinor,
    changeMinor: changeMinor !== null && Number.isSafeInteger(changeMinor) ? changeMinor : null,
    fromAsOf: comparison?.asOf ?? null,
  };
}

export function actualPoints(points: readonly NetWorthHistoryPoint[]): readonly NetWorthHistoryPoint[] {
  return points.filter((point) => point.phase === "actual");
}

export function areaColor(series: NetWorthHistoryComponent): string {
  if (series === "investments") return "var(--gold)";
  if (series === "homeEquity") return "var(--positive)";
  if (series === "cashOther") return "var(--net-worth-history-cash, #9BB9E8)";
  return "var(--navy)";
}

export function metricPercent(changeMinor: number | null, fromMinor: number | null): string | null {
  if (changeMinor === null || fromMinor === null || fromMinor === 0) return null;
  const percent = (changeMinor / Math.abs(fromMinor)) * 100;
  return `${percent >= 0 ? "+" : "−"}${Math.abs(percent).toFixed(1)}%`;
}
