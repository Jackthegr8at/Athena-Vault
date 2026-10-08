import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SharedProjectListView, SharedProjectView } from "@athena/database";

const mocks = vi.hoisted(() => ({
  repository: { listProjects: vi.fn(), getProject: vi.fn() },
  pageHelpRepository: { hasSeen: vi.fn(async () => true) },
  createPageHelpRepository: vi.fn(),
  createSharedProjectsRepository: vi.fn(),
  toTorontoDateIso: vi.fn(() => "2026-08-11"),
  owner: vi.fn(async () => ({ id: "00000000-0000-0000-0000-000000000001" })),
  getServerDatabase: vi.fn(() => ({})),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
}));

vi.mock("@athena/database", () => ({
  createPageHelpRepository: mocks.createPageHelpRepository,
  createSharedProjectsRepository: mocks.createSharedProjectsRepository,
  toTorontoDateIso: mocks.toTorontoDateIso,
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("../components/module-page", () => ({ ModulePage: vi.fn(({ children }: { readonly children: unknown }) => children) }));
vi.mock("../../lib/server/database", () => ({ getServerDatabase: mocks.getServerDatabase }));
vi.mock("../../lib/server/owner-database", () => ({
  withAuthenticatedPageDatabase: async (callback: (database: unknown, user: { readonly owner: { readonly id: string }; readonly authUserId: string; readonly session: { readonly id: string } }) => unknown) => callback(mocks.getServerDatabase(), { owner: await mocks.owner(), authUserId: "auth-user", session: { id: "session" } }),
}));
vi.mock("./projects-list-manager", () => ({ ProjectsListManager: vi.fn(() => null) }));
vi.mock("./project-workspace-manager", () => ({ ProjectWorkspaceManager: vi.fn(() => null) }));

import ProjectsPage from "./page";
import { availableProjectYears, parseProjectStatus, parseProjectYear } from "./list-route";
import { loadProjectWorkspace } from "./[id]/workspace-route";

const ownerId = "00000000-0000-0000-0000-000000000001";
const projectId = "00000000-0000-0000-0000-000000000010";

function listProject(overrides: Partial<SharedProjectListView> = {}): SharedProjectListView {
  return {
    id: projectId,
    name: "Cabin",
    projectYear: 2026,
    ownerParticipates: true,
    note: null,
    archivedAt: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    totalExpensesMinor: 71_243,
    receivedFromOthersMinor: 6_477,
    outstandingMinor: 0,
    participantCount: 1,
    collectionStatus: "paid",
    ...overrides,
  };
}

describe("Projects routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createPageHelpRepository.mockReturnValue(mocks.pageHelpRepository);
    mocks.createSharedProjectsRepository.mockReturnValue(mocks.repository);
    mocks.repository.listProjects.mockResolvedValue([]);
    mocks.repository.getProject.mockResolvedValue(null);
  });

  it("parses bounded filters and keeps nearby years available", () => {
    expect(parseProjectYear("2026")).toBe(2026);
    expect(parseProjectYear("1899")).toBeNull();
    expect(parseProjectYear("all")).toBeNull();
    expect(parseProjectStatus("archived")).toBe("archived");
    expect(parseProjectStatus("unexpected")).toBe("active");
    expect(availableProjectYears([listProject({ projectYear: 2019 })], 2026)).toEqual([2027, 2026, 2025, 2019]);
  });

  it("loads and filters the list through the authenticated owner", async () => {
    mocks.repository.listProjects.mockResolvedValue([
      listProject(),
      listProject({ id: "00000000-0000-0000-0000-000000000011", name: "Archived cabin", archivedAt: new Date("2026-08-11") }),
      listProject({ id: "00000000-0000-0000-0000-000000000012", name: "Other year", projectYear: 2025 }),
    ]);
    const page = await ProjectsPage({ searchParams: Promise.resolve({ year: "2026", status: "archived" }) });
    expect(mocks.owner).toHaveBeenCalledOnce();
    expect(mocks.createSharedProjectsRepository).toHaveBeenCalledWith({});
    expect(mocks.repository.listProjects).toHaveBeenCalledWith(ownerId);
    const manager = (page as unknown as { readonly props: { readonly children: { readonly props: { readonly projects: readonly SharedProjectListView[]; readonly totalProjectCount: number; readonly status: string; readonly selectedYear: number | null } } } }).props.children.props;
    expect(manager.projects).toHaveLength(1);
    expect(manager.totalProjectCount).toBe(3);
    expect(manager.projects[0]).toMatchObject({ name: "Archived cabin", archived: true });
    expect(manager.status).toBe("archived");
    expect(manager.selectedYear).toBe(2026);
    const pageElement = page as unknown as { readonly props: { readonly help: { readonly content: { readonly pageId: string }; readonly snapshot: { readonly action: { readonly label: string; readonly href: string } } } } };
    expect(pageElement.props.help.content.pageId).toBe("projects");
    expect(pageElement.props.help.snapshot.action).toEqual({ label: "Open project workspace", href: `/shared-expenses/${projectId}` });
  });

  it("points an empty owner workspace to the first project action", async () => {
    const page = await ProjectsPage({ searchParams: Promise.resolve({}) });
    const pageElement = page as unknown as { readonly props: { readonly help: { readonly snapshot: { readonly action: { readonly label: string; readonly href: string } } } } };
    expect(pageElement.props.help.snapshot.action).toEqual({ label: "Create first project", href: "/shared-expenses" });
  });

  it("loads a workspace only through the current owner scope", async () => {
    const project = {
      ...listProject(),
      summary: {
        totalExpensesMinor: 71_243,
        participantCount: 1,
        splitCount: 2,
        sharePerPersonMinor: 35_622,
        ownerShareMinor: 35_622,
        expectedFromOthersMinor: 35_622,
        receivedFromOthersMinor: 6_477,
        outstandingMinor: 29_145,
        overpaymentReceivedMinor: 0,
        roundingDifferenceMinor: 1,
        netCashResultMinor: -64_766,
        canCalculate: true,
        collectionStatus: "partial",
      },
      expenses: [],
      participants: [],
    } as unknown as SharedProjectView;
    mocks.repository.getProject.mockResolvedValue(project);
    const workspace = await loadProjectWorkspace(projectId, "project-workspace");
    expect(mocks.repository.getProject).toHaveBeenCalledWith(ownerId, projectId);
    expect(workspace).toMatchObject({ project: { id: projectId, name: "Cabin", projectYear: 2026 }, pageHelpSeen: true });
    expect(mocks.pageHelpRepository.hasSeen).toHaveBeenCalledWith(ownerId, "project-workspace");

    mocks.repository.getProject.mockResolvedValue(null);
    await expect(loadProjectWorkspace("00000000-0000-0000-0000-000000000099", "project-workspace")).resolves.toBeNull();
    expect(mocks.repository.getProject).toHaveBeenLastCalledWith(ownerId, "00000000-0000-0000-0000-000000000099");
  });

  it("rejects a malformed workspace ID before owner or database access", async () => {
    await expect(loadProjectWorkspace("not-a-uuid", "project-workspace")).resolves.toBeNull();
    expect(mocks.owner).not.toHaveBeenCalled();
    expect(mocks.getServerDatabase).not.toHaveBeenCalled();
    expect(mocks.createSharedProjectsRepository).not.toHaveBeenCalled();
    expect(mocks.repository.getProject).not.toHaveBeenCalled();
  });
});
