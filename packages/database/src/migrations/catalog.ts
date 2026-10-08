export type MigrationState = "missing" | "complete" | "partial";
export type MigrationRow = Readonly<Record<string, unknown>>;
export type MigrationDetails = Readonly<Record<string, unknown>>;

export interface MigrationQueryClient {
  query<T extends MigrationRow = MigrationRow>(query: string): Promise<readonly T[]>;
}

export interface MigrationInspection<TDetails extends MigrationDetails = MigrationDetails> {
  readonly state: MigrationState;
  readonly details: TDetails;
}

export interface MigrationVerification<TDetails extends MigrationDetails = MigrationDetails> {
  readonly before: MigrationInspection<TDetails>;
  readonly after: MigrationInspection<TDetails>;
  readonly applied: boolean;
}

export interface MigrationCatalogEntry<TDetails extends MigrationDetails = MigrationDetails> {
  readonly id: string;
  readonly filename: string;
  readonly inspect: (database: MigrationQueryClient) => Promise<MigrationInspection<TDetails>>;
  readonly verify: (database: MigrationQueryClient, verification: MigrationVerification<TDetails>) => Promise<void>;
}

export class MigrationCatalogError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "MigrationCatalogError";
    this.reason = reason;
  }
}

export function classifySchemaState(isMissing: boolean, isComplete: boolean): MigrationState {
  if (isMissing) return "missing";
  if (isComplete) return "complete";
  return "partial";
}

async function count(database: MigrationQueryClient, query: string): Promise<number> {
  const [row] = await database.query<{ readonly count: number | string | bigint }>(query);
  const value = Number(row?.count);
  if (!Number.isSafeInteger(value) || value < 0) throw new MigrationCatalogError("invalid-catalog-query");
  return value;
}

function sqlNames(names: readonly string[]): string {
  return names.map((name) => `'${name}'`).join(",");
}

export const CURRENT_SCHEMA_BASELINE_ID = "0000";
export const CURRENT_SCHEMA_BASELINE_FILENAME = "0000_current_schema_baseline.sql";

// Inventories are the objects emitted by the public one-file baseline, not the
// historical private chain. Counts below include its final 0060/0061 state.
const tableNames = [
  "account_balance_notes", "account_contribution_exceptions", "account_contribution_rules",
  "account_groups", "accounts", "annual_budgets", "annual_expense_payments",
  "annual_expense_values", "annual_expenses", "annual_maintenance_items", "audit_events",
  "auth_accounts", "auth_invitations", "auth_rate_limits", "auth_sessions",
  "auth_user_workspaces", "auth_users", "auth_verifications", "balance_snapshots",
  "cash_flow_payday_checks", "cash_flow_periods", "contribution_limits", "envelopes",
  "financial_goals", "home_mortgage_anchors", "home_mortgage_terms",
  "home_value_snapshots", "homes", "household_expenses", "import_batches",
  "institutions", "investment_accounts",
  "investment_projection_project_account_schedule_overrides",
  "investment_projection_project_account_schedules", "investment_projection_project_accounts",
  "investment_projection_project_rates", "investment_projection_projects",
  "investment_scenarios", "investment_snapshots", "liabilities", "migration_issues",
  "recurring_cash_flow_occurrence_exceptions", "recurring_cash_flow_override_groups",
  "recurring_cash_flow_series", "recurring_transactions", "rrq_year_limit_overrides",
  "rrq_year_limits", "salary_scenarios", "salary_snapshots", "salary_years",
  "shared_project_expenses", "shared_project_participants", "shared_projects",
  "source_references", "transactions", "transfers", "users", "auth_two_factors",
  "calculation_workbooks", "page_help_seen", "workspace_primary_owner", "passkey",
  "owner_notifications", "investment_holdings", "investment_holding_transactions",
  "investment_holding_prices", "investment_fx_rates", "financial_goal_plans",
] as const;

const enumNames = [
  "account_contribution_exception_kind", "account_kind", "audit_action",
  "cash_flow_period_status", "contribution_limit_kind", "currency_code", "goal_status",
  "home_mortgage_compounding", "import_batch_status", "investment_account_kind",
  "investment_holding_instrument_type", "investment_holding_transaction_kind",
  "investment_quote_source", "liability_kind", "liability_status",
  "migration_issue_severity", "record_status", "recurring_cash_flow_kind",
  "recurring_frequency", "recurring_occurrence_exception_kind", "recurring_series_state",
  "recurring_weekday_adjustment", "salary_year_status", "scenario_status",
  "source_mapping_status", "transaction_kind",
] as const;

