import type { ProjectWorkspacePresentation } from "./project-workspace-manager";
import { PROJECT_WORKSPACE_PAGE_HELP_CONTENT, type PageHelpSnapshot, type ProjectWorkspacePageHelpActionId } from "../components/page-help-content";

type ProjectWorkspaceHelpProject = Pick<ProjectWorkspacePresentation, "id" | "projectYear" | "ownerParticipates" | "archived"> & {
  readonly summary: Pick<ProjectWorkspacePresentation["summary"], "collectionStatus">;
  readonly expenses: readonly unknown[];
  readonly participants: readonly Pick<ProjectWorkspacePresentation["participants"][number], "status">[];
};

export interface ProjectWorkspaceHelpSnapshotInput {
  readonly project: ProjectWorkspaceHelpProject;
}

const PROJECT_WORKSPACE_PAGE_HELP_ACTION_HREFS: Readonly<Record<ProjectWorkspacePageHelpActionId, string>> = {
  participants: "#project-participants-panel",
  expense: "#project-expenses-panel",
  payments: "#project-participants-panel",
  review: "#project-workspace",
};

function collectionStatusLabel(status: ProjectWorkspaceHelpProject["summary"]["collectionStatus"]): string {
  return ({
    not_ready: "Not ready",
    no_expenses: "No expenses",
    unpaid: "Unpaid",
    partial: "Partial",
    paid: "Paid",
    overpaid: "Overpaid",
  } as const)[status];
}

export function buildProjectWorkspaceHelpSnapshot(input: ProjectWorkspaceHelpSnapshotInput): PageHelpSnapshot {
  const participantsNeedingPayment = input.project.participants.filter((participant) => participant.status === "unpaid" || participant.status === "partial").length;
  const paidParticipants = input.project.participants.filter((participant) => participant.status === "paid" || participant.status === "extra").length;

  let actionId: ProjectWorkspacePageHelpActionId;
  if (input.project.archived) actionId = "review";
  else if (input.project.participants.length === 0) actionId = "participants";
  else if (input.project.expenses.length === 0) actionId = "expense";
  else if (participantsNeedingPayment > 0) actionId = "payments";
  else actionId = "review";

  return {
    items: [
      { label: PROJECT_WORKSPACE_PAGE_HELP_CONTENT.snapshotLabels.projectYear, value: String(input.project.projectYear) },
      { label: PROJECT_WORKSPACE_PAGE_HELP_CONTENT.snapshotLabels.projectStatus, value: input.project.archived ? "Archived" : "Active" },
      { label: PROJECT_WORKSPACE_PAGE_HELP_CONTENT.snapshotLabels.ownerParticipation, value: input.project.ownerParticipates ? "Included" : "Not included" },
      { label: PROJECT_WORKSPACE_PAGE_HELP_CONTENT.snapshotLabels.participants, value: String(input.project.participants.length) },
      { label: PROJECT_WORKSPACE_PAGE_HELP_CONTENT.snapshotLabels.expenses, value: String(input.project.expenses.length) },
      { label: PROJECT_WORKSPACE_PAGE_HELP_CONTENT.snapshotLabels.participantsNeedingPayment, value: String(participantsNeedingPayment) },
      { label: PROJECT_WORKSPACE_PAGE_HELP_CONTENT.snapshotLabels.paidParticipants, value: String(paidParticipants) },
      { label: PROJECT_WORKSPACE_PAGE_HELP_CONTENT.snapshotLabels.collectionStatus, value: collectionStatusLabel(input.project.summary.collectionStatus) },
    ],
    action: {
      label: PROJECT_WORKSPACE_PAGE_HELP_CONTENT.actionLabels[actionId],
      href: PROJECT_WORKSPACE_PAGE_HELP_ACTION_HREFS[actionId],
    },
  };
}
