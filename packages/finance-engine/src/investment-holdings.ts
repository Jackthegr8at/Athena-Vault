export const INVESTMENT_HOLDING_UNIT_SCALE = 1_000_000n;
export const INVESTMENT_FX_RATE_SCALE = 1_000_000n;

export type InvestmentHoldingInstrumentType = "mutual_fund" | "etf";
export type InvestmentHoldingTransactionKind = "opening" | "buy" | "sell" | "distribution" | "fee";
export type InvestmentQuoteSource = "manual" | "market";
export type InvestmentHoldingCurrency = "CAD" | "USD";

export interface InvestmentHoldingTransactionInput {
  readonly id: string;
  readonly occurredOn: string;
  readonly kind: InvestmentHoldingTransactionKind;
  readonly unitsMicros: number;
  readonly amountMinor: number;
  readonly feeMinor: number;
}

export interface InvestmentHoldingPriceInput {
  readonly id: string;
  readonly effectiveOn: string;
  readonly priceMinor: number;
  readonly source: InvestmentQuoteSource;
  readonly provider?: string | null;
  readonly quotedAt?: Date | string | null;
}

export interface InvestmentFxRateInput {
  readonly id: string;
  readonly baseCurrency: InvestmentHoldingCurrency;
  readonly quoteCurrency: InvestmentHoldingCurrency;
  readonly effectiveOn: string;
  readonly ratePpm: number;
  readonly source: InvestmentQuoteSource;
  readonly provider?: string | null;
  readonly quotedAt?: Date | string | null;
}

export interface InvestmentHoldingValuation {
  readonly unitsMicros: number;
  readonly costBasisMinor: number;
  readonly averageCostMinor: number | null;
  readonly purchasesMinor: number;
  readonly salesMinor: number;
  readonly distributionsMinor: number;
  readonly feesMinor: number;
  readonly marketValueMinor: number | null;
  readonly unrealizedChangeMinor: number | null;
  readonly price: InvestmentHoldingPriceInput | null;
  readonly fxRate: InvestmentFxRateInput | null;
  readonly cadMarketValueMinor: number | null;
  readonly cadCostBasisMinor: number | null;
  readonly cadUnrealizedChangeMinor: number | null;
}

export class InvestmentHoldingCalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvestmentHoldingCalculationError";
  }
}

function assertSafeNonnegativeInteger(value: number, label: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InvestmentHoldingCalculationError(`${label} must be a non-negative safe integer.`);
  }
  return BigInt(value);
}

function toSafeNumber(value: bigint, label: string): number {
  if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new InvestmentHoldingCalculationError(`${label} exceeds the safe application range.`);
  }
  return Number(value);
}

