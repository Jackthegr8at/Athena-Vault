import { describe, expect, it } from "vitest";
import { firstByPeriodId, groupPeriodMovements } from "./period-projection-data";

interface Bounds { startsOn: string; endsOn: string }
export function referenceMembership<T>(periods: readonly Bounds[], rows: readonly T[], date: (row: T) => string) {
  return periods.map(period => rows.filter(row => date(row) >= period.startsOn && date(row) <= period.endsOn));
}
describe("period assembly reference contract", () => {
  it("matches filters for shuffled records, inclusive bounds, gaps and malformed/overlapping windows", () => {
    const transactions = ["2030-02-01", "2030-01-14", "2030-01-01", "2029-12-31", "2030-01-18"].map((transactionDate, id) => ({ transactionDate, id }));
    const transfers = transactions.map(t => ({ transferDate: t.transactionDate, id: t.id, from: "hidden", to: "visible" }));
    for (const periods of [[], [{ startsOn: "2030-01-01", endsOn: "2030-01-14" }, { startsOn: "2030-01-20", endsOn: "2030-02-01" }], [{ startsOn: "2030-01-01", endsOn: "2030-02-01" }, { startsOn: "2030-01-14", endsOn: "2030-02-01" }], [{ startsOn: "bad", endsOn: "2030-01-01" }]]) {
      const grouped = groupPeriodMovements(periods, transactions, transfers);
      expect(grouped.map(g => g.transactions)).toEqual(referenceMembership(periods, transactions, t => t.transactionDate));
      expect(grouped.map(g => g.transfers)).toEqual(referenceMembership(periods, transfers, t => t.transferDate));
    }
  });
  it("uses first projection for duplicate IDs and returns undefined for missing IDs", () => {
    const rows = [{ period: { id: "same" }, amountMinor: 100 }, { period: { id: "same" }, amountMinor: 200 }];
    const indexed = firstByPeriodId(rows);
    expect(indexed.get("same")).toBe(rows[0]); expect(indexed.get("missing")).toBeUndefined();
    expect(firstByPeriodId([]).size).toBe(0);
  });
  it("preserves source ordering, inclusive endpoints and duplicate/overlapping membership", () => {
    const periods = [{ startsOn: "2030-01-01", endsOn: "2030-01-14" }, { startsOn: "2030-01-14", endsOn: "2030-01-28" }];
    const rows = [{ id: "last", date: "2030-01-14", from: "hidden", to: "visible" }, { id: "first", date: "2030-01-01", from: "visible", to: "hidden" }];
    expect(referenceMembership(periods, rows, row => row.date)).toEqual([rows, [rows[0]]]);
    expect(referenceMembership([], rows, row => row.date)).toEqual([]);
    expect(referenceMembership(periods, [], () => "")).toEqual([[], []]);
  });
});
