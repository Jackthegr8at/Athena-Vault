import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import type { Database } from "../client";
import {
  money,
  prepareInvestmentContributionEvents,
  projectInvestmentCalculator,
  projectInvestmentPortfolio,
  summarizeInvestmentAnnualContributions,
  type InvestmentAnnualIncreaseMode,
  type InvestmentContributionEvent,
  type InvestmentContributionFrequency,
} from "@athena/finance-engine";
import {
  accounts,
  auditEvents,
  institutions,
  investmentAccounts,
  investmentProjectionProjectAccounts,
  investmentProjectionProjectAccountScheduleOverrides,
  investmentProjectionProjectAccountSchedules,
  investmentProjectionProjectRates,
  investmentProjectionProjects,
  investmentSnapshots,
  recurringCashFlowOccurrenceExceptions,
  recurringCashFlowSeries,
  recurringTransactions,
} from "../drizzle-schema";
import type {
  RecurringCashFlowVersionSchedule,
  RecurringOccurrenceException,
} from "../recurring-cash-flow";
import {
  inferInvestmentCashFlowDestination,
  resolveInvestmentCashFlowContributions,
  type InvestmentCashFlowSeriesSource,
  type InvestmentCashFlowSourceView,
  type InvestmentCashFlowTransferOutEvent,
} from "../investment-cash-flow-contributions";
import { toTorontoDateIso } from "../account-timeline";
import type { CashFlowAccountView } from "./cash-flow";
import {
  loadContributionRules,
  recurringExceptionSchedule,
  recurringVersionSchedule,
  requireOwnerText,
  type TimelineDatabase,
  type TransactionDatabase,
} from "./shared";

export type InvestmentProjectionProjectMode = "calculator" | "portfolio";


export interface InvestmentProjectionAnnualOverrideInput {
  readonly id?: string | null;
  readonly year: number;
  readonly amountMinor: number;
}


export interface InvestmentProjectionAccountScheduleInput {
  readonly id?: string | null;
  readonly investmentAccountId: string;
  readonly displayOrder?: number;
  readonly frequency: InvestmentContributionFrequency;
  readonly baseContributionMinor: number;
  readonly annualIncreaseBps: number;
  readonly annualIncreaseMode?: InvestmentAnnualIncreaseMode;
  readonly annualIncreaseMinor?: number;
  readonly contributionSource?: "cash_flow" | "manual";
  readonly annualOverrides?: readonly InvestmentProjectionAnnualOverrideInput[];
}


export interface InvestmentProjectionLegacyProjectInput {
  readonly name: string;
  readonly notes?: string | null;
  readonly horizonYears: number;
  readonly investmentAccountIds: readonly string[];
  readonly ratesBps: readonly number[];
}


export interface InvestmentProjectionCalculatorProjectInput {
  readonly mode: "calculator";
  readonly name: string;
  readonly notes?: string | null;
  readonly horizonYears: number;
  readonly manualStartingAmountMinor: number;
  readonly ratesBps: readonly number[];
}


export interface InvestmentProjectionPortfolioProjectInput {
  readonly mode: "portfolio";
  readonly name: string;
  readonly notes?: string | null;
  readonly horizonYears: number;
  readonly accountSchedules: readonly InvestmentProjectionAccountScheduleInput[];
  readonly ratesBps: readonly number[];
}

/**
 * The account/rate-only shape remains accepted for the current server actions
 * while the mode-aware actions roll out. It is normalized to a portfolio and
 * only uses recurring rules as creation-time prefill candidates.
 */

export type InvestmentProjectionProjectInput =
  | InvestmentProjectionLegacyProjectInput
  | InvestmentProjectionCalculatorProjectInput
  | InvestmentProjectionPortfolioProjectInput;


export interface InvestmentProjectionPrefillCandidateView {
  readonly ruleId: string;
  readonly amountMinor: number;
  readonly frequency: InvestmentContributionFrequency;
  readonly startsOn: string;
  readonly endsOn: string | null;
}


export interface InvestmentProjectionScheduleView {
  readonly id: string;
  readonly investmentAccountId: string;
  readonly frequency: InvestmentContributionFrequency;
  readonly baseContributionMinor: number;
  readonly annualIncreaseBps: number;
  readonly annualIncreaseMode: InvestmentAnnualIncreaseMode;
  readonly annualIncreaseMinor: number;
  readonly contributionSource: "cash_flow" | "manual";
  readonly annualOverrides: readonly InvestmentProjectionAnnualOverrideView[];
}


export interface InvestmentProjectionAnnualOverrideView {
  readonly id: string;
  readonly year: number;
  readonly amountMinor: number;
}


export interface InvestmentProjectionAvailableAccountView {
  readonly id: string;
  readonly name: string;
  readonly kind: (typeof investmentAccounts.$inferSelect)["kind"];
  readonly currency: (typeof investmentAccounts.$inferSelect)["currency"];
  readonly isActive: boolean;
  readonly linkedAccountId: string | null;
  /** Effective operational destination used by automatic Cash Flow resolution. */
  readonly cashFlowAccountId: string | null;
  /** Whether the effective destination was persisted, inferred, or unavailable. */
  readonly cashFlowLinkSource: "saved" | "detected" | "none";
  readonly latest: {
    readonly asOf: string;
    readonly balanceMinor: number;
  } | null;
  readonly contributionRuleCount: number;
  /** Enabled monthly/biweekly rules that may prefill a new project. */
  readonly prefillCandidates: readonly InvestmentProjectionPrefillCandidateView[];
  readonly cashFlowSources: readonly InvestmentCashFlowSourceView[];
  readonly cashFlowWarnings: readonly string[];
  readonly cashFlowEvents: readonly InvestmentContributionEvent[];
  /** Funding-account outflows for the same destination contributions. */
  readonly cashFlowTransferOutEvents: readonly InvestmentCashFlowTransferOutEvent[];
}


export interface InvestmentProjectionAccountView extends InvestmentProjectionAvailableAccountView {
  readonly projectAccountId: string | null;
  readonly displayOrder: number;
  readonly warning: string | null;
  readonly schedule: InvestmentProjectionScheduleView | null;
}


export interface InvestmentProjectionRateView {
  readonly id: string;
  readonly rateBps: number;
  readonly displayOrder: number;
}


export interface InvestmentProjectionPointView {
  readonly year: number;
  readonly calendarYear: number;
  readonly balanceMinor: number;
  readonly contributionsMinor: number;
  readonly growthMinor: number;
}


export interface InvestmentProjectionScenarioView {
  readonly rateBps: number;
  readonly points: readonly InvestmentProjectionPointView[];
}


