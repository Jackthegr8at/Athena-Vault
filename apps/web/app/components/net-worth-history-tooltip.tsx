import type { NetWorthHistoryPoint } from "@athena/finance-engine";
import {
  CHART_HEIGHT,
  CHART_MARGIN,
  CHART_TOOLTIP_HEIGHT,
  CHART_TOOLTIP_WIDTH,
  CHART_WIDTH,
  type ChartPosition,
} from "./net-worth-history-geometry";
import {
  formatFullDate,
  formatMinorValue,
  SERIES_CONFIG,
  valueForPoint,
  type NetWorthHistoryCurrency,
} from "./net-worth-history-data";

interface ChartTooltipProps {
  readonly point: NetWorthHistoryPoint;
  readonly position: ChartPosition;
  readonly currency: NetWorthHistoryCurrency;
  readonly plotTop: number;
  readonly plotRight: number;
}

export function NetWorthHistoryTooltip({ point, position, currency, plotTop, plotRight }: ChartTooltipProps) {
  const preferredX = position.x > plotRight - CHART_TOOLTIP_WIDTH * 0.7
    ? position.x - CHART_TOOLTIP_WIDTH - 14
    : position.x + 14;
  const x = Math.max(CHART_MARGIN.left, Math.min(preferredX, CHART_WIDTH - CHART_MARGIN.right - CHART_TOOLTIP_WIDTH));
  const y = Math.max(plotTop + 6, Math.min((position.yByKey.netWorthMinor ?? plotTop) - CHART_TOOLTIP_HEIGHT * 0.45, CHART_HEIGHT - CHART_MARGIN.bottom - CHART_TOOLTIP_HEIGHT));

  return (
    <g className="net-worth-history-chart-tooltip" transform={`translate(${x.toFixed(2)} ${y.toFixed(2)})`} aria-hidden="true">
      <rect width={CHART_TOOLTIP_WIDTH} height={CHART_TOOLTIP_HEIGHT} rx="12" />
      <text className="net-worth-history-chart-tooltip-date" x="14" y="20">{formatFullDate(point.asOf)}</text>
      <line x1="14" x2={CHART_TOOLTIP_WIDTH - 14} y1="29" y2="29" />
      {SERIES_CONFIG.map((series, index) => (
        <g key={series.key} className={`net-worth-history-chart-tooltip-row ${series.className}`} transform={`translate(14 ${(index * 21) + 48})`}>
          <circle cx="4" cy="-4" r="3.5" />
          <text className="net-worth-history-chart-tooltip-label" x="14" y="0">{series.label}</text>
          <text className="net-worth-history-chart-tooltip-value" x={CHART_TOOLTIP_WIDTH - 28} y="0" textAnchor="end">{formatMinorValue(valueForPoint(point, series), currency)}</text>
        </g>
      ))}
    </g>
  );
}
