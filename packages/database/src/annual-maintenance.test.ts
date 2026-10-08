import { describe, expect, it } from "vitest";
import {
  annualizeMaintenanceAmount,
  annualizeMaintenanceItems,
  maintenanceAnnualizationFactors,
  monthlyMaintenanceReserve,
} from "./annual-maintenance";

describe("annual maintenance calculations", () => {
  it("exposes the four supported annualization factors", () => {
    expect(maintenanceAnnualizationFactors).toEqual({ weekly: 52, biweekly: 26, monthly: 12, annual: 1 });
  });

  it.each([
    ["weekly", 52],
    ["biweekly", 26],
    ["monthly", 12],
    ["annual", 1],
  ] as const)("annualizes %s amounts using integer minor units", (frequency, factor) => {
    expect(annualizeMaintenanceAmount(125, frequency)).toBe(125 * factor);
  });

  it("sums annualized active item values", () => {
    expect(annualizeMaintenanceItems([
      { amountMinor: 100, frequency: "weekly" },
      { amountMinor: 200, frequency: "biweekly" },
      { amountMinor: 300, frequency: "monthly" },
      { amountMinor: 400, frequency: "annual" },
    ])).toBe(14400);
  });

  it("rejects annualized totals that overflow safe integer minor units", () => {
    expect(() => annualizeMaintenanceItems([
      { amountMinor: Number.MAX_SAFE_INTEGER, frequency: "annual" },
      { amountMinor: 1, frequency: "annual" },
    ])).toThrow(RangeError);
  });

  it("rounds the monthly reserve to integer CAD minor units", () => {
    expect(monthlyMaintenanceReserve(86000)).toBe(7167);
    expect(monthlyMaintenanceReserve(86001)).toBe(7167);
    expect(monthlyMaintenanceReserve(86010)).toBe(7168);
    expect(monthlyMaintenanceReserve(Number.MAX_SAFE_INTEGER - 2)).toBe(750599937895082);
  });
});
