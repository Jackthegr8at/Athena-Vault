import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  headers: vi.fn(async () => new Headers()),
  getServerDatabase: vi.fn(() => ({})),
  getOwnerByAuthUserId: vi.fn(),
  withAuthUserContext: vi.fn(async (_database: unknown, _authUserId: string, callback: (database: unknown) => unknown) => callback({})),
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));

// Simulates React `cache` request scoping: memoization survives within one
// request and resets when `nextRequest()` marks a new request boundary.
const requestScope = vi.hoisted(() => ({
  generation: 0,
  nextRequest(): void {
    this.generation += 1;
  },
}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    cache: <T extends (...args: never[]) => unknown>(fn: T): T => {
      let generation = -1;
      let key: unknown;
      let value: unknown;
      const memoized = (firstArg?: unknown) => {
        if (generation !== requestScope.generation || firstArg !== key) {
          generation = requestScope.generation;
          key = firstArg;
          value = fn(firstArg as never);
        }
        return value;
      };
      return memoized as unknown as T;
    },
  };
});
const mutableProcessEnv = process.env as Record<string, string | undefined>;


vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("./auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("./database", () => ({ getServerDatabase: mocks.getServerDatabase }));
vi.mock("@athena/database", () => ({
  createAuthenticationRepository: vi.fn(() => ({ getOwnerByAuthUserId: mocks.getOwnerByAuthUserId })),
  withAuthUserContext: mocks.withAuthUserContext,
  MISSING_WORKSPACE_ERROR_MESSAGE: "Authenticated user has no workspace.",
}));

import {
  assertWritableAuthenticatedUser,
  getAuthenticatedUser,
  requireAuthenticatedUser,
  requireMfaEnrolledUser,
  requireWritableAuthenticatedUser,
  type AuthenticatedUser,

  UnauthenticatedError,
} from "./auth-session";

const ownerA = { id: "owner-a", email: "a@example.test", displayName: null, isDemo: false, demoFixtureVersion: null, createdAt: new Date("2026-01-01T00:00:00.000Z") };
const ownerB = { id: "owner-b", email: "b@example.test", displayName: null, isDemo: false, demoFixtureVersion: null, createdAt: new Date("2026-01-02T00:00:00.000Z") };

describe("authenticated session to Athena owner mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestScope.nextRequest();
    mocks.getSession.mockImplementation(async () => ({ user: { id: "auth-a" }, session: { id: "session-a" } }));
    mocks.getOwnerByAuthUserId.mockImplementation(async (authUserId: string) => authUserId === "auth-a" ? ownerA : ownerB);
  });

  it("resolves the session and owner context once per request scope", async () => {
    const [first, second] = await Promise.all([getAuthenticatedUser(), getAuthenticatedUser()]);
    const third = await getAuthenticatedUser();

    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(mocks.getSession).toHaveBeenCalledOnce();
    expect(mocks.withAuthUserContext).toHaveBeenCalledOnce();
    expect(mocks.getOwnerByAuthUserId).toHaveBeenCalledOnce();

    requestScope.nextRequest();
    await expect(getAuthenticatedUser()).resolves.toMatchObject({ authUserId: "auth-a" });
    expect(mocks.getSession).toHaveBeenCalledTimes(2);
    expect(mocks.withAuthUserContext).toHaveBeenCalledTimes(2);
  });

  it("resolves each session only to its mapped owner", async () => {
    await expect(getAuthenticatedUser()).resolves.toMatchObject({ authUserId: "auth-a", owner: ownerA, session: { id: "session-a" } });
    expect(mocks.getOwnerByAuthUserId).toHaveBeenCalledWith("auth-a");
    expect(mocks.getSession).toHaveBeenCalledWith({ headers: expect.any(Headers) });

    requestScope.nextRequest();
    mocks.getSession.mockResolvedValueOnce({ user: { id: "auth-b" }, session: { id: "session-b" } });
    await expect(getAuthenticatedUser()).resolves.toMatchObject({ authUserId: "auth-b", owner: ownerB, session: { id: "session-b" } });
    expect(mocks.getOwnerByAuthUserId).toHaveBeenLastCalledWith("auth-b");
  });

  it("exposes Better Auth's two-factor state without exposing any secret material", async () => {
    mocks.getSession.mockResolvedValueOnce({ user: { id: "auth-a", twoFactorEnabled: true }, session: { id: "session-a" } });

    await expect(getAuthenticatedUser()).resolves.toMatchObject({ twoFactorEnabled: true });
  });

  it("fails closed for an absent session or missing mapping", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    await expect(getAuthenticatedUser()).resolves.toBeNull();

    requestScope.nextRequest();
    mocks.getSession.mockResolvedValueOnce({ user: { id: "unmapped" }, session: { id: "session-x" } });
    mocks.getOwnerByAuthUserId.mockResolvedValueOnce(null);
    await expect(getAuthenticatedUser()).resolves.toBeNull();
    requestScope.nextRequest();
    mocks.getSession.mockResolvedValueOnce(null);
    await expect(requireAuthenticatedUser()).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("fails closed when the authenticated user has no workspace and propagates other errors", async () => {
    mocks.withAuthUserContext.mockRejectedValueOnce(new Error("Authenticated user has no workspace."));
    await expect(getAuthenticatedUser()).resolves.toBeNull();
    expect(mocks.getOwnerByAuthUserId).not.toHaveBeenCalled();

    requestScope.nextRequest();
    mocks.withAuthUserContext.mockRejectedValueOnce(new Error("Authenticated user has no workspace"));
    await expect(getAuthenticatedUser()).rejects.toThrow("Authenticated user has no workspace");

    requestScope.nextRequest();
    mocks.withAuthUserContext.mockRejectedValueOnce(new Error("connection refused"));
    await expect(getAuthenticatedUser()).rejects.toThrow("connection refused");
  });

  it.each(["expired", "revoked"])("fails closed when Better Auth rejects a %s session", async () => {
    mocks.getSession.mockResolvedValue(null);

    await expect(getAuthenticatedUser()).resolves.toBeNull();
    await expect(requireAuthenticatedUser()).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(mocks.getOwnerByAuthUserId).not.toHaveBeenCalled();
  });

  it("exposes the demo marker and rejects writable authentication", async () => {
    const demoOwner = { ...ownerA, isDemo: true, demoFixtureVersion: 1 };
    mocks.getOwnerByAuthUserId.mockResolvedValue(demoOwner);

    const user = await getAuthenticatedUser();
    expect(user?.owner).toMatchObject({ isDemo: true, demoFixtureVersion: 1 });
    await expect(requireWritableAuthenticatedUser()).rejects.toMatchObject({
      name: "ReadOnlyWorkspaceError",
      message: "This workspace is read-only.",
    });
  });

  it("allows normal owners through the writable assertion", () => {
    expect(() => assertWritableAuthenticatedUser({ owner: { ...ownerA, isDemo: false, demoFixtureVersion: null } })).not.toThrow();
  });
});
describe("MFA enrollment guard", () => {
  const baseUser = { authUserId: "auth-a", owner: ownerA, session: { id: "session-a" }, twoFactorEnabled: false } as unknown as AuthenticatedUser;


  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ATHENA_AUTH_REQUIRE_2FA;
  });

  it("allows unenrolled users when two-factor is not required", () => {
    expect(requireMfaEnrolledUser(baseUser, false)).toBe(baseUser);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("treats a missing requirement as disabled", () => {
    expect(requireMfaEnrolledUser(baseUser)).toBe(baseUser);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("redirects unenrolled users to two-factor setup when required in production", () => {
    mutableProcessEnv.NODE_ENV = "production";

    process.env.ATHENA_AUTH_REQUIRE_2FA = "true";

    expect(() => requireMfaEnrolledUser(baseUser, true)).toThrow("REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/settings?security=two-factor");

    delete process.env.ATHENA_AUTH_REQUIRE_2FA;
    mutableProcessEnv.NODE_ENV = "test";

  });

  it("allows enrolled users when two-factor is required", () => {
    mutableProcessEnv.NODE_ENV = "production";

    process.env.ATHENA_AUTH_REQUIRE_2FA = "true";
    const enrolledUser = { ...baseUser, twoFactorEnabled: true };

    expect(requireMfaEnrolledUser(enrolledUser, true)).toBe(enrolledUser);
    expect(mocks.redirect).not.toHaveBeenCalled();

    delete process.env.ATHENA_AUTH_REQUIRE_2FA;
    mutableProcessEnv.NODE_ENV = "test";

  });

  it("bypasses two-factor for demo owners", () => {
    mutableProcessEnv.NODE_ENV = "production";

    process.env.ATHENA_AUTH_REQUIRE_2FA = "true";
    const demoUser = { ...baseUser, owner: { ...ownerA, isDemo: true, demoFixtureVersion: 1 } };

    expect(requireMfaEnrolledUser(demoUser, true)).toBe(demoUser);
    expect(mocks.redirect).not.toHaveBeenCalled();

    delete process.env.ATHENA_AUTH_REQUIRE_2FA;
    mutableProcessEnv.NODE_ENV = "test";

  });

  it("bypasses two-factor when policy is disabled", () => {
    mutableProcessEnv.NODE_ENV = "production";

    process.env.ATHENA_AUTH_REQUIRE_2FA = "false";

    expect(requireMfaEnrolledUser(baseUser, true)).toBe(baseUser);
    expect(mocks.redirect).not.toHaveBeenCalled();

    delete process.env.ATHENA_AUTH_REQUIRE_2FA;
    mutableProcessEnv.NODE_ENV = "test";
  });
});
