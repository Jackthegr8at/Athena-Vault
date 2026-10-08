import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  repository: { getById: vi.fn() },
  createCalculationWorkbooksRepository: vi.fn(),
  withAuthenticatedDatabase: vi.fn(),
  UnauthenticatedError: class UnauthenticatedError extends Error {
    constructor() {
      super("Authentication required.");
      this.name = "UnauthenticatedError";
    }
  },
}));

vi.mock("@athena/database", () => ({
  createCalculationWorkbooksRepository: mocks.createCalculationWorkbooksRepository,
}));
vi.mock("../../../../../lib/server/owner-database", () => ({
  withAuthenticatedDatabase: mocks.withAuthenticatedDatabase,
}));
vi.mock("../../../../../lib/server/auth-session", () => ({
  UnauthenticatedError: mocks.UnauthenticatedError,
}));

import { GET } from "./route";

const ownerId = "00000000-0000-0000-0000-000000000001";
const workbookId = "00000000-0000-0000-0000-0000000000aa";

function context(id = workbookId) {
  return { params: Promise.resolve({ id }) };
}

describe("workbook snapshot route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createCalculationWorkbooksRepository.mockReturnValue(mocks.repository);
    mocks.withAuthenticatedDatabase.mockImplementation(async (
      callback: (database: unknown, user: { readonly owner: { readonly id: string; readonly isDemo: boolean } }) => unknown,
    ) => callback({}, { owner: { id: ownerId, isDemo: false } }));
    mocks.repository.getById.mockResolvedValue(null);
  });

  it("requires authentication before reading any workbook", async () => {
    mocks.withAuthenticatedDatabase.mockRejectedValue(new mocks.UnauthenticatedError());

    const response = await GET(new Request("https://vault.example.test/api/workbooks/book-1/snapshot"), context());

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ error: "Authentication required." });
    expect(mocks.createCalculationWorkbooksRepository).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing or foreign workbook id", async () => {
    const response = await GET(new Request("https://vault.example.test/api/workbooks/book-1/snapshot"), context("other-owner-book"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Workbook not found." });
    expect(mocks.repository.getById).toHaveBeenCalledWith(ownerId, "other-owner-book");
  });

  it("returns 404 for an invalid workbook id", async () => {
    mocks.repository.getById.mockRejectedValue(new RangeError("Workbook ID is required."));

    const response = await GET(new Request("https://vault.example.test/api/workbooks/%20/snapshot"), context(" "));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Workbook not found." });
  });

  it("returns the owner's workbook snapshot with no-store caching", async () => {
    const snapshot = { name: "First workbook", sheets: { "sheet-1": { cellData: {} } } };
    mocks.repository.getById.mockResolvedValue({ id: workbookId, name: "First workbook", snapshot });

    const response = await GET(new Request(`https://vault.example.test/api/workbooks/${workbookId}/snapshot`), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ snapshot });
    expect(mocks.repository.getById).toHaveBeenCalledWith(ownerId, workbookId);
    expect(mocks.withAuthenticatedDatabase).toHaveBeenCalledWith(expect.any(Function), { requireTwoFactor: true });
  });
});
