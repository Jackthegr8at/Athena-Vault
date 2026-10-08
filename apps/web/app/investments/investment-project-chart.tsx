"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { InvestmentProjectionScenarioView } from "@athena/database";
import {
  chartBandPath,
  chartPath,
  compactProjectionAxisValue,
  money,
  percentFromBasisPoints,
  projectionChartValue,
  type ProjectionChartMetric,
} from "./investment-calculation";

export const RATE_COLORS = ["#173f5f", "#b27b2c", "#7b5ea7", "#3f7d5a"];

export function projectionChartMetricLabel(metric: ProjectionChartMetric): string {
  if (metric === "contributionsMinor") return "Total contributions";
  if (metric === "growthMinor") return "Investment growth";
  return "Ending balance";
}
const PROJECTION_CHART_METRICS: readonly ProjectionChartMetric[] = ["balanceMinor", "contributionsMinor", "growthMinor"];
const PROJECTION_CHART_WIDTH = 760;
const PROJECTION_CHART_HEIGHT = 270;

export function ProjectionChart({ scenarios, expanded = false, onToggleExpand }: { readonly scenarios: readonly InvestmentProjectionScenarioView[]; readonly expanded?: boolean; readonly onToggleExpand: () => void }) {
  const pointIdPrefix = `investment-projection-point-${useId().replace(/:/g, "")}`;
  const [selectedRateBps, setSelectedRateBps] = useState<number | null>(() => scenarios[0]?.rateBps ?? null);
  const [activePointIndex, setActivePointIndex] = useState<number | null>(null);
  const [chartMetric, setChartMetric] = useState<ProjectionChartMetric>("balanceMinor");
  const [chartMetricMenuOpen, setChartMetricMenuOpen] = useState(false);
  const chartMetricMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!chartMetricMenuOpen) return;
    function closeChartMetricMenu(event: PointerEvent): void {
      if (chartMetricMenuRef.current && event.target instanceof Node && !chartMetricMenuRef.current.contains(event.target)) setChartMetricMenuOpen(false);
    }
    function closeChartMetricMenuOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") setChartMetricMenuOpen(false);
    }
    document.addEventListener("pointerdown", closeChartMetricMenu);
    document.addEventListener("keydown", closeChartMetricMenuOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeChartMetricMenu);
      document.removeEventListener("keydown", closeChartMetricMenuOnEscape);
    };
  }, [chartMetricMenuOpen]);
  const width = PROJECTION_CHART_WIDTH;
  const height = PROJECTION_CHART_HEIGHT;
  const geometry = useMemo(() => {
    const points = scenarios.flatMap((scenario) => scenario.points);
    if (points.length === 0) return null;
    const metricValues = points.map((point) => projectionChartValue(point, chartMetric));
    const min = Math.min(0, ...metricValues);
    const max = Math.max(1, ...metricValues);
    const axisMax = Math.max(100_000, Math.ceil(max / 10_000_000) * 10_000_000);
    const maxLabel = compactProjectionAxisValue(axisMax);
    const padding = { left: Math.max(58, maxLabel.length * 6.2 + 8), right: 18, top: 20, bottom: 42 };
    const plotHeight = PROJECTION_CHART_HEIGHT - padding.top - padding.bottom;
    const plotWidth = PROJECTION_CHART_WIDTH - padding.left - padding.right;
    const range = axisMax - min || 1;
    const scenarioPaths = scenarios.map((scenario, index) => {
      const linePath = chartPath(scenario.points, chartMetric, PROJECTION_CHART_WIDTH, PROJECTION_CHART_HEIGHT, padding, min, axisMax);
      const lowerPoints = scenarios[index + 1]?.points ?? null;
      const bandPath = chartBandPath(scenario.points, lowerPoints, chartMetric, PROJECTION_CHART_WIDTH, PROJECTION_CHART_HEIGHT, padding, min, axisMax, linePath);
      return { scenario, index, linePath, bandPath };
    });
    const areaBands = scenarioPaths.slice().reverse();
    return { min, axisMax, padding, plotHeight, plotWidth, range, scenarioPaths, areaBands };
  }, [scenarios, chartMetric]);
  if (geometry === null) return <p className="investment-empty-note">No calculated points are available for this project yet.</p>;
  const { min, axisMax, padding, plotHeight, plotWidth, range, scenarioPaths, areaBands } = geometry;
  const metricLabel = projectionChartMetricLabel(chartMetric);
  const tickCount = 4;
  const chartPoints = scenarios[0]?.points ?? [];
  const activeVisibleIndex = activePointIndex === null || chartPoints.length === 0 ? null : Math.min(activePointIndex, chartPoints.length - 1);
  const activePoint = activeVisibleIndex === null ? null : chartPoints[activeVisibleIndex] ?? null;
  const activeScenario = scenarios.find((scenario) => scenario.rateBps === selectedRateBps) ?? scenarios[0];
  const activeX = activeVisibleIndex === null ? null : padding.left + (chartPoints.length <= 1 ? 0 : activeVisibleIndex / (chartPoints.length - 1)) * plotWidth;
  const activePointValue = activeVisibleIndex === null ? null : activeScenario?.points[activeVisibleIndex];
  const activeValue = activePointValue ? projectionChartValue(activePointValue, chartMetric) : null;
  const activeY = typeof activeValue === "number" ? padding.top + (1 - (activeValue - min) / range) * plotHeight : padding.top;
  const tooltipWidth = 190;
  const tooltipHeight = 42 + scenarios.length * 21;
  const tooltipX = activeX === null ? 0 : Math.max(padding.left, Math.min(activeX > width - padding.right - tooltipWidth * 0.7 ? activeX - tooltipWidth - 14 : activeX + 14, width - padding.right - tooltipWidth));
  const tooltipY = Math.max(padding.top + 6, Math.min(activeY - tooltipHeight * 0.45, height - padding.bottom - tooltipHeight));

  function focusPoint(index: number, event: ReactKeyboardEvent<SVGGElement>): void {
    event.currentTarget.ownerDocument.getElementById(`${pointIdPrefix}-${index}`)?.focus();
  }

  function handlePointKeyDown(event: ReactKeyboardEvent<SVGGElement>, index: number): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setActivePointIndex(index);
      return;
    }
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = Math.min(chartPoints.length - 1, index + 1);
    if (event.key === "ArrowLeft") nextIndex = Math.max(0, index - 1);
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = chartPoints.length - 1;
    if (nextIndex === null || nextIndex === index) return;
    event.preventDefault();
    setActivePointIndex(nextIndex);
    focusPoint(nextIndex, event);
  }

  function selectChartMetric(metric: ProjectionChartMetric): void {
    setChartMetric(metric);
    setActivePointIndex(null);
    setChartMetricMenuOpen(false);
  }

  const chartMetricMenuId = `${pointIdPrefix}-metric-options`;
  return <div className={`investment-chart-wrap investment-detail-chart-card ${expanded ? "is-expanded" : ""}`}>
    <div className="investment-chart-toolbar">
      <div className="investment-chart-scenario-tabs" aria-label="Projection scenarios">
        {scenarios.map((scenario, index) => <button key={scenario.rateBps} className={`is-scenario-${index} ${selectedRateBps === scenario.rateBps ? "is-selected" : ""}`} type="button" aria-pressed={selectedRateBps === scenario.rateBps} onClick={() => setSelectedRateBps(scenario.rateBps)}><i style={{ background: RATE_COLORS[index % RATE_COLORS.length] }} aria-hidden="true" />{percentFromBasisPoints(scenario.rateBps)}%{index === 0 ? " (Baseline)" : ""}</button>)}
      </div>
      <div className="investment-chart-view" ref={chartMetricMenuRef}>
        <span>View:</span>
        <button className="investment-chart-view-trigger" type="button" onClick={() => setChartMetricMenuOpen((open) => !open)} aria-label={`Projection chart metric: ${metricLabel}`} aria-haspopup="listbox" aria-expanded={chartMetricMenuOpen} aria-controls={chartMetricMenuId}>{metricLabel}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m7 9 5 5 5-5" /></svg></button>
        {chartMetricMenuOpen ? <div className="investment-chart-view-menu" id={chartMetricMenuId} role="listbox" aria-label="Projection chart metric options">{PROJECTION_CHART_METRICS.map((metric) => <button key={metric} type="button" role="option" aria-selected={chartMetric === metric} onClick={() => selectChartMetric(metric)}>{projectionChartMetricLabel(metric)}</button>)}</div> : null}
      </div>
      <button className="investment-chart-expand" type="button" aria-label={expanded ? "Collapse projection chart" : "Expand projection chart"} aria-pressed={expanded} onClick={onToggleExpand}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 4H4v4M16 4h4v4M8 20H4v-4M20 16v4h-4" /><path d="m4 4 5 5M20 4l-5 5M4 20l5-5M20 20l-5-5" /></svg></button>
    </div>
    <svg className="investment-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Investment projection ${metricLabel.toLowerCase()} by year`} onMouseLeave={() => setActivePointIndex(null)}>
      {areaBands.map(({ scenario, index, bandPath }) => <path key={`area-${scenario.rateBps}`} className={`investment-chart-area is-scenario-${index}`} d={bandPath} fill="currentColor" aria-hidden="true" />)}
      {Array.from({ length: tickCount + 1 }, (_, index) => {
        const ratio = index / tickCount;
        const y = padding.top + ratio * plotHeight;
        const value = Math.round(axisMax - ratio * (axisMax - min));
        return <g key={`tick-${index}`}><line x1={padding.left} x2={width - padding.right} y1={y} y2={y} className="investment-chart-grid" /><text x={padding.left - 8} y={y + 4} textAnchor="end" className="investment-chart-label">{compactProjectionAxisValue(value)}</text></g>;
      })}
      <line x1={padding.left} x2={width - padding.right} y1={height - padding.bottom} y2={height - padding.bottom} className="investment-chart-axis" />
      <line x1={padding.left} x2={padding.left} y1={padding.top} y2={height - padding.bottom} className="investment-chart-axis" />
      {scenarioPaths.map(({ scenario, index, linePath }) => <path key={scenario.rateBps} d={linePath} className={`investment-chart-path ${selectedRateBps === scenario.rateBps ? "is-selected" : ""}`} style={{ stroke: RATE_COLORS[index % RATE_COLORS.length] }} />)}
      {chartPoints.map((point, index) => {
        const x = chartPoints.length <= 1 ? padding.left : padding.left + (index / (chartPoints.length - 1)) * plotWidth;
        const isActive = index === activeVisibleIndex;
        return <g key={point.year} id={`${pointIdPrefix}-${index}`} className={`investment-chart-point ${isActive ? "is-active" : ""}`} tabIndex={index === (activeVisibleIndex ?? 0) ? 0 : -1} role="button" aria-label={`Year ${point.year} projection values`} onFocus={() => setActivePointIndex(index)} onMouseEnter={() => setActivePointIndex(index)} onClick={() => setActivePointIndex(index)} onKeyDown={(event) => handlePointKeyDown(event, index)}>
          <line className="investment-chart-point-guide" x1={x} x2={x} y1={padding.top} y2={height - padding.bottom} aria-hidden="true" />
          <rect className="investment-chart-point-hit-area" x={x - 22} y={padding.top} width="44" height={plotHeight} aria-hidden="true" />
          {isActive ? scenarios.map((scenario, scenarioIndex) => {
            const point = scenario.points[index];
            if (!point) return null;
            const value = projectionChartValue(point, chartMetric);
            const y = padding.top + (1 - (value - min) / range) * plotHeight;
            return <circle key={scenario.rateBps} className={`investment-chart-point-marker is-scenario-${scenarioIndex}`} cx={x} cy={y} r={scenario.rateBps === selectedRateBps ? 4.5 : 3.5} aria-hidden="true" />;
          }) : null}
        </g>;
      })}
      {activePoint && activeVisibleIndex !== null && activeX !== null ? <g className="investment-chart-tooltip" transform={`translate(${tooltipX.toFixed(2)} ${tooltipY.toFixed(2)})`} aria-hidden="true">
        <rect width={tooltipWidth} height={tooltipHeight} rx="10" />
        <text className="investment-chart-tooltip-date" x="14" y="20">Year {activePoint.year}</text>
        <line x1="14" x2={tooltipWidth - 14} y1="29" y2="29" />
        {scenarios.map((scenario, index) => <g key={scenario.rateBps} className={`investment-chart-tooltip-row is-scenario-${index}`} transform={`translate(14 ${(index * 21) + 48})`}><circle cx="4" cy="-4" r="3.5" /><text className="investment-chart-tooltip-label" x="14" y="0">{percentFromBasisPoints(scenario.rateBps)}%</text><text className="investment-chart-tooltip-value" x={tooltipWidth - 28} y="0" textAnchor="end">{money(scenario.points[activeVisibleIndex] ? projectionChartValue(scenario.points[activeVisibleIndex], chartMetric) : null)}</text></g>)}
      </g> : null}
      {chartPoints.map((point, index) => point.year % 2 === 0 || index === chartPoints.length - 1 ? <text key={`year-${point.year}`} x={padding.left + (chartPoints.length <= 1 ? 0 : index / (chartPoints.length - 1)) * plotWidth} y={height - 22} textAnchor="middle" className="investment-chart-label">{point.year}</text> : null)}
      <text x={padding.left + plotWidth / 2} y={height - 5} textAnchor="middle" className="investment-chart-axis-title">YEAR</text>
    </svg>
  </div>;
}
