import { AsyncLocalStorage } from "node:async_hooks";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./drizzle-schema";

export const DATABASE_HEALTH_QUERY = sql`select 1 as health`;

export type DatabaseObservationOutcome = "success" | "error";

export interface DatabaseObservation {
  readonly label: string;
  readonly queryCount: number;
  readonly elapsedMs: number;
  readonly outcome: DatabaseObservationOutcome;
}

export interface DatabaseObservationOptions {
  readonly disabled?: boolean;
  readonly onObservation?: (observation: DatabaseObservation) => void;
}

export interface DatabaseObservationScope {
  readonly label: string;
  readonly startNs: bigint;
  queryCount: number;
  readonly onObservation?: (observation: DatabaseObservation) => void;
}

const observationStorage = new AsyncLocalStorage<DatabaseObservationScope>();

function nowNs(): bigint {
  return process.hrtime.bigint();
}

function createObservation(scope: DatabaseObservationScope, outcome: DatabaseObservationOutcome): DatabaseObservation {
  const elapsedNs = nowNs() - scope.startNs;
  const elapsedMs = Number(elapsedNs) / 1_000_000;
  return {
    label: scope.label,
    queryCount: scope.queryCount,
    elapsedMs,
    outcome,
  };
}

function onLogQuery(_query: string, _params: unknown[]): void {
  const scope = observationStorage.getStore();
  if (!scope) return;
  scope.queryCount += 1;
}

export function createDatabase(connectionString: string) {
  const client = postgres(connectionString, { max: 5, prepare: false });
  return drizzle(client, {
    schema,
    logger: { logQuery: onLogQuery },
  });
}

export type Database = ReturnType<typeof createDatabase>;
export type DatabaseContext = { readonly ownerId: string; readonly authUserId: string };

const ownerIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertDatabaseContext(context: DatabaseContext): void {
  if (!ownerIdPattern.test(context.ownerId)) throw new Error("Database owner context is invalid.");
  if (!context.authUserId.trim()) throw new Error("Database auth-user context is required.");
}

export async function withDatabaseContext<T>(database: Database, context: DatabaseContext, callback: (transaction: Database) => Promise<T>): Promise<T> {
  assertDatabaseContext(context);
  return database.transaction(async (transaction) => {
    await transaction.execute(sql`select set_config('app.owner_id', ${context.ownerId}, true), set_config('app.auth_user_id', ${context.authUserId}, true);`);
    return callback(transaction as unknown as Database);
  });
}

export const MISSING_WORKSPACE_ERROR_MESSAGE = "Authenticated user has no workspace.";

export async function withAuthUserContext<T>(database: Database, authUserId: string, callback: (transaction: Database) => Promise<T>): Promise<T> {
  if (!authUserId.trim()) throw new Error("Database auth-user context is required.");
  return database.transaction(async (transaction) => {
    // Must run before the lookup: the RLS policy on auth_user_workspaces reads
    // app.auth_user_id in its row quals, which are evaluated before a set_config
    // in the same statement's target list could take effect.
    await transaction.execute(sql`select set_config('app.auth_user_id', ${authUserId}, true);`);
    // The owner set_config lives in the target list so it only runs when a
    // workspace row survives RLS; a missing workspace still throws below with
    // app.owner_id unset.
    const [workspace] = await transaction.execute<{ athena_user_id: string }>(sql`
      select athena_user_id, set_config('app.owner_id', athena_user_id::text, true)
      from public.auth_user_workspaces
      where auth_user_id = ${authUserId}
      limit 1;
    `);
    if (!workspace) throw new Error(MISSING_WORKSPACE_ERROR_MESSAGE);
    return callback(transaction as unknown as Database);
  });
}

export async function withDatabaseObservation<T>(
  label: string,
  callback: () => Promise<T>,
  options?: DatabaseObservationOptions
): Promise<T> {
  if (options?.disabled || !options?.onObservation) {
    return callback();
  }

  const scope: DatabaseObservationScope = {
    label,
    startNs: nowNs(),
    queryCount: 0,
    onObservation: options.onObservation,
  };

  let outcome: DatabaseObservationOutcome = "success";

  return observationStorage.run(scope, async () => {
    try {
      return await callback();
    } catch (error) {
      outcome = "error";
      throw error;
    } finally {
      scope.onObservation?.(createObservation(scope, outcome));
    }
  });
}
