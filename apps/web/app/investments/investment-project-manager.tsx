"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import type { InvestmentProjectionPageData } from "@athena/database";
import { deleteInvestmentProjectionAction } from "./actions";
import { initialInvestmentProjectionActionState } from "./action-helpers";
import { ActionMessage, InvestmentMetric } from "./investment-readouts";
import { money, safeMinorSum } from "./investment-calculation";
import { MobileInvestmentWorkspace } from "./investment-mobile-workspace";
import { ProjectionForm, ProjectionModal } from "./investment-project-form";
import { PlanningGuideIcon } from "./investment-icons";
import { ProjectDetail } from "./investment-project-detail";
import { ProjectRow } from "./investment-project-row";
import { InvestmentDialog } from "./investment-dialog";

export { projectionChartMetricLabel } from "./investment-project-chart";
export { scheduleSummary } from "./investment-project-detail";
function DeleteProjectForm({ projectId, onDeleted, onCancel, onPendingChange }: { readonly projectId: string; readonly onDeleted: () => void; readonly onCancel: () => void; readonly onPendingChange?: (pending: boolean) => void }) {
  const [state, formAction, pending] = useActionState(deleteInvestmentProjectionAction, initialInvestmentProjectionActionState);
  useEffect(() => { if (state.ok) onDeleted(); }, [onDeleted, state.ok]);
  useEffect(() => { onPendingChange?.(pending); }, [onPendingChange, pending]);
  return <form action={formAction} className="investment-delete-confirm" aria-busy={pending}><input type="hidden" name="id" value={projectId} /><input type="hidden" name="confirm" value="true" /><p>This permanently removes the saved projection configuration. Investment accounts, snapshots, and recurring Cash Flow transfers are not changed.</p><div className="investment-form-actions"><button className="investment-danger-button" type="submit" disabled={pending}>{pending ? "Deleting…" : "Delete project"}</button><button className="investment-secondary-button" type="button" onClick={onCancel} disabled={pending}>Cancel</button><ActionMessage state={state} /></div></form>;
}

function PlanningGuide({ onCreate }: { readonly onCreate: () => void }) {
  return <section className="investment-guidance-panel" aria-labelledby="investment-guidance-title">
    <div className="investment-guidance-intro"><p className="eyebrow">Plan with confidence</p><h2 id="investment-guidance-title">See the big<br />picture ahead.</h2><p>Compare long-term outcomes, test assumptions, and keep your investment planning separate from day-to-day Cash Flow.</p><button className="navy-action-button investment-page-action-button" type="button" onClick={onCreate}>Create a projection <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h13M13 7l5 5-5 5" /></svg></button></div>
    <div className="investment-guidance-items">
      <article className="investment-guidance-item"><PlanningGuideIcon name="scenarios" /><h3>Multiple scenarios</h3><p>Compare up to four annual return rates for the same calculator or portfolio plan.</p><small>Rates are saved per project and compounded monthly.</small></article>
      <article className="investment-guidance-item"><PlanningGuideIcon name="assumptions" /><h3>Editable assumptions</h3><p>Adjust balances, contributions, cadence, horizon, annual increases, and overrides.</p><small>Portfolio schedules can read active Cash Flow sources automatically.</small></article>
      <article className="investment-guidance-item"><PlanningGuideIcon name="insights" /><h3>Clear insights</h3><p>See contributions, growth, and the default endpoint without hiding the assumptions behind it.</p><small>Warnings call out missing accounts or live inputs that need review.</small></article>
    </div>
    <div className="investment-guidance-footnote"><strong>Planning boundary</strong><span>Saving or editing a project changes projection assumptions only. It does not create transactions, alter balances, or change Cash Flow.</span></div>
  </section>;
}

