import { getAuthenticatedUser } from "../../../../lib/server/auth-session";
import { consumeGlobalAuthRateLimit } from "../../../../lib/server/auth-rate-limit";
import { searchMarketSymbols, type MarketSearchInstrumentType } from "../../../../lib/server/market-search";

export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "private, max-age=60" };
const supportedInstrumentTypes = new Set<MarketSearchInstrumentType>(["mutual_fund", "etf"]);
const supportedCurrencies = new Set(["CAD", "USD"]);

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return jsonError("Authentication required.", 401);
    if (user.owner.isDemo) return jsonError("Symbol search is unavailable in the demo workspace.", 403);

    const allowed = await consumeGlobalAuthRateLimit(`symbol-search:${user.owner.id}`, { windowSeconds: 60, max: 30 });
    if (!allowed) return jsonError("Too many requests. Please try again later.", 429);

    const searchParams = new URL(request.url).searchParams;
    const query = searchParams.get("q")?.trim() ?? "";
    const instrumentType = searchParams.get("instrumentType");
    const currency = searchParams.get("currency");
    if (!supportedInstrumentTypes.has(instrumentType as MarketSearchInstrumentType) || !supportedCurrencies.has(currency ?? "")) {
      return jsonError("Invalid symbol search request.", 400);
    }
    if (query.length > 24) return jsonError("Invalid symbol search request.", 400);

    const result = await searchMarketSymbols(query, instrumentType as MarketSearchInstrumentType, currency as "CAD" | "USD");
    return Response.json(result, { status: 200, headers: responseHeaders });
  } catch {
    return jsonError("Symbol search unavailable.", 503);
  }
}
