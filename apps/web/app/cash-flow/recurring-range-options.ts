export interface CashFlowRecurringRangeSegment {
  readonly seriesId: string;
  readonly versionId: string;
  readonly occurrences: readonly string[];
}

export interface CashFlowRecurringRangeOption {
  readonly versionId: string;
  readonly endingOccurrenceOn: string;
  readonly occurrenceCount: number;
}

export function expandCashFlowRecurringRangeOptions(
  segments: readonly CashFlowRecurringRangeSegment[],
  seriesId: string,
  scheduledOccurrenceOn: string,
  versionId?: string,
): readonly CashFlowRecurringRangeOption[] {
  return segments
    .filter((segment) => segment.seriesId === seriesId && (versionId === undefined || segment.versionId === versionId))
    .flatMap((segment) => {
      const startIndex = segment.occurrences.indexOf(scheduledOccurrenceOn);
      return startIndex < 0 ? [] : segment.occurrences.slice(startIndex).map((endingOccurrenceOn, index) => ({ versionId: segment.versionId, endingOccurrenceOn, occurrenceCount: index + 1 }));
    });
}
