import { z } from "zod";

export const moneySchema = z.number().int().finite().refine(Number.isSafeInteger, "Amount must be a safe integer.");
export const cashFlowItemSchema = z.object({
  id: z.string().min(1), label: z.string().min(1), account: z.string().min(1), amount: moneySchema,
  kind: z.enum(["income", "expense", "transfer"]), direction: z.enum(["in", "out"]).optional(), planned: z.boolean(), category: z.string().optional(),
}).superRefine((item, context) => {
  if (item.kind === "transfer" && item.direction === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["direction"], message: "Transfer direction is required" });
});
export const payPeriodSchema = z.object({
  id: z.string().min(1), label: z.string().min(1), payDate: z.string().date(), openingBalance: moneySchema, items: z.array(cashFlowItemSchema),
});
export type PayPeriodInput = z.infer<typeof payPeriodSchema>;

export const maintenanceFrequencySchema = z.enum(["weekly", "biweekly", "monthly", "annual"]);

export function cadAmountToMinorUnits(value: string): number | null {
  try {
    const normalized = value.trim();
    if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
    const negative = normalized.startsWith("-");
    const unsigned = negative ? normalized.slice(1) : normalized;
    const [wholePart = "", fractionPart = ""] = unsigned.split(".");
    const minor = (BigInt(wholePart) * 100n + BigInt(fractionPart.padEnd(2, "0"))) * (negative ? -1n : 1n);
    return minor >= BigInt(Number.MIN_SAFE_INTEGER) && minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
  } catch {
    return null;
  }
}

export const maintenanceNameSchema = z.string().trim().min(1, "Name is required.").max(120, "Name must be 120 characters or fewer.");

export const maintenanceAmountSchema = z.string()
  .trim()
  .regex(/^\d+(?:\.\d{1,2})?$/, "Enter a non-negative CAD amount with at most two decimal places.")
  .refine((value) => cadAmountToMinorUnits(value) !== null, "CAD amount is too large.")
  .transform((value) => cadAmountToMinorUnits(value)!);

export const maintenanceItemInputSchema = z.object({
  name: maintenanceNameSchema,
  amount: maintenanceAmountSchema,
  frequency: maintenanceFrequencySchema,
});

export const maintenanceItemIdSchema = z.string().uuid("Maintenance item ID is invalid.");

export type MaintenanceItemInput = z.infer<typeof maintenanceItemInputSchema>;

export const accountKindSchema = z.enum([
  "checking",
  "savings",
  "credit",
  "loan",
  "cash",
  "investment",
  "crypto",
  "rrsp",
  "tfsa",
  "fhsa",
  "resp",
  "rdsp",
  "non_registered",
  "other",
]);
export const snapshotStatusSchema = z.enum(["actual", "planned"]);
export const accountIdSchema = z.string().uuid("Account ID is invalid.");
export const snapshotDateSchema = z.string().date("Snapshot date must be a valid ISO date.");
export const accountNameSchema = z.string().trim().min(1, "Account name is required.").max(120, "Account name must be 120 characters or fewer.");
export const institutionNameSchema = z.string().trim().min(1, "Institution name is required.").max(120, "Institution name must be 120 characters or fewer.");
export const accountLastFourSchema = z.preprocess(
  (value) => value === undefined || value === null ? null : typeof value === "string" ? value.trim() || null : value,
  z.string().regex(/^[A-Za-z0-9]{4}$/, "Enter exactly four letters or digits.").transform((value) => value.toUpperCase()).nullable(),
);
export const ownerDisplayNameSchema = z.string().trim().min(1, "Display name is required.").max(80, "Display name must be 80 characters or fewer.");
export const ownerDisplayNameInputSchema = z.object({ displayName: ownerDisplayNameSchema });

export const calculationWorkbookIdSchema = z.string().uuid("Workbook ID is invalid.");
export const calculationWorkbookNameSchema = z.string().trim().min(1, "Workbook name is required.").max(80, "Workbook name must be 80 characters or fewer.");
export const calculationWorkbookSnapshotSchema = z.record(z.unknown()).superRefine((snapshot, context) => {
  if (!Array.isArray(snapshot.sheetOrder)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["sheetOrder"], message: "Workbook sheet order is invalid." });
  }
  if (snapshot.sheets === null || typeof snapshot.sheets !== "object" || Array.isArray(snapshot.sheets)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["sheets"], message: "Workbook sheets are invalid." });
  }
});
export const calculationWorkbookSaveInputSchema = z.object({
  id: calculationWorkbookIdSchema,
  name: calculationWorkbookNameSchema,
  snapshot: calculationWorkbookSnapshotSchema,
});
export const calculationWorkbookDeleteInputSchema = z.object({ id: calculationWorkbookIdSchema });

export const accountAmountSchema = z.string()
  .trim()
  .regex(/^-?\d+(?:\.\d{1,2})?$/, "Enter a CAD amount with at most two decimal places.")
  .refine((value) => cadAmountToMinorUnits(value) !== null, "CAD amount is too large.")
  .transform((value) => cadAmountToMinorUnits(value)!);

export const accountBalanceNoteSchema = z.preprocess(
  (value) => value === undefined || value === null ? null : value,
  z.string().trim().max(500, "Note must be 500 characters or fewer.").nullable().transform((value) => value || null),
);

export const cashFlowTransactionIdSchema = z.string().uuid("Cash-flow transaction ID is invalid.");
export const cashFlowIncomeUpdateInputSchema = z.object({
  id: cashFlowTransactionIdSchema,
  amount: accountAmountSchema.refine((value) => value >= 0, "Income amount cannot be negative."),
});
export const cashFlowTransactionCreateInputSchema = z.object({
  periodId: z.string().uuid("Cash-flow period ID is invalid."),
  accountId: accountIdSchema,
  kind: z.enum(["income", "expense"]),
  transactionDate: snapshotDateSchema,
  description: z.string().trim().min(1, "Name is required.").max(240, "Name must be 240 characters or fewer."),
  amount: accountAmountSchema.refine((value) => value > 0, "Amount must be greater than zero."),
});

export const cashFlowInitialTimelineInputSchema = z.object({
  firstPayday: snapshotDateSchema,
  throughDate: snapshotDateSchema,
}).superRefine((input, context) => {
  if (input.throughDate < input.firstPayday) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["throughDate"], message: "Timeline end date must be on or after the first payday." });
  }
});

export const cashFlowAccountVisibilityInputSchema = z.object({
  accountId: accountIdSchema,
  isVisibleInCashFlow: z.boolean(),
});

export const cashFlowTransactionUpdateInputSchema = z.object({
  id: cashFlowTransactionIdSchema,
  accountId: accountIdSchema.nullable(),
  recurringTransactionId: z.string().uuid("Recurring series ID is invalid.").nullable(),
  transactionDate: snapshotDateSchema,
  description: z.string().trim().min(1, "Description is required.").max(240, "Description must be 240 characters or fewer."),
  category: z.string().trim().max(120, "Category must be 120 characters or fewer.").optional().nullable(),
  amount: accountAmountSchema.refine((value) => value >= 0, "Amount cannot be negative."),
  status: snapshotStatusSchema,
  scope: z.enum(["current", "this_and_future"]),
}).superRefine((input, context) => {
  if (input.scope === "this_and_future" && !input.recurringTransactionId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["recurringTransactionId"], message: "Choose a recurring series for future updates." });
});
export const cashFlowTransactionDeleteInputSchema = z.object({
  id: cashFlowTransactionIdSchema,
  confirm: z.literal(true),
});
export const cashFlowTransactionRestoreInputSchema = z.object({
  id: cashFlowTransactionIdSchema,
  confirm: z.literal(true),
});
export const cashFlowTransferUpdateInputSchema = z.object({
  id: z.string().uuid("Cash-flow transfer ID is invalid."),
  fromAccountId: accountIdSchema,
  toAccountId: accountIdSchema,
  transferDate: snapshotDateSchema,
  description: z.string().trim().min(1, "Description is required.").max(240, "Description must be 240 characters or fewer."),
  amount: accountAmountSchema.refine((value) => value > 0, "Transfer amount must be greater than zero."),
  status: snapshotStatusSchema,
}).refine((input) => input.fromAccountId !== input.toAccountId, { path: ["toAccountId"], message: "Choose two different accounts." });

export const recurringFrequencySchema = z.enum(["weekly", "biweekly", "monthly", "quarterly", "annual"]);
export const recurringSeriesKindSchema = z.enum(["income", "expense", "transfer"]);
export const recurringWeekdayAdjustmentSchema = z.enum(["none", "next_weekday", "previous_weekday"]);
export const recurringSeriesStateSchema = z.enum(["active", "paused", "ended"]);
export const recurringOccurrenceExceptionKindSchema = z.enum(["override", "skip"]);
export const recurringOccurrenceScopeSchema = z.enum(["only_this_occurrence", "selected_range"]);
export const recurringSeriesIdSchema = z.string().uuid("Recurring series ID is invalid.");
export const recurringVersionIdSchema = z.string().uuid("Recurring version ID is invalid.");
export const recurringOccurrenceIdSchema = z.string().uuid("Recurring occurrence ID is invalid.");
export const recurringOverrideGroupIdSchema = z.string().uuid("Recurring override group ID is invalid.");
export const recurringSeriesNameSchema = z.string().trim().min(1, "Recurring series name is required.").max(240, "Recurring series name must be 240 characters or fewer.");
export const recurringSeriesAmountSchema = accountAmountSchema.refine((value) => value > 0, "Recurring amount must be greater than zero.");
export const recurringNoteSchema = z.string().trim().max(500, "Note must be 500 characters or fewer.").optional().nullable().transform((value) => value || null);

export const cashFlowInitialIncomeInputSchema = z.object({
  name: recurringSeriesNameSchema,
  accountId: accountIdSchema,
  amount: recurringSeriesAmountSchema,
  frequency: recurringFrequencySchema.default("biweekly"),
  startsOn: snapshotDateSchema,
  throughDate: snapshotDateSchema,
  note: recurringNoteSchema,
}).superRefine((input, context) => {
  if (input.throughDate < input.startsOn) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["throughDate"], message: "Cash Flow end date must be on or after the first income." });
  }
});

