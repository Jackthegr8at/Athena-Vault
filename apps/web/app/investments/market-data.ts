const QUOTE_TIMEOUT_MS = 5_000;
const YAHOO_QUOTE_PROVIDER = "Yahoo Finance";
const VANGUARD_QUOTE_PROVIDER = "Vanguard Canada";

export type MarketInstrumentType = "mutual_fund" | "etf";

// Vanguard's Canadian F-series mutual funds use fund codes rather than
// exchange tickers. Keep the supported product URLs explicit so a user-entered
// symbol cannot turn the adapter into an arbitrary URL fetcher. The same small
// catalog is also used for local symbol-search suggestions when no external
// search provider is configured.
export const VANGUARD_MUTUAL_FUND_PRODUCTS: Readonly<Record<string, { readonly name: string; readonly url: string }>> = {
  VIC100: { name: "Vanguard Global Balanced Fund Series F", url: "https://www.vanguard.ca/en/product/fund/asset-allocation/9864/vanguard-global-balanced-fund-series-f" },
  VIC200: { name: "Vanguard Global Dividend Fund Series F", url: "https://www.vanguard.ca/en/product/fund/equity/9865/vanguard-global-dividend-fund-series-f" },
  VIC300: { name: "Vanguard Windsor US Value Fund Series F", url: "https://www.vanguard.ca/en/product/fund/equity/9867/vanguard-windsor-us-value-fund-series-f" },
  VIC400: { name: "Vanguard International Growth Fund Series F", url: "https://www.vanguard.ca/en/product/fund/equity/9896/vanguard-international-growth-fund-series-f" },
  VIC500: { name: "Vanguard Global Credit Bond Fund Series F", url: "https://www.vanguard.ca/en/product/fund/fixed-income/D002/vanguard-global-credit-bond-fund-series-f" },
  VIC600: { name: "Vanguard Global Equity Fund Series F", url: "https://www.vanguard.ca/en/product/fund/equity/D001/vanguard-global-equity-fund-series-f" },
  VIC4060: { name: "Vanguard Conservative ETF Portfolio Fund Series F", url: "https://www.vanguard.ca/en/product/fund/asset-allocation/D007/vanguard-conservative-etf-portfolio-fund-series-f" },
  VIC6040: { name: "Vanguard Balanced ETF Portfolio Fund Series F", url: "https://www.vanguard.ca/en/product/fund/asset-allocation/D006/vanguard-balanced-etf-portfolio-fund-series-f" },
  VIC8020: { name: "Vanguard Growth ETF Portfolio Fund Series F", url: "https://www.vanguard.ca/en/product/fund/asset-allocation/D005/vanguard-growth-etf-portfolio-fund-series-f" },
  VIC1000: { name: "Vanguard All-Equity ETF Portfolio Fund Series F", url: "https://www.vanguard.ca/en/product/fund/asset-allocation/D004/vanguard-all-equity-etf-portfolio-fund-series-f" },
};

export interface MarketQuote {
  readonly effectiveOn: string;
  readonly priceMinor: number;
  readonly currency: "CAD" | "USD";
  readonly provider: string;
  readonly quotedAt: Date;
}

export interface MarketFxRate {
  readonly effectiveOn: string;
  readonly ratePpm: number;
  readonly provider: string;
  readonly quotedAt: Date;
}

export class MarketDataUnavailableError extends Error {
  constructor() {
    super("Market data is unavailable.");
    this.name = "MarketDataUnavailableError";
  }
}

function decimalTextToScaledInteger(value: string, scale: number): number {
  const text = value.trim().replace(/^\$/, "").replace(/,/g, "");
  const match = text.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) throw new MarketDataUnavailableError();
  const whole = BigInt(match[1] ?? "0");
  const fraction = match[2] ?? "";
  const scaleDigits = String(scale).length - 1;
  const kept = fraction.slice(0, scaleDigits).padEnd(scaleDigits, "0");
  const nextDigit = fraction[scaleDigits] ?? "0";
  let scaled = whole * BigInt(scale) + BigInt(kept || "0");
  if (nextDigit >= "5") scaled += 1n;
  if (scaled > BigInt(Number.MAX_SAFE_INTEGER)) throw new MarketDataUnavailableError();
  const result = Number(scaled);
  if (!Number.isSafeInteger(result)) throw new MarketDataUnavailableError();
  return result;
}

