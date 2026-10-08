import type {
  InvestmentAccountProjectionPoint,
  InvestmentAnnualContributionAccountInput,
  InvestmentAnnualContributionSummary,
  InvestmentAnnualContributionSummaryInput,
  InvestmentCalculatorInput,
  InvestmentAnnualIncreaseMode,
  InvestmentContributionEvent,
  InvestmentContributionFrequency,
  InvestmentContributionScheduleInput,
  InvestmentPortfolioAccountInput,
  InvestmentPortfolioInput,
  InvestmentPortfolioProjectionPoint,
  InvestmentProjectionInput,
  InvestmentProjectionPoint,
  InvestmentProjectionValidationCode,
  ScheduledInvestmentProjectionInput,
} from "./domain";
import { InvestmentProjectionValidationError, money } from "./domain";

const RATE_SCALE = 10_000n;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_INTEGER_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_PORTFOLIO_YEARS = 35;

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer.`);
}

function roundRatio(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError("Ratio denominator must be positive.");
  const sign = numerator < 0n ? -1n : 1n;
  const magnitude = numerator < 0n ? -numerator : numerator;
  return sign * ((magnitude + denominator / 2n) / denominator);
}

function safeNumberFromBigInt(
  value: bigint,
  label: string,
  code?: InvestmentProjectionValidationCode,
): number {
  if (value > MAX_SAFE_INTEGER_BIGINT || value < MIN_SAFE_INTEGER_BIGINT) {
    if (code) throw new InvestmentProjectionValidationError(code, `${label} exceeds the safe integer range.`);
    throw new RangeError(`${label} must be a safe integer.`);
  }
  return Number(value);
}

function projectionError(code: InvestmentProjectionValidationCode, message: string): InvestmentProjectionValidationError {
  return new InvestmentProjectionValidationError(code, message);
}

function monthlyInterest(balanceMinor: number, annualRateBps: number): number {
  assertSafeInteger(balanceMinor, "Investment balance");
  assertSafeInteger(annualRateBps, "Annual return");
  const interest = roundRatio(BigInt(balanceMinor) * BigInt(annualRateBps), RATE_SCALE * 12n);
  return safeNumberFromBigInt(interest, "Investment interest");
}

function periodicInterest(
  balanceMinor: number,
  annualRateBps: number,
  periodsPerYear: number,
  typedErrors = false,
): number {
  const interest = roundRatio(BigInt(balanceMinor) * BigInt(annualRateBps), RATE_SCALE * BigInt(periodsPerYear));
  return safeNumberFromBigInt(interest, "Investment interest", typedErrors ? "overflow" : undefined);
}

function validateProjectionInput(years: number, annualRateBps: number): void {
  if (!Number.isInteger(years) || years < 1 || years > MAX_PORTFOLIO_YEARS) {
    throw new RangeError("Investment projection horizon must be between 1 and 35 years.");
  }
  if (!Number.isInteger(annualRateBps) || annualRateBps < -10_000 || annualRateBps > 10_000) {
    throw new RangeError("Annual return must be between -100% and 100%.");
  }
}

function validateNewProjectionInput(years: number, annualRateBps: number): void {
  if (!Number.isInteger(years) || years < 1 || years > MAX_PORTFOLIO_YEARS) {
    throw projectionError("invalid-horizon", "Investment projection horizon must be between 1 and 35 years.");
  }
  if (!Number.isSafeInteger(annualRateBps) || annualRateBps < -10_000 || annualRateBps > 10_000) {
    throw projectionError("invalid-rate", "Annual return must be between -100% and 100% in basis points.");
  }
}

function safeAdd(left: number, right: number, label: string, typedErrors = false): number {
  return safeNumberFromBigInt(BigInt(left) + BigInt(right), label, typedErrors ? "overflow" : undefined);
}

function safeGrowth(balance: number, initialValue: number, contributions: number, typedErrors = false): number {
  return safeNumberFromBigInt(
    BigInt(balance) - BigInt(initialValue) - BigInt(contributions),
    "Projected investment growth",
    typedErrors ? "overflow" : undefined,
  );
}

function projectFixedPeriodicInvestment(
  initialValue: number,
  periodContribution: number,
  annualRateBps: number,
  years: number,
  periodsPerYear: number,
  typedErrors = false,
): InvestmentProjectionPoint[] {
  let balance = initialValue;
  let contributions = 0;
  const result: InvestmentProjectionPoint[] = [{ year: 0, balance: money(balance), contributions: money(0), growth: money(0) }];

  for (let year = 1; year <= years; year += 1) {
    for (let period = 0; period < periodsPerYear; period += 1) {
      const interest = periodicInterest(balance, annualRateBps, periodsPerYear, typedErrors);
      balance = safeAdd(safeAdd(balance, interest, "Projected investment balance", typedErrors), periodContribution, "Projected investment balance", typedErrors);
      contributions = safeAdd(contributions, periodContribution, "Projected investment contributions", typedErrors);
    }
    result.push({
      year,
      balance: money(balance),
      contributions: money(contributions),
      growth: money(safeGrowth(balance, initialValue, contributions, typedErrors)),
    });
  }
  return result;
}

export function projectScheduledInvestment(input: ScheduledInvestmentProjectionInput): InvestmentProjectionPoint[] {
  validateProjectionInput(input.years, input.annualRateBps);
  assertSafeInteger(input.initialValue, "Initial investment value");
  if (input.initialValue < 0) throw new RangeError("Initial investment value cannot be negative.");
  const expectedMonths = input.years * 12;
  if (input.monthlyContributions.length !== expectedMonths) {
    throw new RangeError("Monthly contribution schedule must cover the full projection horizon.");
  }
  for (const contribution of input.monthlyContributions) {
    assertSafeInteger(contribution, "Scheduled contribution");
    if (contribution < 0) throw new RangeError("Scheduled contribution cannot be negative.");
  }

  let balance: number = input.initialValue;
  let contributions = 0;
  const result: InvestmentProjectionPoint[] = [{ year: 0, balance: money(balance), contributions: money(0), growth: money(0) }];
  for (let year = 1; year <= input.years; year += 1) {
    for (let month = 0; month < 12; month += 1) {
      const interest = monthlyInterest(balance, input.annualRateBps);
      const contribution = input.monthlyContributions[(year - 1) * 12 + month] ?? 0;
      balance = safeAdd(safeAdd(balance, interest, "Projected investment balance"), contribution, "Projected investment balance");
      contributions = safeAdd(contributions, contribution, "Projected investment contributions");
    }
    result.push({
      year,
      balance: money(balance),
      contributions: money(contributions),
      growth: money(safeGrowth(balance, input.initialValue, contributions)),
    });
  }
  return result;
}

/** Projects a fixed monthly contribution over a nominal annual return. */
export function projectInvestment(input: InvestmentProjectionInput): InvestmentProjectionPoint[] {
  const periods = input.compoundingPeriodsPerYear;
  if (!Number.isInteger(periods) || periods < 1 || periods > 366) {
    throw new RangeError("Compounding periods must be between 1 and 366.");
  }
  if (!Number.isInteger(input.years) || input.years < 1 || input.years > 200) {
    throw new RangeError("Investment projection horizon must be between 1 and 200 years.");
  }
  const initialValue = validateMinorAmount(input.initialValue, "Initial investment value");
  const monthlyContribution = validateMinorAmount(input.monthlyContribution, "Monthly contribution");
  assertSafeInteger(input.annualRateBps, "Annual return");
  const periodContribution = safeNumberFromBigInt(
    roundRatio(BigInt(monthlyContribution) * 12n, BigInt(periods)),
    "Periodic contribution",
  );
  return projectFixedPeriodicInvestment(initialValue, periodContribution, input.annualRateBps, input.years, periods);
}

function parseIsoDate(value: string, label: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw projectionError("invalid-date", `${label} must use YYYY-MM-DD.`);
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month! - 1 || parsed.getUTCDate() !== day) {
    throw projectionError("invalid-date", `${label} must be a valid calendar date.`);
  }
  return parsed;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function addMonthsClamped(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

function compareDates(left: Date, right: Date): number {
  return left.getTime() - right.getTime();
}

function yearOf(date: Date): number {
  return date.getUTCFullYear();
}

function projectionHorizonBoundary(baselineDate: Date, years: number): Date {
  return addMonthsClamped(baselineDate, years * 12);
}

export function periodsPerYearForInvestmentFrequency(frequency: InvestmentContributionFrequency): number {
  if (frequency === "monthly") return 12;
  if (frequency === "biweekly") return 26;
  throw projectionError("invalid-frequency", "Investment contribution frequency must be monthly or biweekly.");
}

interface NormalizedContributionSchedule {
  frequency: InvestmentContributionFrequency;
  baseContributionMinor: number;
  annualIncreaseBps: number;
  annualIncreaseMode: InvestmentAnnualIncreaseMode;
  annualIncreaseMinor: number;
  startDate: Date | null;
  overrides: Map<number, number>;
}

interface NormalizedContributionEvent {
  readonly on: Date;
  readonly amountMinor: number;
}

export interface PreparedInvestmentContributionAccount {
  readonly accountId: string;
  readonly schedule: NormalizedContributionSchedule;
  readonly events: readonly NormalizedContributionEvent[];
  readonly usesDatedEvents: boolean;
}

export interface PreparedInvestmentContributionEvents {
  readonly baselineDate: Date;
  readonly years: number;
  readonly accounts: readonly PreparedInvestmentContributionAccount[];
}

export interface InvestmentContributionPreparationInput {
  readonly baselineDate: string;
  readonly years: number;
  readonly accounts: readonly {
    readonly accountId: string;
    readonly schedule: InvestmentContributionScheduleInput;
    readonly contributionEvents?: readonly InvestmentContributionEvent[];
  }[];
}

function validateMinorAmount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw projectionError("invalid-amount", `${label} must be a non-negative safe integer in minor units.`);
  return value;
}

function normalizeOverrides(schedule: InvestmentContributionScheduleInput): Map<number, number> {
  const overrides = [...(schedule.annualOverrides ?? []), ...(schedule.overrides ?? [])];
  const byYear = new Map<number, number>();
  for (const override of overrides) {
    if (!Number.isInteger(override.year) || override.year < 1 || override.year > 9999) {
      throw projectionError("invalid-schedule", "Investment override years must be calendar years between 1 and 9999.");
    }
    if (byYear.has(override.year)) throw projectionError("duplicate-override-year", `Investment override for ${override.year} is duplicated.`);
    byYear.set(override.year, validateMinorAmount(override.amountMinor, "Investment override amount"));
  }
  return byYear;
}

function normalizeSchedule(schedule: InvestmentContributionScheduleInput): NormalizedContributionSchedule {
  if (!schedule || typeof schedule !== "object") throw projectionError("invalid-schedule", "Investment contribution schedule is required.");
  periodsPerYearForInvestmentFrequency(schedule.frequency);
  const baseContributionMinor = validateMinorAmount(schedule.baseContributionMinor, "Investment base contribution");
  if (!Number.isSafeInteger(schedule.annualIncreaseBps) || schedule.annualIncreaseBps < -10_000 || schedule.annualIncreaseBps > 10_000) {
    throw projectionError("invalid-rate", "Annual contribution increase must be between -100% and 100% in basis points.");
  }
  const annualIncreaseMode = schedule.annualIncreaseMode ?? "percentage";
  if (annualIncreaseMode !== "percentage" && annualIncreaseMode !== "fixed_amount") {
    throw projectionError("invalid-schedule", "Annual contribution increase mode must be percentage or fixed_amount.");
  }
  const annualIncreaseMinor = validateMinorAmount(schedule.annualIncreaseMinor ?? 0, "Annual fixed contribution increase");
  if (annualIncreaseMode === "percentage" && annualIncreaseMinor !== 0) {
    throw projectionError("invalid-schedule", "Percentage contribution schedules cannot include a fixed annual increase.");
  }
  if (annualIncreaseMode === "fixed_amount" && schedule.annualIncreaseBps !== 0) {
    throw projectionError("invalid-schedule", "Fixed contribution schedules cannot include a percentage annual increase.");
  }
  if (schedule.startDate && schedule.startsOn && schedule.startDate !== schedule.startsOn) {
    throw projectionError("invalid-schedule", "Investment schedule startDate and startsOn must match when both are provided.");
  }
  const startDateText = schedule.startDate ?? schedule.startsOn;
  return {
    frequency: schedule.frequency,
    baseContributionMinor,
    annualIncreaseBps: schedule.annualIncreaseBps,
    annualIncreaseMode,
    annualIncreaseMinor,
    startDate: startDateText ? parseIsoDate(startDateText, "Investment schedule start date") : null,
    overrides: normalizeOverrides(schedule),
  };
}

function amountForYear(schedule: NormalizedContributionSchedule, targetYear: number, baselineYear: number, cache: Map<string, number>): number {
  return amountForBaseAndYear(schedule, schedule.baseContributionMinor, targetYear, baselineYear, cache);
}

function amountForBaseAndYear(
  schedule: NormalizedContributionSchedule,
  baseAmountMinor: number,
  targetYear: number,
  baselineYear: number,
  cache: Map<string, number>,
): number {
  const scheduleStartYear = schedule.startDate ? yearOf(schedule.startDate) : baselineYear;
  if (targetYear < scheduleStartYear) return 0;
  const cacheKey = `${baseAmountMinor}:${targetYear}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;
  let amount = baseAmountMinor;
  for (let year = scheduleStartYear; year <= targetYear; year += 1) {
    const override = schedule.overrides.get(year);
    if (override !== undefined) amount = override;
    else if (year > scheduleStartYear && schedule.annualIncreaseMode === "fixed_amount") {
      amount = safeNumberFromBigInt(BigInt(amount) + BigInt(schedule.annualIncreaseMinor), "Annual contribution amount", "overflow");
    } else if (year > scheduleStartYear) {
      const factor = BigInt(10_000 + schedule.annualIncreaseBps);
      amount = safeNumberFromBigInt(roundRatio(BigInt(amount) * factor, RATE_SCALE), "Annual contribution amount", "overflow");
    }
    cache.set(`${baseAmountMinor}:${year}`, amount);
  }
  return amount;
}

