import { describe, expect, it } from "vitest";
import {
  AUTH_RATE_LIMIT_POLICY,
  AuthConfigurationError,
  authCookieSecure,
  authRateLimitScope,
  isDemoAuthHttpReadPath,
  isDemoAuthMutationPath,
  isMfaSatisfied,
  isDemoOwner,
  parseTrustedProxyIpsPolicy,
  readDemoFixtureVersion,
  ReadOnlyWorkspaceError,
  trustedProxyIps,
  isTwoFactorRequired,
  validateProductionAuthConfiguration,
} from "./auth-policy";

describe("authentication policy", () => {
  it("classifies only login and recovery endpoints for the shared cap", () => {
    expect(authRateLimitScope("/api/auth/sign-in/email")).toBe("login");
    expect(authRateLimitScope("/api/auth/forget-password")).toBe("recovery");
    expect(authRateLimitScope("/api/auth/request-password-reset")).toBe("recovery");
    expect(authRateLimitScope("/api/auth/sign-out")).toBeNull();
  });

  it("keeps the client and global budgets explicit", () => {
    expect(AUTH_RATE_LIMIT_POLICY.login.client).toEqual({ windowSeconds: 60, max: 5 });
    expect(AUTH_RATE_LIMIT_POLICY.login.global).toEqual({ windowSeconds: 60, max: 120 });
    expect(AUTH_RATE_LIMIT_POLICY.recovery.client).toEqual({ windowSeconds: 300, max: 5 });
    expect(AUTH_RATE_LIMIT_POLICY.recovery.global).toEqual({ windowSeconds: 300, max: 60 });
  });

  it("parses cookie and proxy settings without logging or normalizing secrets", () => {
    expect(authCookieSecure({ ATHENA_AUTH_COOKIE_SECURE: " TRUE " })).toBe(true);
    expect(authCookieSecure({ ATHENA_AUTH_COOKIE_SECURE: "false" })).toBe(false);
    expect(trustedProxyIps({ ATHENA_AUTH_TRUSTED_PROXY_IPS: " 10.0.0.2, 10.0.0.3 " })).toEqual(["10.0.0.2", "10.0.0.3"]);
  });

  it("identifies Better Auth identity and session mutations while allowing sign-out", () => {
    for (const path of [
      "/change-email",
      "/change-password",
      "/security/request-password-proof",
      "/security/request-passkey-proof",
      "/security/change-password",
      "/security/disable-two-factor",
      "/passkey/list-user-passkeys",
      "/passkey/delete-passkey",
      "/delete-user",
      "/forget-password",
      "/get-access-token",
      "/link-social",
      "/refresh-token",
      "/revoke-other-sessions",
      "/revoke-session",
      "/revoke-sessions",
      "/request-password-reset",
      "/reset-password",
      "/set-password",
      "/two-factor/disable",
      "/two-factor/enable",
      "/two-factor/generate-backup-codes",
      "/two-factor/get-totp-uri",
      "/two-factor/send-otp",
      "/two-factor/update",
      "/unlink-account",
      "/update-session",
      "/update-user",
      "/two-factor/verify-backup-code",
      "/two-factor/verify-otp",
      "/two-factor/verify-totp",
      "/verify-email",
    ]) {
      expect(isDemoAuthMutationPath(`/api/auth${path}`)).toBe(true);
    }
    expect(isDemoAuthMutationPath("/update-user/avatar")).toBe(true);
    expect(isDemoAuthMutationPath("/api/auth/sign-out")).toBe(false);
    expect(isDemoAuthMutationPath("/api/auth/sign-in/email")).toBe(false);
    expect(isDemoAuthMutationPath("/api/auth/list-sessions")).toBe(true);
    expect(isDemoAuthMutationPath("/api/auth/two-factor/get-totp-uri")).toBe(true);
    expect(isDemoAuthMutationPath("/api/auth/two-factor/verify")).toBe(false);
  });

  it("blocks demo HTTP reads of raw session and linked-account material", () => {
    expect(isDemoAuthHttpReadPath("/api/auth/get-session")).toBe(true);
    expect(isDemoAuthHttpReadPath("/api/auth/get-session/")).toBe(true);
    expect(isDemoAuthHttpReadPath("/api/auth/list-accounts")).toBe(true);
    expect(isDemoAuthHttpReadPath("/api/auth/list-sessions")).toBe(false);
    expect(isDemoAuthHttpReadPath("/api/auth/sign-in/email")).toBe(false);
  });

  it("recognizes only explicitly marked demo owners", () => {
    const demoOwner = { isDemo: true, demoFixtureVersion: 1 };
    expect(isDemoOwner(demoOwner)).toBe(true);
    expect(readDemoFixtureVersion(demoOwner)).toBe(1);
    expect(isDemoOwner({ isDemo: false, demoFixtureVersion: null })).toBe(false);
    expect(readDemoFixtureVersion({ isDemo: true, demoFixtureVersion: 0 })).toBeNull();
    expect(new ReadOnlyWorkspaceError().message).toBe("This workspace is read-only.");
  });
});

