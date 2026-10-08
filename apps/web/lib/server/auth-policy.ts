import "./server-only";

export const AUTH_RATE_LIMIT_POLICY = {
  default: { windowSeconds: 60, max: 100 },
  login: {
    client: { windowSeconds: 60, max: 5 },
    global: { windowSeconds: 60, max: 120 },
  },
  recovery: {
    client: { windowSeconds: 300, max: 5 },
    global: { windowSeconds: 300, max: 60 },
  },
} as const;

export const READ_ONLY_WORKSPACE_ERROR_CODE = "READ_ONLY_WORKSPACE" as const;
export const READ_ONLY_WORKSPACE_ERROR_MESSAGE = "This workspace is read-only." as const;

/**
 * Better Auth endpoints that can mutate a demo user's identity, credentials,
 * linked accounts, two-factor enrollment, or session, or expose session or
 * TOTP material that the demo privacy contract withholds. Sign-out is
 * intentionally absent so a shared demo session can still be closed normally.
 */
export const DEMO_AUTH_MUTATION_PATHS = [
  "/change-email",
  "/change-password",
  "/security",
  "/delete-user",
  "/delete-user/callback",
  "/forget-password",
  "/passkey",
  "/get-access-token",
  "/link-social",
  "/refresh-token",
  "/revoke-other-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/request-password-reset",
  "/reset-password",
  "/send-verification-email",
  "/set-password",
  "/list-sessions",
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
] as const;

/**
 * Better Auth read endpoints that return raw session or linked-account
 * material the demo privacy contract withholds. Blocked for demo owners on
 * HTTP requests only, so trusted server-side `auth.api` calls (for example
 * `getSession` while loading a page) keep working.
 */
export const DEMO_AUTH_HTTP_READ_PATHS = [
  "/get-session",
  "/list-accounts",
] as const;

export class ReadOnlyWorkspaceError extends Error {
  constructor() {
    super(READ_ONLY_WORKSPACE_ERROR_MESSAGE);
    this.name = "ReadOnlyWorkspaceError";
  }
}

type DemoOwnerMetadata = {
  readonly isDemo?: unknown;
  readonly demoFixtureVersion?: unknown;
};

export function isDemoOwner(owner: unknown): owner is DemoOwnerMetadata & { readonly isDemo: true } {
  return typeof owner === "object" && owner !== null && (owner as DemoOwnerMetadata).isDemo === true;
}

export function readDemoFixtureVersion(owner: unknown): number | null {
  if (!isDemoOwner(owner)) return null;
  const version = owner.demoFixtureVersion;
  return typeof version === "number" && Number.isInteger(version) && version > 0 ? version : null;
}

function normalizeAuthPath(pathname: string): string {
  const authPath = pathname.replace(/^\/api\/auth(?=\/|$)/, "") || "/";
  return authPath.length > 1 ? authPath.replace(/\/$/, "") : authPath;
}

export function isDemoAuthMutationPath(pathname: string): boolean {
  const authPath = normalizeAuthPath(pathname);
  return DEMO_AUTH_MUTATION_PATHS.some((path) => authPath === path || authPath.startsWith(`${path}/`));
}

export function isDemoAuthHttpReadPath(pathname: string): boolean {
  const authPath = normalizeAuthPath(pathname);
  return DEMO_AUTH_HTTP_READ_PATHS.some((path) => authPath === path || authPath.startsWith(`${path}/`));
}

export type AuthRateLimitScope = "login" | "recovery";

export function authRateLimitScope(pathname: string): AuthRateLimitScope | null {
  const authPath = pathname.replace(/^\/api\/auth(?=\/|$)/, "") || "/";
  if (authPath === "/sign-in/email" || authPath.startsWith("/sign-in/")) return "login";
  if (
    authPath === "/forget-password" ||
    authPath.startsWith("/forget-password/") ||
    authPath === "/request-password-reset" ||
    authPath.startsWith("/request-password-reset/")
  ) {
    return "recovery";
  }
  return null;
}

export type ProxyPolicy =
  | { readonly type: "none" }
  | { readonly type: "allowlist"; readonly ips: readonly string[] };

