import { describe, expect, it } from "vitest";
import { buildProjectsHelpSnapshot } from "./presentation";

const project = {
  id: "project-1",
  archivedAt: null,
  participantCount: 2,
  totalExpensesMinor: 12_500,
  collectionStatus: "paid" as const,
};

describe("Projects page help presentation", () => {
  it("guides an empty workspace to create its first project", () => {
    expect(buildProjectsHelpSnapshot({ projects: [] })).toEqual({
      items: [
        { label: "Active projects", value: "0" },
        { label: "Archived projects", value: "0" },
        { label: "Projects with expenses", value: "0" },
        { label: "Participants", value: "0" },
        { label: "Projects needing payment", value: "0" },
      ],
      action: { label: "Create first project", href: "/shared-expenses" },
    });
  });

  it("chooses the next incomplete project step and keeps archived data out of active counts", () => {
    expect(buildProjectsHelpSnapshot({
      projects: [
        { ...project, id: "complete", participantCount: 2 },
        { ...project, id: "needs-people", participantCount: 0 },
        { ...project, id: "archived", archivedAt: new Date("2026-01-01"), participantCount: 9 },
      ],
    })).toMatchObject({
      items: [
        { label: "Active projects", value: "2" },
        { label: "Archived projects", value: "1" },
        { label: "Projects with expenses", value: "2" },
        { label: "Participants", value: "2" },
        { label: "Projects needing payment", value: "0" },
      ],
      action: { label: "Add project participants", href: "/shared-expenses/needs-people" },
    });
  });

  it("moves from participants to expenses and then payments", () => {
    expect(buildProjectsHelpSnapshot({ projects: [{ ...project, participantCount: 1, totalExpensesMinor: 0, collectionStatus: "no_expenses" }] }).action).toEqual({ label: "Record first expense", href: "/shared-expenses/project-1" });
    expect(buildProjectsHelpSnapshot({ projects: [{ ...project, collectionStatus: "partial" }] }).action).toEqual({ label: "Review project payments", href: "/shared-expenses/project-1" });
  });
});
