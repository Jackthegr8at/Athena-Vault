import type { NetWorthHistoryPoint } from "@athena/finance-engine";
import type { MetricSnapshot } from "./net-worth-history-data";

/** Compare exact actual payday points, never the synthetic evaluation-day point. */
export function paydayNetWorthSnapshot(
  points: readonly NetWorthHistoryPoint[],
  paydays: readonly string[],
  todayIso: string,
): MetricSnapshot {
  const dates = [...new Set(paydays.filter(date => date <= todayIso))].sort();
  const currentDate = dates.at(-1);
  const previousDate = dates.at(-2);
  const current = points.find(point => point.phase === "actual" && point.asOf === currentDate);
  const previous = points.find(point => point.phase === "actual" && point.asOf === previousDate);
  const currentMinor = current?.netWorthMinor ?? null;
  const previousMinor = previous?.netWorthMinor ?? null;
  const changeMinor = currentMinor === null || previousMinor === null ? null : currentMinor - previousMinor;
  const validChange = changeMinor !== null && Number.isSafeInteger(changeMinor);
  return { currentMinor, changeMinor: validChange ? changeMinor : null, fromAsOf: validChange ? previousDate! : null };
}