export class AuthConfigurationError extends Error {
  readonly variable: string;
  constructor(variable: string) {
    super(`${variable} is missing or invalid.`);
    this.name = "AuthConfigurationError";
    this.variable = variable;
  }
}

export function parseTrustedProxyIpsPolicy(raw: string | undefined): ProxyPolicy {
  if (raw === undefined) {
    throw new AuthConfigurationError("ATHENA_AUTH_TRUSTED_PROXY_IPS");
  }
  if (raw === "none") {
    return { type: "none" };
  }
  if (raw === "") {
    throw new AuthConfigurationError("ATHENA_AUTH_TRUSTED_PROXY_IPS");
  }
  const ips: string[] = [];
  for (const segment of raw.split(",")) {
    const trimmed = segment.trim();
    if (trimmed === "") {
      throw new AuthConfigurationError("ATHENA_AUTH_TRUSTED_PROXY_IPS");
    }
    if (trimmed.toLowerCase() === "none") {
      throw new AuthConfigurationError("ATHENA_AUTH_TRUSTED_PROXY_IPS");
    }
    ips.push(trimmed);
  }
  return { type: "allowlist", ips };
}

export function validateProductionAuthConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  const betterAuthUrl = environment.BETTER_AUTH_URL?.trim();
  if (!betterAuthUrl) {
    throw new AuthConfigurationError("BETTER_AUTH_URL");
  }
  let parsed: URL;
  try {
    parsed = new URL(betterAuthUrl);
  } catch {
    throw new AuthConfigurationError("BETTER_AUTH_URL");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hostname === "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    betterAuthUrl.includes("@") ||
    betterAuthUrl.includes("?") ||
    betterAuthUrl.includes("#")
  ) {
    throw new AuthConfigurationError("BETTER_AUTH_URL");
  }

  if (environment.ATHENA_AUTH_COOKIE_SECURE !== "true") {
    throw new AuthConfigurationError("ATHENA_AUTH_COOKIE_SECURE");
  }

  parseTrustedProxyIpsPolicy(environment.ATHENA_AUTH_TRUSTED_PROXY_IPS);
  isTwoFactorRequired(environment);
}

export function authCookieSecure(environment: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return environment.ATHENA_AUTH_COOKIE_SECURE?.trim().toLowerCase() === "true";
}

export function trustedProxyIps(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  const raw = environment.ATHENA_AUTH_TRUSTED_PROXY_IPS;
  if (raw === undefined || raw === "") {
    return [];
  }
  const policy = parseTrustedProxyIpsPolicy(raw);
  return policy.type === "none" ? [] : [...policy.ips];
}

export function isTwoFactorRequired(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const raw = environment.ATHENA_AUTH_REQUIRE_2FA?.trim().toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;

  if (environment.NODE_ENV === "production") {
    throw new AuthConfigurationError("ATHENA_AUTH_REQUIRE_2FA");
  }

  return false;
}

/**
 * Passkeys are optional sign-in credentials. They are not MFA proof unless a
 * separately approved policy is enabled and the server supplies a proof tied
 * to the current session after a verified ceremony.
 */
export function isPasskeyMfaPolicyEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return environment.ATHENA_PASSKEY_MFA_ENABLED?.trim().toLowerCase() === "true"
    && environment.ATHENA_PASSKEYS_ENABLED?.trim().toLowerCase() === "true";
}

export type VerifiedPasskeyMfaProof = Readonly<{
  readonly sessionId: string;
  readonly verifiedAt: number;
}>;

export type MfaSession = Readonly<{
  readonly id: string;
  readonly twoFactorEnabled?: boolean;
}>;

export function isMfaSatisfied(
  session: MfaSession | null | undefined,
  proof: VerifiedPasskeyMfaProof | null | undefined = null,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (!session) return false;
  if (session.twoFactorEnabled === true) return true;
  if (!isPasskeyMfaPolicyEnabled(environment) || !proof) return false;
  return proof.sessionId === session.id && Number.isFinite(proof.verifiedAt) && proof.verifiedAt > 0;
}
