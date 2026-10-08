"use client";

import type { InvestmentProjectionAvailableAccountView, InvestmentProjectionProjectView } from "@athena/database";
import { money, safeMinorSum } from "./investment-calculation";

export function MobileInvestmentWorkspace({
  asOf,
  availableAccounts,
  projects,
  onCreate,
  onOpen,
  onEdit,
  onDelete,
}: {
  readonly asOf: string;
  readonly availableAccounts: readonly InvestmentProjectionAvailableAccountView[];
  readonly projects: readonly InvestmentProjectionProjectView[];
  readonly onCreate: () => void;
  readonly onOpen: (project: InvestmentProjectionProjectView) => void;
  readonly onEdit: (project: InvestmentProjectionProjectView) => void;
  readonly onDelete: (project: InvestmentProjectionProjectView) => void;
}) {
  const accountTotal = safeMinorSum(availableAccounts.map((account) => account.latest?.balanceMinor));
  const scenarioCount = projects.reduce((total, project) => total + project.rates.length, 0);

  return <section className="investment-mobile-workspace" aria-labelledby="investment-mobile-title">
    <div className="investment-mobile-hero">
      <div>
        <p className="eyebrow">Investment workspace</p>
        <h2 id="investment-mobile-title">Build your future balance.</h2>
        <p>Compare return scenarios and contributions without changing your live Cash Flow.</p>
      </div>
      <button className="navy-action-button investment-mobile-primary-action" type="button" onClick={onCreate}><span aria-hidden="true">+</span> New projection</button>
      <small className="investment-mobile-updated">Live balances · {asOf}</small>
    </div>

    <div className="investment-mobile-summary" aria-label="Investment summary">
      <div className="investment-mobile-summary-card"><span>Invested now</span><strong>{money(accountTotal)}</strong></div>
      <div className="investment-mobile-summary-card"><span>Active projects</span><strong>{projects.length}</strong></div>
      <div className="investment-mobile-summary-card"><span>Accounts</span><strong>{availableAccounts.length}</strong></div>
      <div className="investment-mobile-summary-card"><span>Scenarios</span><strong>{scenarioCount}</strong></div>
    </div>

    <section className="investment-mobile-project-panel" aria-labelledby="investment-mobile-projects-title">
      <div className="investment-mobile-section-heading"><div><p className="eyebrow">Saved plans</p><h2 id="investment-mobile-projects-title">Projection projects</h2></div><span>{projects.length} saved</span></div>
      {projects.length === 0 ? <div className="investment-mobile-empty"><strong>No projection projects yet.</strong><p>Create a manual calculator or a portfolio plan from your live balances.</p><button className="navy-action-button" type="button" onClick={onCreate}>Create first projection</button></div> : <div className="investment-mobile-project-list">
        {projects.map((project) => {
          const endpoint = project.scenarios[0]?.points.at(-1);
          return <article className="investment-mobile-project-card" key={project.id}>
            <button className="investment-mobile-project-main" type="button" onClick={() => onOpen(project)}>
              <span className="investment-mobile-project-copy"><strong>{project.name}</strong><small>{project.mode === "calculator" ? "Calculator" : "Portfolio"} · {project.horizonYears} years</small></span>
              <span className="investment-mobile-project-endpoint"><strong>{money(endpoint?.balanceMinor)}</strong><small>{project.rates.length} scenarios</small></span>
              <span className="investment-mobile-project-arrow" aria-hidden="true">→</span>
            </button>
            <div className="investment-mobile-project-footer"><span className={`investment-mobile-status ${project.warnings.length > 0 ? "is-warning" : ""}`}>{project.warnings.length > 0 ? "Review inputs" : "Ready"}</span><div><button className="investment-secondary-button" type="button" onClick={(event) => { event.stopPropagation(); onEdit(project); }}>Edit</button><button className="investment-danger-button" type="button" onClick={(event) => { event.stopPropagation(); onDelete(project); }}>Delete</button></div></div>
          </article>;
        })}
      </div>}
    </section>

    <details className="investment-mobile-help"><summary>How projections work</summary><p>Calculator projects use a manual starting amount. Portfolio projects use selected live investment balances and saved contribution schedules. Editing planning assumptions never changes Cash Flow.</p></details>
  </section>;
}
