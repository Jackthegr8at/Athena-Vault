"use client";

import { useActionState } from "react";
import { createInitialCashFlowTimelineAction } from "./actions";
import { initialCashFlowActionState } from "./action-helpers";

interface InitialTimelineSetupProps {
  readonly todayIso: string;
  readonly defaultThroughDate: string;
}

export function InitialCashFlowTimelineSetup({ todayIso, defaultThroughDate }: InitialTimelineSetupProps) {
  const [state, action, pending] = useActionState(createInitialCashFlowTimelineAction, initialCashFlowActionState);

  return <form className="cash-flow-initial-timeline-form" action={action}>
    <div className="cash-flow-initial-timeline-fields">
      <label htmlFor="cash-flow-first-payday">First payday
        <input id="cash-flow-first-payday" name="firstPayday" type="date" defaultValue={todayIso} required />
      </label>
      <label htmlFor="cash-flow-through-date">Create periods through
        <input id="cash-flow-through-date" name="throughDate" type="date" defaultValue={defaultThroughDate} required />
      </label>
    </div>
    <p className="cash-flow-initial-timeline-help">This creates empty 14-day periods only. It does not add income, balances, sample data, or transactions. Afterward, use <strong>Manage recurring payments</strong> to add income.</p>
    <button className="account-primary-button" type="submit" disabled={pending}>{pending ? "Setting up…" : "Set up Cash Flow"}</button>
    {state.message ? <p className={`cash-flow-action-message ${state.ok ? "is-success" : "is-error"}`} role={state.ok ? "status" : "alert"}>{state.message}</p> : null}
  </form>;
}
