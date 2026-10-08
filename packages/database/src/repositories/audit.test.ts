import { describe, expect, it, vi } from "vitest";
import { createAuditRepository } from "./audit";
import { auditEvents } from "../drizzle-schema";
import type { Database } from "../client";

describe("auth security audit", () => {
  it("writes owner-scoped events with fixed action, entity type, and entity id", async () => {
    const values = vi.fn(() => Promise.resolve(undefined));
    const insert = vi.fn(() => ({ values }));
    const database = { insert } as unknown as Database;

    await createAuditRepository(database).writeAuthSecurityEvent("owner-1", "actor-1", {
      operation: "session-create",
      status: "success",
    });

    expect(insert).toHaveBeenCalledWith(auditEvents);
    expect(values).toHaveBeenCalledWith({
      ownerId: "owner-1",
      actorUserId: "actor-1",
      action: "created",
      entityType: "auth_security",
      entityId: null,
      metadata: { operation: "session-create", status: "success" },
    });
  });

  it("hides all auth security activity for demo owners", async () => {
    const database = { select: vi.fn() } as unknown as Database;

    await expect(createAuditRepository(database).listAuthSecurityEvents("demo-owner", true)).resolves.toEqual([]);
    expect(database.select).not.toHaveBeenCalled();
  });

  it("normalizes invalid or unsupported metadata to unknown", async () => {
    const limit = vi.fn(async () => [
      { createdAt: new Date("2026-09-01T00:00:00.000Z"), metadata: { operation: "session-create", status: "unknown" } },
      { createdAt: new Date("2026-09-01T00:00:01.000Z"), metadata: { operation: "not-an-operation", status: "success" } },
      { createdAt: new Date("2026-09-01T00:00:02.000Z"), metadata: null },
      { createdAt: new Date("2026-09-01T00:00:03.000Z"), metadata: { operation: "session-create" } },
      { createdAt: new Date("2026-09-01T00:00:04.000Z"), metadata: {} },
      { createdAt: new Date("2026-09-01T00:00:05.000Z"), metadata: { operation: 123, status: true } },
    ]);
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const database = { select } as unknown as Database;

    await expect(createAuditRepository(database).listAuthSecurityEvents("owner-1", false)).resolves.toEqual([
      { createdAt: new Date("2026-09-01T00:00:00.000Z"), operation: "session-create", status: "unknown" },
      { createdAt: new Date("2026-09-01T00:00:01.000Z"), operation: "unknown", status: "success" },
      { createdAt: new Date("2026-09-01T00:00:02.000Z"), operation: "unknown", status: "unknown" },
      { createdAt: new Date("2026-09-01T00:00:03.000Z"), operation: "session-create", status: "unknown" },
      { createdAt: new Date("2026-09-01T00:00:04.000Z"), operation: "unknown", status: "unknown" },
      { createdAt: new Date("2026-09-01T00:00:05.000Z"), operation: "unknown", status: "unknown" },
    ]);
  });
});
