import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PASSWORD_POLICY_ERROR } from "../password-policy";
const mutableProcessEnv = process.env as Record<string, string | undefined>;
const environment = vi.hoisted(() => {
  const env = process.env as Record<string, string | undefined>;
  const original = {
    secret: process.env.BETTER_AUTH_SECRET,
    nodeEnv: env.NODE_ENV,
    nextPhase: process.env.NEXT_PHASE,
    authUrl: process.env.BETTER_AUTH_URL,
    passkeysEnabled: process.env.ATHENA_PASSKEYS_ENABLED,
  };
  process.env.BETTER_AUTH_SECRET = "test-only-auth-config-secret";
  process.env.BETTER_AUTH_URL = "https://auth.example.test:8443";
  delete process.env.ATHENA_PASSKEYS_ENABLED;
  env.NODE_ENV = "production";
  process.env.NEXT_PHASE = "";
  return original;
});

const mocks = vi.hoisted(() => ({
  betterAuth: vi.fn((config: unknown) => ({ config })),
  apiErrorFrom: vi.fn((_status: string, error: { readonly code: string; readonly message: string }) => {
    const result = new Error(error.message) as Error & { readonly code?: string };
    Object.defineProperty(result, "code", { value: error.code, enumerable: true });
    return result;
  }),
  createAuthMiddleware: vi.fn((handler: unknown) => handler),
  createAuthEndpoint: vi.fn((path: string, options: unknown, handler: unknown) => ({ path, options, handler })),
  sensitiveSessionMiddleware: vi.fn(),
  getAuthoritativeSessionFromCtx: vi.fn(),
  drizzleAdapter: vi.fn(() => "drizzle-adapter"),
  twoFactor: vi.fn(() => "two-factor"),
  haveIBeenPwned: vi.fn(() => "have-i-been-pwned"),
  nextCookies: vi.fn(() => "next-cookies"),
  getServerDatabase: vi.fn(() => ({ name: "app-db" })),
  getAuthDatabase: vi.fn(() => ({ name: "auth-db" })),
  passkey: vi.fn(() => "passkey"),
  getOwnerByAuthUserId: vi.fn(),
  markPasswordChanged: vi.fn(),
  createNotificationRepository: vi.fn(() => ({ hasRecentNotification: vi.fn(async () => false), createOwnerNotification: vi.fn(async () => undefined) })),
  writeAuthSecurityEvent: vi.fn(),
  authCookieSecure: vi.fn(() => true),
  trustedProxyIps: vi.fn(() => ["10.0.0.2"]),
  trustedOrigins: vi.fn(() => ["http://vault.example.test"]),
  isDemoAuthHttpReadPath: vi.fn((path: string) => ["/get-session", "/list-accounts"].includes(path)),
  isDemoAuthMutationPath: vi.fn((path: string) => ["/change-password", "/update-user", "/delete-user", "/revoke-other-sessions", "/revoke-session", "/get-access-token"].includes(path)),
  isDemoOwner: vi.fn((owner: unknown) => typeof owner === "object" && owner !== null && (owner as { readonly isDemo?: unknown }).isDemo === true),
  validateProductionAuthConfiguration: vi.fn(),
  withAuthUserContext: vi.fn(async (_database: unknown, _authUserId: string, callback: (database: unknown) => unknown) => callback({ name: "app-db" })),
}));

