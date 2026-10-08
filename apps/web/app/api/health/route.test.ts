import { beforeEach, describe, expect, it, vi } from "vitest";
import { DATABASE_HEALTH_QUERY } from "@athena/database";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getServerDatabase: vi.fn(),
}));

vi.mock("../../../lib/server/database", () => ({ getServerDatabase: mocks.getServerDatabase }));

import { GET } from "./route";

describe("health route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerDatabase.mockReturnValue({ execute: mocks.execute });
    mocks.execute.mockResolvedValue([]);
  });

  it("returns only process and minimal database health when the query succeeds", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok", database: "ok" });
    expect(mocks.execute).toHaveBeenCalledWith(DATABASE_HEALTH_QUERY);
  });

  it("returns a generic unavailable response when the database cannot be queried", async () => {
    mocks.execute.mockRejectedValueOnce(new Error("connect failed"));

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "error", database: "unavailable" });
  });

  it("does not expose a credential-bearing database error", async () => {
    mocks.execute.mockRejectedValueOnce(new Error("postgresql://user:secret@example.invalid/db"));

    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).not.toContain("secret");
    expect(body).not.toContain("postgresql://");
    expect(body).not.toContain("DATABASE_URL");
  });
});
