import React from "react";
import { notFound } from "next/navigation";
import { ModulePage } from "../../components/module-page";
import { PROJECT_WORKSPACE_PAGE_HELP_CONTENT } from "../../components/page-help-content";
import { ProjectWorkspaceManager } from "../project-workspace-manager";
import { buildProjectWorkspaceHelpSnapshot } from "../project-workspace-presentation";
import { loadProjectWorkspace } from "./workspace-route";

export const dynamic = "force-dynamic";

export default async function ProjectWorkspacePage({ params }: { readonly params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await loadProjectWorkspace(id, PROJECT_WORKSPACE_PAGE_HELP_CONTENT.pageId);
  if (!workspace) notFound();
  const { project, pageHelpSeen } = workspace;
  const projectWorkspaceHelp = {
    content: PROJECT_WORKSPACE_PAGE_HELP_CONTENT,
    snapshot: buildProjectWorkspaceHelpSnapshot({ project }),
  };

  return <ModulePage active="Shared Expenses" pageArtwork="shared-expenses" eyebrow="Shared expense workspace" title={project.name} subtitle={`${project.projectYear} · Equal split with recorded participant payments`} help={projectWorkspaceHelp} pageHelpSeen={pageHelpSeen}>
    <ProjectWorkspaceManager project={project} />
  </ModulePage>;
}
