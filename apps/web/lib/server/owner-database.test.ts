import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  requireAuthenticatedUser: vi.fn(),
  requireWritableAuthenticatedUser: vi.fn(),
  requireMfaEnrolledUser: vi.fn((user: unknown) => user),
  getServerDatabase: vi.fn(() => ({ name: "database" })),
  withDatabaseContext: vi.fn(async (_database: unknown, _context: unknown, callback: (database: unknown) => unknown) => callback({ name: "scoped-database" })),
}));

vi.mock("@athena/database", () => ({ withDatabaseContext: mocks.withDatabaseContext }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("./auth-session", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
  requireAuthenticatedUser: mocks.requireAuthenticatedUser,
  requireWritableAuthenticatedUser: mocks.requireWritableAuthenticatedUser,
  requireMfaEnrolledUser: mocks.requireMfaEnrolledUser,
}));
vi.mock("./database", () => ({ getServerDatabase: mocks.getServerDatabase }));

import { withAuthenticatedDatabase, withAuthenticatedPageDatabase, withWritableAuthenticatedDatabase } from "./owner-database";
import type { AuthenticatedUser } from "./auth-session";

const normalUser = {
  authUserId: "auth-user",
  owner: { id: "owner", isDemo: false, demoFixtureVersion: null },
  session: { id: "session" },
};

describe("owner database boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuthenticatedUser.mockResolvedValue(normalUser);
    mocks.requireWritableAuthenticatedUser.mockResolvedValue(normalUser);
    mocks.getAuthenticatedUser.mockResolvedValue(normalUser);
  });

  it("keeps read pages available to a demo owner", async () => {
    const demoUser = { ...normalUser, owner: { ...normalUser.owner, isDemo: true, demoFixtureVersion: 1 } };
    mocks.getAuthenticatedUser.mockResolvedValue(demoUser);

    await expect(withAuthenticatedPageDatabase(async (_database, user) => user.owner.isDemo)).resolves.toBe(true);
    expect(mocks.withDatabaseContext).toHaveBeenCalledWith(
      mocks.getServerDatabase(),
      { ownerId: demoUser.owner.id, authUserId: demoUser.authUserId },
      expect.any(Function),
    );
  });

  it("does not open a database context when the writable boundary rejects", async () => {
    const error = new Error("This workspace is read-only.");
    mocks.requireWritableAuthenticatedUser.mockRejectedValue(error);
    const callback = vi.fn();

    await expect(withWritableAuthenticatedDatabase(callback)).rejects.toBe(error);
    expect(callback).not.toHaveBeenCalled();
    expect(mocks.withDatabaseContext).not.toHaveBeenCalled();
  });

  it("passes normal users through the writable boundary", async () => {
    const callback = vi.fn(async (_database: unknown, user: AuthenticatedUser) => user.owner.id);

    await expect(withWritableAuthenticatedDatabase(callback)).resolves.toBe("owner");
    expect(mocks.requireWritableAuthenticatedUser).toHaveBeenCalledOnce();
    expect(mocks.withDatabaseContext).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledOnce();
  });

  it("preserves the existing authenticated read wrapper", async () => {
    await expect(withAuthenticatedDatabase(async (_database, user) => user.authUserId)).resolves.toBe("auth-user");
    expect(mocks.requireAuthenticatedUser).toHaveBeenCalledOnce();
  });
  it("invokes the MFA guard before opening the database context and passes requireTwoFactor", async () => {
    const callback = vi.fn();

    await withAuthenticatedDatabase(callback, { requireTwoFactor: true });
    expect(mocks.requireMfaEnrolledUser).toHaveBeenCalledWith(normalUser, true);
    expect(mocks.withDatabaseContext).toHaveBeenCalled();

    mocks.requireMfaEnrolledUser.mockClear();
    await withAuthenticatedPageDatabase(callback, { requireTwoFactor: true });
    expect(mocks.requireMfaEnrolledUser).toHaveBeenCalledWith(normalUser, true);

    mocks.requireMfaEnrolledUser.mockClear();
    await withWritableAuthenticatedDatabase(callback, { requireTwoFactor: true });
    expect(mocks.requireMfaEnrolledUser).toHaveBeenCalledWith(normalUser, true);
  });

  it("allows non-finance callers to skip the two-factor guard", async () => {
    const callback = vi.fn(async (_database: unknown, user: AuthenticatedUser) => user.authUserId);

    await withAuthenticatedDatabase(callback, { requireTwoFactor: false });
    expect(mocks.requireMfaEnrolledUser).toHaveBeenCalledWith(normalUser, false);
    expect(callback).toHaveBeenCalled();

    mocks.requireMfaEnrolledUser.mockClear();
    await withAuthenticatedPageDatabase(callback, { requireTwoFactor: false });
    expect(mocks.requireMfaEnrolledUser).toHaveBeenCalledWith(normalUser, false);

    mocks.requireMfaEnrolledUser.mockClear();
    await withWritableAuthenticatedDatabase(callback, { requireTwoFactor: false });
    expect(mocks.requireMfaEnrolledUser).toHaveBeenCalledWith(normalUser, false);
  });

  it("does not call the database callback if the MFA guard denies", async () => {
    const error = new Error("MFA_REQUIRED");
    mocks.requireMfaEnrolledUser.mockImplementation(() => {
      throw error;
    });
    const callback = vi.fn();

    await expect(withAuthenticatedDatabase(callback, { requireTwoFactor: true })).rejects.toBe(error);
    expect(mocks.requireMfaEnrolledUser).toHaveBeenCalledWith(normalUser, true);
    expect(mocks.withDatabaseContext).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
  });
});
