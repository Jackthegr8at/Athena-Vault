export const recurringCashFlowFrequencies = ["weekly", "biweekly", "monthly", "quarterly", "annual"] as const;
export const recurringWeekdayAdjustments = ["none", "next_weekday", "previous_weekday"] as const;

export type RecurringCashFlowFrequency = (typeof recurringCashFlowFrequencies)[number];
export type RecurringCashFlowKind = "income" | "expense" | "transfer";
export type RecurringWeekdayAdjustment = (typeof recurringWeekdayAdjustments)[number];
export type RecurringOccurrenceExceptionKind = "override" | "skip";

export interface RecurringCashFlowVersionSchedule {
  readonly id: string;
  readonly seriesId: string;
  readonly name: string;
  readonly kind: RecurringCashFlowKind;
  readonly accountId: string | null;
  readonly fromAccountId: string | null;
  readonly toAccountId: string | null;
  readonly amountMinor: number;
  readonly frequency: RecurringCashFlowFrequency;
  readonly weekdayAdjustment: RecurringWeekdayAdjustment;
  readonly startsOn: string;
  readonly endsOn: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly countsAsExpense?: boolean;
}

export interface RecurringOccurrenceException {
  readonly id: string;
  readonly seriesId: string;
  readonly versionId: string;
  readonly scheduledOccurrenceOn: string;
  readonly kind: RecurringOccurrenceExceptionKind;
  readonly dateOverride: string | null;
  readonly amountOverrideMinor: number | null;
  readonly accountOverrideId: string | null;
  readonly fromAccountOverrideId: string | null;
  readonly toAccountOverrideId: string | null;
  readonly transferId: string | null;
  readonly statusOverride: "planned" | null;
  readonly note: string | null;
  readonly overrideGroupId: string | null;
  readonly isActive: boolean;
}

export interface RecurringCashFlowOccurrence {
  readonly seriesId: string;
  readonly versionId: string;
  readonly scheduledOccurrenceOn: string;
  readonly transactionDate: string | null;
  readonly amountMinor: number;
  readonly accountId: string | null;
  readonly fromAccountId: string | null;
  readonly toAccountId: string | null;
  readonly name: string;
  readonly kind: RecurringCashFlowKind;
  readonly status: "planned" | "skipped";
  readonly isSkipped: boolean;
  readonly exceptionId: string | null;
  readonly note: string | null;
  readonly overrideGroupId: string | null;
}

export interface RecurringOccurrenceRangeOption {
  readonly endingOccurrenceOn: string;
  readonly occurrenceCount: number;
}

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
function parseIsoDate(value: string): Date {
  if (!isoDatePattern.test(value)) throw new RangeError("Date must be a valid ISO date.");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || toIsoDate(parsed) !== value) throw new RangeError("Date must be a valid ISO date.");
  return parsed;
}

