export type MortgageCompoundingConvention = "canadian_semi_annual" | "annual" | "monthly";
export type MortgageProjectionStatus = "actual" | "projected" | "estimated";

export interface MortgagePaymentCalculationInput {
  readonly principalMinor: number;
  readonly paymentMinor: number;
  readonly annualRateBps: number;
  readonly compoundingConvention: MortgageCompoundingConvention;
  /** Calendar days since the previous balance/payment point. Defaults to a regular 14-day payment interval. */
  readonly daysElapsed?: number;
}

export interface MortgagePaymentCalculation {
  readonly interestMinor: number;
  readonly principalPortionMinor: number;
  readonly endingPrincipalMinor: number;
}

export interface MortgageProjectionTerm {
  readonly effectiveOn: string;
  readonly annualRateBps: number;
  readonly compoundingConvention: MortgageCompoundingConvention;
  readonly paymentMinor: number;
  readonly nextPaymentOn: string;
  readonly renewalOn: string;
  readonly payoffOn: string;
}

export interface MortgageProjectionAnchor {
  readonly asOf: string;
  readonly principalMinor: number;
}

export interface MortgageProjectionPoint extends MortgagePaymentCalculation {
  readonly asOf: string;
  readonly principalMinor: number;
  readonly paymentMinor: number;
  readonly status: MortgageProjectionStatus;
  readonly termEffectiveOn: string | null;
}

/** Regular biweekly frequency; accrual itself uses calendar days, not 26 equal periods. */
export const MORTGAGE_PERIODS_PER_YEAR = 26;
export const MORTGAGE_REGULAR_PAYMENT_INTERVAL_DAYS = 14;
export const MORTGAGE_DAY_COUNT_BASIS = 365;

// The rate factor is kept at 18 decimal places and the balance at 12 decimal
// minor units. The public API still accepts and returns integer minor units;
// the additional internal precision prevents repeated cent rounding from
// changing a long projection.
const RATE_SCALE = 1_000_000_000_000_000_000n;
const MONEY_SCALE = 1_000_000_000_000n;
const BPS_PER_WHOLE = 10_000n;
const DAYS_PER_YEAR = BigInt(MORTGAGE_DAY_COUNT_BASIS);

const COMPOUNDING_PERIODS_PER_YEAR: Readonly<Record<MortgageCompoundingConvention, bigint>> = {
  canadian_semi_annual: 2n,
  annual: 1n,
  monthly: 12n,
};

