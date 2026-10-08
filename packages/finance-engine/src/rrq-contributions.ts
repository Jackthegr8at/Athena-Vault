export interface RrqYearLimitsInput {
  readonly taxYear: number;
  readonly firstMaximumMinor: number;
  readonly additionalMaximumMinor: number;
  readonly ympeMinor: number;
  readonly yampeMinor: number;
  /** Employee contribution rate for earnings from $0 through YMPE, in basis points. */
  readonly firstRateBps: number;
  /** Employee contribution rate for earnings above YMPE through YAMPE, in basis points. */
  readonly additionalRateBps: number;
}

export interface RrqYearLimitsView extends RrqYearLimitsInput {
  readonly totalEmployeeMaximumMinor: number;
}

export interface RrqCumulativeObservationInput {
  readonly snapshotId?: string | null;
  readonly snapshotOn: string;
  readonly completedPayNumber: number;
  readonly rrqContributionYtdMinor: number | null;
}

export interface RrqCumulativeObservation {
  readonly snapshotId: string | null;
  readonly snapshotOn: string;
  readonly completedPayNumber: number;
  readonly rrqContributionYtdMinor: number;
}

export interface RrqContributionInterval {
  readonly fromSnapshotOn: string;
  readonly toSnapshotOn: string;
  readonly fromCompletedPayNumber: number;
  readonly toCompletedPayNumber: number;
  readonly contributionMinor: number;
  readonly payPeriodCount: number;
  readonly perPayMinor: number;
}

export interface RrqContributionEntry {
  readonly snapshotId: string | null;
  readonly snapshotOn: string;
  readonly completedPayNumber: number;
  readonly rrqContributionYtdMinor: number;
  readonly derivedContributionMinor: number | null;
  readonly derivedPayPeriodCount: number | null;
  readonly derivedPerPayMinor: number | null;
  readonly isReanchor: boolean;
}

export type RrqUnavailableReason =
  | "missing-year-limits"
  | "no-observations"
  | "needs-follow-up-observation"
  | "zero-forecast-rate"
  | "maximum-not-reached-within-year";

export interface RrqContributionTrackerInput {
  readonly limits: RrqYearLimitsInput | null;
  readonly observations: readonly RrqCumulativeObservationInput[];
  readonly totalPayPeriods: number;
  readonly paydays?: readonly string[];
  readonly federalCumulativeMinor: number | null;
  readonly provincialCumulativeMinor: number | null;
  readonly provincialProjectedYearEndMinor: number | null;
}

export type RrqProjectedTier = "first" | "additional" | "mixed" | "complete";

export interface RrqContributionTrackerView {
  readonly status: "available" | "unavailable";
  readonly unavailableReason: RrqUnavailableReason | null;
  readonly limits: RrqYearLimitsView | null;
  readonly paidYtdMinor: number | null;
  readonly remainingMinor: number | null;
  readonly overageMinor: number;
  readonly completionPercent: number | null;
  readonly weightedPerPayMinor: number | null;
  /** The next projected pay calculated from provincial gross and RRQ zones. */
  readonly tierAwareForecastPerPayMinor: number | null;
  readonly projectedTier: RrqProjectedTier | null;
  readonly projectedCompletionPayNumber: number | null;
  readonly projectedCompletionOn: string | null;
  readonly recentEntries: readonly RrqContributionEntry[];
  readonly ympeProgressPercent: number | null;
  readonly yampeProgressPercent: number | null;
  readonly federalCumulativeMinor: number | null;
  readonly provincialCumulativeMinor: number | null;
  readonly provincialProjectedYearEndMinor: number | null;
}

const maxSafeInteger = BigInt(Number.MAX_SAFE_INTEGER);

function assertSafeNonnegative(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer.`);
}

function assertPositiveSafe(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer.`);
}

function assertTaxYear(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1900 || value > 2200) throw new RangeError("Tax year must be between 1900 and 2200.");
}

function assertPayNumber(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 366) throw new RangeError(`${label} must be an integer between 1 and 366.`);
}

function assertIsoDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError("RRQ snapshot date must be a valid ISO date.");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new RangeError("RRQ snapshot date must be a valid ISO date.");
}

