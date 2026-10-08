import { describe, expect, it } from "vitest";
import {
  assertMigrationCatalogIntegrity,
  CURRENT_SCHEMA_BASELINE_FILENAME,
  MIGRATION_CATALOG,
  MIGRATION_FILENAMES,
  MigrationCatalogError,
  type MigrationQueryClient,
  type MigrationRow,
  planMigrationRun,
} from "./catalog";

const completeCounts = {
  tableCount: 68,
  enumCount: 26,
  columnCount: 660,
  foreignKeyCount: 133,
  indexCount: 231,
  queryPathIndexCount: 7,
  redundantOwnerIndexCount: 0,
  ownedTableCount: 68,
  rlsTableCount: 66,
  forcedRlsTableCount: 66,
  ownerPolicyCount: 57,
  authPolicyCount: 9,
  appAuthPolicyCount: 5,
  appGrantCount: 246,
  authGrantCount: 34,
  forbiddenGrantCount: 0,
  publicGrantCount: 0,
  roleCount: 3,
  unsafeRoleCount: 0,
} as const;

type Counts = { [K in keyof typeof completeCounts]: number };

function schemaDatabase(overrides: Partial<Counts> = {}): MigrationQueryClient {
  const counts: Counts = { ...completeCounts, ...overrides };
  return {
    async query<T extends MigrationRow>(query: string): Promise<readonly T[]> {
      const normalized = query.replace(/\s+/g, " ");
      const value = normalized.includes("pg_catalog.pg_tables") ? counts.tableCount
        : normalized.includes("pg_catalog.pg_type") ? counts.enumCount
        : normalized.includes("information_schema.columns") ? counts.columnCount
        : normalized.includes("pg_catalog.pg_constraint") ? counts.foreignKeyCount
        : normalized.includes("pg_catalog.pg_indexes")
          ? normalized.includes("transfers_owner_period_date_idx") ? counts.queryPathIndexCount
            : normalized.includes("salary_snapshots_owner_year_date_lookup_idx") ? counts.redundantOwnerIndexCount
              : counts.indexCount
        : normalized.includes("pg_catalog.pg_policy")
          ? normalized.includes("athena_owner_rls") ? counts.ownerPolicyCount
            : normalized.includes("athena_auth_runtime") ? counts.authPolicyCount
              : counts.appAuthPolicyCount
        : normalized.includes("from pg_catalog.pg_roles")
          ? normalized.includes("rolsuper or rolbypassrls") ? counts.unsafeRoleCount : counts.roleCount
        : normalized.includes("information_schema.role_table_grants")
          ? normalized.includes("grantee = 'PUBLIC'") ? counts.publicGrantCount
            : normalized.includes("table_name not in") ? counts.forbiddenGrantCount
              : normalized.includes("grantee = 'athena_auth'") ? counts.authGrantCount
                : counts.appGrantCount
        : normalized.includes("pg_catalog.pg_class")
          ? normalized.includes("r.rolname = 'athena_migrator'") ? counts.ownedTableCount
            : normalized.includes("relforcerowsecurity") ? counts.forcedRlsTableCount
              : counts.rlsTableCount
        : undefined;
      if (value === undefined) throw new Error(`Unrecognized catalog query: ${normalized}`);
      return [{ count: value }] as unknown as readonly T[];
    },
  };
}

const emptySchema: Partial<Counts> = Object.fromEntries(
  Object.keys(completeCounts).filter((key) => key !== "roleCount").map((key) => [key, 0]),
) as Partial<Counts>;

