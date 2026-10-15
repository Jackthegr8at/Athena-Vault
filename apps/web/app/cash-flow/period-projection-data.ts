interface Bounds { readonly startsOn: string; readonly endsOn: string }
export interface AssignmentMetrics { membershipChecks: number; fallback: boolean }

function groupRows<T>(periods: readonly Bounds[], rows: readonly T[], date: (row: T) => string, metrics?: AssignmentMetrics): T[][] {
  const valid = periods.every((p, i) => /^\d{4}-\d{2}-\d{2}$/.test(p.startsOn) && /^\d{4}-\d{2}-\d{2}$/.test(p.endsOn) && p.startsOn <= p.endsOn && (i === 0 || periods[i - 1]!.endsOn < p.startsOn));
  if (!valid) {
    if (metrics) metrics.fallback = true;
    return periods.map(p => rows.filter(row => {
      if (metrics) metrics.membershipChecks++;
      return date(row) >= p.startsOn && date(row) <= p.endsOn;
    }));
  }
  const grouped: T[][] = periods.map(() => []);
  for (const row of rows) {
    const value = date(row);
    let low = 0; let high = periods.length - 1;
    while (low <= high) {
      const index = Math.floor((low + high) / 2);
      const p = periods[index]!;
      if (metrics) metrics.membershipChecks++;
      if (value < p.startsOn) high = index - 1;
      else if (value > p.endsOn) low = index + 1;
      else { grouped[index]!.push(row); break; }
    }
  }
  return grouped;
}

export function groupPeriodMovements<P extends Bounds, T extends { readonly transactionDate: string }, U extends { readonly transferDate: string }>(periods: readonly P[], transactions: readonly T[], transfers: readonly U[], metrics?: AssignmentMetrics) {
  const tx = groupRows(periods, transactions, row => row.transactionDate, metrics);
  const tr = groupRows(periods, transfers, row => row.transferDate, metrics);
  return periods.map((period, index) => ({ period, transactions: tx[index]!, transfers: tr[index]! }));
}

/** Array.find semantics: the first duplicate ID wins. */
export function firstByPeriodId<T extends { readonly period: { readonly id: string } }>(rows: readonly T[]): ReadonlyMap<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) if (!result.has(row.period.id)) result.set(row.period.id, row);
  return result;
}
