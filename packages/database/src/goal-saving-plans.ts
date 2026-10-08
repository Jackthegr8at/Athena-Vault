import { addIsoDays, isIsoDate, occurrencesBetween, type ContributionRuleSchedule } from "./account-contributions";

export const GOAL_SAVING_PLAN_FREQUENCIES = ["weekly", "biweekly", "monthly"] as const;

export type GoalSavingPlanFrequency = (typeof GOAL_SAVING_PLAN_FREQUENCIES)[number];

export type GoalSavingPlanStatus =
  | "target-reached"
  | "no-occurrence"
  | "shortfall"
  | "on-pace"
  | "ahead";

export interface GoalSavingPlanPreview {
  readonly frequency: GoalSavingPlanFrequency;
  readonly occurrences: number;
  readonly remainingMinor: number;
  readonly requiredAmountMinor: number | null;
  readonly amountMinor?: number;
  readonly status: GoalSavingPlanStatus | null;
  readonly completionDate: string | null;
  readonly shortfallMinor: number | null;
}

export interface CalculateGoalSavingPlanPreviewInput {
  readonly targetMinor: number;
  readonly currentMinor: number;
  readonly targetDate: string;
  readonly todayIso: string;
  readonly frequency: GoalSavingPlanFrequency;
  readonly startsOn?: string;
  readonly amountMinor?: number;
}

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

function assertSafeNonnegative(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
}

