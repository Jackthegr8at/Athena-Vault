// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { changeInput, click, createDomTestRoot } from "../../test/dom";
import type { InvestmentHoldingsPageData } from "@athena/database";

const mocks = vi.hoisted(() => ({
  createInvestmentHoldingAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  createInvestmentHoldingTransactionAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  deleteInvestmentHoldingAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  deleteInvestmentHoldingTransactionAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  refreshInvestmentHoldingMarketFxAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  refreshInvestmentHoldingMarketPriceAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  setInvestmentHoldingManualFxRateAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  setInvestmentHoldingManualPriceAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
}));

vi.mock("./actions", () => mocks);

import { InvestmentHoldingsManager } from "./holdings-manager";

const accountId = "00000000-0000-4000-8000-000000000001";
const mutualFundId = "00000000-0000-4000-8000-000000000002";
const etfId = "00000000-0000-4000-8000-000000000003";

function holding(id: string, instrumentType: "mutual_fund" | "etf", name: string, currency: "CAD" | "USD") {
  return {
    id,
    accountId,
    instrumentType,
    symbol: "XBAL.TO",
    name,
    currency,
    transactions: [],
    valuation: {
      unitsMicros: 0,
      costBasisMinor: 0,
      averageCostMinor: null,
      purchasesMinor: 0,
      salesMinor: 0,
      distributionsMinor: 0,
      feesMinor: 0,
      marketValueMinor: 0,
      unrealizedChangeMinor: 0,
      price: { id: `${id}-price`, effectiveOn: "2026-09-08", priceMinor: 0, source: "manual" as const },
      fxRate: currency === "USD" ? { id: `${id}-fx`, baseCurrency: "USD" as const, quoteCurrency: "CAD" as const, effectiveOn: "2026-09-08", ratePpm: 1_350_000, source: "manual" as const } : null,
      cadMarketValueMinor: 0,
      cadCostBasisMinor: 0,
      cadUnrealizedChangeMinor: 0,
    },
  };
}

const pageData = {
  asOf: "2026-09-08",
  accounts: [{
    id: accountId,
    name: "My REEI",
    institution: "Example Bank",
    currency: "CAD",
    latestBalance: null,
    holdings: [holding(mutualFundId, "mutual_fund", "Balanced fund", "CAD"), holding(etfId, "etf", "Balanced ETF", "USD")],
    summary: {
      nativeTotals: {
        CAD: { marketValueMinor: 0, costBasisMinor: 0, unrealizedChangeMinor: 0 },
        USD: { marketValueMinor: 0, costBasisMinor: 0, unrealizedChangeMinor: 0 },
      },
      cadMarketValueMinor: 0,
      cadCostBasisMinor: 0,
      cadUnrealizedChangeMinor: 0,
    },
    reconciliation: { status: "matched", message: "Holdings value matches the latest Account balance snapshot.", balanceMinor: 0, holdingsValueMinor: 0, differenceMinor: 0 },
  }],
} as unknown as InvestmentHoldingsPageData;

const dom = createDomTestRoot();

