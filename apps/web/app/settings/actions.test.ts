import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionToken: vi.fn(),
  revokeSession: vi.fn(),
  revalidatePath: vi.fn(),
  headers: vi.fn(async () => new Headers()),
  logSecurityEvent: vi.fn(),
  withAuthenticatedDatabase: vi.fn(async (callback: unknown) =>
    (callback as (database: unknown, user: typeof mocks.authenticatedUser) => unknown)({}, mocks.authenticatedUser),
  ),
  authenticatedUser: { authUserId: "user-a", owner: { isDemo: false }, session: { id: "session-a" } },
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@athena/database", () => ({
  createAuthenticationRepository: vi.fn(() => ({ getSessionToken: mocks.getSessionToken })),
}));
vi.mock("../../lib/server/auth", () => ({
  auth: { api: { revokeSession: mocks.revokeSession } },
}));
vi.mock("../../lib/server/owner-database", () => ({
  withAuthenticatedDatabase: mocks.withAuthenticatedDatabase,
}));
vi.mock("../../lib/server/security-logging", () => ({ logSecurityEvent: mocks.logSecurityEvent }));

import { revokeSettingsSessionAction } from "./actions";

describe("settings session revoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticatedUser = { authUserId: "user-a", owner: { isDemo: false }, session: { id: "session-a" } };
    mocks.getSessionToken.mockImplementation(async (authUserId: string, sessionId: string) => (
      authUserId === "user-a" && sessionId === "session-b" ? "token-b" : null
    ));
    mocks.revokeSession.mockResolvedValue(undefined);
  });

  it("does not revoke a session that does not belong to the authenticated user", async () => {
    await expect(revokeSettingsSessionAction("session-other")).resolves.toEqual({
      ok: false,
      current: false,
      message: "That session is no longer available.",
    });
    expect(mocks.getSessionToken).toHaveBeenCalledWith("user-a", "session-other");
    expect(mocks.revokeSession).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("revokes an owned session through Better Auth", async () => {
    await expect(revokeSettingsSessionAction("session-b")).resolves.toEqual({
      ok: true,
      current: false,
    });
    expect(mocks.getSessionToken).toHaveBeenCalledWith("user-a", "session-b");
    expect(mocks.revokeSession).toHaveBeenCalledWith({ body: { token: "token-b" }, headers: expect.any(Headers) });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("rejects demo session revocation before any session lookup or Better Auth call", async () => {
    mocks.authenticatedUser = { authUserId: "user-a", owner: { isDemo: true }, session: { id: "session-a" } };
    await expect(revokeSettingsSessionAction("session-b")).resolves.toEqual({
      ok: false,
      current: false,
      message: "This workspace is read-only.",
    });
    expect(mocks.getSessionToken).not.toHaveBeenCalled();
    expect(mocks.revokeSession).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("logs only the allowlisted security event when revocation fails", async () => {
    mocks.revokeSession.mockRejectedValue(new TypeError("network unavailable"));
    await expect(revokeSettingsSessionAction("session-b")).resolves.toEqual({
      ok: false,
      current: false,
      message: "We couldn't revoke that session. Please try again.",
    });
    expect(mocks.logSecurityEvent).toHaveBeenCalledWith({
      event: "settings_session_revoke_failed",
      component: "settings",
      operation: "revoke-session",
      error: expect.any(TypeError),
    });
  });
  it("invokes the owner database boundary with two-factor disabled", async () => {
    await revokeSettingsSessionAction("session-b");
    expect(mocks.withAuthenticatedDatabase).toHaveBeenCalledWith(expect.any(Function), { requireTwoFactor: false });
  });

  it("logs a failed revocation without session identifiers or tokens", async () => {
    mocks.revokeSession.mockRejectedValue(new TypeError("network unavailable"));
    await revokeSettingsSessionAction("session-b");
    const call = mocks.logSecurityEvent.mock.calls[0]?.[0];
    expect(call).toEqual(expect.objectContaining({
      event: "settings_session_revoke_failed",
      component: "settings",
      operation: "revoke-session",
      error: expect.any(TypeError),
    }));
    expect(call).not.toHaveProperty("sessionId");
    expect(call).not.toHaveProperty("token");
    expect(call).not.toHaveProperty("ip");
    expect(call).not.toHaveProperty("userAgent");
  });
});
