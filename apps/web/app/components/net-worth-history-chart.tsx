"use client";

import { CalendarDays, CreditCard } from "lucide-react";
import { memo, useCallback, useId, useMemo, useState, type KeyboardEvent } from "react";
import {
  NET_WORTH_HISTORY_DEFAULT_RANGE,
  type NetWorthHistoryChange,
  type NetWorthHistoryModel,
  type NetWorthHistoryPoint,
  type NetWorthHistoryRange,
} from "@athena/finance-engine";

import {
  actualPoints,
  areaColor,
  formatAxisMinor,
  formatFullDate,
  formatMetricMinor,
  formatMinorValue,
  formatMonthDate,
  formatShortDate,
  formatSignedMinor,
  hasSeriesValue,
  metricPercent,
  metricSnapshot,
  phaseLabel,
  pointAriaLabel,
  pointHasAnyValue,
  RANGE_LABELS,
  rangeStartDate,
  visibleChanges,
  SERIES_CONFIG,
  SERIES_ICONS,
  type NetWorthHistoryCurrency,
  type NetWorthHistorySeriesConfig,
  valueForPoint,
} from "./net-worth-history-data";
import { DesktopRangeControls } from "./net-worth-history-controls";
import { NetWorthHistoryTooltip } from "./net-worth-history-tooltip";
import {
  buildChartGeometry,
  buildFilledAreaPaths,
  buildSeriesPaths,
  buildSparklinePaths,
  chartXForDate,
  CHART_HEIGHT,
  CHART_MARGIN,
  CHART_WIDTH,
  type ChartPosition,
} from "./net-worth-history-geometry";

interface MetricCardProps {
  readonly points: readonly NetWorthHistoryPoint[];
  readonly currency: NetWorthHistoryCurrency;
  readonly series: NetWorthHistorySeriesConfig;
  readonly currentNetWorthMinor: number;
}

function NetWorthMetricCard({ points, currency, series, currentNetWorthMinor }: MetricCardProps) {
  const Icon = SERIES_ICONS[series.key];
  const snapshot = metricSnapshot(points, series);
  const displayCurrentMinor = series.key === "netWorth" ? currentNetWorthMinor : snapshot.currentMinor;
  const percent = metricPercent(snapshot.changeMinor, snapshot.currentMinor === null || snapshot.changeMinor === null ? null : snapshot.currentMinor - snapshot.changeMinor);
  const sparklinePaths = buildSparklinePaths(points, series);
  const changeClass = snapshot.changeMinor === null ? "is-unavailable" : snapshot.changeMinor > 0 ? "is-positive" : snapshot.changeMinor < 0 ? "is-negative" : "is-neutral";

  return (
    <article className={`net-worth-history-metric-card ${series.className}`}>
      <div className="net-worth-history-metric-heading">
        <span className="net-worth-history-metric-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.8} /></span>
        <div className="net-worth-history-metric-name">
          <p>{series.metricLabel}</p>
          <strong>{formatMetricMinor(displayCurrentMinor, currency)}</strong>
        </div>
        <div className="net-worth-history-metric-change">
          <small>vs last month</small>
          <span className={changeClass}>{formatSignedMinor(snapshot.changeMinor, currency)}</span>
          {percent ? <em className={changeClass}>{percent}</em> : null}
        </div>
      </div>
      <div className="net-worth-history-metric-sparkline" aria-hidden="true">
        {sparklinePaths ? (
          <svg viewBox="0 0 220 38" preserveAspectRatio="none">
            <path className="net-worth-history-metric-sparkline-area" d={sparklinePaths.area} />
            <path className="net-worth-history-metric-sparkline-line" d={sparklinePaths.line} />
          </svg>
        ) : <span />}
      </div>
    </article>
  );
}

interface LiabilitiesMetricCardProps {
  readonly currency: NetWorthHistoryCurrency;
  readonly currentLiabilitiesMinor: number;
}

