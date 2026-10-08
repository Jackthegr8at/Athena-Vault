import "./server-only";

import { createHash } from "node:crypto";

import { betterAuth, type BetterAuthPlugin } from "better-auth";

import { APIError, createAuthMiddleware, getAuthoritativeSessionFromCtx } from "better-auth/api";
import { haveIBeenPwned, twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { nextCookies } from "better-auth/next-js";
import { and, createAuthenticationRepository, createAuditRepository, eq, withAuthUserContext, type AuthSecurityOperation } from "@athena/database";
import * as databaseSchema from "@athena/database";
import {
  consumeSecurityProof,
  grantSecurityProofFromPasskey,
  grantSecurityProofFromTotp,
  requireRecentSecuritySession,
  requireSecurityOperation,
  SECURITY_REAUTH_WINDOW_SECONDS,
  securityReauthenticationPlugin,
} from "./security-reauthentication";

import { getAuthDatabase, getServerDatabase } from "./database";
import { createOwnerNotification } from "./notifications";
import { isPasswordBreachCheckEnabled } from "./password-breach";
import {
  AUTH_RATE_LIMIT_POLICY,
  authCookieSecure,
  isDemoAuthHttpReadPath,
  isDemoAuthMutationPath,
  isDemoOwner,
  READ_ONLY_WORKSPACE_ERROR_CODE,
  READ_ONLY_WORKSPACE_ERROR_MESSAGE,
  trustedProxyIps,
  validateProductionAuthConfiguration,
} from "./auth-policy";
import { PASSWORD_COMPROMISED_ERROR, PASSWORD_POLICY_ERROR, isPasswordPolicyValid } from "../password-policy";
import { trustedOrigins } from "./request-security";
import { logSecurityEvent } from "./security-logging";


if (process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
  validateProductionAuthConfiguration(process.env);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (process.env.NEXT_PHASE === "phase-production-build") return "build-only-placeholder";
  throw new Error(`${name} is required for authentication.`);
}

const passkeysEnabled = process.env.ATHENA_PASSKEYS_ENABLED?.trim().toLowerCase() === "true";

function passkeyOptions(): Parameters<typeof passkey>[0] {
  const configuredUrl = requiredEnvironment("BETTER_AUTH_URL");
  const url = new URL(configuredUrl);
  return {
    rpName: "Athena Vault",
    rpID: url.hostname,
    origin: configuredUrl,
    registration: { requireSession: true },
  };
}
// TOTP enablement is recorded after verification; the enable endpoint only stages the secret and backup codes.

const LIFECYCLE_AUTH_OPERATIONS: Record<string, AuthSecurityOperation> = {
  "/change-password": "password-change",
  "/security/change-password": "password-change",
  "/security/disable-two-factor": "two-factor-disable",
  "/passkey/delete-passkey": "passkey-revoke",
  "/passkey/update-passkey": "security-setting-changed",

  "/sign-out": "session-revoke",
  "/two-factor/disable": "two-factor-disable",
  "/two-factor/generate-backup-codes": "backup-codes-regenerate",
  "/revoke-session": "session-revoke",
  "/revoke-sessions": "session-revoke",
  "/revoke-other-sessions": "session-revoke",
};

const PASSWORD_POLICY_AUTH_PATHS: Record<string, true> = {
  "/change-password": true,
  "/security/change-password": true,
  "/reset-password": true,
  "/set-password": true,
};

function readReturnedAuthUserId(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("user" in value)) return null;
  const user = value.user;
  if (typeof user !== "object" || user === null || !("id" in user)) return null;
  return typeof user.id === "string" ? user.id : null;
}

function lifecycleAuthOperation(path: string, hasSession: boolean): AuthSecurityOperation | null {
  const operation = LIFECYCLE_AUTH_OPERATIONS[path];
  if (operation) return operation;
  if (path === "/two-factor/verify-totp") return hasSession ? "two-factor-enable" : "session-create";
  if (path === "/two-factor/verify-backup-code") return hasSession ? "recovery-code-used" : "session-create";
  return null;
}

type AuthSecurityContext = Parameters<typeof getAuthoritativeSessionFromCtx>[0];
const signOutAuthUserIds = new WeakMap<object, {
  readonly authUserId: string;
  readonly sessionToken: string | null;
  readonly revokeTargetVerified?: boolean;
  readonly revokeTargetToken?: string | null;
}>();

function readReturnedContextValue(context: AuthSecurityContext): unknown {
  return (context.context as { readonly returned?: unknown }).returned;
}

type AuthoritativeAuthSession = {
  readonly session?: { readonly token?: unknown };
  readonly user?: { readonly id: string };
};

function readSuccessfulAuthResponse(returned: unknown): boolean {
  return !(typeof returned === "object" && returned !== null && "statusCode" in returned && typeof returned.statusCode === "number");
}