function normalizeContributionEvents(
  events: readonly InvestmentContributionEvent[] | undefined,
  baselineDate: Date,
  horizonBoundary?: Date,
): NormalizedContributionEvent[] | null {
  if (events === undefined) return null;
  if (!Array.isArray(events)) throw projectionError("invalid-schedule", "Investment contribution events must be an array.");
  return events.map((event) => ({
    on: parseIsoDate(event.on, "Investment contribution event date"),
    amountMinor: validateMinorAmount(event.amountMinor, "Investment contribution event amount"),
  })).filter((event) => compareDates(event.on, baselineDate) > 0 && (horizonBoundary === undefined || compareDates(event.on, horizonBoundary) <= 0))
    .sort((left, right) => compareDates(left.on, right.on));
}

function firstOccurrenceAfterBaseline(schedule: NormalizedContributionSchedule, baselineDate: Date): Date {
  const anchor = schedule.startDate ?? baselineDate;
  if (compareDates(anchor, baselineDate) > 0) return anchor;
  for (let index = 1; index <= 10_000; index += 1) {
    const occurrence = schedule.frequency === "monthly"
      ? addMonthsClamped(anchor, index)
      : addDays(anchor, index * 14);
    if (compareDates(occurrence, baselineDate) > 0) return occurrence;
  }
  throw projectionError("invalid-schedule", "Investment schedule could not find its first projected occurrence.");
}

