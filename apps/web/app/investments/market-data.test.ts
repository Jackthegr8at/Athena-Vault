import { describe, expect, it, vi } from "vitest";
import { fetchMarketFxRate, fetchMarketQuote, MarketDataUnavailableError } from "./market-data";

function chartResponse(meta: Record<string, unknown>, closes: readonly unknown[] = []): Response {
  return new Response(JSON.stringify({ chart: { result: [{ meta, indicators: { quote: [{ close: closes }] } }] } }), { status: 200, headers: { "content-type": "application/json" } });
}

function vanguardResponse(rows: readonly [string, string][], ticker = "VIC1000", currency = "CAD"): Response {
  const tableRows = rows.map(([date, price]) => `<tr><td>${date}</td><td>${price}</td></tr>`).join("");
  return new Response(`<html><head><meta name="ticker" content="${ticker}"><meta name="currency" content="${currency}"></head><body><h5>Historical Prices</h5><table><tbody>${tableRows}</tbody></table></europe-core-historical-prices></body></html>`, { status: 200, headers: { "content-type": "text/html" } });
}

describe("investment market-data adapter", () => {
  it("parses a provider price at the requested currency and rounds to CAD/USD cents", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(chartResponse({ currency: "CAD", regularMarketPrice: 125.505 }));

    await expect(fetchMarketQuote("  XBAL.TO ", "CAD", "2026-09-08", "etf", fetchImplementation)).resolves.toMatchObject({
      effectiveOn: "2026-09-08",
      priceMinor: 12_551,
      currency: "CAD",
      provider: "Yahoo Finance",
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://query1.finance.yahoo.com/v8/finance/chart/XBAL.TO?range=1d&interval=1d",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("rejects missing, malformed, or currency-mismatched provider data without leaking details", async () => {
    const mismatch = vi.fn<typeof fetch>().mockResolvedValue(chartResponse({ currency: "USD", regularMarketPrice: 125 }));
    await expect(fetchMarketQuote("XBAL.TO", "CAD", "2026-09-08", "etf", mismatch)).rejects.toBeInstanceOf(MarketDataUnavailableError);

    const malformed = vi.fn<typeof fetch>().mockResolvedValue(chartResponse({ currency: "CAD", regularMarketPrice: "not-a-price" }));
    await expect(fetchMarketQuote("XBAL.TO", "CAD", "2026-09-08", "etf", malformed)).rejects.toMatchObject({ message: "Market data is unavailable." });

    const failed = vi.fn<typeof fetch>().mockRejectedValue(new Error("provider token should not be returned"));
    await expect(fetchMarketQuote("XBAL.TO", "CAD", "2026-09-08", "etf", failed)).rejects.toMatchObject({ message: "Market data is unavailable." });
  });

  it("tries the common Toronto suffix and accepts a fund close when the live field is absent", async () => {
    const fetchImplementation = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(chartResponse({ currency: "CAD", previousClose: 25.125 }));

    await expect(fetchMarketQuote("VEQT", "CAD", "2026-09-09", "etf", fetchImplementation)).resolves.toMatchObject({ priceMinor: 2_513 });
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      2,
      "https://query1.finance.yahoo.com/v8/finance/chart/VEQT.TO?range=1d&interval=1d",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("uses Vanguard Canada historical NAV data for supported mutual-fund codes", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(vanguardResponse([
      ["Sep 08 2026", "$13.1836"],
      ["Sep 04 2026", "$13.2882"],
    ]));

    await expect(fetchMarketQuote(" vic1000 ", "CAD", "2026-09-09", "mutual_fund", fetchImplementation)).resolves.toMatchObject({
      effectiveOn: "2026-09-08",
      priceMinor: 1_318,
      currency: "CAD",
      provider: "Vanguard Canada",
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://www.vanguard.ca/en/product/fund/asset-allocation/D004/vanguard-all-equity-etf-portfolio-fund-series-f",
      expect.objectContaining({ cache: "no-store", headers: expect.objectContaining({ Accept: "text/html" }) }),
    );
  });

  it("uses the latest Vanguard NAV on or before the requested valuation date", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(vanguardResponse([
      ["Sep 08 2026", "$13.1836"],
      ["Sep 04 2026", "$13.2882"],
    ]));

    await expect(fetchMarketQuote("VIC1000", "CAD", "2026-09-07", "mutual_fund", fetchImplementation)).resolves.toMatchObject({
      effectiveOn: "2026-09-04",
      priceMinor: 1_329,
    });
  });

  it("converts the USDCAD=X chart response to a positive fixed-point FX rate", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(chartResponse({ currency: "CAD", regularMarketPrice: 1.350001 }));

    await expect(fetchMarketFxRate("2026-09-08", fetchImplementation)).resolves.toMatchObject({
      effectiveOn: "2026-09-08",
      ratePpm: 1_350_001,
      provider: "Yahoo Finance",
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://query1.finance.yahoo.com/v8/finance/chart/USDCAD%3DX?range=1d&interval=1d",
      expect.objectContaining({ cache: "no-store" }),
    );
  });
});
