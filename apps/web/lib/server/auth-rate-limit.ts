import "./server-only";

import { sql } from "@athena/database";
import { authRateLimits, type Database } from "@athena/database";
import { getAuthDatabase } from "./database";

export interface GlobalAuthRateLimitRule {
  readonly windowSeconds: number;
  readonly max: number;
}

/**
 * Counts coarse auth abuse scopes in PostgreSQL so the cap is shared by all
 * web processes. Better Auth separately applies its per-client/path policy.
 *
 * One statement performs the whole check: the insert claims a fresh key and
 * the conflict branch applies the window reset (`last_request <= windowStart`
 * restarts the count) or increments below `max`. When the stored row is inside
 * the window and already at `max`, the update's WHERE clause excludes it so
 * `RETURNING` comes back empty and the request is denied. PostgreSQL skips
 * DO UPDATE rows filtered by the update WHERE for RETURNING, keeping deny
 * semantics identical to the previous SELECT … FOR UPDATE sequence.
 */
export async function consumeGlobalAuthRateLimit(
  key: string,
  rule: GlobalAuthRateLimitRule,
  database: Database = getAuthDatabase(),
): Promise<boolean> {
  const now = Date.now();
  const windowStart = now - rule.windowSeconds * 1000;

  return database.transaction(async (transaction) => {
    const rows = await transaction
      .insert(authRateLimits)
      .values({ key, count: 1, lastRequest: now })
      .onConflictDoUpdate({
        target: authRateLimits.key,
        set: {
          count: sql`case when ${authRateLimits.lastRequest} <= ${windowStart} then 1 else ${authRateLimits.count} + 1 end`,
          lastRequest: now,
        },
        setWhere: sql`${authRateLimits.lastRequest} <= ${windowStart} or ${authRateLimits.count} < ${rule.max}`,
      })
      .returning({ key: authRateLimits.key });
    return rows.length > 0;
  });
}
