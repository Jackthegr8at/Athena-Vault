import type { NetWorthHistoryPoint } from "@athena/finance-engine";
import { describe, expect, it } from "vitest";
import { paydayNetWorthSnapshot } from "./overview-payday-comparison";

function point(asOf: string, netWorthMinor: number | null, phase: "actual" | "projected" = "actual"): NetWorthHistoryPoint {
  return { asOf, netWorthMinor, phase, isFirstProjected: false, investmentsMinor: null, homeEquityMinor: null, cashOtherMinor: null };
}
const paydays = ["2026-09-30", "2026-10-14", "2026-10-28"];

describe("Overview payday net-worth comparison", () => {
  it("compares this payday to the preceding payday even when today repeats the balance", () => {
    const points = [point("2026-09-30", 10_000_000), point("2026-10-14", 10_500_000), point("2026-10-15", 10_500_000)];
    expect(paydayNetWorthSnapshot(points, paydays, "2026-10-15")).toEqual({ currentMinor: 10_500_000, changeMinor: 500_000, fromAsOf: "2026-09-30" });
    expect(paydayNetWorthSnapshot([...points, point("2026-10-16", 11_000_000)], paydays, "2026-10-16")).toEqual(paydayNetWorthSnapshot(points, paydays, "2026-10-15"));
  });
  it("includes today when today is a payday and excludes future paydays", () => {
    expect(paydayNetWorthSnapshot([point("2026-09-30", 200), point("2026-10-14", 100), point("2026-10-28", 500)], [...paydays].reverse(), "2026-10-14"))
      .toEqual({ currentMinor: 100, changeMinor: -100, fromAsOf: "2026-09-30" });
  });
  it("uses actual scheduled dates, deduplicates them and allows genuine zero changes", () => {
    expect(paydayNetWorthSnapshot([point("2026-10-01", 100), point("2026-10-10", 100)], ["2026-10-10", "2026-10-01", "2026-10-10"], "2026-10-15"))
      .toEqual({ currentMinor: 100, changeMinor: 0, fromAsOf: "2026-10-01" });
  });
  it("does not substitute an earlier or daily point for missing or projected payday data", () => {
    for (const points of [
      [point("2026-09-29", 100), point("2026-10-14", 200)],
      [point("2026-09-30", 100), point("2026-10-15", 200)],
      [point("2026-09-30", 100), point("2026-10-14", 200, "projected")],
      [point("2026-09-30", null), point("2026-10-14", 200)],
    ]) expect(paydayNetWorthSnapshot(points, paydays, "2026-10-15")).toMatchObject({ changeMinor: null, fromAsOf: null });
  });
  it("reports no comparison for insufficient history or an unsafe difference", () => {
    expect(paydayNetWorthSnapshot([], [], "2026-10-15")).toEqual({ currentMinor: null, changeMinor: null, fromAsOf: null });
    expect(paydayNetWorthSnapshot([point("2026-10-14", 100)], ["2026-10-14"], "2026-10-15").changeMinor).toBeNull();
    expect(paydayNetWorthSnapshot([point("2026-09-30", -Number.MAX_SAFE_INTEGER), point("2026-10-14", Number.MAX_SAFE_INTEGER)], paydays, "2026-10-15").changeMinor).toBeNull();
  });
});
