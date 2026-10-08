import "./server-only";
import { VANGUARD_MUTUAL_FUND_PRODUCTS } from "../../app/investments/market-data";

const EODHD_SEARCH_PROVIDER = "EODHD";
const SEARCH_RESULT_LIMIT = 8;
const SEARCH_TIMEOUT_MS = 4_000;
const EODHD_API_TOKEN_ENV = "ATHENA_EODHD_API_TOKEN";

export type MarketSearchInstrumentType = "mutual_fund" | "etf";

export interface MarketSearchResult {
  readonly symbol: string;
  readonly name: string;
  readonly exchange: string | null;
  readonly currency: "CAD" | "USD";
  readonly instrumentType: MarketSearchInstrumentType;
  readonly provider: string;
}

export interface MarketSearchResponse {
  readonly results: readonly MarketSearchResult[];
  readonly externalProviderConfigured: boolean;
}

interface EodhdSearchRow {
  readonly Code?: unknown;
  readonly Exchange?: unknown;
  readonly Name?: unknown;
  readonly Type?: unknown;
  readonly Currency?: unknown;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function configuredApiToken(): string | null {
  const token = process.env[EODHD_API_TOKEN_ENV]?.trim();
  return token || null;
}

function localMutualFundResults(query: string, currency: "CAD" | "USD"): readonly MarketSearchResult[] {
  if (currency !== "CAD") return [];
  const normalizedQuery = query.toLowerCase();
  return Object.entries(VANGUARD_MUTUAL_FUND_PRODUCTS)
    .filter(([symbol, product]) => symbol.toLowerCase().includes(normalizedQuery) || product.name.toLowerCase().includes(normalizedQuery))
    .map(([symbol, product]) => ({
      symbol,
      name: product.name,
      exchange: null,
      currency: "CAD",
      instrumentType: "mutual_fund",
      provider: "Vanguard Canada",
    }));
}

function externalProviderSymbol(code: string, exchange: string | null): string {
  if (code.includes(".")) return code;
  if (exchange?.toUpperCase() === "TO") return `${code}.TO`;
  return code;
}

function matchesType(providerType: string | null, instrumentType: MarketSearchInstrumentType): boolean {
  if (!providerType) return false;
  const normalized = providerType.toLowerCase();
  return instrumentType === "etf" ? normalized === "etf" : normalized.includes("fund");
}

function externalResult(row: EodhdSearchRow, instrumentType: MarketSearchInstrumentType, currency: "CAD" | "USD"): MarketSearchResult | null {
  const code = text(row.Code);
  const name = text(row.Name);
  const exchange = text(row.Exchange);
  const providerCurrency = text(row.Currency)?.toUpperCase();
  if (!code || !name || providerCurrency !== currency || !matchesType(text(row.Type), instrumentType)) return null;
  return {
    symbol: externalProviderSymbol(code, exchange),
    name,
    exchange,
    currency,
    instrumentType,
    provider: EODHD_SEARCH_PROVIDER,
  };
}

async function externalResults(
  query: string,
  instrumentType: MarketSearchInstrumentType,
  currency: "CAD" | "USD",
  token: string,
  fetchImplementation: typeof fetch,
): Promise<readonly MarketSearchResult[]> {
  const url = new URL(`https://eodhd.com/api/search/${encodeURIComponent(query)}`);
  url.searchParams.set("api_token", token);
  url.searchParams.set("fmt", "json");
  url.searchParams.set("limit", String(SEARCH_RESULT_LIMIT));
  url.searchParams.set("type", instrumentType === "etf" ? "etf" : "fund");

  let response: Response;
  try {
    response = await fetchImplementation(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
  } catch {
    return [];
  }
  if (!response.ok) return [];

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return [];
  }
  if (!Array.isArray(payload)) return [];
  return payload
    .map((row) => row && typeof row === "object" ? externalResult(row as EodhdSearchRow, instrumentType, currency) : null)
    .filter((result): result is MarketSearchResult => result !== null);
}

function uniqueResults(results: readonly MarketSearchResult[]): readonly MarketSearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = `${result.instrumentType}:${result.symbol.toUpperCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, SEARCH_RESULT_LIMIT);
}

export async function searchMarketSymbols(
  query: string,
  instrumentType: MarketSearchInstrumentType,
  currency: "CAD" | "USD",
  fetchImplementation: typeof fetch = fetch,
): Promise<MarketSearchResponse> {
  const normalizedQuery = query.trim().slice(0, 24);
  const token = configuredApiToken();
  if (normalizedQuery.length < 2) return { results: [], externalProviderConfigured: token !== null };

  const localResults = instrumentType === "mutual_fund" ? localMutualFundResults(normalizedQuery, currency) : [];
  const providerResults = token ? await externalResults(normalizedQuery, instrumentType, currency, token, fetchImplementation) : [];
  return {
    results: uniqueResults([...localResults, ...providerResults]),
    externalProviderConfigured: token !== null,
  };
}

export async function findMarketInstrument(
  symbol: string,
  instrumentType: MarketSearchInstrumentType,
  currency: "CAD" | "USD",
  fetchImplementation: typeof fetch = fetch,
): Promise<MarketSearchResult | null> {
  const normalizedSymbol = symbol.trim().toUpperCase().slice(0, 24);
  if (!normalizedSymbol) return null;

  const response = await searchMarketSymbols(normalizedSymbol, instrumentType, currency, fetchImplementation);
  return response.results.find((result) => result.symbol.toUpperCase() === normalizedSymbol) ?? null;
}