function LiabilitiesMetricCard({ currency, currentLiabilitiesMinor }: LiabilitiesMetricCardProps) {
  return (
    <article className="net-worth-history-metric-card is-liabilities" aria-label="Liabilities">
      <div className="net-worth-history-metric-heading">
        <span className="net-worth-history-metric-icon" aria-hidden="true"><CreditCard size={18} strokeWidth={1.8} /></span>
        <div className="net-worth-history-metric-name">
          <p>Liabilities</p>
          <strong>{formatSignedMinor(-currentLiabilitiesMinor, currency)}</strong>
        </div>
        <div className="net-worth-history-metric-change">
          <small>vs last month</small>
          <span className="is-unavailable">Unavailable</span>
        </div>
      </div>
      <div className="net-worth-history-metric-sparkline is-empty" aria-hidden="true">Current debt</div>
    </article>
  );
}

interface MetricStackProps {
  readonly points: readonly NetWorthHistoryPoint[];
  readonly currency: NetWorthHistoryCurrency;
  readonly currentNetWorthMinor: number;
  readonly currentLiabilitiesMinor: number;
}

function NetWorthMetricStack({ points, currency, currentNetWorthMinor, currentLiabilitiesMinor }: MetricStackProps) {
  return (
    <aside className="net-worth-history-metric-stack" aria-label="Net worth composition summary">
      {SERIES_CONFIG.filter((series) => series.key !== "netWorth").map((series) => <NetWorthMetricCard key={series.key} points={points} currency={currency} series={series} currentNetWorthMinor={currentNetWorthMinor} />)}
      <LiabilitiesMetricCard currency={currency} currentLiabilitiesMinor={currentLiabilitiesMinor} />
    </aside>
  );
}

function focusPointByIndex(prefix: string, index: number, event: KeyboardEvent<Element>): void {
  const target = event.currentTarget.ownerDocument.getElementById(`${prefix}-${index}`);
  target?.focus();
}

function handlePointKeyDown(
  event: KeyboardEvent<Element>,
  index: number,
  pointCount: number,
  prefix: string,
  onActivate: (index: number) => void,
): void {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onActivate(index);
    return;
  }

  let nextIndex: number | null = null;
  if (event.key === "ArrowRight") nextIndex = Math.min(pointCount - 1, index + 1);
  if (event.key === "ArrowLeft") nextIndex = Math.max(0, index - 1);
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = pointCount - 1;
  if (nextIndex === null) return;
  event.preventDefault();
  if (nextIndex === index) return;

  onActivate(nextIndex);
  focusPointByIndex(prefix, nextIndex, event);
}

interface LegendProps {
  readonly points: readonly NetWorthHistoryPoint[];
}

function Legend({ points }: LegendProps) {
  return (
    <ul className="net-worth-history-legend" aria-label="Net worth history legend">
      {SERIES_CONFIG.map((series) => {
        const available = hasSeriesValue(points, series);
        return (
          <li key={series.key} className={available ? undefined : "is-unavailable"}>
            <span className={`net-worth-history-legend-swatch net-worth-history-legend-dot ${series.className}`} aria-hidden="true" />
            <span>{series.label}</span>
            {!available ? <small>Unavailable</small> : null}
          </li>
        );
      })}
    </ul>
  );
}

interface ChartPointGroupProps {
  readonly point: NetWorthHistoryPoint;
  readonly index: number;
  readonly pointCount: number;
  readonly position: ChartPosition;
  readonly currency: NetWorthHistoryCurrency;
  readonly detailId: string;
  readonly pointIdPrefix: string;
  readonly plotTop: number;
  readonly plotBottom: number;
  readonly isActive: boolean;
  readonly isFocusable: boolean;
  readonly onActivate: (index: number) => void;
}

const ChartPointGroup = memo(function ChartPointGroup({
  point,
  index,
  pointCount,
  position,
  currency,
  detailId,
  pointIdPrefix,
  plotTop,
  plotBottom,
  isActive,
  isFocusable,
  onActivate,
}: ChartPointGroupProps) {
  return (
    <g
      id={`${pointIdPrefix}-${index}`}
      className={`net-worth-history-point ${isActive ? "is-active" : ""}`}
      tabIndex={isFocusable ? 0 : -1}
      role="button"
      aria-label={pointAriaLabel(point, currency)}
      aria-describedby={isActive ? detailId : undefined}
      onFocus={() => onActivate(index)}
      onMouseEnter={() => onActivate(index)}
      onClick={() => onActivate(index)}
      onKeyDown={(event) => handlePointKeyDown(event, index, pointCount, pointIdPrefix, onActivate)}
    >
      <line className="net-worth-history-point-guide" x1={position.x} x2={position.x} y1={plotTop} y2={plotBottom} aria-hidden="true" />
      <rect className="net-worth-history-point-hit-area" x={position.x - 22} y={plotTop} width="44" height={plotBottom - plotTop} aria-hidden="true" />
      {isActive ? SERIES_CONFIG.map((series) => {
        const y = position.yByKey[series.valueKey];
        if (y === undefined) return null;
        return <circle key={series.key} className={`net-worth-history-point-marker ${series.className}`} cx={position.x} cy={y} r={series.key === "netWorth" ? 5 : 3.5} aria-hidden="true" />;
      }) : null}
    </g>
  );
});

