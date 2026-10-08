import { describe, expect, it } from "vitest";
import {
  CURRENT_SCHEMA_BASELINE_FILENAME,
  MIGRATION_CATALOG,
  type MigrationQueryClient,
  type MigrationRow,
} from "./catalog";
import { executeMigrationRun } from "../../../../scripts/docker/migration-runner";

type State = "empty" | "current" | "partial";

class FakeDatabase implements MigrationQueryClient {
  readonly applied: string[] = [];
  constructor(public state: State) {}

  async query<T extends MigrationRow>(query: string): Promise<readonly T[]> {
    if (this.state === "empty") return [{ count: 0 }] as unknown as readonly T[];
    const sql = query.replace(/\s+/g, " ");
    const count = sql.includes("pg_catalog.pg_tables") ? 68
      : sql.includes("pg_catalog.pg_type") ? 26
        : sql.includes("information_schema.columns") ? this.state === "partial" ? 659 : 660
          : sql.includes("pg_catalog.pg_constraint") ? 133
            : sql.includes("pg_catalog.pg_indexes")
              ? sql.includes("transfers_owner_period_date_idx") ? 7
                : sql.includes("salary_snapshots_owner_year_date_lookup_idx") ? 0 : 231
              : sql.includes("pg_catalog.pg_policy")
                ? sql.includes("athena_owner_rls") ? 57
                  : sql.includes("athena_auth_runtime") ? 9 : 5
                : sql.includes("information_schema.role_table_grants")
                  ? sql.includes("grantee = 'PUBLIC'") || sql.includes("table_name not in") ? 0
                    : sql.includes("grantee = 'athena_auth'") ? 34 : 246
                  : sql.includes("from pg_catalog.pg_roles")
                    ? sql.includes("rolsuper or rolbypassrls") ? 0 : 3
                    : sql.includes("r.rolname = 'athena_migrator'") ? 68
                      : sql.includes("pg_catalog.pg_class") ? 66 : undefined;
    if (count === undefined) throw new Error(`Unrecognized catalog query: ${sql}`);
    return [{ count }] as unknown as readonly T[];
  }

  async apply(filename: string): Promise<void> {
    if (filename !== CURRENT_SCHEMA_BASELINE_FILENAME || this.state !== "empty") {
      throw new Error(`Unexpected migration application: ${filename}`);
    }
    this.applied.push(filename);
    this.state = "current";
  }
}

async function run(database: FakeDatabase, publicTableCount = database.state === "empty" ? 0 : 68): Promise<void> {
  await executeMigrationRun({
    database,
    catalog: MIGRATION_CATALOG,
    getPublicTableCount: async () => publicTableCount,
    applyMigration: (filename) => database.apply(filename),
  });
}

describe("single-baseline migration runner", () => {
  it("applies only 0000 on an empty database", async () => {
    const database = new FakeDatabase("empty");
    await run(database);
    expect(database.applied).toEqual([CURRENT_SCHEMA_BASELINE_FILENAME]);
    expect(database.state).toBe("current");
  });

  it("accepts a current database without applying SQL", async () => {
    const database = new FakeDatabase("current");
    await run(database);
    expect(database.applied).toEqual([]);
  });

  it("refuses a partial database before applying SQL", async () => {
    const database = new FakeDatabase("partial");
    await expect(run(database)).rejects.toMatchObject({ reason: "current-database-baseline-partial" });
    expect(database.applied).toEqual([]);
  });

  it("refuses a nonempty database with a missing baseline", async () => {
    const database = new FakeDatabase("empty");
    await expect(run(database, 1)).rejects.toMatchObject({ reason: "current-database-baseline-missing" });
    expect(database.applied).toEqual([]);
  });
});
