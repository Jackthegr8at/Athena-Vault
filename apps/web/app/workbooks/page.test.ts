import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  repository: { listByOwner: vi.fn(), getById: vi.fn() },
  createCalculationWorkbooksRepository: vi.fn(),
  withAuthenticatedPageDatabase: vi.fn(),
}));

vi.mock("@athena/database", () => ({
  createCalculationWorkbooksRepository: mocks.createCalculationWorkbooksRepository,
}));
vi.mock("../components/module-page", () => ({ ModulePage: vi.fn() }));
vi.mock("../../lib/server/owner-database", () => ({
  withAuthenticatedPageDatabase: mocks.withAuthenticatedPageDatabase,
}));
vi.mock("./calculation-workbench", () => ({ CalculationWorkbench: vi.fn(() => null) }));

import WorkbooksPage from "./page";

const ownerId = "00000000-0000-0000-0000-000000000001";

function pageChild(page: unknown): { readonly props: Record<string, unknown> } {
  return (page as { readonly props: { readonly children: { readonly props: Record<string, unknown> } } }).props.children;
}

describe("workbooks route availability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createCalculationWorkbooksRepository.mockReturnValue(mocks.repository);
    mocks.withAuthenticatedPageDatabase.mockImplementation(async (callback: (database: unknown, user: unknown) => unknown) => callback({}, {
      owner: { id: ownerId, isDemo: false },
    }));
    mocks.repository.listByOwner.mockResolvedValue([]);
    mocks.repository.getById.mockResolvedValue(null);
  });

  it("does not query the workbook table for the read-only demo", async () => {
    mocks.withAuthenticatedPageDatabase.mockImplementation(async (callback: (database: unknown, user: unknown) => unknown) => callback({}, {
      owner: { id: ownerId, isDemo: true },
    }));

    const page = await WorkbooksPage({});
    const child = pageChild(page);

    expect(mocks.createCalculationWorkbooksRepository).not.toHaveBeenCalled();
    expect(child.props).toMatchObject({ workbooks: [], selectedWorkbook: null, migrationRequired: false, isDemo: true });
  });

  it("passes only workbook metadata to the client workbench", async () => {
    mocks.repository.listByOwner.mockResolvedValue([{ id: "book-1", name: "First", updatedAt: new Date("2026-09-01T00:00:00Z") }]);
    mocks.repository.getById.mockResolvedValue({
      id: "book-1",
      name: "First",
      updatedAt: new Date("2026-09-01T00:00:00Z"),
      snapshot: { cell: "saved" },
    });

    const page = await WorkbooksPage({});
    const child = pageChild(page);

    expect(child.props.selectedWorkbook).toEqual({
      id: "book-1",
      name: "First",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(child.props.selectedWorkbook).not.toHaveProperty("snapshot");
  });

  it("turns a missing additive migration into an actionable page state", async () => {
    mocks.repository.listByOwner.mockRejectedValue({ code: "42P01", message: 'relation "calculation_workbooks" does not exist' });

    const page = await WorkbooksPage({});
    const child = pageChild(page);

    expect(child.props).toMatchObject({ workbooks: [], selectedWorkbook: null, migrationRequired: true, isDemo: false });
  });

  it("does not hide unrelated database failures", async () => {
    const failure = new Error("database unavailable");
    mocks.repository.listByOwner.mockRejectedValue(failure);

    await expect(WorkbooksPage({})).rejects.toBe(failure);
  });
});