type AuthSecurityRecordOptions = {
  readonly authUserId?: string;
  readonly allowAuthoritativeSession?: boolean;
  readonly fingerprintToken?: string;
};

const AUTH_SECURITY_DEDUPE_WINDOW_MS = 60_000;
const AUTH_SECURITY_DEDUPE_MAX_ENTRIES = 1_000;
const authSecurityEventFingerprints = new Map<string, number>();

export function resetAuthSecurityEventDedupeForTests(): void {
  authSecurityEventFingerprints.clear();
}


function readSessionTokenFrom(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as { readonly session?: { readonly token?: unknown }; readonly token?: unknown };
  const token = candidate.session?.token ?? candidate.token;
  return typeof token === "string" && token.length > 0 ? token : null;
}

function readBodyToken(context: AuthSecurityContext): string | null {
  const token = (context.body as { readonly token?: unknown } | undefined)?.token;
  return typeof token === "string" && token.length > 0 ? token : null;
}

function hasRecentAuthSecurityEvent(fingerprint: string, now = Date.now()): boolean {
  const lastRecordedAt = authSecurityEventFingerprints.get(fingerprint);
  return lastRecordedAt !== undefined && now - lastRecordedAt < AUTH_SECURITY_DEDUPE_WINDOW_MS;
}

function markAuthSecurityEvent(fingerprint: string, now = Date.now()): void {
  if (authSecurityEventFingerprints.size >= AUTH_SECURITY_DEDUPE_MAX_ENTRIES) {
    for (const [key, recordedAt] of authSecurityEventFingerprints) {
      if (now - recordedAt >= AUTH_SECURITY_DEDUPE_WINDOW_MS) authSecurityEventFingerprints.delete(key);
    }
    while (authSecurityEventFingerprints.size >= AUTH_SECURITY_DEDUPE_MAX_ENTRIES) {
      const oldest = authSecurityEventFingerprints.keys().next();
      if (oldest.done) break;
      authSecurityEventFingerprints.delete(oldest.value);
    }
  }
  authSecurityEventFingerprints.set(fingerprint, now);
}

function authSecurityFingerprint(
  operation: AuthSecurityOperation,
  authUserId: string,
  context: AuthSecurityContext,
  authoritative: unknown,
  fingerprintToken?: string,
): string {
  const sessionToken = fingerprintToken
    ?? readBodyToken(context)
    ?? readSessionTokenFrom(context.context.session)
    ?? readSessionTokenFrom(context.context.newSession)
    ?? readSessionTokenFrom(readReturnedContextValue(context))
    ?? readSessionTokenFrom(authoritative);
  const tokenPart = sessionToken ? createHash("sha256").update(sessionToken).digest("hex") : "";
  // Path separates same-operation actions (for example /sign-out vs
  // /revoke-other-sessions) that share the current session token.
  return `${operation}:${context.path}:${authUserId}:${tokenPart}`;
}

async function recordAuthSecurityEvent(
  context: AuthSecurityContext,
  operation: AuthSecurityOperation,
  options: AuthSecurityRecordOptions = {},
): Promise<void> {
  if (!readSuccessfulAuthResponse(readReturnedContextValue(context))) return;
  let fingerprint: string | undefined;
  try {
    let authoritative: AuthoritativeAuthSession | null | undefined;
    const resolveAuthoritative = async (): Promise<AuthoritativeAuthSession | null> => {
      if (authoritative === undefined) {
        authoritative = options.allowAuthoritativeSession === false
          ? null
          : await getAuthoritativeSessionFromCtx(context).catch(() => null);
      }
      return authoritative ?? null;
    };

    const authUserId = options.authUserId
      ?? context.context.session?.user.id
      ?? context.context.newSession?.user.id
      ?? readReturnedAuthUserId(readReturnedContextValue(context))
      ?? (await resolveAuthoritative())?.user?.id;
    if (!authUserId) return;

    if (operation === "session-create") {
      // A consumed pending challenge (for example verify-backup-code with
      // disableSession) is a verification, not a new session; only audit
      // responses that actually carry session material.
      const hasSessionMaterial = Boolean(
        readSessionTokenFrom(context.context.session)
        ?? readSessionTokenFrom(context.context.newSession)
        ?? readSessionTokenFrom(readReturnedContextValue(context))
        ?? readSessionTokenFrom(await resolveAuthoritative())
      );
      if (!hasSessionMaterial) return;
    }

    const knownSessionToken = options.fingerprintToken
      ?? readBodyToken(context)
      ?? readSessionTokenFrom(context.context.session)
      ?? readSessionTokenFrom(context.context.newSession)
      ?? readSessionTokenFrom(readReturnedContextValue(context));
    fingerprint = authSecurityFingerprint(
      operation,
      authUserId,
      context,
      knownSessionToken ? null : await resolveAuthoritative(),
      options.fingerprintToken,
    );
    const recordedFingerprint = fingerprint;
    if (hasRecentAuthSecurityEvent(recordedFingerprint)) return;
    markAuthSecurityEvent(recordedFingerprint);

    await withAuthUserContext(getServerDatabase(), authUserId, async (database) => {
      const owner = await createAuthenticationRepository(database).getOwnerByAuthUserId(authUserId);
      if (!owner || isDemoOwner(owner)) {
        authSecurityEventFingerprints.delete(recordedFingerprint);
        return;
      }
      if (operation === "password-change") {
        await createAuthenticationRepository(database).markPasswordChanged(authUserId);
      }
      await createAuditRepository(database).writeAuthSecurityEvent(owner.id, owner.id, { operation, status: "success" });
      const notificationType = operation === "session-create" ? "new_session"
        : operation === "passkey-register" ? "passkey_registered"
          : operation === "passkey-revoke" ? "passkey_revoked"
            : operation === "password-change" ? "password_changed"
              : operation.startsWith("two-factor") || operation === "backup-codes-regenerate" ? "mfa_changed"
                : operation === "recovery-code-used" ? "recovery_code_used" : null;
      if (notificationType) {
        try {
          await createOwnerNotification(database, owner.id, notificationType, {
            title: "Athena Vault security change",
            message: `A ${notificationType.replaceAll("_", " ")} event completed.`,
            occurredAt: new Date().toISOString(),
          });
        } catch (error) {
          logSecurityEvent({ event: "auth_security_event_failed", component: "auth", operation: "notification-email", error, status: 500 });
        }
      }
    });
  } catch (error) {
    if (fingerprint) authSecurityEventFingerprints.delete(fingerprint);
    logSecurityEvent({
      event: "auth_security_event_failed",
      component: "auth",
      operation,
      error,
      status: 500,
    });
  }
}

