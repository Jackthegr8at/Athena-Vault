export const MONEY_CURRENCY_PREFIXES = {
  CAD: "$",
  USD: "US$",
  EUR: "€",
} as const;

export type MoneyCurrency = keyof typeof MONEY_CURRENCY_PREFIXES;

export interface FormatMoneyMinorOptions {
  readonly currency?: MoneyCurrency;
  readonly unavailableLabel?: string;
  readonly negativeSign?: string;
  readonly positiveSign?: string;
  readonly zeroSign?: string;
}

type MoneyMinor = number | bigint | null | undefined;

export function formatMoneyMinor(
  minor: MoneyMinor,
  options: FormatMoneyMinorOptions = {},
): string {
  const {
    currency = "CAD",
    unavailableLabel = "Unavailable",
    negativeSign = "-",
    positiveSign = "",
    zeroSign = "",
  } = options;

  if (
    minor === null
    || minor === undefined
    || (typeof minor === "number" && !Number.isSafeInteger(minor))
    || (typeof minor !== "number" && typeof minor !== "bigint")
  ) {
    return unavailableLabel;
  }

  const value = BigInt(minor);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = (absolute / 100n).toLocaleString("en-CA");
  const cents = String(absolute % 100n).padStart(2, "0");
  const sign = negative ? negativeSign : value > 0n ? positiveSign : zeroSign;

  return `${sign}${MONEY_CURRENCY_PREFIXES[currency]}${whole}.${cents}`;
}

/**
 * Formats safe integer minor units as an ungrouped decimal string for money inputs.
 *
 * Unlike the display formatter, this intentionally omits the currency prefix and
 * grouping separators so the result can be used directly as an HTML input value.
 */
export function formatMoneyInputMinor(minor: number): string {
  if (!Number.isSafeInteger(minor)) {
    throw new RangeError("Money minor units must be a safe integer");
  }

  const value = BigInt(minor);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 100n;
  const cents = String(absolute % 100n).padStart(2, "0");

  return `${negative ? "-" : ""}${whole}.${cents}`;
}

export function formatSignedMoneyMinor(
  minor: MoneyMinor,
  options: FormatMoneyMinorOptions = {},
): string {
  return formatMoneyMinor(minor, {
    ...options,
    positiveSign: options.positiveSign ?? "+",
    zeroSign: options.zeroSign ?? "",
  });
}

const COMPACT_MONEY_SCALES = [
  { divisor: 100_000_000_000_000n, suffix: "T" },
  { divisor: 100_000_000_000n, suffix: "B" },
  { divisor: 100_000_000n, suffix: "M" },
  { divisor: 100_000n, suffix: "K" },
  { divisor: 100n, suffix: "" },
] as const;

/**
 * Formats minor units as a compact chart-axis label such as `$12.3K`.
 *
 * Deterministic across browser and server: integer/BigInt arithmetic only, no
 * `Intl` or floating-point monetary formatting. Axis geometry may pass
 * fractional minor units, which are rounded to the nearest minor unit with
 * ties away from zero. Each label carries at most one meaningful decimal and
 * promotes to the next suffix when rounding reaches 1,000.0 of a unit.
 */
export function formatCompactMoneyMinor(minor: number, currency: MoneyCurrency): string {
  if (!Number.isFinite(minor)) {
    return "Unavailable";
  }

  const rounded = minor < 0 ? -Math.round(-minor) : Math.round(minor);
  if (!Number.isSafeInteger(rounded)) {
    return "Unavailable";
  }

  const value = BigInt(rounded);
  const negative = value < 0n;
  const absolute = negative ? -value : value;

  let scale: (typeof COMPACT_MONEY_SCALES)[number] = COMPACT_MONEY_SCALES[COMPACT_MONEY_SCALES.length - 1]!;
  let coarser: (typeof COMPACT_MONEY_SCALES)[number] | undefined;
  for (const candidate of COMPACT_MONEY_SCALES) {
    if (absolute >= candidate.divisor) {
      scale = candidate;
      break;
    }
    coarser = candidate;
  }

  let tenths = (absolute * 10n + scale.divisor / 2n) / scale.divisor;
  if (tenths >= 10_000n && coarser !== undefined) {
    scale = coarser;
    tenths = (absolute * 10n + scale.divisor / 2n) / scale.divisor;
  }

  const whole = tenths / 10n;
  const fraction = tenths % 10n;
  const label = fraction === 0n ? `${whole}` : `${whole}.${fraction}`;

  return `${negative ? "-" : ""}${MONEY_CURRENCY_PREFIXES[currency]}${label}${scale.suffix}`;
}
