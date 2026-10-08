/**
 * Shared serializable contract for the Overview net-worth history read model.
 *
 * All monetary values are integer minor units. Database adapters and UI
 * components may add behavior around this contract, but they must not invent
 * a second shape for the same timeline.
 */

export type NetWorthHistoryRange = "1m" | "3m" | "6m" | "1y" | "all";

export const NET_WORTH_HISTORY_RANGES: readonly NetWorthHistoryRange[] = ["1m", "3m", "6m", "1y", "all"];
export const NET_WORTH_HISTORY_DEFAULT_RANGE: NetWorthHistoryRange = "1y";
export const NET_WORTH_HISTORY_DEFAULT_PROJECTED_MONTHS = 6;

export type NetWorthHistoryComponent = "netWorth" | "investments" | "homeEquity" | "cashOther";

export const NET_WORTH_HISTORY_COMPONENTS: readonly NetWorthHistoryComponent[] = [
  "netWorth",
  "investments",
  "homeEquity",
  "cashOther",
];

export type NetWorthHistoryPhase = "actual" | "projected";

export interface NetWorthHistoryPoint {
  readonly asOf: string;
  readonly phase: NetWorthHistoryPhase;
  readonly isFirstProjected: boolean;
  readonly netWorthMinor: number | null;
  readonly investmentsMinor: number | null;
  readonly homeEquityMinor: number | null;
  readonly cashOtherMinor: number | null;
}

export interface NetWorthHistoryChange {
  readonly component: NetWorthHistoryComponent;
  readonly changeMinor: number | null;
  readonly fromAsOf: string | null;
  readonly toAsOf: string | null;
}

export interface NetWorthHistoryModel {
  readonly currency: "CAD" | "USD" | "EUR";
  readonly evaluationDate: string;
  readonly historicalFrom: string | null;
  readonly projectedThrough: string | null;
  readonly firstProjectedAsOf: string | null;
  readonly selectedRange: NetWorthHistoryRange;
  readonly defaultRange: NetWorthHistoryRange;
  readonly points: readonly NetWorthHistoryPoint[];
  readonly changes: readonly NetWorthHistoryChange[];
}

/**
 * Example serializable point (all amounts are integer minor units):
 * `{ asOf: "2026-08-22", phase: "actual", isFirstProjected: false,
 *    netWorthMinor: 38291303, investmentsMinor: 15623041,
 *    homeEquityMinor: 17368343, cashOtherMinor: 529919 }`.
 */

/**
 * A component value before it is merged into the shared timeline.
 * `null` means unavailable, not a zero balance.
 */
export interface NetWorthHistoryComponentValue {
  readonly asOf: string;
  readonly phase: NetWorthHistoryPhase;
  readonly valueMinor: number | null;
}

export interface NetWorthHistoryRangeOptions {
  readonly evaluationDate: string;
  readonly projectedThrough: string | null;
  readonly selectedRange: NetWorthHistoryRange;
}

export type NetWorthAccountCategory = "investment" | "cashOther" | "liability";

/**
 * Account kinds whose balances are assets held for investment purposes.
 *
 * `other` is intentionally not in this set. Its user-defined labels do not
 * establish investment semantics, so it belongs to cash/other by default.
 */
export const NET_WORTH_HISTORY_INVESTMENT_ACCOUNT_KINDS = [
  "crypto",
  "fhsa",
  "investment",
  "non_registered",
  "resp",
  "rdsp",
  "rrsp",
  "tfsa",
] as const;

export const NET_WORTH_HISTORY_LIABILITY_ACCOUNT_KINDS = ["credit", "loan"] as const;

export interface NetWorthHistoryAccountValue {
  readonly asOf: string;
  readonly phase: NetWorthHistoryPhase;
  readonly kind: string;
  readonly balanceMinor: number | null;
  readonly isActive?: boolean;
}

export interface NetWorthHistoryAccountSeries {
  readonly investments: readonly NetWorthHistoryComponentValue[];
  readonly cashOther: readonly NetWorthHistoryComponentValue[];
  readonly liabilities: readonly NetWorthHistoryComponentValue[];
}

