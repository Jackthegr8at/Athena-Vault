export type SharedProjectPaymentStatus = "unpaid" | "partial" | "paid" | "extra";

export interface SharedProjectParticipantPaymentInput {
  readonly id: string;
  readonly paidMinor: number;
}

export interface SharedProjectExpenseInput {
  readonly quantity: number;
  readonly amountMinor: number;
}

export interface SharedProjectParticipantPaymentSummary {
  readonly id: string;
  readonly paidMinor: number;
  readonly owedMinor: number | null;
  readonly remainingMinor: number | null;
  readonly extraMinor: number | null;
  readonly status: SharedProjectPaymentStatus;
}

export interface SharedProjectFinanceInput {
  readonly expenses: readonly SharedProjectExpenseInput[];
  readonly participants: readonly SharedProjectParticipantPaymentInput[];
  readonly ownerParticipates: boolean;
}

export interface SharedProjectFinanceSummary {
  readonly totalExpensesMinor: number;
  readonly participantCount: number;
  readonly splitCount: number;
  readonly sharePerPersonMinor: number | null;
  readonly ownerShareMinor: number | null;
  readonly expectedFromOthersMinor: number | null;
  readonly receivedFromOthersMinor: number;
  readonly outstandingMinor: number | null;
  readonly overpaymentReceivedMinor: number | null;
  readonly roundingDifferenceMinor: number | null;
  readonly netCashResultMinor: number;
  readonly canCalculate: boolean;
}

export interface SharedProjectFinanceResult {
  readonly summary: SharedProjectFinanceSummary;
  readonly participants: readonly SharedProjectParticipantPaymentSummary[];
}

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);

function assertSafeNonNegative(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer.`);
}

function assertSafePositive(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer.`);
}

function toSafeNumber(value: bigint, label: string): number {
  if (value < MIN_SAFE_BIGINT || value > MAX_SAFE_BIGINT) throw new RangeError(`${label} is outside the safe integer range.`);
  return Number(value);
}

function sumMinorUnits(values: readonly number[], label: string): number {
  let total = 0n;
  for (const value of values) {
    assertSafeNonNegative(value, label);
    total += BigInt(value);
  }
  return toSafeNumber(total, label);
}

export function calculateSharedProjectExpenseTotalMinor(quantity: number, amountMinor: number): number {
  assertSafePositive(quantity, "Expense quantity");
  assertSafePositive(amountMinor, "Expense amount");
  return toSafeNumber(BigInt(quantity) * BigInt(amountMinor), "Expense total");
}

function roundedShare(totalMinor: number, splitCount: number): number {
  const total = BigInt(totalMinor);
  const divisor = BigInt(splitCount);
  const quotient = total / divisor;
  const remainder = total % divisor;
  return toSafeNumber(quotient + (remainder * 2n >= divisor ? 1n : 0n), "Rounded share");
}

export function deriveSharedProjectPaymentStatus(paidMinor: number, shareMinor: number | null): SharedProjectPaymentStatus {
  assertSafeNonNegative(paidMinor, "Paid amount");
  if (paidMinor === 0) return "unpaid";
  if (shareMinor === null || paidMinor > shareMinor) return "extra";
  if (paidMinor === shareMinor) return "paid";
  return "partial";
}

export function calculateSharedProjectFinance(input: SharedProjectFinanceInput): SharedProjectFinanceResult {
  const totalExpensesMinor = sumMinorUnits(input.expenses.map((expense) => calculateSharedProjectExpenseTotalMinor(expense.quantity, expense.amountMinor)), "Expense total");
  const participantCount = input.participants.length;
  const splitCount = participantCount + (input.ownerParticipates ? 1 : 0);
  const receivedFromOthersMinor = sumMinorUnits(input.participants.map((participant) => participant.paidMinor), "Paid amount");
  const netCashResultMinor = toSafeNumber(BigInt(receivedFromOthersMinor) - BigInt(totalExpensesMinor), "Net cash result");

  if (splitCount === 0) {
    return {
      summary: {
        totalExpensesMinor,
        participantCount,
        splitCount,
        sharePerPersonMinor: null,
        ownerShareMinor: null,
        expectedFromOthersMinor: null,
        receivedFromOthersMinor,
        outstandingMinor: null,
        overpaymentReceivedMinor: null,
        roundingDifferenceMinor: null,
        netCashResultMinor,
        canCalculate: false,
      },
      participants: [],
    };
  }

  const sharePerPersonMinor = roundedShare(totalExpensesMinor, splitCount);
  const expectedFromOthersMinor = toSafeNumber(BigInt(sharePerPersonMinor) * BigInt(participantCount), "Expected collection");
  const outstandingMinor = Math.max(expectedFromOthersMinor - receivedFromOthersMinor, 0);
  const overpaymentReceivedMinor = Math.max(receivedFromOthersMinor - expectedFromOthersMinor, 0);
  const roundingDifferenceMinor = toSafeNumber(BigInt(sharePerPersonMinor) * BigInt(splitCount) - BigInt(totalExpensesMinor), "Rounding difference");

  return {
    summary: {
      totalExpensesMinor,
      participantCount,
      splitCount,
      sharePerPersonMinor,
      ownerShareMinor: input.ownerParticipates ? sharePerPersonMinor : null,
      expectedFromOthersMinor,
      receivedFromOthersMinor,
      outstandingMinor,
      overpaymentReceivedMinor,
      roundingDifferenceMinor,
      netCashResultMinor,
      canCalculate: true,
    },
    participants: input.participants.map((participant) => {
      const paidMinor = participant.paidMinor;
      const status = deriveSharedProjectPaymentStatus(paidMinor, sharePerPersonMinor);
      const difference = sharePerPersonMinor - paidMinor;
      return {
        id: participant.id,
        paidMinor,
        owedMinor: sharePerPersonMinor,
        remainingMinor: difference > 0 ? difference : 0,
        extraMinor: difference < 0 ? -difference : 0,
        status,
      };
    }),
  };
}
