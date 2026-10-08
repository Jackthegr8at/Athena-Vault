"use client";

import { useActionState, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { SalaryYearView } from "@athena/database";
import {
  createFinalizedSalaryYearAction,
  createSalarySnapshotAction,
  createSalaryYearAction,
  deleteSalarySnapshotAction,
  deleteSalaryYearAction,
  finalizeSalaryYearAction,
  reopenSalaryYearAction,
  updateFinalFederalSalaryYearAction,
  updateRrqYearLimitsAction,
  updateSalarySnapshotAction,
  updateSalaryYearAction,
} from "./actions";
import { initialSalaryActionState, type SalaryActionField, type SalaryActionState } from "./action-helpers";
import { AnimatedLineBackground } from "../components/animated-line-background";
import { formatMoneyInputMinor } from "../../lib/format-money";

export interface SalarySnapshotPresentation {
  readonly id: string;
  readonly salaryYearId: string;
  readonly snapshotOn: string;
  readonly federalCumulativeMinor: number;
  readonly provincialCumulativeMinor: number;
  readonly completedPayNumber: number;
  readonly completedPayNumberOverride: number | null;
  readonly rrqContributionYtdMinor: number | null;
  readonly note: string | null;
  readonly federalDeltaMinor: number | null;
  readonly provincialDeltaMinor: number | null;
  readonly federalProjectedYearEndMinor: number;
  readonly provincialProjectedYearEndMinor: number;
}

export interface SalaryYearPresentation {
  readonly id: string;
  readonly taxYear: number;
  readonly annualBaseMinor: number | null;
  readonly status: SalaryYearView["status"];
  readonly finalFederalMinor: number | null;
  readonly payPeriodsPerYearOverride: number | null;
  readonly totalPayPeriods: number;
  readonly paydayAnchorOn: string | null;
  readonly note: string | null;
  readonly snapshots: readonly SalarySnapshotPresentation[];
  readonly latestSnapshot: SalarySnapshotPresentation | null;
  readonly federalCumulativeMinor: number | null;
  readonly provincialCumulativeMinor: number | null;
  readonly federalProjectedYearEndMinor: number | null;
  readonly provincialProjectedYearEndMinor: number | null;
  readonly federalVarianceToBaseMinor: number | null;
  readonly rrqContributionTracker: SalaryYearView["rrqContributionTracker"];
}

interface SalariesManagerProps {
  readonly years: readonly SalaryYearPresentation[];
  readonly selectedYear: SalaryYearPresentation | null;
  readonly availableYears: readonly number[];
  readonly selectedTaxYear: number;
  readonly currentTaxYear: number;
  readonly preferenceScope?: string;
}

function useRrqVisibility(scope: string | undefined, defaultVisible: boolean) {
  const key = scope ? `athena:salary-rrq-visibility:v1:${scope}` : null;
  const [override, setOverride] = useState<{ key: string | null; visible: boolean } | null>(null);
  const read = () => {
    try {
      const value = key ? window.localStorage.getItem(key) : null;
      return value === "true" ? true : value === "false" ? false : defaultVisible;
    } catch {
      return defaultVisible;
    }
  };
  const subscribe = (notify: () => void) => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) notify();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("athena:salary-rrq-visibility", notify);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("athena:salary-rrq-visibility", notify);
    };
  };
  const stored = useSyncExternalStore(subscribe, read, () => defaultVisible);
  const visible = override?.key === key ? override.visible : stored;
  const change = () => {
    const next = !visible;
    try {
      if (key) {
        window.localStorage.setItem(key, String(next));
        setOverride(null);
        window.dispatchEvent(new Event("athena:salary-rrq-visibility"));
        return;
      }
    } catch {
      // Blocked storage still allows a display-only toggle for this mounted page.
    }
    setOverride({ key, visible: next });
  };
  return [visible, change] as const;
}

function money(value: number | null): string {
  if (value === null) return "—";
  const negative = value < 0;
  const absolute = Math.abs(value);
  const dollars = Math.floor(absolute / 100).toLocaleString("en-CA");
  const cents = String(absolute % 100).padStart(2, "0");
  return `${negative ? "−" : ""}$${dollars}.${cents}`;
}

function moneyInput(value: number | null): string {
  if (value === null) return "";
  return formatMoneyInputMinor(value);
}

function signedMoney(value: number | null): string {
  if (value === null) return "—";
  return value > 0 ? `+${money(value)}` : money(value);
}

function percentageChange(current: number, previous: number | null): string {
  if (previous === null || previous === 0) return "—";
  const numerator = BigInt(current - previous) * 10_000n;
  const denominator = BigInt(Math.abs(previous));
  const basisPoints = Number((numerator + (numerator >= 0n ? denominator / 2n : -(denominator / 2n))) / denominator);
  const sign = basisPoints > 0 ? "+" : "";
  return `${sign}${(basisPoints / 100).toFixed(2)}%`;
}

function fieldError(state: SalaryActionState, field: SalaryActionField): string | null {
  return state.fieldErrors[field] ?? null;
}

function ActionMessage({ state }: { readonly state: SalaryActionState }) {
  if (!state.message) return null;
  return <p className={`salary-action-message ${state.ok ? "is-success" : "is-error"}`} role="status">{state.message}</p>;
}

function FieldError({ state, field }: { readonly state: SalaryActionState; readonly field: SalaryActionField }) {
  const message = fieldError(state, field);
  return message ? <span className="salary-field-error">{message}</span> : null;
}

function useRefreshAfterSuccess(state: SalaryActionState): void {
  const router = useRouter();
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [router, state]);
}

function statusLabel(status: SalaryYearPresentation["status"]): string {
  return status === "finalized" ? "Finalized" : "In progress";
}

function SnapshotActions({ editing, onToggleEditing }: { readonly editing: boolean; readonly onToggleEditing: () => void }) {
  if (editing) return null;
  return <div className="salary-row-actions">
    <button className="salary-secondary-button" type="button" onClick={onToggleEditing}>Edit</button>
  </div>;
}

