import { toTorontoDateIso } from "@athena/database";
import { ArrowLeft, ArrowRight, BookOpen, ChartNoAxesColumnIncreasing, CircleAlert, CreditCard, ExternalLink, Landmark, ShieldCheck, TrendingUp } from "lucide-react";
import { redirect } from "next/navigation";
import React from "react";
import { ModulePage } from "../../../components/module-page";
import { getAuthenticatedUser, requireMfaEnrolledUser } from "../../../../lib/server/auth-session";
import { formatMoney } from "../../investment-format";
import { fetchMarketQuote } from "../../market-data";
import { marketReferenceLinks } from "../../market-links";
import { findMarketInstrument, type MarketSearchInstrumentType, type MarketSearchResult } from "../../../../lib/server/market-search";

export const dynamic = "force-dynamic";


type InstrumentSearchParams = {
  readonly instrumentType?: string | string[];
  readonly currency?: string | string[];
};

type InstrumentPageProps = {
  readonly params: Promise<{ readonly symbol: string }>;
  readonly searchParams?: Promise<InstrumentSearchParams>;
};

function firstSearchParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function routeSymbol(value: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  const normalized = decoded.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9._-]{0,23}$/.test(normalized) ? normalized : null;
}

function instrumentType(value: string): MarketSearchInstrumentType | null {
  return value === "mutual_fund" || value === "etf" ? value : null;
}

function currency(value: string): "CAD" | "USD" | null {
  return value === "CAD" || value === "USD" ? value : null;
}

function instrumentLabel(value: MarketSearchInstrumentType): string {
  return value === "mutual_fund" ? "FCP / MF" : "FNB / ETF";
}

function buildUseSymbolHref(instrument: MarketSearchResult): string {
  const params = new URLSearchParams({
    symbol: instrument.symbol,
    name: instrument.name,
    instrumentType: instrument.instrumentType,
    currency: instrument.currency,
  });
  return `/investments?${params.toString()}#investment-add-position`;
}

async function safeFindMarketInstrument(
  symbol: string,
  instrumentTypeValue: MarketSearchInstrumentType,
  currencyValue: "CAD" | "USD",
): Promise<MarketSearchResult | null> {
  try {
    return await findMarketInstrument(symbol, instrumentTypeValue, currencyValue);
  } catch {
    return null;
  }
}

async function safeFetchMarketQuote(
  symbol: string,
  currencyValue: "CAD" | "USD",
  effectiveOn: string,
  instrumentTypeValue: MarketSearchInstrumentType,
) {
  try {
    return await fetchMarketQuote(symbol, currencyValue, effectiveOn, instrumentTypeValue);
  } catch {
    return null;
  }
}

function InstrumentDashboardFrame({
  symbol,
  label,
  subtitle,
  children,
}: {
  readonly symbol: string;
  readonly label: string;
  readonly subtitle: string;
  readonly children: React.ReactNode;
}) {
  return <div className="investment-instrument-dashboard">
    <header className="investment-instrument-identity-hero">
      <div className="investment-instrument-dashboard-heading">
        <p className="investment-holding-eyebrow">Instrument check · {label}</p>
        <h3 id="investment-instrument-symbol">{symbol}</h3>
        <p>{subtitle}</p>
      </div>
      <a className="investment-instrument-back-link" href="/investments#investment-add-position"><ArrowLeft aria-hidden="true" size={15} strokeWidth={1.9} /><span>Back to investments</span></a>
      <p className="investment-instrument-hero-motto" aria-hidden="true"><span>Diversified growth</span><i>/</i><span>A brighter tomorrow</span></p>
      <p className="investment-instrument-hero-aside" aria-hidden="true">Disciplined investing for a more inclusive tomorrow</p>
    </header>
    {children}
  </div>;
}

function UnavailableDashboard({ symbol, label, message }: { readonly symbol: string; readonly label: string; readonly message: string }) {
  return <InstrumentDashboardFrame symbol={symbol} label={label} subtitle="Confirm the instrument before adding it to an REEI / RDSP account.">
    <div className="investment-instrument-status" role="status">
      <CircleAlert aria-hidden="true" size={22} strokeWidth={1.8} />
      <div><strong>Instrument details unavailable</strong><p>{message}</p></div>
    </div>
  </InstrumentDashboardFrame>;
}