function decimalToScaledInteger(value: unknown, scale: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new MarketDataUnavailableError();
  return decimalTextToScaledInteger(String(value), scale);
}

interface MarketChartData {
  readonly meta: Record<string, unknown>;
  readonly closes: readonly unknown[];
}

function chartData(payload: unknown): MarketChartData {
  if (!payload || typeof payload !== "object") throw new MarketDataUnavailableError();
  const chart = (payload as { readonly chart?: unknown }).chart;
  if (!chart || typeof chart !== "object") throw new MarketDataUnavailableError();
  const result = (chart as { readonly result?: unknown }).result;
  if (!Array.isArray(result) || !result[0] || typeof result[0] !== "object") throw new MarketDataUnavailableError();
  const chartResult = result[0] as { readonly meta?: unknown; readonly indicators?: unknown };
  const meta = chartResult.meta;
  if (!meta || typeof meta !== "object") throw new MarketDataUnavailableError();
  const indicators = chartResult.indicators;
  const quote = indicators && typeof indicators === "object" && Array.isArray((indicators as { readonly quote?: unknown }).quote)
    ? (indicators as { readonly quote: readonly unknown[] }).quote[0]
    : null;
  const closes = quote && typeof quote === "object" && Array.isArray((quote as { readonly close?: unknown }).close)
    ? (quote as { readonly close: readonly unknown[] }).close
    : [];
  return { meta: meta as Record<string, unknown>, closes };
}

