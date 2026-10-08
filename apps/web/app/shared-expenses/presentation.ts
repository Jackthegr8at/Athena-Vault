import type { SharedProjectListView } from "@athena/database";
import { PROJECTS_PAGE_HELP_CONTENT, type PageHelpSnapshot, type ProjectsPageHelpActionId } from "../components/page-help-content";

type ProjectsHelpProject = Pick<SharedProjectListView, "id" | "archivedAt" | "participantCount" | "totalExpensesMinor" | "collectionStatus">;

export interface ProjectsHelpSnapshotInput {
  readonly projects: readonly ProjectsHelpProject[];
}

const PROJECTS_PAGE_HELP_ACTION_LABELS: Readonly<Record<ProjectsPageHelpActionId, string>> = PROJECTS_PAGE_HELP_CONTENT.actionLabels;

function projectHref(projectId: string | null): string {
  return projectId ? `/shared-expenses/${projectId}` : "/shared-expenses";
}

export function buildProjectsHelpSnapshot(input: ProjectsHelpSnapshotInput): PageHelpSnapshot {
  const activeProjects = input.projects.filter((project) => project.archivedAt === null);
  const archivedProjects = input.projects.length - activeProjects.length;
  const projectsWithExpenses = activeProjects.filter((project) => project.totalExpensesMinor > 0);
  const participants = activeProjects.reduce((total, project) => total + project.participantCount, 0);
  const projectsNeedingPayment = activeProjects.filter((project) => project.collectionStatus === "unpaid" || project.collectionStatus === "partial");
  const participantProject = activeProjects.find((project) => project.participantCount === 0) ?? null;
  const expenseProject = activeProjects.find((project) => project.participantCount > 0 && project.totalExpensesMinor === 0) ?? null;
  const paymentProject = activeProjects.find((project) => project.totalExpensesMinor > 0 && (project.collectionStatus === "unpaid" || project.collectionStatus === "partial")) ?? null;
  const firstProject = activeProjects[0] ?? null;

  let actionId: ProjectsPageHelpActionId;
  let actionProject = firstProject;
  if (!firstProject) actionId = "create";
  else if (participantProject) {
    actionId = "participants";
    actionProject = participantProject;
  } else if (expenseProject) {
    actionId = "expense";
    actionProject = expenseProject;
  } else if (paymentProject) {
    actionId = "payments";
    actionProject = paymentProject;
  } else actionId = "review";

  return {
    items: [
      { label: PROJECTS_PAGE_HELP_CONTENT.snapshotLabels.activeProjects, value: String(activeProjects.length) },
      { label: PROJECTS_PAGE_HELP_CONTENT.snapshotLabels.archivedProjects, value: String(archivedProjects) },
      { label: PROJECTS_PAGE_HELP_CONTENT.snapshotLabels.projectsWithExpenses, value: String(projectsWithExpenses.length) },
      { label: PROJECTS_PAGE_HELP_CONTENT.snapshotLabels.participants, value: String(participants) },
      { label: PROJECTS_PAGE_HELP_CONTENT.snapshotLabels.projectsNeedingPayment, value: String(projectsNeedingPayment.length) },
    ],
    action: {
      label: PROJECTS_PAGE_HELP_ACTION_LABELS[actionId],
      href: projectHref(actionProject?.id ?? null),
    },
  };
}
