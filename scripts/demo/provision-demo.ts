import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import postgres, { type Sql } from "postgres";
import { hashPassword, verifyPassword } from "better-auth/crypto";

export const DEMO_FIXTURE_VERSION = 5;
const DEMO_ID_VERSION = 1;
export const DEMO_IDENTIFIER_ENV = "ATHENA_DEMO_IDENTIFIER";
export const DEMO_PASSWORD_ENV = "ATHENA_DEMO_PASSWORD";
export const DEMO_ENABLED_ENV = "ATHENA_DEMO_ENABLED";

type Scalar = string | number | boolean | null;
type Environment = Record<string, string>;
type FixtureValues = Record<string, Scalar>;
export type FixtureGroup = Readonly<{
  table: string;
  rows: ReadonlyArray<Readonly<{ key: string; values: FixtureValues }>>;
}>;

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

type DemoFixtureRow = Readonly<{ key: string; values: FixtureValues }>;
type DemoRecordStatus = "actual" | "planned";
type DemoPeriodStatus = "actual" | "mixed" | "planned";

type DemoPeriodSeed = Readonly<{
  key: string;
  label: string;
  startsOn: string;
  endsOn: string;
  payDate: string;
  status: DemoPeriodStatus;
}>;

const DEMO_PERIOD_SEEDS: readonly DemoPeriodSeed[] = [
  { key: "demo-period-jan", label: "Demo January period", startsOn: "2026-01-01", endsOn: "2026-01-14", payDate: "2026-01-02", status: "actual" },
  { key: "demo-period-feb", label: "Demo February period", startsOn: "2026-01-15", endsOn: "2026-01-28", payDate: "2026-01-16", status: "mixed" },
  { key: "demo-period-mar", label: "Demo March period", startsOn: "2026-01-29", endsOn: "2026-02-11", payDate: "2026-01-30", status: "planned" },
  { key: "demo-period-feb-2", label: "Demo February 2 pay period", startsOn: "2026-02-12", endsOn: "2026-02-25", payDate: "2026-02-13", status: "actual" },
  { key: "demo-period-mar-1", label: "Demo March 1 pay period", startsOn: "2026-02-26", endsOn: "2026-03-11", payDate: "2026-02-27", status: "actual" },
  { key: "demo-period-mar-2", label: "Demo March 2 pay period", startsOn: "2026-03-12", endsOn: "2026-03-25", payDate: "2026-03-13", status: "actual" },
  { key: "demo-period-apr-1", label: "Demo April 1 pay period", startsOn: "2026-03-26", endsOn: "2026-04-08", payDate: "2026-03-27", status: "actual" },
  { key: "demo-period-apr-2", label: "Demo April 2 pay period", startsOn: "2026-04-09", endsOn: "2026-04-22", payDate: "2026-04-10", status: "actual" },
  { key: "demo-period-may-1", label: "Demo May 1 pay period", startsOn: "2026-04-23", endsOn: "2026-05-06", payDate: "2026-04-24", status: "actual" },
  { key: "demo-period-may-2", label: "Demo May 2 pay period", startsOn: "2026-05-07", endsOn: "2026-05-20", payDate: "2026-05-08", status: "actual" },
  { key: "demo-period-jun-1", label: "Demo June 1 pay period", startsOn: "2026-05-21", endsOn: "2026-06-03", payDate: "2026-05-22", status: "actual" },
  { key: "demo-period-jun-2", label: "Demo June 2 pay period", startsOn: "2026-06-04", endsOn: "2026-06-17", payDate: "2026-06-05", status: "actual" },
  { key: "demo-period-jul-1", label: "Demo July 1 pay period", startsOn: "2026-06-18", endsOn: "2026-07-01", payDate: "2026-06-19", status: "actual" },
  { key: "demo-period-jul-2", label: "Demo July 2 pay period", startsOn: "2026-07-02", endsOn: "2026-07-15", payDate: "2026-07-03", status: "actual" },
  { key: "demo-period-aug-1", label: "Demo August 1 pay period", startsOn: "2026-07-16", endsOn: "2026-07-29", payDate: "2026-07-17", status: "actual" },
  { key: "demo-period-aug-2", label: "Demo August 2 pay period", startsOn: "2026-07-30", endsOn: "2026-08-12", payDate: "2026-07-31", status: "actual" },
  { key: "demo-period-aug-3", label: "Demo August 3 pay period", startsOn: "2026-08-13", endsOn: "2026-08-26", payDate: "2026-08-14", status: "mixed" },
  { key: "demo-period-aug-4", label: "Demo August 4 pay period", startsOn: "2026-08-27", endsOn: "2026-09-09", payDate: "2026-08-28", status: "mixed" },
  { key: "demo-period-sep-1", label: "Demo September 1 pay period", startsOn: "2026-09-10", endsOn: "2026-09-23", payDate: "2026-09-11", status: "planned" },
  { key: "demo-period-sep-2", label: "Demo September 2 pay period", startsOn: "2026-09-24", endsOn: "2026-10-07", payDate: "2026-09-25", status: "planned" },
  { key: "demo-period-oct-1", label: "Demo October 1 pay period", startsOn: "2026-10-08", endsOn: "2026-10-21", payDate: "2026-10-09", status: "planned" },
  { key: "demo-period-oct-2", label: "Demo October 2 pay period", startsOn: "2026-10-22", endsOn: "2026-11-04", payDate: "2026-10-23", status: "planned" },
  { key: "demo-period-nov-1", label: "Demo November 1 pay period", startsOn: "2026-11-05", endsOn: "2026-11-18", payDate: "2026-11-06", status: "planned" },
  { key: "demo-period-nov-2", label: "Demo November 2 pay period", startsOn: "2026-11-19", endsOn: "2026-12-02", payDate: "2026-11-20", status: "planned" },
  { key: "demo-period-dec-1", label: "Demo December 1 pay period", startsOn: "2026-12-03", endsOn: "2026-12-16", payDate: "2026-12-04", status: "planned" },
  { key: "demo-period-dec-2", label: "Demo December 2 pay period", startsOn: "2026-12-17", endsOn: "2026-12-30", payDate: "2026-12-18", status: "planned" },
];

function demoPeriodRow(seed: DemoPeriodSeed): DemoFixtureRow {
  return {
    key: seed.key,
    values: {
      label: seed.label,
      starts_on: seed.startsOn,
      ends_on: seed.endsOn,
      pay_date: seed.payDate,
      opening_balance_minor: 325000,
      currency: "CAD",
      status: seed.status,
    },
  };
}

function demoPeriodKeyFor(date: string): string {
  const period = DEMO_PERIOD_SEEDS.find((candidate) => candidate.startsOn <= date && candidate.endsOn >= date);
  if (!period) throw new Error(`Demo date ${date} is outside the seeded Cash Flow timeline.`);
  return period.key;
}

type DemoMonthSeed = Readonly<{
  slug: string;
  month: string;
  payDate: string;
  status: DemoRecordStatus;
}>;

const DEMO_MONTH_SEEDS: readonly DemoMonthSeed[] = [
  { slug: "feb", month: "2026-02", payDate: "2026-02-13", status: "actual" },
  { slug: "mar", month: "2026-03", payDate: "2026-03-13", status: "actual" },
  { slug: "apr", month: "2026-04", payDate: "2026-04-10", status: "actual" },
  { slug: "may", month: "2026-05", payDate: "2026-05-08", status: "actual" },
  { slug: "jun", month: "2026-06", payDate: "2026-06-05", status: "actual" },
  { slug: "jul", month: "2026-07", payDate: "2026-07-03", status: "actual" },
  { slug: "aug", month: "2026-08", payDate: "2026-08-14", status: "actual" },
  { slug: "sep", month: "2026-09", payDate: "2026-09-11", status: "planned" },
  { slug: "oct", month: "2026-10", payDate: "2026-10-09", status: "planned" },
  { slug: "nov", month: "2026-11", payDate: "2026-11-06", status: "planned" },
  { slug: "dec", month: "2026-12", payDate: "2026-12-04", status: "planned" },
];

type DemoTransactionSeed = Readonly<{
  key: string;
  seriesKey: string | null;
  transactionDate: string;
  kind: "income" | "expense";
  description: string;
  category: string;
  amountMinor: number;
  status: DemoRecordStatus;
}>;

function demoTransactionRow(seed: DemoTransactionSeed): DemoFixtureRow {
  return {
    key: seed.key,
    values: {
      account_id: "demo-chequing",
      period_id: demoPeriodKeyFor(seed.transactionDate),
      recurring_series_id: seed.seriesKey,
      transaction_date: seed.transactionDate,
      kind: seed.kind,
      status: seed.status,
      is_excluded: false,
      description: seed.description,
      category: seed.category,
      amount_minor: seed.amountMinor,
      currency: "CAD",
    },
  };
}

