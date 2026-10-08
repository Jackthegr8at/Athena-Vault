import { describe, expect, it } from "vitest";
import { recurringCashFlowOccurrencesBetween, type RecurringCashFlowVersionSchedule } from "@athena/database";
import { expandCashFlowRecurringRangeOptions, type CashFlowRecurringRangeSegment } from "./recurring-range-options";
import { buildCashFlowRecurringRangeSegments, type CashFlowRecurringRangeOccurrence, type CashFlowRecurringRangeSeries } from "./recurring-range-segments";

const version = (id: string, seriesId: string, startsOn: string, endsOn: string): RecurringCashFlowVersionSchedule => ({
  id,
  seriesId,
  name: id,
  kind: "income",
  accountId: "account-1",
  fromAccountId: null,
  toAccountId: null,
  amountMinor: 100,
  frequency: "biweekly",
  weekdayAdjustment: "none",
  startsOn,
  endsOn,
  effectiveFrom: startsOn,
  effectiveTo: null,
});

const v1 = version("version-1", "series-1", "2020-01-03", "2050-01-01");
const v2 = version("version-2", "series-1", "2020-01-03", "2022-01-01");
const v3 = version("version-3", "series-2", "2025-01-03", "2025-01-03");
const series: readonly CashFlowRecurringRangeSeries<RecurringCashFlowVersionSchedule>[] = [
  { id: "series-1", versions: [{ id: v1.id, schedule: v1 }, { id: v2.id, schedule: v2 }] },
  { id: "series-2", versions: [{ id: v3.id, schedule: v3 }] },
];

function occurrenceRows(schedule: RecurringCashFlowVersionSchedule, limit?: number): CashFlowRecurringRangeOccurrence[] {
  return recurringCashFlowOccurrencesBetween(schedule, schedule.startsOn, schedule.endsOn ?? schedule.startsOn)
    .slice(0, limit)
    .map((scheduledOccurrenceOn) => ({ recurringSeriesId: schedule.seriesId, recurringTransactionId: schedule.id, scheduledOccurrenceOn }));
}

function lowerBound(dates: readonly string[], value: string): number {
  let low = 0;
  let high = dates.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (dates[middle]! < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBound(dates: readonly string[], value: string): number {
  let low = 0;
  let high = dates.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (dates[middle]! <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function referenceOptions(planned: readonly CashFlowRecurringRangeOccurrence[], schedules: ReadonlyMap<string, RecurringCashFlowVersionSchedule>): readonly string[] {
  const knownSeries = [...new Set(planned.map((entry) => entry.recurringSeriesId).filter((value): value is string => value !== null))];
  return knownSeries.flatMap((seriesId) => {
    const versionIds = [...new Set(planned.filter((entry) => entry.recurringSeriesId === seriesId).map((entry) => entry.recurringTransactionId).filter((value): value is string => value !== null))];
    return versionIds.flatMap((versionId) => {
      const schedule = schedules.get(versionId);
      if (!schedule) return [];
      const dates = planned
        .filter((entry) => entry.recurringSeriesId === seriesId && entry.recurringTransactionId === versionId && entry.scheduledOccurrenceOn !== null)
        .map((entry) => entry.scheduledOccurrenceOn!)
        .sort((left, right) => left.localeCompare(right));
      const plannedCounts = new Map<string, number>();
      for (const date of dates) plannedCounts.set(date, (plannedCounts.get(date) ?? 0) + 1);
      const expected = recurringCashFlowOccurrencesBetween(schedule, schedule.startsOn, schedule.endsOn ?? schedule.startsOn);
      const missingPrefix = [0];
      for (const date of expected) missingPrefix.push(missingPrefix.at(-1)! + (plannedCounts.has(date) ? 0 : 1));
      return dates.flatMap((start, startIndex) => dates.slice(startIndex).flatMap((ending) => {
        const expectedStart = lowerBound(expected, start);
        const expectedEnd = upperBound(expected, ending);
        const candidateCount = upperBound(dates, ending) - lowerBound(dates, start);
        const expectedCount = expectedEnd - expectedStart;
        return candidateCount === expectedCount && missingPrefix[expectedEnd] === missingPrefix[expectedStart]
          ? [`${seriesId}|${versionId}|${start}|${ending}|${expectedCount}`]
          : [];
      }));
    });
  });
}

function compressedOptions(segments: readonly CashFlowRecurringRangeSegment[]): readonly string[] {
  const starts = [...new Set(segments.flatMap((segment) => segment.occurrences.map((start) => `${segment.seriesId}|${start}`)))];
  return starts.flatMap((key) => {
    const [seriesId, scheduledOccurrenceOn] = key.split("|");
    return expandCashFlowRecurringRangeOptions(segments, seriesId!, scheduledOccurrenceOn!)
      .map((option) => `${seriesId}|${option.versionId}|${scheduledOccurrenceOn}|${option.endingOccurrenceOn}|${option.occurrenceCount}`);
  });
}

describe("recurring range segment compression", () => {
  it("matches the old option multiset for 30-year biweekly gaps, duplicates, overlapping versions, and isolated rows", () => {
    const allV1 = occurrenceRows(v1);
    const planned: CashFlowRecurringRangeOccurrence[] = allV1.filter((_row, index) => index !== 0 && index !== 17);
    planned.push(...occurrenceRows(v2, 70));
    planned.push(...occurrenceRows(v3));
    planned.push({ recurringSeriesId: "series-1", recurringTransactionId: v1.id, scheduledOccurrenceOn: "2028-05-06" });
    planned.push({ recurringSeriesId: "series-1", recurringTransactionId: v1.id, scheduledOccurrenceOn: "2028-06-02" });
    planned.push({ recurringSeriesId: "series-1", recurringTransactionId: "missing-version", scheduledOccurrenceOn: "2028-06-16" });

    const segments = buildCashFlowRecurringRangeSegments(series, planned, recurringCashFlowOccurrencesBetween);
    const schedules = new Map(series.flatMap((entry) => entry.versions.map((entryVersion) => [entryVersion.id, entryVersion.schedule] as const)));
    const actual = [...compressedOptions(segments)].sort();
    const expected = [...referenceOptions(planned, schedules)].sort();

    expect(actual).toEqual(expected);
  });
});