function generateManualContributionEvents(
  schedule: NormalizedContributionSchedule,
  baselineDate: Date,
  years: number,
  baselineYear: number,
  amountCache: Map<string, number>,
): NormalizedContributionEvent[] {
  const first = firstOccurrenceAfterBaseline(schedule, baselineDate);
  const horizonBoundary = projectionHorizonBoundary(baselineDate, years);
  const periods = periodsPerYearForInvestmentFrequency(schedule.frequency);
  const events: NormalizedContributionEvent[] = [];
  for (let index = 0; index < periods * years; index += 1) {
    const occurrence = schedule.frequency === "monthly"
      ? addMonthsClamped(first, index)
      : addDays(first, index * 14);
    if (compareDates(occurrence, horizonBoundary) > 0) break;
    events.push({ on: occurrence, amountMinor: amountForYear(schedule, yearOf(occurrence), baselineYear, amountCache) });
  }
  return events;
}

function applyAnnualAmountRules(
  schedule: NormalizedContributionSchedule,
  events: readonly NormalizedContributionEvent[],
  baselineDate: Date,
  years: number,
  amountCache: Map<string, number>,
): NormalizedContributionEvent[] {
  const horizonBoundary = projectionHorizonBoundary(baselineDate, years);
  const baselineYear = yearOf(baselineDate);
  return events
    .filter((event) => compareDates(event.on, baselineDate) > 0 && compareDates(event.on, horizonBoundary) <= 0)
    .map((event) => ({
      on: event.on,
      amountMinor: amountForBaseAndYear(schedule, event.amountMinor, yearOf(event.on), baselineYear, amountCache),
    }));
}

