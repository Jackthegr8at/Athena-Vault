import type { TimelineColumnPresentation } from "./presentation";
import { formatMoneyMinor } from "../../lib/format-money";

const chartWidth = 720;
const chartPlotWidth = 560;
const chartHeight = 124;
const chartLeft = 34;
const chartRight = 8;
const chartTop = 8;
const chartBottom = 24;
const segmentStaggerMs = 180;
const wholeCad = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 });

function compactDollars(minor: number): string {
  const absolute = Math.abs(minor);
  if (absolute >= 100_000) return `${minor < 0 ? "-" : ""}$${wholeCad.format(Math.round(absolute / 100_000))}k`;
  return `${minor < 0 ? "-" : ""}$${wholeCad.format(Math.round(absolute / 100))}`;
}

function timelineDollars(minor: number): string {
  return formatMoneyMinor(minor);
}

function pointForValue(value: number, index: number, values: readonly number[], width: number, height: number): [number, number] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const x = chartLeft + (index / Math.max(values.length - 1, 1)) * (width - chartLeft - chartRight);
  const y = chartTop + ((max - value) / range) * (height - chartTop - chartBottom);
  return [x, y];
}

export function AccountsHeroTimeline({ columns, values }: { readonly columns: readonly TimelineColumnPresentation[]; readonly values: readonly number[] }) {
  const count = Math.min(columns.length, values.length);
  if (count === 0) return null;

  const timelineColumns = columns.slice(0, count);
  const timelineValues = values.slice(0, count);
  const points = timelineValues.map((value, index) => pointForValue(value, index, timelineValues, chartPlotWidth, chartHeight));
  const selectedIndex = timelineColumns.findIndex((column) => column.selected);
  const selectedPoint = selectedIndex >= 0 ? points[selectedIndex] : null;
  const firstLabel = timelineColumns[0]?.label ?? "";
  const lastLabel = timelineColumns.at(-1)?.label ?? "";

  return <svg className="accounts-hero-timeline" viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none" role="img" aria-label={`All accounts total timeline from ${firstLabel} to ${lastLabel}`}>
    <title>All accounts total timeline</title>
    <g className="accounts-hero-timeline-grid" aria-hidden="true">
      {[0, 1, 2].map((line) => {
        const y = chartTop + (line / 2) * (chartHeight - chartTop - chartBottom);
        return <line key={line} x1={chartLeft} x2={chartPlotWidth - chartRight} y1={y} y2={y} />;
      })}
    </g>
    {selectedPoint ? <line className="accounts-hero-timeline-selected" x1={selectedPoint[0]} x2={selectedPoint[0]} y1={chartTop} y2={chartHeight - chartBottom} aria-hidden="true" /> : null}
    <g className="accounts-hero-timeline-segments" aria-hidden="true">
      {points.slice(1).map(([x2, y2], segmentIndex) => {
        const previousPoint = points[segmentIndex];
        if (!previousPoint) return null;
        const [x1, y1] = previousPoint;
        return <line
          className="accounts-hero-timeline-line accounts-hero-timeline-segment"
          key={`${x1}-${y1}-${x2}-${y2}-${segmentIndex}`}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          pathLength={1}
          style={{ animationDelay: `${segmentIndex * segmentStaggerMs}ms` }}
        />;
      })}
    </g>
    <g className="accounts-hero-timeline-points">
      {points.map(([x, y], index) => {
        const column = timelineColumns[index];
        const value = timelineValues[index];
        if (!column || value === undefined) return null;
        const amount = timelineDollars(value);
        return <g
          className="accounts-hero-timeline-point"
          key={`${x}-${y}-${index}`}
          tabIndex={0}
          role="img"
          aria-label={`${column.label}: ${amount}`}
        >
          <title>{`${column.label}: ${amount}`}</title>
          <circle cx={x} cy={y} r={column.selected ? 3.5 : 2.5} />
        </g>;
      })}
    </g>
    <g className="accounts-hero-timeline-labels" aria-hidden="true">
      {timelineColumns.map((column, index) => {
        const point = points[index];
        if (!point) return null;
        const [x] = point;
        return <text key={`${column.date}-${column.shortLabel}`} x={x} y={chartHeight - 6} textAnchor="middle">{column.shortLabel}</text>;
      })}
    </g>
    <text className="accounts-hero-timeline-axis" x={chartLeft - 6} y={chartTop + 4} textAnchor="end" aria-hidden="true">{compactDollars(Math.max(...timelineValues))}</text>
    <text className="accounts-hero-timeline-axis" x={chartLeft - 6} y={chartHeight - chartBottom + 4} textAnchor="end" aria-hidden="true">{compactDollars(Math.min(...timelineValues))}</text>
  </svg>;
}