describe("InvestmentHoldingsManager", () => {
  it("renders multiple mutual funds and ETFs in the same REEI/RDSP account, including zero values", async () => {
    await dom.render(<InvestmentHoldingsManager {...pageData} />);

    expect(dom.container.textContent).toContain("REEI / RDSP holdings");
    expect(dom.container.textContent).toContain("FCP / MF");
    expect(dom.container.textContent).toContain("FNB / ETF");
    expect(dom.container.textContent).toContain("Balanced fund");
    expect(dom.container.textContent).toContain("Balanced ETF");
    expect(dom.container.textContent).toContain("$0.00");
    expect(dom.container.textContent).toContain("US$0.00");
    expect(dom.container.querySelectorAll("select")).toHaveLength(0);
    expect(dom.get<HTMLButtonElement>("#investment-holdings-account").textContent).toContain("My REEI · Example Bank");
    expect(dom.container.querySelector(".investment-dropdown-chevron")?.getAttribute("aria-hidden")).toBe("true");
    expect(dom.get<HTMLButtonElement>('[id$="-instrument-type"]').textContent).toContain("FCP / MF");
    expect(dom.get<HTMLInputElement>('input[name="instrumentType"]').value).toBe("mutual_fund");
    expect(dom.container.querySelectorAll(".investment-holding-card-layout")).toHaveLength(2);
    expect(dom.container.querySelector(".investment-holding-create-icon")?.getAttribute("aria-hidden")).toBe("true");
    expect(dom.container.querySelector(".investment-holdings-summary > div.is-unavailable")).toBeTruthy();
    expect(dom.container.querySelectorAll(".investment-holding-card-market")).toHaveLength(2);
    expect(dom.container.querySelectorAll(".investment-holding-price-actions")).toHaveLength(2);
    expect(dom.container.querySelectorAll(".investment-holding-price-actions > .investment-holding-save-price-button")).toHaveLength(2);
    expect(dom.container.querySelectorAll(".investment-holding-price-actions > .investment-holding-refresh-price-button")).toHaveLength(2);
  });

  it("resets the manual price field when the persisted price identity changes", async () => {
    await dom.render(<InvestmentHoldingsManager {...pageData} />);

    const priceInput = dom.get<HTMLInputElement>('input[name="price"]');
    expect(priceInput.value).toBe("0.00");
    await changeInput(priceInput, "999.99");

    const updatedPageData = {
      ...pageData,
      accounts: pageData.accounts.map((account) => ({
        ...account,
        holdings: account.holdings.map((candidate) => candidate.id === mutualFundId
          ? {
            ...candidate,
            valuation: {
              ...candidate.valuation,
              price: { ...candidate.valuation.price!, effectiveOn: "2026-09-09", priceMinor: 12_550, source: "market" as const },
            },
          }
          : candidate),
      })),
    } as unknown as InvestmentHoldingsPageData;

    await dom.render(<InvestmentHoldingsManager {...updatedPageData} />);

    expect(dom.get<HTMLInputElement>('input[name="price"]').value).toBe("125.50");
  });

  it("uses a provider monogram for branded holding avatars", async () => {
    const vanguardPageData = {
      ...pageData,
      accounts: pageData.accounts.map((account) => ({
        ...account,
        holdings: [holding(mutualFundId, "mutual_fund", "Vanguard", "CAD")],
      })),
    } as unknown as InvestmentHoldingsPageData;

    await dom.render(<InvestmentHoldingsManager {...vanguardPageData} />);

    const avatar = dom.container.querySelector<HTMLElement>(".investment-holding-avatar");
    expect(avatar?.textContent).toBe("V");
    expect(avatar?.classList.contains("is-vanguard")).toBe(true);
  });

  it("opens the account picker as an app-styled listbox and closes it with Escape", async () => {
    await dom.render(<InvestmentHoldingsManager {...pageData} />);

    const trigger = dom.get<HTMLButtonElement>("#investment-holdings-account");
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));

    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const listbox = dom.get<HTMLDivElement>('[role="listbox"]');
    expect(listbox.className).toContain("investment-dropdown-options");
    expect(listbox.querySelector('[role="option"][aria-selected="true"]')).toBeTruthy();

    await act(async () => listbox.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(dom.container.querySelector('[role="listbox"]')).toBeNull();
  });

  it("uses the same dropdown behavior for instrument type and trading currency", async () => {
    await dom.render(<InvestmentHoldingsManager {...pageData} />);

    const symbolBeforeContextChange = dom.get<HTMLInputElement>('input[name="symbol"]');
    await changeInput(symbolBeforeContextChange, "ve");
    const instrumentTrigger = dom.get<HTMLButtonElement>('[id$="-instrument-type"]');
    await click(instrumentTrigger);
    const option = [...dom.container.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((candidate) => candidate.textContent?.includes("FNB / ETF"));
    expect(option).toBeTruthy();
    await click(option!);

    expect(instrumentTrigger.textContent).toContain("FNB / ETF");
    expect(dom.get<HTMLInputElement>('input[name="instrumentType"]').value).toBe("etf");
    expect(dom.get<HTMLButtonElement>('[id$="-currency"]').textContent).toContain("CAD");
    expect(dom.get<HTMLInputElement>('input[name="symbol"]')).not.toBe(symbolBeforeContextChange);
    expect(dom.get<HTMLInputElement>('input[name="symbol"]').value).toBe("ve");
  });

  it("puts position deletion beside the ledger and explains how to preserve a sale", async () => {
    mocks.deleteInvestmentHoldingAction.mockClear();
    mocks.deleteInvestmentHoldingAction.mockResolvedValueOnce({ ok: true, message: "Investment holding deleted.", fieldErrors: {} });
    await dom.render(<InvestmentHoldingsManager {...pageData} />);

    const deleteButtons = dom.container.querySelectorAll<HTMLButtonElement>(".investment-holding-delete-control > .investment-danger-button");
    expect(deleteButtons).toHaveLength(2);

    await click(deleteButtons[0]!);
    expect(document.body.querySelector(".confirmation-dialog")).toBeTruthy();
    expect(document.body.textContent).toContain("Permanently delete XBAL.TO?");
    expect(document.body.textContent).toContain("If you sold it, cancel and record a Sell ledger entry instead.");
    expect(mocks.deleteInvestmentHoldingAction).not.toHaveBeenCalled();

    await click(document.body.querySelector<HTMLButtonElement>(".confirmation-dialog__confirm")!);
    expect(mocks.deleteInvestmentHoldingAction).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector(".confirmation-dialog")).toBeNull();
    const submitted = (mocks.deleteInvestmentHoldingAction.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(submitted.get("holdingId")).toBe(mutualFundId);
    expect(submitted.get("confirm")).toBe("true");
  });

  it("retains entered position fields after a server validation response", async () => {
    mocks.createInvestmentHoldingAction.mockResolvedValueOnce({
      ok: false,
      message: "Review the highlighted fields.",
      fieldErrors: { symbol: "Symbol is required." },
    });
    await dom.render(<InvestmentHoldingsManager {...pageData} />);

    await changeInput(dom.get<HTMLInputElement>('input[name="symbol"]'), "XBAL.TO");
    await changeInput(dom.get<HTMLInputElement>('input[name="name"]'), "My balanced fund");
    const form = dom.get<HTMLFormElement>("form.investment-holding-create-form");
    const submitEvent = new Event("submit", { bubbles: true, cancelable: true });
    await act(async () => form.dispatchEvent(submitEvent));

    expect(submitEvent.defaultPrevented).toBe(true);
    const symbolInput = dom.get<HTMLInputElement>('input[name="symbol"]');
    expect(symbolInput.value).toBe("XBAL.TO");
    expect(dom.get<HTMLInputElement>('input[name="name"]').value).toBe("My balanced fund");
    expect(dom.container.textContent).toContain("Symbol is required.");
    const errorId = symbolInput.getAttribute("aria-describedby");
    expect(errorId).toBeTruthy();
    expect(dom.container.querySelector(`#${errorId}`)?.textContent).toBe("Symbol is required.");
  });

  it("shows debounced symbol suggestions and fills the holding name after selection", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      externalProviderConfigured: true,
      results: [{ symbol: "VIC1000", name: "Vanguard All-Equity ETF Portfolio Fund Series F", exchange: null, currency: "CAD", instrumentType: "mutual_fund", provider: "Vanguard Canada" }],
    })));
    vi.stubGlobal("fetch", fetchImplementation);
    await dom.render(<InvestmentHoldingsManager {...pageData} />);

    const symbol = dom.get<HTMLInputElement>('input[name="symbol"]');
    await changeInput(symbol, "vic10");
    await act(async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 330));
    });

    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const request = new URL(String(fetchImplementation.mock.calls[0]?.[0]), "https://vault.example.test");
    expect(request.pathname).toBe("/api/investments/symbol-search");
    expect(request.searchParams.get("q")).toBe("vic10");
    expect(request.searchParams.get("instrumentType")).toBe("mutual_fund");
    expect(fetchImplementation.mock.calls[0]?.[1]).toMatchObject({ credentials: "same-origin" });
    expect(dom.container.querySelector('[role="listbox"]')).toBeTruthy();
    const suggestion = dom.get<HTMLButtonElement>('[role="option"]');
    expect(suggestion.textContent).toContain("VIC1000");
    const detailsLink = dom.get<HTMLAnchorElement>(".investment-symbol-search-option-details");
    expect(detailsLink.target).toBe("_blank");
    expect(detailsLink.rel).toContain("noopener");
    expect(detailsLink.href).toContain("/investments/instrument/VIC1000");
    expect(detailsLink.href).toContain("instrumentType=mutual_fund");
    expect(detailsLink.href).toContain("currency=CAD");

    await click(suggestion);

    expect(symbol.value).toBe("VIC1000");
    expect(dom.get<HTMLInputElement>('input[name="name"]').value).toBe("Vanguard All-Equity ETF Portfolio Fund Series F");
    expect(dom.container.querySelector('[role="listbox"]')).toBeNull();
    await act(async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 330));
    });

    expect(dom.container.querySelector('[role="listbox"]')).toBeNull();
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("does not describe a failed search request as missing configuration", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: "Symbol search unavailable." }), { status: 503 }));
    vi.stubGlobal("fetch", fetchImplementation);
    await dom.render(<InvestmentHoldingsManager {...pageData} />);

    await changeInput(dom.get<HTMLInputElement>('input[name="symbol"]'), "veq");
    await act(async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 330));
    });

    expect(dom.container.textContent).toContain("Symbol search is temporarily unavailable.");
    expect(dom.container.textContent).not.toContain("not configured");
  });

  it("cancels an obsolete debounce when the symbol changes again", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ externalProviderConfigured: true, results: [] })));
    vi.stubGlobal("fetch", fetchImplementation);
    await dom.render(<InvestmentHoldingsManager {...pageData} />);

    await changeInput(dom.get<HTMLInputElement>('input[name="symbol"]'), "ve");
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 100)); });
    await changeInput(dom.get<HTMLInputElement>('input[name="symbol"]'), "veqt");
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 190)); });
    expect(fetchImplementation).not.toHaveBeenCalled();
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 130)); });

    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(new URL(String(fetchImplementation.mock.calls[0]?.[0]), "https://vault.example.test").searchParams.get("q")).toBe("veqt");
  });

  it("aborts the prior query and ignores its stale response", async () => {
    const requests: { readonly resolve: (response: Response) => void; readonly signal?: AbortSignal; readonly input: string }[] = [];
    const fetchImplementation = vi.fn<typeof fetch>((input, init) => new Promise<Response>((resolve) => {
      requests.push({ resolve, signal: init?.signal as AbortSignal | undefined, input: String(input) });
    }));
    vi.stubGlobal("fetch", fetchImplementation);
    await dom.render(<InvestmentHoldingsManager {...pageData} />);

    const symbol = dom.get<HTMLInputElement>('input[name="symbol"]');
    await changeInput(symbol, "veq");
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 320)); });
    expect(requests).toHaveLength(1);
    await changeInput(symbol, "veqt");
    expect(requests[0]?.signal?.aborted).toBe(true);
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 320)); });
    expect(requests).toHaveLength(2);
    expect(new URL(requests[1]!.input, "https://vault.example.test").searchParams.get("q")).toBe("veqt");

    const result = (symbolValue: string, instrumentType: "mutual_fund" | "etf") => ({
      symbol: symbolValue,
      name: symbolValue === "STALE" ? "Stale result" : "Current result",
      exchange: null,
      currency: "CAD" as const,
      instrumentType,
      provider: "Test provider",
    });
    await act(async () => {
      requests[0]!.resolve(new Response(JSON.stringify({ externalProviderConfigured: true, results: [result("STALE", "mutual_fund")] })));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(dom.container.textContent).not.toContain("Stale result");
    await act(async () => {
      requests[1]!.resolve(new Response(JSON.stringify({ externalProviderConfigured: true, results: [result("VEQT.TO", "mutual_fund")] })));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(dom.container.textContent).toContain("Current result");
    expect(dom.container.textContent).not.toContain("Stale result");
  });

  it("prefills the add-position form from an instrument verification link", async () => {
    await dom.render(<InvestmentHoldingsManager {...pageData} initialPosition={{
      symbol: "VEQT.TO",
      name: "Vanguard All-Equity ETF Portfolio",
      instrumentType: "etf",
      currency: "CAD",
    }} />);

    expect(dom.get<HTMLInputElement>('input[name="symbol"]').value).toBe("VEQT.TO");
    expect(dom.get<HTMLInputElement>('input[name="name"]').value).toBe("Vanguard All-Equity ETF Portfolio");
    expect(dom.get<HTMLInputElement>('input[name="instrumentType"]').value).toBe("etf");
    expect(dom.get<HTMLInputElement>('input[name="currency"]').value).toBe("CAD");
  });
});