const DEMO_ADDITIONAL_TRANSACTION_SEEDS: readonly DemoTransactionSeed[] = DEMO_MONTH_SEEDS.flatMap((month) => [
  { key: `demo-paycheque-${month.slug}`, seriesKey: "demo-income-series", transactionDate: month.payDate, kind: "income", description: "Demo paycheque", category: "Income", amountMinor: 265000, status: month.status },
  { key: `demo-rent-${month.slug}`, seriesKey: "demo-rent-series", transactionDate: `${month.month}-01`, kind: "expense", description: "Demo apartment rent", category: "Housing", amountMinor: 165000, status: month.status },
  { key: `demo-groceries-${month.slug}`, seriesKey: "demo-grocery-series", transactionDate: `${month.month}-05`, kind: "expense", description: "Demo groceries", category: "Food", amountMinor: 18500, status: month.status },
  { key: `demo-childcare-${month.slug}`, seriesKey: "demo-childcare-series", transactionDate: `${month.month}-07`, kind: "expense", description: "Demo childcare", category: "Family", amountMinor: 60000, status: month.status },
  { key: `demo-utilities-${month.slug}`, seriesKey: "demo-utilities-series", transactionDate: `${month.month}-10`, kind: "expense", description: "Demo utilities", category: "Home", amountMinor: 22000, status: month.status },
  { key: `demo-internet-${month.slug}`, seriesKey: "demo-internet-series", transactionDate: `${month.month}-12`, kind: "expense", description: "Demo internet", category: "Home", amountMinor: 9500, status: month.status },
  { key: `demo-freelance-income-${month.slug}`, seriesKey: "demo-freelance-income-series", transactionDate: `${month.month}-15`, kind: "income", description: "Demo freelance income", category: "Income", amountMinor: 75000, status: month.status },
  { key: `demo-card-payment-${month.slug}`, seriesKey: "demo-card-payment-series", transactionDate: `${month.month}-20`, kind: "expense", description: "Demo credit card payment", category: "Debt", amountMinor: 45000, status: month.status },
  { key: `demo-benefit-income-${month.slug}`, seriesKey: "demo-benefit-income-series", transactionDate: `${month.month}-25`, kind: "income", description: "Demo monthly benefit", category: "Income", amountMinor: 35000, status: month.status },
]);

type DemoHistorySeed = Readonly<{ slug: string; asOf: string; index: number }>;

const DEMO_HISTORY_SEEDS: readonly DemoHistorySeed[] = [
  { slug: "feb", asOf: "2026-02-28", index: 1 },
  { slug: "mar", asOf: "2026-03-31", index: 2 },
  { slug: "apr", asOf: "2026-04-30", index: 3 },
  { slug: "may", asOf: "2026-05-31", index: 4 },
  { slug: "jun", asOf: "2026-06-30", index: 5 },
  { slug: "jul", asOf: "2026-07-31", index: 6 },
  { slug: "aug", asOf: "2026-08-29", index: 7 },
];

type DemoBalanceSchedule = Readonly<{ accountKey: string; slug: string; startingMinor: number; monthlyChangeMinor: number }>;

const DEMO_BALANCE_SCHEDULES: readonly DemoBalanceSchedule[] = [
  { accountKey: "demo-chequing", slug: "chequing", startingMinor: 325000, monthlyChangeMinor: 40000 },
  { accountKey: "demo-savings", slug: "savings", startingMinor: 875000, monthlyChangeMinor: 60000 },
  { accountKey: "demo-travel-card", slug: "travel-card", startingMinor: 125000, monthlyChangeMinor: 5000 },
  { accountKey: "demo-everyday-card", slug: "everyday-card", startingMinor: 68000, monthlyChangeMinor: 2500 },
  { accountKey: "demo-auto-loan", slug: "auto-loan", startingMinor: 1850000, monthlyChangeMinor: -15000 },
  { accountKey: "demo-rrsp", slug: "rrsp", startingMinor: 2450000, monthlyChangeMinor: 70000 },
  { accountKey: "demo-tfsa", slug: "tfsa", startingMinor: 1750000, monthlyChangeMinor: 40000 },
  { accountKey: "demo-fhsa", slug: "fhsa", startingMinor: 650000, monthlyChangeMinor: 30000 },
  { accountKey: "demo-non-registered", slug: "non-registered", startingMinor: 3200000, monthlyChangeMinor: 80000 },
];

const DEMO_ADDITIONAL_BALANCE_SNAPSHOTS: readonly DemoFixtureRow[] = DEMO_HISTORY_SEEDS.flatMap((history) => DEMO_BALANCE_SCHEDULES.map((schedule) => ({
  key: `demo-${schedule.slug}-balance-${history.slug}`,
  values: {
    account_id: schedule.accountKey,
    as_of: history.asOf,
    balance_minor: schedule.startingMinor + schedule.monthlyChangeMinor * history.index,
    status: "actual",
    is_generated: false,
    currency: "CAD",
  },
})));

const DEMO_CURRENT_PAY_DATE = "2026-08-28";
const DEMO_EXISTING_BALANCE_SNAPSHOT_DATES = new Set([
  "2026-01-01",
  ...DEMO_HISTORY_SEEDS.map((history) => history.asOf),
]);

function demoBalanceAtPeriod(schedule: DemoBalanceSchedule, periodIndex: number): number {
  const elapsedHalfMonths = periodIndex + 1;
  const completedMonths = Math.floor(elapsedHalfMonths / 2);
  const halfMonthChange = elapsedHalfMonths % 2 === 1 ? Math.trunc(schedule.monthlyChangeMinor / 2) : 0;
  return schedule.startingMinor + schedule.monthlyChangeMinor * completedMonths + halfMonthChange;
}

const DEMO_TIMELINE_BALANCE_SNAPSHOTS: readonly DemoFixtureRow[] = DEMO_PERIOD_SEEDS.flatMap((period, periodIndex) => {
  if (DEMO_EXISTING_BALANCE_SNAPSHOT_DATES.has(period.payDate)) return [];
  const isProjected = period.payDate > DEMO_CURRENT_PAY_DATE;
  return DEMO_BALANCE_SCHEDULES.map((schedule) => ({
    key: `demo-${schedule.slug}-${period.key}-balance`,
    values: {
      account_id: schedule.accountKey,
      as_of: period.payDate,
      balance_minor: demoBalanceAtPeriod(schedule, periodIndex),
      status: isProjected ? "planned" : "actual",
      is_generated: isProjected,
      currency: "CAD",
    },
  }));
});

type DemoInvestmentSchedule = Readonly<{ investmentKey: string; slug: string; startingMinor: number; monthlyChangeMinor: number; contributionMinor: number }>;

const DEMO_INVESTMENT_SCHEDULES: readonly DemoInvestmentSchedule[] = [
  { investmentKey: "demo-investment", slug: "investment", startingMinor: 1245000, monthlyChangeMinor: 60000, contributionMinor: 25000 },
  { investmentKey: "demo-rrsp-investment", slug: "rrsp-investment", startingMinor: 2430000, monthlyChangeMinor: 70000, contributionMinor: 30000 },
  { investmentKey: "demo-tfsa-investment", slug: "tfsa-investment", startingMinor: 1715000, monthlyChangeMinor: 40000, contributionMinor: 15000 },
  { investmentKey: "demo-fhsa-investment", slug: "fhsa-investment", startingMinor: 640000, monthlyChangeMinor: 30000, contributionMinor: 20000 },
  { investmentKey: "demo-non-registered-investment", slug: "non-registered-investment", startingMinor: 3110000, monthlyChangeMinor: 80000, contributionMinor: 10000 },
];

const DEMO_ADDITIONAL_INVESTMENT_SNAPSHOTS: readonly DemoFixtureRow[] = DEMO_HISTORY_SEEDS.flatMap((history) => DEMO_INVESTMENT_SCHEDULES.map((schedule) => ({
  key: `demo-${schedule.slug}-snapshot-${history.slug}`,
  values: {
    investment_account_id: schedule.investmentKey,
    as_of: history.asOf,
    balance_minor: schedule.startingMinor + schedule.monthlyChangeMinor * history.index,
    contribution_minor: schedule.contributionMinor,
    withdrawal_minor: 0,
    currency: "CAD",
  },
})));

const DEMO_ADDITIONAL_HOME_VALUE_SNAPSHOTS: readonly DemoFixtureRow[] = DEMO_HISTORY_SEEDS.map((history) => ({
  key: `demo-home-value-${history.slug}`,
  values: { home_id: "demo-home", as_of: history.asOf, market_value_minor: 53000000 + history.index * 250000 },
}));

const DEMO_ADDITIONAL_MORTGAGE_ANCHORS: readonly DemoFixtureRow[] = DEMO_HISTORY_SEEDS.map((history) => ({
  key: `demo-mortgage-anchor-${history.slug}`,
  values: { home_id: "demo-home", as_of: history.asOf, principal_minor: 31800000 - history.index * 120000 },
}));

