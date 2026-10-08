"use client";

import { ExternalLink } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { MarketSearchInstrumentType, MarketSearchResult } from "../../lib/server/market-search";

const SEARCH_DEBOUNCE_MS = 280;

type InvestmentSymbolSearchProps = {
  readonly id: string;
  readonly name: string;
  readonly value: string;
  readonly instrumentType: MarketSearchInstrumentType;
  readonly currency: "CAD" | "USD";
  readonly onChange: (value: string) => void;
  readonly onSelect: (result: MarketSearchResult) => void;
  readonly "aria-describedby"?: string;
  readonly "aria-invalid"?: boolean;
};

function validResult(value: unknown): value is MarketSearchResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<MarketSearchResult>;
  return typeof result.symbol === "string"
    && typeof result.name === "string"
    && (result.exchange === null || typeof result.exchange === "string")
    && (result.currency === "CAD" || result.currency === "USD")
    && (result.instrumentType === "mutual_fund" || result.instrumentType === "etf")
    && typeof result.provider === "string";
}

function instrumentDetailsHref(result: MarketSearchResult): string {
  const params = new URLSearchParams({
    instrumentType: result.instrumentType,
    currency: result.currency,
  });
  return `/investments/instrument/${encodeURIComponent(result.symbol)}?${params.toString()}`;
}

export function InvestmentSymbolSearch({
  id,
  name,
  value,
  instrumentType,
  currency,
  onChange,
  onSelect,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: InvestmentSymbolSearchProps) {
  const idScope = useId().replace(/:/g, "");
  const listboxId = `${id}-suggestions`;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestSequence = useRef(0);
  const skipNextSearchRef = useRef(false);
  const [results, setResults] = useState<readonly MarketSearchResult[]>([]);
  const [externalProviderConfigured, setExternalProviderConfigured] = useState(true);
  const [searchUnavailable, setSearchUnavailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    const query = value.trim();
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      return;
    }
    if (query.length < 2) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setOpen(true);
      try {
        const params = new URLSearchParams({ q: query, instrumentType, currency });
        const response = await fetch(`/api/investments/symbol-search?${params.toString()}`, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Symbol search unavailable.");
        const payload: unknown = await response.json();
        if (sequence !== requestSequence.current) return;
        const body = payload && typeof payload === "object" ? payload as { readonly results?: unknown; readonly externalProviderConfigured?: unknown } : {};
        setResults(Array.isArray(body.results) ? body.results.filter(validResult) : []);
        setExternalProviderConfigured(body.externalProviderConfigured !== false);
        setSearchUnavailable(false);
      } catch {
        if (controller.signal.aborted || sequence !== requestSequence.current) return;
        setResults([]);
        setSearchUnavailable(true);
      } finally {
        if (!controller.signal.aborted && sequence === requestSequence.current) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [currency, instrumentType, value]);

  useEffect(() => {
    if (!open) return;
    function dismissSearch(event: PointerEvent): void {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
      setActiveIndex(-1);
    }
    document.addEventListener("pointerdown", dismissSearch);
    return () => document.removeEventListener("pointerdown", dismissSearch);
  }, [open]);

  function resetSearchState(): void {
    requestSequence.current += 1;
    setActiveIndex(-1);
    setResults([]);
    setSearchUnavailable(false);
    setLoading(false);
    setOpen(false);
  }

  function handleInputChange(nextValue: string): void {
    skipNextSearchRef.current = false;
    resetSearchState();
    onChange(nextValue);
  }

  function selectResult(result: MarketSearchResult): void {
    resetSearchState();
    skipNextSearchRef.current = true;
    onSelect(result);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") {
      if (!open) return;
      event.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (event.key === "ArrowDown" && results.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(results.length - 1, index + 1));
      return;
    }
    if (event.key === "ArrowUp" && results.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.max(0, index < 0 ? results.length - 1 : index - 1));
      return;
    }
    if (event.key === "Enter" && open && activeIndex >= 0) {
      event.preventDefault();
      const result = results[activeIndex];
      if (result) selectResult(result);
    }
  }

  const showEmptyMessage = open && !loading && results.length === 0;
  const activeDescendant = activeIndex >= 0 ? `${listboxId}-option-${activeIndex}-${idScope}` : undefined;
  return <div className="investment-symbol-search" ref={rootRef}>
    <input
      ref={inputRef}
      id={id}
      name={name}
      type="text"
      inputMode="text"
      maxLength={24}
      value={value}
      autoComplete="off"
      spellCheck={false}
      role="combobox"
      aria-autocomplete="list"
      aria-controls={listboxId}
      aria-expanded={open}
      aria-activedescendant={activeDescendant}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      placeholder="Example: VEQT.TO or a fund code"
      required
      onChange={(event) => handleInputChange(event.target.value)}
      onFocus={() => { if (value.trim().length >= 2 && (loading || results.length > 0 || showEmptyMessage)) setOpen(true); }}
      onKeyDown={handleKeyDown}
    />
    {open ? <div className="investment-symbol-search-options" id={listboxId} role="listbox" aria-label="Symbol suggestions" aria-busy={loading}>
      {loading ? <p className="investment-symbol-search-status">Searching…</p> : null}
      {results.map((result, index) => <div className="investment-symbol-search-option-row" key={`${result.instrumentType}:${result.symbol}:${result.provider}`} role="presentation">
        <button
          id={`${listboxId}-option-${index}-${idScope}`}
          className={`investment-symbol-search-option${activeIndex === index ? " is-active" : ""}`}
          type="button"
          role="option"
          aria-selected={activeIndex === index}
          onMouseEnter={() => setActiveIndex(index)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => selectResult(result)}
        >
          <span className="investment-symbol-search-option-copy"><strong>{result.symbol}</strong><small>{result.name}</small></span>
          <span className="investment-symbol-search-option-meta">{result.currency}{result.exchange ? ` · ${result.exchange}` : ""}</span>
        </button>
        <a className="investment-symbol-search-option-details" href={instrumentDetailsHref(result)} target="_blank" rel="noopener noreferrer" aria-label={`View details for ${result.symbol}`} title="View instrument details">
          <ExternalLink aria-hidden="true" size={16} strokeWidth={2} />
        </a>
      </div>)}
      {showEmptyMessage ? <p className="investment-symbol-search-status">{searchUnavailable ? "Symbol search is temporarily unavailable. You can still enter a symbol manually." : externalProviderConfigured ? "No matching instruments found. You can still enter a symbol manually." : "Server symbol search is not configured. Add ATHENA_EODHD_API_TOKEN and restart the app; you can still enter a symbol manually."}</p> : null}
    </div> : null}
    <span className="investment-visually-hidden" aria-live="polite">{loading ? "Searching for symbols." : results.length > 0 ? `${results.length} symbol suggestions available.` : ""}</span>
  </div>;
}