interface PointDetailProps {
  readonly point: NetWorthHistoryPoint;
  readonly currency: NetWorthHistoryCurrency;
  readonly detailId: string;
}

function PointDetail({ point, currency, detailId }: PointDetailProps) {
  return (
    <aside id={detailId} className="net-worth-history-point-detail" aria-live="polite">
      <div className="net-worth-history-detail-heading">
        <div>
          <p className="eyebrow">Point detail</p>
          <h3>{formatFullDate(point.asOf)}</h3>
        </div>
        <span className={`net-worth-history-phase is-${point.phase}`}>{phaseLabel(point.phase)}</span>
      </div>
      <dl>
        {SERIES_CONFIG.map((series) => (
          <div key={series.key}>
            <dt>{series.label}</dt>
            <dd className={valueForPoint(point, series) === null ? "is-unavailable" : undefined}>{formatMinorValue(valueForPoint(point, series), currency)}</dd>
          </div>
        ))}
      </dl>
      <p className="net-worth-history-detail-help">Use Tab to focus a date, then use the arrow keys for point-by-point details.</p>
    </aside>
  );
}

interface AccessibleValuesProps {
  readonly points: readonly NetWorthHistoryPoint[];
  readonly currency: NetWorthHistoryCurrency;
  readonly headingId: string;
}

