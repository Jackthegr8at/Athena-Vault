import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import {
  CURRENT_SCHEMA_BASELINE_ID,
  MIGRATION_CATALOG,
  type MigrationDetails,
  type MigrationInspection,
  type MigrationQueryClient,
  type MigrationRow,
} from "../../packages/database/src/migrations/catalog";

type VerificationReason =
  | "missing-database-url"
  | "invalid-database-url"
  | "missing-current-schema-baseline"
  | "current-schema-baseline"
  | "app-owner-isolation"
  | "app-auth-boundary"
  | "auth-role-access"
  | "auth-role-boundary"
  | "database-check"
  | "database-close";

export class DatabaseVerificationError extends Error {
  constructor(readonly reason: VerificationReason) {
    super(reason);
    this.name = "DatabaseVerificationError";
  }
}

export interface ReadOnlyVerificationTransaction extends MigrationQueryClient {
  savepoint(work: (transaction: MigrationQueryClient) => Promise<void>): Promise<void>;
}

export interface ReadOnlyVerificationDatabase {
  readOnly(work: (transaction: ReadOnlyVerificationTransaction) => Promise<void>): Promise<void>;
}

export type BaselineInspector = (
  database: MigrationQueryClient,
) => Promise<MigrationInspection<MigrationDetails>>;

async function inspectCurrentPublicBaseline(
  database: MigrationQueryClient,
): Promise<MigrationInspection<MigrationDetails>> {
  const baseline = MIGRATION_CATALOG.find((migration) => migration.id === CURRENT_SCHEMA_BASELINE_ID);
  if (!baseline) throw new DatabaseVerificationError("missing-current-schema-baseline");
  return baseline.inspect(database);
}

function isInsufficientPrivilege(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { readonly code?: unknown }).code === "42501";
}

async function assertDeniedByPrivileges(
  transaction: ReadOnlyVerificationTransaction,
  statement: string,
  reason: "app-auth-boundary" | "auth-role-boundary",
): Promise<void> {
  try {
    await transaction.savepoint(async (savepoint) => {
      await savepoint.query(statement);
    });
  } catch (error) {
    if (isInsufficientPrivilege(error)) return;
    throw new DatabaseVerificationError(reason);
  }
  throw new DatabaseVerificationError(reason);
}

export async function verifyPublicDatabase(
  database: ReadOnlyVerificationDatabase,
  inspectBaseline: BaselineInspector = inspectCurrentPublicBaseline,
): Promise<void> {
  let baseline: MigrationInspection<MigrationDetails> | undefined;
  await database.readOnly(async (transaction) => {
    baseline = await inspectBaseline(transaction);
  });
  if (baseline?.state !== "complete") throw new DatabaseVerificationError("current-schema-baseline");

  await database.readOnly(async (transaction) => {
    await transaction.query("SET LOCAL ROLE athena_app;");
    await transaction.query("SELECT set_config('app.owner_id', '', true);");

    const [visibleAccounts] = await transaction.query<{ readonly hasVisibleAccounts: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM public.accounts) AS \"hasVisibleAccounts\";",
    );
    if (visibleAccounts?.hasVisibleAccounts !== false) {
      throw new DatabaseVerificationError("app-owner-isolation");
    }

    await assertDeniedByPrivileges(
      transaction,
      "SELECT 1 FROM public.auth_verifications LIMIT 0;",
      "app-auth-boundary",
    );
  });

  await database.readOnly(async (transaction) => {
    await transaction.query("SET LOCAL ROLE athena_auth;");
    let authAccess: { readonly canReadAuthUsers: boolean } | undefined;
    try {
      [authAccess] = await transaction.query<{ readonly canReadAuthUsers: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM public.auth_users) AS \"canReadAuthUsers\";",
      );
    } catch {
      throw new DatabaseVerificationError("auth-role-access");
    }
    if (typeof authAccess?.canReadAuthUsers !== "boolean") {
      throw new DatabaseVerificationError("auth-role-access");
    }

    await assertDeniedByPrivileges(
      transaction,
      "SELECT 1 FROM public.accounts LIMIT 0;",
      "auth-role-boundary",
    );
  });
}

function postgresVerificationDatabase(connection: ReturnType<typeof postgres>): ReadOnlyVerificationDatabase {
  return {
    readOnly: async (work) => {
      await connection.begin(async (transaction) => {
        await transaction.unsafe("SET TRANSACTION READ ONLY;");
        await work({
          query: async <T extends MigrationRow = MigrationRow>(statement: string) =>
            await transaction.unsafe(statement) as readonly T[],
          savepoint: async (savepointWork) => {
            await transaction.savepoint(async (savepoint) => {
              await savepointWork({
                query: async <T extends MigrationRow = MigrationRow>(statement: string) =>
                  await savepoint.unsafe(statement) as readonly T[],
              });
            });
          },
        });
      });
    },
  };
}

async function run(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error("database-verify=status=failed reason=missing-database-url");
    process.exitCode = 1;
    return;
  }
  if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
    console.error("database-verify=status=failed reason=invalid-database-url");
    process.exitCode = 1;
    return;
  }

  const connection = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 5,
    idle_timeout: 5,
  });
  try {
    await verifyPublicDatabase(postgresVerificationDatabase(connection));
    console.log("database-verify=status=passed checks=public-schema,owner-isolation,role-boundaries");
  } catch (error) {
    const reason = error instanceof DatabaseVerificationError ? error.reason : "database-check";
    console.error(`database-verify=status=failed reason=${reason}`);
    process.exitCode = 1;
  } finally {
    try {
      await connection.end({ timeout: 5 });
    } catch {
      console.error("database-verify=status=failed reason=database-close");
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  void run();
}