const DEMO_ADDITIONAL_SALARY_SNAPSHOTS: readonly DemoFixtureRow[] = [
  { key: "demo-salary-snapshot-3", values: { salary_year_id: "demo-salary-year", snapshot_on: "2026-03-13", federal_cumulative_minor: 2650000, provincial_cumulative_minor: 2550000, completed_pay_number: 5, rrq_contribution_ytd_minor: 132500, note: "Demo snapshot" } },
  { key: "demo-salary-snapshot-4", values: { salary_year_id: "demo-salary-year", snapshot_on: "2026-04-10", federal_cumulative_minor: 3710000, provincial_cumulative_minor: 3570000, completed_pay_number: 7, rrq_contribution_ytd_minor: 185500, note: "Demo snapshot" } },
  { key: "demo-salary-snapshot-5", values: { salary_year_id: "demo-salary-year", snapshot_on: "2026-05-08", federal_cumulative_minor: 4770000, provincial_cumulative_minor: 4590000, completed_pay_number: 9, rrq_contribution_ytd_minor: 238500, note: "Demo snapshot" } },
  { key: "demo-salary-snapshot-6", values: { salary_year_id: "demo-salary-year", snapshot_on: "2026-06-05", federal_cumulative_minor: 5830000, provincial_cumulative_minor: 5610000, completed_pay_number: 11, rrq_contribution_ytd_minor: 291500, note: "Demo snapshot" } },
  { key: "demo-salary-snapshot-7", values: { salary_year_id: "demo-salary-year", snapshot_on: "2026-07-03", federal_cumulative_minor: 6890000, provincial_cumulative_minor: 6630000, completed_pay_number: 13, rrq_contribution_ytd_minor: 344500, note: "Demo snapshot" } },
  { key: "demo-salary-snapshot-8", values: { salary_year_id: "demo-salary-year", snapshot_on: "2026-08-28", federal_cumulative_minor: 9010000, provincial_cumulative_minor: 8670000, completed_pay_number: 17, rrq_contribution_ytd_minor: 450500, note: "Demo snapshot" } },
];

const DEMO_ADDITIONAL_RECURRING_TRANSACTIONS: readonly DemoFixtureRow[] = [
  { key: "demo-internet-recurring", values: { series_id: "demo-internet-series", account_id: "demo-chequing", kind: "expense", frequency: "monthly", weekday_adjustment: "none", description: "Demo internet", amount_minor: 9500, currency: "CAD", starts_on: "2026-08-01", effective_from: "2026-08-01", counts_as_expense: false, next_occurrence_on: "2026-09-01", status: "planned", ends_on: null, effective_to: null, version_note: null, supersedes_version_id: null, from_account_id: null, to_account_id: null } },
  { key: "demo-childcare-recurring", values: { series_id: "demo-childcare-series", account_id: "demo-chequing", kind: "expense", frequency: "biweekly", weekday_adjustment: "none", description: "Demo childcare", amount_minor: 60000, currency: "CAD", starts_on: "2026-08-07", effective_from: "2026-08-07", counts_as_expense: false, next_occurrence_on: "2026-09-04", status: "planned", ends_on: null, effective_to: null, version_note: null, supersedes_version_id: null, from_account_id: null, to_account_id: null } },
];

const DEMO_ADDITIONAL_ANNUAL_EXPENSES: readonly DemoFixtureRow[] = [
  { key: "demo-property-tax", values: { budget_id: "demo-annual-budget", account_id: "demo-chequing", name: "Demo property tax", amount_minor: 180000, funded_minor: 90000, due_month: 9, due_day: 15, currency: "CAD", is_active: true } },
  { key: "demo-property-tax-follow-up", values: { budget_id: "demo-annual-budget", account_id: "demo-chequing", name: "Demo property tax", amount_minor: 180000, funded_minor: 0, due_month: 10, due_day: 15, currency: "CAD", is_active: true } },
  { key: "demo-travel-fund", values: { budget_id: "demo-annual-budget", account_id: "demo-chequing", name: "Demo travel fund", amount_minor: 75000, funded_minor: 25000, due_month: 8, due_day: 20, currency: "CAD", is_active: true } },
];

const DEMO_ADDITIONAL_ANNUAL_EXPENSE_VALUES: readonly DemoFixtureRow[] = [
  { key: "demo-property-tax-value", values: { annual_expense_id: "demo-property-tax", budget_id: "demo-annual-budget", tax_year: 2026, amount_minor: 180000, funded_minor: 90000, currency: "CAD" } },
  { key: "demo-property-tax-value-2027", values: { annual_expense_id: "demo-property-tax", budget_id: "demo-annual-budget", tax_year: 2027, amount_minor: 180000, funded_minor: 0, currency: "CAD" } },
  { key: "demo-property-tax-follow-up-value", values: { annual_expense_id: "demo-property-tax-follow-up", budget_id: "demo-annual-budget", tax_year: 2026, amount_minor: 180000, funded_minor: 0, currency: "CAD" } },
  { key: "demo-property-tax-follow-up-value-2027", values: { annual_expense_id: "demo-property-tax-follow-up", budget_id: "demo-annual-budget", tax_year: 2027, amount_minor: 180000, funded_minor: 0, currency: "CAD" } },
  { key: "demo-travel-fund-value", values: { annual_expense_id: "demo-travel-fund", budget_id: "demo-annual-budget", tax_year: 2026, amount_minor: 75000, funded_minor: 25000, currency: "CAD" } },
];

const DEMO_ADDITIONAL_ANNUAL_EXPENSE_PAYMENTS: readonly DemoFixtureRow[] = [
  { key: "demo-property-tax-payment", values: { annual_expense_value_id: "demo-property-tax-value", payment_on: "2026-08-20", amount_minor: 100000, note: "Demo partial payment" } },
  { key: "demo-travel-fund-payment", values: { annual_expense_value_id: "demo-travel-fund-value", payment_on: "2026-08-20", amount_minor: 25000, note: "Demo payment" } },
];

const DEMO_ADDITIONAL_ANNUAL_MAINTENANCE_ITEMS: readonly DemoFixtureRow[] = [
  { key: "demo-roof-maintenance", values: { name: "Demo roof maintenance", amount_minor: 120000, frequency: "annual", is_active: true } },
  { key: "demo-furnace-maintenance", values: { name: "Demo furnace service", amount_minor: 4500, frequency: "monthly", is_active: true } },
];

const DEMO_ADDITIONAL_HOUSEHOLD_EXPENSES: readonly DemoFixtureRow[] = [
  { key: "demo-internet-household", values: { account_id: "demo-chequing", name: "Demo internet", category: "Home", frequency: "monthly", amount_minor: 9500, annual_amount_minor: 114000, currency: "CAD", starts_on: "2026-08-01", is_active: true } },
  { key: "demo-childcare-household", values: { account_id: "demo-chequing", name: "Demo childcare", category: "Family", frequency: "biweekly", amount_minor: 60000, annual_amount_minor: 1560000, currency: "CAD", starts_on: "2026-08-07", is_active: true } },
  { key: "demo-annual-maintenance-summary", values: { account_id: "demo-chequing", name: "Annual maintenance", category: "annual-maintenance", frequency: "monthly", amount_minor: 14500, annual_amount_minor: 174000, currency: "CAD", starts_on: "2026-01-01", is_active: true } },
];

const DEMO_ADDITIONAL_SALARY_YEARS: readonly DemoFixtureRow[] = [
  { key: "demo-salary-year-2025", values: { tax_year: 2025, annual_base_minor: 6500000, status: "finalized", pay_periods_per_year_override: 26, note: "Demo finalized salary year", final_federal_minor: 6280000 } },
];

const DEMO_ADDITIONAL_GOALS: readonly DemoFixtureRow[] = [
  { key: "demo-home-goal", values: { name: "Demo first home reserve", target_minor: 5000000, current_minor: 1500000, target_date: "2030-06-30", priority: 2, status: "active", currency: "CAD" } },
  { key: "demo-travel-goal", values: { name: "Demo summer travel", target_minor: 300000, current_minor: 85000, target_date: "2027-07-01", priority: 3, status: "active", currency: "CAD" } },
];