const authTableNames = [
  "auth_users", "auth_sessions", "auth_accounts", "auth_verifications",
  "auth_rate_limits", "auth_two_factors", "auth_invitations", "auth_user_workspaces",
] as const;
const nonOwnerTableNames = [...authTableNames, "users", "workspace_primary_owner", "rrq_year_limits", "passkey"] as const;
const ownerTableNames = tableNames.filter((name) => !(nonOwnerTableNames as readonly string[]).includes(name));
const ownerPolicyTableNames = [...ownerTableNames, "users"];
const rlsTableNames = [...ownerPolicyTableNames, ...authTableNames, "passkey"];

const queryPathIndexNames = [
  "transfers_owner_period_date_idx", "cash_flow_periods_owner_paydate_idx",
  "rcfoe_owner_transaction_idx", "rcfoe_owner_transfer_idx",
  "rcfoe_owner_override_group_idx", "audit_events_owner_batch_idx",
  "owner_notifications_owner_unread_idx",
] as const;
const redundantOwnerIndexNames = [
  "account_balance_notes_owner_idx", "account_groups_owner_idx",
  "annual_budgets_owner_idx", "annual_expense_payments_owner_idx", "envelopes_owner_idx",
  "financial_goals_owner_idx", "household_expenses_owner_idx", "institutions_owner_idx",
  "investment_accounts_owner_idx", "investment_projection_project_accounts_owner_idx",
  "investment_projection_project_rates_owner_idx", "investment_projection_projects_owner_idx",
  "investment_scenarios_owner_idx", "liabilities_owner_idx",
  "rrq_year_limit_overrides_owner_idx", "investment_holdings_owner_idx",
  "investment_holding_transactions_owner_idx", "investment_holding_prices_owner_idx",
  "investment_fx_rates_owner_idx", "salary_snapshots_owner_year_date_lookup_idx",
] as const;

export interface CurrentSchemaBaselineDetails extends MigrationDetails {
  readonly tableCount: number;
  readonly enumCount: number;
  readonly columnCount: number;
  readonly foreignKeyCount: number;
  readonly indexCount: number;
  readonly queryPathIndexCount: number;
  readonly redundantOwnerIndexCount: number;
  readonly ownedTableCount: number;
  readonly rlsTableCount: number;
  readonly forcedRlsTableCount: number;
  readonly ownerPolicyCount: number;
  readonly authPolicyCount: number;
  readonly appAuthPolicyCount: number;
  readonly appGrantCount: number;
  readonly authGrantCount: number;
  readonly forbiddenGrantCount: number;
  readonly publicGrantCount: number;
  readonly roleCount: number;
  readonly unsafeRoleCount: number;
}