export interface InvestmentProjectionAnnualContributionView {
  readonly calendarYear: number;
  readonly biweeklyAmountMinor: number | null;
  readonly monthlyAmountMinor: number | null;
  readonly annualContributionMinor: number;
  readonly eventCount: number;
}


export interface InvestmentProjectionProjectSummaryView {
  readonly id: string;
  readonly name: string;
  readonly notes: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly mode: InvestmentProjectionProjectMode;
  readonly manualStartingAmountMinor: number | null;
  readonly horizonYears: number;
  readonly baselineDate: string;
  readonly accountCount: number;
  readonly rateBps: number;
  readonly startingBalanceMinor: number;
  readonly endingBalanceMinor: number;
  readonly warningCount: number;
}


export interface InvestmentProjectionProjectView extends InvestmentProjectionProjectSummaryView {
  readonly compoundingPeriodsPerYear: number;
  readonly accounts: readonly InvestmentProjectionAccountView[];
  readonly accountSchedules: readonly InvestmentProjectionScheduleView[];
  readonly rates: readonly InvestmentProjectionRateView[];
  readonly annualContributionSummary: readonly InvestmentProjectionAnnualContributionView[];
  readonly scenarios: readonly InvestmentProjectionScenarioView[];
  readonly warnings: readonly string[];
}


export interface InvestmentProjectionPageData {
  readonly asOf: string;
  readonly availableAccounts: readonly InvestmentProjectionAvailableAccountView[];
  readonly cashFlowAccounts: readonly CashFlowAccountView[];
  readonly projects: readonly InvestmentProjectionProjectView[];
}


export interface InvestmentProjectionSchedulePrefillView {
  readonly investmentAccountId: string;
  readonly displayOrder: number;
  readonly candidates: readonly InvestmentProjectionPrefillCandidateView[];
  readonly suggested: InvestmentProjectionAccountScheduleInput | null;
}


const investmentProjectionUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const investmentProjectionFrequencies = ["monthly", "biweekly"] as const;

const defaultInvestmentProjectionRatesBps = [500, 400, 300, 200] as const;
// The Investments page is a long-range planning tool. An omitted horizon is
// the preview/default path, so it must not silently truncate an open-ended
// recurring Cash Flow source to one year.

const defaultInvestmentProjectionHorizonYears = 30;


type NormalizedInvestmentProjectionSchedule = Omit<InvestmentProjectionAccountScheduleInput, "annualOverrides" | "displayOrder"> & {
  readonly displayOrder: number;
  readonly annualOverrides: readonly InvestmentProjectionAnnualOverrideInput[];
};


interface NormalizedInvestmentProjectionInput {
  readonly mode: InvestmentProjectionProjectMode;
  readonly name: string;
  readonly notes: string | null;
  readonly horizonYears: number;
  readonly manualStartingAmountMinor: number | null;
  readonly ratesBps: readonly number[];
  readonly accountSchedules: readonly NormalizedInvestmentProjectionSchedule[];
  readonly legacy: boolean;
}


function isInvestmentProjectionFrequency(value: string): value is InvestmentContributionFrequency {
  return (investmentProjectionFrequencies as readonly string[]).includes(value);
}


function investmentProjectionAnnualIncreaseMode(
  value: string | null | undefined,
): InvestmentAnnualIncreaseMode {
  if (value === "fixed_amount") return "fixed_amount";
  if (value === "percentage" || value == null) return "percentage";
  throw new Error("Investment annual contribution increase mode is invalid.");
}


