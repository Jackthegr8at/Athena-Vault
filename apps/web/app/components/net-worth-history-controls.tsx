import {
  NET_WORTH_HISTORY_RANGES,
  type NetWorthHistoryRange,
} from "@athena/finance-engine";
import { RANGE_LABELS } from "./net-worth-history-data";

interface RangeControlsProps {
  readonly selectedRange: NetWorthHistoryRange;
  readonly onRangeChange: (range: NetWorthHistoryRange) => void;
}

export function DesktopRangeControls({ selectedRange, onRangeChange }: RangeControlsProps) {
  return (
    <fieldset className="net-worth-history-range-controls">
      <legend className="sr-only">Show net worth history range</legend>
      {NET_WORTH_HISTORY_RANGES.map((range) => (
        <button
          key={range}
          type="button"
          className={range === selectedRange ? "is-selected" : undefined}
          aria-pressed={range === selectedRange}
          onClick={() => onRangeChange(range)}
        >
          {RANGE_LABELS[range]}
        </button>
      ))}
    </fieldset>
  );
}