function SnapshotEditorForm({
  snapshot,
  totalPayPeriods,
  showRrq,
  updateAction,
  updatePending,
  updateState,
  deleteAction,
  deletePending,
  deleteState,
  onCancel,
}: {
  readonly snapshot: SalarySnapshotPresentation;
  readonly totalPayPeriods: number;
  readonly showRrq: boolean;
  readonly updateAction: (formData: FormData) => void;
  readonly updatePending: boolean;
  readonly updateState: SalaryActionState;
  readonly deleteAction: (formData: FormData) => void;
  readonly deletePending: boolean;
  readonly deleteState: SalaryActionState;
  readonly onCancel: () => void;
}) {
  const pending = updatePending || deletePending;
  return <div className="salary-inline-editor">
    <form action={updateAction} className="salary-inline-form">
      <input type="hidden" name="snapshotId" value={snapshot.id} />
      <input type="hidden" name="salaryYearId" value={snapshot.salaryYearId} />
      <label>Date<input name="snapshotOn" type="date" required defaultValue={snapshot.snapshotOn} disabled={pending} /><FieldError state={updateState} field="snapshotOn" /></label>
      <label>Federal cumulative<input name="federalCumulative" inputMode="decimal" required defaultValue={moneyInput(snapshot.federalCumulativeMinor)} disabled={pending} /><FieldError state={updateState} field="federalCumulative" /></label>
      <label>Provincial cumulative<input name="provincialCumulative" inputMode="decimal" required defaultValue={moneyInput(snapshot.provincialCumulativeMinor)} disabled={pending} /><FieldError state={updateState} field="provincialCumulative" /></label>
      {showRrq ? <label>RRQ contribution YTD <span>(optional)</span><input name="rrqContributionYtd" inputMode="decimal" defaultValue={moneyInput(snapshot.rrqContributionYtdMinor)} disabled={pending} /><FieldError state={updateState} field="rrqContributionYtd" /></label> : null}
      <label>Pay override <span>(optional)</span><input name="completedPayNumberOverride" type="number" min={1} max={totalPayPeriods} defaultValue={snapshot.completedPayNumberOverride ?? ""} disabled={pending} /></label>
      <label>Note <span>(optional)</span><input name="note" maxLength={500} defaultValue={snapshot.note ?? ""} disabled={pending} /></label>
      <div className="salary-inline-form-actions">
        <button className="salary-primary-button" type="submit" disabled={pending}>{updatePending ? "Saving…" : "Save snapshot"}</button>
        <button className="salary-secondary-button" type="button" onClick={onCancel} disabled={pending}>Cancel</button>
      </div>
      <ActionMessage state={updateState} />
    </form>
    <details className="salary-delete-details salary-inline-delete-details">
      <summary className="salary-danger-button">Delete</summary>
      <form action={deleteAction} className="salary-confirm-popover">
        <input type="hidden" name="snapshotId" value={snapshot.id} />
        <label><input type="checkbox" name="confirm" value="true" required disabled={pending} /> Confirm</label>
        <button className="salary-danger-button" type="submit" disabled={pending}>{deletePending ? "Deleting…" : "Delete snapshot"}</button>
        <ActionMessage state={deleteState} />
      </form>
    </details>
  </div>;
}

function useSnapshotEditor() {
  const [editing, setEditing] = useState(false);
  const [updateState, updateAction, updatePending] = useActionState(updateSalarySnapshotAction, initialSalaryActionState);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteSalarySnapshotAction, initialSalaryActionState);
  useRefreshAfterSuccess(updateState);
  useRefreshAfterSuccess(deleteState);
  return { editing, setEditing, updateState, updateAction, updatePending, deleteState, deleteAction, deletePending };
}

function SnapshotRow({ snapshot, totalPayPeriods, latest, showRrq }: { readonly snapshot: SalarySnapshotPresentation; readonly totalPayPeriods: number; readonly latest: boolean; readonly showRrq: boolean }) {
  const { editing, setEditing, updateState, updateAction, updatePending, deleteState, deleteAction, deletePending } = useSnapshotEditor();
  const percent = progressPercent(snapshot.completedPayNumber, totalPayPeriods);
  return <>
    <tr className={latest ? "is-latest" : undefined}>
      <th scope="row">{snapshot.snapshotOn}</th>
      <td data-label="Progress"><div className="salary-snapshot-progress"><span className="salary-mini-progress-ring" style={{ background: progressRingBackground(percent) }} aria-hidden="true" /><span><strong>{snapshot.completedPayNumber} / {totalPayPeriods}</strong><small>{percent.toFixed(2)}%</small></span></div>{snapshot.completedPayNumberOverride !== null ? <span className="salary-override-label">Override</span> : null}</td>
      <td data-label="Federal gross"><strong>{money(snapshot.federalCumulativeMinor)}</strong><small className={snapshot.federalDeltaMinor !== null && snapshot.federalDeltaMinor < 0 ? "salary-negative" : "salary-positive"}>{signedMoney(snapshot.federalDeltaMinor)}</small></td>
      <td data-label="Federal projection">{money(snapshot.federalProjectedYearEndMinor)}</td>
      <td data-label="Provincial gross"><strong>{money(snapshot.provincialCumulativeMinor)}</strong><small className={snapshot.provincialDeltaMinor !== null && snapshot.provincialDeltaMinor < 0 ? "salary-negative" : "salary-positive"}>{signedMoney(snapshot.provincialDeltaMinor)}</small></td>
      <td data-label="Provincial projection">{money(snapshot.provincialProjectedYearEndMinor)}</td>
      {showRrq ? <td data-label="RRQ contribution YTD"><strong>{money(snapshot.rrqContributionYtdMinor)}</strong></td> : null}
      <td data-label="Actions"><SnapshotActions editing={editing} onToggleEditing={() => setEditing((value) => !value)} /></td>
    </tr>
    {editing ? <tr className="salary-edit-row"><td colSpan={showRrq ? 8 : 7}><SnapshotEditorForm showRrq={showRrq} snapshot={snapshot} totalPayPeriods={totalPayPeriods} updateAction={updateAction} updatePending={updatePending} updateState={updateState} deleteAction={deleteAction} deletePending={deletePending} deleteState={deleteState} onCancel={() => setEditing(false)} /></td></tr> : null}
  </>;
}

function progressPercent(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (completed / total) * 100));
}

function progressRingBackground(percent: number): string {
  return `conic-gradient(var(--gold-light) 0 ${percent}%, rgba(197, 204, 207, .28) ${percent}% 100%)`;
}

