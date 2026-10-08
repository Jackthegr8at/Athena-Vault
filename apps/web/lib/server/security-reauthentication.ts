import "./server-only";

import { randomUUID } from "node:crypto";

import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, getAuthoritativeSessionFromCtx, sensitiveSessionMiddleware } from "better-auth/api";
import { expireCookie, setSessionCookie } from "better-auth/cookies";

export const SECURITY_REAUTH_WINDOW_SECONDS = 15 * 60;
export const SECURITY_REAUTH_WINDOW_MS = SECURITY_REAUTH_WINDOW_SECONDS * 1000;

export const SECURITY_OPERATION_VALUES = ["password-change", "two-factor-disable"] as const;
export type SecurityOperation = (typeof SECURITY_OPERATION_VALUES)[number];

type SecurityIntentMethod = "password" | "passkey";
type SecurityProofMethod = "password-totp" | "passkey";

type SecurityPayload = {
  readonly userId: string;
  readonly operation: SecurityOperation;
  readonly method: SecurityIntentMethod | SecurityProofMethod;
  readonly issuedAt: number;
  readonly nonce: string;
};

type AuthEndpointContext = Parameters<typeof getAuthoritativeSessionFromCtx>[0];
type SecuritySession = NonNullable<Awaited<ReturnType<typeof getAuthoritativeSessionFromCtx>>>;

type ProofRecord = {
  readonly cookieName: string;
};

const SECURITY_INTENT_COOKIE_NAME = "athena_security_intent";
const SECURITY_PROOF_COOKIE_NAME = "athena_security_proof";
const TRUST_DEVICE_COOKIE_NAME = "trust_device";
const securityProofRecords = new WeakMap<object, ProofRecord>();

type SecurityRequestBody = {
  readonly operation?: unknown;
  readonly password?: unknown;
  readonly newPassword?: unknown;
};

function securityError(code: string, message: string, status: "BAD_REQUEST" | "FORBIDDEN" | "UNAUTHORIZED" = "FORBIDDEN"): never {
  throw APIError.from(status, { code, message });
}

function responseSucceeded(context: AuthEndpointContext): boolean {
  const returned = (context.context as { readonly returned?: unknown }).returned;
  if (typeof returned !== "object" || returned === null || !("statusCode" in returned)) return true;
  const statusCode = (returned as { readonly statusCode?: unknown }).statusCode;
  return typeof statusCode !== "number" || statusCode < 400;
}

function isSecurityOperation(value: unknown): value is SecurityOperation {
  return typeof value === "string" && (SECURITY_OPERATION_VALUES as readonly string[]).includes(value);
}

function parseSecurityPayload(value: string | null): SecurityPayload | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<SecurityPayload>;
    if (
      typeof parsed.userId !== "string"
      || !isSecurityOperation(parsed.operation)
      || (parsed.method !== "password" && parsed.method !== "passkey" && parsed.method !== "password-totp")
      || typeof parsed.issuedAt !== "number"
      || !Number.isFinite(parsed.issuedAt)
      || typeof parsed.nonce !== "string"
      || parsed.nonce.length < 16
    ) return null;
    return parsed as SecurityPayload;
  } catch {
    return null;
  }
}

function isPayloadRecent(payload: SecurityPayload, now = Date.now()): boolean {
  const age = now - payload.issuedAt;
  return age >= 0 && age < SECURITY_REAUTH_WINDOW_MS;
}

function securityCookie(context: AuthEndpointContext, name: string, maxAge = SECURITY_REAUTH_WINDOW_SECONDS) {
  return context.context.createAuthCookie(name, { maxAge });
}

async function readSecurityCookie(context: AuthEndpointContext, name: string): Promise<SecurityPayload | null> {
  if (!context.context || typeof context.context.createAuthCookie !== "function" || typeof context.getSignedCookie !== "function") return null;
  const cookie = securityCookie(context, name);
  const value = await context.getSignedCookie(cookie.name, context.context.secret);
  return parseSecurityPayload(typeof value === "string" ? value : null);
}

async function writeSecurityCookie(
  context: AuthEndpointContext,
  name: string,
  userId: string,
  operation: SecurityOperation,
  method: SecurityPayload["method"],
): Promise<void> {
  const cookie = securityCookie(context, name);
  const payload: SecurityPayload = {
    userId,
    operation,
    method,
    issuedAt: Date.now(),
    nonce: randomUUID(),
  };
  await context.setSignedCookie(cookie.name, JSON.stringify(payload), context.context.secret, cookie.attributes);
}