function safeNumber(value: bigint, label: string): number {
  if (value < 0n || value > maxSafeInteger) throw new RangeError(`${label} is outside safe integer range.`);
  return Number(value);
}

function roundNonnegative(numerator: bigint, denominator: bigint, label: string): number {
  if (denominator <= 0n) throw new RangeError("RRQ divisor must be positive.");
  return safeNumber((numerator + denominator / 2n) / denominator, label);
}

function ceilNonnegative(numerator: bigint, denominator: bigint, label: string): number {
  if (denominator <= 0n) throw new RangeError("RRQ divisor must be positive.");
  return safeNumber((numerator + denominator - 1n) / denominator, label);
}

function percentage(part: number, whole: number): number {
  assertSafeNonnegative(part, "RRQ percentage numerator");
  assertPositiveSafe(whole, "RRQ percentage denominator");
  return Number((BigInt(part) * 10_000n + BigInt(whole) / 2n) / BigInt(whole)) / 100;
}

function validateLimits(limits: RrqYearLimitsInput): void {
  assertTaxYear(limits.taxYear);
  assertSafeNonnegative(limits.firstMaximumMinor, "RRQ first maximum");
  assertSafeNonnegative(limits.additionalMaximumMinor, "RRQ additional maximum");
  assertPositiveSafe(limits.ympeMinor, "RRQ YMPE");
  assertPositiveSafe(limits.yampeMinor, "RRQ YAMPE");
  assertPositiveSafe(limits.firstRateBps, "RRQ first rate");
  assertPositiveSafe(limits.additionalRateBps, "RRQ additional rate");
  if (limits.firstRateBps > 10_000 || limits.additionalRateBps > 10_000) throw new RangeError("RRQ rates cannot exceed 100%.");
  if (limits.yampeMinor < limits.ympeMinor) throw new RangeError("RRQ YAMPE cannot be below YMPE.");
  safeNumber(BigInt(limits.firstMaximumMinor) + BigInt(limits.additionalMaximumMinor), "RRQ employee maximum");
}

function validateObservation(observation: RrqCumulativeObservationInput): void {
  assertIsoDate(observation.snapshotOn);
  assertPayNumber(observation.completedPayNumber, "RRQ completed pay number");
  if (observation.rrqContributionYtdMinor !== null) assertSafeNonnegative(observation.rrqContributionYtdMinor, "RRQ contribution YTD");
}

export function composeRrqYearLimits(limits: RrqYearLimitsInput): RrqYearLimitsView {
  validateLimits(limits);
  return { ...limits, totalEmployeeMaximumMinor: safeNumber(BigInt(limits.firstMaximumMinor) + BigInt(limits.additionalMaximumMinor), "RRQ employee maximum") };
}

export function normalizeRrqObservations(observations: readonly RrqCumulativeObservationInput[]): readonly RrqCumulativeObservation[] {
  for (const observation of observations) validateObservation(observation);
  return observations
    .filter((observation): observation is RrqCumulativeObservationInput & { readonly rrqContributionYtdMinor: number } => observation.rrqContributionYtdMinor !== null)
    .map((observation) => ({
      snapshotId: observation.snapshotId ?? null,
      snapshotOn: observation.snapshotOn,
      completedPayNumber: observation.completedPayNumber,
      rrqContributionYtdMinor: observation.rrqContributionYtdMinor,
    }))
    .sort((left, right) => {
      const dateOrder = left.snapshotOn < right.snapshotOn ? -1 : left.snapshotOn > right.snapshotOn ? 1 : 0;
      if (dateOrder !== 0) return dateOrder;
      const payNumberOrder = left.completedPayNumber - right.completedPayNumber;
      if (payNumberOrder !== 0) return payNumberOrder;
      const leftId = left.snapshotId ?? "";
      const rightId = right.snapshotId ?? "";
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    });
}

