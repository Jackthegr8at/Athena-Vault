import { describe, expect, it } from "vitest";
import type { CashFlowAccountView, InvestmentProjectionPointView } from "@athena/database";
import {
  accountKindLabel,
  amountTextToMinor,
  cashFlowAccountLabel,
  chartBandPath,
  chartPath,
  compactProjectionAxisValue,
  frequencyLabel,
  isoDateLabel,
  longDateLabel,
  minorToText,
  money,
  percentFromBasisPoints,
  percentTextToBasisPoints,
  safeIntegerFromText,
} from "./investment-calculation";

describe("investment-calculation", () => {
  it("money formats minor units as signed dollar strings with two decimals", () => {
    expect(money(12345)).toBe("$123.45");
    expect(money(-12345)).toBe("−$123.45");
    expect(money(0)).toBe("$0.00");
    expect(money(null)).toBe("—");
    expect(money(undefined)).toBe("—");
    expect(money(10.5)).toBe("—");
    expect(money(Number.MAX_SAFE_INTEGER + 1)).toBe("—");
    expect(money(Number.NaN)).toBe("—");
  });

  it("minorToText renders non-negative integer minor units as two-decimal text", () => {
    expect(minorToText(12345)).toBe("123.45");
    expect(minorToText(100)).toBe("1.00");
    expect(minorToText(0)).toBe("0.00");
    expect(minorToText(Number.MAX_SAFE_INTEGER)).toBe("90071992547409.91");
    expect(minorToText(null)).toBe("");
    expect(minorToText(-1)).toBe("");
    expect(minorToText(Number.MAX_SAFE_INTEGER + 1)).toBe("");
  });

  it("amountTextToMinor parses dollar strings into minor units", () => {
    expect(amountTextToMinor("123.45")).toBe(12345);
    expect(amountTextToMinor("0,05")).toBe(5);
    expect(amountTextToMinor("")).toBe(null);
    expect(amountTextToMinor("123456789012345")).toBe(null);
  });

  it("percentFromBasisPoints renders basis points as signed two-decimal percentages", () => {
    expect(percentFromBasisPoints(1250)).toBe("12.50");
    expect(percentFromBasisPoints(-1250)).toBe("−12.50");
    expect(percentFromBasisPoints(0)).toBe("0.00");
    expect(percentFromBasisPoints(null)).toBe("");
  });

  it("percentTextToBasisPoints parses percentage strings into basis points", () => {
    expect(percentTextToBasisPoints("12.50")).toBe(1250);
    expect(percentTextToBasisPoints("0.05")).toBe(5);
    expect(percentTextToBasisPoints("−12.50", true)).toBe(-1250);
    expect(percentTextToBasisPoints("-12.50", true)).toBe(-1250);
    expect(percentTextToBasisPoints("-12.50")).toBe(null);
    expect(percentTextToBasisPoints("foo")).toBe(null);
    expect(percentTextToBasisPoints(null)).toBe(null);
  });

  it("compactProjectionAxisValue compresses large minor amounts", () => {
    expect(compactProjectionAxisValue(12345)).toBe("$123.45");
    expect(compactProjectionAxisValue(12345678)).toBe("$123K");
    expect(compactProjectionAxisValue(123456789)).toBe("$1.2M");
    expect(compactProjectionAxisValue(-123456789)).toBe("−$1.2M");
  });

  it("chartPath and chartBandPath produce SVG path commands", () => {
    const points = [
      { balanceMinor: 100, contributionsMinor: 0, growthMinor: 0 },
      { balanceMinor: 200, contributionsMinor: 0, growthMinor: 0 },
    ] as unknown as InvestmentProjectionPointView[];
    const padding = { left: 10, right: 10, top: 10, bottom: 10 };
    const path = chartPath(points, "balanceMinor", 100, 100, padding, 100, 200);
    expect(path).toBe("M10.00 90.00 L90.00 10.00");

    const band = chartBandPath(points, null, "balanceMinor", 100, 100, padding, 100, 200);
    expect(band).toContain("M10.00 90.00");
    expect(band).toContain("L90.00 10.00");
    expect(band).toContain("Z");
  });

  it("chartPath handles a single point without division by zero", () => {
    const points = [{ balanceMinor: 150 } as unknown as InvestmentProjectionPointView];
    const padding = { left: 10, right: 10, top: 10, bottom: 10 };
    const path = chartPath(points, "balanceMinor", 100, 100, padding, 100, 200);
    expect(path).toBe("M10.00 50.00");
  });

  it("isoDateLabel and longDateLabel format dates safely", () => {
    expect(isoDateLabel(new Date("2026-09-01T12:00:00Z"))).toBe("2026-09-01");
    expect(isoDateLabel(null)).toBe("—");
    expect(longDateLabel("2026-09-01")).toContain("September");
    expect(longDateLabel(null)).toBe("—");
  });

  it("isoDateLabel formats the UTC-to-Toronto boundary on the Toronto calendar day", () => {
    expect(isoDateLabel(new Date("2026-09-24T02:30:00Z"))).toBe("2026-09-23");
  });

  it("frequencyLabel and accountKindLabel transform labels", () => {
    expect(frequencyLabel("monthly")).toBe("Monthly");
    expect(frequencyLabel("biweekly")).toBe("Every 2 weeks");
    expect(frequencyLabel("mixed")).toBe("Mixed cadence");
    expect(accountKindLabel("registered_retirement")).toBe("Registered Retirement");
  });

  it("cashFlowAccountLabel and safeIntegerFromText handle edge cases", () => {
    const accounts = [
      { id: "a", name: "Chequing", institution: "RBC" },
      { id: "b", name: "Savings at TD", institution: "TD" },
      { id: "c", name: "Branch", institution: "Branch" },
    ] as unknown as CashFlowAccountView[];
    expect(cashFlowAccountLabel(accounts, "a")).toBe("Chequing · RBC");
    expect(cashFlowAccountLabel(accounts, "b")).toBe("Savings at TD");
    expect(cashFlowAccountLabel(accounts, null)).toBe("Unspecified funding account");
    expect(cashFlowAccountLabel(accounts, "z")).toBe("Unavailable Cash Flow account");

    expect(safeIntegerFromText("123")).toBe(123);
    expect(safeIntegerFromText("9007199254740992")).toBe(null);
    expect(safeIntegerFromText("12.3")).toBe(null);
    expect(safeIntegerFromText(null)).toBe(null);
  });
});
