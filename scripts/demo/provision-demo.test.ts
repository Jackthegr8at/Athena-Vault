import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("postgres", () => ({ default: vi.fn() }));
vi.mock("better-auth/crypto", () => ({ hashPassword: vi.fn(), verifyPassword: vi.fn() }));

import { assertDemoTargetConfirmation, DEMO_FIXTURE, loadEnvironment, normalized } from "./provision-demo";

const provisionerSource = readFileSync(new URL("./provision-demo.ts", import.meta.url), "utf8");
const composeSource = readFileSync(new URL("../../docker-compose.yml", import.meta.url), "utf8");
const productionComposeSource = readFileSync(new URL("../../docker-compose.prod.yml", import.meta.url), "utf8");

describe("demo fixture contract", () => {
  it("is deterministic and contains only synthetic owner-scoped rows", () => {
    expect(provisionerSource).toContain("export const DEMO_FIXTURE_VERSION = 5;");
    expect(provisionerSource).toContain("const DEMO_ID_VERSION = 1;");
    expect((provisionerSource.match(/key: \"demo-/g) ?? []).length).toBeGreaterThan(20);
    expect(provisionerSource.toLowerCase()).not.toMatch(/budget\.xlsx|production data|real user/);
  });

  it("contains a broad account mix without dedicated Other account sections", () => {
    const accounts = DEMO_FIXTURE.find((group) => group.table === "accounts")?.rows ?? [];
    const kinds = accounts.map((row) => row.values.kind);
    expect(kinds.filter((kind) => kind === "credit")).toHaveLength(2);
    expect(kinds).toEqual(expect.arrayContaining(["loan", "rrsp", "tfsa", "fhsa", "non_registered"]));
    expect(kinds.filter((kind) => kind === "other")).toHaveLength(0);
    expect(accounts.every((row) => !Object.hasOwn(row.values, "group_id"))).toBe(true);
  });

  it("contains several recurring income and expense examples", () => {
    const series = DEMO_FIXTURE.find((group) => group.table === "recurring_cash_flow_series")?.rows ?? [];
    const recurring = DEMO_FIXTURE.find((group) => group.table === "recurring_transactions")?.rows ?? [];
    expect(series.filter((row) => row.values.kind === "income")).toHaveLength(3);
    expect(series.filter((row) => row.values.kind === "expense")).toHaveLength(7);
    expect(series.filter((row) => row.values.kind === "transfer")).toHaveLength(1);
    expect(recurring.length).toBeGreaterThan(8);
  });

  it("includes the cross-module examples used by the demo walkthrough", () => {
    const maintenance = DEMO_FIXTURE.find((group) => group.table === "annual_maintenance_items")?.rows ?? [];
    const householdExpenses = DEMO_FIXTURE.find((group) => group.table === "household_expenses")?.rows ?? [];
    const annualExpenses = DEMO_FIXTURE.find((group) => group.table === "annual_expenses")?.rows ?? [];
    const annualValues = DEMO_FIXTURE.find((group) => group.table === "annual_expense_values")?.rows ?? [];
    const annualPayments = DEMO_FIXTURE.find((group) => group.table === "annual_expense_payments")?.rows ?? [];
    const series = DEMO_FIXTURE.find((group) => group.table === "recurring_cash_flow_series")?.rows ?? [];
    const recurring = DEMO_FIXTURE.find((group) => group.table === "recurring_transactions")?.rows ?? [];
    const exceptions = DEMO_FIXTURE.find((group) => group.table === "recurring_cash_flow_occurrence_exceptions")?.rows ?? [];
    const transfers = DEMO_FIXTURE.find((group) => group.table === "transfers")?.rows ?? [];
    const salaryYears = DEMO_FIXTURE.find((group) => group.table === "salary_years")?.rows ?? [];

    expect(maintenance).toHaveLength(2);
    expect(householdExpenses).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "demo-annual-maintenance-summary" }),
    ]));
    expect(annualExpenses.filter((row) => row.values.name === "Demo property tax")).toHaveLength(2);
    expect(annualValues).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "demo-property-tax-value-2027" }),
      expect.objectContaining({ key: "demo-property-tax-follow-up-value" }),
    ]));
    expect(annualPayments).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "demo-property-tax-payment", values: expect.objectContaining({ amount_minor: 100000 }) }),
    ]));
    expect(series).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "demo-household-total-series", values: expect.objectContaining({ home_household_frequency: "monthly" }) }),
      expect.objectContaining({ key: "demo-savings-transfer-series", values: expect.objectContaining({ kind: "transfer" }) }),
    ]));
    expect(recurring.filter((row) => row.values.series_id === "demo-savings-transfer-series")).toHaveLength(2);
    expect(recurring).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "demo-savings-transfer-version-2", values: expect.objectContaining({ supersedes_version_id: "demo-savings-transfer-version-1" }) }),
    ]));
    expect(exceptions).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "demo-grocery-skip-september-6", values: expect.objectContaining({ kind: "skip", scheduled_occurrence_on: "2026-09-06" }) }),
    ]));
    expect(transfers).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "demo-savings-transfer-august", values: expect.objectContaining({ is_generated: false, amount_minor: 75000 }) }),
    ]));
    expect(salaryYears).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "demo-salary-year-2025", values: expect.objectContaining({ status: "finalized", final_federal_minor: 6280000 }) }),
    ]));
  });

  it("covers the current and future demo timeline", () => {
    const periods = DEMO_FIXTURE.find((group) => group.table === "cash_flow_periods")?.rows ?? [];
    const transactions = DEMO_FIXTURE.find((group) => group.table === "transactions")?.rows ?? [];
    const balanceSnapshots = DEMO_FIXTURE.find((group) => group.table === "balance_snapshots")?.rows ?? [];
    const investmentSnapshots = DEMO_FIXTURE.find((group) => group.table === "investment_snapshots")?.rows ?? [];

    expect(periods).toHaveLength(26);
    expect(periods.some((row) => row.values.pay_date === "2026-08-28")).toBe(true);
    expect(periods.some((row) => row.values.ends_on === "2026-12-30")).toBe(true);
    expect(transactions.filter((row) => String(row.values.transaction_date) >= "2026-08-01")).toHaveLength(45);
    expect(balanceSnapshots).toHaveLength(297);
    for (const period of periods) {
      expect(balanceSnapshots.filter((row) => row.values.as_of === period.values.pay_date)).toHaveLength(9);
    }
    expect(balanceSnapshots.filter((row) => row.values.as_of === "2026-09-11").every((row) => row.values.status === "planned" && row.values.is_generated === true)).toBe(true);
    expect(investmentSnapshots).toHaveLength(45);
  });

  it("uses one stable fixture fingerprint in every database", () => {
    expect(provisionerSource).toContain("function deterministicId(table: string, key: string): string");
    expect(provisionerSource).toContain("export function demoFixtureFingerprint(): string");
    expect(provisionerSource).not.toContain("function deterministicId(ownerId:");
    expect(provisionerSource).toEqual(expect.stringContaining("table: \"home_mortgage_terms\""));
    expect(provisionerSource).toEqual(expect.stringContaining("table: \"rrq_year_limit_overrides\""));
    expect(provisionerSource).toEqual(expect.stringContaining("table: \"investment_projection_projects\""));
    expect(provisionerSource).toEqual(expect.stringContaining("table: \"investment_projection_project_accounts\""));
    expect(provisionerSource).toEqual(expect.stringContaining("table: \"investment_projection_project_rates\""));
    expect(provisionerSource).toEqual(expect.stringContaining("table: \"investment_projection_project_account_schedules\""));
  });

  it("keeps every row in a fixture table on the same column contract", () => {
    for (const group of DEMO_FIXTURE) {
      const first = group.rows[0];
      expect(first).toBeDefined();
      const columns = Object.keys(first!.values);
      for (const row of group.rows) expect(Object.keys(row.values)).toEqual(columns);
    }
  });

  it("normalizes PostgreSQL date values for fixture verification", () => {
    expect(normalized(new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-01-01");
  });

  it("keeps provisioning explicit, transactional, target-bound, and secret-safe", () => {
    expect(provisionerSource).toContain("await sql.begin");
    expect(provisionerSource).toContain("current_database()");
    expect(provisionerSource).toContain("ATHENA_MIGRATOR_DATABASE_URL");
    expect(provisionerSource).toContain("ATHENA_MIGRATOR_PASSWORD");
    expect(provisionerSource).toContain("ATHENA_DEMO_TARGET_CONFIRM");
    expect(provisionerSource).toContain("targetConfirmation !== expectedDatabaseName(environment)");
    expect(provisionerSource).toContain("already-provisioned");
    expect(provisionerSource).toContain("Demo fixture fingerprint mismatch.");
    expect(provisionerSource).toContain("Demo authentication provisioning is incomplete.");
    expect(provisionerSource).toContain("on conflict (id) do nothing");
    expect(provisionerSource).toContain("existingFixtureVersion !== DEMO_FIXTURE_VERSION");
    expect(provisionerSource).toContain("existingFixtureVersion !== 1 && existingFixtureVersion !== 2 && existingFixtureVersion !== 3 && existingFixtureVersion !== 4");
    expect(provisionerSource).not.toMatch(/console\.log\([^\n]*(?:password|hash|DATABASE_URL)/i);
  });

  it("requires an exact database-name confirmation before demo provisioning", () => {
    expect(() => assertDemoTargetConfirmation({
      ATHENA_DB_NAME: "athena_demo",
      ATHENA_DEMO_TARGET_CONFIRM: "athena_demo",
    })).not.toThrow();
    expect(() => assertDemoTargetConfirmation({
      ATHENA_DB_NAME: "athena_demo",
      ATHENA_DEMO_TARGET_CONFIRM: "athena_vault",
    })).toThrow("ATHENA_DEMO_TARGET_CONFIRM must exactly match the configured target database name.");
    expect(() => assertDemoTargetConfirmation({ ATHENA_DB_NAME: "athena_demo" })).toThrow("ATHENA_DEMO_TARGET_CONFIRM");
  });

  it("exposes provisioning only through an explicit Compose profile", () => {
    expect(composeSource).toContain("demo-provision:");
    expect(composeSource).toContain('profiles: ["demo-provision"]');
    expect(composeSource).toContain("ATHENA_MIGRATOR_DATABASE_URL");
    expect(composeSource).toContain("ATHENA_MIGRATOR_PASSWORD");
    expect(composeSource).toContain("ATHENA_DEMO_TARGET_CONFIRM");
    expect(composeSource).toContain('command: ["./packages/database/node_modules/.bin/tsx", "scripts/demo/provision-demo.ts"]');
    expect(productionComposeSource).toContain("demo-provision:");
    expect(productionComposeSource).toContain("no-new-privileges:true");
  });

  it("allows Docker-injected configuration when the workstation env file is absent", async () => {
    await expect(loadEnvironment(["node", "provision-demo.ts"], join("C:\\nonexistent-athena-vault-test-root", "missing"))).resolves.toEqual({});
    await expect(loadEnvironment(["node", "provision-demo.ts", "--env-file", "missing.env"], join("C:\\nonexistent-athena-vault-test-root", "missing"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