function normalizeAndApplyContributionEvents(
  schedule: NormalizedContributionSchedule,
  events: readonly InvestmentContributionEvent[],
  baselineDate: Date,
  years: number,
): NormalizedContributionEvent[] {
  const normalized = normalizeContributionEvents(events, baselineDate, projectionHorizonBoundary(baselineDate, years));
  if (!normalized) return [];
  return applyAnnualAmountRules(schedule, normalized, baselineDate, years, new Map<string, number>());
}

/**
 * Normalizes contribution schedules and prepares all dated contribution
 * events for a projection. Callers rendering multiple return-rate scenarios
 * can pass the result to each projection to avoid repeating this work.
 */
export function prepareInvestmentContributionEvents(
  input: InvestmentContributionPreparationInput,
): PreparedInvestmentContributionEvents {
  validateNewProjectionInput(input.years, 0);
  validateContributionAccountIds(input.accounts);
  const baselineDate = parseIsoDate(input.baselineDate, "Investment contribution baseline date");
  const baselineYear = yearOf(baselineDate);
  const horizonBoundary = projectionHorizonBoundary(baselineDate, input.years);
  const accounts = input.accounts.map((account) => {
    const schedule = normalizeSchedule(account.schedule);
    const amountCache = new Map<string, number>();
    const usesDatedEvents = account.contributionEvents !== undefined;
    const events = usesDatedEvents
      ? applyAnnualAmountRules(
        schedule,
        normalizeContributionEvents(account.contributionEvents, baselineDate, horizonBoundary) ?? [],
        baselineDate,
        input.years,
        amountCache,
      )
      : generateManualContributionEvents(schedule, baselineDate, input.years, baselineYear, amountCache);
    return { accountId: account.accountId, schedule, events, usesDatedEvents };
  });
  return { baselineDate, years: input.years, accounts };
}


