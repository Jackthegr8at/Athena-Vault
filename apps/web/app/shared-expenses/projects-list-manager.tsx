"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { createProjectAction } from "./actions";
import { AnimatedLineBackground } from "../components/animated-line-background";
import { InvestmentDropdown } from "../investments/investment-dropdown";
import { initialProjectActionState, type ProjectActionField, type ProjectActionState } from "./action-helpers";
import type { ProjectListStatusFilter } from "./list-route";
import { formatMoneyMinor } from "../../lib/format-money";

export interface ProjectListPresentation {
  readonly id: string;
  readonly name: string;
  readonly projectYear: number;
  readonly ownerParticipates: boolean;
  readonly note: string | null;
  readonly archived: boolean;
  readonly totalExpensesMinor: number;
  readonly receivedFromOthersMinor: number;
  readonly outstandingMinor: number | null;
  readonly participantCount: number;
  readonly collectionStatus: "not_ready" | "no_expenses" | "unpaid" | "partial" | "paid" | "overpaid";
}

interface ProjectsListManagerProps {
  readonly projects: readonly ProjectListPresentation[];
  readonly totalProjectCount: number;
  readonly years: readonly number[];
  readonly selectedYear: number | null;
  readonly status: ProjectListStatusFilter;
  readonly currentYear: number;
}

function money(value: number | null): string {
  return formatMoneyMinor(value, { unavailableLabel: "—", negativeSign: "−" });
}

function fieldError(state: ProjectActionState, field: ProjectActionField): string | null {
  return state.fieldErrors[field] ?? null;
}

function ActionMessage({ state }: { readonly state: ProjectActionState }) {
  return state.message ? <p className={`project-action-message ${state.ok ? "is-success" : "is-error"}`} role="status">{state.message}</p> : null;
}

function FieldError({ state, field }: { readonly state: ProjectActionState; readonly field: ProjectActionField }) {
  const message = fieldError(state, field);
  return message ? <span className="project-field-error">{message}</span> : null;
}

function statusLabel(status: ProjectListPresentation["collectionStatus"]): string {
  return ({ not_ready: "Needs setup", no_expenses: "No expenses", unpaid: "Unpaid", partial: "Partial", paid: "Paid", overpaid: "Overpaid" } as const)[status];
}

function queryHref(year: number | null, status: ProjectListStatusFilter): string {
  const params = new URLSearchParams();
  if (year !== null) params.set("year", String(year));
  if (status !== "active") params.set("status", status);
  const query = params.toString();
  return query ? `/shared-expenses?${query}` : "/shared-expenses";
}

function NewProjectForm({ currentYear, onSuccess }: { readonly currentYear: number; readonly onSuccess: () => void }) {
  const [state, action, pending] = useActionState(createProjectAction, initialProjectActionState);
  useEffect(() => {
    if (state.ok) onSuccess();
  }, [onSuccess, state]);
  return <form action={action} className="project-dialog-form">
    <div className="project-form-grid">
      <label>Shared expense name<input name="name" required maxLength={120} placeholder="Camping internet" /><FieldError state={state} field="name" /></label>
      <label>Year<input name="year" type="number" min={1900} max={2200} defaultValue={currentYear} required /><FieldError state={state} field="year" /></label>
      <label className="project-checkbox-label"><input name="ownerParticipates" type="checkbox" value="true" /> I participate in the split<FieldError state={state} field="ownerParticipates" /></label>
      <label className="project-field-wide">Note <span>(optional)</span><textarea name="projectNote" maxLength={500} rows={2} /><FieldError state={state} field="projectNote" /></label>
    </div>
    <div className="project-form-actions"><button className="project-primary-button" type="submit" disabled={pending}>{pending ? "Creating…" : "Create shared expense"}</button><ActionMessage state={state} /></div>
  </form>;
}

