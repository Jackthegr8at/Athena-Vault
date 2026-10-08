import { VANGUARD_MUTUAL_FUND_PRODUCTS } from "./market-data";
import type { MarketSearchResult } from "../../lib/server/market-search";

export interface MarketReferenceLink {
  readonly label: string;
  readonly href: string;
  readonly description: string;
}

function yahooFinanceHost(currency: "CAD" | "USD"): string {
  return currency === "CAD" ? "https://ca.finance.yahoo.com" : "https://finance.yahoo.com";
}

function yahooFinanceLink(instrument: MarketSearchResult): MarketReferenceLink {
  const host = yahooFinanceHost(instrument.currency);
  const symbol = encodeURIComponent(instrument.symbol);
  const exchangeListed = instrument.instrumentType === "etf" || instrument.exchange !== null;
  return {
    label: "Yahoo Finance",
    href: exchangeListed ? `${host}/quote/${symbol}/` : `${host}/lookup/?s=${symbol}`,
    description: exchangeListed ? "Quote, history, profile, and holdings" : "Search this fund code and related market data",
  };
}

export function marketReferenceLinks(instrument: MarketSearchResult): readonly MarketReferenceLink[] {
  const links: MarketReferenceLink[] = [yahooFinanceLink(instrument)];
  const vanguardProduct = instrument.instrumentType === "mutual_fund"
    ? VANGUARD_MUTUAL_FUND_PRODUCTS?.[instrument.symbol.toUpperCase()]
    : undefined;
  if (vanguardProduct) {
    links.unshift({
      label: "Vanguard Canada",
      href: vanguardProduct.url,
      description: "Official product page and historical NAV",
    });
  }
  return links;
}