function validateAnnualContributionAccounts(
  accounts: readonly InvestmentAnnualContributionAccountInput[],
): Array<{ account: InvestmentAnnualContributionAccountInput; schedule: NormalizedContributionSchedule }> {
  if (!Array.isArray(accounts)) throw projectionError("invalid-schedule", "Investment contribution accounts must be an array.");
  const seenIds = new Set<string>();
  return accounts.map((account) => {
    if (!account.accountId.trim() || seenIds.has(account.accountId)) throw projectionError("invalid-schedule", "Investment contribution account IDs must be non-empty and unique.");
    seenIds.add(account.accountId);
    return { account, schedule: normalizeSchedule(account.schedule) };
  });
}
function validateContributionAccountIds(
  accounts: readonly { readonly accountId: string }[],
): void {
  if (!Array.isArray(accounts)) throw projectionError("invalid-schedule", "Investment contribution accounts must be an array.");
  const seenIds = new Set<string>();
  for (const account of accounts) {
    if (!account.accountId.trim() || seenIds.has(account.accountId)) throw projectionError("invalid-schedule", "Investment contribution account IDs must be non-empty and unique.");
    seenIds.add(account.accountId);
  }
}


interface AnnualContributionAccumulator {
  annualContributionMinor: bigint;
  eventCount: number;
  biweeklyAmountMinor: bigint;
  biweeklyEventCount: number;
  monthlyAmountMinor: bigint;
  monthlyEventCount: number;
}

