import { and, eq } from "drizzle-orm";
import type { Database } from "./client";
import { pageHelpSeen } from "./drizzle-schema";

const pageIdPattern = /^[a-z][a-z0-9-]{0,63}$/;

function normalizePageId(pageId: string): string {
  const normalized = pageId.trim();
  if (!pageIdPattern.test(normalized)) throw new Error("Page help page id is invalid.");
  return normalized;
}

export function createPageHelpRepository(database: Database) {
  return {
    async ensureSeen(ownerId: string, pageId: string): Promise<boolean> {
      const normalized = normalizePageId(pageId);
      const [inserted] = await database
        .insert(pageHelpSeen)
        .values({ ownerId, pageId: normalized })
        .onConflictDoNothing({ target: [pageHelpSeen.ownerId, pageHelpSeen.pageId] })
        .returning({ pageId: pageHelpSeen.pageId });
      return !inserted;
    },

    async hasSeen(ownerId: string, pageId: string): Promise<boolean> {
      const normalized = normalizePageId(pageId);
      const [row] = await database
        .select({ pageId: pageHelpSeen.pageId })
        .from(pageHelpSeen)
        .where(and(eq(pageHelpSeen.ownerId, ownerId), eq(pageHelpSeen.pageId, normalized)))
        .limit(1);
      return Boolean(row);
    },

    async markSeen(ownerId: string, pageId: string): Promise<void> {
      const normalized = normalizePageId(pageId);
      await database
        .insert(pageHelpSeen)
        .values({ ownerId, pageId: normalized })
        .onConflictDoNothing({ target: [pageHelpSeen.ownerId, pageHelpSeen.pageId] });
    },
  };
}
