import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  repository: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  revalidatePath: vi.fn(),
  withWritableAuthenticatedDatabase: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@athena/database", () => ({
  createCalculationWorkbooksRepository: vi.fn(() => mocks.repository),
}));
vi.mock("../../lib/server/owner-database", () => ({
  withWritableAuthenticatedDatabase: mocks.withWritableAuthenticatedDatabase,
}));

import {
  createCalculationWorkbookAction,
  deleteCalculationWorkbookAction,
  saveCalculationWorkbookAction,
} from "./actions";

const ownerId = "00000000-0000-0000-0000-000000000001";
const workbookId = "00000000-0000-0000-0000-000000000002";
const updatedAt = new Date("2026-08-30T00:00:00.000Z");
const snapshot = { sheetOrder: ["sheet-1"], sheets: { "sheet-1": { id: "sheet-1" } } };

describe("calculation workbook server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withWritableAuthenticatedDatabase.mockImplementation(async (callback: (database: unknown, user: unknown) => unknown) => callback({}, { owner: { id: ownerId } }));
    mocks.repository.create.mockResolvedValue({ id: workbookId, name: "Workbook", updatedAt });
    mocks.repository.update.mockResolvedValue({ id: workbookId, name: "Household math", updatedAt });
    mocks.repository.delete.mockResolvedValue(undefined);
  });

  it("creates through the writable owner boundary and returns a serializable summary", async () => {
    await expect(createCalculationWorkbookAction()).resolves.toEqual({
      ok: true,
      workbook: { id: workbookId, name: "Workbook", updatedAt: updatedAt.toISOString() },
    });
    expect(mocks.repository.create).toHaveBeenCalledWith(ownerId, { name: "" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/workbooks");
  });

  it("rejects malformed snapshots before touching the repository", async () => {
    await expect(saveCalculationWorkbookAction({ id: workbookId, name: "Scratch", snapshot: {} })).resolves.toEqual({
      ok: false,
      message: "The workbook data is invalid.",
    });
    expect(mocks.repository.update).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("saves and deletes through the owner-scoped repository", async () => {
    await expect(saveCalculationWorkbookAction({ id: workbookId, name: " Household math ", snapshot })).resolves.toMatchObject({ ok: true });
    expect(mocks.repository.update).toHaveBeenCalledWith(ownerId, workbookId, {
      name: "Household math",
      snapshot: { ...snapshot, name: "Household math" },
    });

    await expect(deleteCalculationWorkbookAction({ id: workbookId })).resolves.toEqual({ ok: true });
    expect(mocks.repository.delete).toHaveBeenCalledWith(ownerId, workbookId);
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(2);
  });

  it("does not expose repository details on a failed save", async () => {
    mocks.repository.update.mockRejectedValueOnce(new Error("DATABASE_URL=secret"));

    await expect(saveCalculationWorkbookAction({ id: workbookId, name: "Scratch", snapshot })).resolves.toEqual({
      ok: false,
      message: "The workbook could not be saved. Please try again.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
  it("maps a duplicate-name unique constraint to a safe, actionable message", async () => {
    mocks.repository.update.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint "calculation_workbooks_owner_name_idx"'));

    const result = await saveCalculationWorkbookAction({ id: workbookId, name: "Duplicate", snapshot });
    expect(result).toEqual({
      ok: false,
      message: "A workbook with this name already exists. Please choose a different name.",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).not.toContain("calculation_workbooks_owner_name_idx");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("detects a duplicate name from a nested cause error", async () => {
    const cause = new Error('duplicate key value violates unique constraint "calculation_workbooks_owner_name_idx"');
    mocks.repository.update.mockRejectedValueOnce(new Error("save failed", { cause }));

    const result = await saveCalculationWorkbookAction({ id: workbookId, name: "Nested", snapshot });
    expect(result).toMatchObject({
      ok: false,
      message: "A workbook with this name already exists. Please choose a different name.",
    });
  });
});
