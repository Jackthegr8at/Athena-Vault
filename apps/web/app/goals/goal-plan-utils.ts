import { occurrencesBetween, type ContributionRuleSchedule } from "@athena/database/account-contributions";
import type { GoalSavingPlanFrequency } from "@athena/database/goal-saving-plans";
import { formatMoneyMinor } from "../../lib/format-money";

export interface GoalPlanFrequencyPreview {
  readonly frequency: GoalSavingPlanFrequency;
  readonly occurrenceDates: readonly string[];
  readonly occurrences: number;
  readonly remainingMinor: number;
  readonly requiredAmountMinor: number | null;
  readonly defaultStartsOn: string;
}

export type GoalPlanPreviews = Record<string, readonly GoalPlanFrequencyPreview[]>;

const CAD_INPUT_PATTERN = /^\d+(\.\d{1,2})?$/;
const LONG_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", { dateStyle: "long", timeZone: "UTC" });

function cadMinorFromString(value: string): number | null {
  const trimmed = value.trim();
  if (!CAD_INPUT_PATTERN.test(trimmed)) return null;
  const [whole, fraction = "00"] = trimmed.split(".");
  const cents = fraction.padEnd(2, "0").slice(0, 2);
  const big = BigInt(whole ?? "0") * 100n + BigInt(cents);
  const minor = Number(big);
  if (!Number.isSafeInteger(minor) || minor <= 0) return null;
  return minor;
}

function safeCeilingDivision(numerator: number, denominator: number): number {
  const bigNumerator = BigInt(numerator);
  const bigDenominator = BigInt(denominator);
  const bigResult = (bigNumerator + bigDenominator - BigInt(1)) / bigDenominator;
  if (bigResult > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Required amount is outside the safe integer range.");
  }
  return Number(bigResult);
}

export function inputAmountFromMinor(minor: number): string {
  const negative = minor < 0;
  const dollars = Math.abs(Math.trunc(minor / 100));
  const cents = Math.abs(minor % 100);
  return `${negative ? "-" : ""}${dollars}.${cents.toString().padStart(2, "0")}`;
}

export function formatCadMinor(minor: number): string {
  return formatMoneyMinor(minor);
}


export interface SelectedPlanPreview {
  readonly status: "target-reached" | "no-occurrence" | "shortfall" | "on-pace" | "ahead" | "empty";
  readonly shortfallMinor: number | null;
  readonly completionDate: string | null;
}

export function computeSelectedPlanPreview(
  amountText: string,
  preview: GoalPlanFrequencyPreview,
  targetDate: string,
): SelectedPlanPreview {
  if (preview.remainingMinor <= 0) {
    return { status: "target-reached", shortfallMinor: null, completionDate: null };
  }
  if (preview.occurrences === 0 || preview.occurrenceDates.length === 0) {
    return { status: "no-occurrence", shortfallMinor: null, completionDate: null };
  }
  const amountMinor = cadMinorFromString(amountText);
  if (amountMinor === null) {
    return { status: "empty", shortfallMinor: null, completionDate: null };
  }
  const amount = BigInt(amountMinor);
  const remaining = BigInt(preview.remainingMinor);
  const total = amount * BigInt(preview.occurrences);
  if (total < remaining) {
    const shortfall = Number(remaining - total);
    return { status: "shortfall", shortfallMinor: shortfall, completionDate: null };
  }
  let cumulative = 0n;
  let completionDate: string | null = null;
  for (const date of preview.occurrenceDates) {
    cumulative += amount;
    if (cumulative >= remaining) {
      completionDate = date;
      break;
    }
  }
  if (completionDate === null) {
    return { status: "no-occurrence", shortfallMinor: null, completionDate: null };
  }
  const status = completionDate < targetDate ? "ahead" : "on-pace";
  return { status, shortfallMinor: null, completionDate };
}

export function planFrequencyLabel(frequency: GoalSavingPlanFrequency): string {
  switch (frequency) {
    case "weekly":
      return "Weekly";
    case "biweekly":
      return "Biweekly";
    case "monthly":
      return "Monthly";
  }
}

export function formatLongDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return LONG_DATE_FORMAT.format(date);
}


export function computePreviewForStart({
  targetMinor,
  currentMinor,
  targetDate,
  todayIso,
  startsOn,
  frequency,
}: {
  readonly targetMinor: number;
  readonly currentMinor: number;
  readonly targetDate: string;
  readonly todayIso: string;
  readonly startsOn: string;
  readonly frequency: GoalSavingPlanFrequency;
}): GoalPlanFrequencyPreview {
  const remainingMinor = Math.max(targetMinor - currentMinor, 0);
  const rule: ContributionRuleSchedule = {
    id: "goal-saving-plan-preview",
    amountMinor: 0,
    frequency,
    startsOn,
    endsOn: targetDate,
    isEnabled: true,
  };
  const occurrenceDates = occurrencesBetween(rule, todayIso > startsOn ? todayIso : startsOn, targetDate);
  const occurrences = occurrenceDates.length;
  const requiredAmountMinor = remainingMinor === 0 || occurrences === 0 ? null : safeCeilingDivision(remainingMinor, occurrences);
  return {
    frequency,
    occurrenceDates,
    occurrences,
    remainingMinor,
    requiredAmountMinor,
    defaultStartsOn: startsOn,
  };
}