function roundedCadenceAmount(total: bigint, eventCount: number): bigint | null {
  return eventCount > 0 ? roundRatio(total, BigInt(eventCount)) : null;
}

/**
 * Derives calendar-year contribution totals and normalized cadence amounts
 * using the same dated-event and manual-occurrence semantics as the balance
 * projection. The result is intentionally read-only and contains no balance
 * or Cash Flow mutation behavior.
 */
export function summarizeInvestmentAnnualContributions(
  input: InvestmentAnnualContributionSummaryInput,
  prepared?: PreparedInvestmentContributionEvents,
): InvestmentAnnualContributionSummary[] {
  validateNewProjectionInput(input.years, 0);
  const baselineDate = parseIsoDate(input.baselineDate, "Investment annual contribution baseline date");
  const baselineYear = yearOf(baselineDate);
  const preparedUsable = prepared !== undefined
    && prepared.years === input.years
    && prepared.baselineDate.getTime() === baselineDate.getTime();
  const preparedById = preparedUsable ? new Map(prepared.accounts.map((account) => [account.accountId, account] as const)) : undefined;
  const validatedAccounts = preparedUsable
    ? (validateContributionAccountIds(input.accounts), input.accounts.map((account) => ({ account, schedule: preparedById?.get(account.accountId)?.schedule ?? normalizeSchedule(account.schedule) })))
    : validateAnnualContributionAccounts(input.accounts);
  const summaries = new Map<number, AnnualContributionAccumulator>();

  for (const { account, schedule } of validatedAccounts) {
    const preparedAccount = preparedById?.get(account.accountId);
    const amountCache = new Map<string, number>();
    const events = preparedAccount && preparedAccount.usesDatedEvents === (account.contributionEvents !== undefined)
      ? preparedAccount.events
      : account.contributionEvents === undefined
        ? generateManualContributionEvents(schedule, baselineDate, input.years, baselineYear, amountCache)
        : applyAnnualAmountRules(
          schedule,
          normalizeContributionEvents(account.contributionEvents, baselineDate, projectionHorizonBoundary(baselineDate, input.years)) ?? [],
          baselineDate,
          input.years,
          amountCache,
        );

    for (const event of events) {
      const calendarYear = yearOf(event.on);
      const summary = summaries.get(calendarYear) ?? {
        annualContributionMinor: 0n,
        eventCount: 0,
        biweeklyAmountMinor: 0n,
        biweeklyEventCount: 0,
        monthlyAmountMinor: 0n,
        monthlyEventCount: 0,
      } satisfies AnnualContributionAccumulator;
      summary.annualContributionMinor += BigInt(event.amountMinor);
      summary.eventCount += 1;
      if (schedule.frequency === "biweekly") {
        summary.biweeklyAmountMinor += BigInt(event.amountMinor);
        summary.biweeklyEventCount += 1;
      } else {
        summary.monthlyAmountMinor += BigInt(event.amountMinor);
        summary.monthlyEventCount += 1;
      }
      summaries.set(calendarYear, summary);
    }
  }

  return [...summaries.entries()]
    .sort(([left], [right]) => left - right)
    .map(([calendarYear, summary]) => {
      const biweeklyAmountMinor = roundedCadenceAmount(summary.biweeklyAmountMinor, summary.biweeklyEventCount);
      const monthlyAmountMinor = roundedCadenceAmount(summary.monthlyAmountMinor, summary.monthlyEventCount);
      const normalizedMonthlyAmountMinor = monthlyAmountMinor === null && biweeklyAmountMinor === null
        ? null
        : safeNumberFromBigInt(
          (monthlyAmountMinor ?? 0n) + (biweeklyAmountMinor === null ? 0n : roundRatio(biweeklyAmountMinor * 26n, 12n)),
          "Normalized monthly investment contribution",
          "overflow",
        );
      return {
        calendarYear,
        biweeklyAmountMinor: biweeklyAmountMinor === null ? null : money(safeNumberFromBigInt(biweeklyAmountMinor, "Biweekly investment contribution", "overflow")),
        monthlyAmountMinor: normalizedMonthlyAmountMinor === null ? null : money(normalizedMonthlyAmountMinor),
        annualContributionMinor: money(safeNumberFromBigInt(summary.annualContributionMinor, "Annual investment contribution", "overflow")),
        eventCount: summary.eventCount,
      } satisfies InvestmentAnnualContributionSummary;
    });
}