function intervalBetween(from: RrqCumulativeObservation, to: RrqCumulativeObservation): RrqContributionInterval | null {
  const payPeriodCount = to.completedPayNumber - from.completedPayNumber;
  const contributionMinor = to.rrqContributionYtdMinor - from.rrqContributionYtdMinor;
  if (payPeriodCount <= 0 || contributionMinor < 0) return null;
  return {
    fromSnapshotOn: from.snapshotOn,
    toSnapshotOn: to.snapshotOn,
    fromCompletedPayNumber: from.completedPayNumber,
    toCompletedPayNumber: to.completedPayNumber,
    contributionMinor,
    payPeriodCount,
    perPayMinor: roundNonnegative(BigInt(contributionMinor), BigInt(payPeriodCount), "RRQ per-pay contribution"),
  };
}

export function deriveRrqContributionIntervals(observations: readonly RrqCumulativeObservationInput[]): readonly RrqContributionInterval[] {
  const normalized = normalizeRrqObservations(observations);
  return normalized.slice(1).flatMap((observation, index) => {
    const previous = normalized[index];
    if (!previous) return [];
    const interval = intervalBetween(previous, observation);
    return interval ? [interval] : [];
  });
}

function entryViewsWithIntervals(observations: readonly RrqCumulativeObservation[]): {
  readonly entries: readonly RrqContributionEntry[];
  readonly intervals: readonly RrqContributionInterval[];
} {
  const entries: RrqContributionEntry[] = [];
  const intervals: RrqContributionInterval[] = [];

  for (const [index, observation] of observations.entries()) {
    const previous = observations[index - 1];
    if (!previous) {
      entries.push({
        snapshotId: observation.snapshotId,
        snapshotOn: observation.snapshotOn,
        completedPayNumber: observation.completedPayNumber,
        rrqContributionYtdMinor: observation.rrqContributionYtdMinor,
        derivedContributionMinor: null,
        derivedPayPeriodCount: null,
        derivedPerPayMinor: null,
        isReanchor: false,
      });
      continue;
    }

    const interval = intervalBetween(previous, observation);
    if (interval) intervals.push(interval);
    entries.push({
      snapshotId: observation.snapshotId,
      snapshotOn: observation.snapshotOn,
      completedPayNumber: observation.completedPayNumber,
      rrqContributionYtdMinor: observation.rrqContributionYtdMinor,
      derivedContributionMinor: interval?.contributionMinor ?? null,
      derivedPayPeriodCount: interval?.payPeriodCount ?? null,
      derivedPerPayMinor: interval?.perPayMinor ?? null,
      isReanchor: interval === null,
    });
  }

  return { entries, intervals };
}

function weightedPerPay(intervals: readonly RrqContributionInterval[]): number | null {
  if (intervals.length === 0) return null;
  const recent = intervals.slice(-4).reverse();
  const denominator = BigInt(recent.reduce((sum, _interval, index) => sum + 4 - index, 0));
  const numerator = recent.reduce((sum, interval, index) => sum + BigInt(interval.perPayMinor) * BigInt(4 - index), 0n);
  return roundNonnegative(numerator, denominator, "RRQ weighted per-pay contribution");
}

function paydayFor(paydays: readonly string[], completedPayNumber: number, fallback: string | null): string | null {
  return paydays[completedPayNumber - 1] ?? fallback;
}

function contributionForGross(grossMinor: number, rateBps: number, label: string): number {
  assertSafeNonnegative(grossMinor, "RRQ projected gross");
  assertPositiveSafe(rateBps, "RRQ contribution rate");
  return roundNonnegative(BigInt(grossMinor) * BigInt(rateBps), 10_000n, label);
}

function grossInZone(startMinor: number, endMinor: number, lowerMinor: number, upperMinor: number): number {
  const start = Math.max(startMinor, lowerMinor);
  const end = Math.min(endMinor, upperMinor);
  return Math.max(0, end - start);
}

interface TierAwareProjection {
  readonly nextPayMinor: number | null;
  readonly projectedCompletionPayNumber: number | null;
  readonly tier: RrqProjectedTier | null;
}

