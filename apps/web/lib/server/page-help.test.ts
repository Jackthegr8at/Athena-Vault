import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasSeen: vi.fn(),
  createPageHelpRepository: vi.fn(),
}));

vi.mock("@athena/database", () => ({
  createPageHelpRepository: mocks.createPageHelpRepository,
}));

import { hasPageHelpSeen } from "./page-help";

const user = {
  authUserId: "auth-user",
  owner: { id: "00000000-0000-0000-0000-000000000001", isDemo: false },
} as never;

describe("page help seen state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createPageHelpRepository.mockReturnValue({ hasSeen: mocks.hasSeen });
  });

  it("reads the flag inside the caller's transaction without opening another one", async () => {
    const database = { name: "existing transaction" };
    mocks.hasSeen.mockResolvedValue(true);

    await expect(hasPageHelpSeen(database as never, user, "overview")).resolves.toBe(true);
    expect(mocks.createPageHelpRepository).toHaveBeenCalledWith(database);
    expect(mocks.hasSeen).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", "overview");
  });

  it("reports an unseen guide on the first visit and a seen guide on repeat visits", async () => {
    mocks.hasSeen.mockResolvedValueOnce(false);
    await expect(hasPageHelpSeen({} as never, user, "overview")).resolves.toBe(false);

    mocks.hasSeen.mockResolvedValueOnce(true);
    await expect(hasPageHelpSeen({} as never, user, "overview")).resolves.toBe(true);
    expect(mocks.hasSeen).toHaveBeenCalledTimes(2);
  });
});
