import "./server-only";

import { createPageHelpRepository, type Database } from "@athena/database";
import type { AuthenticatedUser } from "./auth-session";

/**
 * Reads the guide seen flag inside the caller's existing transaction so a page
 * does not open a second database transaction per request.
 */
export async function hasPageHelpSeen(database: Database, user: AuthenticatedUser, pageId: string): Promise<boolean> {
  return createPageHelpRepository(database).hasSeen(user.owner.id, pageId);
}