export function ProjectsListManager({ projects, totalProjectCount, years, selectedYear, status, currentYear }: ProjectsListManagerProps) {
  const router = useRouter();
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const isFilteredEmpty = projects.length === 0 && totalProjectCount > 0;
  const statusLinks: readonly { value: ProjectListStatusFilter; label: string }[] = [
    { value: "active", label: "Active" },
    { value: "archived", label: "Archived" },
    { value: "all", label: "All" },
  ];

  return <section className="card section-card projects-list-section">
    <div className="projects-list-header">
      <AnimatedLineBackground lineCount={8} opacity={0.3} speed={17} scale={1.05} strokeWidth={1.15} density={1} drift={0.22} waveAmplitude={36} pulseStrength={0.84} direction="right-to-left" color="#9F9270" accentColor="#E0C681" seed="projects-header" className="animated-line-background--projects-header" />
      <div>
        <p className="eyebrow">Shared ledger</p>
        <h3 className="card-title">Shared expense history</h3>
        <p className="card-subtitle">Equal-split workspaces for shared expenses and participant payments.</p>
      </div>
      <div className="projects-list-count"><span>Visible shared expenses</span><strong>{projects.length}</strong></div>
    </div>
    <div className="projects-toolbar">
      <div className="projects-toolbar-controls">
        <div className="projects-mobile-filter-heading project-mobile-only">Filter shared expenses</div>
        <label className="projects-year-filter">Year<InvestmentDropdown value={selectedYear === null ? "all" : String(selectedYear)} options={[{ value: "all", label: "All years" }, ...years.map((year) => ({ value: String(year), label: String(year) }))]} onChange={(value) => router.push(queryHref(value === "all" ? null : Number(value), status))} aria-label="Filter by year" floating floatingMinWidth={160} numeric /></label>
        <div className="projects-status-filter-group">
          <span className="projects-status-filter-label project-mobile-only">Status</span>
          <div className="projects-status-filter" aria-label="Shared expense status filter">{statusLinks.map((link) => <Link key={link.value} href={queryHref(selectedYear, link.value)} className={status === link.value ? "is-active" : undefined}>{link.label}</Link>)}</div>
        </div>
        <button className="project-primary-button" type="button" onClick={() => setNewProjectOpen((open) => !open)} aria-expanded={newProjectOpen}>{newProjectOpen ? "Close" : "New shared expense"}</button>
      </div>
    </div>

    {newProjectOpen ? <div className="project-new-panel"><div className="project-panel-heading"><div><span className="eyebrow">New ledger</span><h3>Create a shared expense</h3></div><button className="project-secondary-button" type="button" onClick={() => setNewProjectOpen(false)}>Cancel</button></div><NewProjectForm currentYear={currentYear} onSuccess={() => setNewProjectOpen(false)} /></div> : null}

    {projects.length === 0 ? <div className="project-empty-state"><strong>{isFilteredEmpty ? "No shared expenses match these filters." : status === "archived" ? "No archived shared expenses yet." : status === "all" ? "No shared expenses yet." : "No active shared expenses yet."}</strong><p>{isFilteredEmpty ? "Clear the filters to see the shared expenses already in this workspace." : status === "archived" ? "Archive a completed shared expense to keep its expense and payment history here." : "Create a shared expense to track an equal split without connecting it to Accounts, Cash Flow, or Annual Expenses."}</p>{isFilteredEmpty ? <Link className="project-secondary-button" href="/shared-expenses">Clear filters</Link> : status !== "archived" ? <button className="project-primary-button" type="button" onClick={() => setNewProjectOpen(true)}>Create first shared expense</button> : null}</div> : <div className="projects-table-wrap"><table className="projects-table"><thead><tr><th scope="col">Shared expense</th><th scope="col">Expenses</th><th scope="col">Received</th><th scope="col">Outstanding</th><th scope="col">People</th><th scope="col">Status</th></tr></thead><tbody>{projects.map((project) => <tr key={project.id} className={project.archived ? "is-archived" : undefined}><th scope="row" data-label="Shared expense"><Link href={`/shared-expenses/${project.id}`}>{project.name}</Link><small>{project.projectYear}{project.note ? ` · ${project.note}` : ""}</small></th><td data-label="Expenses">{money(project.totalExpensesMinor)}</td><td data-label="Received">{money(project.receivedFromOthersMinor)}</td><td data-label="Outstanding">{money(project.outstandingMinor)}</td><td data-label="People">{project.participantCount}</td><td data-label="Status"><span className={`project-status project-status--${project.collectionStatus}`}>{project.archived ? "Archived" : statusLabel(project.collectionStatus)}</span><Link className="project-mobile-open project-mobile-only" href={`/shared-expenses/${project.id}`}>Open shared expense <span aria-hidden="true">-&gt;</span></Link></td></tr>)}</tbody></table></div>}
  </section>;
}
