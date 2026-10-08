import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import {
  CURRENT_SCHEMA_BASELINE_ID,
  MIGRATION_CATALOG,
  type MigrationQueryClient,
  type MigrationRow,
} from "../../packages/database/src/migrations/catalog";
import { executeMigrationRun } from "./migration-runner";
import { logOperationalFailure } from "../../apps/web/lib/server/security-logging";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationDirectory = path.join(projectRoot, "packages", "database", "drizzle");
const readinessAttempts = 30;
const readinessDelayMs = 2_000;

class MigrationRunnerError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "MigrationRunnerError";
    this.reason = reason;
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new MigrationRunnerError("missing-database-url");
  if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) throw new MigrationRunnerError("invalid-database-url");
  return databaseUrl;
}

async function waitForDatabase(database: MigrationQueryClient): Promise<void> {
  for (let attempt = 1; attempt <= readinessAttempts; attempt += 1) {
    try {
      await database.query("select 1 as ready;");
      console.log("database=status=ready");
      return;
    } catch {
      if (attempt === readinessAttempts) throw new MigrationRunnerError("database-not-ready");
      await sleep(readinessDelayMs);
    }
  }
}

async function applyMigration(sql: ReturnType<typeof postgres>, filename: string): Promise<void> {
  const contents = await readFile(path.join(migrationDirectory, filename), "utf8");
  await sql.begin(async (transaction) => {
    if (process.env.ATHENA_DB_PASSWORD) {
      await transaction`SELECT set_config('app.athena_app_password', ${process.env.ATHENA_DB_PASSWORD}, true)`;
    }
    if (!process.env.ATHENA_AUTH_ROLE_PASSWORD) throw new MigrationRunnerError("missing-athena-auth-role-password");
    await transaction`SELECT set_config('app.athena_auth_password', ${process.env.ATHENA_AUTH_ROLE_PASSWORD}, true)`;
    await transaction.unsafe(contents);
  });
}

async function publicTableCount(database: MigrationQueryClient): Promise<number> {
  const [row] = await database.query<{ readonly count: number | string | bigint }>(
    "select count(*) from pg_catalog.pg_tables where schemaname = 'public';",
  );
  const value = Number(row?.count);
  if (!Number.isInteger(value) || value < 0) throw new MigrationRunnerError("invalid-public-table-count");
  return value;
}

async function run(): Promise<void> {
  let sql: ReturnType<typeof postgres> | undefined;
  let currentMigrationId: string | undefined;
  try {
    const databaseUrl = requireDatabaseUrl();
    sql = postgres(databaseUrl, {
      max: 1,
      prepare: false,
      connect_timeout: 5,
      idle_timeout: 10,
    });
    const database: MigrationQueryClient = {
      query: async <T extends MigrationRow>(query: string) => await sql!.unsafe<T[]>(query) as unknown as readonly T[],
    };
    await waitForDatabase(database);

    const baseline = MIGRATION_CATALOG.find((migration) => migration.id === CURRENT_SCHEMA_BASELINE_ID);
    if (!baseline) throw new MigrationRunnerError("missing-current-schema-baseline");
    currentMigrationId = baseline.id;
    if (MIGRATION_CATALOG.length !== 1) throw new MigrationRunnerError("public-migration-catalog-not-single-baseline");
    const existingTableCount = await publicTableCount(database);
    if (existingTableCount > 0 && (await baseline.inspect(database)).state !== "complete") {
      throw new MigrationRunnerError("nonempty-database-not-final-public-baseline");
    }

    await executeMigrationRun({
      database,
      getPublicTableCount: () => publicTableCount(database),
      applyMigration: (filename) => applyMigration(sql!, filename),
      catalog: MIGRATION_CATALOG,
      log: console.log,
    });
  } catch (error) {
    logOperationalFailure({
      operation: "migration.run",
      error,
      status: "failed",
      failureCode: currentMigrationId ? "MIGRATION_FAILED" : "MIGRATION_INIT_FAILED",
    });
    process.exitCode = 1;
  } finally {
    if (sql) {
      try {
        await sql.end({ timeout: 5 });
      } catch (error) {
        logOperationalFailure({
          operation: "migration.run",
          error,
          status: "unavailable",
          failureCode: "MIGRATION_CLOSE_FAILED",
        });
        process.exitCode = 1;
      }
    }
  }
}

void run();