function assertSafeMinor(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer.`);
}

function assertRate(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) throw new RangeError("Annual mortgage rate must be between 0% and 100%.");
}

function assertElapsedDays(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("Mortgage elapsed days must be a non-negative safe integer.");
}

function roundDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError("Division denominator must be positive.");
  if (numerator < 0n) return -roundDiv(-numerator, denominator);
  return (numerator + denominator / 2n) / denominator;
}

function fixedMultiply(left: bigint, right: bigint): bigint {
  return roundDiv(left * right, RATE_SCALE);
}

function fixedPower(base: bigint, exponent: bigint): bigint {
  let result = RATE_SCALE;
  let remaining = exponent;
  let factor = base;
  while (remaining > 0n) {
    if (remaining % 2n === 1n) result = fixedMultiply(result, factor);
    remaining /= 2n;
    if (remaining > 0n) factor = fixedMultiply(factor, factor);
  }
  return result;
}

function fixedNthRoot(value: bigint, exponent: bigint): bigint {
  if (value < RATE_SCALE) throw new RangeError("Mortgage factor must be at least one.");
  if (value === RATE_SCALE) return RATE_SCALE;

  let low = RATE_SCALE;
  let high = value;
  while (low + 1n < high) {
    const middle = (low + high) / 2n;
    if (fixedPower(middle, exponent) <= value) low = middle;
    else high = middle;
  }
  const lowDistance = value - fixedPower(low, exponent);
  const highDistance = fixedPower(high, exponent) - value;
  return lowDistance <= highDistance ? low : high;
}

function toSafeNumber(value: bigint, label: string): number {
  if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`${label} is outside the safe integer range.`);
  return Number(value);
}

type RateFactorCache = Map<string, bigint>;

function rateFactorForDaysFixed(
  annualRateBps: number,
  convention: MortgageCompoundingConvention,
  daysElapsed: number,
  cache?: RateFactorCache,
): bigint {
  assertRate(annualRateBps);
  assertElapsedDays(daysElapsed);
  const cacheKey = `${annualRateBps}:${convention}:${daysElapsed}`;
  const cached = cache?.get(cacheKey);
  if (cached !== undefined) return cached;
  const compoundingPeriods = COMPOUNDING_PERIODS_PER_YEAR[convention];
  const nominalPerCompoundingPeriod = roundDiv(
    RATE_SCALE * BigInt(annualRateBps),
    BPS_PER_WHOLE * compoundingPeriods,
  );
  const elapsedFactor = fixedPower(
    RATE_SCALE + nominalPerCompoundingPeriod,
    compoundingPeriods * BigInt(daysElapsed),
  );
  const result = fixedNthRoot(elapsedFactor, DAYS_PER_YEAR);
  cache?.set(cacheKey, result);
  return result;
}

interface ScaledMortgagePaymentCalculation {
  readonly interestScaled: bigint;
  readonly principalPortionScaled: bigint;
  readonly endingPrincipalScaled: bigint;
}

function calculateMortgagePaymentScaled(
  principalScaled: bigint,
  paymentMinor: number,
  annualRateBps: number,
  compoundingConvention: MortgageCompoundingConvention,
  daysElapsed: number,
  rateFactorCache?: RateFactorCache,
): ScaledMortgagePaymentCalculation {
  const periodicFactor = rateFactorForDaysFixed(annualRateBps, compoundingConvention, daysElapsed, rateFactorCache);
  const interestScaled = roundDiv(principalScaled * (periodicFactor - RATE_SCALE), RATE_SCALE);
  const paymentScaled = BigInt(paymentMinor) * MONEY_SCALE;
  const principalPortionScaled = paymentScaled - interestScaled;
  const calculatedEndingPrincipal = principalScaled - principalPortionScaled;
  return {
    interestScaled,
    principalPortionScaled,
    endingPrincipalScaled: calculatedEndingPrincipal > 0n ? calculatedEndingPrincipal : 0n,
  };
}

export function calculateMortgagePayment(input: MortgagePaymentCalculationInput): MortgagePaymentCalculation {
  assertSafeMinor(input.principalMinor, "Mortgage principal");
  assertSafeMinor(input.paymentMinor, "Mortgage payment");
  const daysElapsed = input.daysElapsed ?? MORTGAGE_REGULAR_PAYMENT_INTERVAL_DAYS;
  assertElapsedDays(daysElapsed);
  const scaled = calculateMortgagePaymentScaled(
    BigInt(input.principalMinor) * MONEY_SCALE,
    input.paymentMinor,
    input.annualRateBps,
    input.compoundingConvention,
    daysElapsed,
  );
  const interestMinor = toSafeNumber(roundDiv(scaled.interestScaled, MONEY_SCALE), "Mortgage interest");
  const principalPortionMinor = Math.min(input.paymentMinor - interestMinor, input.principalMinor);
  // Cap principal applied at the outstanding amount on payoff, then derive
  // the ending balance so the three fields always reconcile exactly.
  const endingPrincipalMinor = input.principalMinor - principalPortionMinor;
  return { interestMinor, principalPortionMinor, endingPrincipalMinor };
}

function latestTermForDate(
  terms: readonly Readonly<{ term: MortgageProjectionTerm; nextPaymentDayNumber: number }>[],
  asOf: string,
): Readonly<{ term: MortgageProjectionTerm; nextPaymentDayNumber: number }> | null {
  let latest: Readonly<{ term: MortgageProjectionTerm; nextPaymentDayNumber: number }> | null = null;
  for (const candidate of terms) {
    if (candidate.term.effectiveOn <= asOf && (!latest || candidate.term.effectiveOn > latest.term.effectiveOn)) latest = candidate;
  }
  return latest;
}

function isoDateDayNumber(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError(`Mortgage date must be a valid ISO date: ${value}.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) throw new RangeError(`Mortgage date must be a valid ISO date: ${value}.`);
  const adjustedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const monthPrime = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * monthPrime + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra;
}

function daysBetweenDates(start: string, end: string): number {
  const result = isoDateDayNumber(end) - isoDateDayNumber(start);
  if (!Number.isSafeInteger(result) || result < 0) throw new RangeError("Mortgage projection dates must be chronological.");
  return result;
}

