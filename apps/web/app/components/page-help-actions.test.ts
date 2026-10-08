import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  repository: { markSeen: vi.fn() },
  createPageHelpRepository: vi.fn(),
  withAuthenticatedDatabase: vi.fn(),
}));

vi.mock("@athena/database", () => ({ createPageHelpRepository: mocks.createPageHelpRepository }));
vi.mock("../../lib/server/owner-database", () => ({ withAuthenticatedDatabase: mocks.withAuthenticatedDatabase }));

import { markPageHelpSeen } from "./page-help-actions";

describe("page-help seen server action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createPageHelpRepository.mockReturnValue(mocks.repository);
    mocks.repository.markSeen.mockResolvedValue(undefined);
    mocks.withAuthenticatedDatabase.mockImplementation(async (callback: (database: unknown, user: { readonly owner: { readonly id: string; readonly isDemo: boolean } }) => unknown) => callback({}, { owner: { id: "00000000-0000-0000-0000-000000000001", isDemo: false } }));
  });

  it("persists only a registered guide page through the authenticated owner", async () => {
    await markPageHelpSeen("cash-flow");

    expect(mocks.withAuthenticatedDatabase).toHaveBeenCalledOnce();
    expect(mocks.repository.markSeen).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", "cash-flow");
  });

  it("does not persist page-help-seen state for demo owners", async () => {
    mocks.withAuthenticatedDatabase.mockImplementation(async (callback: (database: unknown, user: { readonly owner: { readonly id: string; readonly isDemo: boolean } }) => unknown) => callback({}, { owner: { id: "00000000-0000-0000-0000-000000000002", isDemo: true } }));

    await markPageHelpSeen("cash-flow");

    expect(mocks.withAuthenticatedDatabase).toHaveBeenCalledOnce();
    expect(mocks.repository.markSeen).not.toHaveBeenCalled();
  });

  it("rejects unknown page identifiers before opening a database transaction", async () => {
    await expect(markPageHelpSeen("not-a-guide")).rejects.toThrow("Page help page is invalid.");
    expect(mocks.withAuthenticatedDatabase).not.toHaveBeenCalled();
    expect(mocks.repository.markSeen).not.toHaveBeenCalled();
  });
});