function tierAwareProjection(
  limits: RrqYearLimitsView,
  latest: RrqCumulativeObservation,
  totalPayPeriods: number,
  provincialCumulativeMinor: number | null,
  provincialProjectedYearEndMinor: number | null,
): TierAwareProjection {
  if (provincialCumulativeMinor === null || provincialProjectedYearEndMinor === null) {
    return { nextPayMinor: null, projectedCompletionPayNumber: null, tier: null };
  }
  assertSafeNonnegative(provincialCumulativeMinor, "Provincial cumulative salary");
  assertSafeNonnegative(provincialProjectedYearEndMinor, "Provincial projected salary");

  const futurePayPeriods = totalPayPeriods - latest.completedPayNumber;
  if (futurePayPeriods <= 0) return { nextPayMinor: null, projectedCompletionPayNumber: latest.completedPayNumber, tier: "complete" };

  const paid = latest.rrqContributionYtdMinor;
  if (paid >= limits.totalEmployeeMaximumMinor) {
    return { nextPayMinor: 0, projectedCompletionPayNumber: latest.completedPayNumber, tier: "complete" };
  }
  const grossRemaining = Math.max(0, provincialProjectedYearEndMinor - provincialCumulativeMinor);
  if (grossRemaining === 0) return { nextPayMinor: null, projectedCompletionPayNumber: null, tier: null };

  let firstRemainingMinor = Math.max(0, limits.firstMaximumMinor - Math.min(paid, limits.firstMaximumMinor));
  let additionalRemainingMinor = Math.max(0, limits.additionalMaximumMinor - Math.max(0, paid - limits.firstMaximumMinor));
  let currentGrossMinor = provincialCumulativeMinor;
  let nextPayMinor: number | null = null;
  let projectedCompletionPayNumber: number | null = null;
  let firstPayZone: "first" | "additional" | "mixed" | "complete" = "complete";

  for (let step = 1; step <= futurePayPeriods; step += 1) {
    const nextGrossMinor = provincialCumulativeMinor + roundNonnegative(BigInt(grossRemaining) * BigInt(step), BigInt(futurePayPeriods), "RRQ projected gross");
    const firstZoneGrossMinor = grossInZone(currentGrossMinor, nextGrossMinor, 0, limits.ympeMinor);
    const additionalZoneGrossMinor = grossInZone(currentGrossMinor, nextGrossMinor, limits.ympeMinor, limits.yampeMinor);
    const firstRawMinor = contributionForGross(firstZoneGrossMinor, limits.firstRateBps, "RRQ first-tier contribution");
    const additionalRawMinor = contributionForGross(additionalZoneGrossMinor, limits.additionalRateBps, "RRQ additional-tier contribution");
    const firstContributionMinor = Math.min(firstRawMinor, firstRemainingMinor);
    const additionalContributionMinor = Math.min(additionalRawMinor, additionalRemainingMinor);
    const contributionMinor = firstContributionMinor + additionalContributionMinor;

    if (step === 1) {
      nextPayMinor = contributionMinor;
      if (firstZoneGrossMinor > 0 && additionalZoneGrossMinor > 0) firstPayZone = "mixed";
      else if (firstZoneGrossMinor > 0) firstPayZone = "first";
      else if (additionalZoneGrossMinor > 0) firstPayZone = "additional";
      else firstPayZone = "complete";
    }

    firstRemainingMinor -= firstContributionMinor;
    additionalRemainingMinor -= additionalContributionMinor;
    if (firstRemainingMinor === 0 && additionalRemainingMinor === 0) {
      projectedCompletionPayNumber = latest.completedPayNumber + step;
      break;
    }
    currentGrossMinor = nextGrossMinor;
  }

  return {
    nextPayMinor,
    projectedCompletionPayNumber,
    tier: firstPayZone,
  };
}

