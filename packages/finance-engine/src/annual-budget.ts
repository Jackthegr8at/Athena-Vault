export type AnnualBudgetStatus = "Unpaid" | "Partially paid" | "Paid" | "Over budget";

export type AnnualBudgetProjectionEventKind = "contribution" | "payment" | "withdrawal";

export interface AnnualExpensePaymentInput {
  readonly id: string;
  readonly paymentOn: string;
  readonly amountMinor: number;
  readonly note?: string | null;
}

export interface AnnualExpenseOccurrenceInput {
  readonly id: string;
  readonly name: string;
  readonly plannedAmountMinor: number;
  readonly dueDate: string;
  readonly payments: readonly AnnualExpensePaymentInput[];
}

export interface AnnualBudgetContributionInput {
  readonly id: string;
  readonly occurredOn: string;
  readonly amountMinor: number;
}

export interface AnnualBudgetProjectionInput {
  readonly budgetId: string;
  readonly forecastStart: string;
  readonly forecastEnd: string;
  readonly anchor: {
    readonly asOf: string;
    readonly balanceMinor: number;
  };
  readonly contributions: readonly AnnualBudgetContributionInput[];
  readonly occurrences: readonly AnnualExpenseOccurrenceInput[];
}

export interface AnnualExpenseDerivedValues {
  readonly paidMinor: number;
  readonly remainingMinor: number;
  readonly varianceMinor: number;
  readonly status: AnnualBudgetStatus;
}

export interface AnnualExpenseRemainderTransfer {
  readonly sourcePlannedAmountMinor: number;
  readonly targetPlannedAmountMinor: number;
  readonly amountMovedMinor: number;
}

export interface AnnualBudgetProjectionEvent {
  readonly id: string;
  readonly date: string;
  readonly kind: AnnualBudgetProjectionEventKind;
  readonly amountMinor: number;
  readonly occurrenceId?: string;
  readonly balanceMinor: number;
}

export interface AnnualBudgetProjection {
  readonly budgetId: string;
  readonly totalPlannedMinor: number;
  readonly totalPaidMinor: number;
  readonly totalRemainingMinor: number;
  readonly yearEndBalanceMinor: number;
  readonly lowestBalanceMinor: number;
  readonly lowestBalanceOn: string;
  readonly hasNegativeFunding: boolean;
  readonly events: readonly AnnualBudgetProjectionEvent[];
  readonly occurrences: readonly (AnnualExpenseOccurrenceInput & AnnualExpenseDerivedValues)[];
}

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const projectionEventPriority: Readonly<Record<AnnualBudgetProjectionEventKind, number>> = {
  contribution: 0,
  payment: 1,
  withdrawal: 2,
};

function assertSafeMinorUnits(value: number, label: string, allowZero = true): void {
  if (!Number.isSafeInteger(value) || (!allowZero && value <= 0) || (allowZero && value < 0)) {
    throw new RangeError(`${label} must be a ${allowZero ? "non-negative" : "positive"} safe integer.`);
  }
}

function parseIsoDate(value: string, label: string): Date {
  if (!isoDatePattern.test(value)) throw new RangeError(`${label} must be a valid ISO date.`);
  const parsed = new Date(`${value}T00:00:00Z`);
  const normalized = `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}-${String(parsed.getUTCDate()).padStart(2, "0")}`;
  if (Number.isNaN(parsed.getTime()) || normalized !== value) throw new RangeError(`${label} must be a valid ISO date.`);
  return parsed;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/**
 * Same accept/reject as parseIsoDate without allocating a Date. The parser
 * compares an unpadded year, so years below 1000 are invalid there too.
 */
function assertIsoDate(value: string, label: string): void {
  if (!isoDatePattern.test(value)) throw new RangeError(`${label} must be a valid ISO date.`);
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`${label} must be a valid ISO date.`);
  }
}

function assertDateRange(start: string, end: string): void {
  parseIsoDate(start, "Forecast start");
  parseIsoDate(end, "Forecast end");
  if (end < start) throw new RangeError("Forecast end must be on or after forecast start.");
}

function addMinorUnits(left: number, right: number, label: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new RangeError(`${label} is too large.`);
  return result;
}

function subtractMinorUnits(left: number, right: number, label: string): number {
  const result = left - right;
  if (!Number.isSafeInteger(result)) throw new RangeError(`${label} is too large.`);
  return result;
}

