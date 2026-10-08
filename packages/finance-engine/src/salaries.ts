export interface SalaryProjectionInput {
  readonly cumulativeMinor: number;
  readonly completedPayNumber: number;
  readonly totalPayPeriods: number;
}

export interface SalarySnapshotProjection {
  readonly projectedYearEndMinor: number;
  readonly completedPayNumber: number;
  readonly totalPayPeriods: number;
}

function assertSafeNonnegative(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
}

function assertPayCount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 366) {
    throw new RangeError(`${label} must be an integer between 1 and 366.`);
  }
}

function roundPositiveRatio(numerator: bigint, denominator: number): number {
  assertPayCount(denominator, "Completed pay number");
  const rounded = (numerator + BigInt(denominator) / 2n) / BigInt(denominator);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("Salary projection is outside safe integer range.");
  return Number(rounded);
}

export function projectSalaryYearEndMinor(input: SalaryProjectionInput): number {
  assertSafeNonnegative(input.cumulativeMinor, "Cumulative salary");
  assertPayCount(input.completedPayNumber, "Completed pay number");
  assertPayCount(input.totalPayPeriods, "Total pay periods");
  const numerator = BigInt(input.cumulativeMinor) * BigInt(input.totalPayPeriods);
  if (numerator > BigInt(Number.MAX_SAFE_INTEGER) * BigInt(input.completedPayNumber)) {
    throw new RangeError("Salary projection is outside safe integer range.");
  }
  return roundPositiveRatio(numerator, input.completedPayNumber);
}

export function projectSalarySnapshot(input: SalaryProjectionInput): SalarySnapshotProjection {
  return {
    projectedYearEndMinor: projectSalaryYearEndMinor(input),
    completedPayNumber: input.completedPayNumber,
    totalPayPeriods: input.totalPayPeriods,
  };
}

export function salaryVarianceToBaseMinor(projectedYearEndMinor: number, annualBaseMinor: number): number {
  assertSafeNonnegative(projectedYearEndMinor, "Projected salary");
  assertSafeNonnegative(annualBaseMinor, "Annual base salary");
  const variance = BigInt(projectedYearEndMinor) - BigInt(annualBaseMinor);
  if (variance < BigInt(Number.MIN_SAFE_INTEGER) || variance > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Salary variance is outside safe integer range.");
  }
  return Number(variance);
}

function isoDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError("Salary payday must be an ISO date.");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new RangeError("Salary payday must be a valid ISO date.");
  }
  return date;
}

function isoDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function deriveBiweeklyPaydays(anchorPaydayOn: string, taxYear: number): readonly string[] {
  if (!Number.isSafeInteger(taxYear) || taxYear < 1900 || taxYear > 2200) {
    throw new RangeError("Tax year must be between 1900 and 2200.");
  }
  const anchor = isoDate(anchorPaydayOn);
  const yearStart = isoDate(`${taxYear}-01-01`);
  const yearEnd = isoDate(`${taxYear}-12-31`);
  let first = anchor;
  while (first > yearStart) first = addDays(first, -14);
  while (first < yearStart) first = addDays(first, 14);

  const paydays: string[] = [];
  for (let payday = first; payday <= yearEnd; payday = addDays(payday, 14)) {
    paydays.push(isoDateString(payday));
  }
  return paydays;
}

export function deriveCompletedPayNumber(anchorPaydayOn: string, snapshotOn: string, taxYear: number): number | null {
  const paydays = deriveBiweeklyPaydays(anchorPaydayOn, taxYear);
  const index = paydays.indexOf(isoDateString(isoDate(snapshotOn)));
  return index < 0 ? null : index + 1;
}