vi.mock("better-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("better-auth")>()),
  betterAuth: mocks.betterAuth,
}));
vi.mock("better-auth/api", () => ({
  APIError: { from: mocks.apiErrorFrom },
  createAuthEndpoint: mocks.createAuthEndpoint,
  createAuthMiddleware: mocks.createAuthMiddleware,
  getAuthoritativeSessionFromCtx: mocks.getAuthoritativeSessionFromCtx,
  sensitiveSessionMiddleware: mocks.sensitiveSessionMiddleware,
}));
vi.mock("@better-auth/drizzle-adapter", () => ({ drizzleAdapter: mocks.drizzleAdapter }));
vi.mock("@better-auth/passkey", () => ({ passkey: mocks.passkey }));
vi.mock("better-auth/plugins", () => ({ haveIBeenPwned: mocks.haveIBeenPwned, twoFactor: mocks.twoFactor }));
vi.mock("better-auth/next-js", () => ({ nextCookies: mocks.nextCookies }));
vi.mock("./database", () => ({ getServerDatabase: mocks.getServerDatabase, getAuthDatabase: mocks.getAuthDatabase }));
vi.mock("./auth-policy", () => ({
  AUTH_RATE_LIMIT_POLICY: {
    default: { windowSeconds: 60, max: 10 },
    login: { client: { windowSeconds: 60, max: 5 }, global: { windowSeconds: 60, max: 120 } },
    recovery: { client: { windowSeconds: 300, max: 5 }, global: { windowSeconds: 300, max: 60 } },
  },
  authCookieSecure: mocks.authCookieSecure,
  trustedProxyIps: mocks.trustedProxyIps,
  isDemoAuthHttpReadPath: mocks.isDemoAuthHttpReadPath,
  isDemoAuthMutationPath: mocks.isDemoAuthMutationPath,
  isDemoOwner: mocks.isDemoOwner,
  READ_ONLY_WORKSPACE_ERROR_CODE: "READ_ONLY_WORKSPACE",
  READ_ONLY_WORKSPACE_ERROR_MESSAGE: "This workspace is read-only.",
  validateProductionAuthConfiguration: mocks.validateProductionAuthConfiguration,
}));
vi.mock("./request-security", () => ({ trustedOrigins: mocks.trustedOrigins }));
vi.mock("@athena/database", () => ({
  authUsers: "auth-users-table",
  authSessions: "auth-sessions-table",
  authAccounts: "auth-accounts-table",
  authVerifications: "auth-verifications-table",
  authRateLimits: "auth-rate-limits-table",
  authTwoFactors: "auth-two-factors-table",
  authPasskeys: "auth-passkeys-table",
  and: vi.fn((...parts: unknown[]) => parts),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  withAuthUserContext: mocks.withAuthUserContext,
  createAuthenticationRepository: vi.fn(() => ({ getOwnerByAuthUserId: mocks.getOwnerByAuthUserId, markPasswordChanged: mocks.markPasswordChanged })),
  createAuditRepository: vi.fn(() => ({ writeAuthSecurityEvent: mocks.writeAuthSecurityEvent })),
  createNotificationRepository: mocks.createNotificationRepository,
}));

import { auth, resetAuthSecurityEventDedupeForTests } from "./auth";

