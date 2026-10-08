import { eq } from "drizzle-orm";
import type { Database } from "../client";
import {
  auditEvents,
  users,
} from "../drizzle-schema";

import type { OwnerRecord } from "./shared";

export function createOwnerRepository(db: Database) {
  return {
    async updateDisplayName(ownerId: string, displayName: string): Promise<OwnerRecord> {
      const normalizedDisplayName = displayName.trim();
      if (normalizedDisplayName.length < 1 || normalizedDisplayName.length > 80) throw new Error("Owner display name is invalid.");
      return db.transaction(async (tx) => {
        const [owner] = await tx.update(users)
          .set({ displayName: normalizedDisplayName })
          .where(eq(users.id, ownerId))
          .returning({ id: users.id, email: users.email, displayName: users.displayName, isDemo: users.isDemo, demoFixtureVersion: users.demoFixtureVersion, createdAt: users.createdAt });
        if (!owner) throw new Error("Owner not found.");

        await tx.insert(auditEvents).values({
          ownerId,
          actorUserId: ownerId,
          action: "updated",
          entityType: "owner",
          entityId: ownerId,
          metadata: { operation: "display_name_update" },
        });
        return owner;
      });
    },
  };
}
