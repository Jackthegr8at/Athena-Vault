"use client";

import { startTransition, useActionState, useCallback, useId, useState } from "react";
import { ArrowRight, BookOpen, CalendarDays, CreditCard, Info, Landmark, Plus, RefreshCw, TrendingUp, Wallet } from "lucide-react";
import type {
  InvestmentHoldingAccountDataView,
  InvestmentHoldingView,
  InvestmentHoldingsPageData,
} from "@athena/database";
import {
  createInvestmentHoldingAction,
  createInvestmentHoldingTransactionAction,
  deleteInvestmentHoldingAction,
  deleteInvestmentHoldingTransactionAction,
  refreshInvestmentHoldingMarketFxAction,
  refreshInvestmentHoldingMarketPriceAction,
  setInvestmentHoldingManualFxRateAction,
  setInvestmentHoldingManualPriceAction,
} from "./actions";
import { ConfirmationDialog } from "../components/confirmation-dialog";
import { ActionNotification } from "../components/action-notification";
import { ActionMessage, FieldError } from "./investment-readouts";
import { initialInvestmentProjectionActionState, type InvestmentProjectionActionState } from "./action-helpers";
import { InvestmentDropdown } from "./investment-dropdown";
import { InvestmentSymbolSearch } from "./investment-symbol-search";
import { formatMoney } from "./investment-format";
import { formatMoneyInputMinor } from "../../lib/format-money";
type InstrumentType = "mutual_fund" | "etf";
type TransactionKind = "opening" | "buy" | "sell" | "distribution" | "fee";

function instrumentDetailsHref(holding: InvestmentHoldingView): string {
  const params = new URLSearchParams({
    instrumentType: holding.instrumentType,
    currency: holding.currency,
  });
  return `/investments/instrument/${encodeURIComponent(holding.symbol)}?${params.toString()}`;
}

const TRANSACTION_KINDS: readonly { readonly value: TransactionKind; readonly label: string }[] = [
  { value: "opening", label: "Opening position" },
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell" },
  { value: "distribution", label: "Distribution" },
  { value: "fee", label: "Fee" },
];
const INSTRUMENT_TYPE_OPTIONS: readonly { readonly value: InstrumentType; readonly label: string }[] = [
  { value: "mutual_fund", label: "FCP / MF" },
  { value: "etf", label: "FNB / ETF" },
];
const HOLDING_CURRENCY_OPTIONS: readonly { readonly value: "CAD" | "USD"; readonly label: string }[] = [
  { value: "CAD", label: "CAD" },
  { value: "USD", label: "USD" },
];

function instrumentLabel(instrumentType: InstrumentType): string {
  return instrumentType === "mutual_fund" ? "FCP / MF" : "FNB / ETF";
}

function holdingAvatarLabel(holding: InvestmentHoldingView): string {
  const source = holding.name.trim() || holding.symbol.trim();
  return source.charAt(0).toUpperCase() || "?";
}

function holdingAvatarClassName(holding: InvestmentHoldingView): string {
  return holding.name.toLowerCase().includes("vanguard") ? "investment-holding-avatar is-vanguard" : "investment-holding-avatar";
}