async function expireSecurityCookie(context: AuthEndpointContext, name: string): Promise<void> {
  const cookie = securityCookie(context, name, 0);
  expireCookie(context, cookie);
}

async function requireAuthoritativeSession(context: AuthEndpointContext): Promise<SecuritySession> {
  const session = await getAuthoritativeSessionFromCtx(context).catch(() => null) as SecuritySession | null;
  if (!session?.session || !session.user?.id) securityError("UNAUTHORIZED", "Unauthorized", "UNAUTHORIZED");
  return session;
}

function isRecentSession(session: SecuritySession, now = Date.now()): boolean {
  const createdAt = new Date(session.session.createdAt).getTime();
  return Number.isFinite(createdAt) && now - createdAt < SECURITY_REAUTH_WINDOW_MS;
}

export async function requireRecentSecuritySession(context: AuthEndpointContext): Promise<SecuritySession> {
  const session = await requireAuthoritativeSession(context);
  if (!isRecentSession(session)) securityError("SESSION_NOT_FRESH", "Recent authentication is required for this security setting.");
  return session;
}

export async function requireSecurityOperation(
  context: AuthEndpointContext,
  operation: SecurityOperation,
): Promise<{ readonly session: SecuritySession; readonly method: SecurityProofMethod | null }> {
  const session = await requireAuthoritativeSession(context);
  const proof = await readSecurityCookie(context, SECURITY_PROOF_COOKIE_NAME);
  if (proof && isPayloadRecent(proof) && proof.userId === session.user.id && proof.operation === operation) {
    if (proof.method !== "password-totp" && proof.method !== "passkey") securityError("SECURITY_STEP_UP_REQUIRED", "Additional verification is required.");
    securityProofRecords.set(context as object, { cookieName: SECURITY_PROOF_COOKIE_NAME });
    return { session, method: proof.method };
  }
  if (proof) await expireSecurityCookie(context, SECURITY_PROOF_COOKIE_NAME);
  if (operation === "password-change" && session.user.twoFactorEnabled !== true && isRecentSession(session)) {
    return { session, method: null };
  }
  securityError("SECURITY_STEP_UP_REQUIRED", "Additional verification is required for this security setting.");
}

export async function consumeSecurityProof(context: AuthEndpointContext): Promise<void> {
  const proof = securityProofRecords.get(context as object);
  if (!proof) return;
  securityProofRecords.delete(context as object);
  await expireSecurityCookie(context, proof.cookieName);
}

export async function grantSecurityProofFromTotp(context: AuthEndpointContext): Promise<void> {
  if (!responseSucceeded(context)) return;
  const intent = await readSecurityCookie(context, SECURITY_INTENT_COOKIE_NAME);
  const session = (context.context as { readonly session?: SecuritySession }).session;
  if (!intent || intent.method !== "password" || !isPayloadRecent(intent) || !session?.user?.id || session.user.id !== intent.userId) return;
  await writeSecurityCookie(context, SECURITY_PROOF_COOKIE_NAME, intent.userId, intent.operation, "password-totp");
  await expireSecurityCookie(context, SECURITY_INTENT_COOKIE_NAME);
}

export async function grantSecurityProofFromPasskey(context: AuthEndpointContext, credentialId: string): Promise<void> {
  const intent = await readSecurityCookie(context, SECURITY_INTENT_COOKIE_NAME);
  if (!intent || intent.method !== "passkey" || !isPayloadRecent(intent)) return;
  const session = await getAuthoritativeSessionFromCtx(context).catch(() => null) as SecuritySession | null;
  if (session?.user?.id !== intent.userId) return;
  const passkey = await context.context.adapter.findOne({
    model: "passkey",
    where: [{ field: "credentialID", value: credentialId }],
  }) as { readonly userId?: unknown } | null;
  if (passkey?.userId !== intent.userId) return;
  await writeSecurityCookie(context, SECURITY_PROOF_COOKIE_NAME, intent.userId, intent.operation, "passkey");
  await expireSecurityCookie(context, SECURITY_INTENT_COOKIE_NAME);
}

async function verifyCurrentPassword(context: AuthEndpointContext, userId: string, password: string): Promise<void> {
  const account = await context.context.internalAdapter.findCredentialAccount(userId);
  if (!account?.password || !await context.context.password.verify({ hash: account.password, password })) {
    securityError("INVALID_PASSWORD", "The current password was not accepted.", "BAD_REQUEST");
  }
}

