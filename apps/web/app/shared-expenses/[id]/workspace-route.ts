import { createSharedProjectsRepository, type SharedProjectView } from "@athena/database";
import { sharedProjectIdSchema } from "@athena/validation";
import { hasPageHelpSeen } from "../../../lib/server/page-help";
import { withAuthenticatedPageDatabase } from "../../../lib/server/owner-database";
import type { ProjectWorkspacePresentation } from "../project-workspace-manager";

function workspacePresentation(project: SharedProjectView): ProjectWorkspacePresentation {
  return {
    id: project.id,
    name: project.name,
    projectYear: project.projectYear,
    ownerParticipates: project.ownerParticipates,
    note: project.note,
    archived: project.archivedAt !== null,
    summary: project.summary,
    expenses: project.expenses.map((expense) => ({
      id: expense.id,
      projectId: expense.projectId,
      description: expense.description,
      expenseOn: expense.expenseOn,
      quantity: expense.quantity,
      amountMinor: expense.amountMinor,
      totalMinor: expense.totalMinor,
      note: expense.note,
    })),
    participants: project.participants.map((participant) => ({
      id: participant.id,
      projectId: participant.projectId,
      name: participant.name,
      paidMinor: participant.paidMinor,
      owedMinor: participant.owedMinor,
      remainingMinor: participant.remainingMinor,
      extraMinor: participant.extraMinor,
      status: participant.status,
    })),
  };
}

export async function loadProjectWorkspace(projectId: string, pageId: string): Promise<{ readonly project: ProjectWorkspacePresentation; readonly pageHelpSeen: boolean } | null> {
  if (!sharedProjectIdSchema.safeParse(projectId).success) return null;
  const { project, pageHelpSeen } = await withAuthenticatedPageDatabase(async (database, user) => {
    const [project, pageHelpSeen] = await Promise.all([
      createSharedProjectsRepository(database).getProject(user.owner.id, projectId),
      hasPageHelpSeen(database, user, pageId),
    ]);
    return { project, pageHelpSeen };
  }, { requireTwoFactor: true });
  return project ? { project: workspacePresentation(project), pageHelpSeen } : null;
}