export function roundHalfUpDivide(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new InvestmentHoldingCalculationError("Division denominator must be positive.");
  if (numerator < 0n) return -roundHalfUpDivide(-numerator, denominator);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

function sourcePriority(source: InvestmentQuoteSource): number {
  return source === "manual" ? 1 : 0;
}

function compareApplicableRows<T extends { readonly id: string; readonly effectiveOn: string; readonly source: InvestmentQuoteSource }>(left: T, right: T): number {
  return (left.effectiveOn < right.effectiveOn ? -1 : left.effectiveOn > right.effectiveOn ? 1 : 0)
    || sourcePriority(left.source) - sourcePriority(right.source)
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

function sortApplicableRows<T extends { readonly id: string; readonly effectiveOn: string; readonly source: InvestmentQuoteSource }>(rows: readonly T[]): readonly T[] {
  const sorted = [...rows].sort(compareApplicableRows);
  if (sorted.length < 2) return sorted;
  const unique: T[] = [sorted[0]!];
  for (let index = 1; index < sorted.length; index += 1) {
    const row = sorted[index]!;
    const previous = unique[unique.length - 1]!;
    if (row.effectiveOn === previous.effectiveOn && row.source === previous.source && row.id === previous.id) continue;
    unique.push(row);
  }
  return unique;
}

function latestApplicable<T extends { readonly id: string; readonly effectiveOn: string; readonly source: InvestmentQuoteSource }>(rows: readonly T[], asOf: string): T | null {
  let low = 0;
  let high = rows.length - 1;
  let selected = -1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    if (rows[middle]!.effectiveOn <= asOf) {
      selected = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return selected < 0 ? null : rows[selected]!;
}

function convertMinorToCad(valueMinor: bigint, rate: InvestmentFxRateInput | null): number | null {
  if (!rate) return null;
  const ratePpm = assertSafeNonnegativeInteger(rate.ratePpm, "FX rate");
  if (ratePpm <= 0n) throw new InvestmentHoldingCalculationError("FX rate must be positive.");
  return toSafeNumber(roundHalfUpDivide(valueMinor * ratePpm, INVESTMENT_FX_RATE_SCALE), "CAD value");
}

function asPriceOrNull(price: InvestmentHoldingPriceInput | null): InvestmentHoldingPriceInput | null {
  if (!price) return null;
  assertSafeNonnegativeInteger(price.priceMinor, "Price");
  return price;
}

function asRateOrNull(rate: InvestmentFxRateInput | null): InvestmentFxRateInput | null {
  if (!rate) return null;
  assertSafeNonnegativeInteger(rate.ratePpm, "FX rate");
  if (rate.baseCurrency !== "USD" || rate.quoteCurrency !== "CAD") {
    throw new InvestmentHoldingCalculationError("Only USD-to-CAD FX rates are supported.");
  }
  if (rate.ratePpm <= 0) throw new InvestmentHoldingCalculationError("FX rate must be positive.");
  return rate;
}

export function calculateInvestmentHoldingValuation(input: {
  readonly currency: InvestmentHoldingCurrency;
  readonly valuationOn: string;
  readonly transactions: readonly InvestmentHoldingTransactionInput[];
  readonly prices: readonly InvestmentHoldingPriceInput[];
  readonly fxRates?: readonly InvestmentFxRateInput[];
}): InvestmentHoldingValuation {
  let unitsMicros = 0n;
  let costBasisMinor = 0n;
  let purchasesMinor = 0n;
  let salesMinor = 0n;
  let distributionsMinor = 0n;
  let feesMinor = 0n;

  const transactions = [...input.transactions].sort((left, right) => (left.occurredOn < right.occurredOn ? -1 : left.occurredOn > right.occurredOn ? 1 : 0) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  for (const transaction of transactions) {
    if (transaction.occurredOn > input.valuationOn) continue;
    const units = assertSafeNonnegativeInteger(transaction.unitsMicros, "Transaction units");
    const amount = assertSafeNonnegativeInteger(transaction.amountMinor, "Transaction amount");
    const fee = assertSafeNonnegativeInteger(transaction.feeMinor, "Transaction fee");

    if (["opening", "buy", "sell"].includes(transaction.kind) && units <= 0n) {
      throw new InvestmentHoldingCalculationError("Opening, buy, and sell entries require units greater than zero.");
    }
    if (transaction.kind === "distribution" && (units !== 0n || amount <= 0n)) {
      throw new InvestmentHoldingCalculationError("Distribution entries require zero units and a positive amount.");
    }
    if (transaction.kind === "fee" && (units !== 0n || amount <= 0n || fee !== 0n)) {
      throw new InvestmentHoldingCalculationError("Fee entries require zero units, a positive amount, and no trade fee.");
    }

    if (transaction.kind === "opening" || transaction.kind === "buy") {
      unitsMicros += units;
      costBasisMinor += amount + fee;
      purchasesMinor += amount + fee;
      feesMinor += fee;
      continue;
    }

    if (transaction.kind === "sell") {
      if (units > unitsMicros) throw new InvestmentHoldingCalculationError("Cannot sell more units than are available.");
      const removedCost = units === unitsMicros ? costBasisMinor : roundHalfUpDivide(costBasisMinor * units, unitsMicros);
      unitsMicros -= units;
      costBasisMinor -= removedCost;
      salesMinor += amount;
      feesMinor += fee;
      continue;
    }

    if (transaction.kind === "distribution") {
      distributionsMinor += amount;
      feesMinor += fee;
      continue;
    }

    feesMinor += amount + fee;
  }

  const sortedPrices = sortApplicableRows(input.prices);
  const price = asPriceOrNull(latestApplicable(sortedPrices, input.valuationOn));
  const sortedFxRates = input.currency === "USD" ? sortApplicableRows(input.fxRates ?? []) : [];
  const fxRate = input.currency === "USD" ? asRateOrNull(latestApplicable(sortedFxRates, input.valuationOn)) : null;
  // A zero-unit position is known to be worth zero even before its first quote
  // is saved. Non-zero positions still require a dated price to be valued.
  const marketValueMinor = unitsMicros === 0n
    ? 0
    : price ? toSafeNumber(roundHalfUpDivide(unitsMicros * BigInt(price.priceMinor), INVESTMENT_HOLDING_UNIT_SCALE), "Market value") : null;
  const unrealizedChangeMinor = marketValueMinor === null ? null : marketValueMinor - toSafeNumber(costBasisMinor, "Cost basis");

  return {
    unitsMicros: toSafeNumber(unitsMicros, "Units held"),
    costBasisMinor: toSafeNumber(costBasisMinor, "Cost basis"),
    averageCostMinor: unitsMicros === 0n ? null : toSafeNumber(roundHalfUpDivide(costBasisMinor * INVESTMENT_HOLDING_UNIT_SCALE, unitsMicros), "Average cost"),
    purchasesMinor: toSafeNumber(purchasesMinor, "Purchases"),
    salesMinor: toSafeNumber(salesMinor, "Sales"),
    distributionsMinor: toSafeNumber(distributionsMinor, "Distributions"),
    feesMinor: toSafeNumber(feesMinor, "Fees"),
    marketValueMinor,
    unrealizedChangeMinor,
    price,
    fxRate,
    cadMarketValueMinor: input.currency === "CAD" || unitsMicros === 0n ? marketValueMinor : marketValueMinor === null ? null : convertMinorToCad(BigInt(marketValueMinor), fxRate),
    cadCostBasisMinor: input.currency === "CAD" || unitsMicros === 0n ? toSafeNumber(costBasisMinor, "Cost basis") : convertMinorToCad(costBasisMinor, fxRate),
    cadUnrealizedChangeMinor: input.currency === "CAD" || unitsMicros === 0n ? unrealizedChangeMinor : unrealizedChangeMinor === null ? null : convertMinorToCad(BigInt(unrealizedChangeMinor), fxRate),
  };
}

export interface InvestmentHoldingSummary {
  readonly nativeTotals: Readonly<Record<InvestmentHoldingCurrency, {
    readonly marketValueMinor: number | null;
    readonly costBasisMinor: number;
    readonly unrealizedChangeMinor: number | null;
  }>>;
  readonly cadMarketValueMinor: number | null;
  readonly cadCostBasisMinor: number | null;
  readonly cadUnrealizedChangeMinor: number | null;
}

export function summarizeInvestmentHoldingValuations(valuations: readonly { readonly currency: InvestmentHoldingCurrency; readonly valuation: InvestmentHoldingValuation }[]): InvestmentHoldingSummary {
  const nativeTotals = {
    CAD: { marketValueMinor: 0n, costBasisMinor: 0n, unrealizedChangeMinor: 0n },
    USD: { marketValueMinor: 0n, costBasisMinor: 0n, unrealizedChangeMinor: 0n },
  } satisfies Record<InvestmentHoldingCurrency, { marketValueMinor: bigint; costBasisMinor: bigint; unrealizedChangeMinor: bigint }>;
  const nativeMarketComplete = { CAD: true, USD: true };
  const nativeChangeComplete = { CAD: true, USD: true };
  let cadMarketValueMinor = 0n;
  let cadCostBasisMinor = 0n;
  let cadUnrealizedChangeMinor = 0n;
  let cadComplete = true;

  for (const { currency, valuation } of valuations) {
    nativeTotals[currency].costBasisMinor += BigInt(valuation.costBasisMinor);
    if (valuation.marketValueMinor === null) nativeMarketComplete[currency] = false;
    else nativeTotals[currency].marketValueMinor += BigInt(valuation.marketValueMinor);
    if (valuation.unrealizedChangeMinor === null) nativeChangeComplete[currency] = false;
    else nativeTotals[currency].unrealizedChangeMinor += BigInt(valuation.unrealizedChangeMinor);
    if (valuation.cadMarketValueMinor === null || valuation.cadUnrealizedChangeMinor === null || valuation.cadCostBasisMinor === null) {
      cadComplete = false;
    } else {
      cadMarketValueMinor += BigInt(valuation.cadMarketValueMinor);
      cadCostBasisMinor += BigInt(valuation.cadCostBasisMinor);
      cadUnrealizedChangeMinor += BigInt(valuation.cadUnrealizedChangeMinor);
    }
  }

  return {
    nativeTotals: {
      CAD: {
        marketValueMinor: nativeMarketComplete.CAD ? toSafeNumber(nativeTotals.CAD.marketValueMinor, "CAD market value") : null,
        costBasisMinor: toSafeNumber(nativeTotals.CAD.costBasisMinor, "CAD cost basis"),
        unrealizedChangeMinor: nativeChangeComplete.CAD ? toSafeNumber(nativeTotals.CAD.unrealizedChangeMinor, "CAD unrealized change") : null,
      },
      USD: {
        marketValueMinor: nativeMarketComplete.USD ? toSafeNumber(nativeTotals.USD.marketValueMinor, "USD market value") : null,
        costBasisMinor: toSafeNumber(nativeTotals.USD.costBasisMinor, "USD cost basis"),
        unrealizedChangeMinor: nativeChangeComplete.USD ? toSafeNumber(nativeTotals.USD.unrealizedChangeMinor, "USD unrealized change") : null,
      },
    },
    cadMarketValueMinor: cadComplete ? toSafeNumber(cadMarketValueMinor, "CAD market value") : null,
    cadCostBasisMinor: cadComplete ? toSafeNumber(cadCostBasisMinor, "CAD cost basis") : null,
    cadUnrealizedChangeMinor: cadComplete ? toSafeNumber(cadUnrealizedChangeMinor, "CAD unrealized change") : null,
  };
}
