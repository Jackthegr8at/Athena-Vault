"use client";

import React from "react";
import { fieldError } from "./investment-calculation";
import {
  type InvestmentProjectionActionField,
  type InvestmentProjectionActionState,
} from "./action-helpers";

export type InvestmentMetricIconName = "balance" | "calendar" | "projects" | "scenarios";

export type InvestmentMetricTone = "navy" | "gold" | "positive" | "purple";

export function InvestmentMetricIcon({ name }: { readonly name: InvestmentMetricIconName }) {
  return <span className={`investment-stat-icon is-${name}`} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {name === "balance" ? <><path d="m4 17 5-5 3 3 7-8" /><path d="M15 7h4v4" /><path d="M4 20h16" /></> : null}
    {name === "calendar" ? <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /><path d="M8 14h.01M12 14h.01M16 14h.01" /></> : null}
    {name === "projects" ? <><path d="M3.5 7.5h6l1.8 2h9.2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /><path d="M3.5 7.5v-1a2 2 0 0 1 2-2h4l1.8 2h4.2" /></> : null}
    {name === "scenarios" ? <><path d="M4 17 9 12l3 3 6-7" /><path d="M15 8h4v4" /><path d="M4 20h16" /></> : null}
  </svg></span>;
}

export function InvestmentMetric({ label, value, detail, icon, tone }: { readonly label: string; readonly value: string; readonly detail: string; readonly icon: InvestmentMetricIconName; readonly tone: InvestmentMetricTone }) {
  return <div className={`investment-stat-card is-${tone}`}><InvestmentMetricIcon name={icon} /><div className="investment-stat-copy"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></div>;
}

export function ActionMessage({ state }: { readonly state: InvestmentProjectionActionState }) {
  return state.message ? <p className={`investment-action-message ${state.ok ? "is-success" : "is-error"}`} role="status">{state.message}</p> : null;
}

export function FieldError({ state, field, id }: { readonly state: InvestmentProjectionActionState; readonly field: InvestmentProjectionActionField; readonly id?: string }) {
  const message = fieldError(state, field);
  return message ? <span id={id} className="investment-field-error">{message}</span> : null;
}
