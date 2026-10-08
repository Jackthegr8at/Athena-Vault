import { describe, expect, it } from "vitest";
import { buildHomeTimeline } from "./home";

describe("Home timeline presentation", () => {
  it("carries the latest market value forward and calculates equity once", () => {
    const rows = buildHomeTimeline({
      home: { id: "home", name: "Home", currency: "CAD" },
      values: [
        { id: "value-1", asOf: "2026-08-05", marketValueMinor: 500_000 },
        { id: "value-2", asOf: "2026-09-02", marketValueMinor: 510_000 },
      ],
      anchors: [{ id: "anchor", asOf: "2026-08-05", principalMinor: 100_000 }],
      terms: [{
        id: "term",
        effectiveOn: "2026-08-05",
        annualRateBps: 0,
        compoundingConvention: "annual",
        paymentExpenseId: "expense",
        paymentExpenseName: "Hypo",
        paymentMinor: 3_000,
        nextPaymentOn: "2026-08-19",
        renewalOn: "2027-08-05",
        payoffOn: "2026-10-14",
      }],
      todayIso: "2026-09-16",
    });

    expect(rows.find((row) => row.asOf === "2026-08-05")).toMatchObject({ marketValueMinor: 500_000, marketValueStatus: "actual", mortgagePrincipalMinor: 100_000, mortgageStatus: "actual", equityMinor: 400_000 });
    expect(rows.find((row) => row.asOf === "2026-08-19")).toMatchObject({ marketValueMinor: 500_000, marketValueStatus: "projected", mortgagePrincipalMinor: 97_000, mortgageStatus: "projected", equityMinor: 403_000 });
    expect(rows.find((row) => row.asOf === "2026-09-02")).toMatchObject({ marketValueMinor: 510_000, marketValueStatus: "actual", mortgagePrincipalMinor: 94_000, equityMinor: 416_000 });
  });

  it("does not invent mortgage equity while a configured mortgage has no confirmed anchor", () => {
    const rows = buildHomeTimeline({
      home: { id: "home", name: "Home", currency: "CAD" },
      values: [{ id: "value", asOf: "2026-08-05", marketValueMinor: 500_000 }],
      anchors: [],
      terms: [{
        id: "term",
        effectiveOn: "2026-08-05",
        annualRateBps: 0,
        compoundingConvention: "canadian_semi_annual",
        paymentExpenseId: "expense",
        paymentExpenseName: "Hypo",
        paymentMinor: 3_000,
        nextPaymentOn: "2026-08-19",
        renewalOn: "2027-08-05",
        payoffOn: "2027-08-05",
      }],
      todayIso: "2026-08-19",
    });
    expect(rows.every((row) => row.equityMinor === null)).toBe(true);
  });

  it("carries the confirmed mortgage balance across a non-payment axis date", () => {
    const rows = buildHomeTimeline({
      home: { id: "home", name: "Home", currency: "CAD" },
      values: [{ id: "value", asOf: "2026-07-28", marketValueMinor: 40_000_000 }],
      anchors: [{ id: "anchor", asOf: "2026-07-28", principalMinor: 22_661_969 }],
      terms: [{
        id: "term",
        effectiveOn: "2026-07-28",
        annualRateBps: 394,
        compoundingConvention: "canadian_semi_annual",
        paymentExpenseId: "expense",
        paymentExpenseName: "Hypo",
        paymentMinor: 64_252,
        nextPaymentOn: "2026-08-11",
        renewalOn: "2028-11-14",
        payoffOn: "2028-11-14",
      }],
      todayIso: "2026-08-06",
    });

    expect(rows.find((row) => row.asOf === "2026-08-06")).toMatchObject({
      marketValueMinor: 40_000_000,
      mortgagePrincipalMinor: 22_661_969,
      mortgageStatus: "actual",
      paymentMinor: 0,
      interestMinor: 0,
      principalPortionMinor: 0,
      equityMinor: 17_338_031,
    });
  });

  it("treats a Home with no mortgage terms as full property equity", () => {
    const rows = buildHomeTimeline({
      home: { id: "home", name: "Home", currency: "CAD" },
      values: [{ id: "value", asOf: "2026-08-05", marketValueMinor: 500_000 }],
      anchors: [],
      terms: [],
      todayIso: "2026-08-19",
    });
    expect(rows.find((row) => row.asOf === "2026-08-19")).toMatchObject({ marketValueMinor: 500_000, equityMinor: 500_000 });
  });
  it("preserves the forecast slice when a preloaded timeline was built through a later horizon", () => {
    const input = {
      home: { id: "home", name: "Home", currency: "CAD" as const },
      values: [{ id: "value", asOf: "2026-08-05", marketValueMinor: 500_000 }],
      anchors: [{ id: "anchor", asOf: "2026-08-05", principalMinor: 100_000 }],
      terms: [{
        id: "term",
        effectiveOn: "2026-08-05",
        annualRateBps: 0,
        compoundingConvention: "annual" as const,
        paymentExpenseId: "expense",
        paymentExpenseName: "Hypo",
        paymentMinor: 3_000,
        nextPaymentOn: "2026-08-19",
        renewalOn: "2027-08-05",
        payoffOn: "2027-08-05",
      }],
    };
    const forecastThrough = "2026-10-14";
    const preloadedTimeline = buildHomeTimeline({ ...input, todayIso: "2027-01-01" });
    const rebuiltTimeline = buildHomeTimeline({ ...input, todayIso: forecastThrough });

    expect(preloadedTimeline.filter((row) => row.asOf <= forecastThrough)).toEqual(
      rebuiltTimeline.filter((row) => row.asOf <= forecastThrough),
    );
  });
});