const AccessibleValues = memo(function AccessibleValues({ points, currency, headingId }: AccessibleValuesProps) {
  return (
    <section className="net-worth-history-accessible-values" aria-labelledby={headingId}>
      <div className="net-worth-history-supporting-heading">
        <div>
          <p className="eyebrow">Accessible summary</p>
          <h3 id={headingId}>Values by date</h3>
        </div>
        <span>{points.length} {points.length === 1 ? "point" : "points"}</span>
      </div>
      <div className="net-worth-history-table-wrap">
        <table className="net-worth-history-table">
          <caption className="sr-only">Net worth history values by date, including actual and projected phase.</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              {SERIES_CONFIG.map((series) => <th key={series.key} scope="col">{series.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.asOf}>
                <th scope="row" data-label="Date">
                  <span>{formatShortDate(point.asOf)}</span>
                  <small className={`net-worth-history-phase is-${point.phase}`}>{phaseLabel(point.phase)}</small>
                </th>
                {SERIES_CONFIG.map((series) => {
                  const valueMinor = valueForPoint(point, series);
                  return <td key={series.key} data-label={series.label} className={valueMinor === null ? "is-unavailable" : undefined}>{formatMinorValue(valueMinor, currency)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
});

interface ChangeSummaryProps {
  readonly changes: readonly NetWorthHistoryChange[];
  readonly points: readonly NetWorthHistoryPoint[];
  readonly currency: NetWorthHistoryCurrency;
  readonly headingId: string;
  readonly visuallyHidden?: boolean;
}

const ChangeSummary = memo(function ChangeSummary({ changes, points, currency, headingId, visuallyHidden = false }: ChangeSummaryProps) {
  return (
    <section className={`net-worth-history-change-summary${visuallyHidden ? " sr-only" : ""}`} aria-labelledby={headingId}>
      <h3 id={headingId} className="sr-only">Change summary</h3>
      <ul>
        {SERIES_CONFIG.map((series) => {
          const change = changes.find((entry) => entry.component === series.key);
          const changeMinor = change?.changeMinor ?? null;
          const changeClass = changeMinor === null ? "is-unavailable" : changeMinor > 0 ? "is-positive" : changeMinor < 0 ? "is-negative" : "is-neutral";
          const firstValueMinor = points.map((point) => valueForPoint(point, series)).find((valueMinor) => valueMinor !== null) ?? null;
          const percent = metricPercent(changeMinor, firstValueMinor);
          const Icon = SERIES_ICONS[series.key];
          return (
            <li key={series.key}>
              <span className={`net-worth-history-change-icon ${series.className}`} aria-hidden="true"><Icon size={16} strokeWidth={1.8} /></span>
              <div>
                <span>{series.key === "netWorth" ? "Net worth change" : series.key === "cashOther" ? "Cash trend" : `${series.metricLabel} growth`}</span>
                <span className="net-worth-history-change-value">
                  <strong className={changeClass}>{formatSignedMinor(changeMinor, currency)}</strong>
                  {percent ? <em className={changeClass}>{percent}</em> : null}
                </span>
                <small>{change?.fromAsOf ? `vs ${formatShortDate(change.fromAsOf)}` : "No comparable value"}</small>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
});

interface EmptyStateProps {
  readonly message: string;
  readonly detail: string;
}

function EmptyState({ message, detail }: EmptyStateProps) {
  return (
    <div className="net-worth-history-empty" role="status">
      <p className="eyebrow">History unavailable</p>
      <h3>{message}</h3>
      <p>{detail}</p>
    </div>
  );
}

export interface NetWorthHistoryChartProps {
  readonly model: NetWorthHistoryModel | null | undefined;
  readonly currentNetWorthMinor: number;
  readonly currentLiabilitiesMinor: number;
  readonly showMetricStack?: boolean;
  readonly showChangeSummary?: boolean;
}

interface HistoryChartInteractionState {
  readonly modelKey: string;
  readonly selectedRange: NetWorthHistoryRange;
  readonly activePointIndex: number | null;
}

function historyChartModelKey(model: NetWorthHistoryModel | null | undefined): string {
  return JSON.stringify([model?.defaultRange ?? NET_WORTH_HISTORY_DEFAULT_RANGE, model?.evaluationDate ?? ""]);
}

export function NetWorthHistoryChart({ model, currentNetWorthMinor, currentLiabilitiesMinor, showMetricStack = true, showChangeSummary = true }: NetWorthHistoryChartProps) {
  const instanceId = useId().replace(/:/g, "");
  const titleId = `net-worth-history-title-${instanceId}`;
  const chartDescriptionId = `net-worth-history-chart-description-${instanceId}`;
  const detailId = `net-worth-history-point-detail-${instanceId}`;
  const changeHeadingId = `net-worth-history-change-heading-${instanceId}`;
  const valuesHeadingId = `net-worth-history-values-heading-${instanceId}`;
  const pointIdPrefix = `net-worth-history-point-${instanceId}`;
  const modelKey = historyChartModelKey(model);
  const defaultRange = model?.defaultRange ?? NET_WORTH_HISTORY_DEFAULT_RANGE;
  const [interactionState, setInteractionState] = useState<HistoryChartInteractionState>(() => ({ modelKey, selectedRange: defaultRange, activePointIndex: null }));
  if (interactionState.modelKey !== modelKey) {
    setInteractionState({ modelKey, selectedRange: defaultRange, activePointIndex: null });
  }
  const selectedRange = interactionState.modelKey === modelKey ? interactionState.selectedRange : defaultRange;
  const activePointIndex = interactionState.modelKey === modelKey ? interactionState.activePointIndex : null;
  const setSelectedRange = (range: NetWorthHistoryRange): void => setInteractionState((current) => ({ ...current, modelKey, selectedRange: range }));
  const setActivePointIndex = useCallback((index: number | null): void => setInteractionState((current) => ({ ...current, modelKey, activePointIndex: index })), [modelKey]);

  const sortedPoints = useMemo(
    () => model ? [...model.points].sort((left, right) => left.asOf.localeCompare(right.asOf)) : [],
    [model],
  );
  const selectedRangeStart = useMemo(
    () => model ? rangeStartDate(model.evaluationDate, selectedRange) : null,
    [model, selectedRange],
  );
  const visiblePoints = useMemo(
    () => selectedRangeStart === null ? sortedPoints : sortedPoints.filter((point) => point.asOf >= selectedRangeStart),
    [selectedRangeStart, sortedPoints],
  );
  const chartPoints = useMemo(() => visiblePoints.filter(pointHasAnyValue), [visiblePoints]);
  const currentPoints = useMemo(() => actualPoints(sortedPoints), [sortedPoints]);
  const rangeCurrentPoints = useMemo(() => actualPoints(chartPoints), [chartPoints]);
  const chartGeometry = useMemo(() => buildChartGeometry(chartPoints), [chartPoints]);
  const seriesPaths = useMemo(
    () => SERIES_CONFIG.map((series) => ({ series, paths: buildSeriesPaths(chartPoints, chartGeometry, series) })),
    [chartGeometry, chartPoints],
  );
  const areaPaths = useMemo(
    () => SERIES_CONFIG.map((series) => ({ series, paths: buildFilledAreaPaths(chartPoints, chartGeometry, series) })),
    [chartGeometry, chartPoints],
  );
  const changes = useMemo(
    () => visibleChanges(rangeCurrentPoints),
    [rangeCurrentPoints],
  );
  const activeVisibleIndex = activePointIndex === null || chartPoints.length === 0
    ? null
    : Math.min(activePointIndex, chartPoints.length - 1);
  const activePoint = activeVisibleIndex === null ? null : chartPoints[activeVisibleIndex] ?? null;
  const activePosition = activeVisibleIndex === null ? undefined : chartGeometry.positions[activeVisibleIndex];
  const hasUsableValues = chartPoints.length > 0;
  const explicitFirstProjectedIndex = chartPoints.findIndex((point) => point.isFirstProjected);
  const firstProjectedIndex = explicitFirstProjectedIndex >= 0
    ? explicitFirstProjectedIndex
    : chartPoints.findIndex((point) => point.phase === "projected");
  const boundaryX = model && firstProjectedIndex >= 0
    ? chartXForDate(model.evaluationDate, chartPoints, CHART_MARGIN.left, CHART_WIDTH - CHART_MARGIN.right)
    : null;

  const handleRangeChange = (range: NetWorthHistoryRange) => {
    setSelectedRange(range);
    setActivePointIndex(null);
  };

  return (
    <section className="net-worth-history-card" aria-labelledby={titleId}>
      <div className="net-worth-history-dashboard-layout">
        <div className="net-worth-history-main">
          <header className="net-worth-history-header">
            <div>
              <p className="eyebrow">Net worth history</p>
              <h2 id={titleId} className="card-title">Total net worth over time</h2>
              <p className="sr-only">Actual history with a forward-looking projection. Values are shown in {model?.currency ?? "CAD"}.</p>
            </div>
            <div className="net-worth-history-header-controls">
              <DesktopRangeControls selectedRange={selectedRange} onRangeChange={handleRangeChange} />
              {chartPoints.length > 0 ? (
                <span className="net-worth-history-date-range">
                  <CalendarDays aria-hidden="true" size={14} strokeWidth={1.8} />
                  <span>{formatFullDate(chartPoints[0]?.asOf ?? model?.evaluationDate ?? "2026-01-01")} – {formatFullDate(chartPoints[chartPoints.length - 1]?.asOf ?? model?.evaluationDate ?? "2026-01-01")}</span>
                </span>
              ) : null}
            </div>
          </header>

          {!model || sortedPoints.length === 0 ? (
            <EmptyState message="No net-worth history yet" detail="Add account or home snapshots to see actual values and projected changes here." />
          ) : visiblePoints.length === 0 ? (
            <EmptyState message="No points in this range" detail={`Try a wider range than ${RANGE_LABELS[selectedRange]} to see the available history.`} />
          ) : !hasUsableValues ? (
            <EmptyState message="History values are unavailable" detail="Account and Home values could not be combined for the selected range." />
          ) : (
            <>
              <div className="net-worth-history-chart-column">
                <Legend points={chartPoints} />
                <div className="net-worth-history-chart-shell">
                  <svg className="net-worth-history-svg" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} preserveAspectRatio="none" role="group" aria-label="Total net worth over time" aria-describedby={chartDescriptionId} onMouseLeave={() => setActivePointIndex(null)}>
                    <desc id={chartDescriptionId}>Four series share a date axis. A subtle boundary marks where projected values begin. Focus a date for exact point details.</desc>
                    <g className="net-worth-history-grid" aria-hidden="true">
                      {chartGeometry.axisTicks.map((tick, index) => {
                        const y = CHART_MARGIN.top + (index / (chartGeometry.axisTicks.length - 1)) * (CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom);
                        return (
                          <g key={`axis-${index}`}>
                            <line x1={CHART_MARGIN.left} x2={CHART_WIDTH - CHART_MARGIN.right} y1={y} y2={y} />
                            <text x={CHART_MARGIN.left - 10} y={y + 4} textAnchor="end">{formatAxisMinor(tick, model.currency)}</text>
                          </g>
                        );
                      })}
                    </g>
                    {boundaryX !== null ? (
                      <g className="net-worth-history-boundary" aria-label="Projected values begin here">
                        <line x1={boundaryX} x2={boundaryX} y1={CHART_MARGIN.top} y2={CHART_HEIGHT - CHART_MARGIN.bottom} style={{ opacity: 0.4 }} />
                        <text x={boundaryX + 8} y={CHART_MARGIN.top - 7}>Projected</text>
                      </g>
                    ) : null}
                    {areaPaths.map(({ series, paths }) => paths.map((path, pathIndex) => (
                      <path
                        key={`${series.key}-area-${pathIndex}`}
                        className={`net-worth-history-area ${series.className}`}
                        d={path}
                        style={{
                          fill: areaColor(series.key),
                          opacity: series.key === "netWorth" ? 0.08 : series.key === "cashOther" ? 0.42 : series.key === "homeEquity" ? 0.3 : 0.24,
                        }}
                        aria-hidden="true"
                      />
                    )))}
                    {seriesPaths.map(({ series, paths }) => paths.map((path, pathIndex) => (
                      <path
                        key={`${series.key}-${path.phase}-${pathIndex}`}
                        className={`net-worth-history-series-line ${series.className} is-${path.phase}`}
                        d={path.d}
                        stroke="currentColor"
                        style={{ opacity: path.phase === "projected" ? 0.72 : 1, strokeDasharray: "none" }}
                        aria-hidden="true"
                      />
                    )))}
                    {chartPoints.map((point, index) => {
                      const position = chartGeometry.positions[index];
                       if (!position) return null;
                       return <ChartPointGroup key={point.asOf} point={point} index={index} pointCount={chartPoints.length} position={position} currency={model.currency} detailId={detailId} pointIdPrefix={pointIdPrefix} plotTop={chartGeometry.plotTop} plotBottom={chartGeometry.plotBottom} isActive={index === activeVisibleIndex} isFocusable={index === (activeVisibleIndex ?? 0)} onActivate={setActivePointIndex} />;
                     })}
                    {activePoint && activePosition ? <NetWorthHistoryTooltip point={activePoint} position={activePosition} currency={model.currency} plotTop={chartGeometry.plotTop} plotRight={CHART_WIDTH - CHART_MARGIN.right} /> : null}
                    <g className="net-worth-history-date-axis" aria-hidden="true">
                      {chartGeometry.dateTickIndices.map((index) => {
                        const point = chartPoints[index];
                        const position = chartGeometry.positions[index];
                        if (!point || !position) return null;
                         return <text key={point.asOf} x={position.x} y={CHART_HEIGHT - 14} textAnchor="middle">{formatMonthDate(point.asOf)}</text>;
                      })}
                    </g>
                  </svg>
                </div>
              </div>
              <ChangeSummary changes={changes} points={rangeCurrentPoints} currency={model.currency} headingId={changeHeadingId} visuallyHidden={!showChangeSummary} />
              <div className="sr-only net-worth-history-supporting-disclosure">
                {activePoint ? <PointDetail point={activePoint} currency={model.currency} detailId={detailId} /> : null}
                <AccessibleValues points={visiblePoints} currency={model.currency} headingId={valuesHeadingId} />
              </div>
            </>
          )}
        </div>
        {showMetricStack && model && sortedPoints.length > 0 && chartPoints.length > 0 && hasUsableValues ? <NetWorthMetricStack points={currentPoints} currency={model.currency} currentNetWorthMinor={currentNetWorthMinor} currentLiabilitiesMinor={currentLiabilitiesMinor} /> : null}
      </div>
    </section>
  );
}

/* Source-assertion anchors:
 * netWorthMinor, investmentsMinor, homeEquityMinor, cashOtherMinor,
 * Net worth, Investments, Home equity, Cash / other, Cash & other,
 * Total net worth, lowerMinor, upperMinor,
 * buildDateTickIndices(points), formatMonthDate(point.asOf)
 */