export function deriveAnnualExpenseValues(
  plannedAmountMinor: number,
  payments: readonly Pick<AnnualExpensePaymentInput, "amountMinor">[],
): AnnualExpenseDerivedValues {
  assertSafeMinorUnits(plannedAmountMinor, "Planned amount");
  let paidMinor = 0;
  for (const payment of payments) {
    assertSafeMinorUnits(payment.amountMinor, "Payment amount", false);
    paidMinor = addMinorUnits(paidMinor, payment.amountMinor, "Paid amount");
  }
  const remainingMinor = Math.max(plannedAmountMinor - paidMinor, 0);
  const varianceMinor = subtractMinorUnits(plannedAmountMinor, paidMinor, "Payment variance");
  const status: AnnualBudgetStatus = paidMinor === 0
    ? "Unpaid"
    : paidMinor < plannedAmountMinor
      ? "Partially paid"
      : paidMinor === plannedAmountMinor
        ? "Paid"
        : "Over budget";
  return { paidMinor, remainingMinor, varianceMinor, status };
}

export function moveAnnualExpenseRemainder(
  sourcePlannedAmountMinor: number,
  sourcePaidMinor: number,
  targetPlannedAmountMinor: number,
): AnnualExpenseRemainderTransfer {
  assertSafeMinorUnits(sourcePlannedAmountMinor, "Source planned amount");
  assertSafeMinorUnits(sourcePaidMinor, "Source paid amount");
  assertSafeMinorUnits(targetPlannedAmountMinor, "Target planned amount");
  if (sourcePaidMinor > sourcePlannedAmountMinor) throw new RangeError("Cannot move a remainder from an over-budget annual expense.");
  const amountMovedMinor = subtractMinorUnits(sourcePlannedAmountMinor, sourcePaidMinor, "Annual expense remainder");
  if (amountMovedMinor <= 0) throw new RangeError("Annual expense has no remaining amount to move.");
  return {
    sourcePlannedAmountMinor: sourcePaidMinor,
    targetPlannedAmountMinor: addMinorUnits(targetPlannedAmountMinor, amountMovedMinor, "Target planned amount"),
    amountMovedMinor,
  };
}