afterAll(() => {
  if (environment.secret === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = environment.secret;
  if (environment.authUrl === undefined) delete process.env.BETTER_AUTH_URL;
  else process.env.BETTER_AUTH_URL = environment.authUrl;
  if (environment.nextPhase === undefined) delete process.env.NEXT_PHASE;
  else process.env.NEXT_PHASE = environment.nextPhase;
  if (environment.nodeEnv === undefined) delete mutableProcessEnv.NODE_ENV;
  else mutableProcessEnv.NODE_ENV = environment.nodeEnv;
  if (environment.passkeysEnabled === undefined) delete process.env.ATHENA_PASSKEYS_ENABLED;
  else process.env.ATHENA_PASSKEYS_ENABLED = environment.passkeysEnabled;
});

describe("Better Auth configuration", () => {
  beforeEach(() => {
    mocks.getAuthoritativeSessionFromCtx.mockReset();
    mocks.getOwnerByAuthUserId.mockReset();
    mocks.apiErrorFrom.mockClear();
    mocks.isDemoAuthMutationPath.mockClear();
    mocks.isDemoOwner.mockClear();
  });

  it("keeps signup disabled and maps database sessions to Athena auth tables", () => {
    const config = mocks.betterAuth.mock.calls[0]?.[0] as {
      readonly database: unknown;
      readonly appName: string;
      readonly plugins: readonly unknown[];
      readonly emailAndPassword: { readonly enabled: boolean; readonly disableSignUp: boolean; readonly requireEmailVerification: boolean };
      readonly user: { readonly modelName: string };
      readonly session: { readonly modelName: string; readonly expiresIn: number; readonly updateAge: number; readonly freshAge: number };
      readonly account: { readonly modelName: string };
      readonly verification: { readonly modelName: string };
      readonly advanced: { readonly useSecureCookies: boolean; readonly ipAddress: { readonly ipAddressHeaders: readonly string[]; readonly trustedProxies: readonly string[] } };
      readonly trustedOrigins: () => readonly string[];
    };

    expect(config).toBeDefined();
    expect(config.appName).toBe("Athena Vault");
    expect(config.emailAndPassword).toEqual({ enabled: true, disableSignUp: true, requireEmailVerification: false });
    expect(config.user.modelName).toBe("auth_users");
    expect(config.session).toEqual({ modelName: "auth_sessions", expiresIn: 604_800, updateAge: 86_400, freshAge: 900 });
    expect(config.account.modelName).toBe("auth_accounts");
    expect(config.verification.modelName).toBe("auth_verifications");
    expect(config.advanced).toEqual({
      useSecureCookies: true,
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"], trustedProxies: ["10.0.0.2"] },
    });
    expect(config.trustedOrigins()).toEqual(["http://vault.example.test"]);
    expect(mocks.authCookieSecure).toHaveBeenCalled();
    expect(mocks.trustedProxyIps).toHaveBeenCalled();
    expect(config.trustedOrigins()).toEqual(["http://vault.example.test"]);
    expect(mocks.twoFactor).toHaveBeenCalledWith({ issuer: "Athena Vault" });
    expect(mocks.haveIBeenPwned).toHaveBeenCalledWith({
      enabled: true,
      customPasswordCompromisedMessage: "This password has appeared in a known data breach. Choose a different password.",
      paths: ["/sign-up/email", "/change-password", "/security/change-password", "/reset-password", "/email-otp/reset-password", "/phone-number/reset-password", "/admin/create-user", "/admin/set-user-password"],
    });
    expect(config.plugins.slice(0, 2)).toEqual(["two-factor", "have-i-been-pwned"]);
    expect(config.plugins[2]).toMatchObject({ id: "athena-security-reauthentication" });
    expect(config.plugins[3]).toMatchObject({ id: "athena-auth-security-lifecycle" });
    expect(config.plugins[4]).toBe("next-cookies");

    expect(auth).toBeDefined();
  });

  it("passes the pinned adapter schema and database-backed rate-limit contract", () => {
    expect(mocks.drizzleAdapter).toHaveBeenCalledWith({ name: "auth-db" }, expect.objectContaining({
      provider: "pg",
      schema: expect.objectContaining({
        auth_users: "auth-users-table",
        auth_sessions: "auth-sessions-table",
        auth_accounts: "auth-accounts-table",
        auth_verifications: "auth-verifications-table",
        auth_rate_limits: "auth-rate-limits-table",
        twoFactor: "auth-two-factors-table",
      }),
    }));
    const config = mocks.betterAuth.mock.calls[0]?.[0] as { readonly rateLimit: { readonly enabled: boolean; readonly storage: string; readonly modelName: string } };
    expect(config.rateLimit).toMatchObject({ enabled: true, storage: "database", modelName: "auth_rate_limits" });
  });

  it("maps the enabled passkey model to the Drizzle table", async () => {
    const previousPasskeysEnabled = process.env.ATHENA_PASSKEYS_ENABLED;
    process.env.ATHENA_PASSKEYS_ENABLED = "true";
    try {
      mocks.validateProductionAuthConfiguration.mockClear();
      vi.resetModules();
      await import("./auth");
      const latestAdapterCall = mocks.drizzleAdapter.mock.calls.at(-1) as readonly [unknown, unknown] | undefined;
      expect(latestAdapterCall?.[1]).toEqual(expect.objectContaining({
        schema: expect.objectContaining({ passkey: "auth-passkeys-table" }),
      }));
    } finally {
      if (previousPasskeysEnabled === undefined) delete process.env.ATHENA_PASSKEYS_ENABLED;
      else process.env.ATHENA_PASSKEYS_ENABLED = previousPasskeysEnabled;
    }
  });

  it("blocks demo identity and session mutations before Better Auth writes", async () => {
    mocks.getAuthoritativeSessionFromCtx.mockResolvedValue({ session: { createdAt: new Date(), token: "demo-session" }, user: { id: "demo-auth", twoFactorEnabled: false } });
    mocks.getOwnerByAuthUserId.mockResolvedValue({ id: "demo-owner", isDemo: true, demoFixtureVersion: 1 });
    const config = mocks.betterAuth.mock.calls[0]?.[0] as { readonly hooks: { readonly before: (context: { readonly path: string }) => Promise<unknown> } };

    for (const path of ["/change-password", "/update-user", "/delete-user", "/revoke-other-sessions"]) {
      await expect(config.hooks.before({ path })).rejects.toMatchObject({
        code: "READ_ONLY_WORKSPACE",
        message: "This workspace is read-only.",
      });
    }
    expect(mocks.apiErrorFrom).toHaveBeenCalledWith("FORBIDDEN", {
      code: "READ_ONLY_WORKSPACE",
      message: "This workspace is read-only.",
    });
    expect(mocks.getOwnerByAuthUserId).toHaveBeenCalledTimes(4);
    expect(mocks.getOwnerByAuthUserId).toHaveBeenCalledWith("demo-auth");
  });

  it("does not block sign-out or normal authenticated users", async () => {
    mocks.getAuthoritativeSessionFromCtx.mockResolvedValue({ session: { createdAt: new Date(), token: "normal-session" }, user: { id: "normal-auth", twoFactorEnabled: false } });
    mocks.getOwnerByAuthUserId.mockResolvedValue({ id: "normal-owner", isDemo: false, demoFixtureVersion: null });
    const config = mocks.betterAuth.mock.calls[0]?.[0] as { readonly hooks: { readonly before: (context: { readonly path: string }) => Promise<unknown> } };

    await expect(config.hooks.before({ path: "/sign-out" })).resolves.toBeUndefined();
    await expect(config.hooks.before({ path: "/change-password" })).resolves.toBeUndefined();
    expect(mocks.apiErrorFrom).not.toHaveBeenCalled();
  });

  it("requires step-up verification for sensitive security mutations", async () => {
    const config = mocks.betterAuth.mock.calls[0]?.[0] as { readonly hooks: { readonly before: (context: unknown) => Promise<unknown> }; readonly plugins: readonly unknown[] };
    const securityContext = (path: string) => ({
      path,
      context: {
        createAuthCookie: vi.fn((name: string) => ({ name, attributes: {} })),
        secret: "test-only-secret",
      },
      getSignedCookie: vi.fn(async () => null),
    });
    mocks.getOwnerByAuthUserId.mockResolvedValue({ id: "normal-owner", isDemo: false, demoFixtureVersion: null });
    mocks.getAuthoritativeSessionFromCtx.mockResolvedValue({
      session: { createdAt: new Date(), token: "normal-session" },
      user: { id: "normal-auth", twoFactorEnabled: true },
    });

    await expect(config.hooks.before(securityContext("/change-password"))).rejects.toMatchObject({ code: "SECURITY_STEP_UP_REQUIRED" });
    await expect(config.hooks.before(securityContext("/two-factor/disable"))).rejects.toMatchObject({ code: "SECURITY_STEP_UP_REQUIRED" });

    mocks.getAuthoritativeSessionFromCtx.mockResolvedValue({
      session: { createdAt: new Date(Date.now() - 16 * 60 * 1000), token: "stale-session" },
      user: { id: "normal-auth", twoFactorEnabled: false },
    });
    await expect(config.hooks.before(securityContext("/passkey/delete-passkey"))).rejects.toMatchObject({ code: "SESSION_NOT_FRESH" });

    const securityPlugin = config.plugins.find((plugin) => typeof plugin === "object" && plugin !== null && (plugin as { readonly id?: unknown }).id === "athena-security-reauthentication") as { readonly endpoints?: Record<string, unknown> } | undefined;
    expect(Object.keys(securityPlugin?.endpoints ?? {})).toEqual([
      "requestPasswordSecurityProof",
      "requestPasskeySecurityProof",
      "changePasswordWithPasskey",
      "disableTwoFactorWithProof",
    ]);
  });

  it("invokes the production auth configuration validator during import in production", () => {
    expect(mocks.validateProductionAuthConfiguration).toHaveBeenCalledTimes(1);
    expect(mocks.validateProductionAuthConfiguration).toHaveBeenLastCalledWith(process.env);
  });

  it("preserves the existing Better Auth baseURL from the environment", () => {
    const config = mocks.betterAuth.mock.calls[0]?.[0] as { readonly baseURL: string };
    expect(config.baseURL).toBe("https://auth.example.test:8443");
  });

  it("does not invoke the production validator in non-production", async () => {
    mocks.validateProductionAuthConfiguration.mockClear();
    mutableProcessEnv.NODE_ENV = "test";
    process.env.NEXT_PHASE = "";
    vi.resetModules();
    await import("./auth"); // Intentionally reload auth.ts after vi.resetModules() to exercise the top-level production-validator guard.
    expect(mocks.validateProductionAuthConfiguration).not.toHaveBeenCalled();
    mutableProcessEnv.NODE_ENV = "production";
  });

  it("does not invoke the production validator during the production build phase", async () => {
    mocks.validateProductionAuthConfiguration.mockClear();
    mutableProcessEnv.NODE_ENV = "production";
    process.env.NEXT_PHASE = "phase-production-build";
    vi.resetModules();
    await import("./auth"); // Intentionally reload auth.ts after vi.resetModules() to exercise the top-level build-sentinel bypass.
    expect(mocks.validateProductionAuthConfiguration).not.toHaveBeenCalled();
    process.env.NEXT_PHASE = "";
  });
});
describe("Better Auth security lifecycle", () => {
  type LifecycleTestContext = {
    readonly path: string;
    readonly body?: unknown;
    readonly request?: unknown;
    readonly context: {
      readonly session?: { readonly session?: { readonly token?: unknown }; readonly user: { readonly id: string } };
      readonly newSession?: { readonly session?: { readonly token?: unknown }; readonly user: { readonly id: string; readonly twoFactorEnabled?: boolean } } | null;
      readonly returned?: unknown;
    };
  };
  type LifecycleHook = (context: LifecycleTestContext) => Promise<unknown>;
  type LifecyclePlugin = {
    readonly id?: string;
    readonly hooks?: {
      readonly after?: readonly {
        readonly matcher: (context: LifecycleTestContext) => boolean;
        readonly handler: LifecycleHook;
      }[];
    };
  };
  const config = (auth as unknown as {
    readonly config: {
      readonly hooks: {
        readonly before: LifecycleHook;
        readonly after: LifecycleHook;
      };
      readonly plugins: readonly LifecyclePlugin[];
    };
  }).config;
  const lifecycleHook = config.plugins.find((plugin) => plugin.id === "athena-auth-security-lifecycle")?.hooks?.after?.find((hook) =>
    hook.matcher({ path: "/sign-in/email", context: {} }),
  );
  function requireLifecycleHook(): NonNullable<typeof lifecycleHook> {
    if (!lifecycleHook) throw new Error("Auth lifecycle plugin hook is not configured.");
    return lifecycleHook;
  }


  beforeEach(() => {
    resetAuthSecurityEventDedupeForTests();
    mocks.getOwnerByAuthUserId.mockReset();
    mocks.markPasswordChanged.mockReset();
    mocks.writeAuthSecurityEvent.mockReset();
    mocks.getAuthoritativeSessionFromCtx.mockReset();
    mocks.getAuthoritativeSessionFromCtx.mockResolvedValue(null);
  });

  it.each([
    ["/sign-out", "session-revoke"],
    ["/change-password", "password-change"],
    ["/two-factor/verify-totp", "two-factor-enable"],
    ["/two-factor/disable", "two-factor-disable"],
    ["/two-factor/generate-backup-codes", "backup-codes-regenerate"],
    ["/revoke-sessions", "session-revoke"],
  ])("writes an owner-scoped security event for %s", async (path, operation) => {
    const session = { user: { id: "auth-user" } };
    mocks.getOwnerByAuthUserId.mockResolvedValue({ id: "owner-id", isDemo: false });

    await config.hooks.after({ path, context: { session } });

    expect(mocks.getOwnerByAuthUserId).toHaveBeenCalledWith("auth-user");
    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledWith("owner-id", "owner-id", { operation, status: "success" });
  });
  it("audits completed normal and trusted-device sign-ins after the two-factor hook", async () => {
    const signInHook = requireLifecycleHook();
    expect(signInHook.matcher({ path: "/sign-in/email", context: {} })).toBe(true);
    mocks.getOwnerByAuthUserId.mockResolvedValue({ id: "owner-id", isDemo: false });

    await signInHook.handler({
      path: "/sign-in/email",
      context: {
        newSession: { session: { token: "session-normal" }, user: { id: "auth-user", twoFactorEnabled: false } },
        returned: { user: { id: "auth-user" } },
      },
    });
    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledWith("owner-id", "owner-id", { operation: "session-create", status: "success" });

    mocks.getOwnerByAuthUserId.mockClear();
    mocks.writeAuthSecurityEvent.mockClear();
    await signInHook.handler({
      path: "/sign-in/email",
      context: { newSession: { session: { token: "session-trusted" }, user: { id: "auth-user", twoFactorEnabled: true } } },
    });
    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledWith("owner-id", "owner-id", { operation: "session-create", status: "success" });

    mocks.getOwnerByAuthUserId.mockClear();
    mocks.writeAuthSecurityEvent.mockClear();
    mocks.getAuthoritativeSessionFromCtx.mockResolvedValue({ user: { id: "old-user" } });
    await signInHook.handler({
      path: "/sign-in/email",
      context: { newSession: null, returned: { twoFactorRedirect: true } },
    });
    expect(mocks.getOwnerByAuthUserId).not.toHaveBeenCalled();
    expect(mocks.writeAuthSecurityEvent).not.toHaveBeenCalled();
    expect(mocks.getAuthoritativeSessionFromCtx).not.toHaveBeenCalled();
  });

  it("uses response identities for final two-factor verification sign-in events", async () => {
    mocks.getOwnerByAuthUserId.mockResolvedValue({ id: "owner-id", isDemo: false });

    await config.hooks.after({
      path: "/two-factor/verify-totp",
      context: { returned: { token: "totp-session", user: { id: "auth-user" } } },
    });
    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledWith("owner-id", "owner-id", { operation: "session-create", status: "success" });

    mocks.writeAuthSecurityEvent.mockClear();
    await config.hooks.after({
      path: "/two-factor/verify-backup-code",
      context: { returned: { token: "backup-session", user: { id: "auth-user" } } },
    });
    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledWith("owner-id", "owner-id", { operation: "session-create", status: "success" });
  });


  it("marks the password changed for the authenticated user", async () => {
    mocks.getOwnerByAuthUserId.mockResolvedValue({ id: "owner-id", isDemo: false });

    await config.hooks.after({ path: "/change-password", context: { session: { user: { id: "auth-user" } } } });

    expect(mocks.markPasswordChanged).toHaveBeenCalledWith("auth-user");
  });
  it("captures the sign-out identity before Better Auth deletes the current session", async () => {
    const context = { path: "/sign-out", context: {} };
    mocks.getAuthoritativeSessionFromCtx.mockResolvedValue({ user: { id: "auth-user" } });
    mocks.getOwnerByAuthUserId.mockResolvedValue({ id: "owner-id", isDemo: false });

    await config.hooks.before(context);
    await config.hooks.after(context);

    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledWith("owner-id", "owner-id", { operation: "session-revoke", status: "success" });
  });

  it("enforces the password policy on Better Auth password endpoints before any mutation", async () => {
    await expect(config.hooks.before({
      path: "/change-password",
      context: {},
      body: { newPassword: "short1" },
    })).rejects.toThrow(PASSWORD_POLICY_ERROR);
    await config.hooks.before({ path: "/change-password", context: {}, body: { newPassword: "correct horse battery staple 1" } });
    await config.hooks.before({ path: "/sign-in/email", context: {}, body: { password: "weak" } });
    await config.hooks.before({ path: "/reset-password", context: {}, body: {} });
    expect(mocks.getOwnerByAuthUserId).not.toHaveBeenCalled();
  });

  it("blocks demo HTTP session reads while keeping internal auth.api getSession usable", async () => {
    mocks.getAuthoritativeSessionFromCtx.mockResolvedValue({ user: { id: "auth-user" } });
    mocks.getOwnerByAuthUserId.mockResolvedValue({ id: "demo-owner", isDemo: true });

    await expect(config.hooks.before({
      path: "/get-session",
      context: {},
      request: new Request("https://vault.example.test/api/auth/get-session"),
    })).rejects.toThrow("This workspace is read-only.");
    expect(mocks.getOwnerByAuthUserId).toHaveBeenCalledWith("auth-user");

    mocks.getAuthoritativeSessionFromCtx.mockClear();
    mocks.getOwnerByAuthUserId.mockClear();
    await config.hooks.before({ path: "/get-session", context: {} });
    await config.hooks.before({ path: "/list-accounts", context: {} });
    expect(mocks.getAuthoritativeSessionFromCtx).not.toHaveBeenCalled();
    expect(mocks.getOwnerByAuthUserId).not.toHaveBeenCalled();
  });

  it("audits /revoke-session only when the target token belongs to the user", async () => {
    const context = { path: "/revoke-session", context: {}, body: { token: "target-token" } };
    mocks.getAuthoritativeSessionFromCtx.mockResolvedValue({ session: { token: "actor-session" }, user: { id: "auth-user" } });
    mocks.getOwnerByAuthUserId.mockResolvedValue({ id: "owner-id", isDemo: false });

    mocks.withAuthUserContext.mockImplementation(async (_database: unknown, _authUserId: string, callback: (database: unknown) => unknown) => callback({
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => [{ id: "target-row" }]) })) })) })),
    }));
    await config.hooks.before(context);
    await config.hooks.after(context);
    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledWith("owner-id", "owner-id", { operation: "session-revoke", status: "success" });

    mocks.writeAuthSecurityEvent.mockClear();
    mocks.withAuthUserContext.mockImplementation(async (_database: unknown, _authUserId: string, callback: (database: unknown) => unknown) => callback({
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => []) })) })) })),
    }));
    await config.hooks.before(context);
    await config.hooks.after(context);
    expect(mocks.writeAuthSecurityEvent).not.toHaveBeenCalled();
  });

  it("does not audit a disableSession backup-code verification as a new session", async () => {
    mocks.getAuthoritativeSessionFromCtx.mockResolvedValue(null);

    await config.hooks.after({
      path: "/two-factor/verify-backup-code",
      context: { returned: { user: { id: "auth-user" } } },
      body: { disableSession: true },
    });

    expect(mocks.getOwnerByAuthUserId).not.toHaveBeenCalled();
    expect(mocks.writeAuthSecurityEvent).not.toHaveBeenCalled();
  });

  it("deduplicates repeated lifecycle events while keeping distinct sessions", async () => {
    mocks.getOwnerByAuthUserId.mockResolvedValue({ id: "owner-id", isDemo: false });
    const session = { session: { token: "token-a" }, user: { id: "auth-user" } };

    await config.hooks.after({ path: "/revoke-other-sessions", context: { session } });
    await config.hooks.after({ path: "/revoke-other-sessions", context: { session } });
    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledTimes(1);

    await config.hooks.after({ path: "/revoke-other-sessions", context: { session: { session: { token: "token-b" }, user: { id: "auth-user" } } } });
    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledTimes(2);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 61_000);
      await config.hooks.after({ path: "/revoke-other-sessions", context: { session } });
      expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["/change-password", "/two-factor/disable", "/two-factor/verify-totp"])("does not record failed lifecycle response for %s", async (path) => {
    mocks.getOwnerByAuthUserId.mockResolvedValue({ id: "owner-id", isDemo: false });

    await config.hooks.after({
      path,
      context: { session: { user: { id: "auth-user" } }, returned: { statusCode: 400 } },
    });

    expect(mocks.getOwnerByAuthUserId).not.toHaveBeenCalled();
    expect(mocks.markPasswordChanged).not.toHaveBeenCalled();
    expect(mocks.writeAuthSecurityEvent).not.toHaveBeenCalled();
  });


  it("skips the audit for demo owners", async () => {
    mocks.getOwnerByAuthUserId.mockResolvedValue({ id: "demo-owner", isDemo: true });

    await config.hooks.after({ path: "/change-password", context: { session: { user: { id: "auth-user" } } } });

    expect(mocks.markPasswordChanged).not.toHaveBeenCalled();
    expect(mocks.writeAuthSecurityEvent).not.toHaveBeenCalled();
  });

  it("skips the audit for unauthenticated or unresolved sessions", async () => {
    await config.hooks.after({ path: "/two-factor/verify-totp", context: {} });
    await config.hooks.after({ path: "/two-factor/verify-totp", context: { session: undefined } });

    expect(mocks.getOwnerByAuthUserId).not.toHaveBeenCalled();
    expect(mocks.writeAuthSecurityEvent).not.toHaveBeenCalled();
  });

  it("resolves the authoritative session for endpoints that do not set context.session", async () => {
    mocks.getAuthoritativeSessionFromCtx.mockResolvedValue({ session: { token: "auth-session" }, user: { id: "auth-user" } });
    mocks.getOwnerByAuthUserId.mockResolvedValue({ id: "owner-id", isDemo: false });

    await config.hooks.after({ path: "/two-factor/verify-totp", context: {} });

    expect(mocks.getAuthoritativeSessionFromCtx).toHaveBeenCalled();
    expect(mocks.getOwnerByAuthUserId).toHaveBeenCalledWith("auth-user");
    expect(mocks.writeAuthSecurityEvent).toHaveBeenCalledWith("owner-id", "owner-id", { operation: "session-create", status: "success" });
  });

  it("ignores lifecycle events for paths outside the allowlist", async () => {
    await config.hooks.after({ path: "/unknown-endpoint", context: { session: { user: { id: "auth-user" } } } });

    expect(mocks.getOwnerByAuthUserId).not.toHaveBeenCalled();
    expect(mocks.writeAuthSecurityEvent).not.toHaveBeenCalled();
  });
});