const requestPasswordSecurityProof = createAuthEndpoint(
  "/security/request-password-proof",
  {
    method: "POST",
    requireHeaders: true,
    use: [sensitiveSessionMiddleware],
  },
  async (context) => {
    const body = context.body as SecurityRequestBody;
    if (!isSecurityOperation(body.operation) || typeof body.password !== "string" || !body.password) {
      securityError("INVALID_SECURITY_REQUEST", "Additional verification is required.", "BAD_REQUEST");
    }
    const session = await requireAuthoritativeSession(context);
    await verifyCurrentPassword(context, session.user.id, body.password);
    await writeSecurityCookie(context, SECURITY_INTENT_COOKIE_NAME, session.user.id, body.operation, "password");
    return context.json({ status: true });
  },
);

const requestPasskeySecurityProof = createAuthEndpoint(
  "/security/request-passkey-proof",
  {
    method: "POST",
    requireHeaders: true,
    use: [sensitiveSessionMiddleware],
  },
  async (context) => {
    const body = context.body as SecurityRequestBody;
    if (!isSecurityOperation(body.operation)) securityError("INVALID_SECURITY_REQUEST", "Additional verification is required.", "BAD_REQUEST");
    const session = await requireAuthoritativeSession(context);
    await writeSecurityCookie(context, SECURITY_INTENT_COOKIE_NAME, session.user.id, body.operation, "passkey");
    return context.json({ status: true });
  },
);

const changePasswordWithPasskey = createAuthEndpoint(
  "/security/change-password",
  {
    method: "POST",
    requireHeaders: true,
    use: [sensitiveSessionMiddleware],
  },
  async (context) => {
    const body = context.body as SecurityRequestBody;
    if (typeof body.newPassword !== "string" || !body.newPassword) securityError("INVALID_SECURITY_REQUEST", "A new password is required.", "BAD_REQUEST");
    const { session, method } = await requireSecurityOperation(context, "password-change");
    if (method !== "passkey") securityError("SECURITY_STEP_UP_REQUIRED", "A passkey verification is required for this password change.");
    const account = await context.context.internalAdapter.findCredentialAccount(session.user.id);
    if (!account?.password) securityError("CREDENTIAL_ACCOUNT_NOT_FOUND", "A credential account is required.", "BAD_REQUEST");
    const passwordHash = await context.context.password.hash(body.newPassword);
    await context.context.internalAdapter.updateAccount(account.id, { password: passwordHash });
    await context.context.internalAdapter.deleteUserSessions(session.user.id);
    const newSession = await context.context.internalAdapter.createSession(session.user.id);
    if (!newSession) securityError("FAILED_TO_GET_SESSION", "The new session could not be created.", "BAD_REQUEST");
    await setSessionCookie(context, { session: newSession, user: session.user });
    await consumeSecurityProof(context);
    return context.json({ status: true });
  },
);

const disableTwoFactorWithProof = createAuthEndpoint(
  "/security/disable-two-factor",
  {
    method: "POST",
    requireHeaders: true,
    use: [sensitiveSessionMiddleware],
  },
  async (context) => {
    const { session } = await requireSecurityOperation(context, "two-factor-disable");
    const updatedUser = await context.context.internalAdapter.updateUser(session.user.id, { twoFactorEnabled: false });
    await context.context.adapter.delete({ model: "twoFactor", where: [{ field: "userId", value: session.user.id }] });
    const newSession = await context.context.internalAdapter.createSession(updatedUser.id, false, session.session);
    if (!newSession) securityError("FAILED_TO_GET_SESSION", "The new session could not be created.", "BAD_REQUEST");
    await setSessionCookie(context, { session: newSession, user: updatedUser });
    await context.context.internalAdapter.deleteSession(session.session.token);
    const trustDeviceCookie = context.context.createAuthCookie(TRUST_DEVICE_COOKIE_NAME);
    const trustDeviceValue = await context.getSignedCookie(trustDeviceCookie.name, context.context.secret);
    if (trustDeviceValue) {
      const [, trustIdentifier] = trustDeviceValue.split("!");
      if (trustIdentifier) await context.context.internalAdapter.deleteVerificationByIdentifier(trustIdentifier);
      expireCookie(context, trustDeviceCookie);
    }
    await consumeSecurityProof(context);
    return context.json({ status: true });
  },
);

export const securityReauthenticationPlugin = {
  id: "athena-security-reauthentication",
  endpoints: {
    requestPasswordSecurityProof,
    requestPasskeySecurityProof,
    changePasswordWithPasskey,
    disableTwoFactorWithProof,
  },
} satisfies BetterAuthPlugin;
