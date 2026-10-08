import {
  CURRENT_SCHEMA_BASELINE_ID,
  MIGRATION_CATALOG,
  MigrationCatalogError,
  type MigrationCatalogEntry,
  type MigrationDetails,
  type MigrationQueryClient,
  type MigrationVerification,
  planMigrationRun,
} from "../../packages/database/src/migrations/catalog";

export interface MigrationRunnerDependencies {
  readonly database: MigrationQueryClient;
  readonly getPublicTableCount: () => Promise<number>;
  readonly applyMigration: (filename: string) => Promise<void>;
  readonly catalog?: readonly MigrationCatalogEntry<MigrationDetails>[];
  readonly log?: (message: string) => void;
}

async function verifyMigration(
  migration: MigrationCatalogEntry<MigrationDetails>,
  database: MigrationQueryClient,
  verification: MigrationVerification<MigrationDetails>,
): Promise<void> {
  await migration.verify(database, verification);
}

async function verifyBaseline(
  migration: MigrationCatalogEntry<MigrationDetails>,
  database: MigrationQueryClient,
  before: Awaited<ReturnType<MigrationCatalogEntry<MigrationDetails>["inspect"]>>,
  applied: boolean,
): Promise<void> {
  const after = await migration.inspect(database);
  if (after.state !== "complete") throw new MigrationCatalogError("current-schema-baseline-verification-failed");
  await verifyMigration(migration, database, { before, after, applied });
}

async function applyFutureMigrations(
  dependencies: Pick<MigrationRunnerDependencies, "database" | "applyMigration" | "log">,
  catalog: readonly MigrationCatalogEntry<MigrationDetails>[],
): Promise<void> {
  const log = dependencies.log ?? (() => undefined);
  for (const migration of catalog) {
    if (migration.id === CURRENT_SCHEMA_BASELINE_ID) continue;

    const before = await migration.inspect(dependencies.database);
    if (before.state === "partial") throw new MigrationCatalogError("partial-future-migration");
    const applied = before.state === "missing";
    if (applied) {
      log(`migration=${migration.id} status=applying`);
      await dependencies.applyMigration(migration.filename);
    }

    const after = await migration.inspect(dependencies.database);
    if (after.state !== "complete") throw new MigrationCatalogError("future-migration-verification-failed");
    await verifyMigration(migration, dependencies.database, { before, after, applied });
    log(`migration=${migration.id} status=verified`);
  }
}

export async function executeMigrationRun(dependencies: MigrationRunnerDependencies): Promise<void> {
  const catalog = dependencies.catalog ?? MIGRATION_CATALOG;
  const log = dependencies.log ?? (() => undefined);
  const baseline = catalog.find((migration) => migration.id === CURRENT_SCHEMA_BASELINE_ID);
  if (!baseline) throw new MigrationCatalogError("missing-current-schema-baseline");

  const before = await baseline.inspect(dependencies.database);
  const plan = planMigrationRun(await dependencies.getPublicTableCount(), before.state);

  if (plan.mode === "empty") {
    log(`migration=${baseline.id} status=applying mode=empty`);
    await dependencies.applyMigration(baseline.filename);
    await verifyBaseline(baseline, dependencies.database, before, true);
    log(`migration=${baseline.id} status=bootstrapped mode=empty`);
    if (plan.applyFutureMigrations) {
      await applyFutureMigrations(dependencies, catalog);
    }
    log("migration=all status=verified mode=empty");
    return;
  }

  await verifyBaseline(baseline, dependencies.database, before, false);
  log(`migration=${baseline.id} status=verified mode=current`);
  if (plan.applyFutureMigrations) {
    await applyFutureMigrations(dependencies, catalog);
  }
  log("migration=all status=verified mode=current");
}
