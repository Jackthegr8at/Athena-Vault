"use server";

import { createPageHelpRepository } from "@athena/database";
import type { PageHelpPageId } from "./page-help-content";
import { PAGE_HELP_CONTENT } from "./page-help-content";
import { withAuthenticatedDatabase } from "../../lib/server/owner-database";

function assertKnownPageId(value: string): asserts value is PageHelpPageId {
  if (!Object.prototype.hasOwnProperty.call(PAGE_HELP_CONTENT, value)) {
    throw new Error("Page help page is invalid.");
  }
}

export async function markPageHelpSeen(pageId: string): Promise<void> {
  assertKnownPageId(pageId);
  await withAuthenticatedDatabase(async (database, user) => {
    if (user.owner.isDemo) return;
    await createPageHelpRepository(database).markSeen(user.owner.id, pageId);
  }, { requireTwoFactor: false });
}
