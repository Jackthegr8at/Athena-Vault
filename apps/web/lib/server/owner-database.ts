import "./server-only";

import { redirect } from "next/navigation";
import { withDatabaseContext, type Database } from "@athena/database";
import { getAuthenticatedUser, requireAuthenticatedUser, requireMfaEnrolledUser, requireWritableAuthenticatedUser, type AuthenticatedUser } from "./auth-session";
import { getServerDatabase } from "./database";

type WithAuthenticatedDatabaseOptions = { readonly requireTwoFactor?: boolean };

export async function withAuthenticatedDatabase<T>(
  callback: (database: Database, user: AuthenticatedUser) => Promise<T>,
  options: WithAuthenticatedDatabaseOptions = {},
): Promise<T> {
  const user = await requireAuthenticatedUser();
  requireMfaEnrolledUser(user, options.requireTwoFactor);
  return withDatabaseContext(getServerDatabase(), { ownerId: user.owner.id, authUserId: user.authUserId }, (database) => callback(database, user));
}

export async function withWritableAuthenticatedDatabase<T>(
  callback: (database: Database, user: AuthenticatedUser) => Promise<T>,
  options: WithAuthenticatedDatabaseOptions = {},
): Promise<T> {
  const user = await requireWritableAuthenticatedUser();
  requireMfaEnrolledUser(user, options.requireTwoFactor);
  return withDatabaseContext(getServerDatabase(), { ownerId: user.owner.id, authUserId: user.authUserId }, (database) => callback(database, user));
}

export async function withAuthenticatedPageDatabase<T>(
  callback: (database: Database, user: AuthenticatedUser) => Promise<T>,
  options: WithAuthenticatedDatabaseOptions = {},
): Promise<T> {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  requireMfaEnrolledUser(user, options.requireTwoFactor);
  return withDatabaseContext(getServerDatabase(), { ownerId: user.owner.id, authUserId: user.authUserId }, (database) => callback(database, user));
}