export interface NetWorthHistoryTimelineInput {
  readonly evaluationDate: string;
  /** `undefined` uses the approved six-month default; `null` disables the upper projection bound. */
  readonly projectedThrough?: string | null;
  readonly investments: readonly NetWorthHistoryComponentValue[];
  readonly cashOther: readonly NetWorthHistoryComponentValue[];
  /** Liability values are positive balances that reduce total net worth. */
  readonly liabilities: readonly NetWorthHistoryComponentValue[];
  readonly homeEquity: readonly NetWorthHistoryComponentValue[];
}

export interface NetWorthHistoryModelInput extends NetWorthHistoryTimelineInput {
  readonly currency?: NetWorthHistoryModel["currency"];
  readonly selectedRange?: NetWorthHistoryRange;
}

export interface NetWorthHistoryRangeWindow {
  readonly fromAsOf: string | null;
  readonly throughAsOf: string | null;
}

const NET_WORTH_HISTORY_RANGE_MONTHS: Readonly<Record<Exclude<NetWorthHistoryRange, "all">, number>> = {
  "1m": 1,
  "3m": 3,
  "6m": 6,
  "1y": 12,
};

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

interface ParsedIsoDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function parseIsoDate(value: string, label: string): ParsedIsoDate {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) throw new RangeError(`${label} must be a valid ISO date.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`${label} must be a valid ISO date.`);
  }
  return { year, month, day };
}

export function isValidNetWorthHistoryIsoDate(value: string): boolean {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function assertPhase(value: string, label: string): asserts value is NetWorthHistoryPhase {
  if (value !== "actual" && value !== "projected") throw new RangeError(`${label} must be actual or projected.`);
}

function assertSafeMinorUnit(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer.`);
}

function assertOptionalSafeMinorUnit(value: number | null, label: string): void {
  if (value !== null) assertSafeMinorUnit(value, label);
}
function toSafeMinorUnit(value: bigint, label: string): number {
  if (value < MIN_SAFE_BIGINT || value > MAX_SAFE_BIGINT) throw new RangeError(`${label} is outside the safe integer range.`);
  return Number(value);
}

export function addMinorUnitsSafely(left: number, right: number, label = "Minor-unit sum"): number {
  assertSafeMinorUnit(left, "Left minor-unit value");
  assertSafeMinorUnit(right, "Right minor-unit value");
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new RangeError(`${label} is outside the safe integer range.`);
  return result;
}

export function subtractMinorUnitsSafely(left: number, right: number, label = "Minor-unit difference"): number {
  assertSafeMinorUnit(left, "Left minor-unit value");
  assertSafeMinorUnit(right, "Right minor-unit value");
  const result = left - right;
  if (!Number.isSafeInteger(result)) throw new RangeError(`${label} is outside the safe integer range.`);
  return result;
}

function normalizedAccountKind(kind: string): string {
  return kind.trim().toLowerCase();
}

export function classifyNetWorthAccountKind(kind: string): NetWorthAccountCategory {
  const normalizedKind = normalizedAccountKind(kind);
  if ((NET_WORTH_HISTORY_INVESTMENT_ACCOUNT_KINDS as readonly string[]).includes(normalizedKind)) return "investment";
  if ((NET_WORTH_HISTORY_LIABILITY_ACCOUNT_KINDS as readonly string[]).includes(normalizedKind)) return "liability";
  return "cashOther";
}

export function isNetWorthInvestmentAccountKind(kind: string): boolean {
  return classifyNetWorthAccountKind(kind) === "investment";
}

export function isNetWorthLiabilityAccountKind(kind: string): boolean {
  return classifyNetWorthAccountKind(kind) === "liability";
}

export function isNetWorthCashOtherAccountKind(kind: string): boolean {
  return classifyNetWorthAccountKind(kind) === "cashOther";
}

interface AggregatedComponentValue {
  readonly asOf: string;
  readonly phase: NetWorthHistoryPhase;
  readonly valueMinor: number | null;
}