/** Synthetic, stable, owner-scoped data used only by the explicit demo command. */
export const DEMO_FIXTURE: ReadonlyArray<FixtureGroup> = [
  { table: "institutions", rows: [{ key: "demo-bank", values: { name: "Demo Community Bank", currency: "CAD" } }] },
  {
    table: "accounts",
    rows: [
      { key: "demo-chequing", values: { institution_id: "demo-bank", timeline_order: 0, name: "Demo chequing", kind: "checking", last_four: "2468", currency: "CAD", is_active: true, include_in_available_cash: true, is_visible_in_cash_flow: true, use_cash_flow_planned_timeline: true } },
      { key: "demo-savings", values: { institution_id: "demo-bank", timeline_order: 1, name: "Demo savings", kind: "savings", last_four: "1357", currency: "CAD", is_active: true, include_in_available_cash: false, is_visible_in_cash_flow: true, use_cash_flow_planned_timeline: true } },
      { key: "demo-travel-card", values: { institution_id: "demo-bank", timeline_order: 2, name: "Demo travel card", kind: "credit", last_four: "8024", currency: "CAD", is_active: true, include_in_available_cash: false, is_visible_in_cash_flow: true, use_cash_flow_planned_timeline: true } },
      { key: "demo-everyday-card", values: { institution_id: "demo-bank", timeline_order: 3, name: "Demo everyday card", kind: "credit", last_four: "9135", currency: "CAD", is_active: true, include_in_available_cash: false, is_visible_in_cash_flow: true, use_cash_flow_planned_timeline: true } },
      { key: "demo-auto-loan", values: { institution_id: "demo-bank", timeline_order: 4, name: "Demo auto loan", kind: "loan", last_four: null, currency: "CAD", is_active: true, include_in_available_cash: false, is_visible_in_cash_flow: true, use_cash_flow_planned_timeline: true } },
      { key: "demo-rrsp", values: { institution_id: "demo-bank", timeline_order: 5, name: "Demo RRSP", kind: "rrsp", last_four: "4444", currency: "CAD", is_active: true, include_in_available_cash: false, is_visible_in_cash_flow: true, use_cash_flow_planned_timeline: false } },
      { key: "demo-tfsa", values: { institution_id: "demo-bank", timeline_order: 6, name: "Demo TFSA", kind: "tfsa", last_four: "5555", currency: "CAD", is_active: true, include_in_available_cash: false, is_visible_in_cash_flow: true, use_cash_flow_planned_timeline: false } },
      { key: "demo-fhsa", values: { institution_id: "demo-bank", timeline_order: 7, name: "Demo FHSA", kind: "fhsa", last_four: "6666", currency: "CAD", is_active: true, include_in_available_cash: false, is_visible_in_cash_flow: true, use_cash_flow_planned_timeline: false } },
      { key: "demo-non-registered", values: { institution_id: "demo-bank", timeline_order: 8, name: "Demo non-registered", kind: "non_registered", last_four: "7777", currency: "CAD", is_active: true, include_in_available_cash: false, is_visible_in_cash_flow: true, use_cash_flow_planned_timeline: false } },
    ],
  },
  {
    table: "balance_snapshots",
    rows: [
      { key: "demo-chequing-balance", values: { account_id: "demo-chequing", as_of: "2026-01-01", balance_minor: 325000, status: "actual", is_generated: false, currency: "CAD" } },
      { key: "demo-savings-balance", values: { account_id: "demo-savings", as_of: "2026-01-01", balance_minor: 875000, status: "actual", is_generated: false, currency: "CAD" } },
      { key: "demo-travel-card-balance", values: { account_id: "demo-travel-card", as_of: "2026-01-01", balance_minor: 125000, status: "actual", is_generated: false, currency: "CAD" } },
      { key: "demo-everyday-card-balance", values: { account_id: "demo-everyday-card", as_of: "2026-01-01", balance_minor: 68000, status: "actual", is_generated: false, currency: "CAD" } },
      { key: "demo-auto-loan-balance", values: { account_id: "demo-auto-loan", as_of: "2026-01-01", balance_minor: 1850000, status: "actual", is_generated: false, currency: "CAD" } },
      { key: "demo-rrsp-balance", values: { account_id: "demo-rrsp", as_of: "2026-01-01", balance_minor: 2450000, status: "actual", is_generated: false, currency: "CAD" } },
      { key: "demo-tfsa-balance", values: { account_id: "demo-tfsa", as_of: "2026-01-01", balance_minor: 1750000, status: "actual", is_generated: false, currency: "CAD" } },
      { key: "demo-fhsa-balance", values: { account_id: "demo-fhsa", as_of: "2026-01-01", balance_minor: 650000, status: "actual", is_generated: false, currency: "CAD" } },
      { key: "demo-non-registered-balance", values: { account_id: "demo-non-registered", as_of: "2026-01-01", balance_minor: 3200000, status: "actual", is_generated: false, currency: "CAD" } },
      ...DEMO_ADDITIONAL_BALANCE_SNAPSHOTS,
      ...DEMO_TIMELINE_BALANCE_SNAPSHOTS,
    ],
  },
  {
    table: "cash_flow_periods",
    rows: DEMO_PERIOD_SEEDS.map(demoPeriodRow),
  },
  {
    table: "recurring_cash_flow_series",
    rows: [
      { key: "demo-income-series", values: { kind: "income", state: "active", home_household_frequency: null } },
      { key: "demo-rent-series", values: { kind: "expense", state: "active", home_household_frequency: null } },
      { key: "demo-freelance-income-series", values: { kind: "income", state: "active", home_household_frequency: null } },
      { key: "demo-benefit-income-series", values: { kind: "income", state: "active", home_household_frequency: null } },
      { key: "demo-utilities-series", values: { kind: "expense", state: "active", home_household_frequency: null } },
      { key: "demo-card-payment-series", values: { kind: "expense", state: "active", home_household_frequency: null } },
      { key: "demo-grocery-series", values: { kind: "expense", state: "active", home_household_frequency: null } },
      { key: "demo-internet-series", values: { kind: "expense", state: "active", home_household_frequency: null } },
      { key: "demo-childcare-series", values: { kind: "expense", state: "active", home_household_frequency: null } },
      { key: "demo-household-total-series", values: { kind: "expense", state: "active", home_household_frequency: "monthly" } },
      { key: "demo-savings-transfer-series", values: { kind: "transfer", state: "active", home_household_frequency: null } },
    ],
  },
  {
    table: "recurring_transactions",
    rows: [
      { key: "demo-paycheque", values: { series_id: "demo-income-series", account_id: "demo-chequing", kind: "income", frequency: "biweekly", weekday_adjustment: "none", description: "Demo paycheque", amount_minor: 265000, currency: "CAD", starts_on: "2026-01-02", effective_from: "2026-01-02", counts_as_expense: false, next_occurrence_on: "2026-01-16", status: "planned", ends_on: null, effective_to: null, version_note: null, supersedes_version_id: null, from_account_id: null, to_account_id: null } },
      { key: "demo-rent", values: { series_id: "demo-rent-series", account_id: "demo-chequing", kind: "expense", frequency: "monthly", weekday_adjustment: "none", description: "Demo apartment rent", amount_minor: 165000, currency: "CAD", starts_on: "2026-01-01", effective_from: "2026-01-01", counts_as_expense: false, next_occurrence_on: "2026-02-01", status: "planned", ends_on: null, effective_to: null, version_note: null, supersedes_version_id: null, from_account_id: null, to_account_id: null } },
      { key: "demo-freelance-income", values: { series_id: "demo-freelance-income-series", account_id: "demo-chequing", kind: "income", frequency: "monthly", weekday_adjustment: "none", description: "Demo freelance income", amount_minor: 75000, currency: "CAD", starts_on: "2026-01-05", effective_from: "2026-01-05", counts_as_expense: false, next_occurrence_on: "2026-02-05", status: "planned", ends_on: null, effective_to: null, version_note: null, supersedes_version_id: null, from_account_id: null, to_account_id: null } },
      { key: "demo-benefit-income", values: { series_id: "demo-benefit-income-series", account_id: "demo-chequing", kind: "income", frequency: "monthly", weekday_adjustment: "none", description: "Demo monthly benefit", amount_minor: 35000, currency: "CAD", starts_on: "2026-01-10", effective_from: "2026-01-10", counts_as_expense: false, next_occurrence_on: "2026-02-10", status: "planned", ends_on: null, effective_to: null, version_note: null, supersedes_version_id: null, from_account_id: null, to_account_id: null } },
      { key: "demo-utilities-recurring", values: { series_id: "demo-utilities-series", account_id: "demo-chequing", kind: "expense", frequency: "monthly", weekday_adjustment: "none", description: "Demo utilities", amount_minor: 22000, currency: "CAD", starts_on: "2026-01-03", effective_from: "2026-01-03", counts_as_expense: false, next_occurrence_on: "2026-02-03", status: "planned", ends_on: null, effective_to: null, version_note: null, supersedes_version_id: null, from_account_id: null, to_account_id: null } },
      { key: "demo-card-payment", values: { series_id: "demo-card-payment-series", account_id: "demo-chequing", kind: "expense", frequency: "monthly", weekday_adjustment: "none", description: "Demo credit card payment", amount_minor: 45000, currency: "CAD", starts_on: "2026-01-20", effective_from: "2026-01-20", counts_as_expense: false, next_occurrence_on: "2026-02-20", status: "planned", ends_on: null, effective_to: null, version_note: null, supersedes_version_id: null, from_account_id: null, to_account_id: null } },
      { key: "demo-grocery-recurring", values: { series_id: "demo-grocery-series", account_id: "demo-chequing", kind: "expense", frequency: "weekly", weekday_adjustment: "none", description: "Demo groceries", amount_minor: 18500, currency: "CAD", starts_on: "2026-01-04", effective_from: "2026-01-04", counts_as_expense: false, next_occurrence_on: "2026-01-11", status: "planned", ends_on: null, effective_to: null, version_note: null, supersedes_version_id: null, from_account_id: null, to_account_id: null } },
      ...DEMO_ADDITIONAL_RECURRING_TRANSACTIONS,
      { key: "demo-household-total", values: { series_id: "demo-household-total-series", account_id: "demo-chequing", kind: "expense", frequency: "monthly", weekday_adjustment: "none", description: "Demo household costs (monthly)", amount_minor: 376417, currency: "CAD", starts_on: "2026-01-01", effective_from: "2026-01-01", counts_as_expense: false, next_occurrence_on: "2026-09-01", status: "planned", ends_on: null, effective_to: null, version_note: "Linked Home household total", supersedes_version_id: null, from_account_id: null, to_account_id: null } },
      { key: "demo-savings-transfer-version-1", values: { series_id: "demo-savings-transfer-series", account_id: null, kind: "transfer", frequency: "monthly", weekday_adjustment: "none", description: "Demo savings transfer", amount_minor: 50000, currency: "CAD", starts_on: "2026-01-05", effective_from: "2026-01-05", counts_as_expense: false, next_occurrence_on: "2026-01-05", status: "planned", ends_on: "2026-07-05", effective_to: "2026-07-05", version_note: "Initial demo savings schedule", supersedes_version_id: null, from_account_id: "demo-chequing", to_account_id: "demo-savings" } },
      { key: "demo-savings-transfer-version-2", values: { series_id: "demo-savings-transfer-series", account_id: null, kind: "transfer", frequency: "monthly", weekday_adjustment: "none", description: "Demo savings transfer", amount_minor: 75000, currency: "CAD", starts_on: "2026-01-05", effective_from: "2026-08-05", counts_as_expense: false, next_occurrence_on: "2026-09-05", status: "planned", ends_on: null, effective_to: null, version_note: "Increased savings transfer for the second half of the year", supersedes_version_id: "demo-savings-transfer-version-1", from_account_id: "demo-chequing", to_account_id: "demo-savings" } },
    ],
  },
  {
    table: "recurring_cash_flow_occurrence_exceptions",
    rows: [
      { key: "demo-grocery-skip-september-6", values: { series_id: "demo-grocery-series", version_id: "demo-grocery-recurring", transaction_id: null, transfer_id: null, scheduled_occurrence_on: "2026-09-06", override_group_id: null, kind: "skip", date_override: null, amount_override_minor: null, account_override_id: null, from_account_override_id: null, to_account_override_id: null, status_override: null, note: "Demo skip: away for the weekend", is_active: true } },
    ],
  },
  {
    table: "transfers",
    rows: [
      { key: "demo-savings-transfer-august", values: { period_id: "demo-period-aug-2", from_account_id: "demo-chequing", to_account_id: "demo-savings", recurring_transaction_id: "demo-savings-transfer-version-2", recurring_series_id: "demo-savings-transfer-series", recurring_occurrence_id: null, scheduled_occurrence_on: "2026-08-05", is_generated: false, transfer_date: "2026-08-05", amount_minor: 75000, currency: "CAD", status: "planned", description: "Demo savings transfer" } },
    ],
  },
  {
    table: "transactions",
    rows: [
      { key: "demo-income-actual", values: { account_id: "demo-chequing", period_id: "demo-period-jan", recurring_series_id: "demo-income-series", transaction_date: "2026-01-02", kind: "income", status: "actual", is_excluded: false, description: "Demo paycheque", category: "Income", amount_minor: 265000, currency: "CAD" } },
      { key: "demo-rent-planned", values: { account_id: "demo-chequing", period_id: "demo-period-feb", recurring_series_id: "demo-rent-series", transaction_date: "2026-01-15", kind: "expense", status: "planned", is_excluded: false, description: "Demo apartment rent", category: "Housing", amount_minor: 165000, currency: "CAD" } },
      { key: "demo-groceries", values: { account_id: "demo-chequing", period_id: "demo-period-mar", recurring_series_id: null, transaction_date: "2026-01-30", kind: "expense", status: "planned", is_excluded: false, description: "Demo groceries", category: "Food", amount_minor: 18500, currency: "CAD" } },
      { key: "demo-freelance-income-planned", values: { account_id: "demo-chequing", period_id: "demo-period-feb", recurring_series_id: "demo-freelance-income-series", transaction_date: "2026-01-15", kind: "income", status: "planned", is_excluded: false, description: "Demo freelance income", category: "Income", amount_minor: 75000, currency: "CAD" } },
      { key: "demo-benefit-income-planned", values: { account_id: "demo-chequing", period_id: "demo-period-mar", recurring_series_id: "demo-benefit-income-series", transaction_date: "2026-01-30", kind: "income", status: "planned", is_excluded: false, description: "Demo monthly benefit", category: "Income", amount_minor: 35000, currency: "CAD" } },
      { key: "demo-utilities-planned", values: { account_id: "demo-chequing", period_id: "demo-period-feb", recurring_series_id: "demo-utilities-series", transaction_date: "2026-01-20", kind: "expense", status: "planned", is_excluded: false, description: "Demo utilities", category: "Home", amount_minor: 22000, currency: "CAD" } },
      { key: "demo-card-payment-planned", values: { account_id: "demo-chequing", period_id: "demo-period-mar", recurring_series_id: "demo-card-payment-series", transaction_date: "2026-01-30", kind: "expense", status: "planned", is_excluded: false, description: "Demo credit card payment", category: "Debt", amount_minor: 45000, currency: "CAD" } },
      ...DEMO_ADDITIONAL_TRANSACTION_SEEDS.map(demoTransactionRow),
    ],
  },
  { table: "annual_budgets", rows: [{ key: "demo-annual-budget", values: { name: "Demo annual essentials", linked_account_id: "demo-chequing", is_active: true, display_order: 0 } }] },
  {
    table: "annual_expenses",
    rows: [
      { key: "demo-insurance", values: { budget_id: "demo-annual-budget", account_id: "demo-chequing", name: "Demo home insurance", amount_minor: 145000, funded_minor: 60000, due_month: 3, due_day: 15, currency: "CAD", is_active: true } },
      { key: "demo-registration", values: { budget_id: "demo-annual-budget", account_id: "demo-chequing", name: "Demo vehicle registration", amount_minor: 32000, funded_minor: 0, due_month: 6, due_day: 1, currency: "CAD", is_active: true } },
      { key: "demo-gifts", values: { budget_id: "demo-annual-budget", account_id: "demo-chequing", name: "Demo gifts", amount_minor: 90000, funded_minor: 15000, due_month: 12, due_day: 15, currency: "CAD", is_active: true } },
      ...DEMO_ADDITIONAL_ANNUAL_EXPENSES,
    ],
  },
  {
    table: "annual_expense_values",
    rows: [
      { key: "demo-insurance-value", values: { annual_expense_id: "demo-insurance", budget_id: "demo-annual-budget", tax_year: 2026, amount_minor: 145000, funded_minor: 60000, currency: "CAD" } },
      { key: "demo-registration-value", values: { annual_expense_id: "demo-registration", budget_id: "demo-annual-budget", tax_year: 2026, amount_minor: 32000, funded_minor: 0, currency: "CAD" } },
      { key: "demo-gifts-value", values: { annual_expense_id: "demo-gifts", budget_id: "demo-annual-budget", tax_year: 2026, amount_minor: 90000, funded_minor: 15000, currency: "CAD" } },
      ...DEMO_ADDITIONAL_ANNUAL_EXPENSE_VALUES,
    ],
  },
  { table: "annual_expense_payments", rows: [{ key: "demo-insurance-payment", values: { annual_expense_value_id: "demo-insurance-value", payment_on: "2026-03-15", amount_minor: 60000, note: "Demo payment", } }, ...DEMO_ADDITIONAL_ANNUAL_EXPENSE_PAYMENTS] },
  { table: "annual_maintenance_items", rows: DEMO_ADDITIONAL_ANNUAL_MAINTENANCE_ITEMS },
  {
    table: "household_expenses",
    rows: [
      { key: "demo-utilities", values: { account_id: "demo-chequing", name: "Demo utilities", category: "Home", frequency: "monthly", amount_minor: 22000, annual_amount_minor: 264000, currency: "CAD", starts_on: "2026-01-01", is_active: true } },
      { key: "demo-mortgage-payment", values: { account_id: "demo-chequing", name: "Demo mortgage payment", category: "Home", frequency: "biweekly", amount_minor: 92500, annual_amount_minor: 2405000, currency: "CAD", starts_on: "2026-01-02", is_active: true } },
      ...DEMO_ADDITIONAL_HOUSEHOLD_EXPENSES,
    ],
  },
  { table: "homes", rows: [{ key: "demo-home", values: { name: "Demo home", currency: "CAD" } }] },
  {
    table: "home_value_snapshots",
    rows: [
      { key: "demo-home-value-2025", values: { home_id: "demo-home", as_of: "2025-12-31", market_value_minor: 52500000 } },
      { key: "demo-home-value-2026", values: { home_id: "demo-home", as_of: "2026-01-01", market_value_minor: 53000000 } },
      ...DEMO_ADDITIONAL_HOME_VALUE_SNAPSHOTS,
    ],
  },
  { table: "home_mortgage_anchors", rows: [{ key: "demo-mortgage-anchor", values: { home_id: "demo-home", as_of: "2026-01-01", principal_minor: 31800000 } }, ...DEMO_ADDITIONAL_MORTGAGE_ANCHORS] },
  { table: "home_mortgage_terms", rows: [{ key: "demo-mortgage-terms", values: { home_id: "demo-home", effective_on: "2026-01-01", annual_rate_bps: 489, compounding_convention: "canadian_semi_annual", payment_expense_id: "demo-mortgage-payment", payment_minor: 92500, next_payment_on: "2026-01-02", renewal_on: "2029-01-01", payoff_on: "2051-01-01" } }] },
  {
    table: "liabilities",
    rows: [
      { key: "demo-mortgage", values: { account_id: "demo-chequing", name: "Demo mortgage", lender: "Demo lender", kind: "mortgage", status: "active", original_balance_minor: 35000000, current_balance_minor: 31800000, interest_rate_bps: 489, minimum_payment_minor: 185000, payment_frequency: "monthly", as_of: "2026-01-01", currency: "CAD" } },
      { key: "demo-travel-card-liability", values: { account_id: "demo-travel-card", name: "Demo travel card balance", lender: "Demo Community Bank", kind: "credit", status: "active", original_balance_minor: 800000, current_balance_minor: 125000, interest_rate_bps: 1999, minimum_payment_minor: 12500, payment_frequency: "monthly", as_of: "2026-01-01", currency: "CAD" } },
      { key: "demo-everyday-card-liability", values: { account_id: "demo-everyday-card", name: "Demo everyday card balance", lender: "Demo Community Bank", kind: "credit", status: "active", original_balance_minor: 400000, current_balance_minor: 68000, interest_rate_bps: 2299, minimum_payment_minor: 7500, payment_frequency: "monthly", as_of: "2026-01-01", currency: "CAD" } },
      { key: "demo-auto-loan-liability", values: { account_id: "demo-auto-loan", name: "Demo auto loan", lender: "Demo Auto Finance", kind: "loan", status: "active", original_balance_minor: 2500000, current_balance_minor: 1850000, interest_rate_bps: 699, minimum_payment_minor: 65000, payment_frequency: "monthly", as_of: "2026-01-01", currency: "CAD" } },
    ],
  },
  { table: "salary_years", rows: [{ key: "demo-salary-year", values: { tax_year: 2026, annual_base_minor: 6890000, status: "in_progress", pay_periods_per_year_override: 26, note: "Demo salary year", final_federal_minor: null } }, ...DEMO_ADDITIONAL_SALARY_YEARS] },
  {
    table: "salary_snapshots",
    rows: [
      { key: "demo-salary-snapshot-1", values: { salary_year_id: "demo-salary-year", snapshot_on: "2026-01-16", federal_cumulative_minor: 530000, provincial_cumulative_minor: 510000, completed_pay_number: 1, rrq_contribution_ytd_minor: 26500, note: "Demo snapshot" } },
      { key: "demo-salary-snapshot-2", values: { salary_year_id: "demo-salary-year", snapshot_on: "2026-02-13", federal_cumulative_minor: 1590000, provincial_cumulative_minor: 1530000, completed_pay_number: 3, rrq_contribution_ytd_minor: 79500, note: "Demo snapshot" } },
      ...DEMO_ADDITIONAL_SALARY_SNAPSHOTS,
    ],
  },
  { table: "rrq_year_limit_overrides", rows: [{ key: "demo-rrq-2026", values: { tax_year: 2026, first_maximum_minor: 447930, additional_maximum_minor: 41600, ympe_minor: 7460000, yampe_minor: 8500000, first_rate_bps: 630, additional_rate_bps: 400 } }] },
  { table: "shared_projects", rows: [{ key: "demo-project", values: { name: "Demo weekend project", project_year: 2026, owner_participates: true, note: "Synthetic shared-project example" } }] },
  {
    table: "shared_project_expenses",
    rows: [
      { key: "demo-project-hotel", values: { project_id: "demo-project", description: "Demo hotel", expense_on: "2026-05-15", quantity: 1, amount_minor: 28000, note: "Synthetic project expense" } },
      { key: "demo-project-food", values: { project_id: "demo-project", description: "Demo meals", expense_on: "2026-05-16", quantity: 2, amount_minor: 12500, note: "Synthetic project expense" } },
    ],
  },
  {
    table: "shared_project_participants",
    rows: [
      { key: "demo-participant-owner", values: { project_id: "demo-project", name: "Demo owner", paid_minor: 20000 } },
      { key: "demo-participant-friend", values: { project_id: "demo-project", name: "Demo friend", paid_minor: 0 } },
    ],
  },
  {
    table: "investment_accounts",
    rows: [
      { key: "demo-investment", values: { institution_id: "demo-bank", account_id: "demo-savings", name: "Demo index portfolio", kind: "non_registered", currency: "CAD", is_active: true } },
      { key: "demo-rrsp-investment", values: { institution_id: "demo-bank", account_id: "demo-rrsp", name: "Demo RRSP portfolio", kind: "registered", currency: "CAD", is_active: true } },
      { key: "demo-tfsa-investment", values: { institution_id: "demo-bank", account_id: "demo-tfsa", name: "Demo TFSA portfolio", kind: "registered", currency: "CAD", is_active: true } },
      { key: "demo-fhsa-investment", values: { institution_id: "demo-bank", account_id: "demo-fhsa", name: "Demo FHSA portfolio", kind: "registered", currency: "CAD", is_active: true } },
      { key: "demo-non-registered-investment", values: { institution_id: "demo-bank", account_id: "demo-non-registered", name: "Demo non-registered portfolio", kind: "non_registered", currency: "CAD", is_active: true } },
    ],
  },
  { table: "investment_projection_projects", rows: [{ key: "demo-investment-project", values: { name: "Demo long-term projection", notes: "Synthetic portfolio projection", mode: "portfolio", horizon_years: 15, compounding_periods_per_year: 12 } }] },
  {
    table: "investment_projection_project_accounts",
    rows: [
      { key: "demo-investment-project-account", values: { project_id: "demo-investment-project", investment_account_id: "demo-investment", display_order: 0 } },
      { key: "demo-rrsp-project-account", values: { project_id: "demo-investment-project", investment_account_id: "demo-rrsp-investment", display_order: 1 } },
      { key: "demo-tfsa-project-account", values: { project_id: "demo-investment-project", investment_account_id: "demo-tfsa-investment", display_order: 2 } },
      { key: "demo-fhsa-project-account", values: { project_id: "demo-investment-project", investment_account_id: "demo-fhsa-investment", display_order: 3 } },
    ],
  },
  {
    table: "investment_projection_project_rates",
    rows: [
      { key: "demo-investment-rate-1", values: { project_id: "demo-investment-project", rate_bps: 500, display_order: 0 } },
      { key: "demo-investment-rate-2", values: { project_id: "demo-investment-project", rate_bps: 400, display_order: 1 } },
      { key: "demo-investment-rate-3", values: { project_id: "demo-investment-project", rate_bps: 300, display_order: 2 } },
      { key: "demo-investment-rate-4", values: { project_id: "demo-investment-project", rate_bps: 200, display_order: 3 } },
    ],
  },
  {
    table: "investment_projection_project_account_schedules",
    rows: [
      { key: "demo-investment-schedule", values: { project_id: "demo-investment-project", project_account_id: "demo-investment-project-account", frequency: "monthly", base_contribution_minor: 25000, annual_increase_bps: 200, annual_increase_mode: "percentage", annual_increase_minor: 0, contribution_source: "manual" } },
      { key: "demo-rrsp-schedule", values: { project_id: "demo-investment-project", project_account_id: "demo-rrsp-project-account", frequency: "monthly", base_contribution_minor: 30000, annual_increase_bps: 150, annual_increase_mode: "percentage", annual_increase_minor: 0, contribution_source: "manual" } },
      { key: "demo-tfsa-schedule", values: { project_id: "demo-investment-project", project_account_id: "demo-tfsa-project-account", frequency: "biweekly", base_contribution_minor: 15000, annual_increase_bps: 100, annual_increase_mode: "percentage", annual_increase_minor: 0, contribution_source: "manual" } },
      { key: "demo-fhsa-schedule", values: { project_id: "demo-investment-project", project_account_id: "demo-fhsa-project-account", frequency: "monthly", base_contribution_minor: 20000, annual_increase_bps: 100, annual_increase_mode: "percentage", annual_increase_minor: 0, contribution_source: "manual" } },
    ],
  },
  {
    table: "investment_snapshots",
    rows: [
      { key: "demo-investment-snapshot-1", values: { investment_account_id: "demo-investment", as_of: "2025-12-31", balance_minor: 1200000, contribution_minor: 0, withdrawal_minor: 0, currency: "CAD" } },
      { key: "demo-investment-snapshot-2", values: { investment_account_id: "demo-investment", as_of: "2026-01-31", balance_minor: 1245000, contribution_minor: 25000, withdrawal_minor: 0, currency: "CAD" } },
      { key: "demo-rrsp-snapshot-1", values: { investment_account_id: "demo-rrsp-investment", as_of: "2025-12-31", balance_minor: 2400000, contribution_minor: 0, withdrawal_minor: 0, currency: "CAD" } },
      { key: "demo-rrsp-snapshot-2", values: { investment_account_id: "demo-rrsp-investment", as_of: "2026-01-31", balance_minor: 2430000, contribution_minor: 30000, withdrawal_minor: 0, currency: "CAD" } },
      { key: "demo-tfsa-snapshot-1", values: { investment_account_id: "demo-tfsa-investment", as_of: "2025-12-31", balance_minor: 1700000, contribution_minor: 0, withdrawal_minor: 0, currency: "CAD" } },
      { key: "demo-tfsa-snapshot-2", values: { investment_account_id: "demo-tfsa-investment", as_of: "2026-01-31", balance_minor: 1715000, contribution_minor: 15000, withdrawal_minor: 0, currency: "CAD" } },
      { key: "demo-fhsa-snapshot-1", values: { investment_account_id: "demo-fhsa-investment", as_of: "2025-12-31", balance_minor: 620000, contribution_minor: 0, withdrawal_minor: 0, currency: "CAD" } },
      { key: "demo-fhsa-snapshot-2", values: { investment_account_id: "demo-fhsa-investment", as_of: "2026-01-31", balance_minor: 640000, contribution_minor: 20000, withdrawal_minor: 0, currency: "CAD" } },
      { key: "demo-non-registered-snapshot-1", values: { investment_account_id: "demo-non-registered-investment", as_of: "2025-12-31", balance_minor: 3100000, contribution_minor: 0, withdrawal_minor: 0, currency: "CAD" } },
      { key: "demo-non-registered-snapshot-2", values: { investment_account_id: "demo-non-registered-investment", as_of: "2026-01-31", balance_minor: 3110000, contribution_minor: 10000, withdrawal_minor: 0, currency: "CAD" } },
      ...DEMO_ADDITIONAL_INVESTMENT_SNAPSHOTS,
    ],
  },
  {
    table: "investment_scenarios",
    rows: [
      { key: "demo-investment-scenario", values: { investment_account_id: "demo-investment", name: "Demo steady growth", starts_on: "2026-01-01", initial_value_minor: 1245000, periodic_contribution_minor: 25000, contribution_frequency: "monthly", annual_return_bps: 550, compounding_periods_per_year: 12, horizon_years: 15, status: "draft", currency: "CAD" } },
      { key: "demo-rrsp-scenario", values: { investment_account_id: "demo-rrsp-investment", name: "Demo RRSP growth", starts_on: "2026-01-01", initial_value_minor: 2430000, periodic_contribution_minor: 30000, contribution_frequency: "monthly", annual_return_bps: 600, compounding_periods_per_year: 12, horizon_years: 20, status: "draft", currency: "CAD" } },
      { key: "demo-tfsa-scenario", values: { investment_account_id: "demo-tfsa-investment", name: "Demo TFSA growth", starts_on: "2026-01-01", initial_value_minor: 1715000, periodic_contribution_minor: 15000, contribution_frequency: "monthly", annual_return_bps: 550, compounding_periods_per_year: 12, horizon_years: 15, status: "draft", currency: "CAD" } },
      { key: "demo-fhsa-scenario", values: { investment_account_id: "demo-fhsa-investment", name: "Demo FHSA growth", starts_on: "2026-01-01", initial_value_minor: 640000, periodic_contribution_minor: 20000, contribution_frequency: "monthly", annual_return_bps: 500, compounding_periods_per_year: 12, horizon_years: 10, status: "draft", currency: "CAD" } },
      { key: "demo-non-registered-scenario", values: { investment_account_id: "demo-non-registered-investment", name: "Demo non-registered growth", starts_on: "2026-01-01", initial_value_minor: 3110000, periodic_contribution_minor: 10000, contribution_frequency: "monthly", annual_return_bps: 450, compounding_periods_per_year: 12, horizon_years: 20, status: "draft", currency: "CAD" } },
    ],
  },
  { table: "financial_goals", rows: [{ key: "demo-goal", values: { name: "Demo emergency reserve", target_minor: 1500000, current_minor: 875000, target_date: "2027-12-31", priority: 1, status: "active", currency: "CAD" } }, ...DEMO_ADDITIONAL_GOALS] },
];

