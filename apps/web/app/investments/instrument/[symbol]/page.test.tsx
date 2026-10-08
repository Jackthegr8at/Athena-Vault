import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  toTorontoDateIso: vi.fn(() => "2026-09-09"),
  getAuthenticatedUser: vi.fn(async () => ({ owner: { isDemo: false }, twoFactorEnabled: true })),
  requireMfaEnrolledUser: vi.fn(),
  findMarketInstrument: vi.fn(),
  fetchMarketQuote: vi.fn(),
}));

vi.mock("@athena/database", () => ({ toTorontoDateIso: mocks.toTorontoDateIso }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("../../../components/module-page", () => ({ ModulePage: ({ children }: { readonly children: React.ReactNode }) => children }));
vi.mock("../../../../lib/server/auth-session", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser, requireMfaEnrolledUser: mocks.requireMfaEnrolledUser }));
vi.mock("../../../../lib/server/market-search", () => ({ findMarketInstrument: mocks.findMarketInstrument }));
vi.mock("../../market-data", () => ({ fetchMarketQuote: mocks.fetchMarketQuote, VANGUARD_MUTUAL_FUND_PRODUCTS: {} }));

import InstrumentDashboardPage from "./page";

const instrument = {
  symbol: "VEQT.TO",
  name: "Vanguard All-Equity ETF Portfolio",
  exchange: "TO",
  currency: "CAD" as const,
  instrumentType: "etf" as const,
  provider: "EODHD",
};

describe("investment instrument verification dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMarketInstrument.mockResolvedValue(instrument);
    mocks.fetchMarketQuote.mockResolvedValue({
      effectiveOn: "2026-09-09",
      priceMinor: 1_318,
      currency: "CAD",
      provider: "Yahoo Finance",
      quotedAt: new Date("2026-09-09T15:00:00.000Z"),
    });
  });

  it("renders verified instrument metadata, a quote, and a prefilled add-position action", async () => {
    const page = await InstrumentDashboardPage({
      params: Promise.resolve({ symbol: "VEQT.TO" }),
      searchParams: Promise.resolve({ instrumentType: "etf", currency: "CAD" }),
    });
    const pageElement = page as React.ReactElement<{ readonly mainClassName: string }>;
    const html = renderToStaticMarkup(pageElement);

    expect(mocks.findMarketInstrument).toHaveBeenCalledWith("VEQT.TO", "etf", "CAD");
    expect(mocks.fetchMarketQuote).toHaveBeenCalledWith("VEQT.TO", "CAD", "2026-09-09", "etf");
    expect(html).toContain("Instrument check");
    expect(pageElement.props.mainClassName).toBe("instrument-page-main editorial-page-art");
    expect(html).toContain("investment-instrument-identity-hero");
    expect(html).toContain("investment-instrument-overview-grid");
    expect(html).toContain("investment-instrument-details");
    expect(html).toContain("investment-instrument-lower-grid");
    expect(html).toContain("investment-instrument-external-link-icon");
    expect(html).toContain("Vanguard All-Equity ETF Portfolio");
    expect(html).toContain("FNB / ETF");
    expect(html).toContain("$13.18");
    expect(html).toContain("Read-only verification view");
    expect(html).toContain("Review market information");
    expect(html).toContain("Yahoo Finance");
    expect(html).toContain("https://ca.finance.yahoo.com/quote/VEQT.TO/");
    expect(html).toContain('target="_blank"');
    expect(html).toContain("/investments?symbol=VEQT.TO");
  });

  it("keeps the dashboard safe and useful when the exact instrument cannot be confirmed", async () => {
    mocks.findMarketInstrument.mockResolvedValueOnce(null);

    const page = await InstrumentDashboardPage({
      params: Promise.resolve({ symbol: "VEQT.TO" }),
      searchParams: Promise.resolve({ instrumentType: "etf", currency: "CAD" }),
    });
    const html = renderToStaticMarkup(page as React.ReactElement);

    expect(html).toContain("Instrument details unavailable");
    expect(html).toContain("No matching instrument details were returned");
    expect(html).not.toContain("Use this instrument in your holdings");
  });
});