function toIsoDate(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function monthlyOccurrence(anchor: Date, monthOffset: number): string {
  const anchorMonth = anchor.getUTCFullYear() * 12 + anchor.getUTCMonth();
  const targetMonth = anchorMonth + monthOffset;
  const year = Math.floor(targetMonth / 12);
  const monthIndex = targetMonth - year * 12;
  const day = Math.min(anchor.getUTCDate(), daysInMonth(year, monthIndex));
  return toIsoDate(new Date(Date.UTC(year, monthIndex, day)));
}

function intervalMonths(frequency: RecurringCashFlowFrequency): number {
  if (frequency === "monthly") return 1;
  if (frequency === "quarterly") return 3;
  return 12;
}

function weekdayAdjustmentDays(value: string, adjustment: RecurringWeekdayAdjustment): number {
  if (adjustment === "none") return 0;
  const day = parseIsoDate(value).getUTCDay();
  if (day === 0) return adjustment === "next_weekday" ? 1 : -2;
  if (day === 6) return adjustment === "next_weekday" ? 2 : -1;
  return 0;
}

export function adjustRecurringCashFlowWeekday(value: string, adjustment: RecurringWeekdayAdjustment = "none"): string {
  parseIsoDate(value);
  if (!recurringWeekdayAdjustments.includes(adjustment)) throw new RangeError("Weekday adjustment is invalid.");
  return addRecurringCashFlowDays(value, weekdayAdjustmentDays(value, adjustment));
}

function recurringCashFlowOccurrenceAtIndex(schedule: Pick<RecurringCashFlowVersionSchedule, "frequency" | "startsOn" | "weekdayAdjustment">, index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) throw new RangeError("Occurrence index must be a non-negative integer.");
  const anchor = parseIsoDate(schedule.startsOn);
  const normalOccurrence = schedule.frequency === "weekly" || schedule.frequency === "biweekly"
    ? addRecurringCashFlowDays(schedule.startsOn, index * (schedule.frequency === "weekly" ? 7 : 14))
    : monthlyOccurrence(anchor, index * intervalMonths(schedule.frequency));
  return adjustRecurringCashFlowWeekday(normalOccurrence, schedule.weekdayAdjustment);
}

