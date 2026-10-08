import { describe, expect, it } from "vitest";
import { forwardCashFlowPeriodBounds } from "./period-windows";

describe("forwardCashFlowPeriodBounds", () => {
  it("assigns dates after a payday to that payday card until the next payday", () => {
    expect(forwardCashFlowPeriodBounds([
      { payDate: "2026-08-05" },
      { payDate: "2026-08-19" },
      { payDate: "2026-09-02" },
    ])).toEqual([
      { startsOn: "2026-08-05", endsOn: "2026-08-18" },
      { startsOn: "2026-08-19", endsOn: "2026-09-01" },
      { startsOn: "2026-09-02", endsOn: "2026-09-15" },
    ]);
  });
});