interface AggregatedAccountValue extends AggregatedComponentValue {
  readonly hasKnownValue: boolean;
}

function mergeSameDateValue(
  current: AggregatedComponentValue | undefined,
  value: NetWorthHistoryComponentValue,
  label: string,
): AggregatedComponentValue {
  if (!current) return { asOf: value.asOf, phase: value.phase, valueMinor: value.valueMinor };
  const phase: NetWorthHistoryPhase = current.phase === "projected" || value.phase === "projected" ? "projected" : "actual";
  const valueMinor = current.valueMinor === null || value.valueMinor === null
    ? null
    : addMinorUnitsSafely(current.valueMinor, value.valueMinor, label);
  return { asOf: value.asOf, phase, valueMinor };
}

function aggregateComponentValues(
  values: readonly NetWorthHistoryComponentValue[],
  label: string,
): readonly NetWorthHistoryComponentValue[] {
  const byDate = new Map<string, AggregatedComponentValue>();
  for (const value of values) {
    parseIsoDate(value.asOf, `${label} date`);
    assertPhase(value.phase, `${label} phase`);
    assertOptionalSafeMinorUnit(value.valueMinor, `${label} value`);
    byDate.set(value.asOf, mergeSameDateValue(byDate.get(value.asOf), value, label));
  }
  return [...byDate.values()]
    .sort((left, right) => left.asOf < right.asOf ? -1 : left.asOf > right.asOf ? 1 : 0);
}

/**
 * Classify and aggregate account balances by date. This is intentionally
 * separate from timeline carry-forward: adapters can first expand their
 * account snapshots/projections to the dates they own, then pass these
 * component series to `normalizeNetWorthHistoryTimeline`.
 */
export function aggregateNetWorthHistoryAccountValues(
  values: readonly NetWorthHistoryAccountValue[],
): NetWorthHistoryAccountSeries {
  const byCategoryAndDate = new Map<"investment" | "cashOther" | "liability", Map<string, AggregatedAccountValue>>();
  byCategoryAndDate.set("investment", new Map());
  byCategoryAndDate.set("cashOther", new Map());
  byCategoryAndDate.set("liability", new Map());

  for (const value of values) {
    parseIsoDate(value.asOf, "Account balance date");
    assertPhase(value.phase, "Account balance phase");
    assertOptionalSafeMinorUnit(value.balanceMinor, "Account balance");
    if (value.isActive === false) continue;
    const category = classifyNetWorthAccountKind(value.kind);
    const byDate = byCategoryAndDate.get(category);
    if (!byDate) continue;
    const current = byDate.get(value.asOf);
    const phase: NetWorthHistoryPhase = current?.phase === "projected" || value.phase === "projected" ? "projected" : "actual";
    if (!current) {
      byDate.set(value.asOf, {
        asOf: value.asOf,
        phase,
        valueMinor: value.balanceMinor,
        hasKnownValue: value.balanceMinor !== null,
      });
      continue;
    }

    if (value.balanceMinor === null) {
      byDate.set(value.asOf, { ...current, phase });
      continue;
    }

    const valueMinor = current.hasKnownValue && current.valueMinor !== null
      ? addMinorUnitsSafely(current.valueMinor, value.balanceMinor, `${category} account values`)
      : value.balanceMinor;
    byDate.set(value.asOf, { ...current, phase, valueMinor, hasKnownValue: true });
  }

  const toSeries = (category: "investment" | "cashOther" | "liability", label: string): readonly NetWorthHistoryComponentValue[] => [...(byCategoryAndDate.get(category)?.values() ?? [])]
    .sort((left, right) => left.asOf < right.asOf ? -1 : left.asOf > right.asOf ? 1 : 0)
    .map(({ asOf, phase, valueMinor }) => {
      assertOptionalSafeMinorUnit(valueMinor, `${label} value`);
      return { asOf, phase, valueMinor };
    });

  return {
    investments: toSeries("investment", "Investment account values"),
    cashOther: toSeries("cashOther", "Cash/other account values"),
    liabilities: toSeries("liability", "Liability account values"),
  };
}