interface ContributionEventCursor {
  eventIndex: number;
}

function contributionForPeriod(
  events: readonly NormalizedContributionEvent[],
  cursor: ContributionEventCursor,
  previousBoundary: Date,
  boundary: Date,
): number {
  let contribution = 0;
  while (cursor.eventIndex < events.length && compareDates(events[cursor.eventIndex]!.on, boundary) <= 0) {
    const event = events[cursor.eventIndex]!;
    if (compareDates(event.on, previousBoundary) > 0) {
      contribution = safeAdd(contribution, event.amountMinor, "Projected portfolio period contribution", true);
    }
    cursor.eventIndex += 1;
  }
  return contribution;
}

function validatePortfolioInput(
  input: InvestmentPortfolioInput,
  prepared?: PreparedInvestmentContributionEvents,
): {
  baselineDate: Date;
  schedules: Array<{
    account: InvestmentPortfolioAccountInput;
    schedule: NormalizedContributionSchedule;
    preparedAccount?: PreparedInvestmentContributionAccount;
  }>;
} {
  validateNewProjectionInput(input.years, input.annualRateBps);
  const baselineDate = parseIsoDate(input.baselineDate, "Investment portfolio baseline date");
  if (!Array.isArray(input.accounts) || input.accounts.length === 0) throw projectionError("invalid-schedule", "Investment portfolio must include at least one account.");
  const preparedUsable = prepared !== undefined
    && prepared.years === input.years
    && prepared.baselineDate.getTime() === baselineDate.getTime();
  const preparedById = preparedUsable ? new Map(prepared.accounts.map((account) => [account.accountId, account] as const)) : undefined;
  const seenIds = new Set<string>();
  const schedules = input.accounts.map((account) => {
    if (!account.accountId.trim() || seenIds.has(account.accountId)) throw projectionError("invalid-schedule", "Investment portfolio account IDs must be non-empty and unique.");
    seenIds.add(account.accountId);
    validateMinorAmount(account.initialValue, `Initial value for ${account.accountId}`);
    const preparedAccount = preparedById?.get(account.accountId);
    return { account, schedule: preparedAccount?.schedule ?? normalizeSchedule(account.schedule), preparedAccount };
  });
  return { baselineDate, schedules };
}

function projectPortfolioAccount(
  account: InvestmentPortfolioAccountInput,
  schedule: NormalizedContributionSchedule,
  baselineDate: Date,
  years: number,
  annualRateBps: number,
  preparedAccount?: PreparedInvestmentContributionAccount,
): InvestmentAccountProjectionPoint[] {
  const contributionEvents = account.contributionEvents === undefined
    ? null
    : (preparedAccount?.usesDatedEvents === true
      ? preparedAccount.events
      : normalizeAndApplyContributionEvents(schedule, account.contributionEvents, baselineDate, years));
  if (contributionEvents !== null) {
    return projectDatedEventPortfolioAccount(account, contributionEvents, baselineDate, years, annualRateBps);
  }
  const periods = periodsPerYearForInvestmentFrequency(schedule.frequency);
  const baselineYear = yearOf(baselineDate);
  const amountCache = new Map<string, number>();
  const manualEvents = preparedAccount?.usesDatedEvents === false
    ? preparedAccount.events
    : generateManualContributionEvents(schedule, baselineDate, years, baselineYear, amountCache);
  const cursor: ContributionEventCursor = { eventIndex: 0 };
  let previousBoundary = baselineDate;
  let balance: number = account.initialValue;
  let contributions = 0;
  const result: InvestmentAccountProjectionPoint[] = [{ accountId: account.accountId, year: 0, balance: money(balance), contributions: money(0), growth: money(0) }];

  for (let year = 1; year <= years; year += 1) {
    for (let period = 0; period < periods; period += 1) {
      const periodIndex = (year - 1) * periods + period;
      const boundary = schedule.frequency === "monthly"
        ? addMonthsClamped(baselineDate, periodIndex + 1)
        : addDays(baselineDate, (periodIndex + 1) * 14);
      const contribution = contributionForPeriod(manualEvents, cursor, previousBoundary, boundary);
      previousBoundary = boundary;
      const interest = periodicInterest(balance, annualRateBps, periods, true);
      balance = safeAdd(safeAdd(balance, interest, "Projected portfolio balance", true), contribution, "Projected portfolio balance", true);
      contributions = safeAdd(contributions, contribution, "Projected portfolio contributions", true);
    }
    result.push({
      accountId: account.accountId,
      year,
      balance: money(balance),
      contributions: money(contributions),
      growth: money(safeGrowth(balance, account.initialValue, contributions, true)),
    });
  }
  return result;
}

