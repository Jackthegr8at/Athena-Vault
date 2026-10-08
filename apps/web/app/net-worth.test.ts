import { describe, expect, it } from "vitest";
import { alignNetWorthHistoryCurrentPoint, calculateLiveNetWorthBreakdown, calculateNetWorthMinor } from "./net-worth";

describe("Overview net worth source", () => {
  it("uses financial account balances plus Home equity", () => {
    expect(calculateNetWorthMinor([
      { kind: "checking", balanceMinor: 100_000, isActive: true },
      { kind: "credit", balanceMinor: 20_000, isActive: true },
      { kind: "loan", balanceMinor: 30_000, isActive: true },
      { kind: "investment", balanceMinor: 50_000, isActive: true },
    ], 400_000)).toBe(500_000);
  });

  it("treats an unconfigured Home as zero without inventing a balance", () => {
    expect(calculateNetWorthMinor([{ kind: "savings", balanceMinor: 125_000, isActive: true }], null)).toBe(125_000);
  });

  it("excludes archived accounts from Overview net worth", () => {
    expect(calculateNetWorthMinor([
      { kind: "checking", balanceMinor: 100_000, isActive: true },
      { kind: "savings", balanceMinor: 50_000, isActive: false },
    ], null)).toBe(100_000);
  });

  it("uses the live account breakdown for the Overview total", () => {
    expect(calculateLiveNetWorthBreakdown([
      { kind: "checking", balanceMinor: 5_498, isActive: true },
      { kind: "investment", balanceMinor: 201_930, isActive: true },
      { kind: "credit", balanceMinor: 2_024, isActive: true },
    ], 173_683)).toEqual({
      cashOtherMinor: 5_498,
      investmentsMinor: 201_930,
      liabilitiesMinor: 2_024,
      homeEquityMinor: 173_683,
      netWorthMinor: 379_087,
    });
  });

  it("aligns only the evaluation-date history point with the live total", () => {
    const model = {
      currency: "CAD" as const,
      evaluationDate: "2026-08-22",
      historicalFrom: "2026-08-19",
      projectedThrough: "2026-08-25",
      firstProjectedAsOf: "2026-08-22",
      selectedRange: "all" as const,
      defaultRange: "1y" as const,
      points: [
        { asOf: "2026-08-19", phase: "actual" as const, isFirstProjected: false, netWorthMinor: 379_088, investmentsMinor: 201_930, homeEquityMinor: 173_683, cashOtherMinor: 5_498 },
        { asOf: "2026-08-22", phase: "projected" as const, isFirstProjected: true, netWorthMinor: 379_088, investmentsMinor: 201_930, homeEquityMinor: 173_683, cashOtherMinor: 5_498 },
        { asOf: "2026-08-25", phase: "projected" as const, isFirstProjected: false, netWorthMinor: 379_392, investmentsMinor: 201_930, homeEquityMinor: 173_987, cashOtherMinor: 5_498 },
      ],
      changes: [],
    };
    const aligned = alignNetWorthHistoryCurrentPoint(model, {
      cashOtherMinor: 5_499,
      investmentsMinor: 201_930,
      liabilitiesMinor: 2_024,
      homeEquityMinor: 173_683,
      netWorthMinor: 379_088,
    });

    expect(aligned.points.find((point) => point.asOf === "2026-08-19")?.netWorthMinor).toBe(379_088);
    expect(aligned.points.find((point) => point.asOf === "2026-08-22")).toMatchObject({ phase: "actual", isFirstProjected: false, netWorthMinor: 379_088, cashOtherMinor: 5_499 });
    expect(aligned.firstProjectedAsOf).toBe("2026-08-25");
    expect(aligned.points.find((point) => point.asOf === "2026-08-25")?.isFirstProjected).toBe(true);
  });

  it("inserts a missing evaluation-date point in the existing chronological axis", () => {
    const model = {
      currency: "CAD" as const,
      evaluationDate: "2026-08-22",
      historicalFrom: "2026-08-19",
      projectedThrough: "2026-08-25",
      firstProjectedAsOf: "2026-08-25",
      selectedRange: "all" as const,
      defaultRange: "1y" as const,
      points: [
        { asOf: "2026-08-19", phase: "actual" as const, isFirstProjected: false, netWorthMinor: 100, investmentsMinor: 25, homeEquityMinor: 50, cashOtherMinor: 25 },
        { asOf: "2026-08-25", phase: "projected" as const, isFirstProjected: true, netWorthMinor: 100, investmentsMinor: 25, homeEquityMinor: 50, cashOtherMinor: 25 },
      ],
      changes: [],
    };
    const aligned = alignNetWorthHistoryCurrentPoint(model, {
      cashOtherMinor: 40,
      investmentsMinor: 30,
      liabilitiesMinor: 10,
      homeEquityMinor: 50,
      netWorthMinor: 110,
    });

    expect(aligned.points.map((point) => point.asOf)).toEqual(["2026-08-19", "2026-08-22", "2026-08-25"]);
    expect(aligned.points[1]).toMatchObject({ phase: "actual", netWorthMinor: 110, isFirstProjected: false });
  });

  it("rejects an unsorted source timeline", () => {
    const model = {
      currency: "CAD" as const,
      evaluationDate: "2026-08-22",
      historicalFrom: "2026-08-19",
      projectedThrough: "2026-08-25",
      firstProjectedAsOf: "2026-08-25",
      selectedRange: "all" as const,
      defaultRange: "1y" as const,
      points: [
        { asOf: "2026-08-25", phase: "projected" as const, isFirstProjected: true, netWorthMinor: 100, investmentsMinor: 25, homeEquityMinor: 50, cashOtherMinor: 25 },
        { asOf: "2026-08-19", phase: "actual" as const, isFirstProjected: false, netWorthMinor: 100, investmentsMinor: 25, homeEquityMinor: 50, cashOtherMinor: 25 },
      ],
      changes: [],
    };
    expect(() => alignNetWorthHistoryCurrentPoint(model, {
      cashOtherMinor: 25,
      investmentsMinor: 25,
      liabilitiesMinor: 0,
      homeEquityMinor: 50,
      netWorthMinor: 100,
    })).toThrow("Net-worth history points must be chronological.");
  });
});
