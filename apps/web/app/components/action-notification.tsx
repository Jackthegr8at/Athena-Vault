"use client";

import { useState } from "react";
import { useAutoDismiss } from "./use-auto-dismiss";

export interface ActionNotificationState {
  readonly ok: boolean;
  readonly message: string;
}

export function ActionNotification({ state }: { readonly state: ActionNotificationState }) {
  const [dismissedState, setDismissedState] = useState<ActionNotificationState | null>(null);
  const visible = Boolean(state.message) && dismissedState !== state;
  const dismiss = (): void => setDismissedState(state);

  useAutoDismiss(visible && state.ok, dismiss);

  if (!visible || !state.message) return null;
  return <div className={`account-notification ${state.ok ? "is-success" : "is-error"}`} role={state.ok ? "status" : "alert"} aria-live="polite">
    <span>{state.message}</span>
    <button type="button" className="account-notification-dismiss" onClick={dismiss} aria-label="Dismiss notification">Dismiss</button>
  </div>;
}
