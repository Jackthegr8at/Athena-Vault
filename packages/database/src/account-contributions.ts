export const contributionFrequencies = ["weekly", "biweekly", "monthly", "annual"] as const;

export type ContributionFrequency = (typeof contributionFrequencies)[number];
export type ContributionExceptionKind = "skip" | "override";
export type ProjectionSnapshotStatus = "actual" | "planned";

export interface ContributionRuleSchedule {
  readonly id: string;
  readonly amountMinor: number;
  readonly frequency: ContributionFrequency;
  readonly startsOn: string;
  readonly endsOn: string | null;
  readonly isEnabled: boolean;
}

export interface ContributionExceptionSchedule {
  readonly ruleId: string;
  readonly occurrenceOn: string;
  readonly kind: ContributionExceptionKind;
  readonly amountMinor: number | null;
}

export interface ContributionPeriod {
  readonly startsOn: string;
  readonly endsOn: string;
  readonly asOf?: string;
}

export interface ProjectionSnapshot {
  readonly id: string;
  readonly asOf: string;
  readonly balanceMinor: number;
  readonly status: ProjectionSnapshotStatus;
  readonly isGenerated: boolean;
}

export interface ProjectionTimelineSnapshot extends Omit<ProjectionSnapshot, "id"> {
  readonly id: string | null;
}

export interface ProjectionBalanceAdjustment {
  readonly occurredOn: string;
  readonly amountMinor: number;
}

export interface ProjectionCalculationOptions {
  /** Recalculate generated Projected cells on or after this date. */
  readonly fromDate?: string | null;
  /** When provided, cells on or before this date stay protected as historical. */
  readonly futureAfter?: string | null;
  /** Account-specific cash movements, such as transfers, applied to generated periods. */
  readonly balanceAdjustments?: readonly ProjectionBalanceAdjustment[];
  /**
   * Absolute ending balances by payday (`asOf`) from Cash Flow projection.
   * When present for a recalculable planned cell, replaces contribution/adjustment chaining.
   * Actual and manual planned anchors are never overridden.
   */
  readonly endingBalanceOverridesByAsOf?: ReadonlyMap<string, number>;
}

const millisecondsPerDay = 86_400_000;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(value: string): Date {
  if (!isoDatePattern.test(value)) throw new RangeError("Date must be a valid ISO date.");
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || toIsoDate(date) !== value) throw new RangeError("Date must be a valid ISO date.");
  return date;
}

function toIsoDate(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

function daysBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / millisecondsPerDay);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function monthlyOccurrence(anchor: Date, monthOffset: number): string {
  const monthNumber = anchor.getUTCFullYear() * 12 + anchor.getUTCMonth() + monthOffset;
  const year = Math.floor(monthNumber / 12);
  const monthIndex = monthNumber - year * 12;
  const day = Math.min(anchor.getUTCDate(), daysInMonth(year, monthIndex));
  return toIsoDate(new Date(Date.UTC(year, monthIndex, day)));
}

function annualOccurrence(anchor: Date, yearOffset: number): string {
  const year = anchor.getUTCFullYear() + yearOffset;
  const day = Math.min(anchor.getUTCDate(), daysInMonth(year, anchor.getUTCMonth()));
  return toIsoDate(new Date(Date.UTC(year, anchor.getUTCMonth(), day)));
}

function maxIso(left: string, right: string): string {
  return left >= right ? left : right;
}

function minIso(left: string, right: string): string {
  return left <= right ? left : right;
}

function recurrenceEnd(rule: ContributionRuleSchedule, requestedEnd: string): string {
  return rule.endsOn ? minIso(rule.endsOn, requestedEnd) : requestedEnd;
}

function recurrenceStart(rule: ContributionRuleSchedule, requestedStart: string): string {
  return maxIso(rule.startsOn, requestedStart);
}

export function isIsoDate(value: string): boolean {
  try {
    parseIsoDate(value);
    return true;
  } catch {
    return false;
  }
}

