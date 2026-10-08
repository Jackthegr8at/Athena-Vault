import { describe, expect, it } from "vitest";
import {
  calculateInvestmentHoldingValuation,
  INVESTMENT_HOLDING_UNIT_SCALE,
  roundHalfUpDivide,
  summarizeInvestmentHoldingValuations,
} from "../src/investment-holdings";

const units = (whole: number) => whole * Number(INVESTMENT_HOLDING_UNIT_SCALE);

function referenceLatest<T extends { readonly id: string; readonly effectiveOn: string; readonly source: "manual" | "market" }>(rows: readonly T[], asOf: string): T | null {
  let selected: T | null = null;
  for (const row of rows) {
    if (row.effectiveOn > asOf) continue;
    if (!selected || row.effectiveOn > selected.effectiveOn
      || (row.effectiveOn === selected.effectiveOn && (row.source === "manual" ? 1 : 0) > (selected.source === "manual" ? 1 : 0))
      || (row.effectiveOn === selected.effectiveOn && row.source === selected.source && row.id > selected.id)) {
      selected = row;
    }
  }
  return selected;
}

describe("investment holdings calculations", () => {
  it("replays opening, buys, sells, distributions, and fees with weighted-average cost", () => {
    const valuation = calculateInvestmentHoldingValuation({
      currency: "CAD",
      valuationOn: "2026-09-08",
      transactions: [
        { id: "opening", occurredOn: "2026-01-01", kind: "opening", unitsMicros: units(10), amountMinor: 10_000, feeMinor: 0 },
        { id: "buy", occurredOn: "2026-02-01", kind: "buy", unitsMicros: units(5), amountMinor: 6_000, feeMinor: 100 },
        { id: "sell", occurredOn: "2026-03-01", kind: "sell", unitsMicros: units(3), amountMinor: 4_000, feeMinor: 50 },
        { id: "distribution", occurredOn: "2026-04-01", kind: "distribution", unitsMicros: 0, amountMinor: 200, feeMinor: 0 },
        { id: "fee", occurredOn: "2026-05-01", kind: "fee", unitsMicros: 0, amountMinor: 75, feeMinor: 0 },
      ],
      prices: [{ id: "price", effectiveOn: "2026-09-08", priceMinor: 1_200, source: "manual" }],
    });

    expect(valuation.unitsMicros).toBe(units(12));
    expect(valuation.costBasisMinor).toBe(12_880);
    expect(valuation.averageCostMinor).toBe(1_073);
    expect(valuation.purchasesMinor).toBe(16_100);
    expect(valuation.salesMinor).toBe(4_000);
    expect(valuation.distributionsMinor).toBe(200);
    expect(valuation.feesMinor).toBe(225);
    expect(valuation.marketValueMinor).toBe(14_400);
    expect(valuation.unrealizedChangeMinor).toBe(1_520);
    expect(valuation.cadMarketValueMinor).toBe(14_400);
  });

  it("rejects a sell that would make units negative", () => {
    expect(() => calculateInvestmentHoldingValuation({
      currency: "CAD",
      valuationOn: "2026-09-08",
      transactions: [{ id: "sell", occurredOn: "2026-01-01", kind: "sell", unitsMicros: units(1), amountMinor: 100, feeMinor: 0 }],
      prices: [],
    })).toThrow("Cannot sell more units than are available.");
  });

  it("rejects transaction shapes that cannot represent a valid ledger entry", () => {
    expect(() => calculateInvestmentHoldingValuation({
      currency: "CAD",
      valuationOn: "2026-09-08",
      transactions: [{ id: "distribution", occurredOn: "2026-01-01", kind: "distribution", unitsMicros: units(1), amountMinor: 100, feeMinor: 0 }],
      prices: [],
    })).toThrow("Distribution entries require zero units and a positive amount.");
  });

  it("keeps zero opening cost and zero market value distinct from unavailable values", () => {
    const zeroPrice = calculateInvestmentHoldingValuation({
      currency: "CAD",
      valuationOn: "2026-09-08",
      transactions: [{ id: "opening", occurredOn: "2026-01-01", kind: "opening", unitsMicros: units(2), amountMinor: 0, feeMinor: 0 }],
      prices: [{ id: "zero", effectiveOn: "2026-09-08", priceMinor: 0, source: "manual" }],
    });
    const noPrice = calculateInvestmentHoldingValuation({
      currency: "CAD",
      valuationOn: "2026-09-08",
      transactions: [{ id: "opening", occurredOn: "2026-01-01", kind: "opening", unitsMicros: units(2), amountMinor: 0, feeMinor: 0 }],
      prices: [],
    });

    expect(zeroPrice.marketValueMinor).toBe(0);
    expect(zeroPrice.unrealizedChangeMinor).toBe(0);
    expect(noPrice.marketValueMinor).toBeNull();
    expect(noPrice.unrealizedChangeMinor).toBeNull();
  });

  it("values an empty position at zero without requiring a quote", () => {
    const valuation = calculateInvestmentHoldingValuation({
      currency: "CAD",
      valuationOn: "2026-09-08",
      transactions: [],
      prices: [],
    });

    expect(valuation.unitsMicros).toBe(0);
    expect(valuation.marketValueMinor).toBe(0);
    expect(valuation.unrealizedChangeMinor).toBe(0);
    expect(valuation.cadMarketValueMinor).toBe(0);
  });

  it("prefers a manual quote over a market quote on the same date and converts USD", () => {
    const valuation = calculateInvestmentHoldingValuation({
      currency: "USD",
      valuationOn: "2026-09-08",
      transactions: [{ id: "opening", occurredOn: "2026-01-01", kind: "opening", unitsMicros: units(1), amountMinor: 10_000, feeMinor: 0 }],
      prices: [
        { id: "market", effectiveOn: "2026-09-08", priceMinor: 1_300, source: "market" },
        { id: "manual", effectiveOn: "2026-09-08", priceMinor: 1_200, source: "manual" },
      ],
      fxRates: [{ id: "fx", baseCurrency: "USD", quoteCurrency: "CAD", effectiveOn: "2026-09-08", ratePpm: 1_350_000, source: "market" }],
    });

    expect(valuation.price?.id).toBe("manual");
    expect(valuation.marketValueMinor).toBe(1_200);
    expect(valuation.cadMarketValueMinor).toBe(1_620);
    expect(valuation.cadCostBasisMinor).toBe(13_500);
    expect(valuation.cadUnrealizedChangeMinor).toBe(-11_880);
  });
  it("matches the reference latest-row scan for unsorted, tied, and boundary quotes", () => {
    const prices = [
      { id: "future", effectiveOn: "2026-09-09", priceMinor: 1_500, source: "market" as const },
      { id: "market-z", effectiveOn: "2026-09-08", priceMinor: 1_300, source: "market" as const },
      { id: "before", effectiveOn: "2026-01-01", priceMinor: 900, source: "market" as const },
      { id: "manual-b", effectiveOn: "2026-09-08", priceMinor: 1_200, source: "manual" as const },
      { id: "market-a", effectiveOn: "2026-09-08", priceMinor: 1_000, source: "market" as const },
      { id: "manual-b", effectiveOn: "2026-09-08", priceMinor: 999, source: "manual" as const },
    ];
    const fxRates = [
      { id: "future-fx", baseCurrency: "USD" as const, quoteCurrency: "CAD" as const, effectiveOn: "2026-09-09", ratePpm: 1_500_000, source: "market" as const },
      { id: "fx-z", baseCurrency: "USD" as const, quoteCurrency: "CAD" as const, effectiveOn: "2026-09-08", ratePpm: 1_350_000, source: "market" as const },
      { id: "fx-a", baseCurrency: "USD" as const, quoteCurrency: "CAD" as const, effectiveOn: "2026-09-08", ratePpm: 1_250_000, source: "market" as const },
      { id: "fx-before", baseCurrency: "USD" as const, quoteCurrency: "CAD" as const, effectiveOn: "2026-01-01", ratePpm: 1_100_000, source: "market" as const },
    ];
    const valuation = calculateInvestmentHoldingValuation({
      currency: "USD",
      valuationOn: "2026-09-08",
      transactions: [{ id: "opening", occurredOn: "2026-01-01", kind: "opening", unitsMicros: units(1), amountMinor: 10_000, feeMinor: 0 }],
      prices,
      fxRates,
    });

    expect(valuation.price).toEqual(referenceLatest(prices, "2026-09-08"));
    expect(valuation.fxRate).toEqual(referenceLatest(fxRates, "2026-09-08"));
    const beforeFirst = calculateInvestmentHoldingValuation({
      currency: "USD",
      valuationOn: "2025-12-31",
      transactions: [{ id: "opening", occurredOn: "2026-01-01", kind: "opening", unitsMicros: units(1), amountMinor: 10_000, feeMinor: 0 }],
      prices,
      fxRates,
    });
    expect(beforeFirst.price).toBeNull();
    expect(beforeFirst.fxRate).toBeNull();
    expect(referenceLatest(prices, "2025-12-31")).toBeNull();
    expect(referenceLatest(fxRates, "2025-12-31")).toBeNull();

    const afterLast = calculateInvestmentHoldingValuation({
      currency: "USD",
      valuationOn: "2026-09-30",
      transactions: [{ id: "opening", occurredOn: "2026-01-01", kind: "opening", unitsMicros: units(1), amountMinor: 10_000, feeMinor: 0 }],
      prices,
      fxRates,
    });
    expect(afterLast.price).toEqual(referenceLatest(prices, "2026-09-30"));
    expect(afterLast.fxRate).toEqual(referenceLatest(fxRates, "2026-09-30"));
    expect(afterLast.price?.id).toBe("future");
    expect(afterLast.fxRate?.id).toBe("future-fx");

    const emptyRows = calculateInvestmentHoldingValuation({
      currency: "USD",
      valuationOn: "2026-09-08",
      transactions: [],
      prices: [],
      fxRates: [],
    });
    expect(emptyRows.price).toBeNull();
    expect(emptyRows.fxRate).toBeNull();
  });


  it("keeps USD CAD totals unavailable when a USD position lacks an FX rate", () => {
    const valuation = calculateInvestmentHoldingValuation({
      currency: "USD",
      valuationOn: "2026-09-08",
      transactions: [{ id: "opening", occurredOn: "2026-01-01", kind: "opening", unitsMicros: units(1), amountMinor: 1_000, feeMinor: 0 }],
      prices: [{ id: "price", effectiveOn: "2026-09-08", priceMinor: 1_100, source: "market" }],
      fxRates: [],
    });
    const summary = summarizeInvestmentHoldingValuations([{ currency: "USD", valuation }]);

    expect(valuation.marketValueMinor).toBe(1_100);
    expect(valuation.cadMarketValueMinor).toBeNull();
    expect(summary.nativeTotals.USD.marketValueMinor).toBe(1_100);
    expect(summary.cadMarketValueMinor).toBeNull();
  });

  it("does not include transactions dated after the valuation date", () => {
    const valuation = calculateInvestmentHoldingValuation({
      currency: "CAD",
      valuationOn: "2026-09-08",
      transactions: [
        { id: "opening", occurredOn: "2026-09-01", kind: "opening", unitsMicros: units(1), amountMinor: 10_000, feeMinor: 0 },
        { id: "future-buy", occurredOn: "2026-09-09", kind: "buy", unitsMicros: units(2), amountMinor: 20_000, feeMinor: 0 },
      ],
      prices: [],
    });
    expect(valuation.unitsMicros).toBe(units(1));
    expect(valuation.costBasisMinor).toBe(10_000);
  });

  it("rounds fixed-point division half up", () => {
    expect(roundHalfUpDivide(5n, 2n)).toBe(3n);
    expect(roundHalfUpDivide(4n, 2n)).toBe(2n);
  });
});
