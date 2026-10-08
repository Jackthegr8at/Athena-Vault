import { describe, expect, it, vi } from "vitest";
import { createNotificationRepository } from "./notifications";
import type { Database } from "../client";

describe("owner notifications", () => {
  it("writes only bounded allowlisted payload fields", async () => {
    const values = vi.fn(() => Promise.resolve(undefined));
    const insert = vi.fn(() => ({ values }));
    const database = { insert } as unknown as Database;

    await createNotificationRepository(database).createOwnerNotification("owner-1", "password_changed", {
      title: "Password changed",
      message: "Completed",
      occurredAt: "2026-09-04T00:00:00.000Z",
      token: "must-not-persist",
    });

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: "owner-1",
      type: "password_changed",
      payload: { title: "Password changed", message: "Completed", occurredAt: "2026-09-04T00:00:00.000Z" },
    }));
  });
});