export function calculateHomeEquityMinor(
  marketValueMinor: number | null,
  mortgagePrincipalMinor: number | null,
): number | null {
  assertOptionalSafeMinorUnit(marketValueMinor, "Home market value");
  assertOptionalSafeMinorUnit(mortgagePrincipalMinor, "Mortgage principal");
  if (marketValueMinor === null || mortgagePrincipalMinor === null) return null;
  return toSafeMinorUnit(BigInt(marketValueMinor) - BigInt(mortgagePrincipalMinor), "Home equity");
}

export interface NetWorthHistoryTotalInput {
  readonly cashOtherMinor: number | null;
  readonly investmentsMinor: number | null;
  readonly homeEquityMinor: number | null;
  /** Positive liability balance to subtract from assets. */
  readonly liabilitiesMinor: number | null;
}

export function calculateNetWorthHistoryTotalMinor(input: NetWorthHistoryTotalInput): number | null {
  assertOptionalSafeMinorUnit(input.cashOtherMinor, "Cash/other total");
  assertOptionalSafeMinorUnit(input.investmentsMinor, "Investment total");
  assertOptionalSafeMinorUnit(input.homeEquityMinor, "Home-equity total");
  assertOptionalSafeMinorUnit(input.liabilitiesMinor, "Liability total");
  if (input.cashOtherMinor === null || input.investmentsMinor === null || input.homeEquityMinor === null || input.liabilitiesMinor === null) return null;
  return toSafeMinorUnit(
    BigInt(input.cashOtherMinor)
      + BigInt(input.investmentsMinor)
      + BigInt(input.homeEquityMinor)
      - BigInt(input.liabilitiesMinor),
    "Net-worth total",
  );
}

function assertTimelineInput(input: NetWorthHistoryTimelineInput, projectedThrough: string | null): {
  readonly investments: readonly NetWorthHistoryComponentValue[];
  readonly cashOther: readonly NetWorthHistoryComponentValue[];
  readonly liabilities: readonly NetWorthHistoryComponentValue[];
  readonly homeEquity: readonly NetWorthHistoryComponentValue[];
} {
  parseIsoDate(input.evaluationDate, "Evaluation date");
  if (projectedThrough !== null) {
    parseIsoDate(projectedThrough, "Projection end date");
    if (projectedThrough < input.evaluationDate) throw new RangeError("Projection end date must be on or after the evaluation date.");
  }
  return {
    investments: aggregateComponentValues(input.investments, "Investment values"),
    cashOther: aggregateComponentValues(input.cashOther, "Cash/other values"),
    liabilities: aggregateComponentValues(input.liabilities, "Liability values"),
    homeEquity: aggregateComponentValues(input.homeEquity, "Home-equity values"),
  };
}

function effectiveProjectionEnd(evaluationDate: string, projectedThrough: string | null | undefined): string | null {
  return projectedThrough === undefined ? addNetWorthHistoryMonths(evaluationDate, NET_WORTH_HISTORY_DEFAULT_PROJECTED_MONTHS) : projectedThrough;
}

function componentValueAtDate(
  values: readonly NetWorthHistoryComponentValue[],
  dates: readonly string[],
  emptyValue: number | null,
): Map<string, number | null> {
  const byDate = new Map(values.map((value) => [value.asOf, value.valueMinor]));
  const hasSourceValues = values.length > 0;
  let carried: number | null = hasSourceValues ? null : emptyValue;
  const result = new Map<string, number | null>();
  for (const asOf of dates) {
    if (byDate.has(asOf)) carried = byDate.get(asOf) ?? null;
    result.set(asOf, carried);
  }
  return result;
}

function phaseAtDate(
  asOf: string,
  evaluationDate: string,
  projectedDates: ReadonlySet<string>,
): NetWorthHistoryPhase {
  return asOf > evaluationDate || projectedDates.has(asOf) ? "projected" : "actual";
}