describe("single current-schema baseline catalog", () => {
  const baseline = MIGRATION_CATALOG[0]!;

  it("registers exactly one 0000 migration", () => {
    expect(() => assertMigrationCatalogIntegrity()).not.toThrow();
    expect(MIGRATION_FILENAMES).toEqual([CURRENT_SCHEMA_BASELINE_FILENAME]);
    expect(MIGRATION_CATALOG.map(({ id, filename }) => ({ id, filename }))).toEqual([
      { id: "0000", filename: "0000_current_schema_baseline.sql" },
    ]);
  });

  it("recognizes the final inventory, including indexes, RLS, roles, and grants", async () => {
    await expect(baseline.inspect(schemaDatabase())).resolves.toEqual({
      state: "complete",
      details: completeCounts,
    });
  });

  it("recognizes an empty schema even when runtime roles are provisioned", async () => {
    await expect(baseline.inspect(schemaDatabase(emptySchema))).resolves.toMatchObject({ state: "missing" });
  });

  it.each([
    ["table", { tableCount: 67 }],
    ["enum", { enumCount: 25 }],
    ["column", { columnCount: 659 }],
    ["foreign key", { foreignKeyCount: 132 }],
    ["index", { indexCount: 230 }],
    ["query-path index", { queryPathIndexCount: 6 }],
    ["redundant owner index", { redundantOwnerIndexCount: 1 }],
    ["ownership", { ownedTableCount: 67 }],
    ["RLS", { rlsTableCount: 65 }],
    ["forced RLS", { forcedRlsTableCount: 65 }],
    ["owner policy", { ownerPolicyCount: 56 }],
    ["auth policy", { authPolicyCount: 8 }],
    ["app auth policy", { appAuthPolicyCount: 4 }],
    ["app grant", { appGrantCount: 245 }],
    ["auth grant", { authGrantCount: 33 }],
    ["forbidden grant", { forbiddenGrantCount: 1 }],
    ["public grant", { publicGrantCount: 1 }],
    ["role", { roleCount: 2 }],
    ["unsafe role", { unsafeRoleCount: 1 }],
  ] as const)("rejects a partial inventory: %s", async (_label, override) => {
    await expect(baseline.inspect(schemaDatabase(override))).resolves.toMatchObject({ state: "partial" });
  });

  it("does not call a database with only a grant empty", async () => {
    await expect(baseline.inspect(schemaDatabase({ ...emptySchema, publicGrantCount: 1 })))
      .resolves.toMatchObject({ state: "partial" });
  });

  it("plans empty and current databases and fails closed on inconsistent states", () => {
    expect(planMigrationRun(0, "missing")).toEqual({ mode: "empty", applyBaseline: true, applyFutureMigrations: true });
    expect(planMigrationRun(68, "complete")).toEqual({ mode: "current", applyBaseline: false, applyFutureMigrations: true });
    expect(() => planMigrationRun(1, "missing")).toThrow(new MigrationCatalogError("current-database-baseline-missing"));
    expect(() => planMigrationRun(68, "partial")).toThrow(new MigrationCatalogError("current-database-baseline-partial"));
    expect(() => planMigrationRun(0, "complete")).toThrow(new MigrationCatalogError("unexpected-empty-database-baseline-state"));
    expect(() => planMigrationRun(-1, "missing")).toThrow(new MigrationCatalogError("invalid-public-table-count"));
  });

  it("verifies only complete outcomes and valid application transitions", async () => {
    const missing = await baseline.inspect(schemaDatabase(emptySchema));
    const complete = await baseline.inspect(schemaDatabase());
    const partial = await baseline.inspect(schemaDatabase({ indexCount: 230 }));
    await expect(baseline.verify(schemaDatabase(), { before: missing, after: complete, applied: true })).resolves.toBeUndefined();
    await expect(baseline.verify(schemaDatabase(), { before: complete, after: complete, applied: false })).resolves.toBeUndefined();
    await expect(baseline.verify(schemaDatabase(), { before: missing, after: partial, applied: true }))
      .rejects.toMatchObject({ reason: "current-schema-baseline" });
    await expect(baseline.verify(schemaDatabase(), { before: complete, after: complete, applied: true }))
      .rejects.toMatchObject({ reason: "current-schema-baseline-apply-state" });
  });

  it("fails closed when a catalog query has no usable count", async () => {
    await expect(baseline.inspect({ query: async () => [] })).rejects.toMatchObject({ reason: "invalid-catalog-query" });
  });
});