describe("production auth configuration", () => {
  const validEnvironment = {
    BETTER_AUTH_URL: "https://auth.example.test:8443",
    ATHENA_AUTH_COOKIE_SECURE: "true",
    ATHENA_AUTH_TRUSTED_PROXY_IPS: "10.0.0.2, 10.0.0.3",
  };

  function expectInvalid(
    env: Record<string, string | undefined>,
    variable: string,
    secretValue?: string,
  ) {
    let thrown: unknown;
    try {
      validateProductionAuthConfiguration(env);
      throw new Error("expected validation to throw");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AuthConfigurationError);
    const configurationError = thrown as AuthConfigurationError;
    expect(configurationError.variable).toBe(variable);
    expect(configurationError.message).toMatch(/^[^\s]+ is missing or invalid\.$/);
    if (secretValue) {
      expect(configurationError.message).not.toContain(secretValue);
    }
  }

  it("accepts a valid HTTPS, cookie-secure, allowlist configuration", () => {
    expect(() => validateProductionAuthConfiguration(validEnvironment)).not.toThrow();
  });

  it("rejects a missing BETTER_AUTH_URL", () => {
    expectInvalid({ ...validEnvironment, BETTER_AUTH_URL: undefined }, "BETTER_AUTH_URL");
  });

  it("rejects an HTTP BETTER_AUTH_URL without exposing the value", () => {
    expectInvalid(
      { ...validEnvironment, BETTER_AUTH_URL: "http://auth.example.test:8443" },
      "BETTER_AUTH_URL",
      "http://auth.example.test:8443",
    );
  });

  it("rejects a missing cookie secure flag", () => {
    expectInvalid({ ...validEnvironment, ATHENA_AUTH_COOKIE_SECURE: undefined }, "ATHENA_AUTH_COOKIE_SECURE");
  });

  it("rejects a non-exact true cookie secure flag", () => {
    expectInvalid({ ...validEnvironment, ATHENA_AUTH_COOKIE_SECURE: " TRUE " }, "ATHENA_AUTH_COOKIE_SECURE");
  });

  it("rejects a blank proxy policy", () => {
    expectInvalid({ ...validEnvironment, ATHENA_AUTH_TRUSTED_PROXY_IPS: "" }, "ATHENA_AUTH_TRUSTED_PROXY_IPS");
  });

  it("rejects a malformed proxy policy", () => {
    expectInvalid({ ...validEnvironment, ATHENA_AUTH_TRUSTED_PROXY_IPS: "10.0.0.2, " }, "ATHENA_AUTH_TRUSTED_PROXY_IPS");
    expect(() => parseTrustedProxyIpsPolicy("10.0.0.2,")).toThrow(AuthConfigurationError);
  });

  it('accepts "none" as an explicit no-proxy policy', () => {
    expect(() => validateProductionAuthConfiguration({ ...validEnvironment, ATHENA_AUTH_TRUSTED_PROXY_IPS: "none" })).not.toThrow();
    expect(parseTrustedProxyIpsPolicy("none")).toEqual({ type: "none" });
  });

  it("accepts a valid allowlist of trusted proxy IPs", () => {
    const allowlist = { ...validEnvironment, ATHENA_AUTH_TRUSTED_PROXY_IPS: "172.30.0.2, 10.0.0.2" };
    expect(() => validateProductionAuthConfiguration(allowlist)).not.toThrow();
    expect(parseTrustedProxyIpsPolicy("172.30.0.2, 10.0.0.2")).toEqual({
      type: "allowlist",
      ips: ["172.30.0.2", "10.0.0.2"],
    });
  });

  it("rejects non-literal none and mixed none in a proxy allowlist", () => {
    const badPolicies = [
      "NONE",
      "None",
      "none ",
      "NONE, 10.0.0.2",
      "10.0.0.2, none",
      "10.0.0.2, none, 10.0.0.3",
    ];
    for (const raw of badPolicies) {
      expect(() => parseTrustedProxyIpsPolicy(raw)).toThrow(AuthConfigurationError);
      expect(() =>
        validateProductionAuthConfiguration({
          ...validEnvironment,
          ATHENA_AUTH_TRUSTED_PROXY_IPS: raw,
        }),
      ).toThrow(AuthConfigurationError);
    }
  });
});
describe("two-factor requirement", () => {
  it("accepts explicit true and false values", () => {
    expect(isTwoFactorRequired({ ATHENA_AUTH_REQUIRE_2FA: "true" })).toBe(true);
    expect(isTwoFactorRequired({ ATHENA_AUTH_REQUIRE_2FA: "TRUE" })).toBe(true);
    expect(isTwoFactorRequired({ ATHENA_AUTH_REQUIRE_2FA: "  True  " })).toBe(true);
    expect(isTwoFactorRequired({ ATHENA_AUTH_REQUIRE_2FA: "false" })).toBe(false);
    expect(isTwoFactorRequired({ ATHENA_AUTH_REQUIRE_2FA: "FALSE" })).toBe(false);
    expect(isTwoFactorRequired({ ATHENA_AUTH_REQUIRE_2FA: "  False  " })).toBe(false);
  });

  it("defaults to false when the variable is missing in non-production", () => {
    expect(isTwoFactorRequired({ NODE_ENV: "development" })).toBe(false);
    expect(isTwoFactorRequired({ NODE_ENV: "test" })).toBe(false);
    expect(isTwoFactorRequired({ NODE_ENV: undefined as unknown as string })).toBe(false);
  });

  it("throws an AuthConfigurationError in production when the value is missing, blank, or invalid", () => {
    for (const env of [
      { NODE_ENV: "production" },
      { NODE_ENV: "production", ATHENA_AUTH_REQUIRE_2FA: "" },
      { NODE_ENV: "production", ATHENA_AUTH_REQUIRE_2FA: "   " },
      { NODE_ENV: "production", ATHENA_AUTH_REQUIRE_2FA: "yes" },
      { NODE_ENV: "production", ATHENA_AUTH_REQUIRE_2FA: "1" },
    ]) {
      expect(() => isTwoFactorRequired(env)).toThrow(AuthConfigurationError);
    }
  });

  it("reports the offending variable without exposing the value", () => {
    let thrown: unknown;
    try {
      isTwoFactorRequired({ NODE_ENV: "production", ATHENA_AUTH_REQUIRE_2FA: " super-secret " });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AuthConfigurationError);
    expect((thrown as AuthConfigurationError).variable).toBe("ATHENA_AUTH_REQUIRE_2FA");
    expect((thrown as AuthConfigurationError).message).not.toContain("super-secret");
  });
});
describe("passkey MFA policy", () => {
  it("does not treat a registered passkey as MFA by default", () => {
    expect(isMfaSatisfied({ id: "session-a", twoFactorEnabled: false }, null, { ATHENA_PASSKEYS_ENABLED: "true", ATHENA_PASSKEY_MFA_ENABLED: "false" })).toBe(false);
  });

  it("requires the separately enabled policy and current-session proof", () => {
    const environment = { ATHENA_PASSKEYS_ENABLED: "true", ATHENA_PASSKEY_MFA_ENABLED: "true" };
    expect(isMfaSatisfied({ id: "session-a", twoFactorEnabled: false }, { sessionId: "session-b", verifiedAt: Date.now() }, environment)).toBe(false);
    expect(isMfaSatisfied({ id: "session-a", twoFactorEnabled: false }, { sessionId: "session-a", verifiedAt: Date.now() }, environment)).toBe(true);
  });
});