async function fetchChart(symbol: string, fetchImplementation: typeof fetch): Promise<MarketChartData> {
  let response: Response;
  try {
    response = await fetchImplementation(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`, {
      cache: "no-store",
      headers: { "User-Agent": "Athena Vault market data" },
      signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS),
    });
  } catch {
    throw new MarketDataUnavailableError();
  }
  if (!response.ok) throw new MarketDataUnavailableError();
  try {
    return chartData(await response.json());
  } catch {
    throw new MarketDataUnavailableError();
  }
}

function scaledProviderValue(candidates: readonly unknown[], scale: number): number {
  for (const candidate of candidates) {
    try {
      return decimalToScaledInteger(candidate, scale);
    } catch {
      // Try the next provider field or the latest chart close.
    }
  }
  throw new MarketDataUnavailableError();
}

function marketSymbolCandidates(symbol: string, currency: "CAD" | "USD"): readonly string[] {
  if (currency === "CAD" && /^[A-Za-z0-9]+$/.test(symbol)) return [symbol, `${symbol}.TO`];
  return [symbol];
}

function metaContent(html: string, name: string): string | null {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const tagName = tag.match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1];
    if (tagName?.toLowerCase() !== name.toLowerCase()) continue;
    return tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1]?.trim() ?? null;
  }
  return null;
}

function htmlText(fragment: string): string {
  return fragment
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function vanguardDateToIso(value: string): string | null {
  const months: Readonly<Record<string, string>> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const match = value.trim().match(/^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})$/);
  if (!match) return null;
  const month = months[match[1]?.toLowerCase() ?? ""];
  const dayNumber = Number(match[2]);
  const yearNumber = Number(match[3]);
  if (!month || !Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 31 || !Number.isInteger(yearNumber)) return null;
  const iso = `${yearNumber}-${month}-${String(dayNumber).padStart(2, "0")}`;
  const date = new Date(`${iso}T00:00:00.000Z`);
  return date.toISOString().slice(0, 10) === iso ? iso : null;
}

interface VanguardNav {
  readonly effectiveOn: string;
  readonly priceMinor: number;
}

function vanguardHistoricalNavs(html: string): readonly VanguardNav[] {
  const heading = /<h[1-6]\b[^>]*>\s*Historical Prices\s*<\/h[1-6]>/i.exec(html);
  if (!heading) throw new MarketDataUnavailableError();
  const sectionEnd = html.indexOf("</europe-core-historical-prices", heading.index);
  const section = html.slice(heading.index, sectionEnd >= 0 ? sectionEnd : undefined);
  const rows: VanguardNav[] = [];
  for (const rowMatch of section.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = rowMatch[1];
    if (!rowHtml) continue;
    const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
    const dateText = cells[0]?.[1];
    const priceText = cells[1]?.[1];
    if (!dateText || !priceText) continue;
    const effectiveOn = vanguardDateToIso(htmlText(dateText));
    if (!effectiveOn) continue;
    let priceMinor: number;
    try {
      priceMinor = decimalTextToScaledInteger(htmlText(priceText), 100);
    } catch {
      continue;
    }
    rows.push({ effectiveOn, priceMinor });
  }
  if (rows.length === 0) throw new MarketDataUnavailableError();
  return rows;
}

function vanguardProductUrl(symbol: string): string | null {
  if (!/^VIC\d+$/i.test(symbol)) return null;
  return VANGUARD_MUTUAL_FUND_PRODUCTS[symbol.toUpperCase()]?.url ?? null;
}

async function fetchVanguardQuote(
  symbol: string,
  currency: "CAD" | "USD",
  effectiveOn: string,
  fetchImplementation: typeof fetch,
): Promise<MarketQuote> {
  const url = vanguardProductUrl(symbol);
  if (!url) throw new MarketDataUnavailableError();

  let response: Response;
  try {
    response = await fetchImplementation(url, {
      cache: "no-store",
      headers: { Accept: "text/html", "User-Agent": "Athena Vault market data" },
      signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS),
    });
  } catch {
    throw new MarketDataUnavailableError();
  }
  if (!response.ok) throw new MarketDataUnavailableError();

  let html: string;
  try {
    html = await response.text();
  } catch {
    throw new MarketDataUnavailableError();
  }
  const pageSymbol = metaContent(html, "ticker")?.toUpperCase();
  const pageCurrency = metaContent(html, "currency")?.toUpperCase();
  if (pageSymbol !== symbol.toUpperCase() || pageCurrency !== currency) throw new MarketDataUnavailableError();

  const applicable = vanguardHistoricalNavs(html)
    .filter((nav) => nav.effectiveOn <= effectiveOn)
    .sort((left, right) => right.effectiveOn.localeCompare(left.effectiveOn));
  const nav = applicable[0];
  if (!nav) throw new MarketDataUnavailableError();
  return {
    effectiveOn: nav.effectiveOn,
    priceMinor: nav.priceMinor,
    currency,
    provider: VANGUARD_QUOTE_PROVIDER,
    quotedAt: new Date(),
  };
}

export async function fetchMarketQuote(
  symbol: string,
  currency: "CAD" | "USD",
  effectiveOn: string,
  instrumentType: MarketInstrumentType,
  fetchImplementation: typeof fetch = fetch,
): Promise<MarketQuote> {
  const normalizedSymbol = symbol.trim();
  if (!normalizedSymbol) throw new MarketDataUnavailableError();

  if (instrumentType === "mutual_fund" && vanguardProductUrl(normalizedSymbol)) {
    try {
      return await fetchVanguardQuote(normalizedSymbol, currency, effectiveOn, fetchImplementation);
    } catch (error) {
      if (!(error instanceof MarketDataUnavailableError)) throw error;
    }
  }

  for (const providerSymbol of marketSymbolCandidates(normalizedSymbol, currency)) {
    try {
      const chart = await fetchChart(providerSymbol, fetchImplementation);
      if (chart.meta.currency !== currency) throw new MarketDataUnavailableError();
      return {
        effectiveOn,
        priceMinor: scaledProviderValue([
          chart.meta.regularMarketPrice,
          chart.meta.regularMarketPreviousClose,
          chart.meta.previousClose,
          chart.meta.chartPreviousClose,
          ...[...chart.closes].reverse(),
        ], 100),
        currency,
        provider: YAHOO_QUOTE_PROVIDER,
        quotedAt: new Date(),
      };
    } catch (error) {
      if (!(error instanceof MarketDataUnavailableError)) throw error;
    }
  }
  throw new MarketDataUnavailableError();
}

export async function fetchMarketFxRate(
  effectiveOn: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<MarketFxRate> {
  // Yahoo's direct USD/CAD cross avoids inverting CAD/USD with floating-point
  // arithmetic in the financial path.
  const chart = await fetchChart("USDCAD=X", fetchImplementation);
  if (chart.meta.currency !== "CAD") throw new MarketDataUnavailableError();
  return {
    effectiveOn,
    ratePpm: scaledProviderValue([
      chart.meta.regularMarketPrice,
      chart.meta.regularMarketPreviousClose,
      chart.meta.previousClose,
      chart.meta.chartPreviousClose,
      ...[...chart.closes].reverse(),
    ], 1_000_000),
    provider: YAHOO_QUOTE_PROVIDER,
    quotedAt: new Date(),
  };
}
