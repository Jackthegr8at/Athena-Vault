import { describe, expect, it, vi } from "vitest";
import { createPageHelpRepository } from "./page-help";
import type { Database } from "./client";

const ownerId = "00000000-0000-0000-0000-000000000001";

describe("page-help repository", () => {
  it("checks the owner-scoped page marker", async () => {
    const limit = vi.fn(async () => [{ pageId: "cash-flow" }]);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const database = { select: vi.fn(() => ({ from })) } as unknown as Database;

    await expect(createPageHelpRepository(database).hasSeen(ownerId, " cash-flow ")).resolves.toBe(true);
    expect(database.select).toHaveBeenCalledOnce();
    expect(from).toHaveBeenCalledOnce();
    expect(where).toHaveBeenCalledOnce();
    expect(limit).toHaveBeenCalledOnce();
  });

  it("marks a page id with an idempotent insert", async () => {
    const onConflictDoNothing = vi.fn(async () => undefined);
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const database = { insert: vi.fn(() => ({ values })) } as unknown as Database;

    await createPageHelpRepository(database).markSeen(ownerId, "overview");
    expect(database.insert).toHaveBeenCalledOnce();
    expect(values).toHaveBeenCalledOnce();
    expect(onConflictDoNothing).toHaveBeenCalledOnce();
  });

  it("atomically records the first render and reports whether the marker already existed", async () => {
    const returning = vi.fn(async () => [{ pageId: "overview" }] as readonly { pageId: string }[]);
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const database = { insert: vi.fn(() => ({ values })) } as unknown as Database;
    const repository = createPageHelpRepository(database);

    await expect(repository.ensureSeen(ownerId, "overview")).resolves.toBe(false);
    returning.mockResolvedValue([]);
    await expect(repository.ensureSeen(ownerId, "overview")).resolves.toBe(true);
    expect(database.insert).toHaveBeenCalledTimes(2);
    expect(returning).toHaveBeenCalledTimes(2);
  });

  it.each(["", "UPPER", "cash flow", "a".repeat(65)])("rejects invalid page ids: %s", async (pageId) => {
    const database = {} as unknown as Database;
    await expect(createPageHelpRepository(database).hasSeen(ownerId, pageId)).rejects.toThrow("Page help page id is invalid.");
  });
});
