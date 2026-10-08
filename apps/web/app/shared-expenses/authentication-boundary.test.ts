import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";


const mocks = vi.hoisted(() => ({
  activeSession: "session-a",
  auth: { getSession: vi.fn() },
  headers: vi.fn(),
  getServerDatabase: vi.fn(),
  getOwnerByAuthUserId: vi.fn(),
  createAuthenticationRepository: vi.fn(),
  createSharedProjectsRepository: vi.fn(),
  createPageHelpRepository: vi.fn(),
  toTorontoDateIso: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
}));
const mutableProcessEnv = process.env as Record<string, string | undefined>;
const originalTwoFactorRequirement = process.env.ATHENA_AUTH_REQUIRE_2FA;

afterAll(() => {
  if (originalTwoFactorRequirement === undefined) delete mutableProcessEnv.ATHENA_AUTH_REQUIRE_2FA;
  else mutableProcessEnv.ATHENA_AUTH_REQUIRE_2FA = originalTwoFactorRequirement;
});


vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("../../lib/server/auth", () => ({ auth: { api: { getSession: mocks.auth.getSession } } }));
vi.mock("../../lib/server/database", () => ({ getServerDatabase: mocks.getServerDatabase }));
vi.mock("@athena/database", () => ({
  createAuthenticationRepository: mocks.createAuthenticationRepository,
  createPageHelpRepository: mocks.createPageHelpRepository,
  createSharedProjectsRepository: mocks.createSharedProjectsRepository,
  toTorontoDateIso: mocks.toTorontoDateIso,
  withAuthUserContext: async (database: unknown, _authUserId: string, callback: (authDatabase: unknown) => unknown) => callback(database),
  withDatabaseContext: async (database: unknown, _context: unknown, callback: (contextDatabase: unknown) => unknown) => callback(database),
}));
vi.mock("../../components/module-page", () => ({ ModulePage: vi.fn(({ children }: { readonly children: unknown }) => children) }));
vi.mock("./projects-list-manager", () => ({ ProjectsListManager: vi.fn(() => null) }));
vi.mock("./project-workspace-manager", () => ({ ProjectWorkspaceManager: vi.fn(() => null) }));

import { getAuthenticatedUser } from "../../lib/server/auth-session";
import { initialProjectActionState } from "./action-helpers";
import { updateProjectAction } from "./actions";
import ProjectsPage from "./page";
import { loadProjectWorkspace } from "./[id]/workspace-route";

const ownerA = {
  id: "00000000-0000-4000-8000-0000000023a1",
  email: "web-fixture-owner-a@athena-vault.local",
  displayName: "Web Fixture A",
  createdAt: new Date("2026-08-13T00:00:00.000Z"),
};
const ownerB = {
  id: "00000000-0000-4000-8000-0000000023b1",
  email: "web-fixture-owner-b@athena-vault.local",
  displayName: "Web Fixture B",
  createdAt: new Date("2026-08-13T00:01:00.000Z"),
};
const projectAId = "00000000-0000-4000-8000-0000000023c1";
const projectBId = "00000000-0000-4000-8000-0000000023d1";

interface FixtureProject {
  readonly ownerId: string;
  readonly view: {
    id: string;
    name: string;
    projectYear: number;
    ownerParticipates: boolean;
    note: string | null;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    totalExpensesMinor: number;
    receivedFromOthersMinor: number;
    outstandingMinor: number | null;
    participantCount: number;
    collectionStatus: "not_ready" | "no_expenses" | "unpaid" | "partial" | "paid" | "overpaid";
    summary: Record<string, unknown>;
    expenses: readonly Record<string, unknown>[];
    participants: readonly Record<string, unknown>[];
  };
}