export function addIsoDays(value: string, days: number): string {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

export function occurrencesBetween(
  rule: ContributionRuleSchedule,
  requestedStart: string,
  requestedEnd: string,
): readonly string[] {
  const start = recurrenceStart(rule, requestedStart);
  const end = recurrenceEnd(rule, requestedEnd);
  parseIsoDate(start);
  parseIsoDate(end);
  if (!rule.isEnabled || start > end) return [];

  const anchor = parseIsoDate(rule.startsOn);
  const firstDate = parseIsoDate(start);
  const result: string[] = [];

  if (rule.frequency === "weekly" || rule.frequency === "biweekly") {
    const interval = rule.frequency === "weekly" ? 7 : 14;
    const offsetDays = Math.max(0, Math.ceil(daysBetween(anchor, firstDate) / interval));
    for (let offset = offsetDays; ; offset += 1) {
      const occurrence = addIsoDays(rule.startsOn, offset * interval);
      if (occurrence > end) break;
      if (occurrence >= start) result.push(occurrence);
    }
    return result;
  }

  if (rule.frequency === "monthly") {
    let offset = Math.max(0, (firstDate.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + firstDate.getUTCMonth() - anchor.getUTCMonth() - 1);
    for (; ; offset += 1) {
      const occurrence = monthlyOccurrence(anchor, offset);
      if (occurrence > end) break;
      if (occurrence >= start) result.push(occurrence);
    }
    return result;
  }

  let offset = Math.max(0, firstDate.getUTCFullYear() - anchor.getUTCFullYear() - 1);
  for (; ; offset += 1) {
    const occurrence = annualOccurrence(anchor, offset);
    if (occurrence > end) break;
    if (occurrence >= start) result.push(occurrence);
  }
  return result;
}

export function nextContributionOccurrence(
  rule: ContributionRuleSchedule,
  fromDate: string,
  exceptions: readonly ContributionExceptionSchedule[] = [],
): string | null {
  const lastDate = rule.endsOn ?? "2200-12-31";
  for (const occurrence of occurrencesBetween(rule, fromDate, lastDate)) {
    const exception = exceptions.find((candidate) => candidate.ruleId === rule.id && candidate.occurrenceOn === occurrence);
    if (exception?.kind === "skip") continue;
    return occurrence;
  }
  return null;
}

export function contributionForPeriod(
  period: ContributionPeriod,
  rules: readonly ContributionRuleSchedule[],
  exceptions: readonly ContributionExceptionSchedule[] = [],
): number {
  let total = 0;
  for (const rule of rules) {
    if (!rule.isEnabled) continue;
    for (const occurrenceOn of occurrencesBetween(rule, period.startsOn, period.endsOn)) {
      const exception = exceptions.find((candidate) => candidate.ruleId === rule.id && candidate.occurrenceOn === occurrenceOn);
      if (exception?.kind === "skip") continue;
      total += exception?.kind === "override" ? (exception.amountMinor ?? 0) : rule.amountMinor;
    }
  }
  if (!Number.isSafeInteger(total)) throw new RangeError("Projected contribution total is too large.");
  return total;
}

function shouldRecalculate(snapshot: ProjectionSnapshot, options: ProjectionCalculationOptions): boolean {
  if (snapshot.status !== "planned" || !snapshot.isGenerated || options.fromDate === null || options.fromDate === undefined) return false;
  if (snapshot.asOf < options.fromDate) return false;
  return options.futureAfter === null || options.futureAfter === undefined || snapshot.asOf > options.futureAfter;
}

export function calculateProjectedBalances(
  periods: readonly ContributionPeriod[],
  snapshots: readonly ProjectionSnapshot[],
  rules: readonly ContributionRuleSchedule[],
  exceptions: readonly ContributionExceptionSchedule[] = [],
  options: ProjectionCalculationOptions = {},
): readonly ProjectionSnapshot[] {
  const sorted = [...snapshots].sort((left, right) => left.asOf.localeCompare(right.asOf) || left.id.localeCompare(right.id));
  let previousFinal: number | null = null;
  return sorted.map((snapshot) => {
    if (!shouldRecalculate(snapshot, options) || previousFinal === null) {
      previousFinal = snapshot.balanceMinor;
      return snapshot;
    }
    const period = periods.find((candidate) => candidate.asOf === snapshot.asOf)
      ?? periods.find((candidate) => candidate.startsOn <= snapshot.asOf && candidate.endsOn >= snapshot.asOf);
    const contribution = period ? contributionForPeriod(period, rules, exceptions) : 0;
    const adjustment = adjustmentForPeriod(period, options);
    const balanceMinor = previousFinal + contribution + adjustment;
    if (!Number.isSafeInteger(balanceMinor)) throw new RangeError("Projected balance is too large.");
    previousFinal = balanceMinor;
    return { ...snapshot, balanceMinor, isGenerated: true };
  });
}

function periodAsOf(period: ContributionPeriod): string {
  return period.asOf ?? period.endsOn;
}

function shouldCreateProjection(asOf: string, options: ProjectionCalculationOptions): boolean {
  if (options.fromDate === null || options.fromDate === undefined || asOf < options.fromDate) return false;
  return options.futureAfter === null || options.futureAfter === undefined || asOf > options.futureAfter;
}

function periodForDate(periods: readonly ContributionPeriod[], asOf: string): ContributionPeriod | undefined {
  return periods.find((candidate) => periodAsOf(candidate) === asOf)
    ?? periods.find((candidate) => candidate.startsOn <= asOf && candidate.endsOn >= asOf);
}

function adjustmentForPeriod(period: ContributionPeriod | undefined, options: ProjectionCalculationOptions): number {
  if (!period || !options.balanceAdjustments) return 0;
  return options.balanceAdjustments
    .filter((adjustment) => adjustment.occurredOn >= period.startsOn && adjustment.occurredOn <= period.endsOn)
    .reduce((total, adjustment) => total + adjustment.amountMinor, 0);
}

/**
 * Calculates existing snapshots and eligible missing period cells in one chronological chain.
 * A null id identifies a generated row that the repository must insert.
 */
export function calculateProjectedTimeline(
  periods: readonly ContributionPeriod[],
  snapshots: readonly ProjectionSnapshot[],
  rules: readonly ContributionRuleSchedule[],
  exceptions: readonly ContributionExceptionSchedule[] = [],
  options: ProjectionCalculationOptions = {},
): readonly ProjectionTimelineSnapshot[] {
  const sortedSnapshots = [...snapshots].sort((left, right) => left.asOf.localeCompare(right.asOf) || left.id.localeCompare(right.id));
  const sortedPeriods = [...periods].sort((left, right) => periodAsOf(left).localeCompare(periodAsOf(right)));
  const snapshotsByDate = new Map(sortedSnapshots.map((snapshot) => [snapshot.asOf, snapshot]));
  const dates = [...new Set([
    ...sortedPeriods.map((period) => periodAsOf(period)),
    ...sortedSnapshots.map((snapshot) => snapshot.asOf),
  ])].sort();
  const result: ProjectionTimelineSnapshot[] = [];
  let previousFinal: number | null = null;

  for (const asOf of dates) {
    const snapshot = snapshotsByDate.get(asOf);
    const cashFlowEnding = options.endingBalanceOverridesByAsOf?.get(asOf);
    if (snapshot) {
      const period = periodForDate(sortedPeriods, asOf);
      const recalculable = shouldRecalculate(snapshot, options);
      const balanceMinor: number = !recalculable
        ? snapshot.balanceMinor
        : cashFlowEnding !== undefined
          ? cashFlowEnding
          : (previousFinal ?? 0) + (period ? contributionForPeriod(period, rules, exceptions) : 0) + adjustmentForPeriod(period, options);
      if (!Number.isSafeInteger(balanceMinor)) throw new RangeError("Projected balance is too large.");
      const next: ProjectionTimelineSnapshot = {
        ...snapshot,
        balanceMinor,
        isGenerated: recalculable ? true : snapshot.isGenerated,
      };
      previousFinal = next.balanceMinor;
      result.push(next);
      continue;
    }

    const period = sortedPeriods.find((candidate) => periodAsOf(candidate) === asOf);
    if (!period || !shouldCreateProjection(asOf, options)) continue;
    if (cashFlowEnding === undefined && previousFinal === null) continue;
    const balanceMinor = cashFlowEnding !== undefined
      ? cashFlowEnding
      : (previousFinal ?? 0) + contributionForPeriod(period, rules, exceptions) + adjustmentForPeriod(period, options);
    if (!Number.isSafeInteger(balanceMinor)) throw new RangeError("Projected balance is too large.");
    previousFinal = balanceMinor;
    result.push({ id: null, asOf, balanceMinor, status: "planned", isGenerated: true });
  }

  return result;
}