const authSecurityLifecyclePlugin = {
  id: "athena-auth-security-lifecycle",
  hooks: {
    after: [{
      matcher: (context) => context.path === "/sign-in/email",
      handler: createAuthMiddleware(async (context) => {
        await recordAuthSecurityEvent(context, "session-create", { allowAuthoritativeSession: false });
      }),
    }],
  },
} satisfies BetterAuthPlugin;
export const auth = betterAuth({

  database: drizzleAdapter(getAuthDatabase(), {
    provider: "pg",
    schema: {
      ...databaseSchema,
      auth_users: databaseSchema.authUsers,
      auth_sessions: databaseSchema.authSessions,
      auth_accounts: databaseSchema.authAccounts,
      auth_verifications: databaseSchema.authVerifications,
      twoFactor: databaseSchema.authTwoFactors,
      auth_rate_limits: databaseSchema.authRateLimits,
      ...(passkeysEnabled ? { passkey: databaseSchema.authPasskeys } : {}),
    },
  }),
  secret: requiredEnvironment("BETTER_AUTH_SECRET"),
  appName: "Athena Vault",
  baseURL: process.env.BETTER_AUTH_URL?.trim() ?? "",
  trustedOrigins: () => trustedOrigins(),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    requireEmailVerification: false,
  },
  user: {
    modelName: "auth_users",
  },
  session: {
    modelName: "auth_sessions",
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    freshAge: SECURITY_REAUTH_WINDOW_SECONDS,
  },
  account: {
    modelName: "auth_accounts",
  },
  verification: {
    modelName: "auth_verifications",
  },
  hooks: {
    before: createAuthMiddleware(async (context) => {
      if (context.path === "/sign-out") {
        const session = await getAuthoritativeSessionFromCtx(context).catch(() => null);
        const sessionToken = readSessionTokenFrom(session);
        if (session?.user.id) signOutAuthUserIds.set(context, { authUserId: session.user.id, sessionToken });
        return;
      }
      if (PASSWORD_POLICY_AUTH_PATHS[context.path]) {
        const newPassword = (context.body as { newPassword?: unknown } | undefined)?.newPassword;
        if (typeof newPassword === "string" && !isPasswordPolicyValid(newPassword)) {
          throw APIError.from("BAD_REQUEST", { code: "PASSWORD_POLICY_VIOLATION", message: PASSWORD_POLICY_ERROR });
        }
      }
      const isDemoBlockedPath = isDemoAuthMutationPath(context.path)
        || (Boolean(context.request) && isDemoAuthHttpReadPath(context.path));
      if (isDemoBlockedPath) {
        const session = await getAuthoritativeSessionFromCtx(context);
        const authUserId = session?.user.id;
        if (!authUserId) return;

        const owner = await withAuthUserContext(getServerDatabase(), authUserId, (database) =>
          createAuthenticationRepository(database).getOwnerByAuthUserId(authUserId),
        );
        if (isDemoOwner(owner)) {
          throw APIError.from("FORBIDDEN", {
            code: READ_ONLY_WORKSPACE_ERROR_CODE,
            message: READ_ONLY_WORKSPACE_ERROR_MESSAGE,
          });
        }
        if (context.path === "/revoke-session") {
          // Better Auth returns success for unknown or foreign tokens; verify the
          // target actually belongs to this user before the deletion happens so
          // the after hook never records a no-op as a session revocation.
          const targetToken = readBodyToken(context);
          const verified = targetToken
            ? await withAuthUserContext(getAuthDatabase(), authUserId, async (database) => {
                const [row] = await database
                  .select({ id: databaseSchema.authSessions.id })
                  .from(databaseSchema.authSessions)
                  .where(and(eq(databaseSchema.authSessions.token, targetToken), eq(databaseSchema.authSessions.userId, authUserId)))
                  .limit(1);
                return Boolean(row);
              }).catch(() => false)
            : false;
          signOutAuthUserIds.set(context, {
            authUserId,
            sessionToken: null,
            revokeTargetVerified: verified,
            revokeTargetToken: verified ? targetToken : null,
          });
        }
      }
      if (context.path === "/passkey/delete-passkey" || context.path === "/passkey/update-passkey") {
        await requireRecentSecuritySession(context);
      }
      if (context.path === "/change-password" || context.path === "/security/change-password") {
        await requireSecurityOperation(context, "password-change");
      }
      if (context.path === "/two-factor/disable" || context.path === "/security/disable-two-factor") {
        await requireSecurityOperation(context, "two-factor-disable");
      }
    }),
    after: createAuthMiddleware(async (context) => {
      if (context.path === "/two-factor/verify-totp") await grantSecurityProofFromTotp(context);
      if (context.path === "/change-password" || context.path === "/two-factor/disable") await consumeSecurityProof(context);
      const operation = lifecycleAuthOperation(context.path, Boolean(context.context.session));
      if (!operation) return;
      if (context.path === "/revoke-session" && !signOutAuthUserIds.get(context)?.revokeTargetVerified) return;
      const state = signOutAuthUserIds.get(context);
      await recordAuthSecurityEvent(context, operation, {
        authUserId: state?.authUserId,
        fingerprintToken: (state?.revokeTargetToken ?? state?.sessionToken) ?? undefined,
      });
    }),
  },

  rateLimit: {
    enabled: true,
    storage: "database",
    modelName: "auth_rate_limits",
    window: AUTH_RATE_LIMIT_POLICY.default.windowSeconds,
    max: AUTH_RATE_LIMIT_POLICY.default.max,
    customRules: {
      "/sign-in/email": { window: AUTH_RATE_LIMIT_POLICY.login.client.windowSeconds, max: AUTH_RATE_LIMIT_POLICY.login.client.max },
      "/forget-password": { window: AUTH_RATE_LIMIT_POLICY.recovery.client.windowSeconds, max: AUTH_RATE_LIMIT_POLICY.recovery.client.max },
      "/request-password-reset": { window: AUTH_RATE_LIMIT_POLICY.recovery.client.windowSeconds, max: AUTH_RATE_LIMIT_POLICY.recovery.client.max },
    },
  },
  advanced: {
    useSecureCookies: authCookieSecure(),
    ipAddress: {
      ipAddressHeaders: ["x-forwarded-for"],
      trustedProxies: trustedProxyIps(),
    },
  },
  plugins: [
    twoFactor({ issuer: "Athena Vault" }),
    haveIBeenPwned({
      enabled: isPasswordBreachCheckEnabled(),
      customPasswordCompromisedMessage: PASSWORD_COMPROMISED_ERROR,
      paths: ["/sign-up/email", "/change-password", "/security/change-password", "/reset-password", "/email-otp/reset-password", "/phone-number/reset-password", "/admin/create-user", "/admin/set-user-password"],
    }),
    securityReauthenticationPlugin,
    ...(passkeysEnabled ? [passkey({
      ...passkeyOptions(),
      schema: { passkey: {
        modelName: "passkey",
        fields: {
          name: "name",
          publicKey: "publicKey",
          userId: "userId",
          credentialID: "credentialID",
          counter: "counter",
          deviceType: "deviceType",
          backedUp: "backedUp",
          transports: "transports",
          createdAt: "createdAt",
          aaguid: "aaguid",
        },
      } },
      registration: {
        requireSession: true,
        afterVerification: async ({ ctx }) => {
          await recordAuthSecurityEvent(ctx, "passkey-register");
        },
      },
      authentication: {
        afterVerification: async ({ ctx, clientData }) => {
          await grantSecurityProofFromPasskey(ctx, clientData.id);
          await recordAuthSecurityEvent(ctx, "passkey-authenticate");
        },
      },
    })] : []),
    authSecurityLifecyclePlugin,
    nextCookies(),
  ],
});
