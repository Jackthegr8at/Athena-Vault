import { normalizeIsoDates, selectClosestPaydayOnOrBefore } from "./account-timeline";

export function selectAccountTimelineWindow(paydays: readonly string[], options: {
  readonly todayIso: string; readonly selectedDate?: string | null; readonly pastPeriods?: number; readonly futurePeriods?: number;
}) {
  const dates = normalizeIsoDates(paydays);
  const selectedDate = options.selectedDate && dates.includes(options.selectedDate)
    ? options.selectedDate : selectClosestPaydayOnOrBefore(dates, options.todayIso);
  const pastPeriods = Math.max(0, Math.min(24, options.pastPeriods ?? 3));
  const futurePeriods = Math.max(0, Math.min(24, options.futurePeriods ?? 5));
  const index = selectedDate ? dates.indexOf(selectedDate) : -1;
  const start = index < 0 ? 0 : Math.max(0, index - pastPeriods);
  const end = index < 0 ? dates.length : Math.min(dates.length, index + futurePeriods + 1);
  return { dates, selectedDate, pastPeriods, futurePeriods, start, end, visibleDates: dates.slice(start, end) };
}
