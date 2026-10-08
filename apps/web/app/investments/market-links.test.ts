import { describe, expect, it } from "vitest";
import { marketReferenceLinks } from "./market-links";

describe("investment market reference links", () => {
  it("opens Canadian ETFs directly on the Canadian Yahoo Finance quote page", () => {
    expect(marketReferenceLinks({
      symbol: "VEQT.TO",
      name: "Vanguard All-Equity ETF Portfolio",
      exchange: "TO",
      currency: "CAD",
      instrumentType: "etf",
      provider: "EODHD",
    })).toEqual([{
      label: "Yahoo Finance",
      href: "https://ca.finance.yahoo.com/quote/VEQT.TO/",
      description: "Quote, history, profile, and holdings",
    }]);
  });

  it("adds the official Vanguard product page for known mutual funds", () => {
    const links = marketReferenceLinks({
      symbol: "VIC1000",
      name: "Vanguard All-Equity ETF Portfolio Fund Series F",
      exchange: null,
      currency: "CAD",
      instrumentType: "mutual_fund",
      provider: "Vanguard Canada",
    });

    expect(links[0]).toEqual({
      label: "Vanguard Canada",
      href: "https://www.vanguard.ca/en/product/fund/asset-allocation/D004/vanguard-all-equity-etf-portfolio-fund-series-f",
      description: "Official product page and historical NAV",
    });
    expect(links[1]).toMatchObject({ label: "Yahoo Finance", href: "https://ca.finance.yahoo.com/lookup/?s=VIC1000" });
  });
});
