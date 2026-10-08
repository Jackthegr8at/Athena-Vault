interface PaydayPeriod {
  readonly payDate: string;
}

export interface ForwardPeriodBounds {
  readonly startsOn: string;
  readonly endsOn: string;
}

function addIsoDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year!, month! - 1, day!));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function daysBetween(left: string, right: string): number {
  const leftDate = new Date(`${left}T00:00:00.000Z`).getTime();
  const rightDate = new Date(`${right}T00:00:00.000Z`).getTime();
  return Math.round((rightDate - leftDate) / 86_400_000);
}

export function forwardCashFlowPeriodBounds(periods: readonly PaydayPeriod[]): readonly ForwardPeriodBounds[] {
  return periods.map((period, index) => {
    const next = periods[index + 1];
    const previous = periods[index - 1];
    const cadenceDays = next
      ? daysBetween(period.payDate, next.payDate)
      : previous
        ? daysBetween(previous.payDate, period.payDate)
        : 14;
    const safeCadenceDays = cadenceDays > 0 && cadenceDays <= 62 ? cadenceDays : 14;
    return {
      startsOn: period.payDate,
      endsOn: addIsoDays(period.payDate, safeCadenceDays - 1),
    };
  });
}