export function assertNetWorthHistoryPointsChronological(points: readonly NetWorthHistoryPoint[]): void {
  let previousAsOf: string | null = null;
  for (const point of points) {
    if (previousAsOf !== null && point.asOf < previousAsOf) {
      throw new RangeError("Net-worth history points must be chronological.");
    }
    assertPhase(point.phase, "Net-worth history point phase");
    assertOptionalSafeMinorUnit(point.netWorthMinor, "Net-worth history total");
    assertOptionalSafeMinorUnit(point.investmentsMinor, "Net-worth history investments");
    assertOptionalSafeMinorUnit(point.homeEquityMinor, "Net-worth history Home equity");
    assertOptionalSafeMinorUnit(point.cashOtherMinor, "Net-worth history cash/other");
    previousAsOf = point.asOf;
  }
}

function withFirstProjectedPoint(points: readonly NetWorthHistoryPoint[]): readonly NetWorthHistoryPoint[] {
  let firstProjectedFound = false;
  return points.map((point) => {
    const isFirstProjected = point.phase === "projected" && !firstProjectedFound;
    if (isFirstProjected) firstProjectedFound = true;
    return { ...point, isFirstProjected };
  });
}

/**
 * Build one chronological point axis from the supplied component dates.
 * Missing dates carry the last known component value; an explicit null stays
 * null. Empty account buckets are treated as zero, while a missing Home
 * equity series remains unavailable.
 */
export function normalizeNetWorthHistoryTimeline(
  input: NetWorthHistoryTimelineInput,
): readonly NetWorthHistoryPoint[] {
  const projectedThrough = effectiveProjectionEnd(input.evaluationDate, input.projectedThrough);
  const aggregated = assertTimelineInput(input, projectedThrough);
  const series = [aggregated.investments, aggregated.cashOther, aggregated.liabilities, aggregated.homeEquity];
  const rawDates = [...new Set(series.flatMap((values) => values.map((value) => value.asOf)))].sort();
  const dates = rawDates.filter((asOf) => projectedThrough === null || asOf <= projectedThrough);
  if (dates.length === 0) return [];

  const investments = componentValueAtDate(aggregated.investments, dates, 0);
  const cashOther = componentValueAtDate(aggregated.cashOther, dates, 0);
  const liabilities = componentValueAtDate(aggregated.liabilities, dates, 0);
  const homeEquity = componentValueAtDate(aggregated.homeEquity, dates, null);
  const allValues = series.flat();
  const projectedDates = new Set(allValues.filter((value) => value.phase === "projected").map((value) => value.asOf));
  const points = dates.map((asOf): NetWorthHistoryPoint => {
    const investmentsMinor = investments.get(asOf) ?? null;
    const cashOtherMinor = cashOther.get(asOf) ?? null;
    const liabilitiesMinor = liabilities.get(asOf) ?? null;
    const homeEquityMinor = homeEquity.get(asOf) ?? null;
    return {
      asOf,
      phase: phaseAtDate(asOf, input.evaluationDate, projectedDates),
      isFirstProjected: false,
      netWorthMinor: calculateNetWorthHistoryTotalMinor({ cashOtherMinor, investmentsMinor, homeEquityMinor, liabilitiesMinor }),
      investmentsMinor,
      homeEquityMinor,
      cashOtherMinor,
    };
  });
  return withFirstProjectedPoint(points);
}

function assertRange(value: string): asserts value is NetWorthHistoryRange {
  if (!(NET_WORTH_HISTORY_RANGES as readonly string[]).includes(value)) throw new RangeError(`Unsupported net-worth history range: ${value}.`);
}