interface Fixture {
  readonly projects: Map<string, FixtureProject>;
  readonly sessions: Map<string, { readonly authUserId: string; readonly expiresAt: Date; readonly revoked: boolean }>;
  readonly repository: {
    readonly listProjects: ReturnType<typeof vi.fn>;
    readonly getProject: ReturnType<typeof vi.fn>;
    readonly updateProject: ReturnType<typeof vi.fn>;
  };
}

const now = new Date("2026-08-13T12:00:00.000Z");

function makeProject(ownerId: string, id: string, name: string, amountMinor: number): FixtureProject {
  const createdAt = new Date("2026-08-13T00:00:00.000Z");
  return {
    ownerId,
    view: {
      id,
      name,
      projectYear: 2026,
      ownerParticipates: true,
      note: null,
      archivedAt: null,
      createdAt,
      updatedAt: createdAt,
      totalExpensesMinor: amountMinor,
      receivedFromOthersMinor: 0,
      outstandingMinor: amountMinor,
      participantCount: 0,
      collectionStatus: "not_ready",
      summary: {
        totalExpensesMinor: amountMinor,
        participantCount: 0,
        splitCount: 0,
        sharePerPersonMinor: null,
        ownerShareMinor: null,
        expectedFromOthersMinor: null,
        receivedFromOthersMinor: 0,
        outstandingMinor: amountMinor,
        overpaymentReceivedMinor: null,
        roundingDifferenceMinor: null,
        netCashResultMinor: -amountMinor,
        canCalculate: false,
        collectionStatus: "not_ready",
      },
      expenses: [{
        id: `${id}-expense`,
        projectId: id,
        description: `${name} expense`,
        expenseOn: "2026-08-13",
        quantity: 1,
        amountMinor,
        totalMinor: amountMinor,
        note: null,
        createdAt,
        updatedAt: createdAt,
      }],
      participants: [],
    },
  };
}

function createFixture(): Fixture {
  const projects = new Map<string, FixtureProject>([
    [projectAId, makeProject(ownerA.id, projectAId, "Owner A ledger", 12_500)],
    [projectBId, makeProject(ownerB.id, projectBId, "Owner B ledger", 25_000)],
  ]);
  const sessions = new Map([
    ["session-a", { authUserId: "auth-a", expiresAt: new Date("2099-01-01T00:00:00.000Z"), revoked: false }],
    ["session-b", { authUserId: "auth-b", expiresAt: new Date("2099-01-01T00:00:00.000Z"), revoked: false }],
    ["session-expired", { authUserId: "auth-a", expiresAt: new Date("2000-01-01T00:00:00.000Z"), revoked: false }],
    ["session-revoked", { authUserId: "auth-a", expiresAt: new Date("2099-01-01T00:00:00.000Z"), revoked: true }],
  ]);

  const listProjects = vi.fn(async (ownerId: string) => [...projects.values()]
    .filter((project) => project.ownerId === ownerId)
    .map((project) => {
      const { summary: _summary, expenses: _expenses, participants: _participants, ...listView } = project.view;
      return listView;
    }));
  const getProject = vi.fn(async (ownerId: string, projectId: string) => {
    const project = projects.get(projectId);
    return project?.ownerId === ownerId ? project.view : null;
  });
  const updateProject = vi.fn(async (ownerId: string, projectId: string, input: { readonly name: string; readonly projectYear: number; readonly ownerParticipates: boolean; readonly note: string | null }) => {
    const project = projects.get(projectId);
    if (!project || project.ownerId !== ownerId) throw new Error("Project not found.");
    project.view.name = input.name;
    project.view.projectYear = input.projectYear;
    project.view.ownerParticipates = input.ownerParticipates;
    project.view.note = input.note;
  });

  return { projects, sessions, repository: { listProjects, getProject, updateProject } };
}