function isScheduledPaymentDate(asOf: string, asOfDayNumber: number, term: Readonly<{ term: MortgageProjectionTerm; nextPaymentDayNumber: number }>): boolean {
  if (asOf < term.term.nextPaymentOn || asOf > term.term.payoffOn) return false;
  return (asOfDayNumber - term.nextPaymentDayNumber) % MORTGAGE_REGULAR_PAYMENT_INTERVAL_DAYS === 0;
}

function roundedMinor(scaled: bigint, label: string): number {
  return toSafeNumber(roundDiv(scaled, MONEY_SCALE), label);
}

export function projectMortgageTimeline(
  dates: readonly string[],
  anchors: readonly MortgageProjectionAnchor[],
  terms: readonly MortgageProjectionTerm[],
): readonly MortgageProjectionPoint[] {
  const sortedDates = [...new Set(dates)].sort();
  const sortedTerms = [...terms]
    .sort((left, right) => left.effectiveOn < right.effectiveOn ? -1 : left.effectiveOn > right.effectiveOn ? 1 : 0)
    .map((term) => ({ term, nextPaymentDayNumber: isoDateDayNumber(term.nextPaymentOn) }));
  const anchorsByDate = new Map(anchors.map((anchor) => [anchor.asOf, anchor]));
  const rateFactorCache: RateFactorCache = new Map();
  const points: MortgageProjectionPoint[] = [];
  let previousPrincipalScaled: bigint | null = null;
  let previousBalanceDate: string | null = null;
  let previousStatus: MortgageProjectionStatus | null = null;
  let previousTermEffectiveOn: string | null = null;
  // Displayed balance of the last emitted point. Ending principal is derived
  // from this value so each row reconciles exactly; accrual still chains from
  // the unrounded scaled balance above.
  let previousPrincipalMinor = 0;

  for (const asOf of sortedDates) {
    const anchor = anchorsByDate.get(asOf);
    if (anchor) {
      assertSafeMinor(anchor.principalMinor, "Mortgage anchor principal");
      previousPrincipalScaled = BigInt(anchor.principalMinor) * MONEY_SCALE;
      previousBalanceDate = asOf;
      previousStatus = "actual";
      previousTermEffectiveOn = null;
      previousPrincipalMinor = anchor.principalMinor;
      points.push({
        asOf,
        principalMinor: anchor.principalMinor,
        paymentMinor: 0,
        interestMinor: 0,
        principalPortionMinor: 0,
        endingPrincipalMinor: anchor.principalMinor,
        status: "actual",
        termEffectiveOn: null,
      });
      continue;
    }

    if (previousPrincipalScaled === null || previousBalanceDate === null || previousStatus === null) continue;
    const termEntry = latestTermForDate(sortedTerms, asOf);
    const term = termEntry?.term;
    if (!term || asOf > term.payoffOn) continue;

    const asOfDayNumber = isoDateDayNumber(asOf);
    if (termEntry && isScheduledPaymentDate(asOf, asOfDayNumber, termEntry)) {
      const scaled = calculateMortgagePaymentScaled(
        previousPrincipalScaled,
        term.paymentMinor,
        term.annualRateBps,
        term.compoundingConvention,
        daysBetweenDates(previousBalanceDate, asOf),
        rateFactorCache,
      );
      const interestMinor = roundedMinor(scaled.interestScaled, "Mortgage interest");
      const principalPortionMinor = Math.min(term.paymentMinor - interestMinor, previousPrincipalMinor);
      const endingPrincipalMinor = previousPrincipalMinor - principalPortionMinor;
      previousPrincipalScaled = scaled.endingPrincipalScaled;
      previousPrincipalMinor = endingPrincipalMinor;
      previousBalanceDate = asOf;
      previousStatus = asOf <= term.renewalOn ? "projected" : "estimated";
      previousTermEffectiveOn = term.effectiveOn;
      points.push({
        asOf,
        principalMinor: endingPrincipalMinor,
        paymentMinor: term.paymentMinor,
        interestMinor,
        principalPortionMinor,
        endingPrincipalMinor,
        status: previousStatus,
        termEffectiveOn: term.effectiveOn,
      });
      continue;
    }

    // Axis dates between scheduled payments show the last known balance. They
    // are not payment events and therefore never accrue or apply interest.
    points.push({
      asOf,
      principalMinor: previousPrincipalMinor,
      paymentMinor: 0,
      interestMinor: 0,
      principalPortionMinor: 0,
      endingPrincipalMinor: previousPrincipalMinor,
      status: previousStatus,
      termEffectiveOn: previousTermEffectiveOn,
    });
  }

  return points;
}
