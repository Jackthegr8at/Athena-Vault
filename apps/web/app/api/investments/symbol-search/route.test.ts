import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  consumeGlobalAuthRateLimit: vi.fn(),
  searchMarketSymbols: vi.fn(),
}));

vi.mock("../../../../lib/server/auth-session", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("../../../../lib/server/auth-rate-limit", () => ({ consumeGlobalAuthRateLimit: mocks.consumeGlobalAuthRateLimit }));
vi.mock("../../../../lib/server/market-search", () => ({ searchMarketSymbols: mocks.searchMarketSymbols }));

import { GET } from "./route";

describe("investment symbol search route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUser.mockResolvedValue({ owner: { id: "owner-1", isDemo: false } });
    mocks.consumeGlobalAuthRateLimit.mockResolvedValue(true);
    mocks.searchMarketSymbols.mockResolvedValue({
      externalProviderConfigured: true,
      results: [{ symbol: "VEQT.TO", name: "Vanguard All-Equity ETF Portfolio", exchange: "TO", currency: "CAD", instrumentType: "etf", provider: "EODHD" }],
    });
  });

  it("requires authentication and returns the filtered suggestions", async () => {
    const response = await GET(new Request("https://vault.example.test/api/investments/symbol-search?q=veqt&instrumentType=etf&currency=CAD"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, max-age=60");
    await expect(response.json()).resolves.toMatchObject({ results: [{ symbol: "VEQT.TO" }] });
    expect(mocks.searchMarketSymbols).toHaveBeenCalledWith("veqt", "etf", "CAD");
  });

  it("does not expose search results to unauthenticated callers", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);

    const response = await GET(new Request("https://vault.example.test/api/investments/symbol-search?q=veqt&instrumentType=etf&currency=CAD"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Authentication required." });
    expect(mocks.searchMarketSymbols).not.toHaveBeenCalled();
  });

  it("denies demo owners before searching", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ owner: { id: "owner-demo", isDemo: true } });

    const response = await GET(new Request("https://vault.example.test/api/investments/symbol-search?q=veqt&instrumentType=etf&currency=CAD"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Symbol search is unavailable in the demo workspace." });
    expect(mocks.consumeGlobalAuthRateLimit).not.toHaveBeenCalled();
    expect(mocks.searchMarketSymbols).not.toHaveBeenCalled();
  });

  it("returns 429 when the owner rate limit is exhausted", async () => {
    mocks.consumeGlobalAuthRateLimit.mockResolvedValue(false);

    const response = await GET(new Request("https://vault.example.test/api/investments/symbol-search?q=veqt&instrumentType=etf&currency=CAD"));

    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.consumeGlobalAuthRateLimit).toHaveBeenCalledWith("symbol-search:owner-1", { windowSeconds: 60, max: 30 });
    expect(mocks.searchMarketSymbols).not.toHaveBeenCalled();
  });

  it("rejects unsupported search filters", async () => {
    const response = await GET(new Request("https://vault.example.test/api/investments/symbol-search?q=veqt&instrumentType=stock&currency=CAD"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid symbol search request." });
    expect(mocks.searchMarketSymbols).not.toHaveBeenCalled();
  });
});