function shiftDate(value: string | null, days: number): string | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatShortDate(value: string | null): string {
  if (!value) return "Not available";
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

type SalaryMetricIconName = "federal" | "projection" | "provincial" | "receipt" | "progress";

function SalaryMetricIcon({ name }: { readonly name: SalaryMetricIconName }) {
  return <span className="salary-ledger-metric-icon" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {name === "federal" ? <><path d="M5 20V9l7-5 7 5v11" /><path d="M3 20h18M8 20v-6h8v6M9 10h.01M15 10h.01" /></> : null}
      {name === "projection" ? <><path d="M5 17 10 12l3 3 6-7" /><path d="M15 8h4v4" /></> : null}
      {name === "provincial" ? <><circle cx="12" cy="12" r="8.5" /><path d="M14.5 8.8c-.6-.6-1.4-.9-2.5-.9-1.3 0-2.2.6-2.2 1.5 0 2.3 4.7 1.1 4.7 3.5 0 .9-.9 1.6-2.4 1.6-1.1 0-2-.3-2.6-1M12 6.5v11" /></> : null}
      {name === "receipt" ? <><path d="M6 4h12v16H6z" /><path d="M9 16v-3M12 16V9M15 16v-5" /></> : null}
      {name === "progress" ? <><path d="M5 17 9 13l3 2.5 5-5" /><path d="M15 8h4v4" /><path d="M5 18h14" /></> : null}
    </svg>
  </span>;
}

function SalaryMetricCard({ label, value, detail, icon, negative = false }: { readonly label: string; readonly value: string; readonly detail: string; readonly icon: SalaryMetricIconName; readonly negative?: boolean }) {
  return <article className="salary-ledger-metric editorial-page-art-surface">
    <SalaryMetricIcon name={icon} />
    <div className="salary-ledger-metric-content">
      <div className="salary-ledger-metric-head"><span>{label}</span></div>
      <strong className="salary-ledger-metric-value">{value}</strong>
      <small className={negative ? "salary-negative" : undefined}>{detail}</small>
    </div>
  </article>;
}

function rrqPercent(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

function rrqProgressWidth(value: number | null): number {
  return value === null ? 0 : Math.min(100, Math.max(0, value));
}

function rateInput(value: number | null): string {
  if (value === null) return "";
  const whole = Math.floor(value / 100);
  const fraction = String(value % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
}

function rrqReasonMessage(reason: SalaryYearView["rrqContributionTracker"]["unavailableReason"]): string {
  if (reason === "missing-year-limits") return "RRQ limits are not configured for this tax year.";
  if (reason === "no-observations") return "Add an RRQ contribution YTD value to start the tracker.";
  if (reason === "needs-follow-up-observation") return "Add another cumulative RRQ value to resume the forecast after the re-anchor.";
  if (reason === "zero-forecast-rate") return "The observed RRQ rate is zero; add a later pay-stub value to update the forecast.";
  if (reason === "maximum-not-reached-within-year") return "At the current observed rate, the maximum is not reached within this tax year.";
  return "RRQ projection is not available yet.";
}

function RrqLimitsEditor({ taxYear, limits, isOpen }: { readonly taxYear: number; readonly limits: SalaryYearView["rrqContributionTracker"]["limits"]; readonly isOpen: boolean }) {
  const [state, action, pending] = useActionState(updateRrqYearLimitsAction, initialSalaryActionState);
  useRefreshAfterSuccess(state);
  const formKey = `${taxYear}-${limits?.firstMaximumMinor ?? ""}-${limits?.additionalMaximumMinor ?? ""}-${limits?.ympeMinor ?? ""}-${limits?.yampeMinor ?? ""}-${limits?.firstRateBps ?? ""}-${limits?.additionalRateBps ?? ""}`;
  return isOpen ? <form id="rrq-limits-form" action={action} className="rrq-limits-form" key={formKey}>
      <input type="hidden" name="taxYear" value={taxYear} />
      <label>First maximum<input name="firstMaximum" inputMode="decimal" required defaultValue={moneyInput(limits?.firstMaximumMinor ?? null)} disabled={pending} /><FieldError state={state} field="firstMaximum" /></label>
      <label>Additional maximum<input name="additionalMaximum" inputMode="decimal" required defaultValue={moneyInput(limits?.additionalMaximumMinor ?? null)} disabled={pending} /><FieldError state={state} field="additionalMaximum" /></label>
      <label>YMPE<input name="ympe" inputMode="decimal" required defaultValue={moneyInput(limits?.ympeMinor ?? null)} disabled={pending} /><FieldError state={state} field="ympe" /></label>
      <label>YAMPE<input name="yampe" inputMode="decimal" required defaultValue={moneyInput(limits?.yampeMinor ?? null)} disabled={pending} /><FieldError state={state} field="yampe" /></label>
      <label>First rate (%)<input name="firstRate" inputMode="decimal" required defaultValue={rateInput(limits?.firstRateBps ?? null)} disabled={pending} /><FieldError state={state} field="firstRate" /></label>
      <label>Additional rate (%)<input name="additionalRate" inputMode="decimal" required defaultValue={rateInput(limits?.additionalRateBps ?? null)} disabled={pending} /><FieldError state={state} field="additionalRate" /></label>
      <div className="rrq-limits-form-footer"><small>Total employee maximum: <strong>{money(limits?.totalEmployeeMaximumMinor ?? null)}</strong></small><button className="salary-primary-button" type="submit" disabled={pending}>{pending ? "Saving…" : "Save limits"}</button></div>
      <ActionMessage state={state} />
    </form> : null;
}

interface RrqDetailContentProps {
  readonly tracker: SalaryYearView["rrqContributionTracker"];
  readonly limits: SalaryYearView["rrqContributionTracker"]["limits"];
  readonly forecastLabel: string;
  readonly forecastPerPayMinor: number | null;
  readonly forecastDetail: string;
  readonly totalPayPeriods: number;
}

function RrqDetailContent({ tracker, limits, forecastLabel, forecastPerPayMinor, forecastDetail, totalPayPeriods }: RrqDetailContentProps) {
  return <div className="rrq-tracker-details-body">
    <div className="rrq-tracker-legend" aria-label="RRQ tracker legend"><span><i className="is-paid" aria-hidden="true" />Paid YTD</span><span><i className="is-maximum" aria-hidden="true" />Annual maximum</span></div>
    <div className="rrq-tracker-forecast">
      <div><span>Projected completion</span><strong>{tracker.projectedCompletionPayNumber === null ? "Not available" : `Pay period ${tracker.projectedCompletionPayNumber} of ${totalPayPeriods}`}</strong><small>{tracker.projectedCompletionOn ? `Week of ${formatShortDate(tracker.projectedCompletionOn)}` : tracker.unavailableReason ? rrqReasonMessage(tracker.unavailableReason) : ""}</small></div>
      <div><span>{forecastLabel}</span><strong>{money(forecastPerPayMinor)}</strong><small>{forecastDetail}</small></div>
    </div>
    <div className="rrq-thresholds">
      <div><div><span>Provincial gross / YMPE</span><strong>{rrqPercent(tracker.ympeProgressPercent)}</strong></div><div className="rrq-threshold-bar" aria-hidden="true"><span style={{ width: `${rrqProgressWidth(tracker.ympeProgressPercent)}%` }} /></div><small>{money(tracker.provincialCumulativeMinor)} / {money(limits?.ympeMinor ?? null)}</small></div>
      <div><div><span>Provincial gross / YAMPE</span><strong>{rrqPercent(tracker.yampeProgressPercent)}</strong></div><div className="rrq-threshold-bar" aria-hidden="true"><span style={{ width: `${rrqProgressWidth(tracker.yampeProgressPercent)}%` }} /></div><small>{money(tracker.provincialCumulativeMinor)} / {money(limits?.yampeMinor ?? null)}</small></div>
    </div>
    <div className="rrq-recent">
      <div className="rrq-recent-heading"><strong>Recent RRQ entries</strong><small>Derived from cumulative pay-stub values</small></div>
      {tracker.recentEntries.length > 0 ? <div className="rrq-recent-table-wrap"><table className="rrq-recent-table"><caption className="sr-only">Recent RRQ contribution entries</caption><thead><tr><th scope="col">Pay date</th><th scope="col">Pay period</th><th scope="col">RRQ contribution</th><th scope="col">YTD total</th></tr></thead><tbody>{tracker.recentEntries.map((entry) => <tr key={`${entry.snapshotId ?? entry.snapshotOn}-${entry.completedPayNumber}`}><td>{formatShortDate(entry.snapshotOn)}</td><td>{entry.completedPayNumber} of {totalPayPeriods}</td><td>{entry.derivedPerPayMinor === null ? entry.isReanchor ? "Re-anchor" : "—" : money(entry.derivedPerPayMinor)}</td><td>{money(entry.rrqContributionYtdMinor)}</td></tr>)}</tbody></table></div> : <p className="rrq-tracker-empty">{rrqReasonMessage(tracker.unavailableReason)}</p>}
    </div>
  </div>;
}

function RrqContributionTracker({ tracker, taxYear, totalPayPeriods }: { readonly tracker: SalaryYearView["rrqContributionTracker"]; readonly taxYear: number; readonly totalPayPeriods: number }) {
  const [isLimitsOpen, setIsLimitsOpen] = useState(false);
  const limits = tracker.limits;
  const completionWidth = rrqProgressWidth(tracker.completionPercent);
  const onTrack = tracker.status === "available" && tracker.overageMinor === 0;
  const forecastPerPayMinor = tracker.tierAwareForecastPerPayMinor ?? tracker.weightedPerPayMinor;
  const forecastLabel = tracker.tierAwareForecastPerPayMinor === null ? "Forecast per pay" : "Tier-aware forecast per pay";
  const forecastDetail = tracker.tierAwareForecastPerPayMinor === null
    ? tracker.weightedPerPayMinor === null ? "Enter cumulative values on pay stubs" : "Weighted from recent RRQ intervals"
    : tracker.projectedTier === "mixed" ? "Blended across both RRQ zones"
      : tracker.projectedTier === "additional" ? "Additional RRQ zone"
        : tracker.projectedTier === "first" ? "First RRQ zone"
          : "RRQ maximum reached";
  return <section className="rrq-tracker" aria-labelledby="rrq-tracker-heading">
    <header className="rrq-tracker-header">
      <div><p className="salary-panel-eyebrow">Québec — RRQ/QPP</p><h4 id="rrq-tracker-heading">Employee RRQ YTD</h4></div>
      <div className="rrq-tracker-header-side">
        <span className={`salary-status-badge ${onTrack ? "is-progress" : tracker.overageMinor > 0 ? "is-error" : "is-neutral"}`}>{onTrack ? "On track" : tracker.overageMinor > 0 ? "Over maximum" : "Needs data"}</span>
      </div>
    </header>
    <RrqLimitsEditor taxYear={taxYear} limits={limits} isOpen={isLimitsOpen} />
    <div className="rrq-tracker-summary">
      <div className="rrq-progress-ring" style={{ background: `conic-gradient(var(--gold-light) 0 ${completionWidth}%, rgba(197, 204, 207, .28) ${completionWidth}% 100%)` }} role="img" aria-label={`${rrqPercent(tracker.completionPercent)} of RRQ maximum`}>
        <div><strong>{rrqPercent(tracker.completionPercent)}</strong><span>of max</span></div>
      </div>
      <dl className="rrq-tracker-metrics">
        <div><dt>Paid YTD</dt><dd>{money(tracker.paidYtdMinor)}</dd></div>
        <div><dt>Yearly max</dt><dd><span>{money(limits?.totalEmployeeMaximumMinor ?? null)}</span><button className="salary-secondary-button rrq-limits-toggle rrq-limits-edit-button" type="button" onClick={() => setIsLimitsOpen((value) => !value)} aria-label={isLimitsOpen ? "Close yearly limit editor" : "Edit yearly limits"} aria-expanded={isLimitsOpen} aria-controls="rrq-limits-form" title={isLimitsOpen ? "Close yearly limit editor" : "Edit yearly limits"}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 16.5-.8 3.3 3.3-.8L18.2 7.3a2.1 2.1 0 0 0-3-3z" /><path d="m13.5 5.5 5 5" /></svg></button></dd></div>
        <div><dt>Remaining</dt><dd>{money(tracker.remainingMinor)}</dd></div>
      </dl>
    </div>
    <div className="rrq-desktop-details" aria-label="RRQ forecast and history">
      <RrqDetailContent tracker={tracker} limits={limits} forecastLabel={forecastLabel} forecastPerPayMinor={forecastPerPayMinor} forecastDetail={forecastDetail} totalPayPeriods={totalPayPeriods} />
    </div>
    <details className="rrq-mobile-details">
      <summary>View RRQ forecast &amp; history</summary>
      <RrqDetailContent tracker={tracker} limits={limits} forecastLabel={forecastLabel} forecastPerPayMinor={forecastPerPayMinor} forecastDetail={forecastDetail} totalPayPeriods={totalPayPeriods} />
    </details>
  </section>;
}

function LatestSnapshotPanel({ year }: { readonly year: SalaryYearPresentation }) {
  const snapshot = year.latestSnapshot;
  const completed = snapshot?.completedPayNumber ?? 0;
  const percent = progressPercent(completed, year.totalPayPeriods);
  const remaining = Math.max(0, year.totalPayPeriods - completed);
  const nextPayday = shiftDate(snapshot?.snapshotOn ?? null, 14);
  return <section className="salary-latest-panel" aria-label="Latest salary snapshot">
    <AnimatedLineBackground lineCount={8} opacity={0.3} speed={17} scale={1.04} strokeWidth={1.1} density={0.95} drift={0.2} waveAmplitude={34} pulseStrength={0.8} color="#9F9270" accentColor="#E0C681" seed="salary-latest" className="animated-line-background--salary-latest" />
    <div className="salary-progress-ring" style={{ background: progressRingBackground(percent) }} role="img" aria-label={`${completed} of ${year.totalPayPeriods} pay periods saved`}>
      <div><strong>{completed}</strong><span>of <span className="font-numeric">{year.totalPayPeriods}</span></span></div>
    </div>
    <div className="salary-latest-copy">
      <p className="salary-panel-eyebrow">Latest snapshot</p>
      <h4>{snapshot ? <><span className="font-numeric">{completed}</span> of <span className="font-numeric">{year.totalPayPeriods}</span> pay periods saved</> : "No salary snapshot yet"}</h4>
      <div className="salary-progress-bar" aria-hidden="true"><span style={{ width: `${percent}%` }} /></div>
      <p className="salary-progress-meta"><span><span className="font-numeric">{percent.toFixed(2)}%</span> complete</span><span aria-hidden="true">·</span><span><span className="font-numeric">{remaining}</span> remaining</span></p>
    </div>
    <dl className="salary-latest-details">
      <div><dt>Next payday</dt><dd><span className="salary-latest-detail-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></svg></span>{nextPayday ? formatShortDate(nextPayday) : "Awaiting snapshot"}</dd></div>
      <div><dt>Pay cadence</dt><dd><span className="salary-latest-detail-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></svg></span>Every 14 days</dd></div>
    </dl>
  </section>;
}

function NewYearForm({ selectedTaxYear }: { readonly selectedTaxYear: number }) {
  const [state, action, pending] = useActionState(createSalaryYearAction, initialSalaryActionState);
  useRefreshAfterSuccess(state);
  return <form action={action} className="salary-form-grid salary-new-year-form"><input type="hidden" name="taxYear" value={selectedTaxYear} /><div><label htmlFor="salary-new-base">Annual base salary</label><input id="salary-new-base" name="annualBase" inputMode="decimal" placeholder="82,502.00" required /><FieldError state={state} field="annualBase" /></div><div><label htmlFor="salary-new-pay-periods">Pay periods override <span>(optional)</span></label><input id="salary-new-pay-periods" name="payPeriodsPerYearOverride" type="number" min={1} max={366} placeholder="26" /><FieldError state={state} field="payPeriodsPerYearOverride" /></div><div className="salary-form-wide"><label htmlFor="salary-new-note">Note <span>(optional)</span></label><input id="salary-new-note" name="note" maxLength={500} /></div><div className="salary-form-actions"><button className="salary-primary-button" type="submit" disabled={pending}>{pending ? "Creating…" : `Create ${selectedTaxYear} salary year`}</button></div><ActionMessage state={state} /></form>;
}

function FinalizedYearForm({ selectedTaxYear }: { readonly selectedTaxYear: number }) {
  const [state, action, pending] = useActionState(createFinalizedSalaryYearAction, initialSalaryActionState);
  useRefreshAfterSuccess(state);
  return <form action={action} className="salary-form-grid salary-new-year-form">
    <input type="hidden" name="taxYear" value={selectedTaxYear} />
    <div>
      <label htmlFor="salary-finalized-federal">Final federal gross income</label>
      <input id="salary-finalized-federal" name="finalFederal" inputMode="decimal" placeholder="80,099.00" required />
      <FieldError state={state} field="finalFederal" />
    </div>
    <div className="salary-form-wide">
      <label htmlFor="salary-finalized-note">Note <span>(optional)</span></label>
      <input id="salary-finalized-note" name="note" maxLength={500} />
      <FieldError state={state} field="note" />
    </div>
    <div className="salary-form-actions">
      <button className="salary-primary-button" type="submit" disabled={pending}>{pending ? "Savingâ€¦" : `Save finalized ${selectedTaxYear} income`}</button>
    </div>
    <ActionMessage state={state} />
  </form>;
}

function YearEditor({ year }: { readonly year: SalaryYearPresentation }) {
  const [state, action, pending] = useActionState(updateSalaryYearAction, initialSalaryActionState);
  useRefreshAfterSuccess(state);
  return <form action={action} className="salary-form-grid salary-year-editor"><input type="hidden" name="salaryYearId" value={year.id} /><input type="hidden" name="taxYear" value={year.taxYear} /><div><label htmlFor={`salary-base-${year.id}`}>Annual base salary</label><input id={`salary-base-${year.id}`} name="annualBase" inputMode="decimal" defaultValue={moneyInput(year.annualBaseMinor)} placeholder="Not captured" /><FieldError state={state} field="annualBase" /></div><div><label htmlFor={`salary-periods-${year.id}`}>Pay periods override <span>(optional)</span></label><input id={`salary-periods-${year.id}`} name="payPeriodsPerYearOverride" type="number" min={1} max={366} defaultValue={year.payPeriodsPerYearOverride ?? ""} /><FieldError state={state} field="payPeriodsPerYearOverride" /></div><div className="salary-form-wide"><label htmlFor={`salary-note-${year.id}`}>Note <span>(optional)</span></label><input id={`salary-note-${year.id}`} name="note" maxLength={500} defaultValue={year.note ?? ""} /></div><div className="salary-form-actions"><button className="salary-primary-button" type="submit" disabled={pending}>{pending ? "Saving…" : "Save year"}</button><ActionMessage state={state} /></div></form>;
}

function SnapshotForm({ year, showRrq }: { readonly year: SalaryYearPresentation; readonly showRrq: boolean }) {
  const [state, action, pending] = useActionState(createSalarySnapshotAction, initialSalaryActionState);
  useRefreshAfterSuccess(state);
  return <form action={action} className="salary-form-grid"><input type="hidden" name="salaryYearId" value={year.id} /><div><label htmlFor="salary-snapshot-date">Pay date</label><input id="salary-snapshot-date" name="snapshotOn" type="date" min={`${year.taxYear}-01-01`} max={`${year.taxYear}-12-31`} required /><FieldError state={state} field="snapshotOn" /></div><div><label htmlFor="salary-federal">Federal cumulative gross</label><input id="salary-federal" name="federalCumulative" inputMode="decimal" placeholder="65,587.10" required /><FieldError state={state} field="federalCumulative" /></div><div><label htmlFor="salary-provincial">Provincial cumulative gross</label><input id="salary-provincial" name="provincialCumulative" inputMode="decimal" placeholder="67,153.59" required /><FieldError state={state} field="provincialCumulative" /></div>{showRrq ? <div><label htmlFor="salary-rrq">RRQ contribution YTD <span>(optional)</span></label><input id="salary-rrq" name="rrqContributionYtd" inputMode="decimal" placeholder="3,650.00" /><FieldError state={state} field="rrqContributionYtd" /></div> : null}<div><label htmlFor="salary-pay-override">Completed pay override <span>(optional)</span></label><input id="salary-pay-override" name="completedPayNumberOverride" type="number" min={1} max={year.totalPayPeriods} placeholder="Derived from payday" /><FieldError state={state} field="completedPayNumberOverride" /></div><div className="salary-form-wide"><label htmlFor="salary-snapshot-note">Note <span>(optional)</span></label><input id="salary-snapshot-note" name="note" maxLength={500} /></div><div className="salary-form-actions"><button className="salary-primary-button" type="submit" disabled={pending}>{pending ? "Saving…" : "Save snapshot"}</button><ActionMessage state={state} /></div></form>;
}

function SnapshotTimeline({ year, showRrq }: { readonly year: SalaryYearPresentation; readonly showRrq: boolean }) {
  const rows = [...year.snapshots].sort((left, right) => right.snapshotOn.localeCompare(left.snapshotOn));
  return <>
    <div className="salary-table-wrap">
      <table className="salary-timeline-table">
        <caption className="sr-only">{year.taxYear} salary snapshots</caption>
        <thead>
          <tr>
            <th scope="col">Pay date</th>
            <th scope="col">Progress</th>
            <th scope="col">Federal gross</th>
            <th scope="col">Federal projection</th>
            <th scope="col">Provincial gross</th>
            <th scope="col">Provincial projection</th>
            {showRrq ? <th scope="col">RRQ contribution YTD</th> : null}
            <th scope="col"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>{rows.map((snapshot, index) => <SnapshotRow showRrq={showRrq} key={snapshot.id} snapshot={snapshot} totalPayPeriods={year.totalPayPeriods} latest={index === 0} />)}</tbody>
      </table>
    </div>
    {rows.length === 0 ? <div className="salary-empty">A current cumulative pay-stub value is enough to begin. You do not need to recreate every historical paycheck.</div> : null}
  </>;
}

function HistoricalIncomeRow({ year, previous }: { readonly year: SalaryYearPresentation; readonly previous: number | null }) {
  const [state, action, pending] = useActionState(updateFinalFederalSalaryYearAction, initialSalaryActionState);
  useRefreshAfterSuccess(state);
  const value = year.finalFederalMinor ?? 0;
  const changeMinor = value - (previous ?? value);
  const changeClass = previous === null ? "" : changeMinor >= 0 ? "is-positive" : "is-negative";
  return <tr key={year.id}>
    <th scope="row" data-label="Tax year">{year.taxYear}</th>
    <td data-label="Final federal">
      <form action={action} className="salary-history-edit-form">
        <input type="hidden" name="salaryYearId" value={year.id} />
        <label className="sr-only" htmlFor={`salary-final-${year.id}`}>Official federal for {year.taxYear}</label>
        <input id={`salary-final-${year.id}`} name="finalFederal" inputMode="decimal" required defaultValue={moneyInput(value)} aria-describedby={`salary-final-help-${year.id}`} />
        <button className="salary-primary-button" type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
        <span id={`salary-final-help-${year.id}`} className="sr-only">Edit the finalized federal amount for {year.taxYear}.</span>
        <FieldError state={state} field="finalFederal" />
        <ActionMessage state={state} />
      </form>
    </td>
    <td data-label="Change"><span className={`salary-history-change ${changeClass}`}><strong>{signedMoney(changeMinor)}</strong><small>{percentageChange(value, previous)}</small></span></td>
    <td data-label="Status"><span className="salary-status-badge is-finalized">Finalized</span></td>
  </tr>;
}

function HistoricalIncome({ years, currentTaxYear }: { readonly years: readonly SalaryYearPresentation[]; readonly currentTaxYear: number }) {
  const finalizedYears = years.filter((year) => year.status === "finalized" && year.finalFederalMinor !== null).sort((left, right) => left.taxYear - right.taxYear);
  const currentYear = years.find((year) => year.taxYear === currentTaxYear) ?? null;
  const chartYears = currentYear && !finalizedYears.some((year) => year.id === currentYear.id)
    ? [...finalizedYears, currentYear].sort((left, right) => left.taxYear - right.taxYear)
    : finalizedYears;
  const chartRows = chartYears.flatMap((year) => {
    const actualMinor = year.finalFederalMinor ?? year.federalCumulativeMinor;
    if (actualMinor === null) return [];
    const isCurrentYear = year.taxYear === currentTaxYear;
    const projectedMinor = isCurrentYear ? year.federalProjectedYearEndMinor ?? actualMinor : actualMinor;
    return [{ year, actualMinor, projectedMinor, isCurrentYear }];
  });
  const max = Math.max(1, ...chartRows.flatMap((row) => [row.actualMinor, row.projectedMinor]));
  return <section className="salary-history-grid"><article className="card section-card"><div className="salary-history-header"><div><p className="eyebrow">Incomes history</p><h3 className="card-title">Finalized income by year</h3><p className="card-subtitle">Actual income is shown in navy; the current-year estimate sits behind it in gold.</p></div></div>{chartRows.length > 0 ? <><div className="salary-chart-legend" aria-label="Income chart legend"><span><i className="salary-chart-legend-swatch is-actual" aria-hidden="true" />Actual</span><span><i className="salary-chart-legend-swatch is-projection" aria-hidden="true" />Current estimate</span></div><div className="salary-chart" role="img" aria-label="Federal finalized income by year with current-year estimate">{chartRows.map((row, index) => { const previous = chartRows[index - 1]?.actualMinor ?? null; const comparisonValue = row.isCurrentYear ? row.projectedMinor : row.actualMinor; const changeMinor = previous === null ? null : comparisonValue - previous; const changePercentage = percentageChange(comparisonValue, previous); const actualWidth = Math.max(6, Math.round((row.actualMinor / max) * 100)); const projectedWidth = Math.max(6, Math.round((row.projectedMinor / max) * 100)); return <div className={`salary-chart-row${row.isCurrentYear ? " is-current-year" : ""}`} key={row.year.id}><span>{row.year.taxYear}</span><div className="salary-chart-track" title={row.isCurrentYear ? `Actual ${money(row.actualMinor)}; estimate ${money(row.projectedMinor)}` : `Actual ${money(row.actualMinor)}`}><div className="salary-chart-projection" aria-hidden={!row.isCurrentYear} style={{ width: `${projectedWidth}%` }}>{row.isCurrentYear ? <strong>Est. {money(row.projectedMinor)}</strong> : null}</div><div className="salary-chart-bar" style={{ width: `${actualWidth}%` }}><strong>{money(row.actualMinor)}</strong></div></div><small>{signedMoney(changeMinor)} <span>{changePercentage}</span></small></div>; })}</div></> : <div className="salary-empty">Finalize a year to build the federal income history.</div>}</article><article className="card section-card"><div className="card-head"><div><p className="eyebrow">Editable record</p><h3 className="card-title">Annual federal income</h3></div></div>{finalizedYears.length > 0 ? <div className="salary-table-wrap"><table className="salary-history-table"><caption className="sr-only">Finalized federal income history</caption><thead><tr><th scope="col">Year</th><th scope="col">Final federal</th><th scope="col">Change</th><th scope="col">Status</th></tr></thead><tbody>{finalizedYears.map((year, index) => <HistoricalIncomeRow key={year.id} year={year} previous={finalizedYears[index - 1]?.finalFederalMinor ?? null} />)}</tbody></table></div> : null}</article></section>;
}

function FinalizationForm({ year, state, action, pending }: { readonly year: SalaryYearPresentation; readonly state: SalaryActionState; readonly action: (formData: FormData) => void; readonly pending: boolean }) {
  return <form action={action} className="salary-official-panel">
    <input type="hidden" name="salaryYearId" value={year.id} />
    <label className="salary-official-label" htmlFor={`salary-finalize-${year.id}`}><span className="salary-official-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 5 6v5c0 4.4 2.8 8.1 7 10 4.2-1.9 7-5.6 7-10V6l-7-3Z" /><path d="m9.5 12 1.7 1.7 3.5-3.7" /></svg></span>Official federal total</label>
    <input id={`salary-finalize-${year.id}`} name="finalFederal" inputMode="decimal" required defaultValue={moneyInput(year.latestSnapshot?.federalCumulativeMinor ?? null)} aria-describedby={`salary-finalize-help-${year.id}`} />
    <span id={`salary-finalize-help-${year.id}`} className="salary-form-hint">Prefilled from latest federal YTD; edit if the official total differs.</span>
    <FieldError state={state} field="finalFederal" />
    <label className="salary-official-confirm"><input type="checkbox" name="confirm" value="true" required /> Confirm official total</label>
    <button className="salary-primary-button" type="submit" disabled={pending}>{pending ? "Finalizing…" : "Finalize year"}</button>
    <ActionMessage state={state} />
  </form>;
}

export function SalariesManager({ years, selectedYear, availableYears, selectedTaxYear, currentTaxYear, preferenceScope }: SalariesManagerProps) {
  const defaultRrqVisible = years.some((year) => year.snapshots.some((snapshot) => snapshot.rrqContributionYtdMinor !== null));
  const [showRrq, toggleRrq] = useRrqVisibility(preferenceScope, defaultRrqVisible);
  const [showYearEditor, setShowYearEditor] = useState(false);
  const [showSnapshotForm, setShowSnapshotForm] = useState(false);
  const [finalizeState, finalizeAction, finalizePending] = useActionState(finalizeSalaryYearAction, initialSalaryActionState);
  const [reopenState, reopenAction, reopenPending] = useActionState(reopenSalaryYearAction, initialSalaryActionState);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteSalaryYearAction, initialSalaryActionState);
  useRefreshAfterSuccess(finalizeState);
  useRefreshAfterSuccess(reopenState);
  useRefreshAfterSuccess(deleteState);
  const hasFinalizedIncome = years.some((year) => year.status === "finalized" && year.finalFederalMinor !== null);

  return <>
    <section className="salary-year-strip editorial-page-art-surface" aria-label="Salary years">
      <div><span className="eyebrow">Tax year</span><div className="salary-year-links">{availableYears.map((year) => <a className={year === selectedTaxYear ? "is-active" : ""} href={`/salaries?year=${year}`} key={year}>{year}</a>)}</div></div>
      <div className="salary-year-strip-note">{selectedYear ? <><span className={`salary-status-badge ${selectedYear.status === "finalized" ? "is-finalized" : "is-progress"}`}>{statusLabel(selectedYear.status)}</span><span>{selectedYear.paydayAnchorOn ? <>Payday rhythm anchored at <span className="font-numeric">{selectedYear.paydayAnchorOn}</span></> : "No payday anchor yet"}</span></> : <span>No record yet for <span className="font-numeric">{selectedTaxYear}</span></span>}</div>
    </section>

    <div className="salary-rrq-preference">
      <button type="button" className="salary-secondary-button" aria-pressed={showRrq} aria-describedby="salary-rrq-preference-help" onClick={toggleRrq}>
        {showRrq ? "Hide" : "Show"} Québec — RRQ/QPP
      </button>
      <p id="salary-rrq-preference-help">Optional Québec contribution tracking, not CPP/RPC. Hiding it keeps saved contributions and salary tracking unchanged.</p>
    </div>

    {selectedYear ? <>
      <section className="card section-card salary-ledger-card editorial-page-art-surface">
        <div className="salary-ledger-hero">
          <div className="salary-ledger-main-column">
            <header className="salary-ledger-heading">
              <div><p className="eyebrow"><span className="font-numeric">{selectedYear.taxYear}</span> salary ledger</p><h3 className="card-title">Cumulative gross snapshots</h3><p className="card-subtitle">Save one pay-stub total at a time; federal and provincial totals remain independent.</p></div>
              <div className="salary-ledger-heading-actions">
                <button className="salary-secondary-button" type="button" onClick={() => setShowYearEditor((value) => !value)}>{showYearEditor ? "Close year editor" : "Edit year"}</button>
                <details className="salary-delete-details"><summary className="salary-danger-button">Delete year</summary><form action={deleteAction} className="salary-confirm-popover"><input type="hidden" name="salaryYearId" value={selectedYear.id} /><label><input type="checkbox" name="confirm" value="true" required /> Delete year and snapshots</label><button className="salary-danger-button" type="submit" disabled={deletePending}>{deletePending ? "Deleting…" : "Delete salary year"}</button><ActionMessage state={deleteState} /></form></details>
              </div>
            </header>
            {showYearEditor ? <YearEditor year={selectedYear} /> : null}
            <LatestSnapshotPanel year={selectedYear} />
          </div>
          {selectedYear.status === "in_progress" ? <FinalizationForm year={selectedYear} state={finalizeState} action={finalizeAction} pending={finalizePending} /> : <form action={reopenAction} className="salary-official-panel salary-reopen-panel">
            <input type="hidden" name="salaryYearId" value={selectedYear.id} />
            <p className="salary-official-label"><span className="salary-official-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 5 6v5c0 4.4 2.8 8.1 7 10 4.2-1.9 7-5.6 7-10V6l-7-3Z" /><path d="m9.5 12 1.7 1.7 3.5-3.7" /></svg></span>Official federal total</p>
            <strong className="salary-official-value">{money(selectedYear.finalFederalMinor)}</strong>
            <p className="salary-official-description">This year is finalized. Reopen it if corrections are needed.</p>
            <label className="salary-official-confirm"><input type="checkbox" name="confirm" value="true" required /> Reopen for corrections</label>
            <button className="salary-secondary-button" type="submit" disabled={reopenPending}>{reopenPending ? "Reopening…" : "Reopen year"}</button>
            <ActionMessage state={reopenState} />
          </form>}
        </div>
        <section className="metric-grid salary-overview-metrics salary-ledger-metrics">
          <SalaryMetricCard icon="federal" label="Federal gross (YTD)" value={money(selectedYear.federalCumulativeMinor)} detail="From saved snapshots" />
          <SalaryMetricCard icon="projection" label="Federal projection" value={money(selectedYear.federalProjectedYearEndMinor)} detail={selectedYear.status === "finalized" ? "Official finalized income." : "Year-end projection"} />
          <SalaryMetricCard icon="provincial" label="Provincial gross (YTD)" value={money(selectedYear.provincialCumulativeMinor)} detail="From saved snapshots" />
          <SalaryMetricCard icon="receipt" label="Provincial projection" value={money(selectedYear.provincialProjectedYearEndMinor)} detail="Year-end projection" />
        </section>
        <section className="salary-snapshots-section">
          <div className={`salary-snapshots-layout${showRrq ? "" : " is-rrq-hidden"}`}>
            <div className="salary-snapshots-ledger"><div className="salary-timeline-toolbar"><div className="salary-snapshots-heading-copy"><strong>Snapshots</strong><span className="salary-count-pill">{selectedYear.snapshots.length} snapshot{selectedYear.snapshots.length === 1 ? "" : "s"}</span><span>{selectedYear.totalPayPeriods} total pay periods</span></div><button className="salary-primary-button navy-action-button" type="button" onClick={() => setShowSnapshotForm((value) => !value)}>{showSnapshotForm ? "Close snapshot form" : "Add salary snapshot"}<span className="salary-add-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d={showSnapshotForm ? "M5 12h14" : "M12 5v14M5 12h14"} /></svg></span></button></div>{showSnapshotForm ? <div className="salary-form-panel"><SnapshotForm year={selectedYear} showRrq={showRrq} /></div> : null}<SnapshotTimeline year={selectedYear} showRrq={showRrq} /></div>
            {showRrq ? <div className="rrq-tracker-divider">
              <RrqContributionTracker tracker={selectedYear.rrqContributionTracker} taxYear={selectedYear.taxYear} totalPayPeriods={selectedYear.totalPayPeriods} />
            </div> : null}
          </div>
        </section>
      </section>
    </> : selectedTaxYear < currentTaxYear
      ? <section className="card section-card salary-empty-year editorial-page-art-surface"><p className="eyebrow">Finalized income</p><h3 className="card-title">Add {selectedTaxYear} federal income</h3><p className="card-subtitle">Enter the official gross income. Historical years do not need a base salary or pay snapshots.</p><FinalizedYearForm selectedTaxYear={selectedTaxYear} /></section>
      : <section className="card section-card salary-empty-year editorial-page-art-surface"><p className="eyebrow">No salary ledger</p><h3 className="card-title">Start tracking {selectedTaxYear}</h3><p className="card-subtitle">Create one annual record, then add cumulative pay-stub values as they arrive.</p><NewYearForm selectedTaxYear={selectedTaxYear} /></section>}

    {hasFinalizedIncome ? <HistoricalIncome years={years} currentTaxYear={currentTaxYear} /> : null}
  </>;
}