export function InvestmentProjectManager({ asOf, availableAccounts, cashFlowAccounts, projects }: InvestmentProjectionPageData) {
  const [modal, setModal] = useState<{ readonly kind: "create" } | { readonly kind: "detail"; readonly projectId: string } | { readonly kind: "edit"; readonly projectId: string } | null>(null);
  const [deleteProjectId, setDeleteProjectId] = useState<string | null>(null);
  const [projectionPending, setProjectionPending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [showCalculationNotes, setShowCalculationNotes] = useState(false);
  const modalRestoreFocusRef = useRef<HTMLElement | null>(null);
  const deleteRestoreFocusRef = useRef<HTMLElement | null>(null);
  const modalTransitionRef = useRef(false);
  const accountTotal = useMemo(() => safeMinorSum(availableAccounts.map((account) => account.latest?.balanceMinor)), [availableAccounts]);
  const scenarioCount = useMemo(() => projects.reduce((total, project) => total + project.rates.length, 0), [projects]);
  const modalProject = modal && modal.kind !== "create" ? projects.find((project) => project.id === modal.projectId) ?? null : null;
  const activeModal = modal && modal.kind !== "create" && modalProject === null ? null : modal;
  if (modal && modal.kind !== "create" && modalProject === null) setModal(null);

  function rememberTrigger(target: { current: HTMLElement | null }): void {
    const active = typeof document === "undefined" ? null : document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) target.current = active;
  }

  function openModal(next: NonNullable<typeof modal>): void {
    if (!activeModal) rememberTrigger(modalRestoreFocusRef);
    modalTransitionRef.current = true;
    setProjectionPending(false);
    setModal(next);
  }

  function closeModal(): void { modalTransitionRef.current = false; setModal(null); }
  function openDelete(projectId: string): void { rememberTrigger(deleteRestoreFocusRef); setDeletePending(false); setDeleteProjectId(projectId); }

  useEffect(() => { modalTransitionRef.current = false; }, [modal, modalProject]);

  const selectedDetail = activeModal?.kind === "detail" ? modalProject : null;

  return <section className="investment-page-section">
    <MobileInvestmentWorkspace asOf={asOf} availableAccounts={availableAccounts} projects={projects} onCreate={() => openModal({ kind: "create" })} onOpen={(project) => openModal({ kind: "detail", projectId: project.id })} onEdit={(project) => openModal({ kind: "edit", projectId: project.id })} onDelete={(project) => openDelete(project.id)} />
    <div className="investment-summary-strip" aria-label="Investment overview">
      <InvestmentMetric label="Current invested balance" value={money(accountTotal)} detail={`Across ${availableAccounts.length} active account${availableAccounts.length === 1 ? "" : "s"}`} icon="balance" tone="navy" />
      <InvestmentMetric label="As of" value={asOf} detail="Portfolio Year 0 baseline" icon="calendar" tone="gold" />
      <InvestmentMetric label="Active projects" value={String(projects.length)} detail="Saved projection projects" icon="projects" tone="positive" />
      <InvestmentMetric label="Market scenarios" value={String(scenarioCount)} detail={projects.length === 1 ? "Rate scenarios in this project" : "Rate scenarios across projects"} icon="scenarios" tone="purple" />
    </div>

    <section className="investment-project-panel" aria-labelledby="investment-projects-title">
      <div className="investment-panel-heading"><div><h2 id="investment-projects-title">Saved projection projects</h2><p>Compare calculator and portfolio outcomes over 1–35 years with editable rate scenarios.</p></div><button className="navy-action-button investment-page-action-button" type="button" onClick={() => openModal({ kind: "create" })}><span className="navy-action-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg></span>New projection</button></div>
      {projects.length === 0 ? <div className="investment-empty-state"><strong>No projection projects yet.</strong><p>Start with a manual calculator or choose live investment accounts for an editable portfolio schedule.</p><button className="investment-secondary-button" type="button" onClick={() => openModal({ kind: "create" })}>Create first projection</button></div> : <div className="investment-project-table-wrap"><table className="investment-project-table"><thead><tr><th scope="col">Project</th><th scope="col">Mode</th><th scope="col">Horizon</th><th scope="col">Rates</th><th scope="col">Starting balance</th><th scope="col">Default endpoint</th><th scope="col">Status</th><th scope="col">Updated</th><th scope="col">Actions</th></tr></thead><tbody>{projects.map((project) => <ProjectRow key={project.id} project={project} onOpen={(selected) => openModal({ kind: "detail", projectId: selected.id })} onEdit={(selected) => openModal({ kind: "edit", projectId: selected.id })} onDelete={(selected) => openDelete(selected.id)} />)}</tbody></table></div>}
      <div className="investment-page-note"><button type="button" className="investment-text-button" onClick={() => setShowCalculationNotes((visible) => !visible)} aria-expanded={showCalculationNotes}>{showCalculationNotes ? "Hide data notes" : "How the numbers are calculated"}</button>{showCalculationNotes ? <p>Year 0 is the latest saved actual investment balance on or before today. Calculator projects use the manual amount. Portfolio projects resolve each selected account independently, apply its monthly or biweekly schedule after period interest, and show cumulative contributions and growth by year.</p> : null}</div>
    </section>

    <PlanningGuide onCreate={() => openModal({ kind: "create" })} />

    {activeModal?.kind === "create" ? <ProjectionModal title="New projection project" description="Create a projection using a manual calculator or build a reusable portfolio project from your live investment accounts and saved schedules." pending={projectionPending} restoreFocusRef={modalRestoreFocusRef} shouldRestoreFocus={() => !modalTransitionRef.current} onRestoredFocus={() => { modalRestoreFocusRef.current = null; }} onClose={closeModal}><ProjectionForm key="create" mode="create" accounts={availableAccounts} cashFlowAccounts={cashFlowAccounts} project={null} onSaved={closeModal} onCancel={closeModal} onPendingChange={setProjectionPending} /></ProjectionModal> : null}
    {activeModal?.kind === "edit" && modalProject ? <ProjectionModal title={`Edit ${modalProject.name}`} description="Update this projection's assumptions without changing Cash Flow or source account data." pending={projectionPending} restoreFocusRef={modalRestoreFocusRef} shouldRestoreFocus={() => !modalTransitionRef.current} onRestoredFocus={() => { modalRestoreFocusRef.current = null; }} onClose={closeModal}><ProjectionForm key={`edit-${modalProject.id}`} mode="edit" accounts={availableAccounts} cashFlowAccounts={cashFlowAccounts} project={modalProject} onSaved={closeModal} onCancel={() => openModal({ kind: "detail", projectId: modalProject.id })} onPendingChange={setProjectionPending} /></ProjectionModal> : null}
    {selectedDetail ? <ProjectDetail project={selectedDetail} onEdit={() => openModal({ kind: "edit", projectId: selectedDetail.id })} onClose={closeModal} onDelete={() => openDelete(selectedDetail.id)} restoreFocusRef={modalRestoreFocusRef} shouldRestoreFocus={() => !modalTransitionRef.current} onRestoredFocus={() => { modalRestoreFocusRef.current = null; }} /> : null}
    {deleteProjectId ? <InvestmentDialog backdropClassName="investment-modal-backdrop" dialogClassName="investment-dialog investment-delete-dialog" titleId="investment-delete-title" role="alertdialog" pending={deletePending} restoreFocusRef={deleteRestoreFocusRef} onRestoredFocus={() => { deleteRestoreFocusRef.current = null; }} onClose={() => setDeleteProjectId(null)}><div className="investment-dialog-header"><div><p className="eyebrow">Permanent deletion</p><h2 id="investment-delete-title">Delete projection?</h2></div><button className="investment-close-button" type="button" onClick={() => setDeleteProjectId(null)} disabled={deletePending} data-investment-dialog-initial-focus aria-label="Close delete confirmation">Close</button></div><DeleteProjectForm projectId={deleteProjectId} onDeleted={() => { setDeleteProjectId(null); closeModal(); }} onCancel={() => setDeleteProjectId(null)} onPendingChange={setDeletePending} /></InvestmentDialog> : null}
  </section>;
}