function assertSafeMinorUnits(value: number, fieldName: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${fieldName} must be a positive integer minor-unit value.`);
}

export function isRecurringCashFlowIsoDate(value: string): boolean {
  try {
    parseIsoDate(value);
    return true;
  } catch {
    return false;
  }
}

export function addRecurringCashFlowDays(value: string, days: number): string {
  const date = parseIsoDate(value);
  if (!Number.isSafeInteger(days)) throw new RangeError("Day offsets must be integer values.");
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

export function recurringCashFlowOccurrencesBetween(
  schedule: Pick<RecurringCashFlowVersionSchedule, "frequency" | "startsOn" | "endsOn" | "weekdayAdjustment">,
  requestedStart: string,
  requestedEnd: string,
): readonly string[] {
  parseIsoDate(requestedStart);
  parseIsoDate(requestedEnd);
  parseIsoDate(schedule.startsOn);
  if (requestedStart > requestedEnd) return [];
  const boundedEnd = schedule.endsOn && schedule.endsOn < requestedEnd ? schedule.endsOn : requestedEnd;
  parseIsoDate(boundedEnd);
  if (requestedStart > boundedEnd) return [];
  const occurrences: string[] = [];
  for (let index = 0; index < 100_000; index += 1) {
    const occurrence = recurringCashFlowOccurrenceAtIndex(schedule, index);
    if (occurrence >= requestedStart && occurrence <= boundedEnd) occurrences.push(occurrence);
    const normalLimit = addRecurringCashFlowDays(boundedEnd, 2);
    const normalOccurrence = schedule.frequency === "weekly" || schedule.frequency === "biweekly"
      ? addRecurringCashFlowDays(schedule.startsOn, index * (schedule.frequency === "weekly" ? 7 : 14))
      : monthlyOccurrence(parseIsoDate(schedule.startsOn), index * intervalMonths(schedule.frequency));
    if (normalOccurrence > normalLimit) break;
  }
  return occurrences;
}

export function nextRecurringCashFlowOccurrence(
  schedule: Pick<RecurringCashFlowVersionSchedule, "frequency" | "startsOn" | "endsOn" | "weekdayAdjustment">,
  fromDate: string,
): string | null {
  parseIsoDate(fromDate);
  parseIsoDate(schedule.startsOn);
  if (schedule.endsOn) parseIsoDate(schedule.endsOn);
  for (let index = 0; index < 100_000; index += 1) {
    const occurrence = recurringCashFlowOccurrenceAtIndex(schedule, index);
    if (schedule.endsOn && occurrence > schedule.endsOn) return null;
    if (occurrence >= fromDate) return occurrence;
  }
  throw new RangeError("Recurring schedule has too many occurrences to calculate the next date.");
}

/** Return the first scheduled occurrence strictly after the supplied date. */
export function nextRecurringCashFlowOccurrenceAfter(
  schedule: Pick<RecurringCashFlowVersionSchedule, "frequency" | "startsOn" | "endsOn" | "weekdayAdjustment">,
  afterDate: string,
): string | null {
  return nextRecurringCashFlowOccurrence(schedule, addRecurringCashFlowDays(afterDate, 1));
}

export function isRecurringCashFlowOccurrence(
  schedule: Pick<RecurringCashFlowVersionSchedule, "frequency" | "startsOn" | "endsOn" | "weekdayAdjustment">,
  occurrenceOn: string,
): boolean {
  parseIsoDate(occurrenceOn);
  return recurringCashFlowOccurrencesBetween(schedule, occurrenceOn, occurrenceOn).includes(occurrenceOn);
}

export function assertRecurringCashFlowOccurrence(
  schedule: Pick<RecurringCashFlowVersionSchedule, "frequency" | "startsOn" | "endsOn" | "weekdayAdjustment">,
  occurrenceOn: string,
  fieldName = "Occurrence date",
): void {
  if (!isRecurringCashFlowOccurrence(schedule, occurrenceOn)) throw new RangeError(`${fieldName} must match the recurring schedule.`);
}

export function partitionRecurringCashFlowVersions(
  versions: readonly RecurringCashFlowVersionSchedule[],
  seriesId?: string,
): readonly RecurringCashFlowVersionSchedule[] {
  const selected = seriesId ? versions.filter((version) => version.seriesId === seriesId) : [...versions];
  const sorted = [...selected].sort((first, second) => first.effectiveFrom.localeCompare(second.effectiveFrom) || first.id.localeCompare(second.id));
  for (const version of sorted) {
    parseIsoDate(version.startsOn);
    parseIsoDate(version.effectiveFrom);
    if (version.endsOn) parseIsoDate(version.endsOn);
    if (version.effectiveTo) parseIsoDate(version.effectiveTo);
    assertRecurringCashFlowOccurrence(version, version.effectiveFrom, "Effective occurrence date");
    if (version.effectiveTo !== null && version.effectiveTo < version.effectiveFrom) {
      throw new RangeError(`Recurring version ${version.id} has an invalid effective range.`);
    }
  }
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;
    if (previous.effectiveTo === null || current.effectiveFrom <= previous.effectiveTo) {
      throw new RangeError(`Overlapping recurring versions apply between ${previous.id} and ${current.id}.`);
    }
  }
  return sorted;
}

export function selectRecurringCashFlowVersion(
  versions: readonly RecurringCashFlowVersionSchedule[],
  occurrenceOn: string,
): RecurringCashFlowVersionSchedule | null {
  parseIsoDate(occurrenceOn);
  const applicable = versions.filter((version) =>
    version.effectiveFrom <= occurrenceOn
    && (version.effectiveTo === null || version.effectiveTo >= occurrenceOn),
  );
  if (applicable.length > 1) throw new RangeError(`Overlapping recurring versions apply on ${occurrenceOn}.`);
  return applicable[0] ?? null;
}

function exceptionFor(
  exceptions: readonly RecurringOccurrenceException[],
  seriesId: string,
  versionId: string,
  scheduledOccurrenceOn: string,
): RecurringOccurrenceException | null {
  const matching = exceptions.filter((exception) =>
    exception.isActive
    && exception.seriesId === seriesId
    && exception.versionId === versionId
    && exception.scheduledOccurrenceOn === scheduledOccurrenceOn,
  );
  if (matching.length > 1) throw new RangeError(`Multiple active exceptions apply on ${scheduledOccurrenceOn}.`);
  return matching[0] ?? null;
}

export function applyRecurringCashFlowException(
  base: RecurringCashFlowOccurrence,
  exception: RecurringOccurrenceException | null,
): RecurringCashFlowOccurrence {
  if (!exception || !exception.isActive) return { ...base, isSkipped: false, status: "planned" };
  if (exception.kind === "skip") {
    return {
      ...base,
      transactionDate: null,
      status: "skipped",
      isSkipped: true,
      exceptionId: exception.id,
      note: exception.note,
      overrideGroupId: exception.overrideGroupId,
    };
  }
  return {
    ...base,
    transactionDate: exception.dateOverride ?? base.transactionDate,
    amountMinor: exception.amountOverrideMinor ?? base.amountMinor,
    accountId: exception.accountOverrideId ?? base.accountId,
    fromAccountId: exception.fromAccountOverrideId ?? base.fromAccountId,
    toAccountId: exception.toAccountOverrideId ?? base.toAccountId,
    status: exception.statusOverride ?? "planned",
    isSkipped: false,
    exceptionId: exception.id,
    note: exception.note,
    overrideGroupId: exception.overrideGroupId,
  };
}

export function expandRecurringCashFlowOccurrences(
  seriesId: string,
  versions: readonly RecurringCashFlowVersionSchedule[],
  exceptions: readonly RecurringOccurrenceException[],
  requestedStart: string,
  requestedEnd: string,
): readonly RecurringCashFlowOccurrence[] {
  parseIsoDate(requestedStart);
  parseIsoDate(requestedEnd);
  if (requestedStart > requestedEnd) return [];
  const candidateDates = new Set<string>();
  const seriesVersions = partitionRecurringCashFlowVersions(versions, seriesId);
  for (const version of seriesVersions) {
    assertSafeMinorUnits(version.amountMinor, "Recurring amount");
    for (const occurrenceOn of recurringCashFlowOccurrencesBetween(version, requestedStart, requestedEnd)) candidateDates.add(occurrenceOn);
  }
  return [...candidateDates].sort().flatMap((scheduledOccurrenceOn) => {
    const version = selectRecurringCashFlowVersion(seriesVersions, scheduledOccurrenceOn);
    if (!version) return [];
    const base: RecurringCashFlowOccurrence = {
      seriesId,
      versionId: version.id,
      scheduledOccurrenceOn,
      transactionDate: scheduledOccurrenceOn,
      amountMinor: version.amountMinor,
      accountId: version.accountId,
      fromAccountId: version.fromAccountId,
      toAccountId: version.toAccountId,
      name: version.name,
      kind: version.kind,
      status: "planned",
      isSkipped: false,
      exceptionId: null,
      note: null,
      overrideGroupId: null,
    };
    return [applyRecurringCashFlowException(base, exceptionFor(exceptions, seriesId, version.id, scheduledOccurrenceOn))];
  });
}

export function recurringCashFlowRangeOptions(
  occurrences: readonly RecurringCashFlowOccurrence[],
  firstOccurrenceOn: string,
): readonly RecurringOccurrenceRangeOption[] {
  parseIsoDate(firstOccurrenceOn);
  const planned = occurrences.filter((occurrence) => occurrence.scheduledOccurrenceOn >= firstOccurrenceOn && !occurrence.isSkipped && occurrence.status === "planned");
  return planned.map((occurrence, index) => ({ endingOccurrenceOn: occurrence.scheduledOccurrenceOn, occurrenceCount: index + 1 }));
}

export function recurringCashFlowTotalMinor(occurrences: readonly RecurringCashFlowOccurrence[]): number {
  let total = 0;
  for (const occurrence of occurrences) {
    if (occurrence.isSkipped) continue;
    assertSafeMinorUnits(occurrence.amountMinor, "Recurring occurrence amount");
    total += occurrence.amountMinor;
    if (!Number.isSafeInteger(total)) throw new RangeError("Recurring occurrence total is too large.");
  }
  return total;
}

export const occurrencesBetweenRecurringCashFlow = recurringCashFlowOccurrencesBetween;
export const selectEffectiveRecurringCashFlowVersion = selectRecurringCashFlowVersion;