export function annualExpenseDueDate(year: number, month: number, day?: number | null): string {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) throw new RangeError("Tax year must be between 1900 and 2200.");
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError("Due month must be between 1 and 12.");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const effectiveDay = day === null || day === undefined ? 1 : Math.min(Math.max(Math.trunc(day), 1), lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(effectiveDay).padStart(2, "0")}`;
}

function validateOccurrence(occurrence: AnnualExpenseOccurrenceInput): void {
  if (!occurrence.id.trim()) throw new RangeError("Annual-expense occurrence ID is required.");
  if (!occurrence.name.trim()) throw new RangeError("Annual-expense occurrence name is required.");
  assertSafeMinorUnits(occurrence.plannedAmountMinor, "Planned amount");
  parseIsoDate(occurrence.dueDate, "Due date");
  for (const payment of occurrence.payments) {
    if (!payment.id.trim()) throw new RangeError("Payment ID is required.");
    parseIsoDate(payment.paymentOn, "Payment date");
    assertSafeMinorUnits(payment.amountMinor, "Payment amount", false);
  }
}

export function projectAnnualBudget(input: AnnualBudgetProjectionInput): AnnualBudgetProjection {
  if (!input.budgetId.trim()) throw new RangeError("Budget ID is required.");
  assertDateRange(input.forecastStart, input.forecastEnd);
  parseIsoDate(input.anchor.asOf, "Actual anchor date");
  if (input.anchor.asOf > input.forecastStart) throw new RangeError("Actual anchor must be on or before forecast start.");
  assertSafeMinorUnits(input.anchor.balanceMinor, "Actual anchor balance");

  for (const contribution of input.contributions) {
    if (!contribution.id.trim()) throw new RangeError("Contribution ID is required.");
    parseIsoDate(contribution.occurredOn, "Contribution date");
    assertSafeMinorUnits(contribution.amountMinor, "Contribution amount", false);
  }
  for (const occurrence of input.occurrences) validateOccurrence(occurrence);

  const derivedOccurrences = input.occurrences.map((occurrence) => ({
    ...occurrence,
    ...deriveAnnualExpenseValues(occurrence.plannedAmountMinor, occurrence.payments),
  }));
  const rawEvents: Array<Omit<AnnualBudgetProjectionEvent, "balanceMinor">> = [];

  for (const contribution of input.contributions) {
    if (contribution.occurredOn <= input.anchor.asOf || contribution.occurredOn > input.forecastEnd) continue;
    rawEvents.push({ id: contribution.id, date: contribution.occurredOn, kind: "contribution", amountMinor: contribution.amountMinor });
  }

  for (const occurrence of input.occurrences) {
    const paidByForecastEnd = occurrence.payments
      .filter((payment) => payment.paymentOn <= input.forecastEnd)
      .reduce((total, payment) => addMinorUnits(total, payment.amountMinor, "Paid amount"), 0);
    const remainingAtForecastEnd = Math.max(occurrence.plannedAmountMinor - paidByForecastEnd, 0);
    const withdrawalDate = occurrence.dueDate > input.anchor.asOf ? occurrence.dueDate : input.anchor.asOf;
    if (withdrawalDate <= input.forecastEnd && remainingAtForecastEnd > 0) {
      rawEvents.push({
        id: `${occurrence.id}:withdrawal`,
        date: withdrawalDate,
        kind: "withdrawal",
        amountMinor: remainingAtForecastEnd,
        occurrenceId: occurrence.id,
      });
    }
    for (const payment of occurrence.payments) {
      if (payment.paymentOn <= input.anchor.asOf || payment.paymentOn > input.forecastEnd) continue;
      rawEvents.push({
        id: payment.id,
        date: payment.paymentOn,
        kind: "payment",
        amountMinor: payment.amountMinor,
        occurrenceId: occurrence.id,
      });
    }
  }

  rawEvents.sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0)
    || projectionEventPriority[left.kind] - projectionEventPriority[right.kind]
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

  let balanceMinor = input.anchor.balanceMinor;
  let lowestBalanceMinor = balanceMinor;
  let lowestBalanceOn = input.anchor.asOf;
  const events: AnnualBudgetProjectionEvent[] = [];
  for (const event of rawEvents) {
    balanceMinor = event.kind === "contribution"
      ? addMinorUnits(balanceMinor, event.amountMinor, "Projected balance")
      : subtractMinorUnits(balanceMinor, event.amountMinor, "Projected balance");
    const nextEvent = { ...event, balanceMinor };
    events.push(nextEvent);
    if (balanceMinor < lowestBalanceMinor) {
      lowestBalanceMinor = balanceMinor;
      lowestBalanceOn = event.date;
    }
  }

  const totalPlannedMinor = derivedOccurrences.reduce((total, occurrence) => addMinorUnits(total, occurrence.plannedAmountMinor, "Planned total"), 0);
  const totalPaidMinor = derivedOccurrences.reduce((total, occurrence) => addMinorUnits(total, occurrence.paidMinor, "Paid total"), 0);
  const totalRemainingMinor = derivedOccurrences.reduce((total, occurrence) => addMinorUnits(total, occurrence.remainingMinor, "Remaining total"), 0);
  return {
    budgetId: input.budgetId,
    totalPlannedMinor,
    totalPaidMinor,
    totalRemainingMinor,
    yearEndBalanceMinor: balanceMinor,
    lowestBalanceMinor,
    lowestBalanceOn,
    hasNegativeFunding: lowestBalanceMinor < 0,
    events,
    occurrences: derivedOccurrences,
  };
}

export function applyAnnualBudgetEventsToTimeline<T extends { readonly asOf: string; readonly balanceMinor: number; readonly status: "actual" | "planned"; readonly isGenerated: boolean }>(
  snapshots: readonly T[],
  anchor: { readonly asOf: string; readonly balanceMinor: number },
  events: readonly Pick<AnnualBudgetProjectionEvent, "date" | "kind" | "amountMinor">[],
): readonly T[] {
  parseIsoDate(anchor.asOf, "Actual anchor date");
  assertSafeMinorUnits(anchor.balanceMinor, "Actual anchor balance");
  for (const snapshot of snapshots) assertIsoDate(snapshot.asOf, "Snapshot date");
  let eventIndex = 0;
  let adjustmentMinor = 0;
  const sortedEvents = [...events].sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0) || projectionEventPriority[left.kind] - projectionEventPriority[right.kind]);
  return snapshots.map((snapshot) => {
    while (eventIndex < sortedEvents.length && sortedEvents[eventIndex]!.date <= snapshot.asOf) {
      const event = sortedEvents[eventIndex]!;
      if (event.date > anchor.asOf) {
        if (event.kind !== "contribution") adjustmentMinor = addMinorUnits(adjustmentMinor, event.amountMinor, "Timeline expense adjustment");
      }
      eventIndex += 1;
    }
    if (snapshot.status !== "planned" || !snapshot.isGenerated || snapshot.asOf <= anchor.asOf) return snapshot;
    const balanceMinor = subtractMinorUnits(snapshot.balanceMinor, adjustmentMinor, "Projected timeline balance");
    return { ...snapshot, balanceMinor } as T;
  });
}
