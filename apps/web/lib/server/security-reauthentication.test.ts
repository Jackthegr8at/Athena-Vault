import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const mocks = vi.hoisted(() => ({
  apiErrorFrom: vi.fn((status: string, error: { readonly code: string; readonly message: string }) => {
    const result = new Error(error.message) as Error & { readonly code?: string; readonly status?: string };
    Object.defineProperty(result, "code", { value: error.code, enumerable: true });
    Object.defineProperty(result, "status", { value: status, enumerable: true });
    return result;
  }),
  createAuthEndpoint: vi.fn((path: string, options: unknown, handler: unknown) => ({ path, options, handler })),
  getAuthoritativeSessionFromCtx: vi.fn(),
  sensitiveSessionMiddleware: vi.fn(),
  expireCookie: vi.fn(),
  setSessionCookie: vi.fn(),
}));

vi.mock("better-auth/api", () => ({
  APIError: { from: mocks.apiErrorFrom },
  createAuthEndpoint: mocks.createAuthEndpoint,
  getAuthoritativeSessionFromCtx: mocks.getAuthoritativeSessionFromCtx,
  sensitiveSessionMiddleware: mocks.sensitiveSessionMiddleware,
}));
vi.mock("better-auth/cookies", () => ({
  expireCookie: mocks.expireCookie,
  setSessionCookie: mocks.setSessionCookie,
}));

import { grantSecurityProofFromPasskey } from "./security-reauthentication";

type GrantContext = Parameters<typeof grantSecurityProofFromPasskey>[0];

type IntentPayload = {
  readonly userId: string;
  readonly operation: string;
  readonly method: string;
  readonly issuedAt: number;
  readonly nonce: string;
};

function passkeyIntent(userId: string): IntentPayload {
  return {
    userId,
    operation: "password-change",
    method: "passkey",
    issuedAt: Date.now(),
    nonce: "test-intent-nonce-0001",
  };
}

function createContext(intent: IntentPayload | null) {
  const setSignedCookie = vi.fn(async () => undefined);
  const findOne = vi.fn(async () => null as { readonly userId?: string } | null);
  const context = {
    context: {
      secret: "test-only-cookie-signing-secret",
      createAuthCookie: (name: string, options?: { readonly maxAge?: number }) => ({
        name,
        attributes: { maxAge: options?.maxAge ?? 0, httpOnly: true, path: "/" },
      }),
      adapter: { findOne },
    },
    getSignedCookie: vi.fn(async (name: string) => (name === "athena_security_intent" && intent ? JSON.stringify(intent) : null)),
    setSignedCookie,
  };
  return { context: context as unknown as GrantContext, setSignedCookie, findOne };
}

function sessionFor(userId: string) {
  return {
    session: { token: "test-session-token", createdAt: new Date() },
    user: { id: userId, twoFactorEnabled: true },
  };
}

function writtenProofs(setSignedCookie: Mock): IntentPayload[] {
  return setSignedCookie.mock.calls
    .filter((call) => call[0] === "athena_security_proof")
    .map((call) => JSON.parse(call[1] as string) as IntentPayload);
}

describe("grantSecurityProofFromPasskey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("grants no proof when the credential belongs to another user", async () => {
    const { context, setSignedCookie, findOne } = createContext(passkeyIntent("user-a"));
    mocks.getAuthoritativeSessionFromCtx.mockResolvedValue(sessionFor("user-a"));
    findOne.mockResolvedValue({ userId: "user-b" });
    await grantSecurityProofFromPasskey(context, "credential-foreign");

    expect(findOne).toHaveBeenCalledWith({
      model: "passkey",
      where: [{ field: "credentialID", value: "credential-foreign" }],
    });
    expect(writtenProofs(setSignedCookie)).toEqual([]);
    expect(mocks.expireCookie).not.toHaveBeenCalled();
  });

  it("grants no proof when no session exists", async () => {
    const { context, setSignedCookie, findOne } = createContext(passkeyIntent("user-a"));
    mocks.getAuthoritativeSessionFromCtx.mockResolvedValue(null);
    findOne.mockResolvedValue({ userId: "user-a" });

    await grantSecurityProofFromPasskey(context, "credential-a");

    expect(findOne).not.toHaveBeenCalled();
    expect(writtenProofs(setSignedCookie)).toEqual([]);
    expect(mocks.expireCookie).not.toHaveBeenCalled();
  });

  it("grants no proof when the session user differs from the intent user", async () => {
    const { context, setSignedCookie, findOne } = createContext(passkeyIntent("user-a"));
    mocks.getAuthoritativeSessionFromCtx.mockResolvedValue(sessionFor("user-b"));
    findOne.mockResolvedValue({ userId: "user-a" });

    await grantSecurityProofFromPasskey(context, "credential-a");

    expect(findOne).not.toHaveBeenCalled();
    expect(writtenProofs(setSignedCookie)).toEqual([]);
    expect(mocks.expireCookie).not.toHaveBeenCalled();
  });

  it("grants the proof and expires the intent when credential, session, and intent match", async () => {
    const { context, setSignedCookie, findOne } = createContext(passkeyIntent("user-a"));
    mocks.getAuthoritativeSessionFromCtx.mockResolvedValue(sessionFor("user-a"));
    findOne.mockResolvedValue({ userId: "user-a" });

    await grantSecurityProofFromPasskey(context, "credential-a");

    expect(findOne).toHaveBeenCalledWith({
      model: "passkey",
      where: [{ field: "credentialID", value: "credential-a" }],
    });
    const proofs = writtenProofs(setSignedCookie);
    expect(proofs).toHaveLength(1);
    expect(proofs[0]).toMatchObject({ userId: "user-a", operation: "password-change", method: "passkey" });
    expect(mocks.expireCookie).toHaveBeenCalledWith(context, expect.objectContaining({ name: "athena_security_intent" }));
  });
});
