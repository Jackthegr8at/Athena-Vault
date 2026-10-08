import "./server-only";

import { createAuthenticationRepository, MISSING_WORKSPACE_ERROR_MESSAGE, withAuthUserContext, type OwnerRecord } from "@athena/database";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "./auth";
import { isDemoOwner, isTwoFactorRequired, readDemoFixtureVersion, ReadOnlyWorkspaceError } from "./auth-policy";
import { getServerDatabase } from "./database";

export class UnauthenticatedError extends Error {
  constructor() {
    super("Authentication required.");
    this.name = "UnauthenticatedError";
  }
}

export interface AuthenticatedUser {
  readonly authUserId: string;
  readonly owner: AuthenticatedOwner;
  readonly twoFactorEnabled: boolean;
  readonly session: NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>["session"];
}

export type AuthenticatedOwner = OwnerRecord & {
  readonly isDemo: boolean;
  readonly demoFixtureVersion: number | null;
};

function normalizeOwner(owner: OwnerRecord): AuthenticatedOwner {
  return {
    ...owner,
    isDemo: isDemoOwner(owner),
    demoFixtureVersion: readDemoFixtureVersion(owner),
  };
}

export const getAuthenticatedUser = cache(async (): Promise<AuthenticatedUser | null> => {
  const sessionResult = await auth.api.getSession({ headers: await headers() });
  if (!sessionResult) return null;

  let owner: OwnerRecord | null;
  try {
    owner = await withAuthUserContext(getServerDatabase(), sessionResult.user.id, (database) =>
      createAuthenticationRepository(database).getOwnerByAuthUserId(sessionResult.user.id),
    );
  } catch (error) {
    if (error instanceof Error && error.message === MISSING_WORKSPACE_ERROR_MESSAGE) return null;
    throw error;
  }
  if (!owner) return null;
  return {
    authUserId: sessionResult.user.id,
    owner: normalizeOwner(owner),
    twoFactorEnabled: sessionResult.user.twoFactorEnabled === true,
    session: sessionResult.session,
  };
});

export async function requireAuthenticatedUser(): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser();
  if (!user) throw new UnauthenticatedError();
  return user;
}

export function assertWritableAuthenticatedUser(user: Pick<AuthenticatedUser, "owner">): void {
  if (user.owner.isDemo) throw new ReadOnlyWorkspaceError();
}

export async function requireWritableAuthenticatedUser(): Promise<AuthenticatedUser> {
  const user = await requireAuthenticatedUser();
  assertWritableAuthenticatedUser(user);
  return user;
}

/**
 * Policy ordering: passkey is optional sign-in; TOTP remains the enforced
 * MFA baseline; recovery codes are single-use. Registration alone never
 * satisfies ATHENA_AUTH_REQUIRE_2FA or finance-route step-up requirements.
 */
export function requireMfaEnrolledUser(
  user: AuthenticatedUser,
  requireTwoFactor = false,
): AuthenticatedUser {
  if (!requireTwoFactor) return user;
  if (user.owner.isDemo) return user;
  if (!isTwoFactorRequired()) return user;
  if (user.twoFactorEnabled === true) return user;
  redirect("/settings?security=two-factor");
}
