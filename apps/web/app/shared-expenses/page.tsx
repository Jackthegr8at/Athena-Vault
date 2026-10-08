import "./shared-expenses.css";
import React from "react";
import { toTorontoDateIso, createSharedProjectsRepository } from "@athena/database";
import { ModulePage } from "../components/module-page";
import { PROJECTS_PAGE_HELP_CONTENT } from "../components/page-help-content";
import { withAuthenticatedPageDatabase } from "../../lib/server/owner-database";
import { hasPageHelpSeen } from "../../lib/server/page-help";
import { ProjectsListManager } from "./projects-list-manager";
import { availableProjectYears, parseProjectStatus, parseProjectYear, projectListPresentation } from "./list-route";
import { buildProjectsHelpSnapshot } from "./presentation";

export const dynamic = "force-dynamic";

export interface ProjectsSearchParams {
  readonly year?: string | string[];
  readonly status?: string | string[];
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ProjectsPage({ searchParams }: { readonly searchParams?: Promise<ProjectsSearchParams> }) {
  const params = searchParams ? await searchParams : {};
  const { allProjects, pageHelpSeen } = await withAuthenticatedPageDatabase(async (database, user) => {
    const [allProjects, pageHelpSeen] = await Promise.all([
      createSharedProjectsRepository(database).listProjects(user.owner.id),
      hasPageHelpSeen(database, user, PROJECTS_PAGE_HELP_CONTENT.pageId),
    ]);
    return { allProjects, pageHelpSeen };
  }, { requireTwoFactor: true });
  const currentYear = Number(toTorontoDateIso().slice(0, 4));
  const years = availableProjectYears(allProjects, currentYear);
  const selectedYear = parseProjectYear(firstValue(params.year));
  const status = parseProjectStatus(firstValue(params.status));
  const filteredProjects = allProjects.filter((project) => {
    const matchesYear = selectedYear === null || project.projectYear === selectedYear;
    const matchesStatus = status === "all" || (status === "archived" ? project.archivedAt !== null : project.archivedAt === null);
    return matchesYear && matchesStatus;
  });
  const projectsHelp = {
    content: PROJECTS_PAGE_HELP_CONTENT,
    snapshot: buildProjectsHelpSnapshot({ projects: allProjects }),
  };

  return <ModulePage active="Shared Expenses" pageArtwork="shared-expenses" eyebrow="Shared ledger" title="Shared Expenses" subtitle="Compact equal-split workspaces for owner-funded shared expenses and participant payments." help={projectsHelp} pageHelpSeen={pageHelpSeen}>
    <ProjectsListManager projects={filteredProjects.map(projectListPresentation)} totalProjectCount={allProjects.length} years={years} selectedYear={selectedYear} status={status} currentYear={currentYear} />
  </ModulePage>;
}
