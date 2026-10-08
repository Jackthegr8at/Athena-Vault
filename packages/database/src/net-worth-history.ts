import { asc, eq } from "drizzle-orm";
import {
  aggregateNetWorthHistoryAccountValues,
  addNetWorthHistoryMonths,
  buildNetWorthHistoryModel,
  NET_WORTH_HISTORY_DEFAULT_PROJECTED_MONTHS,
  NET_WORTH_HISTORY_DEFAULT_RANGE,
  NET_WORTH_HISTORY_RANGES,
  isValidNetWorthHistoryIsoDate,
  type NetWorthHistoryAccountValue,
  type NetWorthHistoryComponentValue,
  type NetWorthHistoryModel,
  type NetWorthHistoryPhase,
  type NetWorthHistoryRange,
} from "@athena/finance-engine";
import type { Database } from "./client";
import {
  addIsoDays,
  calculateProjectedTimeline,
  type ContributionExceptionSchedule,
  type ContributionPeriod,
  type ContributionRuleSchedule,
} from "./account-contributions";
import {
  toTorontoDateIso,
  type SnapshotStatus,
} from "./account-timeline";
import { cashFlowPeriods } from "./drizzle-schema";
import { buildHomeTimeline, createHomeRepository, type HomeTimelineRow, type HomeView } from "./home";
import { createAccountTimelineRepository, type AccountTimelineAccountView } from "./repositories/account-timeline";

export interface NetWorthHistoryPreloadedPeriod {
  readonly id: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly payDate: string;
}

export interface NetWorthHistoryPreloadedInputs {
  /** Already-loaded home view; when supplied, getHistory does not re-run getHome. */
  readonly home?: HomeView | null | Promise<HomeView | null>;
  /** Already-loaded cash_flow_periods rows (any order); when supplied, getHistory does not re-query them. */
  readonly periods?: readonly NetWorthHistoryPreloadedPeriod[] | Promise<readonly NetWorthHistoryPreloadedPeriod[]>;
}

export interface NetWorthHistoryRepositoryOptions {
  /** Toronto calendar date used as the actual/projected boundary. */
  readonly evaluationDate?: string;
  /** Number of calendar months to project when projectedThrough is omitted. */
  readonly projectedMonths?: number;
  /** Explicit Toronto calendar date through which to project. */
  readonly projectedThrough?: string;
  /** Range applied after the combined timeline has been normalized. */
  readonly selectedRange?: NetWorthHistoryRange;
  /** Owner-scoped inputs already loaded by the caller, used to avoid duplicate reads. */
  readonly preloaded?: NetWorthHistoryPreloadedInputs;
}

export interface NetWorthHistoryRepository {
  getHistory(ownerId: string, options?: NetWorthHistoryRepositoryOptions): Promise<NetWorthHistoryModel>;
}

interface ReadProjectionSnapshot {
  readonly asOf: string;
  readonly balanceMinor: number;
  readonly status: SnapshotStatus;
  readonly isGenerated: boolean;
}

interface StoredProjectionPeriod extends ContributionPeriod {
  readonly asOf: string;
}

const MAX_FORECAST_MONTHS = 120;

function assertSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer.`);
  return value;
}

function assertValidIsoDate(value: string, label: string): void {
  if (!isValidNetWorthHistoryIsoDate(value)) throw new RangeError(`${label} must be a valid ISO date.`);
}

function daysBetweenIso(start: string, end: string): number {
  const startTime = Date.parse(`${start}T00:00:00.000Z`);
  const endTime = Date.parse(`${end}T00:00:00.000Z`);
  const days = Math.round((endTime - startTime) / 86_400_000);
  if (!Number.isSafeInteger(days)) throw new RangeError("ISO date distance is outside the safe integer range.");
  return days;
}

function forecastThroughFor(
  evaluationDate: string,
  options: NetWorthHistoryRepositoryOptions,
): string {
  if (options.projectedThrough !== undefined) {
    assertValidIsoDate(options.projectedThrough, "Projected-through date");
    if (options.projectedThrough < evaluationDate) throw new RangeError("Projected-through date must be on or after the evaluation date.");
    return options.projectedThrough;
  }
  const projectedMonths = options.projectedMonths ?? NET_WORTH_HISTORY_DEFAULT_PROJECTED_MONTHS;
  if (!Number.isSafeInteger(projectedMonths) || projectedMonths < 0 || projectedMonths > MAX_FORECAST_MONTHS) throw new RangeError(`Projected months must be an integer from 0 to ${MAX_FORECAST_MONTHS}.`);
  return addNetWorthHistoryMonths(evaluationDate, projectedMonths);
}

interface SnapshotCursor {
  index: number;
  latest: ReadProjectionSnapshot | null;
}

function latestSnapshotAtOrBefore(
  snapshots: readonly ReadProjectionSnapshot[],
  asOf: string,
  cursor: SnapshotCursor,
): ReadProjectionSnapshot | null {
  while (cursor.index < snapshots.length && snapshots[cursor.index]!.asOf <= asOf) {
    cursor.latest = snapshots[cursor.index]!;
    cursor.index += 1;
  }
  return cursor.latest;
}

function maxIso(left: string, right: string): string {
  return left >= right ? left : right;
}

function minIso(left: string, right: string): string {
  return left <= right ? left : right;
}

function projectionPeriodsThrough(
  storedPeriods: readonly StoredProjectionPeriod[],
  evaluationDate: string,
  forecastThrough: string,
): readonly StoredProjectionPeriod[] {
  const existing = storedPeriods
    .filter((period) => period.asOf <= forecastThrough && period.startsOn <= forecastThrough)
    .sort((left, right) => left.asOf.localeCompare(right.asOf));
  const result: StoredProjectionPeriod[] = existing.map((period) => ({
    ...period,
    endsOn: minIso(period.endsOn, forecastThrough),
  }));
  if (evaluationDate >= forecastThrough) return result;

  if (result.length === 0) {
    let startsOn = addIsoDays(evaluationDate, 1);
    while (startsOn <= forecastThrough) {
      const endsOn = minIso(addIsoDays(startsOn, 13), forecastThrough);
      result.push({ startsOn, endsOn, asOf: endsOn });
      startsOn = addIsoDays(endsOn, 1);
    }
    return result;
  }

  let last = result[result.length - 1]!;
  const cadenceFromPrevious = result.length > 1
    ? daysBetweenIso(result[result.length - 2]!.asOf, last.asOf)
    : daysBetweenIso(last.startsOn, last.endsOn) + 1;
  const cadenceDays = cadenceFromPrevious > 0 && cadenceFromPrevious <= 62 ? cadenceFromPrevious : 14;
  const periodLength = Math.max(1, daysBetweenIso(last.startsOn, last.endsOn) + 1);
  let startsOn = maxIso(addIsoDays(last.endsOn, 1), addIsoDays(evaluationDate, 1));
  while (startsOn <= forecastThrough) {
    const endsOn = minIso(addIsoDays(startsOn, periodLength - 1), forecastThrough);
    const nextAsOf = minIso(addIsoDays(last.asOf, cadenceDays), forecastThrough);
    const asOf = nextAsOf >= startsOn && nextAsOf <= endsOn ? nextAsOf : endsOn;
    const next: StoredProjectionPeriod = { startsOn, endsOn, asOf };
    result.push(next);
    last = next;
    startsOn = addIsoDays(endsOn, 1);
  }
  return result;
}

function toProjectionRules(account: AccountTimelineAccountView): {
  readonly rules: readonly ContributionRuleSchedule[];
  readonly exceptions: readonly ContributionExceptionSchedule[];
} {
  const rules = account.contributionRules.map<ContributionRuleSchedule>((rule) => ({
    id: rule.id,
    amountMinor: assertSafeInteger(rule.amountMinor, "Contribution amount"),
    frequency: rule.frequency,
    startsOn: rule.startsOn,
    endsOn: rule.endsOn,
    isEnabled: rule.isEnabled,
  }));
  const exceptions = account.contributionRules.flatMap<ContributionExceptionSchedule>((rule) => rule.exceptions.map((exception) => ({
    ruleId: rule.id,
    occurrenceOn: exception.occurrenceOn,
    kind: exception.kind,
    amountMinor: exception.amountMinor,
  })));
  return { rules, exceptions };
}

function projectAccountReadModel(
  account: AccountTimelineAccountView,
  storedPeriods: readonly StoredProjectionPeriod[],
  evaluationDate: string,
  forecastThrough: string,
): readonly ReadProjectionSnapshot[] {
  const snapshots = account.snapshots
    .filter((snapshot) => snapshot.asOf <= forecastThrough)
    .sort((left, right) => left.asOf.localeCompare(right.asOf) || left.id.localeCompare(right.id))
    .map<ReadProjectionSnapshot>((snapshot) => ({
      asOf: snapshot.asOf,
      balanceMinor: assertSafeInteger(snapshot.balanceMinor, "Account balance"),
      status: snapshot.status,
      isGenerated: snapshot.isGenerated,
    }));
  const periods = projectionPeriodsThrough(storedPeriods, evaluationDate, forecastThrough);
  if (periods.length === 0 && snapshots.length === 0) return [];
  const { rules, exceptions } = toProjectionRules(account);
  const generatedOverrides = new Map(
    snapshots
      .filter((snapshot) => snapshot.status === "planned" && snapshot.isGenerated)
      .map((snapshot) => [snapshot.asOf, snapshot.balanceMinor] as const),
  );
  const calculated = calculateProjectedTimeline(
    periods,
    snapshots.map((snapshot, index) => ({ ...snapshot, id: `${account.id}:${snapshot.asOf}:${index}` })),
    rules,
    exceptions,
    {
      fromDate: addIsoDays(evaluationDate, 1),
      futureAfter: evaluationDate,
      endingBalanceOverridesByAsOf: generatedOverrides,
    },
  );
  return calculated
    .filter((snapshot) => snapshot.asOf <= forecastThrough)
    .map<ReadProjectionSnapshot>((snapshot) => ({
      asOf: snapshot.asOf,
      balanceMinor: assertSafeInteger(snapshot.balanceMinor, "Projected account balance"),
      status: snapshot.status,
      isGenerated: snapshot.isGenerated,
    }));
}

function homePhase(row: HomeTimelineRow, asOf: string, evaluationDate: string): NetWorthHistoryPhase {
  return asOf > evaluationDate || row.mortgageStatus === "projected" || row.mortgageStatus === "estimated"
    ? "projected"
    : "actual";
}

function assertCad(value: "CAD" | "USD" | "EUR", label: string): void {
  if (value !== "CAD") throw new Error(`${label} must use CAD for net-worth history.`);
}

function homeTimelineFor(home: HomeView | null, forecastThrough: string): readonly HomeTimelineRow[] {
  if (!home) return [];
  assertCad(home.currency, "Home currency");
  const timeline = home.timelineThrough !== undefined && home.timelineThrough >= forecastThrough
    ? home.timeline
    : buildHomeTimeline({
      home: { id: home.id, name: home.name, currency: home.currency },
      values: home.values,
      terms: home.mortgageTerms,
      anchors: home.mortgageAnchors,
      todayIso: forecastThrough,
    });
  return timeline.filter((row) => row.asOf <= forecastThrough);
}

interface NetWorthHistoryInputs {
  readonly accountValues: readonly NetWorthHistoryAccountValue[];
  readonly homeEquity: readonly NetWorthHistoryComponentValue[];
}

function buildTimelineInputs(
  accounts: readonly AccountTimelineAccountView[],
  snapshotsByAccount: ReadonlyMap<string, readonly ReadProjectionSnapshot[]>,
  homeRows: readonly HomeTimelineRow[],
  evaluationDate: string,
  forecastThrough: string,
): NetWorthHistoryInputs {
  const dates = new Set<string>([evaluationDate, forecastThrough]);
  for (const snapshots of snapshotsByAccount.values()) for (const snapshot of snapshots) dates.add(snapshot.asOf);
  for (const row of homeRows) dates.add(row.asOf);

  const accountValues: NetWorthHistoryAccountValue[] = [];
  const hasAnyAccountSnapshot = [...snapshotsByAccount.values()].some((snapshots) => snapshots.length > 0);
  if (hasAnyAccountSnapshot) {
    const timelineDates = [...dates].filter((date) => date <= forecastThrough).sort();
    const cursors = new Map<string, SnapshotCursor>(
      accounts.map((account) => [account.id, { index: 0, latest: null }]),
    );
    for (const asOf of timelineDates) {
      for (const account of accounts) {
        const snapshots = snapshotsByAccount.get(account.id) ?? [];
        const cursor = cursors.get(account.id)!;
        const snapshot = latestSnapshotAtOrBefore(snapshots, asOf, cursor);
        accountValues.push({
          asOf,
          phase: asOf > evaluationDate || snapshot?.status === "planned" || snapshot?.isGenerated ? "projected" : "actual",
          kind: account.kind,
          balanceMinor: snapshot?.balanceMinor ?? null,
          isActive: account.isActive,
        });
      }
    }
  }

  const homeEquity = homeRows.map<NetWorthHistoryComponentValue>((row) => ({
    asOf: row.asOf,
    phase: homePhase(row, row.asOf, evaluationDate),
    valueMinor: row.equityMinor,
  }));
  return { accountValues, homeEquity };
}

function buildModel(
  inputs: NetWorthHistoryInputs,
  evaluationDate: string,
  forecastThrough: string,
  selectedRange: NetWorthHistoryRange,
): NetWorthHistoryModel {
  const accountSeries = aggregateNetWorthHistoryAccountValues(inputs.accountValues);
  const projectedThrough = inputs.accountValues.some((value) => value.asOf > evaluationDate)
    || inputs.homeEquity.some((value) => value.asOf > evaluationDate)
    ? forecastThrough
    : null;
  return buildNetWorthHistoryModel({
    evaluationDate,
    projectedThrough,
    selectedRange,
    currency: "CAD",
    investments: accountSeries.investments,
    cashOther: accountSeries.cashOther,
    liabilities: accountSeries.liabilities,
    homeEquity: inputs.homeEquity,
  });
}

export function createNetWorthHistoryRepository(db: Database): NetWorthHistoryRepository {
  const accountTimeline = createAccountTimelineRepository(db);
  const homeRepository = createHomeRepository(db);

  async function getHistory(ownerId: string, options: NetWorthHistoryRepositoryOptions = {}): Promise<NetWorthHistoryModel> {
    if (!ownerId.trim()) throw new RangeError("Owner ID is required.");
    const evaluationDate = options.evaluationDate ?? toTorontoDateIso();
    assertValidIsoDate(evaluationDate, "Evaluation date");
    const forecastThrough = forecastThroughFor(evaluationDate, options);
    const selectedRange = options.selectedRange ?? NET_WORTH_HISTORY_DEFAULT_RANGE;
    if (!(NET_WORTH_HISTORY_RANGES as readonly string[]).includes(selectedRange)) throw new RangeError("Net-worth history range is invalid.");

    const [timeline, home, periodRows] = await Promise.all([
      accountTimeline.getTimeline(ownerId, { cashFlowPeriods: options.preloaded?.periods }),
      options.preloaded?.home !== undefined ? options.preloaded.home : homeRepository.getHome(ownerId),
      options.preloaded?.periods !== undefined
        ? Promise.resolve(options.preloaded.periods).then((rows) => [...rows]
          .sort((left, right) => left.payDate.localeCompare(right.payDate) || left.id.localeCompare(right.id))
          .map((row) => ({ startsOn: row.startsOn, endsOn: row.endsOn, asOf: row.payDate })))
        : db.select({ startsOn: cashFlowPeriods.startsOn, endsOn: cashFlowPeriods.endsOn, asOf: cashFlowPeriods.payDate })
          .from(cashFlowPeriods)
          .where(eq(cashFlowPeriods.ownerId, ownerId))
          .orderBy(asc(cashFlowPeriods.payDate), asc(cashFlowPeriods.id)),
    ]);

    for (const account of timeline.accounts) {
      assertCad(account.currency, "Account currency");
      for (const snapshot of account.snapshots) assertCad(snapshot.currency, "Account snapshot currency");
    }
    const storedPeriods: readonly StoredProjectionPeriod[] = periodRows.map((period) => ({
      startsOn: period.startsOn,
      endsOn: period.endsOn,
      asOf: period.asOf,
    }));
    const snapshotsByAccount = new Map<string, readonly ReadProjectionSnapshot[]>(timeline.accounts.map((account) => [
      account.id,
      projectAccountReadModel(account, storedPeriods, evaluationDate, forecastThrough),
    ]));
    const homeRows = homeTimelineFor(home, forecastThrough);
    const inputs = buildTimelineInputs(timeline.accounts, snapshotsByAccount, homeRows, evaluationDate, forecastThrough);
    return buildModel(inputs, evaluationDate, forecastThrough, selectedRange);
  }

  return { getHistory };
}
