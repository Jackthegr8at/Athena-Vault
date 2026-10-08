import type { CashFlowRecurringRangeSegment } from "./recurring-range-options";

export interface CashFlowRecurringRangeSeries<Schedule> {
  readonly id: string;
  readonly versions: readonly { readonly id: string; readonly schedule: Schedule }[];
}

export interface CashFlowRecurringRangeOccurrence {
  readonly recurringSeriesId: string | null;
  readonly recurringTransactionId: string | null;
  readonly scheduledOccurrenceOn: string | null;
}

/** Build maximal valid recurring ranges with one schedule expansion per version. */
export function buildCashFlowRecurringRangeSegments<Schedule>(
  series: readonly CashFlowRecurringRangeSeries<Schedule>[],
  planned: readonly CashFlowRecurringRangeOccurrence[],
  occurrencesBetween: (schedule: Schedule, start: string, end: string) => readonly string[],
): readonly CashFlowRecurringRangeSegment[] {
  return series.flatMap((entry) => entry.versions.flatMap((version) => {
    const dates = planned
      .filter((occurrence) => occurrence.recurringSeriesId === entry.id && occurrence.recurringTransactionId === version.id && occurrence.scheduledOccurrenceOn !== null)
      .map((occurrence) => occurrence.scheduledOccurrenceOn!)
      .sort((left, right) => left.localeCompare(right));
    if (!dates.length) return [];
    const expected = occurrencesBetween(version.schedule, dates[0]!, dates.at(-1)!);
    const expectedIndexByDate = new Map<string, number>();
    const duplicateExpectedDates = new Set<string>();
    for (const [index, date] of expected.entries()) {
      if (expectedIndexByDate.has(date)) duplicateExpectedDates.add(date);
      else expectedIndexByDate.set(date, index);
    }
    const plannedDateCounts = new Map<string, number>();
    for (const date of dates) plannedDateCounts.set(date, (plannedDateCounts.get(date) ?? 0) + 1);
    const segments: CashFlowRecurringRangeSegment[] = [];
    for (let index = 0; index < dates.length; index += 1) {
      const date = dates[index]!;
      if (plannedDateCounts.get(date) !== 1 || duplicateExpectedDates.has(date) || expectedIndexByDate.get(date) === undefined) continue;
      const run = [date];
      while (index + 1 < dates.length) {
        const nextDate = dates[index + 1]!;
        const currentExpectedIndex = expectedIndexByDate.get(run.at(-1)!);
        const nextExpectedIndex = expectedIndexByDate.get(nextDate);
        if (plannedDateCounts.get(nextDate) !== 1 || duplicateExpectedDates.has(nextDate) || currentExpectedIndex === undefined || nextExpectedIndex !== currentExpectedIndex + 1) break;
        run.push(nextDate);
        index += 1;
      }
      segments.push({ seriesId: entry.id, versionId: version.id, occurrences: run });
    }
    return segments;
  }));
}