function projectDatedEventPortfolioAccount(
  account: InvestmentPortfolioAccountInput,
  events: readonly NormalizedContributionEvent[],
  baselineDate: Date,
  years: number,
  annualRateBps: number,
): InvestmentAccountProjectionPoint[] {
  let eventIndex = 0;
  let balance: number = account.initialValue;
  let contributions = 0;
  const result: InvestmentAccountProjectionPoint[] = [{ accountId: account.accountId, year: 0, balance: money(balance), contributions: money(0), growth: money(0) }];

  let previousBoundary = baselineDate;
  for (let year = 1; year <= years; year += 1) {
    for (let month = 0; month < 12; month += 1) {
      const periodIndex = (year - 1) * 12 + month;
      const boundary = addMonthsClamped(baselineDate, periodIndex + 1);
      const interest = monthlyInterest(balance, annualRateBps);
      let contribution = 0;
      while (eventIndex < events.length && compareDates(events[eventIndex]!.on, boundary) <= 0) {
        const event = events[eventIndex]!;
        if (compareDates(event.on, previousBoundary) > 0) {
          contribution = safeAdd(
            contribution,
            event.amountMinor,
            "Projected portfolio contribution",
            true,
          );
        }
        eventIndex += 1;
      }
      previousBoundary = boundary;
      balance = safeAdd(safeAdd(balance, interest, "Projected portfolio balance", true), contribution, "Projected portfolio balance", true);
      contributions = safeAdd(contributions, contribution, "Projected portfolio contributions", true);
    }
    result.push({
      accountId: account.accountId,
      year,
      balance: money(balance),
      contributions: money(contributions),
      growth: money(safeGrowth(balance, account.initialValue, contributions, true)),
    });
  }
  return result;
}

export function projectInvestmentCalculator(input: InvestmentCalculatorInput): InvestmentProjectionPoint[] {
  const periods = input.compoundingPeriodsPerYear ?? 12;
  if (!Number.isInteger(periods) || periods < 1 || periods > 366) throw projectionError("invalid-schedule", "Compounding periods must be between 1 and 366.");
  validateNewProjectionInput(input.years, input.annualRateBps);
  const initialValue = validateMinorAmount(input.initialValue, "Initial calculator value");
  return projectFixedPeriodicInvestment(initialValue, 0, input.annualRateBps, input.years, periods, true);
}

export function projectInvestmentPortfolio(
  input: InvestmentPortfolioInput,
  prepared?: PreparedInvestmentContributionEvents,
): InvestmentPortfolioProjectionPoint[] {
  const { baselineDate, schedules } = validatePortfolioInput(input, prepared);
  const accountPoints = schedules.map(({ account, schedule, preparedAccount }) => projectPortfolioAccount(account, schedule, baselineDate, input.years, input.annualRateBps, preparedAccount));
  const result: InvestmentPortfolioProjectionPoint[] = [];
  for (let year = 0; year <= input.years; year += 1) {
    const accounts = accountPoints.map((points) => points[year]!);
    const balance = accounts.reduce((total, point) => safeAdd(total, point.balance, "Projected portfolio balance", true), 0);
    const contributions = accounts.reduce((total, point) => safeAdd(total, point.contributions, "Projected portfolio contributions", true), 0);
    const growth = accounts.reduce((total, point) => safeAdd(total, point.growth, "Projected portfolio growth", true), 0);
    result.push({ year, balance: money(balance), contributions: money(contributions), growth: money(growth), accounts });
  }
  return result;
}