async function inspectCurrentSchema(database: MigrationQueryClient): Promise<MigrationInspection<CurrentSchemaBaselineDetails>> {
  const tables = sqlNames(tableNames);
  const owners = sqlNames(ownerPolicyTableNames);
  const rlsTables = sqlNames(rlsTableNames);
  const [tableCount, enumCount, columnCount, foreignKeyCount, indexCount,
    queryPathIndexCount, redundantOwnerIndexCount, ownedTableCount,
    rlsTableCount, forcedRlsTableCount, ownerPolicyCount, authPolicyCount,
    appAuthPolicyCount, appGrantCount, authGrantCount, forbiddenGrantCount,
    publicGrantCount, roleCount, unsafeRoleCount] = await Promise.all([
    count(database, `select count(*) from pg_catalog.pg_tables where schemaname = 'public' and tablename in (${tables});`),
    count(database, `select count(*) from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typtype = 'e' and t.typname in (${sqlNames(enumNames)});`),
    count(database, `select count(*) from information_schema.columns where table_schema = 'public' and table_name in (${tables});`),
    count(database, `select count(*) from pg_catalog.pg_constraint c join pg_catalog.pg_class t on t.oid = c.conrelid join pg_catalog.pg_namespace n on n.oid = t.relnamespace where n.nspname = 'public' and t.relname in (${tables}) and c.contype = 'f' and c.convalidated;`),
    count(database, `select count(*) from pg_catalog.pg_indexes where schemaname = 'public' and tablename in (${tables});`),
    count(database, `select count(*) from pg_catalog.pg_indexes where schemaname = 'public' and indexname in (${sqlNames(queryPathIndexNames)});`),
    count(database, `select count(*) from pg_catalog.pg_indexes where schemaname = 'public' and indexname in (${sqlNames(redundantOwnerIndexNames)});`),
    count(database, `select count(*) from pg_catalog.pg_class t join pg_catalog.pg_namespace n on n.oid = t.relnamespace join pg_catalog.pg_roles r on r.oid = t.relowner where n.nspname = 'public' and t.relkind = 'r' and t.relname in (${tables}) and r.rolname = 'athena_migrator';`),
    count(database, `select count(*) from pg_catalog.pg_class t join pg_catalog.pg_namespace n on n.oid = t.relnamespace where n.nspname = 'public' and t.relkind = 'r' and t.relname in (${rlsTables}) and t.relrowsecurity;`),
    count(database, `select count(*) from pg_catalog.pg_class t join pg_catalog.pg_namespace n on n.oid = t.relnamespace where n.nspname = 'public' and t.relkind = 'r' and t.relname in (${rlsTables}) and t.relforcerowsecurity;`),
    count(database, `select count(*) from pg_catalog.pg_policy p join pg_catalog.pg_class t on t.oid = p.polrelid join pg_catalog.pg_namespace n on n.oid = t.relnamespace join pg_catalog.pg_roles r on r.rolname = 'athena_app' where n.nspname = 'public' and t.relname in (${owners}) and p.polname = 'athena_owner_rls' and p.polcmd = '*' and p.polroles @> array[r.oid] and pg_get_expr(p.polqual, p.polrelid) ilike '%nullif%' and pg_get_expr(p.polwithcheck, p.polrelid) ilike '%nullif%';`),
    count(database, `select count(*) from pg_catalog.pg_policy p join pg_catalog.pg_class t on t.oid = p.polrelid join pg_catalog.pg_namespace n on n.oid = t.relnamespace join pg_catalog.pg_roles r on r.rolname = 'athena_auth' where n.nspname = 'public' and t.relname in (${sqlNames([...authTableNames, "passkey"])}) and p.polname = 'athena_auth_runtime' and p.polcmd = '*' and p.polroles @> array[r.oid];`),
    count(database, `select count(*) from pg_catalog.pg_policy p join pg_catalog.pg_class t on t.oid = p.polrelid join pg_catalog.pg_namespace n on n.oid = t.relnamespace join pg_catalog.pg_roles r on r.rolname = 'athena_app' where n.nspname = 'public' and t.relname in ('auth_sessions','auth_users','auth_accounts','auth_user_workspaces','auth_invitations') and p.polname = 'athena_app_auth_user' and p.polcmd = '*' and p.polroles @> array[r.oid] and pg_get_expr(p.polqual, p.polrelid) ilike '%nullif%' and pg_get_expr(p.polwithcheck, p.polrelid) ilike '%nullif%';`),
    count(database, `select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in (${tables}) and grantee = 'athena_app' and privilege_type in ('SELECT','INSERT','UPDATE','DELETE');`),
    count(database, `select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in (${tables}) and grantee = 'athena_auth' and privilege_type in ('SELECT','INSERT','UPDATE','DELETE');`),
    count(database, `select count(*) from information_schema.role_table_grants where table_schema = 'public' and ((grantee = 'athena_app' and ((table_name in ('passkey','auth_verifications','auth_rate_limits','auth_two_factors') and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')) or (table_name = 'rrq_year_limits' and privilege_type in ('INSERT','UPDATE','DELETE')) or (table_name = 'users' and privilege_type = 'DELETE') or (table_name = 'page_help_seen' and privilege_type in ('UPDATE','DELETE')))) or (grantee = 'athena_auth' and table_name not in (${sqlNames([...authTableNames, "passkey"])})));`),
    count(database, `select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in (${tables}) and grantee = 'PUBLIC';`),
    count(database, "select count(*) from pg_catalog.pg_roles where rolname in ('athena_app','athena_migrator','athena_auth');"),
    count(database, "select count(*) from pg_catalog.pg_roles where rolname in ('athena_app','athena_auth') and (rolsuper or rolbypassrls);"),
  ]);
  const details: CurrentSchemaBaselineDetails = {
    tableCount, enumCount, columnCount, foreignKeyCount, indexCount,
    queryPathIndexCount, redundantOwnerIndexCount, ownedTableCount,
    rlsTableCount, forcedRlsTableCount, ownerPolicyCount, authPolicyCount,
    appAuthPolicyCount, appGrantCount, authGrantCount, forbiddenGrantCount,
    publicGrantCount, roleCount, unsafeRoleCount,
  };
  // Role provisioning may precede schema creation. No schema object or grant
  // means the database is still eligible for the fresh-install baseline.
  const missing = tableCount === 0 && enumCount === 0 && columnCount === 0
    && foreignKeyCount === 0 && indexCount === 0 && ownedTableCount === 0
    && rlsTableCount === 0 && forcedRlsTableCount === 0 && ownerPolicyCount === 0
    && authPolicyCount === 0 && appAuthPolicyCount === 0
    && appGrantCount === 0 && authGrantCount === 0 && forbiddenGrantCount === 0
    && publicGrantCount === 0 && queryPathIndexCount === 0 && redundantOwnerIndexCount === 0;
  const complete = tableCount === tableNames.length && enumCount === enumNames.length
    && columnCount === 660 && foreignKeyCount === 133 && indexCount === 231
    && queryPathIndexCount === queryPathIndexNames.length && redundantOwnerIndexCount === 0
    && ownedTableCount === tableNames.length && rlsTableCount === rlsTableNames.length
    && forcedRlsTableCount === rlsTableNames.length
    && ownerPolicyCount === ownerPolicyTableNames.length && authPolicyCount === 9
    && appAuthPolicyCount === 5 && appGrantCount === 246 && authGrantCount === 34
    && forbiddenGrantCount === 0 && publicGrantCount === 0
    && roleCount === 3 && unsafeRoleCount === 0;
  return { state: classifySchemaState(missing, complete), details };
}

