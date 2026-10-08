import type { SharedProjectListView } from "@athena/database";
import type { ProjectListPresentation } from "./projects-list-manager";

export type ProjectListStatusFilter = "active" | "archived" | "all";

export function parseProjectYear(value: string | undefined): number | null {
  if (!value || value === "all") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1900 && parsed <= 2200 ? parsed : null;
}

export function parseProjectStatus(value: string | undefined): ProjectListStatusFilter {
  return value === "archived" || value === "all" ? value : "active";
}

export function projectListPresentation(project: SharedProjectListView): ProjectListPresentation {
  return {
    id: project.id,
    name: project.name,
    projectYear: project.projectYear,
    ownerParticipates: project.ownerParticipates,
    note: project.note,
    archived: project.archivedAt !== null,
    totalExpensesMinor: project.totalExpensesMinor,
    receivedFromOthersMinor: project.receivedFromOthersMinor,
    outstandingMinor: project.outstandingMinor,
    participantCount: project.participantCount,
    collectionStatus: project.collectionStatus,
  };
}

export function availableProjectYears(projects: readonly SharedProjectListView[], currentYear: number): readonly number[] {
  return [...new Set([currentYear - 1, currentYear, currentYear + 1, ...projects.map((project) => project.projectYear)])].sort((left, right) => right - left);
}