function formData(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

describe("two-user authenticated web boundary", () => {
  let fixture: Fixture;

  beforeEach(() => {
    mutableProcessEnv.ATHENA_AUTH_REQUIRE_2FA = "false";
    fixture = createFixture();
    mocks.activeSession = "session-a";
    mocks.headers.mockImplementation(async () => new Headers({ cookie: `athena-test-session=${mocks.activeSession}` }));
    mocks.auth.getSession.mockImplementation(async ({ headers }: { readonly headers: Headers }) => {
      const sessionId = headers.get("cookie")?.match(/(?:^|;\s*)athena-test-session=([^;]+)/)?.[1];
      const session = fixture.sessions.get(sessionId ?? "");
      if (!session || session.revoked || session.expiresAt <= now) return null;
      return { user: { id: session.authUserId }, session: { id: sessionId, expiresAt: session.expiresAt } };
    });
    mocks.getOwnerByAuthUserId.mockImplementation(async (authUserId: string) => {
      if (authUserId === "auth-a") return ownerA;
      if (authUserId === "auth-b") return ownerB;
      return null;
    });
    mocks.createAuthenticationRepository.mockReturnValue({ getOwnerByAuthUserId: mocks.getOwnerByAuthUserId });
    mocks.createPageHelpRepository.mockReturnValue({ hasSeen: vi.fn(async () => false), markSeen: vi.fn(async () => undefined) });
    mocks.createSharedProjectsRepository.mockReturnValue(fixture.repository);
    mocks.getServerDatabase.mockReturnValue({});
    mocks.toTorontoDateIso.mockReturnValue("2026-08-13");
    mocks.redirect.mockImplementation((path: string) => { throw new Error(`REDIRECT:${path}`); });
    vi.clearAllMocks();
  });

  it("maps each authenticated session to its owner and hides another owner's URL project", async () => {
    await expect(getAuthenticatedUser()).resolves.toMatchObject({ authUserId: "auth-a", owner: ownerA });

    const page = await ProjectsPage({ searchParams: Promise.resolve({}) });
    const listProps = (page as unknown as { readonly props: { readonly children: { readonly props: { readonly projects: readonly { readonly id: string }[] } } } }).props.children.props;
    expect(listProps.projects.map((project) => project.id)).toEqual([projectAId]);
    expect(fixture.repository.listProjects).toHaveBeenCalledWith(ownerA.id);

    await expect(loadProjectWorkspace(projectBId, "project-workspace")).resolves.toBeNull();
    expect(fixture.repository.getProject).toHaveBeenCalledWith(ownerA.id, projectBId);

    mocks.activeSession = "session-b";
    await expect(getAuthenticatedUser()).resolves.toMatchObject({ authUserId: "auth-b", owner: ownerB });
    await expect(loadProjectWorkspace(projectBId, "project-workspace")).resolves.toMatchObject({ project: { id: projectBId, name: "Owner B ledger", summary: { totalExpensesMinor: 25_000 } }, pageHelpSeen: false });
  });

  it("denies a tampered write even when the form also supplies another owner's ID", async () => {
    const before = { ...fixture.projects.get(projectBId)!.view };

    const result = await updateProjectAction(initialProjectActionState, formData({
      ownerId: ownerB.id,
      projectId: projectBId,
      name: "Tampered B ledger",
      year: "2026",
      ownerParticipates: "true",
      projectNote: "Tampered",
    }));

    expect(result).toEqual({ ok: false, message: "That project was not found.", fieldErrors: {} });
    expect(fixture.repository.updateProject).toHaveBeenCalledWith(ownerA.id, projectBId, {
      name: "Tampered B ledger",
      projectYear: 2026,
      ownerParticipates: true,
      note: "Tampered",
    });
    expect(fixture.projects.get(projectBId)!.view).toEqual(before);
  });

  it.each(["session-expired", "session-revoked"])("redirects a %s session before route database access", async (sessionId) => {
    mocks.activeSession = sessionId;

    await expect(ProjectsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/login");
    expect(fixture.repository.listProjects).not.toHaveBeenCalled();
    await expect(getAuthenticatedUser()).resolves.toBeNull();
  });
});
