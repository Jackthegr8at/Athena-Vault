"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createAuthenticationRepository } from "@athena/database";
import { auth } from "../../lib/server/auth";
import { logSecurityEvent } from "../../lib/server/security-logging";
import { withAuthenticatedDatabase } from "../../lib/server/owner-database";

export type RevokeSettingsSessionResult = {
  readonly ok: boolean;
  readonly current: boolean;
  readonly message?: string;
};

export async function revokeSettingsSessionAction(sessionId: string): Promise<RevokeSettingsSessionResult> {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) return { ok: false, current: false, message: "Select a session to revoke." };
  try {
    const sessionData = await withAuthenticatedDatabase((database, user): Promise<{ token: string | null; current: boolean; demo: boolean }> => {
      if (user.owner.isDemo) return Promise.resolve({ token: null, current: false, demo: true });
      return createAuthenticationRepository(database).getSessionToken(user.authUserId, normalizedSessionId).then((token) => ({ token, current: normalizedSessionId === user.session.id, demo: false }));
    }, { requireTwoFactor: false });
    if (sessionData.demo) return { ok: false, current: false, message: "This workspace is read-only." };
    if (!sessionData.token) return { ok: false, current: false, message: "That session is no longer available." };
    await auth.api.revokeSession({ body: { token: sessionData.token }, headers: await headers() });
    revalidatePath("/settings");
    return { ok: true, current: sessionData.current };
  } catch (error) {
    logSecurityEvent({ event: "settings_session_revoke_failed", component: "settings", operation: "revoke-session", error });
    return { ok: false, current: false, message: "We couldn't revoke that session. Please try again." };
  }
}
