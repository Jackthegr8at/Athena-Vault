import React from "react";
import { describe, expect, it, vi } from "vitest";
import { PROJECT_WORKSPACE_PAGE_HELP_CONTENT } from "../../components/page-help-content";

const mocks = vi.hoisted(() => {
  const project = { id: "project-1", name: "Cabin weekend", projectYear: 2026 };
  return {
    buildProjectWorkspaceHelpSnapshot: vi.fn(() => ({ items: [], action: { label: "Review project summary", href: "#project-workspace" } })),
    loadProjectWorkspace: vi.fn(async () => ({ project, pageHelpSeen: false })),
    project,
  };
});

vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
vi.mock("../../components/module-page", () => ({
  ModulePage: (props: { readonly children: React.ReactNode }) => React.createElement("module-page", props, props.children),
}));
vi.mock("../project-workspace-manager", () => ({
  ProjectWorkspaceManager: (props: { readonly project: unknown }) => React.createElement("div", { "data-project": JSON.stringify(props.project) }),
}));
vi.mock("../project-workspace-presentation", () => ({ buildProjectWorkspaceHelpSnapshot: mocks.buildProjectWorkspaceHelpSnapshot }));
vi.mock("./workspace-route", () => ({ loadProjectWorkspace: mocks.loadProjectWorkspace }));

import ProjectWorkspacePage from "./page";

describe("Project workspace route", () => {
  it("passes the loaded project and contextual help snapshot to the public page composition", async () => {
    const element = await ProjectWorkspacePage({ params: Promise.resolve({ id: "project-1" }) });
    const props = (element as React.ReactElement<{ readonly title: string; readonly help: unknown; readonly children: React.ReactElement<{ readonly project: unknown }> }>).props;

    expect(mocks.loadProjectWorkspace).toHaveBeenCalledWith("project-1", "project-workspace");
    expect(mocks.buildProjectWorkspaceHelpSnapshot).toHaveBeenCalledWith({ project: mocks.project });
    expect(props.title).toBe("Cabin weekend");
    expect(props.help).toEqual({
      content: PROJECT_WORKSPACE_PAGE_HELP_CONTENT,
      snapshot: { items: [], action: { label: "Review project summary", href: "#project-workspace" } },
    });
    expect(props.children.props.project).toBe(mocks.project);
  });
});
