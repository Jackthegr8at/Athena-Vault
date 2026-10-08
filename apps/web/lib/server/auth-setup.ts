import "./server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, eq, gt, isNull, sql, withAuthUserContext, type Database } from "@athena/database";
import * as schema from "@athena/database";
import { cache } from "react";
import { assertPasswordPolicy } from "../password-policy";
import { getAuthDatabase, getServerDatabase } from "./database";
import { requireMfaEnrolledUser, requireWritableAuthenticatedUser } from "./auth-session";
import { isSetupTokenValid, SETUP_AUTHORIZATION_ERROR } from "./auth-setup-token";
import { assertPasswordNotCompromised } from "./password-breach";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function inviteExpiresHours(): number {
  const parsed = Number(process.env.ATHENA_AUTH_INVITE_EXPIRES_HOURS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
}

export const getPrimaryOwnerId = cache(async (db: Database): Promise<string | null> => {
  const [owner] = await db
    .select({ ownerId: schema.workspacePrimaryOwner.ownerId })
    .from(schema.workspacePrimaryOwner)
    .where(eq(schema.workspacePrimaryOwner.id, 1))
    .limit(1);
  return owner?.ownerId ?? null;
});

class SetupError extends Error {}

export async function isFirstRun(): Promise<boolean> {
  const db = getAuthDatabase();
  const credentialCount = Number((await db.select({ count: sql`count(*)::int` }).from(schema.authAccounts).where(eq(schema.authAccounts.providerId, "credential")))[0]?.count ?? 0);
  return credentialCount === 0;
}

export async function setupFirstUser(formData: {
  readonly email: string;
  readonly password: string;
  readonly displayName?: string;
  readonly setupToken?: string;
}): Promise<void> {
  if (!isSetupTokenValid(formData.setupToken)) throw new SetupError(SETUP_AUTHORIZATION_ERROR);

  const email = formData.email.trim().toLowerCase();
  const password = formData.password;
  const displayName = formData.displayName?.trim() || undefined;
  if (email.length === 0) throw new SetupError("Email is required.");
  assertPasswordPolicy(password);

  const appDb = getServerDatabase();
  const authDb = getAuthDatabase();
  await assertPasswordNotCompromised(password);
  const passwordHash = await hashPassword(password);
  const name = (displayName || email).slice(0, 120);
  let ownerId: string | undefined;

  await withAppAndAuthTransaction(appDb, authDb, {
    beforeApp: async (authTx) => {
      await authTx.execute(sql`select pg_advisory_xact_lock(hashtextextended('athena-vault:first-user-setup', 0))`);
      const credentialCount = Number((await authTx.select({ count: sql`count(*)::int` }).from(schema.authAccounts).where(eq(schema.authAccounts.providerId, "credential")))[0]?.count ?? 0);
      if (credentialCount > 0) throw new SetupError("First-run setup has already completed.");
    },
    app: async (appTx) => {
      const primaryId = await getPrimaryOwnerId(appTx);
      ownerId = primaryId ?? randomUUID();
      await appTx.execute(sql`select set_config('app.owner_id', ${ownerId}, true)`);
      if (primaryId) {
        await appTx
          .update(schema.users)
          .set({ email, displayName: displayName ? displayName.slice(0, 80) : null })
          .where(eq(schema.users.id, primaryId));
      } else {
        await appTx.insert(schema.users).values({
          id: ownerId,
          email,
          displayName: displayName ? displayName.slice(0, 80) : null,
        });
      }
      await ensureWorkspacePrimaryOwner(appTx, ownerId);
    },
    afterApp: async (authTx) => {
      if (!ownerId) throw new SetupError("First-run setup could not resolve an owner.");
      await authTx
        .insert(schema.authUsers)
        .values({ id: ownerId, name, email, emailVerified: false })
        .onConflictDoUpdate({
          target: schema.authUsers.id,
          set: { name, email },
        });

      await authTx
        .insert(schema.authUserWorkspaces)
        .values({ authUserId: ownerId, athenaUserId: ownerId })
        .onConflictDoNothing();

      await authTx.insert(schema.authAccounts).values({
        id: randomUUID(),
        issuer: "local:credential",
        accountId: ownerId,
        providerId: "credential",
        userId: ownerId,
        password: passwordHash,
      });
      await authTx.update(schema.authUsers).set({ passwordChangedAt: new Date() }).where(eq(schema.authUsers.id, ownerId));
    },
  });
}

export async function createInvitation(formData: {
  readonly email: string;
  readonly displayName?: string;
}): Promise<string> {
  const email = formData.email.trim().toLowerCase();
  const displayName = formData.displayName?.trim() || undefined;
  if (email.length === 0) throw new SetupError("Email is required.");

  const user = await requireWritableAuthenticatedUser();
  requireMfaEnrolledUser(user, false);
  const appDb = getServerDatabase();
  const primaryId = await getPrimaryOwnerId(appDb);
  if (!primaryId || user.authUserId !== primaryId) throw new SetupError("Only the primary owner can create invitations.");
  const token = randomBytes(32).toString("hex");
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + inviteExpiresHours() * 60 * 60 * 1000);

  await withAuthUserContext(getAuthDatabase(), user.authUserId, (database) => database.insert(schema.authInvitations).values({
    id: randomUUID(),
    tokenHash,
    email,
    displayName: displayName ? displayName.slice(0, 80) : null,
    createdBy: user.authUserId,
    expiresAt,
  }));

  return token;
}

