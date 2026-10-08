"use client";

import { useEffect, useState, type RefObject } from "react";
import type { InvestmentProjectionAccountView, InvestmentProjectionProjectView, InvestmentProjectionScheduleView } from "@athena/database";
import {
  accountLabel,
  cashFlowCurrentAmountMinor,
  cashFlowSources,
  frequencyLabel,
  longDateLabel,
  money,
  percentFromBasisPoints,
  safeMinorSum,
} from "./investment-calculation";
import { ProjectionDetailIcon, ProjectionNoteIcon } from "./investment-icons";
import { ProjectionChart, RATE_COLORS } from "./investment-project-chart";
import { InvestmentDialog } from "./investment-dialog";

function totalPortfolioContributionsMinor(project: InvestmentProjectionProjectView): number | null {
  return safeMinorSum(project.annualContributionSummary.map((summary) => summary.annualContributionMinor));
}

export function scheduleSummary(schedule: InvestmentProjectionScheduleView | null, account: InvestmentProjectionAccountView | null): string {
  if (!schedule) return "No saved schedule";
  const overrideCount = schedule.annualOverrides.length;
  const increase = schedule.annualIncreaseMode === "fixed_amount" ? `${money(schedule.annualIncreaseMinor)} annual increase` : `${percentFromBasisPoints(schedule.annualIncreaseBps)}% annual increase`;
  if (schedule.contributionSource === "cash_flow") {
    const sourceCount = account ? cashFlowSources(account).length : 0;
    return `Automatic Cash Flow · ${sourceCount} source${sourceCount === 1 ? "" : "s"} · ${money(account ? cashFlowCurrentAmountMinor(account) : null)} combined now · ${increase}${overrideCount > 0 ? ` · ${overrideCount} override${overrideCount === 1 ? "" : "s"}` : ""}`;
  }
  return `Manual override · ${frequencyLabel(schedule.frequency)} · ${money(schedule.baseContributionMinor)} base · ${increase}${overrideCount > 0 ? ` · ${overrideCount} override${overrideCount === 1 ? "" : "s"}` : ""}`;
}
export function ProjectDetail({
  project,
  onEdit,
  onClose,
  onDelete,
  restoreFocusRef,
  shouldRestoreFocus,
  onRestoredFocus,
}: {
  readonly project: InvestmentProjectionProjectView;
  readonly onEdit: () => void;
  readonly onClose: () => void;
  readonly onDelete: () => void;
  readonly restoreFocusRef?: RefObject<HTMLElement | null>;
  readonly shouldRestoreFocus?: () => boolean;
  readonly onRestoredFocus?: () => void;
}) {
  const [chartExpanded, setChartExpanded] = useState(false);
  useEffect(() => {
    if (!chartExpanded) return;
    function closeChartOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") setChartExpanded(false);
    }
    document.addEventListener("keydown", closeChartOnEscape);
    return () => document.removeEventListener("keydown", closeChartOnEscape);
  }, [chartExpanded]);
  const defaultScenario = project.scenarios[0];
  const defaultEndpoint = defaultScenario?.points.at(-1);
  const totalContributionsMinor = totalPortfolioContributionsMinor(project);
  const accountRows = project.accounts.map((account) => ({
    account,
    schedule: account.schedule ?? project.accountSchedules.find((candidate) => candidate.investmentAccountId === account.id) ?? null,
  }));
  const scheduleCount = accountRows.filter(({ schedule }) => schedule !== null).length;
  const handleEscape = () => { if (chartExpanded) setChartExpanded(false); else onClose(); };
  return <InvestmentDialog backdropClassName="investment-modal-backdrop investment-detail-modal-backdrop" dialogClassName="investment-dialog investment-detail-dialog" titleId="investment-detail-title" dismissOnBackdrop restoreFocusRef={restoreFocusRef} shouldRestoreFocus={shouldRestoreFocus} onRestoredFocus={onRestoredFocus} onClose={onClose} onEscape={handleEscape}>
      <div className="investment-dialog-header investment-detail-dialog-header">
        <div><p className="eyebrow">Saved {project.mode === "calculator" ? "calculator" : "portfolio"} project</p><h2 id="investment-detail-title">{project.name}</h2><p className="investment-dialog-subtitle"><span className="investment-detail-duration"><ProjectionNoteIcon name="date" /><span>{project.horizonYears} years</span></span><span aria-hidden="true"> · </span>baseline {project.baselineDate} · {project.mode === "calculator" ? "manual starting amount" : "live investment-account balances"}</p></div>
        <div className="investment-dialog-header-actions"><button className="investment-secondary-button" type="button" onClick={onEdit}>Edit</button><button className="investment-close-button" type="button" onClick={onClose} data-investment-dialog-initial-focus aria-label="Close projection details">Close</button></div>
      </div>
      {project.notes ? <p className="investment-detail-note">{project.notes}</p> : null}
      {project.warnings.length > 0 ? <div className="investment-warning" role="status"><strong>Review live inputs</strong><ul>{project.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : null}
      {chartExpanded ? <div className="investment-detail-expanded-chart-region"><ProjectionChart scenarios={project.scenarios} expanded onToggleExpand={() => setChartExpanded(false)} /></div> : <>
      <div className="investment-detail-summary">
        <div className="investment-detail-summary-leading">
          <div className="investment-detail-summary-metric is-starting"><ProjectionDetailIcon name="bank" /><span><span>Starting balance</span><strong>{money(project.startingBalanceMinor)}</strong></span></div>
          <div className="investment-detail-summary-metric is-contributions"><ProjectionDetailIcon name="coins" /><span><span>{project.mode === "calculator" ? "Manual amount" : "Total contributions"}</span><strong>{project.mode === "calculator" ? money(project.manualStartingAmountMinor) : money(totalContributionsMinor)}</strong></span></div>
        </div>
        <div className="investment-detail-summary-metric is-endpoint"><ProjectionDetailIcon name="target" /><span><span>{defaultScenario ? `${percentFromBasisPoints(defaultScenario.rateBps)}% endpoint (year ${project.horizonYears})` : "Endpoint"}</span><strong>{money(defaultEndpoint?.balanceMinor)}</strong></span></div>
      </div>
      <div className="investment-detail-visual-grid">
        <ProjectionChart scenarios={project.scenarios} onToggleExpand={() => setChartExpanded(true)} />
        <section className="investment-detail-endpoint-card" aria-labelledby="investment-detail-endpoint-title">
          <h3 id="investment-detail-endpoint-title"><ProjectionDetailIcon name="scale" /><span>Ending balance at year {project.horizonYears}</span></h3>
          <div className="investment-detail-endpoint-head"><span>Scenario</span><span>Total gain</span><span>CAGR</span></div>
          <div className="investment-detail-endpoint-list">{project.scenarios.map((scenario, index) => { const endpoint = scenario.points.at(-1); return <div className={`investment-detail-endpoint-row is-scenario-${index}`} key={scenario.rateBps}><span className="investment-detail-endpoint-scenario"><i style={{ background: RATE_COLORS[index % RATE_COLORS.length] }} aria-hidden="true" /><span><strong>{percentFromBasisPoints(scenario.rateBps)}%{index === 0 ? " (Baseline)" : ""}</strong><small>{money(endpoint?.balanceMinor)}</small></span></span><span className={endpoint && endpoint.growthMinor < 0 ? "is-negative" : ""}>{money(endpoint?.growthMinor)}</span><span>{percentFromBasisPoints(scenario.rateBps)}%</span></div>; })}</div>
          <div className="investment-detail-disclaimer"><span aria-hidden="true">i</span><p>All values are in today&apos;s dollars.<br />CAGR = compound annual growth rate.</p></div>
        </section>
      </div>
      <details className="investment-mobile-disclosure investment-detail-bottom-disclosure" open>
        <summary>Accounts and assumptions</summary>
        <div className="investment-detail-bottom-grid">
        {project.mode === "portfolio" ? <section className="investment-detail-panel investment-detail-accounts-panel" aria-labelledby="investment-detail-accounts-title">
          <h3 id="investment-detail-accounts-title"><ProjectionDetailIcon name="folder" /><span>Included accounts and saved schedules</span></h3>
          <div className="investment-detail-account-list">{accountRows.map(({ account, schedule }) => <div key={account.id}><span className="investment-detail-account-copy"><strong>{accountLabel(account)}</strong><small>{scheduleSummary(schedule, account)}</small>{schedule?.contributionSource === "cash_flow" && cashFlowSources(account).length > 0 ? <small className="investment-detail-source-names">Sources: {cashFlowSources(account).map((source) => source.name).join(" · ")}</small> : null}</span><strong>{money(account.latest?.balanceMinor)}</strong></div>)}</div>
          <div className="investment-detail-panel-footer"><span className="investment-detail-account-count"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.5-3 2.3-4.5 5.5-4.5s5 1.5 5.5 4.5M16 11a3 3 0 1 0 0-6M16 14.5c2.7.1 4.3 1.6 4.7 4.5" /></svg>{project.accounts.length} account{project.accounts.length === 1 ? "" : "s"} · {scheduleCount} schedule{scheduleCount === 1 ? "" : "s"}</span><span className="investment-detail-panel-total"><small>Starting balance total</small><strong>{money(project.startingBalanceMinor)}</strong></span></div>
        </section> : <section className="investment-detail-panel investment-detail-accounts-panel"><h3><ProjectionDetailIcon name="folder" /><span>Projection scope</span></h3><p className="investment-detail-panel-copy">This calculator is disconnected from Cash Flow and does not use investment-account schedules.</p></section>}
        <section className="investment-detail-panel investment-detail-notes-panel" aria-labelledby="investment-detail-notes-title">
          <h3 id="investment-detail-notes-title"><ProjectionDetailIcon name="notes" /><span>Assumptions / projection notes</span></h3>
          <ul className="investment-detail-notes-list">
            <li><ProjectionNoteIcon name="rates" /><span>Rates of return are hypothetical and do not guarantee future results.</span></li>
            <li><ProjectionNoteIcon name="contributions" /><span>Contributions are assumed to occur at the end of each period.</span></li>
            <li><ProjectionNoteIcon name="scope" /><span>This projection does not include taxes, fees, or inflation.</span></li>
            <li><ProjectionNoteIcon name="date" /><span>Projection date: <strong>{longDateLabel(project.baselineDate)}</strong></span></li>
          </ul>
        </section>
        </div>
      </details>
      </>}
      {project.mode === "portfolio" ? <details className="investment-mobile-disclosure" open><summary>Annual contribution schedule</summary><div className="investment-detail-secondary-content"><div className="investment-projection-table-wrap investment-contribution-table-wrap"><table className="investment-projection-table investment-contribution-table"><caption>Yearly contribution schedule (contribution-only)</caption><thead><tr><th scope="col">Year</th><th scope="col">Biweekly</th><th scope="col">Monthly equivalent</th><th scope="col">Annual total</th><th scope="col">Payments</th></tr></thead><tbody>{project.annualContributionSummary.length > 0 ? project.annualContributionSummary.map((summary) => <tr key={summary.calendarYear}><th scope="row">{summary.calendarYear}</th><td data-label="Biweekly">{summary.biweeklyAmountMinor === null ? "—" : money(summary.biweeklyAmountMinor)}</td><td data-label="Monthly equivalent">{summary.monthlyAmountMinor === null ? "—" : money(summary.monthlyAmountMinor)}</td><td data-label="Annual total">{money(summary.annualContributionMinor)}</td><td data-label="Payments">{summary.eventCount}</td></tr>) : <tr><td className="investment-contribution-empty" colSpan={5}>No scheduled contributions in this projection window.</td></tr>}</tbody></table></div></div></details> : null}
      <details className="investment-mobile-disclosure" open><summary>Yearly projection values</summary><div className="investment-detail-secondary-content"><div className="investment-projection-table-wrap investment-yearly-projection-table-wrap"><table className="investment-projection-table investment-yearly-projection-table"><caption>Yearly projection values</caption><thead><tr><th scope="col">Year</th><th scope="col">Calendar year</th>{project.scenarios.map((scenario) => <th key={scenario.rateBps} scope="col">{percentFromBasisPoints(scenario.rateBps)}%</th>)}</tr></thead><tbody>{defaultScenario?.points.map((point, index) => <tr key={point.year}><th className="investment-projection-year" scope="row">{point.year}</th><td data-label="Calendar year">{point.calendarYear}</td>{project.scenarios.map((scenario) => <td data-label={`${percentFromBasisPoints(scenario.rateBps)}%`} key={scenario.rateBps}>{money(scenario.points[index]?.balanceMinor)}</td>)}</tr>)}</tbody></table></div></div></details>
      <div className="investment-dialog-footer"><button className="investment-danger-button" type="button" onClick={onDelete}>Delete project</button><button className="investment-secondary-button" type="button" onClick={onClose}>Done</button></div>
  </InvestmentDialog>;
}