export function addNetWorthHistoryMonths(isoDate: string, months: number): string {
  const parsed = parseIsoDate(isoDate, "ISO date");
  if (!Number.isSafeInteger(months)) throw new RangeError("Month offset must be a safe integer.");
  const totalMonths = parsed.year * 12 + (parsed.month - 1) + months;
  const year = Math.floor(totalMonths / 12);
  const month = totalMonths - year * 12 + 1;
  if (year < 0 || year > 9_999) throw new RangeError("ISO date month offset is outside the supported range.");
  const day = Math.min(parsed.day, daysInMonth(year, month));
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getNetWorthHistoryRangeWindow(options: NetWorthHistoryRangeOptions): NetWorthHistoryRangeWindow {
  parseIsoDate(options.evaluationDate, "Evaluation date");
  if (options.projectedThrough !== null) {
    parseIsoDate(options.projectedThrough, "Projection end date");
    if (options.projectedThrough < options.evaluationDate) throw new RangeError("Projection end date must be on or after the evaluation date.");
  }
  assertRange(options.selectedRange);
  return {
    fromAsOf: options.selectedRange === "all"
      ? null
      : addNetWorthHistoryMonths(options.evaluationDate, -NET_WORTH_HISTORY_RANGE_MONTHS[options.selectedRange]),
    throughAsOf: options.projectedThrough,
  };
}

export function selectNetWorthHistoryRange(
  points: readonly NetWorthHistoryPoint[],
  options: NetWorthHistoryRangeOptions,
): readonly NetWorthHistoryPoint[] {
  const window = getNetWorthHistoryRangeWindow(options);
  assertNetWorthHistoryPointsChronological(points);
  return points.filter((point) =>
    (window.fromAsOf === null || point.asOf >= window.fromAsOf)
      && (window.throughAsOf === null || point.asOf <= window.throughAsOf),
  );
}

export function calculateNetWorthHistoryChanges(
  points: readonly NetWorthHistoryPoint[],
): readonly NetWorthHistoryChange[] {
  assertNetWorthHistoryPointsChronological(points);
  return NET_WORTH_HISTORY_COMPONENTS.map((component): NetWorthHistoryChange => {
    const firstKnown = points.find((point) => point[`${component}Minor`] !== null);
    const lastPoint = points.at(-1);
    const lastValue = lastPoint?.[`${component}Minor`] ?? null;
    if (!firstKnown || !lastPoint || lastValue === null) {
      return { component, changeMinor: null, fromAsOf: firstKnown?.asOf ?? null, toAsOf: lastValue === null ? null : lastPoint?.asOf ?? null };
    }
    const firstValue = firstKnown[`${component}Minor`];
    if (firstValue === null) return { component, changeMinor: null, fromAsOf: null, toAsOf: lastPoint.asOf };
    return {
      component,
      changeMinor: subtractMinorUnitsSafely(lastValue, firstValue, `${component} change`),
      fromAsOf: firstKnown.asOf,
      toAsOf: lastPoint.asOf,
    };
  });
}

export function buildNetWorthHistoryModel(input: NetWorthHistoryModelInput): NetWorthHistoryModel {
  parseIsoDate(input.evaluationDate, "Evaluation date");
  const projectedThrough = effectiveProjectionEnd(input.evaluationDate, input.projectedThrough);
  const selectedRange = input.selectedRange ?? NET_WORTH_HISTORY_DEFAULT_RANGE;
  assertRange(selectedRange);
  const points = normalizeNetWorthHistoryTimeline({ ...input, projectedThrough });
  const selectedPoints = selectNetWorthHistoryRange(points, {
    evaluationDate: input.evaluationDate,
    projectedThrough,
    selectedRange,
  });
  const window = getNetWorthHistoryRangeWindow({
    evaluationDate: input.evaluationDate,
    projectedThrough,
    selectedRange,
  });
  const firstProjectedAsOf = selectedPoints.find((point) => point.phase === "projected")?.asOf ?? null;
  return {
    currency: input.currency ?? "CAD",
    evaluationDate: input.evaluationDate,
    historicalFrom: window.fromAsOf ?? selectedPoints[0]?.asOf ?? null,
    projectedThrough,
    firstProjectedAsOf,
    selectedRange,
    defaultRange: NET_WORTH_HISTORY_DEFAULT_RANGE,
    points: selectedPoints,
    changes: calculateNetWorthHistoryChanges(selectedPoints),
  };
}