const recurringSeriesTermsSchema = z.object({
  name: recurringSeriesNameSchema,
  kind: recurringSeriesKindSchema,
  accountId: accountIdSchema.nullable(),
  fromAccountId: accountIdSchema.nullable().default(null),
  toAccountId: accountIdSchema.nullable().default(null),
  amount: recurringSeriesAmountSchema,
  frequency: recurringFrequencySchema,
  weekdayAdjustment: recurringWeekdayAdjustmentSchema.default("none"),
  startsOn: snapshotDateSchema,
  nextOccurrenceOn: snapshotDateSchema,
  endsOn: snapshotDateSchema.optional().nullable(),
  note: recurringNoteSchema,
  countsAsExpense: z.boolean().default(false),
});

function recurringDateToUtc(value: string): Date {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new RangeError("Invalid recurring date.");
  return parsed;
}

function recurringUtcDateToIso(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function recurringAddDays(value: string, days: number): string {
  const date = recurringDateToUtc(value);
  date.setUTCDate(date.getUTCDate() + days);
  return recurringUtcDateToIso(date);
}

function recurringAdjustedDate(value: string, adjustment: z.infer<typeof recurringWeekdayAdjustmentSchema>): string {
  if (adjustment === "none") return value;
  const day = recurringDateToUtc(value).getUTCDay();
  if (day === 0) return recurringAddDays(value, adjustment === "next_weekday" ? 1 : -2);
  if (day === 6) return recurringAddDays(value, adjustment === "next_weekday" ? 2 : -1);
  return value;
}

function recurringMonthlyDate(anchor: string, monthOffset: number): string {
  const date = recurringDateToUtc(anchor);
  const targetMonth = date.getUTCFullYear() * 12 + date.getUTCMonth() + monthOffset;
  const year = Math.floor(targetMonth / 12);
  const month = targetMonth - year * 12;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(Math.min(date.getUTCDate(), daysInMonth)).padStart(2, "0")}`;
}

function recurringDayNumber(value: string): number {
  return Math.floor(recurringDateToUtc(value).getTime() / 86_400_000);
}

function recurringScheduleOccurrence(input: Pick<z.infer<typeof recurringSeriesTermsSchema>, "frequency" | "startsOn" | "weekdayAdjustment">, target: string): boolean {
  const intervalDays = input.frequency === "weekly" ? 7 : input.frequency === "biweekly" ? 14 : null;
  if (intervalDays !== null && input.weekdayAdjustment === "none") {
    const dayDifference = recurringDayNumber(target) - recurringDayNumber(input.startsOn);
    return dayDifference >= 0 && dayDifference % intervalDays === 0 && dayDifference / intervalDays < 10_000;
  }

  const targetGraceEnd = recurringAddDays(target, 2);
  for (let index = 0; index < 10_000; index += 1) {
    const normal = intervalDays === null
      ? recurringMonthlyDate(input.startsOn, index * (input.frequency === "monthly" ? 1 : input.frequency === "quarterly" ? 3 : 12))
      : recurringAddDays(input.startsOn, index * intervalDays);
    if (recurringAdjustedDate(normal, input.weekdayAdjustment) === target) return true;
    if (normal > targetGraceEnd) return false;
  }
  return false;
}

function firstRecurringScheduleOccurrence(input: Pick<z.infer<typeof recurringSeriesTermsSchema>, "frequency" | "startsOn" | "weekdayAdjustment">): string {
  const normal = input.frequency === "weekly" || input.frequency === "biweekly"
    ? recurringAddDays(input.startsOn, 0)
    : recurringMonthlyDate(input.startsOn, 0);
  return recurringAdjustedDate(normal, input.weekdayAdjustment);
}

function refineRecurringSeriesTerms(
  input: z.infer<typeof recurringSeriesTermsSchema>,
  context: z.RefinementCtx,
  effectiveFrom?: string,
): void {
  if (input.kind === "transfer") {
    if (input.accountId !== null) context.addIssue({ code: z.ZodIssueCode.custom, path: ["accountId"], message: "Recurring transfers use source and destination accounts." });
    if (!input.fromAccountId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["fromAccountId"], message: "Transfer source account is required." });
    if (!input.toAccountId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["toAccountId"], message: "Transfer destination account is required." });
    if (input.fromAccountId && input.fromAccountId === input.toAccountId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["toAccountId"], message: "Transfer accounts must be different." });
  } else if (input.fromAccountId !== null || input.toAccountId !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["fromAccountId"], message: "Only recurring transfers may specify transfer endpoints." });
  }
  if (input.countsAsExpense && input.kind !== "transfer") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["countsAsExpense"], message: "Only recurring transfers can count as expense." });
  }
  const firstOccurrenceOn = firstRecurringScheduleOccurrence(input);
  if (input.nextOccurrenceOn < firstOccurrenceOn) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["nextOccurrenceOn"], message: "Next occurrence is before the first adjusted occurrence." });
  }
  if (input.endsOn && input.endsOn < firstOccurrenceOn) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["endsOn"], message: "End date must be on or after the first occurrence." });
  }
  if (input.endsOn && input.nextOccurrenceOn > input.endsOn) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["nextOccurrenceOn"], message: "Next occurrence must be on or before the ending occurrence." });
  }
  if (effectiveFrom && input.endsOn && effectiveFrom > input.endsOn) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["endsOn"], message: "The effective occurrence must be on or before the schedule end." });
  }
  if (effectiveFrom && input.nextOccurrenceOn < effectiveFrom) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["nextOccurrenceOn"], message: "Next occurrence must be on or after the effective occurrence." });
  }
  const nextOccurrenceMatches = recurringScheduleOccurrence(input, input.nextOccurrenceOn);
  const endsOnMatches = input.endsOn ? recurringScheduleOccurrence(input, input.endsOn) : true;
  const effectiveFromMatches = effectiveFrom ? recurringScheduleOccurrence(input, effectiveFrom) : true;
  if (!nextOccurrenceMatches) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["nextOccurrenceOn"], message: "Next occurrence must match the selected recurring schedule." });
  }
  if (input.endsOn && !endsOnMatches) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["endsOn"], message: "End date must match the selected recurring schedule." });
  }
  if (effectiveFrom && !effectiveFromMatches) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["effectiveFrom"], message: "Effective date must match the selected recurring schedule." });
  }
}

export const recurringSeriesCreateInputSchema = recurringSeriesTermsSchema.superRefine(refineRecurringSeriesTerms);
export const recurringSeriesWholeEditInputSchema = recurringSeriesTermsSchema.omit({ nextOccurrenceOn: true }).extend({
  seriesId: recurringSeriesIdSchema,
  confirm: z.literal(true),
}).superRefine((input, context) => {
  if (input.kind === "transfer") {
    if (input.accountId !== null) context.addIssue({ code: z.ZodIssueCode.custom, path: ["accountId"], message: "Recurring transfers use source and destination accounts." });
    if (!input.fromAccountId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["fromAccountId"], message: "Transfer source account is required." });
    if (!input.toAccountId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["toAccountId"], message: "Transfer destination account is required." });
    if (input.fromAccountId && input.fromAccountId === input.toAccountId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["toAccountId"], message: "Transfer accounts must be different." });
  } else if (input.fromAccountId !== null || input.toAccountId !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["fromAccountId"], message: "Only recurring transfers may specify transfer endpoints." });
  }
  if (input.countsAsExpense && input.kind !== "transfer") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["countsAsExpense"], message: "Only recurring transfers can count as expense." });
  }
  const firstOccurrenceOn = firstRecurringScheduleOccurrence(input);
  if (input.endsOn && input.endsOn < firstOccurrenceOn) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["endsOn"], message: "End date must be on or after the first occurrence." });
  }
  if (input.endsOn && !recurringScheduleOccurrence(input, input.endsOn)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["endsOn"], message: "End date must match the selected recurring schedule." });
  }
});
export const recurringSeriesRenameInputSchema = z.object({
  seriesId: recurringSeriesIdSchema,
  name: recurringSeriesNameSchema,
  confirm: z.literal(true),
});
export const recurringSeriesUpdateInputSchema = recurringSeriesTermsSchema.extend({
  id: recurringSeriesIdSchema,
  state: recurringSeriesStateSchema,
}).superRefine((input, context) => {
  refineRecurringSeriesTerms(input, context);
  if (input.state === "ended" && !input.endsOn) context.addIssue({ code: z.ZodIssueCode.custom, path: ["endsOn"], message: "An ended series needs an ending occurrence." });
  if (input.state !== "ended" && input.endsOn && input.state === "active") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["state"], message: "Use End series to close a schedule with an ending occurrence." });
  }
});
export const recurringSeriesInputSchema = recurringSeriesCreateInputSchema;

export const recurringSeriesVersionChangeInputSchema = recurringSeriesTermsSchema.extend({
  seriesId: recurringSeriesIdSchema,
  previousEndsOn: snapshotDateSchema,
  effectiveFrom: snapshotDateSchema,
  versionNote: recurringNoteSchema,
}).superRefine((input, context) => {
  refineRecurringSeriesTerms(input, context, input.effectiveFrom);
  if (input.previousEndsOn >= input.effectiveFrom) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["previousEndsOn"], message: "The old schedule must end before the new schedule starts." });
  }
});
export const recurringSeriesVersionInputSchema = recurringSeriesVersionChangeInputSchema;

export const recurringSeriesVersionEditInputSchema = z.object({
  seriesId: recurringSeriesIdSchema,
  versionId: recurringVersionIdSchema,
  name: recurringSeriesNameSchema,
  kind: recurringSeriesKindSchema,
  accountId: accountIdSchema.nullable(),
  fromAccountId: accountIdSchema.nullable().default(null),
  toAccountId: accountIdSchema.nullable().default(null),
  amount: recurringSeriesAmountSchema,
  frequency: recurringFrequencySchema,
  weekdayAdjustment: recurringWeekdayAdjustmentSchema.default("none"),
  startsOn: snapshotDateSchema,
  endsOn: snapshotDateSchema.optional().nullable(),
  note: recurringNoteSchema,
  countsAsExpense: z.boolean().default(false),
  confirm: z.literal(true),
}).superRefine((input, context) => {
  if (input.kind === "transfer") {
    if (input.accountId !== null) context.addIssue({ code: z.ZodIssueCode.custom, path: ["accountId"], message: "Recurring transfers use source and destination accounts." });
    if (!input.fromAccountId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["fromAccountId"], message: "Transfer source account is required." });
    if (!input.toAccountId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["toAccountId"], message: "Transfer destination account is required." });
    if (input.fromAccountId && input.fromAccountId === input.toAccountId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["toAccountId"], message: "Transfer accounts must be different." });
  } else if (input.fromAccountId !== null || input.toAccountId !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["fromAccountId"], message: "Only recurring transfers may specify transfer endpoints." });
  }
  if (input.countsAsExpense && input.kind !== "transfer") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["countsAsExpense"], message: "Only recurring transfers can count as expense." });
  }
  if (input.endsOn && input.endsOn < input.startsOn) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["endsOn"], message: "Recurring end date must be on or after the start date." });
  }
  if (!recurringScheduleOccurrence(input, input.startsOn)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["startsOn"], message: "Version start date must match the selected recurring schedule." });
  }
  if (input.endsOn && !recurringScheduleOccurrence(input, input.endsOn)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["endsOn"], message: "Version end date must match the selected recurring schedule." });
  }
});

export const recurringSeriesVersionDeleteInputSchema = z.object({
  seriesId: recurringSeriesIdSchema,
  versionId: recurringVersionIdSchema,
  confirm: z.literal(true),
});

export const recurringSeriesGenerationInputSchema = z.object({
  seriesId: recurringSeriesIdSchema,
  throughDate: snapshotDateSchema,
});

export const recurringSeriesPauseResumeInputSchema = z.object({
  seriesId: recurringSeriesIdSchema,
  state: z.enum(["active", "paused"]),
  confirm: z.literal(true),
});

export const recurringSeriesEndInputSchema = z.object({
  seriesId: recurringSeriesIdSchema,
  endingOccurrenceOn: snapshotDateSchema,
  confirm: z.literal(true),
});

export const recurringTransferCountsAsExpenseInputSchema = z.object({
  seriesId: recurringSeriesIdSchema,
  countsAsExpense: z.boolean(),
  confirm: z.literal(true),
});

export const homeHouseholdFrequencySchema = z.enum(["biweekly", "monthly"]);

export const homeHouseholdCashFlowCreateInputSchema = recurringSeriesTermsSchema.extend({
  homeHouseholdFrequency: homeHouseholdFrequencySchema,
  confirm: z.literal(true),
}).superRefine((input, context) => {
  refineRecurringSeriesTerms(input, context);
  if (input.frequency !== input.homeHouseholdFrequency) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["frequency"],
      message: "Schedule frequency must match the Home card (biweekly or monthly).",
    });
  }
});

export const homeHouseholdCashFlowAmountSyncInputSchema = z.object({
  homeHouseholdFrequency: homeHouseholdFrequencySchema,
  amount: recurringSeriesAmountSchema,
  confirm: z.literal(true),
});

export const recurringSeriesDeleteInputSchema = z.object({
  seriesId: recurringSeriesIdSchema,
  confirm: z.literal(true),
});

export const recurringOccurrenceExceptionInputSchema = z.object({
  seriesId: recurringSeriesIdSchema,
  versionId: recurringVersionIdSchema,
  transactionId: cashFlowTransactionIdSchema.nullable(),
  transferId: z.string().uuid("Cash-flow transfer ID is invalid.").optional().nullable(),
  scheduledOccurrenceOn: snapshotDateSchema,
  scope: recurringOccurrenceScopeSchema,
  endingOccurrenceOn: snapshotDateSchema.optional().nullable(),
  kind: recurringOccurrenceExceptionKindSchema,
  dateOverride: snapshotDateSchema.optional().nullable(),
  amountOverride: recurringSeriesAmountSchema.optional().nullable(),
  accountOverrideId: accountIdSchema.optional().nullable(),
  fromAccountOverrideId: accountIdSchema.optional().nullable(),
  toAccountOverrideId: accountIdSchema.optional().nullable(),
  statusOverride: z.literal("planned").optional().nullable(),
  note: recurringNoteSchema,
}).superRefine((input, context) => {
  if (input.scope === "selected_range" && !input.endingOccurrenceOn) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["endingOccurrenceOn"], message: "Choose the ending occurrence for the selected range." });
  }
  if (input.endingOccurrenceOn && input.endingOccurrenceOn < input.scheduledOccurrenceOn) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["endingOccurrenceOn"], message: "The ending occurrence must be on or after the selected occurrence." });
  }
  if ((input.fromAccountOverrideId !== null && input.fromAccountOverrideId !== undefined) !== (input.toAccountOverrideId !== null && input.toAccountOverrideId !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["toAccountOverrideId"], message: "Transfer endpoint overrides must include both accounts." });
  }
  if (input.fromAccountOverrideId && input.fromAccountOverrideId === input.toAccountOverrideId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["toAccountOverrideId"], message: "Transfer endpoint overrides must use different accounts." });
  }
  if (input.kind === "skip" && (input.dateOverride || input.amountOverride !== null && input.amountOverride !== undefined || input.accountOverrideId || input.fromAccountOverrideId || input.toAccountOverrideId || input.statusOverride)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["kind"], message: "Skipped occurrences cannot include value overrides." });
  }
  if (input.kind === "override" && !input.dateOverride && input.amountOverride == null && input.accountOverrideId == null && input.fromAccountOverrideId == null && input.toAccountOverrideId == null && input.statusOverride == null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["kind"], message: "Choose at least one occurrence override." });
  }
});

export const recurringOccurrenceRestoreInputSchema = z.object({
  seriesId: recurringSeriesIdSchema,
  occurrenceId: recurringOccurrenceIdSchema.nullable(),
  overrideGroupId: recurringOverrideGroupIdSchema.nullable(),
  scope: z.enum(["occurrence", "group"]),
  confirm: z.literal(true),
}).superRefine((input, context) => {
  if (input.scope === "occurrence" && !input.occurrenceId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["occurrenceId"], message: "Choose an occurrence to restore." });
  if (input.scope === "group" && !input.overrideGroupId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["overrideGroupId"], message: "Choose an override group to restore." });
});

export const recurringOverrideGroupUpdateInputSchema = z.object({
  overrideGroupId: recurringOverrideGroupIdSchema,
  kind: recurringOccurrenceExceptionKindSchema,
  dateOverride: z.null().default(null),
  amountOverride: recurringSeriesAmountSchema.optional().nullable(),
  accountOverrideId: accountIdSchema.optional().nullable(),
  fromAccountOverrideId: accountIdSchema.optional().nullable(),
  toAccountOverrideId: accountIdSchema.optional().nullable(),
  statusOverride: z.literal("planned").optional().nullable(),
  note: recurringNoteSchema,
}).superRefine((input, context) => {
  if ((input.fromAccountOverrideId !== null && input.fromAccountOverrideId !== undefined) !== (input.toAccountOverrideId !== null && input.toAccountOverrideId !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["toAccountOverrideId"], message: "Transfer endpoint overrides must include both accounts." });
  }
  if (input.fromAccountOverrideId && input.fromAccountOverrideId === input.toAccountOverrideId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["toAccountOverrideId"], message: "Transfer endpoint overrides must use different accounts." });
  }
  if (input.kind === "skip" && (input.amountOverride !== null && input.amountOverride !== undefined || input.accountOverrideId || input.fromAccountOverrideId || input.toAccountOverrideId || input.statusOverride)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["kind"], message: "Skipped occurrences cannot include value overrides." });
  }
  if (input.kind === "override" && input.amountOverride == null && input.accountOverrideId == null && input.fromAccountOverrideId == null && input.toAccountOverrideId == null && input.statusOverride == null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["kind"], message: "Choose at least one occurrence override." });
  }
});

export type RecurringSeriesCreateInput = z.infer<typeof recurringSeriesCreateInputSchema>;
export type RecurringSeriesWholeEditInput = z.infer<typeof recurringSeriesWholeEditInputSchema>;
export type RecurringSeriesRenameInput = z.infer<typeof recurringSeriesRenameInputSchema>;
export type RecurringSeriesUpdateInput = z.infer<typeof recurringSeriesUpdateInputSchema>;
export type RecurringSeriesVersionChangeInput = z.infer<typeof recurringSeriesVersionChangeInputSchema>;
export type RecurringSeriesVersionEditInput = z.infer<typeof recurringSeriesVersionEditInputSchema>;
export type RecurringSeriesVersionDeleteInput = z.infer<typeof recurringSeriesVersionDeleteInputSchema>;
export type RecurringSeriesGenerationInput = z.infer<typeof recurringSeriesGenerationInputSchema>;
export type RecurringSeriesPauseResumeInput = z.infer<typeof recurringSeriesPauseResumeInputSchema>;
export type RecurringSeriesEndInput = z.infer<typeof recurringSeriesEndInputSchema>;
export type RecurringSeriesDeleteInput = z.infer<typeof recurringSeriesDeleteInputSchema>;
export type RecurringOccurrenceExceptionInput = z.infer<typeof recurringOccurrenceExceptionInputSchema>;
export type RecurringOccurrenceRestoreInput = z.infer<typeof recurringOccurrenceRestoreInputSchema>;
export type RecurringOverrideGroupUpdateInput = z.infer<typeof recurringOverrideGroupUpdateInputSchema>;

const customTypeLabelSchema = z.string().trim().max(80, "Custom type label must be 80 characters or fewer.").optional().nullable().transform((value) => value || null);
const accountMetadataBaseSchema = z.object({
  name: accountNameSchema,
  institutionName: institutionNameSchema,
  kind: accountKindSchema,
  customTypeLabel: customTypeLabelSchema,
  lastFour: accountLastFourSchema,
});

function refineAccountMetadata(input: z.infer<typeof accountMetadataBaseSchema>, context: z.RefinementCtx): void {
  if (input.kind !== "other" && input.customTypeLabel) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["customTypeLabel"], message: "Custom type labels are only allowed for Other accounts." });
  }
  if (input.kind !== "rdsp" && input.lastFour !== null && !/^\d{4}$/.test(input.lastFour)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["lastFour"], message: "Enter exactly four digits." });
  }
}

export const accountMetadataInputSchema = accountMetadataBaseSchema.superRefine(refineAccountMetadata);

export const accountAvailabilityInputSchema = z.object({
  accountId: accountIdSchema,
  includeInAvailableCash: z.boolean(),
});

export const accountCashFlowPlannedTimelineInputSchema = z.object({
  accountId: accountIdSchema,
  useCashFlowPlannedTimeline: z.boolean(),
});

export const accountCreateInputSchema = accountMetadataBaseSchema.extend({
  initialBalance: accountAmountSchema.optional().nullable(),
  initialBalanceDate: snapshotDateSchema.optional().nullable(),
  initialStatus: snapshotStatusSchema.default("planned"),
}).superRefine((input, context) => {
  refineAccountMetadata(input, context);
  if ((input.initialBalance === null) !== (input.initialBalanceDate === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: [input.initialBalance === null ? "initialBalance" : "initialBalanceDate"], message: "Initial balance and date must be provided together." });
  }
});

export const accountUpdateInputSchema = accountMetadataInputSchema;

export const balanceSnapshotInputSchema = z.object({
  accountId: accountIdSchema,
  asOf: snapshotDateSchema,
  balance: accountAmountSchema,
  status: snapshotStatusSchema,
  note: accountBalanceNoteSchema,
});

export const deleteBalanceSnapshotInputSchema = z.object({
  accountId: accountIdSchema,
  asOf: snapshotDateSchema,
});

export const accountBalanceNoteInputSchema = z.object({
  accountId: accountIdSchema,
  asOf: snapshotDateSchema,
  note: accountBalanceNoteSchema,
});

export const periodConfirmationInputSchema = z.object({ asOf: snapshotDateSchema });
export const accountProjectionRecalculationScopeSchema = z.enum(["account", "all"]);
export const accountProjectionRecalculationInputSchema = z.object({
  accountId: accountIdSchema,
  scope: accountProjectionRecalculationScopeSchema,
});
export const accountTimelineSectionSchema = z.union([
  z.enum(["liquid", "credit", "loan", "investment"]),
  z.string().regex(/^other:[^\r\n]{1,80}$/, "Custom account section is invalid."),
]);
export const accountReorderInputSchema = z.object({
  section: accountTimelineSectionSchema,
  accountIds: z.array(accountIdSchema).min(1).max(100),
});

export const accountContributionFrequencySchema = z.enum(["weekly", "biweekly", "monthly", "annual"]);
export const accountContributionRecalculationScopeSchema = z.enum(["rule_only", "from_rule_start", "all_future"]);
export const accountContributionRuleIdSchema = z.string().uuid("Contribution rule ID is invalid.");
export const accountContributionAmountSchema = accountAmountSchema.refine((value) => value > 0, "Contribution amount must be greater than zero.");
export const accountContributionRuleInputSchema = z.object({
  id: accountContributionRuleIdSchema.optional().nullable(),
  accountId: accountIdSchema,
  amount: accountContributionAmountSchema,
  frequency: accountContributionFrequencySchema,
  startsOn: snapshotDateSchema,
  endsOn: snapshotDateSchema.optional().nullable(),
  isEnabled: z.boolean(),
  recalculationScope: accountContributionRecalculationScopeSchema,
}).superRefine((input, context) => {
  if (input.endsOn && input.endsOn < input.startsOn) context.addIssue({ code: z.ZodIssueCode.custom, path: ["endsOn"], message: "End date must be on or after the start date." });
});

export const accountContributionExceptionKindSchema = z.enum(["skip", "override", "restore"]);
export const accountContributionExceptionInputSchema = z.object({
  ruleId: accountContributionRuleIdSchema,
  occurrenceDates: z.string().trim().min(1, "Enter at least one occurrence date.").transform((value) => [...new Set(value.split(/[\s,;]+/).filter(Boolean))]),
  kind: accountContributionExceptionKindSchema,
  amountOverride: accountAmountSchema.optional().nullable(),
}).superRefine((input, context) => {
  if (input.kind === "override" && (input.amountOverride === null || input.amountOverride === undefined || input.amountOverride <= 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["amountOverride"], message: "Override amount must be greater than zero." });
  }
  if (input.kind !== "override" && input.amountOverride !== null && input.amountOverride !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["amountOverride"], message: "An override amount is only used for an override." });
  }
});

export const accountTimelineExtensionInputSchema = z.object({ throughDate: snapshotDateSchema });
export const accountTimelineVisibilitySchema = z.number().int().min(0).max(24);

export type AccountMetadataInput = z.infer<typeof accountMetadataInputSchema>;
export type AccountAvailabilityInput = z.infer<typeof accountAvailabilityInputSchema>;
export type AccountCashFlowPlannedTimelineInput = z.infer<typeof accountCashFlowPlannedTimelineInputSchema>;
export type AccountCreateInput = z.infer<typeof accountCreateInputSchema>;
export type AccountUpdateInput = z.infer<typeof accountUpdateInputSchema>;
export type BalanceSnapshotInput = z.infer<typeof balanceSnapshotInputSchema>;
export type AccountBalanceNoteInput = z.infer<typeof accountBalanceNoteInputSchema>;
export type AccountProjectionRecalculationInput = z.infer<typeof accountProjectionRecalculationInputSchema>;
export type AccountReorderInput = z.infer<typeof accountReorderInputSchema>;
export type AccountContributionRuleInput = z.infer<typeof accountContributionRuleInputSchema>;
export type AccountContributionExceptionInput = z.infer<typeof accountContributionExceptionInputSchema>;
export type CashFlowInitialTimelineInput = z.infer<typeof cashFlowInitialTimelineInputSchema>;
export type CashFlowInitialIncomeInput = z.infer<typeof cashFlowInitialIncomeInputSchema>;

export const investmentProjectionProjectIdSchema = z.string().uuid("Investment projection project ID is invalid.");
export const investmentProjectionProjectNameSchema = z.string().trim().min(1, "Projection project name is required.").max(120, "Projection project name must be 120 characters or fewer.");
export const investmentProjectionNotesSchema = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? null : value,
  z.string().trim().max(500, "Projection notes must be 500 characters or fewer.").nullable(),
);
export const investmentProjectionHorizonSchema = z.coerce.number().int().min(1, "Projection horizon must be at least one year.").max(35, "Projection horizon cannot exceed 35 years.");
export const investmentProjectionRateSchema = z.coerce.number().int().min(-10000, "Annual return cannot be lower than -100%.").max(10000, "Annual return cannot exceed 100%.");

/**
 * Projection inputs use minor units and fixed-point basis points. Keep these
 * schemas numeric so callers cannot accidentally submit display CAD strings
 * or floating-point money values to the planning contract.
 */
const investmentProjectionSafeIntegerSchema = z.number()
  .finite()
  .int();

export const investmentProjectionMinorUnitsSchema = investmentProjectionSafeIntegerSchema
  .min(0, "Amount cannot be negative.")
  .refine(Number.isSafeInteger, "Amount must be a safe integer.");
export const investmentProjectionBasisPointsSchema = investmentProjectionSafeIntegerSchema
  .min(-10000, "Rate cannot be lower than -100%.")
  .max(10000, "Rate cannot exceed 100%.")
  .refine(Number.isSafeInteger, "Rate must be a safe integer.");
export const investmentProjectionAnnualIncreaseBpsSchema = investmentProjectionSafeIntegerSchema
  .min(0, "Annual increase cannot be negative.")
  .max(10000, "Annual increase cannot exceed 100%.")
  .refine(Number.isSafeInteger, "Annual increase must be a safe integer.");
export const investmentProjectionFrequencySchema = z.enum(["monthly", "biweekly"]);
export const investmentProjectionProjectModeSchema = z.enum(["calculator", "portfolio"]);
export const investmentProjectionOverrideYearSchema = z.coerce.number()
  .finite()
  .int()
  .min(1900, "Override year must be 1900 or later.")
  .max(2200, "Override year must be 2200 or earlier.")
  .refine(Number.isSafeInteger, "Override year must be a safe integer.");

const investmentProjectionAccountIdsSchema = z.array(accountIdSchema).min(1, "Choose at least one investment account.").max(4, "Choose no more than four investment accounts.");
const investmentProjectionRatesSchema = z.array(investmentProjectionRateSchema).min(1, "Add at least one return-rate scenario.").max(4, "Add no more than four return-rate scenarios.");

const legacyInvestmentProjectionProjectBaseSchema = z.object({
  name: investmentProjectionProjectNameSchema,
  notes: investmentProjectionNotesSchema,
  horizonYears: investmentProjectionHorizonSchema,
  investmentAccountIds: investmentProjectionAccountIdsSchema,
  ratesBps: investmentProjectionRatesSchema,
});

function refineLegacyInvestmentProjectionProject(input: z.infer<typeof legacyInvestmentProjectionProjectBaseSchema>, context: z.RefinementCtx): void {
  if (new Set(input.investmentAccountIds).size !== input.investmentAccountIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["investmentAccountIds"], message: "Select each investment account only once." });
  }
  if (new Set(input.ratesBps).size !== input.ratesBps.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["ratesBps"], message: "Return-rate scenarios must be unique." });
  }
}

const investmentProjectionProjectRatesInputSchema = z.array(investmentProjectionBasisPointsSchema)
  .min(1, "Add at least one return-rate scenario.")
  .max(4, "Add no more than four return-rate scenarios.")
  .superRefine((rates, context) => {
    if (new Set(rates).size !== rates.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Return-rate scenarios must be unique." });
    }
  });

const investmentProjectionProjectMetadataSchema = z.object({
  name: investmentProjectionProjectNameSchema,
  notes: investmentProjectionNotesSchema.optional().default(null),
  horizonYears: investmentProjectionHorizonSchema,
  ratesBps: investmentProjectionProjectRatesInputSchema,
});

export const investmentProjectionAnnualOverrideIdSchema = z.string().uuid("Investment projection annual override ID is invalid.");
export const investmentProjectionAnnualOverrideInputSchema = z.object({
  id: investmentProjectionAnnualOverrideIdSchema.optional().nullable(),
  year: investmentProjectionOverrideYearSchema,
  amountMinor: investmentProjectionMinorUnitsSchema,
});

export const investmentProjectionAnnualIncreaseModeSchema = z.enum(["percentage", "fixed_amount"]);
export const investmentProjectionContributionSourceSchema = z.enum(["cash_flow", "manual"]);

export const investmentProjectionAccountScheduleIdSchema = z.string().uuid("Investment projection account schedule ID is invalid.");
export const investmentProjectionAccountScheduleInputSchema = z.object({
  id: investmentProjectionAccountScheduleIdSchema.optional().nullable(),
  investmentAccountId: accountIdSchema,
  displayOrder: z.coerce.number().int().min(0).max(100).optional(),
  frequency: investmentProjectionFrequencySchema,
  baseContributionMinor: investmentProjectionMinorUnitsSchema,
  annualIncreaseBps: investmentProjectionAnnualIncreaseBpsSchema,
  annualIncreaseMode: investmentProjectionAnnualIncreaseModeSchema.default("percentage"),
  annualIncreaseMinor: investmentProjectionMinorUnitsSchema.default(0),
  contributionSource: investmentProjectionContributionSourceSchema.default("cash_flow"),
  annualOverrides: z.array(investmentProjectionAnnualOverrideInputSchema).max(35, "Add no more than 35 annual overrides.").default([]),
}).superRefine((schedule, context) => {
  const years = schedule.annualOverrides.map((override) => override.year);
  if (new Set(years).size !== years.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["annualOverrides"], message: "Annual override years must be unique." });
  }
  if (schedule.annualIncreaseMode === "percentage" && schedule.annualIncreaseMinor !== 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["annualIncreaseMinor"], message: "Use a zero fixed amount when annual increase mode is percentage." });
  }
  if (schedule.annualIncreaseMode === "fixed_amount" && schedule.annualIncreaseBps !== 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["annualIncreaseBps"], message: "Use a zero percentage when annual increase mode is fixed amount." });
  }
});

const investmentProjectionCalculatorProjectInputShape = investmentProjectionProjectMetadataSchema.extend({
  mode: z.literal("calculator"),
  manualStartingAmountMinor: investmentProjectionMinorUnitsSchema.default(0),
}).strict();

const investmentProjectionPortfolioProjectInputShape = investmentProjectionProjectMetadataSchema.extend({
  mode: z.literal("portfolio"),
  accountSchedules: z.array(investmentProjectionAccountScheduleInputSchema)
    .min(1, "Choose at least one investment account.")
    .max(4, "Choose no more than four investment accounts.")
    .superRefine((schedules, context) => {
      const accountIds = schedules.map((schedule) => schedule.investmentAccountId);
      if (new Set(accountIds).size !== accountIds.length) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["accountSchedules"], message: "Select each investment account only once." });
      }
    }),
}).strict();

export const investmentProjectionCalculatorProjectInputSchema = investmentProjectionCalculatorProjectInputShape;
export const investmentProjectionPortfolioProjectInputSchema = investmentProjectionPortfolioProjectInputShape;
export const investmentProjectionProjectModeInputSchema = z.discriminatedUnion("mode", [
  investmentProjectionCalculatorProjectInputShape,
  investmentProjectionPortfolioProjectInputShape,
]);

export const investmentProjectionCalculatorProjectUpdateInputSchema = investmentProjectionCalculatorProjectInputShape.extend({ id: investmentProjectionProjectIdSchema }).strict();
export const investmentProjectionPortfolioProjectUpdateInputSchema = investmentProjectionPortfolioProjectInputShape.extend({ id: investmentProjectionProjectIdSchema }).strict();
export const investmentProjectionProjectModeUpdateInputSchema = z.discriminatedUnion("mode", [
  investmentProjectionCalculatorProjectUpdateInputSchema,
  investmentProjectionPortfolioProjectUpdateInputSchema,
]);

const legacyInvestmentProjectionProjectInputSchema = legacyInvestmentProjectionProjectBaseSchema.superRefine(refineLegacyInvestmentProjectionProject);

// Keep the existing account/rate-only contract valid while the mode-aware
// server actions roll out. New callers should use the discriminated mode
// branch; old callers remain compatible and are still validated identically.
export const investmentProjectionProjectInputSchema = z.union([
  legacyInvestmentProjectionProjectInputSchema,
  investmentProjectionProjectModeInputSchema,
]);

export const investmentProjectionProjectCreateInputSchema = investmentProjectionProjectInputSchema;
export const investmentProjectionProjectUpdateInputSchema = z.union([
  legacyInvestmentProjectionProjectBaseSchema.extend({ id: investmentProjectionProjectIdSchema }).superRefine(refineLegacyInvestmentProjectionProject),
  investmentProjectionProjectModeUpdateInputSchema,
]);
export const investmentProjectionProjectDeleteInputSchema = z.object({
  id: investmentProjectionProjectIdSchema,
  confirm: z.boolean(),
}).refine((input) => input.confirm, { path: ["confirm"], message: "Confirm deleting this projection project." });

export const investmentCashFlowAccountLinkInputSchema = z.object({
  investmentAccountId: accountIdSchema,
  cashFlowAccountId: accountIdSchema.nullable(),
});

export type InvestmentProjectionProjectInput = z.infer<typeof investmentProjectionProjectInputSchema>;
export type InvestmentProjectionProjectCreateInput = z.infer<typeof investmentProjectionProjectCreateInputSchema>;
export type InvestmentProjectionProjectUpdateInput = z.infer<typeof investmentProjectionProjectUpdateInputSchema>;
export type InvestmentProjectionProjectDeleteInput = z.infer<typeof investmentProjectionProjectDeleteInputSchema>;
export type InvestmentProjectionCalculatorProjectInput = z.infer<typeof investmentProjectionCalculatorProjectInputSchema>;
export type InvestmentProjectionPortfolioProjectInput = z.infer<typeof investmentProjectionPortfolioProjectInputSchema>;
export type InvestmentProjectionAccountScheduleInput = z.infer<typeof investmentProjectionAccountScheduleInputSchema>;
export type InvestmentProjectionAnnualOverrideInput = z.infer<typeof investmentProjectionAnnualOverrideInputSchema>;

export const investmentHoldingIdSchema = z.string().uuid("Holding ID is invalid.");
export const investmentHoldingTransactionIdSchema = z.string().uuid("Holding transaction ID is invalid.");
export const investmentHoldingInstrumentTypeSchema = z.enum(["mutual_fund", "etf"]);
export const investmentHoldingCurrencySchema = z.enum(["CAD", "USD"]);
export const investmentHoldingTransactionKindSchema = z.enum(["opening", "buy", "sell", "distribution", "fee"]);
export const investmentQuoteSourceSchema = z.enum(["manual", "market"]);
export const investmentHoldingSymbolSchema = z.string()
  .trim()
  .min(1, "Symbol is required.")
  .max(24, "Symbol must be 24 characters or fewer.")
  .regex(/^[A-Za-z0-9._:-]+$/, "Use letters, numbers, dots, hyphens, colons, or underscores in the symbol.");
export const investmentHoldingNameSchema = z.string().trim().min(1, "Holding name is required.").max(120, "Holding name must be 120 characters or fewer.");
export const investmentHoldingNoteSchema = z.preprocess(
  (value) => value === undefined || value === null ? null : value,
  z.string().trim().max(500, "Note must be 500 characters or fewer.").nullable().transform((value) => value || null),
);

export function investmentUnitsToMicros(value: string): number | null {
  try {
    const normalized = value.trim();
    if (!/^\d+(?:\.\d{1,6})?$/.test(normalized)) return null;
    const [wholePart = "", fractionPart = ""] = normalized.split(".");
    const micros = BigInt(wholePart) * 1_000_000n + BigInt(fractionPart.padEnd(6, "0"));
    return micros <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(micros) : null;
  } catch {
    return null;
  }
}

export function investmentFxRateToPpm(value: string): number | null {
  try {
    const normalized = value.trim();
    if (!/^\d+(?:\.\d{1,6})?$/.test(normalized)) return null;
    const [wholePart = "", fractionPart = ""] = normalized.split(".");
    const ppm = BigInt(wholePart) * 1_000_000n + BigInt(fractionPart.padEnd(6, "0"));
    return ppm > 0n && ppm <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(ppm) : null;
  } catch {
    return null;
  }
}

const investmentHoldingAmountSchema = z.string()
  .trim()
  .regex(/^\d+(?:\.\d{1,2})?$/, "Enter a non-negative amount with at most two decimal places.")
  .refine((value) => cadAmountToMinorUnits(value) !== null, "Amount is too large.")
  .transform((value) => cadAmountToMinorUnits(value)!);
const investmentHoldingUnitsSchema = z.preprocess(
  (value) => value === undefined || value === null || value === "" ? "0" : value,
  z.string()
    .trim()
    .refine((value) => investmentUnitsToMicros(value) !== null, "Enter units with at most six decimal places.")
    .transform((value) => investmentUnitsToMicros(value)!),
);
const investmentHoldingFxRateSchema = z.string()
  .trim()
  .regex(/^\d+(?:\.\d{1,6})?$/, "Enter an FX rate with at most six decimal places.")
  .refine((value) => investmentFxRateToPpm(value) !== null, "FX rate must be positive and safe.")
  .transform((value) => investmentFxRateToPpm(value)!);

export const investmentHoldingCreateInputSchema = z.object({
  accountId: accountIdSchema,
  instrumentType: investmentHoldingInstrumentTypeSchema,
  symbol: investmentHoldingSymbolSchema,
  name: investmentHoldingNameSchema,
  currency: investmentHoldingCurrencySchema,
});

export const investmentHoldingTransactionCreateInputSchema = z.object({
  holdingId: investmentHoldingIdSchema,
  occurredOn: snapshotDateSchema,
  kind: investmentHoldingTransactionKindSchema,
  units: investmentHoldingUnitsSchema,
  amount: investmentHoldingAmountSchema,
  fee: z.preprocess((value) => value === undefined || value === null || value === "" ? "0" : value, investmentHoldingAmountSchema),
  note: investmentHoldingNoteSchema,
}).superRefine((input, context) => {
  if (["opening", "buy", "sell"].includes(input.kind) && input.units <= 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["units"], message: "Enter units greater than zero." });
  }
  if (input.kind === "distribution" && (input.units !== 0 || input.amount <= 0)) {
    if (input.units !== 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ["units"], message: "Distributions do not add units." });
    if (input.amount <= 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ["amount"], message: "Distribution amount must be greater than zero." });
  }
  if (input.kind === "fee" && (input.units !== 0 || input.amount <= 0 || input.fee !== 0)) {
    if (input.units !== 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ["units"], message: "Fees do not add units." });
    if (input.amount <= 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ["amount"], message: "Fee amount must be greater than zero." });
    if (input.fee !== 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ["fee"], message: "Fee transactions use the amount field only." });
  }
});

export const investmentHoldingPriceInputSchema = z.object({
  holdingId: investmentHoldingIdSchema,
  effectiveOn: snapshotDateSchema,
  price: investmentHoldingAmountSchema,
});

export const investmentFxRateInputSchema = z.object({
  effectiveOn: snapshotDateSchema,
  rate: investmentHoldingFxRateSchema,
});

export const investmentHoldingMarketRefreshInputSchema = z.object({
  holdingId: investmentHoldingIdSchema,
  valuationOn: snapshotDateSchema,
});

export const investmentHoldingTransactionDeleteInputSchema = z.object({
  holdingId: investmentHoldingIdSchema,
  transactionId: investmentHoldingTransactionIdSchema,
  confirm: z.literal(true),
});

export const investmentHoldingDeleteInputSchema = z.object({
  holdingId: investmentHoldingIdSchema,
  confirm: z.literal(true),
});

export type InvestmentHoldingCreateInput = z.infer<typeof investmentHoldingCreateInputSchema>;
export type InvestmentHoldingTransactionCreateInput = z.infer<typeof investmentHoldingTransactionCreateInputSchema>;
export type InvestmentHoldingPriceInput = z.infer<typeof investmentHoldingPriceInputSchema>;
export type InvestmentFxRateInput = z.infer<typeof investmentFxRateInputSchema>;
export type InvestmentHoldingMarketRefreshInput = z.infer<typeof investmentHoldingMarketRefreshInputSchema>;
export type InvestmentHoldingTransactionDeleteInput = z.infer<typeof investmentHoldingTransactionDeleteInputSchema>;
export type InvestmentHoldingDeleteInput = z.infer<typeof investmentHoldingDeleteInputSchema>;

export const householdExpenseFrequencySchema = z.enum(["weekly", "biweekly", "monthly", "quarterly", "annual"]);

export const householdExpenseNameSchema = z.string().trim().min(1, "Name is required.").max(120, "Name must be 120 characters or fewer.");

export const householdExpenseCategorySchema = z.string().trim().min(1, "Category is required.").max(80, "Category must be 80 characters or fewer.").nullable();

export const householdExpenseAmountSchema = z.string()
  .trim()
  .regex(/^\d+(?:\.\d{1,2})?$/, "Enter a non-negative CAD amount with at most two decimal places.")
  .refine((value) => cadAmountToMinorUnits(value) !== null, "CAD amount is too large.")
  .transform((value) => cadAmountToMinorUnits(value)!);

export const householdExpenseAccountIdSchema = z.union([z.string().uuid(), z.null()]);

export const householdExpenseInputSchema = z.object({
  name: householdExpenseNameSchema,
  category: householdExpenseCategorySchema,
  frequency: householdExpenseFrequencySchema,
  amount: householdExpenseAmountSchema,
  accountId: householdExpenseAccountIdSchema,
});

export const householdExpenseIdSchema = z.string().uuid("Expense ID is invalid.");

export type HouseholdExpenseInput = z.infer<typeof householdExpenseInputSchema>;

export const annualBudgetIdSchema = z.string().uuid("Annual budget ID is invalid.");
export const annualExpenseIdSchema = z.string().uuid("Annual expense ID is invalid.");
export const annualExpenseValueIdSchema = z.string().uuid("Annual expense occurrence ID is invalid.");
export const annualExpensePaymentIdSchema = z.string().uuid("Annual expense payment ID is invalid.");
export const annualBudgetNameSchema = z.string().trim().min(1, "Budget name is required.").max(120, "Budget name must be 120 characters or fewer.");
export const annualExpenseNameSchema = z.string().trim().min(1, "Annual expense name is required.").max(120, "Annual expense name must be 120 characters or fewer.");
export const annualBudgetYearSchema = z.coerce.number().int().min(1900, "Year must be 1900 or later.").max(2200, "Year must be 2200 or earlier.");
export const annualBudgetDueMonthSchema = z.coerce.number().int().min(1, "Due month must be between 1 and 12.").max(12, "Due month must be between 1 and 12.");
export const annualBudgetDueDaySchema = z.coerce.number().int().min(1, "Due day must be between 1 and 31.").max(31, "Due day must be between 1 and 31.");
export const annualBudgetScopeSchema = z.enum(["current_year", "this_and_future"]);

export const annualBudgetTemplateAmountSchema = z.string()
  .trim()
  .regex(/^\d+(?:\.\d{1,2})?$/, "Enter a non-negative CAD amount with at most two decimal places.")
  .refine((value) => cadAmountToMinorUnits(value) !== null, "CAD amount is too large.")
  .transform((value) => cadAmountToMinorUnits(value)!);

export const annualBudgetPaymentAmountSchema = annualBudgetTemplateAmountSchema.refine((value) => value > 0, "Payment amount must be greater than zero.");

const nullableAnnualBudgetDateSchema = snapshotDateSchema.optional().nullable();
const nullableAnnualBudgetAmountSchema = annualBudgetTemplateAmountSchema.optional().nullable();
const nullableAnnualBudgetNoteSchema = z.string().trim().max(240, "Note must be 240 characters or fewer.").optional().nullable().transform((value) => value || null);

export const annualBudgetTemplateInputSchema = z.object({
  id: annualBudgetIdSchema.optional().nullable(),
  name: annualBudgetNameSchema,
  linkedAccountId: accountIdSchema,
  displayOrder: z.coerce.number().int().min(0).max(100),
  isActive: z.boolean().default(true),
});

export const annualBudgetCreateInputSchema = z.object({
  name: annualBudgetNameSchema,
  linkedAccountId: accountIdSchema,
});

export const annualBudgetRenameInputSchema = z.object({
  id: annualBudgetIdSchema,
  name: annualBudgetNameSchema,
});

export const annualBudgetRelinkInputSchema = z.object({
  id: annualBudgetIdSchema,
  linkedAccountId: accountIdSchema,
});

export const annualBudgetUpdateInputSchema = z.object({
  id: annualBudgetIdSchema,
  name: annualBudgetNameSchema,
  linkedAccountId: accountIdSchema,
});

export const annualBudgetReorderInputSchema = z.object({
  id: annualBudgetIdSchema,
  direction: z.enum(["up", "down"]),
});

export const annualBudgetArchiveInputSchema = z.object({
  id: annualBudgetIdSchema,
  confirm: z.boolean(),
}).refine((input) => input.confirm, { path: ["confirm"], message: "Confirm the annual budget archive." });

export const annualBudgetRestoreInputSchema = z.object({
  id: annualBudgetIdSchema,
  linkedAccountId: accountIdSchema.nullable().default(null),
  confirm: z.boolean(),
}).refine((input) => input.confirm, { path: ["confirm"], message: "Confirm the annual budget restore." });

export const annualExpenseTemplateInputSchema = z.object({
  id: annualExpenseIdSchema.optional().nullable(),
  budgetId: annualBudgetIdSchema,
  name: annualExpenseNameSchema,
  amount: annualBudgetTemplateAmountSchema,
  dueMonth: annualBudgetDueMonthSchema,
  dueDay: annualBudgetDueDaySchema.optional().nullable(),
  isActive: z.boolean().default(true),
});

export const annualExpenseYearOverrideInputSchema = z.object({
  annualExpenseId: annualExpenseIdSchema,
  taxYear: annualBudgetYearSchema,
  budgetId: annualBudgetIdSchema.optional(),
  plannedAmount: nullableAnnualBudgetAmountSchema,
  dueDate: nullableAnnualBudgetDateSchema,
  note: nullableAnnualBudgetNoteSchema,
  scope: annualBudgetScopeSchema.default("current_year"),
});

export const annualExpenseMoveInputSchema = z.object({
  annualExpenseId: annualExpenseIdSchema,
  targetBudgetId: annualBudgetIdSchema,
  confirm: z.boolean(),
}).refine((input) => input.confirm, { path: ["confirm"], message: "Confirm the budget move." });

export const annualExpenseRemainderTransferInputSchema = z.object({
  annualExpenseId: annualExpenseIdSchema,
  taxYear: annualBudgetYearSchema,
  confirm: z.boolean(),
}).refine((input) => input.confirm, { path: ["confirm"], message: "Confirm moving the annual-expense remainder." });

export const annualExpenseArchiveInputSchema = z.object({
  annualExpenseId: annualExpenseIdSchema,
  archived: z.boolean(),
  confirm: z.boolean(),
}).refine((input) => input.confirm, { path: ["confirm"], message: "Confirm the archive change." });

export const annualExpensePaymentInputSchema = z.object({
  id: annualExpensePaymentIdSchema.optional().nullable(),
  annualExpenseValueId: annualExpenseValueIdSchema,
  paymentOn: snapshotDateSchema,
  amount: annualBudgetPaymentAmountSchema,
  note: nullableAnnualBudgetNoteSchema,
});

export const annualExpensePaymentMutationSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("create"), payment: annualExpensePaymentInputSchema, confirm: z.boolean() }),
  z.object({ mode: z.literal("update"), payment: annualExpensePaymentInputSchema.extend({ id: annualExpensePaymentIdSchema }), confirm: z.boolean() }),
  z.object({ mode: z.literal("delete"), id: annualExpensePaymentIdSchema, confirm: z.literal(true) }),
]).superRefine((input, context) => {
  if (input.mode !== "delete" && !input.confirm) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["confirm"], message: "Confirm the payment change." });
  }
});

export const salaryYearIdSchema = z.string().uuid("Salary year ID is invalid.");
export const salarySnapshotIdSchema = z.string().uuid("Salary snapshot ID is invalid.");
export const salaryTaxYearSchema = z.coerce.number().int().min(1900, "Tax year must be 1900 or later.").max(2200, "Tax year must be 2200 or earlier.");
export const salaryPayCountSchema = z.coerce.number().int().min(1, "Pay count must be at least 1.").max(366, "Pay count must be 366 or fewer.");

export function salaryAmountToMinorUnits(value: string): number | null {
  try {
    let normalized = value.trim().replace(/[\u00a0 ]/g, "");
    if (!normalized) return null;
    const commaIndex = normalized.lastIndexOf(",");
    const dotIndex = normalized.lastIndexOf(".");
    if (commaIndex >= 0 && dotIndex >= 0) {
      if (commaIndex > dotIndex) normalized = normalized.replaceAll(".", "").replace(",", ".");
      else normalized = normalized.replaceAll(",", "");
    } else if (commaIndex >= 0) {
      normalized = /^\d{1,3}(?:,\d{3})+$/.test(normalized) ? normalized.replaceAll(",", "") : normalized.replace(",", ".");
    }
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
    const [wholePart = "", fractionPart = ""] = normalized.split(".");
    const minor = BigInt(wholePart) * 100n + BigInt(fractionPart.padEnd(2, "0"));
    return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
  } catch {
    return null;
  }
}

/** Converts a percentage such as `6.30` or `6,30%` to integer basis points. */
export function salaryRateToBasisPoints(value: string): number | null {
  try {
    let normalized = value.trim().replace(/[\u00a0 ]/g, "").replace(/%$/, "");
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(normalized)) return null;
    normalized = normalized.replace(",", ".");
    const [wholePart = "", fractionPart = ""] = normalized.split(".");
    const basisPoints = BigInt(wholePart) * 100n + BigInt(fractionPart.padEnd(2, "0"));
    return basisPoints <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(basisPoints) : null;
  } catch {
    return null;
  }
}

export const salaryAmountSchema = z.string()
  .trim()
  .min(1, "Enter a non-negative CAD amount.")
  .refine((value) => salaryAmountToMinorUnits(value) !== null, "Enter a valid non-negative CAD amount with at most two decimal places.")
  .transform((value) => salaryAmountToMinorUnits(value)!);

const nullableSalaryAmountSchema = z.preprocess(
  (value) => value === "" || value === undefined || value === null ? null : value,
  salaryAmountSchema.nullable(),
);
export const salaryRrqContributionYtdSchema = z.preprocess(
  (value) => value === "" || value === null ? null : value,
  salaryAmountSchema.nullable().optional(),
);

const rrqLimitNonnegativeAmountSchema = z.string()
  .trim()
  .min(1, "Enter a non-negative CAD amount.")
  .refine((value) => salaryAmountToMinorUnits(value) !== null, "Enter a valid CAD amount with at most two decimal places.")
  .transform((value) => salaryAmountToMinorUnits(value)!);
const rrqLimitPositiveAmountSchema = rrqLimitNonnegativeAmountSchema.refine((value) => value > 0, "Value must be greater than zero.");
const rrqRateSchema = z.string()
  .trim()
  .min(1, "Enter an RRQ rate.")
  .refine((value) => salaryRateToBasisPoints(value) !== null, "Enter a valid percentage with at most two decimal places.")
  .transform((value) => salaryRateToBasisPoints(value)!)
  .refine((value) => value > 0 && value <= 10_000, "RRQ rate must be between 0.01% and 100%.");

export const rrqYearLimitInputSchema = z.object({
  taxYear: salaryTaxYearSchema,
  firstMaximum: rrqLimitNonnegativeAmountSchema,
  additionalMaximum: rrqLimitNonnegativeAmountSchema,
  ympe: rrqLimitPositiveAmountSchema,
  yampe: rrqLimitPositiveAmountSchema,
  firstRate: rrqRateSchema,
  additionalRate: rrqRateSchema,
}).superRefine((input, context) => {
  if (input.yampe < input.ympe) context.addIssue({ code: z.ZodIssueCode.custom, path: ["yampe"], message: "YAMPE must be at least YMPE." });
});

const nullableSalaryPayCountSchema = z.preprocess(
  (value) => value === "" || value === undefined || value === null ? null : value,
  salaryPayCountSchema.nullable(),
);
const nullableSalaryNoteSchema = z.string().trim().max(500, "Note must be 500 characters or fewer.").optional().nullable().transform((value) => value || null);

export const salaryYearInputSchema = z.object({
  taxYear: salaryTaxYearSchema,
  annualBase: nullableSalaryAmountSchema,
  payPeriodsPerYearOverride: nullableSalaryPayCountSchema,
  note: nullableSalaryNoteSchema,
});

export const salaryYearCreateInputSchema = salaryYearInputSchema.extend({
  annualBase: salaryAmountSchema,
});

export const salaryYearUpdateInputSchema = salaryYearInputSchema;

export const salaryFinalizationInputSchema = z.object({
  salaryYearId: salaryYearIdSchema,
  finalFederal: salaryAmountSchema,
});

export const salaryFinalizedYearCreateInputSchema = z.object({
  taxYear: salaryTaxYearSchema,
  finalFederal: salaryAmountSchema,
  note: nullableSalaryNoteSchema,
});

export const salarySnapshotInputSchema = z.object({
  id: salarySnapshotIdSchema.optional().nullable(),
  salaryYearId: salaryYearIdSchema,
  snapshotOn: snapshotDateSchema,
  federalCumulative: salaryAmountSchema,
  provincialCumulative: salaryAmountSchema,
  rrqContributionYtd: salaryRrqContributionYtdSchema,
  completedPayNumberOverride: nullableSalaryPayCountSchema,
  note: nullableSalaryNoteSchema,
});

export const salarySnapshotCreateInputSchema = salarySnapshotInputSchema.omit({ id: true });
export const salarySnapshotUpdateInputSchema = salarySnapshotInputSchema.extend({ id: salarySnapshotIdSchema });

export const sharedProjectIdSchema = z.string().uuid("Project ID is invalid.");
export const sharedProjectExpenseIdSchema = z.string().uuid("Project expense ID is invalid.");
export const sharedProjectParticipantIdSchema = z.string().uuid("Project participant ID is invalid.");
export const sharedProjectYearSchema = z.coerce.number().int().min(1900, "Project year must be 1900 or later.").max(2200, "Project year must be 2200 or earlier.");
export const sharedProjectNameSchema = z.string().trim().min(1, "Project name is required.").max(120, "Project name must be 120 characters or fewer.");
const sharedProjectNoteSchema = z.string().trim().max(500, "Project note must be 500 characters or fewer.").optional().nullable().transform((value) => value || null);
export const sharedProjectDateSchema = z.string().date("Project date must be a valid ISO date.");
const nullableSharedProjectDateSchema = z.preprocess(
  (value) => value === "" || value === undefined || value === null ? null : value,
  sharedProjectDateSchema.nullable(),
);
export const sharedProjectExpenseAmountSchema = z.string()
  .trim()
  .regex(/^\d+(?:\.\d{1,2})?$/, "Enter a positive CAD amount with at most two decimal places.")
  .refine((value) => cadAmountToMinorUnits(value) !== null && cadAmountToMinorUnits(value)! > 0, "Expense amount must be greater than zero.")
  .transform((value) => cadAmountToMinorUnits(value)!);
export const sharedProjectExpenseQuantitySchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return 1;
    if (typeof value === "string") {
      const normalized = value.trim();
      if (!normalized) return 1;
      return /^\d+$/.test(normalized) ? Number(normalized) : value;
    }
    return value;
  },
  z.number().refine((value) => Number.isSafeInteger(value) && value > 0, "Quantity must be a positive whole safe integer."),
);
export const sharedProjectPaidAmountSchema = z.string()
  .trim()
  .regex(/^\d+(?:\.\d{1,2})?$/, "Enter a non-negative CAD amount with at most two decimal places.")
  .refine((value) => cadAmountToMinorUnits(value) !== null, "Paid amount is too large.")
  .transform((value) => cadAmountToMinorUnits(value)!);
export const sharedProjectDescriptionSchema = z.string().trim().min(1, "Expense description is required.").max(240, "Expense description must be 240 characters or fewer.");
export const sharedProjectParticipantNameSchema = z.string().trim().min(1, "Participant name is required.").max(120, "Participant name must be 120 characters or fewer.");

export const sharedProjectInputSchema = z.object({
  name: sharedProjectNameSchema,
  year: sharedProjectYearSchema,
  ownerParticipates: z.boolean(),
  note: sharedProjectNoteSchema,
});
export const sharedProjectCreateInputSchema = sharedProjectInputSchema;
export const sharedProjectUpdateInputSchema = sharedProjectInputSchema.extend({ id: sharedProjectIdSchema });
export const sharedProjectCloneInputSchema = z.object({
  sourceProjectId: sharedProjectIdSchema,
  name: sharedProjectNameSchema,
  year: sharedProjectYearSchema,
});

export const sharedProjectExpenseInputSchema = z.object({
  projectId: sharedProjectIdSchema,
  description: sharedProjectDescriptionSchema,
  expenseOn: nullableSharedProjectDateSchema,
  quantity: sharedProjectExpenseQuantitySchema,
  amount: sharedProjectExpenseAmountSchema,
  note: sharedProjectNoteSchema,
});
export const sharedProjectExpenseCreateInputSchema = sharedProjectExpenseInputSchema;
export const sharedProjectExpenseUpdateInputSchema = sharedProjectExpenseInputSchema.extend({ id: sharedProjectExpenseIdSchema });
export const sharedProjectExpenseDeleteInputSchema = z.object({
  projectId: sharedProjectIdSchema,
  id: sharedProjectExpenseIdSchema,
  confirm: z.boolean(),
}).refine((input) => input.confirm, { path: ["confirm"], message: "Confirm deleting this project expense." });

export const sharedProjectParticipantInputSchema = z.object({
  projectId: sharedProjectIdSchema,
  name: sharedProjectParticipantNameSchema,
  paidAmount: sharedProjectPaidAmountSchema,
});
export const sharedProjectParticipantCreateInputSchema = sharedProjectParticipantInputSchema;
export const sharedProjectParticipantUpdateInputSchema = sharedProjectParticipantInputSchema.extend({ id: sharedProjectParticipantIdSchema });
export const sharedProjectParticipantDeleteInputSchema = z.object({
  projectId: sharedProjectIdSchema,
  id: sharedProjectParticipantIdSchema,
  confirm: z.boolean(),
}).refine((input) => input.confirm, { path: ["confirm"], message: "Confirm deleting this project participant." });

export const sharedProjectArchiveInputSchema = z.object({
  projectId: sharedProjectIdSchema,
  archived: z.boolean(),
  confirm: z.boolean(),
}).refine((input) => input.confirm, { path: ["confirm"], message: "Confirm the project archive or restore." });

export type AnnualBudgetTemplateInput = z.infer<typeof annualBudgetTemplateInputSchema>;
export type AnnualBudgetCreateInput = z.infer<typeof annualBudgetCreateInputSchema>;
export type AnnualBudgetRenameInput = z.infer<typeof annualBudgetRenameInputSchema>;
export type AnnualBudgetRelinkInput = z.infer<typeof annualBudgetRelinkInputSchema>;
export type AnnualBudgetUpdateInput = z.infer<typeof annualBudgetUpdateInputSchema>;
export type AnnualBudgetArchiveInput = z.infer<typeof annualBudgetArchiveInputSchema>;
export type AnnualBudgetRestoreInput = z.infer<typeof annualBudgetRestoreInputSchema>;
export type AnnualExpenseTemplateInput = z.infer<typeof annualExpenseTemplateInputSchema>;
export type AnnualExpenseYearOverrideInput = z.infer<typeof annualExpenseYearOverrideInputSchema>;
export type AnnualExpenseMoveInput = z.infer<typeof annualExpenseMoveInputSchema>;
export type AnnualExpenseRemainderTransferInput = z.infer<typeof annualExpenseRemainderTransferInputSchema>;
export type AnnualExpenseArchiveInput = z.infer<typeof annualExpenseArchiveInputSchema>;
export type AnnualExpensePaymentInput = z.infer<typeof annualExpensePaymentInputSchema>;
export type AnnualExpensePaymentMutation = z.infer<typeof annualExpensePaymentMutationSchema>;
export type SalaryYearInput = z.infer<typeof salaryYearInputSchema>;
export type SalaryYearCreateInput = z.infer<typeof salaryYearCreateInputSchema>;
export type SalaryYearUpdateInput = z.infer<typeof salaryYearUpdateInputSchema>;
export type SalaryFinalizationInput = z.infer<typeof salaryFinalizationInputSchema>;
export type SalaryFinalizedYearCreateInput = z.infer<typeof salaryFinalizedYearCreateInputSchema>;
export type SalarySnapshotInput = z.infer<typeof salarySnapshotInputSchema>;
export type SalarySnapshotCreateInput = z.infer<typeof salarySnapshotCreateInputSchema>;
export type SalarySnapshotUpdateInput = z.infer<typeof salarySnapshotUpdateInputSchema>;
export type RrqYearLimitInput = z.infer<typeof rrqYearLimitInputSchema>;
export type SharedProjectInput = z.infer<typeof sharedProjectInputSchema>;
export type SharedProjectCreateInput = z.infer<typeof sharedProjectCreateInputSchema>;
export type SharedProjectUpdateInput = z.infer<typeof sharedProjectUpdateInputSchema>;
export type SharedProjectCloneInput = z.infer<typeof sharedProjectCloneInputSchema>;
export type SharedProjectExpenseInput = z.infer<typeof sharedProjectExpenseInputSchema>;
export type SharedProjectExpenseCreateInput = z.infer<typeof sharedProjectExpenseCreateInputSchema>;
export type SharedProjectExpenseUpdateInput = z.infer<typeof sharedProjectExpenseUpdateInputSchema>;
export type SharedProjectExpenseDeleteInput = z.infer<typeof sharedProjectExpenseDeleteInputSchema>;
export type SharedProjectParticipantInput = z.infer<typeof sharedProjectParticipantInputSchema>;
export type SharedProjectParticipantCreateInput = z.infer<typeof sharedProjectParticipantCreateInputSchema>;
export type SharedProjectParticipantUpdateInput = z.infer<typeof sharedProjectParticipantUpdateInputSchema>;
export type SharedProjectParticipantDeleteInput = z.infer<typeof sharedProjectParticipantDeleteInputSchema>;
export type SharedProjectArchiveInput = z.infer<typeof sharedProjectArchiveInputSchema>;

export const homeValueAmountSchema = z.string()
  .trim()
  .regex(/^\d+(?:\.\d{1,2})?$/, "Enter a non-negative CAD amount with at most two decimal places.")
  .refine((value) => cadAmountToMinorUnits(value) !== null, "CAD amount is too large.")
  .transform((value) => cadAmountToMinorUnits(value)!);

export const homeValueInputSchema = z.object({
  asOf: snapshotDateSchema,
  marketValue: homeValueAmountSchema,
});

export const homeValueDateSchema = snapshotDateSchema;
export const homeMortgageAnchorInputSchema = z.object({
  asOf: snapshotDateSchema,
  principal: homeValueAmountSchema,
});

export const homeMortgageCompoundingConventionSchema = z.enum(["canadian_semi_annual", "annual", "monthly"]);

export function mortgageRateToBasisPoints(value: string): number | null {
  try {
    const normalized = value.trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
    const [wholePart = "", fractionPart = ""] = normalized.split(".");
    const basisPoints = BigInt(wholePart) * 100n + BigInt(fractionPart.padEnd(2, "0"));
    return basisPoints <= 10_000n ? Number(basisPoints) : null;
  } catch {
    return null;
  }
}

export const homeMortgageRateSchema = z.string()
  .trim()
  .regex(/^\d+(?:\.\d{1,2})?$/, "Enter an annual rate from 0% to 100% with at most two decimal places.")
  .refine((value) => mortgageRateToBasisPoints(value) !== null, "Annual mortgage rate is too large.")
  .transform((value) => mortgageRateToBasisPoints(value)!);

export const homeMortgageTermsInputSchema = z.object({
  id: z.string().uuid("Mortgage term ID is invalid.").optional().nullable(),
  effectiveOn: snapshotDateSchema,
  annualRate: homeMortgageRateSchema,
  compoundingConvention: homeMortgageCompoundingConventionSchema,
  paymentExpenseId: z.string().uuid("Payment expense ID is invalid."),
  nextPaymentOn: snapshotDateSchema,
  renewalOn: snapshotDateSchema,
  payoffOn: snapshotDateSchema,
}).superRefine((input, context) => {
  if (input.nextPaymentOn < input.effectiveOn) context.addIssue({ code: z.ZodIssueCode.custom, path: ["nextPaymentOn"], message: "Next payment date must be on or after the effective date." });
  if (input.renewalOn <= input.effectiveOn) context.addIssue({ code: z.ZodIssueCode.custom, path: ["renewalOn"], message: "Renewal date must be after the effective date." });
  if (input.payoffOn <= input.effectiveOn) context.addIssue({ code: z.ZodIssueCode.custom, path: ["payoffOn"], message: "Payoff date must be after the effective date." });
});

export const homeMortgageTermIdSchema = z.string().uuid("Mortgage term ID is invalid.");

export type HomeValueInput = z.infer<typeof homeValueInputSchema>;
export type HomeMortgageAnchorInput = z.infer<typeof homeMortgageAnchorInputSchema>;
export type HomeMortgageTermsInput = z.infer<typeof homeMortgageTermsInputSchema>;

export const goalNameSchema = z.string().trim().min(1, "Goal name is required.").max(120, "Goal name must be 120 characters or fewer.");
export const goalAmountSchema = z.string()
  .trim()
  .regex(/^\d+(?:\.\d{1,2})?$/, "Enter a non-negative CAD amount with at most two decimal places.")
  .refine((value) => cadAmountToMinorUnits(value) !== null, "CAD amount is too large.")
  .transform((value) => cadAmountToMinorUnits(value)!);
export const goalTargetAmountSchema = goalAmountSchema.refine((value) => value > 0, "Target amount must be greater than zero.");
export const goalTargetDateSchema = z.preprocess(
  (value) => value === "" || value === undefined || value === null ? null : value,
  z.string().date("Target date must be a valid ISO date.").nullable(),
);
export const goalPrioritySchema = z.preprocess(
  (value) => value === "" || value === undefined || value === null ? 0 : value,
  z.coerce.number().int("Priority must be a whole number.").min(0, "Priority cannot be negative.").max(32767, "Priority is too large."),
);
export const goalIdSchema = z.string().uuid("Goal ID is invalid.");
export const goalStatusSchema = z.enum(["active", "achieved", "archived"]);

export const goalCreateInputSchema = z.object({
  name: goalNameSchema,
  target: goalTargetAmountSchema,
  current: goalAmountSchema,
  targetDate: goalTargetDateSchema,
  priority: goalPrioritySchema,
});
export const goalUpdateInputSchema = goalCreateInputSchema.extend({ id: goalIdSchema });
export const goalProgressInputSchema = z.object({
  id: goalIdSchema,
  current: goalAmountSchema,
});
export const goalStatusInputSchema = z.object({
  id: goalIdSchema,
  status: goalStatusSchema,
});
export const goalDeleteInputSchema = z.object({
  id: goalIdSchema,
  confirm: z.literal(true, { errorMap: () => ({ message: "Confirm deletion before removing this goal." }) }),
});

export type GoalCreateInput = z.infer<typeof goalCreateInputSchema>;
export type GoalUpdateInput = z.infer<typeof goalUpdateInputSchema>;
export type GoalProgressInput = z.infer<typeof goalProgressInputSchema>;
export type GoalStatusInput = z.infer<typeof goalStatusInputSchema>;
export type GoalDeleteInput = z.infer<typeof goalDeleteInputSchema>;

export const goalPlanFrequencySchema = z.enum(["weekly", "biweekly", "monthly"]);

export const goalPlanIdSchema = z.string().uuid("Goal plan ID is invalid.");
export const goalPlanGoalIdSchema = z.string().uuid("Goal ID is invalid.");
export const goalPlanAccountIdSchema = z.string().uuid("Account ID is invalid.");

export const goalPlanAmountSchema = accountAmountSchema.refine((value) => value > 0, "Contribution amount must be greater than zero.");

export const goalPlanSourceAccountSchema = z.string().uuid("Source account ID is invalid.");

export const goalPlanCountsAsExpenseSchema = z.preprocess(
  (value) => (value === "true" || value === "on" || value === "1" || value === true ? true : value === "false" || value === "off" || value === "0" || value === false || value === "" || value === undefined || value === null ? false : value),
  z.boolean().default(false),
);

export const goalPlanStartsOnSchema = z.preprocess(
  (value) => (value === "" || value === undefined || value === null ? undefined : value),
  z.string().date("Start date must be a valid ISO date.").optional(),
);

export const goalPlanSaveInputSchema = z.object({
  goalId: goalPlanGoalIdSchema,
  accountId: goalPlanAccountIdSchema,
  sourceAccountId: goalPlanSourceAccountSchema,
  amount: goalPlanAmountSchema,
  frequency: goalPlanFrequencySchema,
  startsOn: goalPlanStartsOnSchema,
  countsAsExpense: goalPlanCountsAsExpenseSchema,
}).refine((input) => input.sourceAccountId !== input.accountId, {
  path: ["sourceAccountId"],
  message: "Source and destination accounts must be different.",
});

export const goalPlanEnabledInputSchema = z.object({
  goalId: goalPlanGoalIdSchema,
  enabled: z.preprocess(
    (value) => (value === "true" || value === "on" ? true : value === "false" || value === "off" ? false : value),
    z.boolean(),
  ),
});

export const goalAchievedInputSchema = z.object({
  id: goalIdSchema,
  stopContributions: z.preprocess(
    (value) => (value === "true" || value === "on" ? true : value === "false" || value === "off" || value === "" || value === undefined || value === null ? false : value),
    z.boolean().default(false),
  ),
});

export type GoalPlanSaveInput = z.infer<typeof goalPlanSaveInputSchema>;
export type GoalPlanEnabledInput = z.infer<typeof goalPlanEnabledInputSchema>;
export type GoalAchievedInput = z.infer<typeof goalAchievedInputSchema>;
