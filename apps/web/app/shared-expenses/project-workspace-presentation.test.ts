import { describe, expect, it } from "vitest";
import { buildProjectWorkspaceHelpSnapshot } from "./project-workspace-presentation";

const baseProject = {
  id: "project-1",
  projectYear: 2026,
  ownerParticipates: true,
  archived: false,
  summary: { collectionStatus: "not_ready" as const },
  expenses: [],
  participants: [],
};

describe("Project workspace help presentation", () => {
  it("guides an active project through participants, expenses, and payments", () => {
    expect(buildProjectWorkspaceHelpSnapshot({ project: baseProject }).action).toEqual({ label: "Add participants", href: "#project-participants-panel" });
    expect(buildProjectWorkspaceHelpSnapshot({ project: { ...baseProject, participants: [{ status: "unpaid" as const }] } }).action).toEqual({ label: "Record first expense", href: "#project-expenses-panel" });
    expect(buildProjectWorkspaceHelpSnapshot({ project: { ...baseProject, expenses: [{}], participants: [{ status: "partial" as const }], summary: { collectionStatus: "partial" as const } } }).action).toEqual({ label: "Review participant payments", href: "#project-participants-panel" });
  });

  it("points completed and archived workspaces to their summary", () => {
    expect(buildProjectWorkspaceHelpSnapshot({ project: { ...baseProject, expenses: [{}], participants: [{ status: "paid" as const }], summary: { collectionStatus: "paid" as const } } }).action).toEqual({ label: "Review project summary", href: "#project-workspace" });
    expect(buildProjectWorkspaceHelpSnapshot({ project: { ...baseProject, archived: true } }).action).toEqual({ label: "Review project summary", href: "#project-workspace" });
  });

  it("reports workspace state without exposing amounts", () => {
    expect(buildProjectWorkspaceHelpSnapshot({ project: { ...baseProject, expenses: [{ amountMinor: 999999 }], participants: [{ status: "paid" as const }, { status: "extra" as const }, { status: "unpaid" as const }], summary: { collectionStatus: "overpaid" as const } } })).toEqual({
      items: [
        { label: "Project year", value: "2026" },
        { label: "Project status", value: "Active" },
        { label: "Owner participation", value: "Included" },
        { label: "Participants", value: "3" },
        { label: "Expenses", value: "1" },
        { label: "Participants needing payment", value: "1" },
        { label: "Paid or settled participants", value: "2" },
        { label: "Collection status", value: "Overpaid" },
      ],
      action: { label: "Review participant payments", href: "#project-participants-panel" },
    });
  });
});