export default async function InstrumentDashboardPage({ params, searchParams }: InstrumentPageProps) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  requireMfaEnrolledUser(user, true);

  const routeParams = await params;
  const query = searchParams ? await searchParams : {};
  const symbol = routeSymbol(routeParams.symbol);
  const requestedType = instrumentType(firstSearchParam(query.instrumentType));
  const requestedCurrency = currency(firstSearchParam(query.currency));
  const label = requestedType ? instrumentLabel(requestedType) : "instrument";

  if (!symbol || !requestedType || !requestedCurrency) {
    return <ModulePage active="Investments" eyebrow="Investments  ›  Instrument check" title="Instrument details" subtitle="Verify a market instrument before adding it to your REEI / RDSP holdings." mainClassName="instrument-page-main editorial-page-art">
      <UnavailableDashboard symbol={symbol ?? "Instrument"} label={label} message="This verification link is incomplete. Return to Investments and open the details link from a symbol suggestion." />
    </ModulePage>;
  }

  const asOf = toTorontoDateIso();
  const [instrument, quote] = await Promise.all([
    safeFindMarketInstrument(symbol, requestedType, requestedCurrency),
    safeFetchMarketQuote(symbol, requestedCurrency, asOf, requestedType),
  ]);

  if (!instrument) {
    return <ModulePage active="Investments" eyebrow="Investments  ›  Instrument check" title="Instrument details" subtitle="Verify a market instrument before adding it to your REEI / RDSP holdings." mainClassName="instrument-page-main editorial-page-art">
      <UnavailableDashboard symbol={symbol} label={label} message="No matching instrument details were returned for this symbol, type, and currency. Check the symbol or enter it manually in Investments." />
    </ModulePage>;
  }

  const referenceLinks = marketReferenceLinks(instrument);

  return <ModulePage active="Investments" eyebrow="Investments  ›  Instrument check" title="Instrument details" subtitle="Verify a market instrument before adding it to your REEI / RDSP holdings." mainClassName="instrument-page-main editorial-page-art">
    <InstrumentDashboardFrame symbol={instrument.symbol} label={instrumentLabel(instrument.instrumentType)} subtitle={instrument.name}>
      <p className="investment-instrument-read-only"><ShieldCheck aria-hidden="true" size={17} strokeWidth={1.8} /><span>Read-only verification view. Opening this page does not create a position or change balances.</span></p>

      <div className="investment-instrument-overview-grid">
        <section className="investment-instrument-details" aria-labelledby="investment-instrument-details-title">
          <p className="investment-holding-eyebrow" id="investment-instrument-details-title">Instrument details</p>
          <dl className="investment-instrument-identity">
            <div><span className="investment-instrument-detail-icon" aria-hidden="true"><BookOpen size={18} strokeWidth={1.8} /></span><span><dt>Instrument type</dt><dd>{instrumentLabel(instrument.instrumentType)}</dd></span></div>
            <div><span className="investment-instrument-detail-icon" aria-hidden="true"><CreditCard size={18} strokeWidth={1.8} /></span><span><dt>Trading currency</dt><dd>{instrument.currency}</dd></span></div>
            <div><span className="investment-instrument-detail-icon" aria-hidden="true"><TrendingUp size={18} strokeWidth={1.8} /></span><span><dt>Exchange</dt><dd>{instrument.exchange ?? "Provider fund code"}</dd></span></div>
            <div><span className="investment-instrument-detail-icon" aria-hidden="true"><Landmark size={18} strokeWidth={1.8} /></span><span><dt>Details source</dt><dd>{instrument.provider}</dd></span></div>
          </dl>
        </section>

        <section className="investment-instrument-quote" aria-labelledby="investment-instrument-quote-title">
          <span className="investment-instrument-quote-icon" aria-hidden="true"><ChartNoAxesColumnIncreasing size={22} strokeWidth={1.8} /></span>
          <p className="investment-holding-eyebrow">Market snapshot</p>
          <h3 id="investment-instrument-quote-title">Current price</h3>
          <div className="investment-instrument-quote-value">
            <strong>{quote ? formatMoney(quote.priceMinor, instrument.currency) : "Unavailable"}</strong>
            <p>{quote ? `Market · ${quote.effectiveOn}` : "No current quote available"}</p>
            {!quote ? <small>You can still verify the symbol details and enter a manual price later.</small> : null}
          </div>
          <svg className="investment-instrument-quote-chart" aria-hidden="true" viewBox="0 0 520 190" preserveAspectRatio="none">
            <path d="M0 172 L20 164 L37 168 L56 150 L72 156 L91 140 L108 146 L126 125 L142 130 L160 112 L176 120 L194 96 L210 101 L228 78 L246 88 L262 62 L278 71 L296 49 L312 56 L330 35 L348 45 L366 22 L384 29 L400 13 L418 20 L436 8 L454 14 L470 4 L488 14 L520 10" />
          </svg>
          <span className="investment-instrument-quote-tagline" aria-hidden="true">Same people<br />brighter possibilities</span>
        </section>
      </div>

      <div className="investment-instrument-lower-grid">
        <section className="investment-instrument-external-links" aria-labelledby="investment-instrument-external-links-title">
          <div>
            <p className="investment-holding-eyebrow">External references</p>
            <h3 className="sr-only" id="investment-instrument-external-links-title">Review market information</h3>
            <p className="sr-only">Open a market or issuer dashboard to compare the product name, price history, holdings, and other details.</p>
          </div>
          <div className="investment-instrument-external-link-list">
            {referenceLinks.map((link) => <a className="investment-instrument-external-link" key={link.href} href={link.href} target="_blank" rel="noopener noreferrer">
              <span className="investment-instrument-external-link-icon" aria-hidden="true"><ExternalLink size={17} strokeWidth={1.8} /></span>
              <span><strong>{link.label}</strong><small>{link.description}</small></span>
              <ArrowRight aria-hidden="true" size={16} strokeWidth={1.9} />
            </a>)}
          </div>
          <small className="investment-instrument-external-note">External sites may show delayed data and follow their own terms.</small>
        </section>

        <section className="investment-instrument-next-step">
          <div><p className="investment-holding-eyebrow">Next step</p><h3>Use this instrument in your holdings</h3><p>The add-position form will be prefilled with this verified symbol, instrument type, currency, and name.</p></div>
          <a className="navy-action-button" href={buildUseSymbolHref(instrument)}><span>Use this symbol</span><ArrowRight aria-hidden="true" size={15} strokeWidth={1.9} /></a>
        </section>
      </div>
    </InstrumentDashboardFrame>
  </ModulePage>;
}