export function calculateRrqContributionTracker(input: RrqContributionTrackerInput): RrqContributionTrackerView {
  assertPayNumber(input.totalPayPeriods, "RRQ total pay periods");
  assertSafeNonnegative(input.federalCumulativeMinor ?? 0, "Federal cumulative salary");
  assertSafeNonnegative(input.provincialCumulativeMinor ?? 0, "Provincial cumulative salary");
  assertSafeNonnegative(input.provincialProjectedYearEndMinor ?? 0, "Provincial projected salary");
  const limits = input.limits ? composeRrqYearLimits(input.limits) : null;
  const observations = normalizeRrqObservations(input.observations);
  for (const observation of observations) {
    if (observation.completedPayNumber > input.totalPayPeriods) throw new RangeError("RRQ completed pay number cannot exceed total pay periods.");
  }
  const { entries, intervals } = entryViewsWithIntervals(observations);
  const latest = observations.at(-1) ?? null;
  const paidYtdMinor = latest?.rrqContributionYtdMinor ?? null;
  const totalMaximumMinor = limits?.totalEmployeeMaximumMinor ?? null;
  const remainingMinor = totalMaximumMinor === null || paidYtdMinor === null ? totalMaximumMinor : Math.max(0, totalMaximumMinor - paidYtdMinor);
  const overageMinor = totalMaximumMinor === null || paidYtdMinor === null ? 0 : Math.max(0, paidYtdMinor - totalMaximumMinor);
  const completionPercent = totalMaximumMinor === null || paidYtdMinor === null ? null : percentage(paidYtdMinor, totalMaximumMinor);
  const weightedRateMinor = weightedPerPay(intervals) ?? (observations.length === 1 && latest ? roundNonnegative(BigInt(latest.rrqContributionYtdMinor), BigInt(latest.completedPayNumber), "RRQ fallback per-pay contribution") : null);
  const paydays = input.paydays ?? [];
  const tierProjection = limits && latest
    ? tierAwareProjection(limits, latest, input.totalPayPeriods, input.provincialCumulativeMinor, input.provincialProjectedYearEndMinor)
    : { nextPayMinor: null, projectedCompletionPayNumber: null, tier: null };
  let unavailableReason: RrqUnavailableReason | null = null;
  let projectedCompletionPayNumber: number | null = null;
  let projectedCompletionOn: string | null = null;

  if (!limits) unavailableReason = "missing-year-limits";
  else if (!latest) unavailableReason = "no-observations";
  else if (remainingMinor === 0) {
    projectedCompletionPayNumber = latest.completedPayNumber;
    projectedCompletionOn = paydayFor(paydays, latest.completedPayNumber, latest.snapshotOn);
  } else if (tierProjection.projectedCompletionPayNumber !== null) {
    projectedCompletionPayNumber = tierProjection.projectedCompletionPayNumber;
    projectedCompletionOn = paydayFor(paydays, projectedCompletionPayNumber, null);
  } else if (weightedRateMinor === null) unavailableReason = "needs-follow-up-observation";
  else if (weightedRateMinor <= 0) unavailableReason = "zero-forecast-rate";
  else {
    const additionalPayPeriods = ceilNonnegative(BigInt(remainingMinor ?? 0), BigInt(weightedRateMinor), "RRQ projected pay periods");
    const projectedPayNumber = BigInt(latest.completedPayNumber) + BigInt(additionalPayPeriods);
    if (projectedPayNumber > BigInt(input.totalPayPeriods)) unavailableReason = "maximum-not-reached-within-year";
    else {
      projectedCompletionPayNumber = Number(projectedPayNumber);
      projectedCompletionOn = paydayFor(paydays, projectedCompletionPayNumber, null);
    }
  }

  return {
    status: limits && latest ? "available" : "unavailable",
    unavailableReason,
    limits,
    paidYtdMinor,
    remainingMinor,
    overageMinor,
    completionPercent,
    weightedPerPayMinor: weightedRateMinor,
    tierAwareForecastPerPayMinor: tierProjection.nextPayMinor,
    projectedTier: tierProjection.tier,
    projectedCompletionPayNumber,
    projectedCompletionOn,
    recentEntries: entries.slice(-6).reverse(),
    ympeProgressPercent: limits && input.provincialCumulativeMinor !== null ? percentage(input.provincialCumulativeMinor, limits.ympeMinor) : null,
    yampeProgressPercent: limits && input.provincialCumulativeMinor !== null ? percentage(input.provincialCumulativeMinor, limits.yampeMinor) : null,
    federalCumulativeMinor: input.federalCumulativeMinor,
    provincialCumulativeMinor: input.provincialCumulativeMinor,
    provincialProjectedYearEndMinor: input.provincialProjectedYearEndMinor,
  };
}