export async function acceptInvitation(formData: {
  readonly token: string;
  readonly email: string;
  readonly password: string;
  readonly displayName?: string;
}): Promise<void> {
  const token = formData.token.trim();
  const email = formData.email.trim().toLowerCase();
  const password = formData.password;
  const displayName = formData.displayName?.trim() || undefined;

  if (token.length === 0) throw new SetupError("Invitation token is required.");
  if (email.length === 0) throw new SetupError("Email is required.");
  assertPasswordPolicy(password);

  const appDb = getServerDatabase();
  const authDb = getAuthDatabase();
  const tokenHash = sha256(token);

  const [invitation] = await authDb
    .select()
    .from(schema.authInvitations)
    .where(
      and(
        eq(schema.authInvitations.tokenHash, tokenHash),
        isNull(schema.authInvitations.usedAt),
        gt(schema.authInvitations.expiresAt, sql`now()`)
      )
    );

  if (!invitation) throw new SetupError("Invalid or expired invitation.");
  if (invitation.email !== email) throw new SetupError("Invalid or expired invitation.");

  await assertPasswordNotCompromised(password);
  const passwordHash = await hashPassword(password);
  const effectiveDisplayName = (displayName ?? invitation.displayName ?? email).slice(0, 80);
  const name = effectiveDisplayName.slice(0, 120);

  let ownerId: string | undefined;
  let hasExistingAuthUser = false;
  await withAppAndAuthTransaction(appDb, authDb, {
    beforeApp: async (authTx) => {
      const [invitationRow] = await authTx
        .select()
        .from(schema.authInvitations)
        .where(eq(schema.authInvitations.id, invitation.id))
        .for("update");
      if (!invitationRow || invitationRow.usedAt || invitationRow.expiresAt <= new Date()) throw new SetupError("Invalid or expired invitation.");

      const [existingAuthUser] = await authTx
        .select({ id: schema.authUsers.id })
        .from(schema.authUsers)
        .where(sql`lower(${schema.authUsers.email}) = lower(${email})`)
        .limit(1);

      ownerId = existingAuthUser?.id ?? randomUUID();
      hasExistingAuthUser = Boolean(existingAuthUser);

      const [credential] = await authTx
        .select({ id: schema.authAccounts.id })
        .from(schema.authAccounts)
        .where(and(eq(schema.authAccounts.providerId, "credential"), eq(schema.authAccounts.userId, ownerId)))
        .limit(1);

      if (credential) throw new SetupError("This email already has an account.");
    },
    app: async (appTx) => {
      if (!ownerId) throw new SetupError("Invalid or expired invitation.");
      await appTx.execute(sql`select set_config('app.owner_id', ${ownerId}, true)`);
      if (hasExistingAuthUser) {
        await appTx
          .update(schema.users)
          .set({ displayName: effectiveDisplayName })
          .where(eq(schema.users.id, ownerId));
      } else {
        await appTx.insert(schema.users).values({
          id: ownerId,
          email,
          displayName: effectiveDisplayName,
        });
      }
    },
    afterApp: async (authTx) => {
      if (!ownerId) throw new SetupError("Invalid or expired invitation.");
      await authTx
        .insert(schema.authUsers)
        .values({ id: ownerId, name, email, emailVerified: false })
        .onConflictDoUpdate({
          target: schema.authUsers.id,
          set: { name, email },
        });

      await authTx
        .insert(schema.authUserWorkspaces)
        .values({ authUserId: ownerId, athenaUserId: ownerId })
        .onConflictDoNothing();

      await authTx.insert(schema.authAccounts).values({
        id: randomUUID(),
        issuer: "local:credential",
        accountId: ownerId,
        providerId: "credential",
        userId: ownerId,
        password: passwordHash,
      });
      await authTx.update(schema.authUsers).set({ passwordChangedAt: new Date() }).where(eq(schema.authUsers.id, ownerId));

      await authTx
        .update(schema.authInvitations)
        .set({ usedAt: sql`now()` })
        .where(eq(schema.authInvitations.id, invitation.id));
    },
  });
}

type SetupDatabase = ReturnType<typeof getServerDatabase>;

type AuthSetupTransactionCallbacks = {
  readonly beforeApp: (authTx: SetupDatabase) => Promise<void>;
  readonly app: (appTx: SetupDatabase) => Promise<void>;
  readonly afterApp: (authTx: SetupDatabase) => Promise<void>;
};

async function ensureWorkspacePrimaryOwner(database: SetupDatabase, ownerId: string): Promise<void> {
  await database
    .insert(schema.workspacePrimaryOwner)
    .values({ id: 1, ownerId })
    .onConflictDoNothing();
}

async function withAppAndAuthTransaction(
  appDb: SetupDatabase,
  authDb: SetupDatabase,
  callbacks: AuthSetupTransactionCallbacks,
): Promise<void> {
  if (appDb === authDb) {
    await appDb.transaction(async (tx) => {
      const database = tx as unknown as SetupDatabase;
      await callbacks.beforeApp(database);
      await callbacks.app(database);
      await callbacks.afterApp(database);
    });
    return;
  }

  // The split-role connection cannot validate a foreign key to an app row that
  // is still uncommitted on the other connection. Keep auth preflight locked,
  // commit the app transaction, then finish the auth writes in the same auth
  // transaction.
  await authDb.transaction(async (authTx) => {
    await callbacks.beforeApp(authTx as unknown as SetupDatabase);
    await appDb.transaction(async (appTx) => {
      await callbacks.app(appTx as unknown as SetupDatabase);
    });
    await callbacks.afterApp(authTx as unknown as SetupDatabase);
  });
}