function assertProjectionSafeMinorAmount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer in minor units.`);
}


function assertProjectionRate(value: number): void {
  if (!Number.isSafeInteger(value) || value < -10_000 || value > 10_000) throw new Error("Annual return must be between -100% and 100% in basis points.");
}


function normalizeProjectionSchedule(
  schedule: InvestmentProjectionAccountScheduleInput,
  displayOrder: number,
): NormalizedInvestmentProjectionSchedule {
  if (!investmentProjectionUuidPattern.test(schedule.investmentAccountId)) throw new Error("Investment account ID is invalid.");
  if (!isInvestmentProjectionFrequency(schedule.frequency)) throw new Error("Investment contribution frequency must be monthly or biweekly.");
  assertProjectionSafeMinorAmount(schedule.baseContributionMinor, "Investment base contribution");
  if (!Number.isSafeInteger(schedule.annualIncreaseBps) || schedule.annualIncreaseBps < 0 || schedule.annualIncreaseBps > 10_000) {
    throw new Error("Annual contribution increase must be between 0% and 100% in basis points.");
  }
  const annualIncreaseMode = schedule.annualIncreaseMode ?? "percentage";
  if (annualIncreaseMode !== "percentage" && annualIncreaseMode !== "fixed_amount") {
    throw new Error("Annual contribution increase mode must be percentage or fixed amount.");
  }
  const annualIncreaseMinor = schedule.annualIncreaseMinor ?? 0;
  assertProjectionSafeMinorAmount(annualIncreaseMinor, "Annual fixed contribution increase");
  if (annualIncreaseMode === "percentage" && annualIncreaseMinor !== 0) {
    throw new Error("Percentage contribution schedules cannot include a fixed annual increase.");
  }
  if (annualIncreaseMode === "fixed_amount" && schedule.annualIncreaseBps !== 0) {
    throw new Error("Fixed contribution schedules cannot include a percentage annual increase.");
  }
  const contributionSource = schedule.contributionSource ?? "cash_flow";
  if (contributionSource !== "cash_flow" && contributionSource !== "manual") {
    throw new Error("Investment contribution source must be Cash Flow or manual.");
  }
  const annualOverrides = [...(schedule.annualOverrides ?? [])].map((override) => {
    if (!Number.isSafeInteger(override.year) || override.year < 1900 || override.year > 2200) throw new Error("Investment override years must be between 1900 and 2200.");
    assertProjectionSafeMinorAmount(override.amountMinor, "Investment override amount");
    return { id: override.id ?? null, year: override.year, amountMinor: override.amountMinor };
  });
  if (new Set(annualOverrides.map((override) => override.year)).size !== annualOverrides.length) throw new Error("Annual override years must be unique.");
  annualOverrides.sort((left, right) => left.year - right.year);
  return {
    id: schedule.id ?? null,
    investmentAccountId: schedule.investmentAccountId,
    displayOrder,
    frequency: schedule.frequency,
    baseContributionMinor: schedule.baseContributionMinor,
    annualIncreaseBps: schedule.annualIncreaseBps,
    annualIncreaseMode,
    annualIncreaseMinor,
    contributionSource,
    annualOverrides,
  };
}


function normalizeInvestmentProjectionInput(input: InvestmentProjectionProjectInput): NormalizedInvestmentProjectionInput {
  const name = requireOwnerText(input.name, "Projection project name");
  const notes = input.notes?.trim() || null;
  if (notes && notes.length > 500) throw new Error("Projection project notes must be 500 characters or fewer.");
  if (!Number.isInteger(input.horizonYears) || input.horizonYears < 1 || input.horizonYears > 35) throw new Error("Projection horizon must be between 1 and 35 years.");
  const ratesBps = [...(input.ratesBps.length > 0 ? input.ratesBps : defaultInvestmentProjectionRatesBps)];
  if (ratesBps.length === 0 || ratesBps.length > 4 || ratesBps.some((rate) => !Number.isInteger(rate) || !Number.isSafeInteger(rate) || rate < -10_000 || rate > 10_000) || new Set(ratesBps).size !== ratesBps.length) {
    throw new Error("Choose between one and four unique annual return rates from -100% to 100%.");
  }
  ratesBps.forEach(assertProjectionRate);

  if (!("mode" in input)) {
    const accountIds = [...new Set(input.investmentAccountIds)];
    if (accountIds.length === 0 || accountIds.length > 4 || accountIds.some((id) => !investmentProjectionUuidPattern.test(id))) throw new Error("Choose between one and four investment accounts.");
    return { mode: "portfolio", name, notes, horizonYears: input.horizonYears, manualStartingAmountMinor: null, ratesBps, accountSchedules: [], legacy: true };
  }
  if (input.mode === "calculator") {
    assertProjectionSafeMinorAmount(input.manualStartingAmountMinor, "Manual starting amount");
    return { mode: "calculator", name, notes, horizonYears: input.horizonYears, manualStartingAmountMinor: input.manualStartingAmountMinor, ratesBps, accountSchedules: [], legacy: false };
  }

  if (input.accountSchedules.length === 0 || input.accountSchedules.length > 4) throw new Error("Choose between one and four investment accounts.");
  const indexed = input.accountSchedules.map((schedule, index) => ({ schedule, index, requestedOrder: schedule.displayOrder }));
  if (indexed.some((item) => item.requestedOrder !== undefined && (!Number.isInteger(item.requestedOrder) || item.requestedOrder < 0 || item.requestedOrder > 3))) throw new Error("Investment account display order must be between 0 and 3.");
  const explicitOrders = indexed.flatMap((item) => item.requestedOrder === undefined ? [] : [item.requestedOrder]);
  if (new Set(explicitOrders).size !== explicitOrders.length) throw new Error("Investment account display order must be unique.");
  indexed.sort((left, right) => (left.requestedOrder ?? left.index) - (right.requestedOrder ?? right.index) || left.index - right.index);
  const accountSchedules = indexed.map((item, displayOrder) => normalizeProjectionSchedule(item.schedule, displayOrder));
  if (new Set(accountSchedules.map((schedule) => schedule.investmentAccountId)).size !== accountSchedules.length) throw new Error("Select each investment account only once.");
  return { mode: "portfolio", name, notes, horizonYears: input.horizonYears, manualStartingAmountMinor: null, ratesBps, accountSchedules, legacy: false };
}


async function listInvestmentCashFlowSources(
  db: TimelineDatabase,
  ownerId: string,
): Promise<readonly InvestmentCashFlowSeriesSource[]> {
  const [seriesRows, versionRows, exceptionRows] = await Promise.all([
    db.select().from(recurringCashFlowSeries)
      .where(and(eq(recurringCashFlowSeries.ownerId, ownerId), eq(recurringCashFlowSeries.kind, "transfer"))),
    db.select().from(recurringTransactions)
      .where(and(eq(recurringTransactions.ownerId, ownerId), eq(recurringTransactions.kind, "transfer")))
      .orderBy(asc(recurringTransactions.effectiveFrom), asc(recurringTransactions.id)),
    db.select().from(recurringCashFlowOccurrenceExceptions)
      .where(eq(recurringCashFlowOccurrenceExceptions.ownerId, ownerId))
      .orderBy(asc(recurringCashFlowOccurrenceExceptions.scheduledOccurrenceOn), asc(recurringCashFlowOccurrenceExceptions.id)),
  ]);
  const versionsBySeries = new Map<string, RecurringCashFlowVersionSchedule[]>();
  for (const row of versionRows) {
    const versions = versionsBySeries.get(row.seriesId) ?? [];
    versions.push(recurringVersionSchedule(row));
    versionsBySeries.set(row.seriesId, versions);
  }
  const exceptionsBySeries = new Map<string, RecurringOccurrenceException[]>();
  for (const row of exceptionRows) {
    const exceptions = exceptionsBySeries.get(row.seriesId) ?? [];
    exceptions.push(recurringExceptionSchedule(row));
    exceptionsBySeries.set(row.seriesId, exceptions);
  }
  return seriesRows
    .flatMap((row) => {
      const versions = versionsBySeries.get(row.id) ?? [];
      if (versions.length === 0) return [];
      return [{
        seriesId: row.id,
        state: row.state,
        endedOn: row.endedOn,
        versions,
        exceptions: exceptionsBySeries.get(row.id) ?? [],
      } satisfies InvestmentCashFlowSeriesSource];
    });
}


async function listInvestmentCashFlowAccounts(
  db: TimelineDatabase,
  ownerId: string,
): Promise<readonly CashFlowAccountView[]> {
  return db.select({
    id: accounts.id,
    name: accounts.name,
    institution: institutions.name,
    kind: accounts.kind,
    currency: accounts.currency,
    isActive: accounts.isActive,
    includeInAvailableCash: accounts.includeInAvailableCash,
    isVisibleInCashFlow: accounts.isVisibleInCashFlow,
  }).from(accounts)
    .innerJoin(institutions, and(eq(institutions.id, accounts.institutionId), eq(institutions.ownerId, ownerId)))
    .where(and(eq(accounts.ownerId, ownerId), eq(accounts.isActive, true)))
    .orderBy(asc(accounts.timelineOrder), asc(accounts.name), asc(accounts.id));
}

interface ProjectionContributionRule {
  readonly id: string;
  readonly amountMinor: number;
  readonly frequency: string;
  readonly startsOn: string;
  readonly endsOn: string | null;
  readonly isEnabled: boolean;
}

interface ProjectionRequestContext {
  readonly cashFlowSources: readonly InvestmentCashFlowSeriesSource[];
  readonly cashFlowAccounts: readonly CashFlowAccountView[];
  readonly rulesByAccount: ReadonlyMap<string, readonly ProjectionContributionRule[]>;
}

async function loadProjectionRequestContext(
  db: TimelineDatabase,
  ownerId: string,
  asOfIso: string,
): Promise<ProjectionRequestContext> {
  const [cashFlowSources, cashFlowAccounts, rulesByAccount] = await Promise.all([
    listInvestmentCashFlowSources(db, ownerId),
    listInvestmentCashFlowAccounts(db, ownerId),
    loadContributionRules(db, ownerId, undefined, asOfIso),
  ]);
  return { cashFlowSources, cashFlowAccounts, rulesByAccount };
}


async function listProjectionAccounts(
  db: TimelineDatabase,
  ownerId: string,
  asOfIso: string,
  context: ProjectionRequestContext,
  accountIds?: readonly string[],
  activeOnly = false,
  horizonYears = defaultInvestmentProjectionHorizonYears,
): Promise<readonly InvestmentProjectionAvailableAccountView[]> {
  if (accountIds && accountIds.length === 0) return [];
  const accountWhere = and(
    eq(investmentAccounts.ownerId, ownerId),
    ...(activeOnly ? [eq(investmentAccounts.isActive, true)] : []),
    ...(accountIds ? [inArray(investmentAccounts.id, accountIds)] : []),
  );
  const accountRows = await db.select({
    id: investmentAccounts.id,
    name: investmentAccounts.name,
    kind: investmentAccounts.kind,
    currency: investmentAccounts.currency,
    isActive: investmentAccounts.isActive,
    linkedAccountId: investmentAccounts.accountId,
  }).from(investmentAccounts)
    .where(accountWhere)
    .orderBy(asc(investmentAccounts.name), asc(investmentAccounts.id));
  const accountRowIds = accountRows.map((account) => account.id);
  const snapshots = accountRowIds.length === 0 ? [] : await (() => {
    const ranked = db.$with("ranked").as(
      db.select({
        investmentAccountId: investmentSnapshots.investmentAccountId,
        asOf: investmentSnapshots.asOf,
        balanceMinor: investmentSnapshots.balanceMinor,
        id: investmentSnapshots.id,
        rn: sql`row_number() over (partition by ${investmentSnapshots.investmentAccountId} order by ${investmentSnapshots.asOf} desc, ${investmentSnapshots.id} asc)`.as("rn"),
      }).from(investmentSnapshots)
        .where(and(
          eq(investmentSnapshots.ownerId, ownerId),
          lte(investmentSnapshots.asOf, asOfIso),
          inArray(investmentSnapshots.investmentAccountId, accountRowIds),
        ))
    );
    return db.with(ranked).select({
      investmentAccountId: ranked.investmentAccountId,
      asOf: ranked.asOf,
      balanceMinor: ranked.balanceMinor,
    }).from(ranked)
      .where(sql`rn = 1`)
      .orderBy(asc(ranked.investmentAccountId));
  })();
  const latestByAccount = new Map(snapshots.map((snapshot) => [snapshot.investmentAccountId, snapshot] as const));
  const { cashFlowSources, cashFlowAccounts, rulesByAccount } = context;
  const effectiveCashFlowLinks = new Map(accountRows.map((account) => {
    const resolution = inferInvestmentCashFlowDestination(account.name, account.linkedAccountId, cashFlowAccounts, cashFlowSources);
    return [account.id, resolution] as const;
  }));
  return accountRows.map((account) => {
    const latest = latestByAccount.get(account.id);
    const cashFlowLink = effectiveCashFlowLinks.get(account.id) ?? { accountId: null, source: "none" as const };
    const prefillCandidates = (cashFlowLink.accountId ? (rulesByAccount.get(cashFlowLink.accountId) ?? []) : [])
      .flatMap((rule) => {
        if (!rule.isEnabled || !isInvestmentProjectionFrequency(rule.frequency)) return [];
        return [{
          ruleId: rule.id,
          amountMinor: rule.amountMinor,
          frequency: rule.frequency,
          startsOn: rule.startsOn,
          endsOn: rule.endsOn,
        }];
      });
    const cashFlowResolution = resolveInvestmentCashFlowContributions({
      targetAccountId: cashFlowLink.accountId,
      baselineDate: asOfIso,
      horizonYears,
      sources: cashFlowSources,
    });
    return {
      ...account,
      cashFlowAccountId: cashFlowLink.accountId,
      cashFlowLinkSource: cashFlowLink.source,
      latest: latest ? { asOf: latest.asOf, balanceMinor: latest.balanceMinor } : null,
      contributionRuleCount: prefillCandidates.length,
      prefillCandidates,
      cashFlowSources: cashFlowResolution.sources,
      cashFlowWarnings: cashFlowResolution.warnings,
      cashFlowEvents: cashFlowResolution.events,
      cashFlowTransferOutEvents: cashFlowResolution.transferOutEvents,
    };
  });
}



function toInvestmentPortfolioAccountInput(account: InvestmentProjectionAccountView) {
  const schedule = account.schedule;
  return {
    accountId: account.id,
    initialValue: money(account.latest?.balanceMinor ?? 0),
    schedule: schedule ? {
      frequency: schedule.frequency,
      baseContributionMinor: money(schedule.baseContributionMinor),
      annualIncreaseBps: schedule.annualIncreaseBps,
      annualIncreaseMode: schedule.annualIncreaseMode,
      annualIncreaseMinor: money(schedule.annualIncreaseMinor),
      annualOverrides: schedule.annualOverrides.map((override) => ({ year: override.year, amountMinor: money(override.amountMinor) })),
    } : {
      frequency: "monthly" as const,
      baseContributionMinor: money(0),
      annualIncreaseBps: 0,
      annualIncreaseMode: "percentage" as const,
      annualIncreaseMinor: money(0),
      annualOverrides: [],
    },
    contributionEvents: schedule?.contributionSource === "cash_flow" ? account.cashFlowEvents : undefined,
  };
}


async function loadPersistedProjectionSchedules(
  db: TimelineDatabase,
  ownerId: string,
  projectId: string,
): Promise<ReadonlyMap<string, InvestmentProjectionAccountScheduleInput>> {
  const links = await db.select({ id: investmentProjectionProjectAccounts.id, investmentAccountId: investmentProjectionProjectAccounts.investmentAccountId, displayOrder: investmentProjectionProjectAccounts.displayOrder })
    .from(investmentProjectionProjectAccounts)
    .where(and(eq(investmentProjectionProjectAccounts.ownerId, ownerId), eq(investmentProjectionProjectAccounts.projectId, projectId)));
  if (links.length === 0) return new Map();
  const schedules = await db.select({
    id: investmentProjectionProjectAccountSchedules.id,
    projectAccountId: investmentProjectionProjectAccountSchedules.projectAccountId,
    frequency: investmentProjectionProjectAccountSchedules.frequency,
    baseContributionMinor: investmentProjectionProjectAccountSchedules.baseContributionMinor,
    annualIncreaseBps: investmentProjectionProjectAccountSchedules.annualIncreaseBps,
    annualIncreaseMode: investmentProjectionProjectAccountSchedules.annualIncreaseMode,
    annualIncreaseMinor: investmentProjectionProjectAccountSchedules.annualIncreaseMinor,
    contributionSource: investmentProjectionProjectAccountSchedules.contributionSource,
  }).from(investmentProjectionProjectAccountSchedules)
    .where(and(eq(investmentProjectionProjectAccountSchedules.ownerId, ownerId), eq(investmentProjectionProjectAccountSchedules.projectId, projectId)));
  const overrides = schedules.length === 0 ? [] : await db.select({ id: investmentProjectionProjectAccountScheduleOverrides.id, scheduleId: investmentProjectionProjectAccountScheduleOverrides.scheduleId, year: investmentProjectionProjectAccountScheduleOverrides.calendarYear, amountMinor: investmentProjectionProjectAccountScheduleOverrides.amountMinor })
    .from(investmentProjectionProjectAccountScheduleOverrides)
    .where(and(eq(investmentProjectionProjectAccountScheduleOverrides.ownerId, ownerId), inArray(investmentProjectionProjectAccountScheduleOverrides.scheduleId, schedules.map((schedule) => schedule.id))))
    .orderBy(asc(investmentProjectionProjectAccountScheduleOverrides.calendarYear), asc(investmentProjectionProjectAccountScheduleOverrides.id));
  const overridesBySchedule = new Map<string, InvestmentProjectionAnnualOverrideInput[]>();
  for (const override of overrides) {
    const list = overridesBySchedule.get(override.scheduleId) ?? [];
    list.push({ id: override.id, year: override.year, amountMinor: override.amountMinor });
    overridesBySchedule.set(override.scheduleId, list);
  }
  const schedulesByProjectAccountId = new Map(schedules.map((schedule) => [schedule.projectAccountId, schedule] as const));
  return new Map(links.flatMap((link) => {
    const schedule = schedulesByProjectAccountId.get(link.id);
    if (!schedule || !isInvestmentProjectionFrequency(schedule.frequency)) return [];
    return [[link.investmentAccountId, {
      id: schedule.id,
      investmentAccountId: link.investmentAccountId,
      displayOrder: link.displayOrder,
      frequency: schedule.frequency,
      baseContributionMinor: schedule.baseContributionMinor,
      annualIncreaseBps: schedule.annualIncreaseBps,
      annualIncreaseMode: investmentProjectionAnnualIncreaseMode(schedule.annualIncreaseMode),
      annualIncreaseMinor: schedule.annualIncreaseMinor ?? 0,
      contributionSource: schedule.contributionSource === "manual" ? "manual" : "cash_flow",
      annualOverrides: overridesBySchedule.get(schedule.id) ?? [],
    }] as const];
  }));
}


async function resolveLegacyProjectionSchedules(
  db: TimelineDatabase,
  ownerId: string,
  accountIds: readonly string[],
  asOfIso: string,
  existing: ReadonlyMap<string, InvestmentProjectionAccountScheduleInput> = new Map(),
): Promise<readonly InvestmentProjectionAccountScheduleInput[]> {
  const context = await loadProjectionRequestContext(db, ownerId, asOfIso);
  const accounts = await listProjectionAccounts(db, ownerId, asOfIso, context, accountIds);
  const accountsById = new Map(accounts.map((account) => [account.id, account] as const));
  return accountIds.map((investmentAccountId, displayOrder) => {
    const saved = existing.get(investmentAccountId);
    if (saved) return { ...saved, investmentAccountId, displayOrder };
    const account = accountsById.get(investmentAccountId);
    const candidate = account?.prefillCandidates.length === 1 ? account.prefillCandidates[0] : undefined;
    return {
      investmentAccountId,
      displayOrder,
      frequency: candidate?.frequency ?? "monthly",
      baseContributionMinor: candidate?.amountMinor ?? 0,
      annualIncreaseBps: 0,
      annualIncreaseMode: "percentage",
      annualIncreaseMinor: 0,
      contributionSource: "cash_flow",
      annualOverrides: [],
    };
  });
}


async function readProjectionProject(
  db: TimelineDatabase,
  ownerId: string,
  projectId: string,
  asOfIso: string,
  context: ProjectionRequestContext,
): Promise<InvestmentProjectionProjectView | null> {
  const [project] = await db.select({
    id: investmentProjectionProjects.id,
    name: investmentProjectionProjects.name,
    notes: investmentProjectionProjects.notes,
    mode: investmentProjectionProjects.mode,
    manualStartingAmountMinor: investmentProjectionProjects.manualStartingAmountMinor,
    horizonYears: investmentProjectionProjects.horizonYears,
    compoundingPeriodsPerYear: investmentProjectionProjects.compoundingPeriodsPerYear,
    createdAt: investmentProjectionProjects.createdAt,
    updatedAt: investmentProjectionProjects.updatedAt,
  }).from(investmentProjectionProjects)
    .where(and(eq(investmentProjectionProjects.ownerId, ownerId), eq(investmentProjectionProjects.id, projectId)))
    .limit(1);
  if (!project) return null;
  const mode: InvestmentProjectionProjectMode = project.mode === "calculator" ? "calculator" : "portfolio";
  const [accountLinks, rateRows, scheduleRows] = await Promise.all([
    db.select({ id: investmentProjectionProjectAccounts.id, investmentAccountId: investmentProjectionProjectAccounts.investmentAccountId, displayOrder: investmentProjectionProjectAccounts.displayOrder })
      .from(investmentProjectionProjectAccounts)
      .where(and(eq(investmentProjectionProjectAccounts.ownerId, ownerId), eq(investmentProjectionProjectAccounts.projectId, projectId)))
      .orderBy(asc(investmentProjectionProjectAccounts.displayOrder), asc(investmentProjectionProjectAccounts.id)),
    db.select({ id: investmentProjectionProjectRates.id, rateBps: investmentProjectionProjectRates.rateBps, displayOrder: investmentProjectionProjectRates.displayOrder })
      .from(investmentProjectionProjectRates)
      .where(and(eq(investmentProjectionProjectRates.ownerId, ownerId), eq(investmentProjectionProjectRates.projectId, projectId)))
      .orderBy(asc(investmentProjectionProjectRates.displayOrder), asc(investmentProjectionProjectRates.id)),
    db.select({ id: investmentProjectionProjectAccountSchedules.id, projectAccountId: investmentProjectionProjectAccountSchedules.projectAccountId, frequency: investmentProjectionProjectAccountSchedules.frequency, baseContributionMinor: investmentProjectionProjectAccountSchedules.baseContributionMinor, annualIncreaseBps: investmentProjectionProjectAccountSchedules.annualIncreaseBps, annualIncreaseMode: investmentProjectionProjectAccountSchedules.annualIncreaseMode, annualIncreaseMinor: investmentProjectionProjectAccountSchedules.annualIncreaseMinor, contributionSource: investmentProjectionProjectAccountSchedules.contributionSource })
      .from(investmentProjectionProjectAccountSchedules)
      .where(and(eq(investmentProjectionProjectAccountSchedules.ownerId, ownerId), eq(investmentProjectionProjectAccountSchedules.projectId, projectId))),
  ]);
  const scheduleIds = scheduleRows.map((schedule) => schedule.id);
  const overrideRows = scheduleIds.length === 0 ? [] : await db.select({ id: investmentProjectionProjectAccountScheduleOverrides.id, scheduleId: investmentProjectionProjectAccountScheduleOverrides.scheduleId, year: investmentProjectionProjectAccountScheduleOverrides.calendarYear, amountMinor: investmentProjectionProjectAccountScheduleOverrides.amountMinor })
    .from(investmentProjectionProjectAccountScheduleOverrides)
    .where(and(eq(investmentProjectionProjectAccountScheduleOverrides.ownerId, ownerId), inArray(investmentProjectionProjectAccountScheduleOverrides.scheduleId, scheduleIds)))
    .orderBy(asc(investmentProjectionProjectAccountScheduleOverrides.calendarYear), asc(investmentProjectionProjectAccountScheduleOverrides.id));
  const overridesBySchedule = new Map<string, InvestmentProjectionAnnualOverrideView[]>();
  for (const override of overrideRows) {
    const list = overridesBySchedule.get(override.scheduleId) ?? [];
    list.push({ id: override.id, year: override.year, amountMinor: override.amountMinor });
    overridesBySchedule.set(override.scheduleId, list);
  }
  const scheduleByProjectAccountId = new Map(scheduleRows.map((schedule) => [schedule.projectAccountId, schedule] as const));
  const selectedAccounts = mode === "portfolio" ? accountLinks : [];
  const accounts = await listProjectionAccounts(db, ownerId, asOfIso, context, selectedAccounts.map((link) => link.investmentAccountId), false, project.horizonYears);
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const warnings: string[] = [];
  if (mode === "calculator" && accountLinks.length > 0) warnings.push("Calculator project contains unexpected account links; they were ignored.");
  const projectAccounts: InvestmentProjectionAccountView[] = selectedAccounts.map((link) => {
    const account = accountsById.get(link.investmentAccountId);
    const storedSchedule = scheduleByProjectAccountId.get(link.id);
    const schedule = storedSchedule && isInvestmentProjectionFrequency(storedSchedule.frequency) ? {
      id: storedSchedule.id,
      investmentAccountId: link.investmentAccountId,
      frequency: storedSchedule.frequency,
      baseContributionMinor: storedSchedule.baseContributionMinor,
      annualIncreaseBps: storedSchedule.annualIncreaseBps,
      annualIncreaseMode: investmentProjectionAnnualIncreaseMode(storedSchedule.annualIncreaseMode),
      annualIncreaseMinor: storedSchedule.annualIncreaseMinor ?? 0,
      contributionSource: storedSchedule.contributionSource === "manual" ? "manual" : "cash_flow",
      annualOverrides: overridesBySchedule.get(storedSchedule.id) ?? [],
    } satisfies InvestmentProjectionScheduleView : null;
    if (!schedule) warnings.push(`${account?.name ?? "Selected account"}: No saved contribution schedule was found; the project uses zero contributions for this account.`);
    if (!account) {
      const warning = "Selected investment account is no longer available.";
      warnings.push(warning);
      return {
        id: link.investmentAccountId,
        projectAccountId: link.id,
        name: "Unavailable account",
        kind: "other",
        currency: "CAD",
        isActive: false,
        linkedAccountId: null,
        cashFlowAccountId: null,
        cashFlowLinkSource: "none",
        latest: null,
        contributionRuleCount: 0,
        prefillCandidates: [],
        cashFlowSources: [],
        cashFlowWarnings: [],
        cashFlowEvents: [],
        cashFlowTransferOutEvents: [],
        displayOrder: link.displayOrder,
        warning,
        schedule,
      };
    }
    const warning = !account.isActive ? "Account is inactive; its latest saved balance is still included." : account.latest ? null : "No saved balance snapshot was found; projection starts this account at $0.00.";
    if (warning) warnings.push(`${account.name}: ${warning}`);
    if (schedule?.contributionSource === "cash_flow") {
      for (const cashFlowWarning of account.cashFlowWarnings) warnings.push(`${account.name}: ${cashFlowWarning}`);
    }
    return { ...account, projectAccountId: link.id, displayOrder: link.displayOrder, warning, schedule };
  });
  const accountSchedules = projectAccounts.flatMap((account) => account.schedule ? [account.schedule] : []);
  const startingBalanceMinor = mode === "calculator"
    ? project.manualStartingAmountMinor ?? 0
    : projectAccounts.reduce((total, account) => total + (account.latest?.balanceMinor ?? 0), 0);
  assertProjectionSafeMinorAmount(startingBalanceMinor, "Starting investment balance");
  const rates = rateRows.map((rate) => ({ id: rate.id, rateBps: rate.rateBps, displayOrder: rate.displayOrder }));
  const baselineYear = Number(asOfIso.slice(0, 4));
  const portfolioAccountInputs = projectAccounts.map(toInvestmentPortfolioAccountInput);
  const preparedContributionEvents = mode === "portfolio"
    ? prepareInvestmentContributionEvents({
      baselineDate: asOfIso,
      years: project.horizonYears,
      accounts: portfolioAccountInputs,
    })
    : undefined;
  const contributionSummaryAccounts = portfolioAccountInputs.flatMap((account, index) => projectAccounts[index]?.schedule
    ? [{ accountId: account.accountId, schedule: account.schedule, contributionEvents: account.contributionEvents }]
    : []);
  const annualContributionSummary: readonly InvestmentProjectionAnnualContributionView[] = mode === "portfolio"
    ? summarizeInvestmentAnnualContributions({
      baselineDate: asOfIso,
      years: project.horizonYears,
      accounts: contributionSummaryAccounts,
    }, preparedContributionEvents)
    : [];
  const scenarios = rates.map((rate) => {
    if (mode === "calculator") {
      const points = projectInvestmentCalculator({ initialValue: money(startingBalanceMinor), annualRateBps: rate.rateBps, years: project.horizonYears, compoundingPeriodsPerYear: project.compoundingPeriodsPerYear });
      return {
        rateBps: rate.rateBps,
        points: points.map((point) => ({ year: point.year, calendarYear: baselineYear + point.year, balanceMinor: point.balance, contributionsMinor: point.contributions, growthMinor: point.growth })),
      };
    }
    const points = projectInvestmentPortfolio({
      baselineDate: asOfIso,
      years: project.horizonYears,
      annualRateBps: rate.rateBps,
      accounts: portfolioAccountInputs,
    }, preparedContributionEvents);
    return {
      rateBps: rate.rateBps,
      points: points.map((point) => ({ year: point.year, calendarYear: baselineYear + point.year, balanceMinor: point.balance, contributionsMinor: point.contributions, growthMinor: point.growth })),
    };
  });
  if (rates.length === 0) warnings.push("No return-rate scenarios have been saved for this project.");
  const defaultScenario = scenarios[0];
  const defaultEndingBalance = defaultScenario?.points.at(-1)?.balanceMinor ?? startingBalanceMinor;
  const uniqueWarnings = [...new Set(warnings)];
  return {
    id: project.id,
    name: project.name,
    notes: project.notes,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    mode,
    manualStartingAmountMinor: mode === "calculator" ? startingBalanceMinor : null,
    horizonYears: project.horizonYears,
    baselineDate: asOfIso,
    accountCount: projectAccounts.length,
    rateBps: rates[0]?.rateBps ?? 0,
    startingBalanceMinor,
    endingBalanceMinor: defaultEndingBalance,
    warningCount: uniqueWarnings.length,
    compoundingPeriodsPerYear: project.compoundingPeriodsPerYear,
    accounts: projectAccounts,
    accountSchedules,
    rates,
    annualContributionSummary,
    scenarios,
    warnings: uniqueWarnings,
  };
}


export function createInvestmentProjectionRepository(db: Database) {
  async function listProjects(ownerId: string, asOfIso = toTorontoDateIso(), context?: ProjectionRequestContext): Promise<readonly InvestmentProjectionProjectView[]> {
    const resolvedContext = context ?? await loadProjectionRequestContext(db, ownerId, asOfIso);
    const rows = await db.select({ id: investmentProjectionProjects.id })
      .from(investmentProjectionProjects)
      .where(eq(investmentProjectionProjects.ownerId, ownerId))
      .orderBy(asc(investmentProjectionProjects.name), asc(investmentProjectionProjects.id));
    const projects = await Promise.all(rows.map((row) => readProjectionProject(db, ownerId, row.id, asOfIso, resolvedContext)));
    return projects.filter((project): project is InvestmentProjectionProjectView => project !== null);
  }

  async function assertSelectedAccounts(database: TimelineDatabase, ownerId: string, accountIds: readonly string[]): Promise<void> {
    if (accountIds.length === 0) throw new Error("Choose at least one investment account.");
    const rows = await database.select({ id: investmentAccounts.id })
      .from(investmentAccounts)
      .where(and(eq(investmentAccounts.ownerId, ownerId), inArray(investmentAccounts.id, accountIds)));
    if (rows.length !== accountIds.length) throw new Error("One or more selected investment accounts were not found.");
  }

  async function saveChildren(tx: TransactionDatabase, ownerId: string, projectId: string, input: NormalizedInvestmentProjectionInput): Promise<void> {
    if (input.mode === "portfolio") {
      const links = await tx.insert(investmentProjectionProjectAccounts).values(input.accountSchedules.map((schedule) => ({ ownerId, projectId, investmentAccountId: schedule.investmentAccountId, displayOrder: schedule.displayOrder }))).returning({ id: investmentProjectionProjectAccounts.id, investmentAccountId: investmentProjectionProjectAccounts.investmentAccountId });
      for (const link of links) {
        const schedule = input.accountSchedules.find((candidate) => candidate.investmentAccountId === link.investmentAccountId);
        if (!schedule) throw new Error("Investment projection schedule could not be matched to its account.");
        const [savedSchedule] = await tx.insert(investmentProjectionProjectAccountSchedules).values({ ownerId, projectId, projectAccountId: link.id, frequency: schedule.frequency, baseContributionMinor: schedule.baseContributionMinor, annualIncreaseBps: schedule.annualIncreaseBps, annualIncreaseMode: schedule.annualIncreaseMode ?? "percentage", annualIncreaseMinor: schedule.annualIncreaseMinor ?? 0, contributionSource: schedule.contributionSource ?? "cash_flow" }).returning({ id: investmentProjectionProjectAccountSchedules.id });
        if (!savedSchedule) throw new Error("Investment projection schedule could not be created.");
        if (schedule.annualOverrides.length > 0) {
          await tx.insert(investmentProjectionProjectAccountScheduleOverrides).values(schedule.annualOverrides.map((override) => ({ ownerId, scheduleId: savedSchedule.id, calendarYear: override.year, amountMinor: override.amountMinor })));
        }
      }
    }
    if (input.ratesBps.length > 0) {
      await tx.insert(investmentProjectionProjectRates).values(input.ratesBps.map((rateBps, displayOrder) => ({ ownerId, projectId, rateBps, displayOrder })));
    }
  }

  async function normalizedForPersistence(
    rawInput: InvestmentProjectionProjectInput,
    ownerId: string,
    asOfIso: string,
    existingProjectId?: string,
  ): Promise<NormalizedInvestmentProjectionInput> {
    const normalized = normalizeInvestmentProjectionInput(rawInput);
    if (!normalized.legacy) return normalized;
    const legacyAccountIds = "investmentAccountIds" in rawInput ? [...new Set(rawInput.investmentAccountIds)] : [];
    const existing = existingProjectId ? await loadPersistedProjectionSchedules(db, ownerId, existingProjectId) : new Map();
    const accountSchedules = await resolveLegacyProjectionSchedules(db, ownerId, legacyAccountIds, asOfIso, existing);
    return { ...normalized, mode: "portfolio", accountSchedules: accountSchedules.map((schedule, displayOrder) => normalizeProjectionSchedule(schedule, displayOrder)) };
  }

  return {
    async getPageData(ownerId: string, asOfIso = toTorontoDateIso()): Promise<InvestmentProjectionPageData> {
      const context = await loadProjectionRequestContext(db, ownerId, asOfIso);
      const [availableAccounts, projects] = await Promise.all([
        listProjectionAccounts(db, ownerId, asOfIso, context, undefined, true),
        listProjects(ownerId, asOfIso, context),
      ]);
      return { asOf: asOfIso, availableAccounts, cashFlowAccounts: context.cashFlowAccounts, projects };
    },
    async getPortfolioSchedulePrefill(ownerId: string, accountIds: readonly string[], asOfIso = toTorontoDateIso()): Promise<readonly InvestmentProjectionSchedulePrefillView[]> {
      const uniqueIds = [...new Set(accountIds)];
      await assertSelectedAccounts(db, ownerId, uniqueIds);
      const context = await loadProjectionRequestContext(db, ownerId, asOfIso);
      const accounts = await listProjectionAccounts(db, ownerId, asOfIso, context, uniqueIds, true);
      const accountsById = new Map(accounts.map((account) => [account.id, account] as const));
      return uniqueIds.map((investmentAccountId, displayOrder) => {
        const account = accountsById.get(investmentAccountId);
        const candidate = account?.prefillCandidates.length === 1 ? account.prefillCandidates[0] : undefined;
        return {
          investmentAccountId,
          displayOrder,
          candidates: account?.prefillCandidates ?? [],
          suggested: candidate ? { investmentAccountId, displayOrder, frequency: candidate.frequency, baseContributionMinor: candidate.amountMinor, annualIncreaseBps: 0, annualIncreaseMode: "percentage" as const, annualIncreaseMinor: 0, contributionSource: "cash_flow" as const, annualOverrides: [] } : null,
        };
      });
    },
    async prefillPortfolioSchedules(ownerId: string, accountIds: readonly string[], asOfIso = toTorontoDateIso()): Promise<readonly InvestmentProjectionSchedulePrefillView[]> {
      return this.getPortfolioSchedulePrefill(ownerId, accountIds, asOfIso);
    },
    async getProject(ownerId: string, projectId: string, asOfIso = toTorontoDateIso()): Promise<InvestmentProjectionProjectView | null> {
      const context = await loadProjectionRequestContext(db, ownerId, asOfIso);
      return readProjectionProject(db, ownerId, projectId, asOfIso, context);
    },
    async setInvestmentCashFlowAccountLink(ownerId: string, investmentAccountId: string, cashFlowAccountId: string | null): Promise<void> {
      const [investmentAccount] = await db.select({ id: investmentAccounts.id })
        .from(investmentAccounts)
        .where(and(eq(investmentAccounts.ownerId, ownerId), eq(investmentAccounts.id, investmentAccountId)))
        .limit(1);
      if (!investmentAccount) throw new Error("Investment account not found.");

      if (cashFlowAccountId !== null) {
        const [cashFlowAccount] = await db.select({ id: accounts.id })
          .from(accounts)
          .where(and(eq(accounts.ownerId, ownerId), eq(accounts.id, cashFlowAccountId), eq(accounts.isActive, true)))
          .limit(1);
        if (!cashFlowAccount) throw new Error("Cash Flow account not found.");
      }

      await db.transaction(async (tx) => {
        const [updated] = await tx.update(investmentAccounts)
          .set({ accountId: cashFlowAccountId, updatedAt: new Date() })
          .where(and(eq(investmentAccounts.ownerId, ownerId), eq(investmentAccounts.id, investmentAccountId)))
          .returning({ id: investmentAccounts.id });
        if (!updated) throw new Error("Investment account not found.");
        await tx.insert(auditEvents).values({
          ownerId,
          actorUserId: ownerId,
          action: "updated",
          entityType: "investment_account",
          entityId: investmentAccountId,
          metadata: {
            operation: "investment_cash_flow_account_link",
            cashFlowAccountId,
          },
        });
      });
    },
    listProjects,
    async createProject(ownerId: string, rawInput: InvestmentProjectionProjectInput): Promise<string> {
      const input = await normalizedForPersistence(rawInput, ownerId, toTorontoDateIso());
      if (input.mode === "portfolio") await assertSelectedAccounts(db, ownerId, input.accountSchedules.map((schedule) => schedule.investmentAccountId));
      return db.transaction(async (tx) => {
        const [project] = await tx.insert(investmentProjectionProjects).values({ ownerId, name: input.name, notes: input.notes, mode: input.mode, manualStartingAmountMinor: input.manualStartingAmountMinor, horizonYears: input.horizonYears, compoundingPeriodsPerYear: 12 }).returning({ id: investmentProjectionProjects.id });
        if (!project) throw new Error("Investment projection project could not be created.");
        await saveChildren(tx, ownerId, project.id, input);
        await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "created", entityType: "investment_projection_project", entityId: project.id, metadata: { operation: "investment_projection_project_create", mode: input.mode, accountCount: input.accountSchedules.length, rateCount: input.ratesBps.length } });
        return project.id;
      });
    },
    async updateProject(ownerId: string, projectId: string, rawInput: InvestmentProjectionProjectInput): Promise<void> {
      const [existing] = await db.select({ id: investmentProjectionProjects.id }).from(investmentProjectionProjects)
        .where(and(eq(investmentProjectionProjects.ownerId, ownerId), eq(investmentProjectionProjects.id, projectId))).limit(1);
      if (!existing) throw new Error("Investment projection project not found.");
      const input = await normalizedForPersistence(rawInput, ownerId, toTorontoDateIso(), projectId);
      if (input.mode === "portfolio") await assertSelectedAccounts(db, ownerId, input.accountSchedules.map((schedule) => schedule.investmentAccountId));
      await db.transaction(async (tx) => {
        const [project] = await tx.update(investmentProjectionProjects)
          .set({ name: input.name, notes: input.notes, mode: input.mode, manualStartingAmountMinor: input.manualStartingAmountMinor, horizonYears: input.horizonYears, updatedAt: new Date() })
          .where(and(eq(investmentProjectionProjects.ownerId, ownerId), eq(investmentProjectionProjects.id, projectId)))
          .returning({ id: investmentProjectionProjects.id });
        if (!project) throw new Error("Investment projection project not found.");
        await tx.delete(investmentProjectionProjectAccounts).where(and(eq(investmentProjectionProjectAccounts.ownerId, ownerId), eq(investmentProjectionProjectAccounts.projectId, projectId)));
        await tx.delete(investmentProjectionProjectRates).where(and(eq(investmentProjectionProjectRates.ownerId, ownerId), eq(investmentProjectionProjectRates.projectId, projectId)));
        await saveChildren(tx, ownerId, projectId, input);
        await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "updated", entityType: "investment_projection_project", entityId: projectId, metadata: { operation: "investment_projection_project_update", mode: input.mode, accountCount: input.accountSchedules.length, rateCount: input.ratesBps.length } });
      });
    },
    async deleteProject(ownerId: string, projectId: string): Promise<void> {
      await db.transaction(async (tx) => {
        const [deleted] = await tx.delete(investmentProjectionProjects)
          .where(and(eq(investmentProjectionProjects.ownerId, ownerId), eq(investmentProjectionProjects.id, projectId)))
          .returning({ id: investmentProjectionProjects.id });
        if (!deleted) throw new Error("Investment projection project not found.");
        await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "deleted", entityType: "investment_projection_project", entityId: projectId, metadata: { operation: "investment_projection_project_delete" } });
      });
    },
  };
}
