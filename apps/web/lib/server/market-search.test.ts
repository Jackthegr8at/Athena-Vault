import { afterEach, describe, expect, it, vi } from "vitest";
import { findMarketInstrument, searchMarketSymbols } from "./market-search";

const originalToken = process.env.ATHENA_EODHD_API_TOKEN;

afterEach(() => {
  if (originalToken === undefined) delete process.env.ATHENA_EODHD_API_TOKEN;
  else process.env.ATHENA_EODHD_API_TOKEN = originalToken;
});

describe("investment market symbol search", () => {
  it("returns local Vanguard suggestions for a partial mutual-fund code without an API token", async () => {
    delete process.env.ATHENA_EODHD_API_TOKEN;
    const fetchImplementation = vi.fn<typeof fetch>();

    await expect(searchMarketSymbols("vic10", "mutual_fund", "CAD", fetchImplementation)).resolves.toMatchObject({
      externalProviderConfigured: false,
      results: [
        { symbol: "VIC100", name: "Vanguard Global Balanced Fund Series F" },
        { symbol: "VIC1000", name: "Vanguard All-Equity ETF Portfolio Fund Series F" },
      ],
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("queries EODHD and normalizes Toronto symbols while filtering the selected type and currency", async () => {
    process.env.ATHENA_EODHD_API_TOKEN = "test-eodhd-token";
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([
      { Code: "VEQT", Exchange: "TO", Name: "Vanguard All-Equity ETF Portfolio", Type: "ETF", Currency: "CAD" },
      { Code: "VEQT", Exchange: "US", Name: "Vanguard All-Equity ETF Portfolio", Type: "ETF", Currency: "USD" },
      { Code: "VEQT", Exchange: "TO", Name: "Unexpected stock", Type: "Common Stock", Currency: "CAD" },
    ])));

    await expect(searchMarketSymbols("veqt", "etf", "CAD", fetchImplementation)).resolves.toMatchObject({
      externalProviderConfigured: true,
      results: [{ symbol: "VEQT.TO", name: "Vanguard All-Equity ETF Portfolio", exchange: "TO", currency: "CAD", instrumentType: "etf", provider: "EODHD" }],
    });
    const request = new URL(String(fetchImplementation.mock.calls[0]?.[0]));
    expect(request.pathname).toBe("/api/search/veqt");
    expect(request.searchParams.get("api_token")).toBe("test-eodhd-token");
    expect(request.searchParams.get("type")).toBe("etf");
    expect(request.searchParams.get("limit")).toBe("8");
  });

  it("keeps manual entry available when the external search provider fails", async () => {
    process.env.ATHENA_EODHD_API_TOKEN = "test-eodhd-token";
    const fetchImplementation = vi.fn<typeof fetch>().mockRejectedValue(new Error("provider unavailable"));

    await expect(searchMarketSymbols("veqt", "etf", "CAD", fetchImplementation)).resolves.toEqual({
      externalProviderConfigured: true,
      results: [],
    });
  });

  it("returns only the exact instrument requested for the verification dashboard", async () => {
    delete process.env.ATHENA_EODHD_API_TOKEN;
    await expect(findMarketInstrument("vic1000", "mutual_fund", "CAD")).resolves.toEqual({
      symbol: "VIC1000",
      name: "Vanguard All-Equity ETF Portfolio Fund Series F",
      exchange: null,
      currency: "CAD",
      instrumentType: "mutual_fund",
      provider: "Vanguard Canada",
    });
  });
});
