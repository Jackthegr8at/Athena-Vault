import Link from "next/link";
import type { RecurringCashFlowSeriesView } from "@athena/database";
import { recurringCashFlowManagerPath, recurringCashFlowSummaryItems } from "./presentation";
import { formatMoneyMinor } from "../../lib/format-money";

export interface RecurringCashFlowSummaryProps {
  readonly series: readonly RecurringCashFlowSeriesView[];
}

const dollars = (minor: number | null) => formatMoneyMinor(minor, { unavailableLabel: "Amount unavailable" });

function stateLabel(state: string): string {
  return state.charAt(0).toUpperCase() + state.slice(1);
}

export function RecurringCashFlowSummary({ series }: RecurringCashFlowSummaryProps) {
  const items = recurringCashFlowSummaryItems(series);
  const visibleItems = items.slice(0, 4);

  return <section className="card section-card recurring-summary" aria-labelledby="recurring-summary-title">
    <div className="card-head">
      <div>
        <h3 className="card-title" id="recurring-summary-title">Recurring payments</h3>
        <p className="card-subtitle">A compact view of active schedules; edit dates, versions, notes, and history in the recurring manager.</p>
      </div>
      <Link className="account-primary-button" href={recurringCashFlowManagerPath}>Manage recurring payments</Link>
    </div>
    {items.length === 0 ? <p className="insight">No active recurring payments have been added.</p> : <>
      <div className="recurring-summary-list" aria-label="Active recurring payments">
        {visibleItems.map((item) => <div className="recurring-summary-item" key={item.id}>
          <span><strong>{item.name}</strong><small>{stateLabel(item.state)} · {item.frequency ?? "Schedule unavailable"}{item.nextOccurrenceOn ? ` · Next ${item.nextOccurrenceOn}` : ""}</small></span>
          <strong>{dollars(item.amountMinor)}</strong>
        </div>)}
      </div>
      {items.length > visibleItems.length ? <p className="recurring-summary-more">Showing {visibleItems.length} of {items.length} active schedules.</p> : null}
    </>}
  </section>;
}