export type MigrationRunMode = "empty" | "current";
export interface MigrationRunPlan {
  readonly mode: MigrationRunMode;
  readonly applyBaseline: boolean;
  readonly applyFutureMigrations: boolean;
}

export function planMigrationRun(publicTableCount: number, baselineState: MigrationState): MigrationRunPlan {
  if (!Number.isInteger(publicTableCount) || publicTableCount < 0) throw new MigrationCatalogError("invalid-public-table-count");
  if (publicTableCount === 0) {
    if (baselineState !== "missing") throw new MigrationCatalogError("unexpected-empty-database-baseline-state");
    return { mode: "empty", applyBaseline: true, applyFutureMigrations: true };
  }
  if (baselineState === "complete") return { mode: "current", applyBaseline: false, applyFutureMigrations: true };
  if (baselineState === "missing") throw new MigrationCatalogError("current-database-baseline-missing");
  throw new MigrationCatalogError("current-database-baseline-partial");
}

export const MIGRATION_CATALOG: readonly MigrationCatalogEntry<MigrationDetails>[] = [{
  id: CURRENT_SCHEMA_BASELINE_ID,
  filename: CURRENT_SCHEMA_BASELINE_FILENAME,
  inspect: inspectCurrentSchema,
  async verify(_database, verification) {
    if (verification.after.state !== "complete") throw new MigrationCatalogError("current-schema-baseline");
    if (verification.applied && verification.before.state !== "missing") {
      throw new MigrationCatalogError("current-schema-baseline-apply-state");
    }
  },
}];
export const MIGRATION_FILENAMES = MIGRATION_CATALOG.map((migration) => migration.filename);

export function assertMigrationCatalogIntegrity(): void {
  if (MIGRATION_CATALOG.length !== 1 || MIGRATION_CATALOG[0]?.id !== CURRENT_SCHEMA_BASELINE_ID
    || MIGRATION_CATALOG[0]?.filename !== CURRENT_SCHEMA_BASELINE_FILENAME) {
    throw new MigrationCatalogError("invalid-public-baseline-catalog");
  }
}

assertMigrationCatalogIntegrity();