function deterministicId(table: string, key: string): string {
  const bytes = createHash("sha256").update(`athena-vault-demo:${DEMO_ID_VERSION}:${table}:${key}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function fixtureReference(value: Scalar): { table: string; key: string } | undefined {
  if (typeof value !== "string") return undefined;
  for (const group of DEMO_FIXTURE) {
    if (group.rows.some((row) => row.key === value)) return { table: group.table, key: value };
  }
  return undefined;
}

function resolvedValue(value: Scalar): Scalar {
  if (typeof value !== "string") return value;
  const reference = fixtureReference(value);
  return reference ? deterministicId(reference.table, reference.key) : value;
}

export function normalized(value: unknown): string | boolean | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "boolean") return value;
  return String(value);
}

function fingerprintEntries(): Array<Record<string, unknown>> {
  return DEMO_FIXTURE.flatMap((group) => group.rows.map((row) => ({
    table: group.table,
    key: row.key,
    id: deterministicId(group.table, row.key),
    values: Object.fromEntries(Object.keys(row.values).sort().map((name) => [name, normalized(resolvedValue(row.values[name]!))])),
  })));
}

export function demoFixtureFingerprint(): string {
  return createHash("sha256").update(JSON.stringify(fingerprintEntries())).digest("hex");
}

function parseEnvironment(contents: string): Environment {
  const values: Environment = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const name = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) value = value.slice(1, -1);
    values[name] = value;
  }
  return values;
}

async function readEnvironmentFile(filePath: string): Promise<Environment> {
  return parseEnvironment(await readFile(filePath, "utf8"));
}

function hasExplicitEnvironmentFile(argv: readonly string[]): boolean {
  const argumentIndex = argv.indexOf("--env-file");
  return argumentIndex >= 0 && Boolean(argv[argumentIndex + 1]);
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function environmentValue(name: string, environment: Environment): string | undefined {
  return process.env[name]?.trim() || environment[name]?.trim();
}

function requireEnvironmentValue(name: string, environment: Environment): string {
  const value = environmentValue(name, environment);
  if (!value) throw new Error(`Missing required value: ${name}.`);
  return value;
}

function selectedEnvironmentFile(argv: readonly string[] = process.argv, root = projectRoot): string {
  const argumentIndex = argv.indexOf("--env-file");
  return argumentIndex >= 0 && argv[argumentIndex + 1] ? path.resolve(process.cwd(), argv[argumentIndex + 1]!) : path.join(root, ".env.local");
}

export async function loadEnvironment(argv: readonly string[] = process.argv, root = projectRoot): Promise<Environment> {
  const environmentFile = selectedEnvironmentFile(argv, root);
  try {
    return await readEnvironmentFile(environmentFile);
  } catch (error) {
    // Docker injects the complete provisioning environment through Compose and
    // intentionally does not mount a workstation .env.local into the image.
    // Preserve an explicit --env-file failure while allowing that container
    // mode to fall through to process.env via environmentValue().
    if (!hasExplicitEnvironmentFile(argv) && isMissingFileError(error)) return {};
    throw error;
  }
}

type DatabaseConnection = Readonly<{
  url: string;
  password: string;
}>;

function resolveDatabaseConnection(environment: Environment): DatabaseConnection {
  const template = requireEnvironmentValue("ATHENA_MIGRATOR_DATABASE_URL", environment);
  const password = requireEnvironmentValue("ATHENA_MIGRATOR_PASSWORD", environment);
  const encodedPassword = encodeURIComponent(password);
  return {
    url: template
      .replaceAll("$ATHENA_MIGRATOR_PASSWORD", encodedPassword)
      .replaceAll("${ATHENA_MIGRATOR_PASSWORD}", encodedPassword),
    password,
  };
}

function expectedDatabaseName(environment: Environment): string {
  const configuredName = environmentValue("ATHENA_DB_NAME", environment);
  if (configuredName) return configuredName;
  const template = requireEnvironmentValue("ATHENA_MIGRATOR_DATABASE_URL", environment);
  try {
    const databaseUrl = new URL(template
      .replaceAll("$ATHENA_MIGRATOR_PASSWORD", "athena-demo-password-placeholder")
      .replaceAll("${ATHENA_MIGRATOR_PASSWORD}", "athena-demo-password-placeholder"));
    const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, ""));
    if (databaseName) return databaseName;
  } catch {
    // Keep the failure message independent of the connection string.
  }
  throw new Error("ATHENA_MIGRATOR_DATABASE_URL must identify a target database.");
}

export function assertDemoTargetConfirmation(environment: Environment): void {
  const targetConfirmation = requireEnvironmentValue("ATHENA_DEMO_TARGET_CONFIRM", environment);
  if (targetConfirmation !== expectedDatabaseName(environment)) {
    throw new Error("ATHENA_DEMO_TARGET_CONFIRM must exactly match the configured target database name.");
  }
}

async function assertTargetDatabase(sql: Sql, environment: Environment): Promise<void> {
  const rows = await sql<{ name: string }[]>`select current_database() as name`;
  if (rows[0]?.name !== expectedDatabaseName(environment)) throw new Error("Connected database does not match the configured demo target.");
}

function assertConfiguration(environment: Environment): { email: string; password: string } {
  if (environmentValue(DEMO_ENABLED_ENV, environment)?.toLowerCase() !== "true") throw new Error(`${DEMO_ENABLED_ENV} must be true for demo provisioning.`);
  assertDemoTargetConfirmation(environment);
  const email = requireEnvironmentValue(DEMO_IDENTIFIER_ENV, environment).toLowerCase();
  const password = requireEnvironmentValue(DEMO_PASSWORD_ENV, environment);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(`${DEMO_IDENTIFIER_ENV} must be an email-shaped login identifier.`);
  if (password.length < 8 || password.length > 128) throw new Error(`${DEMO_PASSWORD_ENV} must contain 8-128 characters.`);
  return { email, password };
}

function groupColumns(group: FixtureGroup): string[] {
  const first = group.rows[0];
  if (!first) throw new Error(`Demo fixture table ${group.table} has no rows.`);
  const columns = Object.keys(first.values);
  if (group.rows.some((row) => JSON.stringify(Object.keys(row.values)) !== JSON.stringify(columns))) throw new Error(`Demo fixture table ${group.table} has inconsistent columns.`);
  return columns;
}

type FixtureSql = Pick<Sql, "unsafe">;

export type DemoFixtureVerification = Readonly<{
  counts: Readonly<Record<string, number>>;
  fingerprint: string;
}>;

async function insertFixture(tx: FixtureSql, ownerId: string): Promise<void> {
  for (const group of DEMO_FIXTURE) {
    const columns = groupColumns(group);
    const parameters: Scalar[] = [];
    const valuesSql = group.rows.map((row) => {
      const rowParameters: Scalar[] = [deterministicId(group.table, row.key), ownerId];
      for (const value of Object.values(row.values)) rowParameters.push(resolvedValue(value));
      parameters.push(...rowParameters);
      const start = parameters.length - rowParameters.length + 1;
      return `(${rowParameters.map((_, index) => `$${start + index}`).join(", ")})`;
    }).join(", ");
    await tx.unsafe(`insert into public.${group.table} (id, owner_id, ${columns.join(", ")}) values ${valuesSql} on conflict (id) do nothing`, parameters);
  }
}

async function verifyFixture(tx: FixtureSql, ownerId: string): Promise<DemoFixtureVerification> {
  const counts: Record<string, number> = {};
  const actualEntries: Array<Record<string, unknown>> = [];
  for (const group of DEMO_FIXTURE) {
    const countRows = await tx.unsafe<{ count: string }[]>(`select count(*)::text as count from public.${group.table} where owner_id = $1`, [ownerId]);
    const expectedCount = group.rows.length;
    const actualCount = Number(countRows[0]?.count);
    counts[group.table] = actualCount;
    if (actualCount !== expectedCount) throw new Error(`Demo fixture drift detected in ${group.table}: expected ${expectedCount} rows.`);
    const columns = groupColumns(group);
    for (const row of group.rows) {
      const selected = ["id::text as id", "owner_id::text as owner_id", ...columns].join(", ");
      const expectedId = deterministicId(group.table, row.key);
      const records = await tx.unsafe<Record<string, unknown>[]>(`select ${selected} from public.${group.table} where id = $1 and owner_id = $2`, [expectedId, ownerId]);
      const record = records[0];
      if (!record) throw new Error(`Demo fixture drift detected in ${group.table}.${row.key}: row is missing.`);
      const expected: Record<string, unknown> = { id: expectedId, owner_id: ownerId };
      for (const column of columns) expected[column] = normalized(resolvedValue(row.values[column]!));
      for (const column of Object.keys(expected)) {
        if (normalized(record[column]) !== expected[column]) throw new Error(`Demo fixture drift detected in ${group.table}.${row.key}.`);
      }
      actualEntries.push({
        table: group.table,
        key: row.key,
        id: expectedId,
        values: Object.fromEntries(columns.slice().sort().map((column) => [column, normalized(record[column])])),
      });
    }
  }
  const actualFingerprint = createHash("sha256").update(JSON.stringify(actualEntries)).digest("hex");
  const expectedFingerprint = demoFixtureFingerprint();
  if (actualFingerprint !== expectedFingerprint) throw new Error("Demo fixture fingerprint mismatch.");
  return { counts, fingerprint: actualFingerprint };
}

type ProvisionResult = Readonly<{
  ownerId: string;
  created: boolean;
  verification: DemoFixtureVerification;
}>;

async function provision(environment: Environment, email: string, password: string): Promise<ProvisionResult> {
  const connection = resolveDatabaseConnection(environment);
  const sql = postgres(connection.url, { max: 1, password: connection.password, prepare: false });
  try {
    await assertTargetDatabase(sql, environment);
    const passwordHash = await hashPassword(password);
    const result = await sql.begin(async (tx): Promise<ProvisionResult> => {
      const normalCredentialOwners = await tx.unsafe<{ id: string }[]>(`select users.id::text as id
        from public.users
        join public.auth_user_workspaces on public.auth_user_workspaces.athena_user_id = public.users.id
        join public.auth_accounts on public.auth_accounts.user_id = public.auth_user_workspaces.auth_user_id
        where public.users.is_demo = false
          and public.auth_accounts.provider_id = 'credential'
        limit 1`);
      if (!normalCredentialOwners[0]) throw new Error("Create the primary owner through /setup before provisioning the demo.");

      const owners = await tx.unsafe<{ id: string; is_demo: boolean; demo_fixture_version: number | null }[]>("select id::text as id, is_demo, demo_fixture_version from public.users where lower(email) = $1 for update", [email]);
      if (owners.length > 1) throw new Error("Demo identifier matches more than one workspace owner.");
      let ownerId: string;
      const isNewOwner = !owners[0];
      const existingFixtureVersion = owners[0]?.demo_fixture_version ?? null;
      if (!owners[0]) {
        ownerId = randomUUID();
        await tx.unsafe("insert into public.users (id, email, display_name, is_demo, demo_fixture_version) values ($1::uuid, $2, $3, true, $4)", [ownerId, email, "Athena Vault Demo", DEMO_FIXTURE_VERSION]);
        await insertFixture(tx, ownerId);
      } else {
        ownerId = owners[0].id;
        if (!owners[0].is_demo) throw new Error("Configured demo identifier belongs to a normal workspace owner.");
        if (existingFixtureVersion !== DEMO_FIXTURE_VERSION && existingFixtureVersion !== 1 && existingFixtureVersion !== 2 && existingFixtureVersion !== 3 && existingFixtureVersion !== 4) throw new Error("Demo fixture version does not match the provisioner.");
      }

      const authUsers = await tx.unsafe<{ id: string; password: string | null }[]>("select id, (select password from public.auth_accounts where user_id = auth_users.id and provider_id = 'credential' limit 1) as password from public.auth_users where lower(email) = $1", [email]);
      if (authUsers.length > 1) throw new Error("Demo identifier matches more than one authentication user.");
      if (isNewOwner && authUsers[0]) throw new Error("Demo authentication identifier already exists.");
      if (!isNewOwner && !authUsers[0]) throw new Error("Demo authentication provisioning is incomplete.");
      if (authUsers[0] && authUsers[0].id !== ownerId) throw new Error("Demo authentication user is not mapped to the configured workspace owner.");
      if (!authUsers[0]) await tx.unsafe("insert into public.auth_users (id, name, email, email_verified) values ($1, $2, $3, false)", [ownerId, "Athena Vault Demo", email]);

      const mappings = await tx.unsafe<{ auth_user_id: string; athena_user_id: string }[]>("select auth_user_id, athena_user_id::text as athena_user_id from public.auth_user_workspaces where auth_user_id = $1 or athena_user_id = $2::uuid", [ownerId, ownerId]);
      if (mappings.length > 1 || (mappings[0] && (mappings[0].auth_user_id !== ownerId || mappings[0].athena_user_id !== ownerId))) throw new Error("Demo authentication/workspace mapping is mismatched.");
      if (!mappings[0] && !isNewOwner) throw new Error("Demo authentication provisioning is incomplete.");
      if (!mappings[0]) await tx.unsafe("insert into public.auth_user_workspaces (auth_user_id, athena_user_id) values ($1, $2::uuid)", [ownerId, ownerId]);

      const credentials = await tx.unsafe<{ id: string; password: string | null }[]>("select id, password from public.auth_accounts where user_id = $1 and provider_id = 'credential'", [ownerId]);
      if (credentials.length > 1) throw new Error("Demo owner has more than one credential account.");
      if (!credentials[0]) {
        if (!isNewOwner) throw new Error("Demo authentication provisioning is incomplete.");
        await tx.unsafe("insert into public.auth_accounts (id, issuer, account_id, provider_id, user_id, password) values ($1, 'local:credential', $2, 'credential', $2, $3)", [randomUUID(), ownerId, passwordHash]);
      } else if (!credentials[0].password || !(await verifyPassword({ hash: credentials[0].password, password }))) {
        throw new Error("Configured demo password does not match the existing demo credential.");
      }
      if (!isNewOwner && existingFixtureVersion !== DEMO_FIXTURE_VERSION) {
        await insertFixture(tx, ownerId);
        const updatedOwners = await tx.unsafe<{ id: string }[]>("update public.users set demo_fixture_version = $1 where id = $2::uuid and demo_fixture_version = $3 returning id", [DEMO_FIXTURE_VERSION, ownerId, existingFixtureVersion]);
        if (updatedOwners.length !== 1) throw new Error("Demo fixture version update failed.");
      }
      const verification = await verifyFixture(tx, ownerId);
      return { ownerId, created: isNewOwner, verification };
    });
    const status = result.created ? "complete" : "already-provisioned";
    console.log(`demo-provision=status=${status} fixtureVersion=${DEMO_FIXTURE_VERSION} fingerprint=${result.verification.fingerprint}`);
    return result;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function main(): Promise<void> {
  const environment = await loadEnvironment();
  const { email, password } = assertConfiguration(environment);
  await provision(environment, email, password);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Demo provisioning failed.");
    process.exitCode = 1;
  });
}