function formatUnits(unitsMicros: number): string {
  if (!Number.isSafeInteger(unitsMicros) || unitsMicros < 0) return "Unavailable";
  const value = BigInt(unitsMicros);
  const whole = value / 1_000_000n;
  const fraction = String(value % 1_000_000n).padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole.toLocaleString("en-CA")}.${fraction}` : whole.toLocaleString("en-CA");
}

function minorInput(minor: number | null | undefined): string {
  if (minor === null || minor === undefined || !Number.isSafeInteger(minor)) return "0.00";
  return formatMoneyInputMinor(minor);
}

function currentPrice(holding: InvestmentHoldingView): string {
  return holding.valuation.price ? formatMoney(holding.valuation.price.priceMinor, holding.currency) : "No price saved";
}

function currentPriceContext(holding: InvestmentHoldingView): string | null {
  return holding.valuation.price
    ? `${holding.valuation.price.source === "manual" ? "Manual" : "Market"} · ${holding.valuation.price.effectiveOn}`
    : null;
}

type HoldingErrorField = "accountId" | "instrumentType" | "symbol" | "name" | "currency" | "holdingId" | "occurredOn" | "kind" | "units" | "amount" | "fee" | "note" | "effectiveOn" | "price" | "rate" | "valuationOn";

function holdingErrorId(scope: string, field: HoldingErrorField): string {
  return `investment-holding-${scope}-${field}-error`;
}

function errorProps(state: InvestmentProjectionActionState, field: HoldingErrorField, id: string) {
  return state.fieldErrors[field] ? { "aria-invalid": true, "aria-describedby": id } : {};
}

function HoldingTransactionForm({ holding, asOf }: { readonly holding: InvestmentHoldingView; readonly asOf: string }) {
  const [state, action, pending] = useActionState(createInvestmentHoldingTransactionAction, initialInvestmentProjectionActionState);
  const errorScope = useId().replace(/:/g, "");
  const errorId = (field: HoldingErrorField) => holdingErrorId(errorScope, field);
  const [kind, setKind] = useState<TransactionKind>("buy");
  const [occurredOn, setOccurredOn] = useState(asOf);
  const [units, setUnits] = useState("1");
  const [amount, setAmount] = useState("0.00");
  const [fee, setFee] = useState("0.00");
  const [note, setNote] = useState("");
  const entryTypeLabelId = `${errorScope}-entry-type-label`;

  function changeKind(nextKind: TransactionKind): void {
    setKind(nextKind);
    if (nextKind === "distribution" || nextKind === "fee") setUnits("0");
    else if (units === "0") setUnits("1");
    if (nextKind === "fee") setFee("0.00");
  }

  return <form action={action} className="investment-holding-transaction-form">
    <input type="hidden" name="holdingId" value={holding.id} />
    <fieldset>
      <legend>Add ledger entry</legend>
      <div className="investment-holding-form-grid">
        <div className="investment-holding-dropdown-field"><span className="investment-holding-dropdown-label" id={entryTypeLabelId}>Entry type</span><InvestmentDropdown id={`${errorScope}-kind`} name="kind" value={kind} options={TRANSACTION_KINDS} onChange={changeKind} aria-labelledby={entryTypeLabelId} {...errorProps(state, "kind", errorId("kind"))} /><FieldError state={state} field="kind" id={errorId("kind")} /></div>
        <label>Date<input name="occurredOn" type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} required {...errorProps(state, "occurredOn", errorId("occurredOn"))} /><FieldError state={state} field="occurredOn" id={errorId("occurredOn")} /></label>
        <label>Units<input name="units" type="text" inputMode="decimal" value={units} onChange={(event) => setUnits(event.target.value)} required {...errorProps(state, "units", errorId("units"))} /><FieldError state={state} field="units" id={errorId("units")} /></label>
        <label>Amount ({holding.currency})<input name="amount" type="text" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required {...errorProps(state, "amount", errorId("amount"))} /><FieldError state={state} field="amount" id={errorId("amount")} /></label>
        <label>Trade fee ({holding.currency})<input name="fee" type="text" inputMode="decimal" value={fee} onChange={(event) => setFee(event.target.value)} required {...errorProps(state, "fee", errorId("fee"))} /><FieldError state={state} field="fee" id={errorId("fee")} /></label>
        <label className="investment-holding-form-wide">Note (optional)<input name="note" type="text" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} {...errorProps(state, "note", errorId("note"))} /><FieldError state={state} field="note" id={errorId("note")} /></label>
      </div>
      <div className="investment-holding-form-actions"><button className="navy-action-button" type="submit" disabled={pending}>{pending ? "Adding…" : "Add entry"}</button><ActionMessage state={state} /></div>
    </fieldset>
  </form>;
}

function HoldingMarketPanel({ holding, asOf }: { readonly holding: InvestmentHoldingView; readonly asOf: string }) {
  const [priceState, priceAction, pricePending] = useActionState(setInvestmentHoldingManualPriceAction, initialInvestmentProjectionActionState);
  const [marketState, marketAction, marketPending] = useActionState(refreshInvestmentHoldingMarketPriceAction, initialInvestmentProjectionActionState);
  const errorScope = useId().replace(/:/g, "");
  const errorId = (field: HoldingErrorField) => holdingErrorId(errorScope, field);
  const [effectiveOn, setEffectiveOn] = useState(asOf);
  const [price, setPrice] = useState(minorInput(holding.valuation.price?.priceMinor));

  return <>
    <div className={`investment-holding-value${holding.valuation.marketValueMinor === null ? " is-unavailable" : ""}`}><span>Market value</span><strong>{formatMoney(holding.valuation.marketValueMinor, holding.currency)}</strong><small>{holding.valuation.unrealizedChangeMinor === null ? "Change unavailable" : `${formatMoney(holding.valuation.unrealizedChangeMinor, holding.currency)} unrealized`}</small></div>
    <div className="investment-holding-price-readout"><span>Current price</span><strong>{currentPrice(holding)}</strong>{currentPriceContext(holding) ? <small>{currentPriceContext(holding)}</small> : null}{holding.valuation.price?.provider ? <small>{holding.valuation.price.provider}</small> : null}</div>
    <form className="investment-holding-price-actions investment-holding-mini-form">
      <input type="hidden" name="holdingId" value={holding.id} />
      <input type="hidden" name="valuationOn" value={asOf} />
      <label>Manual price<input name="price" type="text" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} required {...errorProps(priceState, "price", errorId("price"))} /><FieldError state={priceState} field="price" id={errorId("price")} /></label>
      <label>Effective date<input name="effectiveOn" type="date" value={effectiveOn} onChange={(event) => setEffectiveOn(event.target.value)} required {...errorProps(priceState, "effectiveOn", errorId("effectiveOn"))} /><FieldError state={priceState} field="effectiveOn" id={errorId("effectiveOn")} /></label>
      <button className="investment-secondary-button investment-holding-save-price-button" type="submit" formAction={priceAction} disabled={pricePending}>{pricePending ? "Saving…" : "Save manual price"}</button>
      <ActionMessage state={priceState} />
      <button className="investment-secondary-button investment-holding-refresh-price-button" type="submit" formAction={marketAction} formNoValidate disabled={marketPending}><RefreshCw aria-hidden="true" size={16} strokeWidth={1.8} /><span>{marketPending ? "Refreshing…" : "Refresh market price"}</span></button>
      <small className="investment-holding-price-note">{holding.instrumentType === "mutual_fund" ? "Mutual funds use the provider's dated NAV; saved manual prices are kept." : "Refresh is explicit; saved manual prices are kept."}</small>
      <ActionMessage state={marketState} />
    </form>
  </>;
}

function HoldingLedger({ holding, asOf }: { readonly holding: InvestmentHoldingView; readonly asOf: string }) {
  const [deleteState, deleteAction, deletePending] = useActionState(deleteInvestmentHoldingTransactionAction, initialInvestmentProjectionActionState);
  return <>
    <HoldingTransactionForm holding={holding} asOf={asOf} />
    <div className="investment-holding-history">
      <h4>Ledger history</h4>
      {holding.transactions.length === 0 ? <p className="investment-empty-note">No ledger entries yet. Add an opening position or a buy entry to begin tracking this holding.</p> : <div className="investment-holding-table-wrap"><table className="investment-holding-table"><caption className="investment-visually-hidden">Transactions for {holding.symbol}</caption><thead><tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Units</th><th scope="col">Amount</th><th scope="col">Fee</th><th scope="col"><span className="investment-visually-hidden">Actions</span></th></tr></thead><tbody>{holding.transactions.map((transaction) => <tr key={transaction.id}><td data-label="Date">{transaction.occurredOn}</td><td data-label="Type">{transaction.kind}</td><td data-label="Units">{formatUnits(transaction.unitsMicros)}</td><td data-label="Amount">{formatMoney(transaction.amountMinor, holding.currency)}</td><td data-label="Fee">{formatMoney(transaction.feeMinor, holding.currency)}</td><td data-label="Actions"><form action={deleteAction} className="investment-holding-delete-form"><input type="hidden" name="holdingId" value={holding.id} /><input type="hidden" name="transactionId" value={transaction.id} /><input type="hidden" name="confirm" value="true" /><button className="investment-danger-button" type="submit" disabled={deletePending}>{deletePending ? "Deleting…" : "Delete"}</button></form></td></tr>)}</tbody></table></div>}
      <ActionNotification state={deleteState} />
    </div>
  </>;
}

function HoldingDeleteControl({ holding }: { readonly holding: InvestmentHoldingView }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const deleteFeedbackAction = useCallback(async (previousState: InvestmentProjectionActionState, formData: FormData): Promise<InvestmentProjectionActionState> => {
    const nextState = await deleteInvestmentHoldingAction(previousState, formData);
    if (nextState.ok) setConfirmOpen(false);
    return nextState;
  }, []);
  const [state, action, pending] = useActionState(deleteFeedbackAction, initialInvestmentProjectionActionState);

  const confirmDelete = () => {
    const formData = new FormData();
    formData.set("holdingId", holding.id);
    formData.set("confirm", "true");
    startTransition(() => action(formData));
  };

  return <div className="investment-holding-delete-control">
    <button className="investment-danger-button" type="button" aria-haspopup="dialog" onClick={() => setConfirmOpen(true)} disabled={pending}>{pending ? "Deleting…" : "Delete position"}</button>
    <ActionNotification state={state} />
    {confirmOpen ? <ConfirmationDialog
      open
      title={`Permanently delete ${holding.symbol}?`}
      description={`This permanently removes ${holding.symbol}, its price history, and all ledger entries. If you sold it, cancel and record a Sell ledger entry instead.`}
      confirmLabel="Delete position"
      tone="danger"
      pending={pending}
      onConfirm={confirmDelete}
      onCancel={() => setConfirmOpen(false)}
    /> : null}
  </div>;
}

export type InvestmentHoldingInitialPosition = {
  readonly symbol: string;
  readonly name: string;
  readonly instrumentType: InstrumentType;
  readonly currency: "CAD" | "USD";
};

function HoldingCard({ holding, asOf }: { readonly holding: InvestmentHoldingView; readonly asOf: string }) {
  const [open, setOpen] = useState(false);
  const valuation = holding.valuation;
  return <article className="investment-holding-card">
    <div className="investment-holding-card-layout">
      <div className="investment-holding-card-overview">
        <div className="investment-holding-card-identity">
          <span className={holdingAvatarClassName(holding)} aria-hidden="true">{holdingAvatarLabel(holding)}</span>
          <div className="investment-holding-card-header"><div><span className="investment-holding-kind">{instrumentLabel(holding.instrumentType)}</span><h3><a href={instrumentDetailsHref(holding)} aria-label={`View details for ${holding.symbol}`}>{holding.symbol}<ArrowRight aria-hidden="true" size={16} strokeWidth={1.8} /></a></h3><p>{holding.name} · {holding.currency}</p></div></div>
        </div>
        <dl className="investment-holding-metrics"><div><dt>Units</dt><dd>{formatUnits(valuation.unitsMicros)}</dd></div><div><dt>Average cost</dt><dd>{formatMoney(valuation.averageCostMinor, holding.currency)}</dd></div><div><dt>Cost basis</dt><dd>{formatMoney(valuation.costBasisMinor, holding.currency)}</dd></div></dl>
      </div>
      <div className="investment-holding-card-market">
        <HoldingMarketPanel key={`${holding.id}:${holding.valuation.price?.effectiveOn ?? "none"}:${holding.valuation.price?.source ?? "none"}:${holding.valuation.price?.priceMinor ?? "none"}`} holding={holding} asOf={asOf} />
      </div>
    </div>
    {holding.currency === "USD" && valuation.fxRate === null && valuation.unitsMicros > 0 ? <p className="investment-holding-unavailable">CAD value is unavailable until a USD-to-CAD rate is saved or refreshed.</p> : null}
    <div className="investment-holding-card-footer"><div className="investment-holding-card-footer-actions"><button className="investment-secondary-button" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}><BookOpen aria-hidden="true" size={16} strokeWidth={1.8} /><span>{open ? "Hide ledger" : "Show ledger"}</span></button><HoldingDeleteControl holding={holding} /></div><span>{holding.transactions.length} entr{holding.transactions.length === 1 ? "y" : "ies"}</span></div>
    {open ? <HoldingLedger holding={holding} asOf={asOf} /> : null}
  </article>;
}

function AccountWorkspace({ account, asOf }: { readonly account: InvestmentHoldingAccountDataView; readonly asOf: string }) {
  const [fxState, fxAction, fxPending] = useActionState(setInvestmentHoldingManualFxRateAction, initialInvestmentProjectionActionState);
  const [marketFxState, marketFxAction, marketFxPending] = useActionState(refreshInvestmentHoldingMarketFxAction, initialInvestmentProjectionActionState);
  const errorScope = useId().replace(/:/g, "");
  const errorId = (field: HoldingErrorField) => holdingErrorId(errorScope, field);
  const [effectiveOn, setEffectiveOn] = useState(asOf);
  const [rate, setRate] = useState("1.350000");
  const summary = account.summary;
  const canRefreshFx = account.holdings.some((holding) => holding.currency === "USD");
  return <section className="investment-holdings-account" aria-labelledby={`holdings-account-${account.id}`}>
    <div className="investment-holdings-account-header"><div className="investment-holdings-account-identity"><span className="investment-holdings-account-icon" aria-hidden="true"><Landmark size={23} strokeWidth={1.6} /></span><div><p className="investment-holding-eyebrow">REEI / RDSP Account · {account.institution}</p><h3 id={`holdings-account-${account.id}`}>{account.name}</h3></div></div><span className="investment-holding-currency-badge">Account currency: {account.currency}</span></div>
    <div className="investment-holdings-summary"><div><span className="investment-holdings-summary-icon" aria-hidden="true"><Wallet size={19} strokeWidth={1.7} /></span><span className="investment-holdings-summary-copy"><span>CAD value</span><strong>{formatMoney(summary.cadMarketValueMinor, "CAD")}</strong></span></div><div><span className="investment-holdings-summary-icon" aria-hidden="true"><CreditCard size={19} strokeWidth={1.7} /></span><span className="investment-holdings-summary-copy"><span>CAD cost basis</span><strong>{formatMoney(summary.cadCostBasisMinor, "CAD")}</strong></span></div><div><span className="investment-holdings-summary-icon" aria-hidden="true"><TrendingUp size={19} strokeWidth={1.7} /></span><span className="investment-holdings-summary-copy"><span>CAD change</span><strong>{formatMoney(summary.cadUnrealizedChangeMinor, "CAD")}</strong></span></div><div className={account.latestBalance ? "" : "is-unavailable"}><span className="investment-holdings-summary-icon" aria-hidden="true"><Landmark size={19} strokeWidth={1.7} /></span><span className="investment-holdings-summary-copy"><span>Account balance</span><strong>{formatMoney(account.latestBalance?.balanceMinor ?? null, account.currency)}</strong></span></div></div>
    <p className={`investment-holding-reconciliation is-${account.reconciliation.status}`}><span className="investment-holding-reconciliation-icon" aria-hidden="true"><Info size={17} strokeWidth={1.8} /></span><span><strong>{account.reconciliation.status === "matched" ? "Matched" : account.reconciliation.status === "difference" ? "Review difference" : "Reconciliation unavailable"}</strong> {account.reconciliation.message}{account.reconciliation.differenceMinor !== null ? ` Difference: ${formatMoney(account.reconciliation.differenceMinor, account.currency)}.` : ""}</span></p>
    {account.holdings.length === 0 ? <p className="investment-empty-note">No positions in this REEI/RDSP Account yet. Add an FCP / MF or FNB / ETF below.</p> : <div className="investment-holding-list">{account.holdings.map((holding) => <HoldingCard key={holding.id} holding={holding} asOf={asOf} />)}</div>}
    {canRefreshFx ? <div className="investment-holding-fx-panel"><div><h4>USD conversion</h4><p>USD positions need a dated USD-to-CAD rate before their CAD value can be included.</p></div><div className="investment-holding-fx-actions"><form action={fxAction} className="investment-holding-mini-form"><label>Manual USD → CAD rate<input name="rate" type="text" inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} required {...errorProps(fxState, "rate", errorId("rate"))} /><FieldError state={fxState} field="rate" id={errorId("rate")} /></label><label>Effective date<input name="effectiveOn" type="date" value={effectiveOn} onChange={(event) => setEffectiveOn(event.target.value)} required {...errorProps(fxState, "effectiveOn", errorId("effectiveOn"))} /><FieldError state={fxState} field="effectiveOn" id={errorId("effectiveOn")} /></label><button className="investment-secondary-button" type="submit" disabled={fxPending}>{fxPending ? "Saving…" : "Save manual rate"}</button><ActionMessage state={fxState} /></form><form action={marketFxAction} className="investment-holding-refresh-form"><input type="hidden" name="valuationOn" value={asOf} /><button className="investment-secondary-button" type="submit" disabled={marketFxPending}>{marketFxPending ? "Refreshing…" : "Refresh market FX rate"}</button><small>Manual rates remain preferred for the same date.</small><ActionMessage state={marketFxState} /></form></div></div> : null}
  </section>;
}

function InvestmentHoldingsAccountPicker({
  accounts,
  selectedAccount,
  onSelect,
}: {
  readonly accounts: readonly InvestmentHoldingAccountDataView[];
  readonly selectedAccount: InvestmentHoldingAccountDataView | null;
  readonly onSelect: (accountId: string) => void;
}) {
  const idScope = useId().replace(/:/g, "");
  const labelId = `investment-holdings-account-label-${idScope}`;
  return <div className="investment-holdings-account-picker">
    <span className="investment-holdings-account-label" id={labelId}>Account to manage</span>
    <InvestmentDropdown
      id="investment-holdings-account"
      className="investment-holdings-account-dropdown"
      value={selectedAccount?.id ?? ""}
      options={accounts.map((account) => ({ value: account.id, label: `${account.name} · ${account.institution}` }))}
      onChange={onSelect}
      aria-labelledby={labelId}
    />
  </div>;
}

export function InvestmentHoldingsManager({ asOf, accounts, initialPosition }: InvestmentHoldingsPageData & { readonly initialPosition?: InvestmentHoldingInitialPosition | null }) {
  const [selectedAccountId, setSelectedAccountId] = useState(accounts[0]?.id ?? "");
  const [holdingState, holdingAction, holdingPending] = useActionState(createInvestmentHoldingAction, initialInvestmentProjectionActionState);
  const errorScope = useId().replace(/:/g, "");
  const errorId = (field: HoldingErrorField) => holdingErrorId(errorScope, field);
  const [instrumentType, setInstrumentType] = useState<InstrumentType>(initialPosition?.instrumentType ?? "mutual_fund");
  const [symbol, setSymbol] = useState(initialPosition?.symbol ?? "");
  const [name, setName] = useState(initialPosition?.name ?? "");
  const [currency, setCurrency] = useState<"CAD" | "USD">(initialPosition?.currency ?? "CAD");
  const [symbolSearchContextVersion, setSymbolSearchContextVersion] = useState(0);
  const instrumentTypeLabelId = `${errorScope}-instrument-type-label`;
  const currencyLabelId = `${errorScope}-currency-label`;
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) ?? accounts[0] ?? null;

  function selectSymbol(result: { readonly symbol: string; readonly name: string; readonly instrumentType: InstrumentType; readonly currency: "CAD" | "USD" }): void {
    setInstrumentType(result.instrumentType);
    setSymbol(result.symbol);
    setName(result.name);
    setCurrency(result.currency);
  }

  function changeInstrumentType(nextInstrumentType: InstrumentType): void {
    setInstrumentType(nextInstrumentType);
    setSymbolSearchContextVersion((version) => version + 1);
  }

  function changeCurrency(nextCurrency: "CAD" | "USD"): void {
    setCurrency(nextCurrency);
    setSymbolSearchContextVersion((version) => version + 1);
  }

  return <section className="investment-holdings-workspace" aria-labelledby="investment-holdings-title">
    <div className="investment-holdings-heading"><div><p className="investment-holding-eyebrow">Current holdings · FCP / MF + FNB / ETF</p><h2 id="investment-holdings-title">REEI / RDSP holdings</h2><p>Track multiple FCP / MF and FNB / ETF positions inside the same operational account. Ledger entries and prices stay separate from projection planning and Account balance snapshots.</p></div><span className="investment-holding-as-of"><CalendarDays aria-hidden="true" size={16} strokeWidth={1.8} /><span>Valuation date: {asOf}</span></span></div>
    {accounts.length === 0 ? <div className="investment-holdings-empty"><h3>No active REEI / RDSP Accounts</h3><p>Create an account with type <strong>REEI / RDSP</strong> first, then return here to add FCP / MF and FNB / ETF positions.</p><a className="navy-action-button" href="/accounts">Open Accounts</a></div> : <>
      <InvestmentHoldingsAccountPicker accounts={accounts} selectedAccount={selectedAccount} onSelect={setSelectedAccountId} />
      <form id="investment-add-position" action={holdingAction} className="investment-holding-create-form">
        <input type="hidden" name="accountId" value={selectedAccount?.id ?? ""} />
        <fieldset><legend><span className="investment-holding-create-icon" aria-hidden="true"><Plus size={25} strokeWidth={1.7} /></span><span className="investment-holding-create-copy"><strong>Add a position</strong><small>You can add more than one FCP / MF or FNB / ETF, including repeated symbols, to the same REEI / RDSP Account.</small></span></legend><div className="investment-holding-form-grid"><div className="investment-holding-dropdown-field"><span className="investment-holding-dropdown-label" id={instrumentTypeLabelId}>Instrument type</span><InvestmentDropdown id={`${errorScope}-instrument-type`} name="instrumentType" value={instrumentType} options={INSTRUMENT_TYPE_OPTIONS} onChange={changeInstrumentType} aria-labelledby={instrumentTypeLabelId} {...errorProps(holdingState, "instrumentType", errorId("instrumentType"))} /><FieldError state={holdingState} field="instrumentType" id={errorId("instrumentType")} /></div><div className="investment-symbol-search-field"><label htmlFor={`${errorScope}-symbol`}>Symbol</label><InvestmentSymbolSearch key={symbolSearchContextVersion} id={`${errorScope}-symbol`} name="symbol" value={symbol} instrumentType={instrumentType} currency={currency} onChange={setSymbol} onSelect={selectSymbol} {...errorProps(holdingState, "symbol", errorId("symbol"))} /><FieldError state={holdingState} field="symbol" id={errorId("symbol")} /></div><label>Holding name<input name="name" type="text" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Example: Balanced fund" required {...errorProps(holdingState, "name", errorId("name"))} /><FieldError state={holdingState} field="name" id={errorId("name")} /></label><div className="investment-holding-dropdown-field"><span className="investment-holding-dropdown-label" id={currencyLabelId}>Trading currency</span><InvestmentDropdown id={`${errorScope}-currency`} name="currency" value={currency} options={HOLDING_CURRENCY_OPTIONS} onChange={changeCurrency} aria-labelledby={currencyLabelId} {...errorProps(holdingState, "currency", errorId("currency"))} /><FieldError state={holdingState} field="currency" id={errorId("currency")} /></div><div className="investment-holding-form-actions"><button className="navy-action-button" type="submit" disabled={holdingPending}><Plus aria-hidden="true" size={16} strokeWidth={2.2} /><span>{holdingPending ? "Adding…" : "Add position"}</span></button><ActionMessage state={holdingState} /></div></div></fieldset>
      </form>
      {selectedAccount ? <AccountWorkspace account={selectedAccount} asOf={asOf} /> : null}
    </>}
  </section>;
}