function assertPositive(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer.`);
  }
}

function assertFrequency(value: string): asserts value is GoalSavingPlanFrequency {
  if (!GOAL_SAVING_PLAN_FREQUENCIES.includes(value as GoalSavingPlanFrequency)) {
    throw new RangeError("Frequency must be weekly, biweekly, or monthly.");
  }
}

function safeCeilingDivision(numerator: number, denominator: number): number {
  const bigNumerator = BigInt(numerator);
  const bigDenominator = BigInt(denominator);
  const bigResult = (bigNumerator + bigDenominator - BigInt(1)) / bigDenominator;
  if (bigResult > BigInt(MAX_SAFE_INTEGER)) {
    throw new RangeError("Required amount is outside the safe integer range.");
  }
  return Number(bigResult);
}

function safeProduct(left: number, right: number, label: string): number {
  const product = BigInt(left) * BigInt(right);
  if (product > BigInt(MAX_SAFE_INTEGER)) throw new RangeError(`${label} is outside the safe integer range.`);
  return Number(product);
}

function parseGoalPlanDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || toGoalPlanIso(parsed) !== value) {
    throw new RangeError("Date must be a valid ISO date.");
  }
  return parsed;
}

function toGoalPlanIso(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

function goalPlanDaysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function monthlyOccurrenceFromAnchor(anchor: Date, monthOffset: number): string {
  const anchorMonth = anchor.getUTCFullYear() * 12 + anchor.getUTCMonth() + monthOffset;
  const year = Math.floor(anchorMonth / 12);
  const monthIndex = anchorMonth - year * 12;
  const day = Math.min(anchor.getUTCDate(), goalPlanDaysInMonth(year, monthIndex));
  return toGoalPlanIso(new Date(Date.UTC(year, monthIndex, day)));
}

export function validateGoalPlanStartDate({
  startsOn,
  todayIso,
  targetDate,
}: { readonly startsOn: string; readonly todayIso: string; readonly targetDate: string }): void {
  if (!isIsoDate(startsOn)) throw new RangeError("Start date must be a valid ISO date.");
  if (startsOn < todayIso) throw new RangeError("Start date must be on or after today.");
  if (startsOn > targetDate) throw new RangeError("Start date must be on or before the target date.");
}

export function computeGoalPlanDefaultStartDate({
  targetDate,
  frequency,
  todayIso,
}: { readonly targetDate: string; readonly frequency: GoalSavingPlanFrequency; readonly todayIso: string }): string {
  if (!isIsoDate(todayIso)) throw new RangeError("todayIso must be a valid ISO date.");
  if (!isIsoDate(targetDate)) throw new RangeError("targetDate must be a valid ISO date.");
  assertFrequency(frequency);
  if (todayIso > targetDate) throw new RangeError("Target date must be on or after today.");
  const today = parseGoalPlanDate(todayIso);
  const target = parseGoalPlanDate(targetDate);
  if (frequency === "weekly" || frequency === "biweekly") {
    const targetWeekday = target.getUTCDay();
    const todayWeekday = today.getUTCDay();
    const daysUntilTargetWeekday = (targetWeekday - todayWeekday + 7) % 7;
    return addIsoDays(todayIso, daysUntilTargetWeekday);
  }
  let candidate = targetDate;
  let offset = 1;
  for (;;) {
    const nextCandidate = monthlyOccurrenceFromAnchor(target, -offset);
    if (nextCandidate < todayIso) break;
    candidate = nextCandidate;
    offset += 1;
  }
  return candidate;
}
export function calculateGoalSavingPlanPreview({
  targetMinor,
  currentMinor,
  targetDate,
  todayIso,
  frequency,
  startsOn,
  amountMinor,
}: CalculateGoalSavingPlanPreviewInput): GoalSavingPlanPreview {
  assertFrequency(frequency);
  if (!isIsoDate(todayIso)) throw new RangeError("todayIso must be a valid ISO date.");
  if (!isIsoDate(targetDate)) throw new RangeError("targetDate must be a valid ISO date.");
  assertSafeNonnegative(targetMinor, "Target amount");
  assertSafeNonnegative(currentMinor, "Current amount");
  if (amountMinor !== undefined) assertPositive(amountMinor, "Amount");

  const remainingMinor = Math.max(targetMinor - currentMinor, 0);
  let effectiveStartsOn: string;
  if (startsOn !== undefined) {
    validateGoalPlanStartDate({ startsOn, todayIso, targetDate });
    effectiveStartsOn = startsOn;
  } else if (targetDate >= todayIso) {
    effectiveStartsOn = computeGoalPlanDefaultStartDate({ targetDate, frequency, todayIso });
  } else {
    effectiveStartsOn = todayIso;
  }
  const rule: ContributionRuleSchedule = {
    id: "goal-saving-plan-preview",
    amountMinor: 0,
    frequency,
    startsOn: effectiveStartsOn,
    endsOn: targetDate,
    isEnabled: true,
  };
  const occurrenceDates = occurrencesBetween(rule, todayIso, targetDate);
  const occurrences = occurrenceDates.length;

  if (remainingMinor === 0) {
    return {
      frequency,
      occurrences,
      remainingMinor: 0,
      requiredAmountMinor: null,
      ...(amountMinor === undefined ? {} : { amountMinor }),
      status: "target-reached",
      completionDate: null,
      shortfallMinor: null,
    };
  }

  if (occurrences === 0) {
    return {
      frequency,
      occurrences: 0,
      remainingMinor,
      requiredAmountMinor: null,
      ...(amountMinor === undefined ? {} : { amountMinor }),
      status: "no-occurrence",
      completionDate: null,
      shortfallMinor: null,
    };
  }

  const requiredAmountMinor = safeCeilingDivision(remainingMinor, occurrences);
  if (amountMinor === undefined) {
    return {
      frequency,
      occurrences,
      remainingMinor,
      requiredAmountMinor,
      status: null,
      completionDate: null,
      shortfallMinor: null,
    };
  }

  const plannedTotalMinor = safeProduct(amountMinor, occurrences, "Planned contribution total");
  if (plannedTotalMinor < remainingMinor) {
    return {
      frequency,
      occurrences,
      remainingMinor,
      requiredAmountMinor,
      amountMinor,
      status: "shortfall",
      completionDate: null,
      shortfallMinor: remainingMinor - plannedTotalMinor,
    };
  }

  const amount = BigInt(amountMinor);
  const remaining = BigInt(remainingMinor);
  let cumulative = BigInt(0);
  let completionDate: string | null = null;
  for (const occurrenceDate of occurrenceDates) {
    cumulative += amount;
    if (cumulative >= remaining) {
      completionDate = occurrenceDate;
      break;
    }
  }
  if (!completionDate) throw new RangeError("Could not determine goal completion date.");

  return {
    frequency,
    occurrences,
    remainingMinor,
    requiredAmountMinor,
    amountMinor,
    status: completionDate < targetDate ? "ahead" : "on-pace",
    completionDate,
    shortfallMinor: null,
  };
}
