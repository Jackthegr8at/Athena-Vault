import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { Database } from "../client";
import {
  accounts,
  accountBalanceNotes,
  auditEvents,
  balanceSnapshots,
  cashFlowPaydayChecks,
  cashFlowPeriods,
  institutions,
  recurringCashFlowOccurrenceExceptions,
  recurringCashFlowOverrideGroups,
  recurringCashFlowSeries,
  recurringTransactions,
  sourceReferences,
  transactions,
  transfers,
} from "../drizzle-schema";
import {
  addIsoDays,
  isIsoDate,
} from "../account-contributions";
import {
  addRecurringCashFlowDays,
  assertRecurringCashFlowOccurrence,
  expandRecurringCashFlowOccurrences,
  isRecurringCashFlowOccurrence,
  isRecurringCashFlowIsoDate,
  nextRecurringCashFlowOccurrence,
  nextRecurringCashFlowOccurrenceAfter,
  partitionRecurringCashFlowVersions,
  selectRecurringCashFlowVersion,
  type RecurringCashFlowFrequency,
  type RecurringCashFlowKind,
  type RecurringCashFlowOccurrence,
  type RecurringCashFlowVersionSchedule,
  type RecurringOccurrenceException,
  type RecurringWeekdayAdjustment,
} from "../recurring-cash-flow";
import {
  toTorontoDateIso,
} from "../account-timeline";

import type { AccountBalanceNoteView, AccountBalanceNoteMutationInput } from "./account-timeline";

import type { HomeHouseholdFrequency, HomeHouseholdCashFlowLinkView } from "./household";

import type { TimelineExtensionResult, TransactionDatabase } from "./shared";

import { accountNamesFor, recurringVersionSchedule, recurringExceptionSchedule, accountBalanceNoteView, paydayCheckView, upsertAccountBalanceNote, cashFlowEndingBalancesByAccountAndPayDate, refreshCashFlowLinkedAccountProjections, recalculateAccountProjection } from "./shared";

export interface CashFlowInitialTimelineInput {
  readonly firstPayday: string;
  readonly throughDate: string;
}


export interface InitialCashFlowIncomeInput {
  readonly accountId: string;
  readonly name: string;
  readonly amountMinor: number;
  readonly frequency: RecurringCashFlowFrequency;
  readonly startsOn: string;
  readonly throughDate: string;
  readonly note?: string | null;
}


export interface InitialCashFlowIncomeResult {
  readonly accountId: string;
  readonly seriesId: string;
  readonly periodsCreated: number;
  readonly generatedCount: number;
}


export const MAX_INITIAL_CASH_FLOW_PERIODS = 260;


export interface CashFlowPeriodView {
  readonly id: string;
  readonly label: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly payDate: string;
  readonly openingBalanceMinor: number;
  readonly currency: (typeof cashFlowPeriods.$inferSelect)["currency"];
  readonly status: (typeof cashFlowPeriods.$inferSelect)["status"];
}


export interface CashFlowTransactionView {
  readonly id: string;
  readonly accountId: string | null;
  readonly recurringTransactionId: string | null;
  readonly recurringSeriesId: string | null;
  readonly recurringOccurrenceId: string | null;
  readonly recurringExceptionId: string | null;
  readonly scheduledOccurrenceOn: string | null;
  readonly isGenerated: boolean;
  readonly transactionDate: string;
  readonly kind: (typeof transactions.$inferSelect)["kind"];
  readonly status: (typeof transactions.$inferSelect)["status"];
  readonly description: string;
  readonly category: string | null;
  readonly amountMinor: number;
  readonly accountName: string;
}


export interface CashFlowExcludedExpenseView {
  readonly id: string;
  readonly accountId: string | null;
  readonly recurringTransactionId: string | null;
  readonly transactionDate: string;
  readonly status: (typeof transactions.$inferSelect)["status"];
  readonly description: string;
  readonly category: string | null;
  readonly amountMinor: number;
  readonly accountName: string;
}


export interface CashFlowTransferView {
  readonly id: string;
  readonly recurringTransactionId: string | null;
  readonly recurringSeriesId: string | null;
  readonly recurringOccurrenceId: string | null;
  readonly scheduledOccurrenceOn: string | null;
  readonly isGenerated: boolean;
  readonly transferDate: string;
  readonly status: (typeof transfers.$inferSelect)["status"];
  readonly description: string;
  readonly amountMinor: number;
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly fromAccountName: string;
  readonly toAccountName: string;
  /** When true, from-account outflow counts as spending (series flag via recurring version). */
  readonly countsAsExpense: boolean;
}


export interface CashFlowPeriodData {
  readonly period: CashFlowPeriodView;
  readonly transactions: readonly CashFlowTransactionView[];
  readonly transfers: readonly CashFlowTransferView[];
}


export interface CashFlowRecurringTransactionView {
  readonly id: string;
  readonly kind: RecurringCashFlowKind;
  readonly accountId: string | null;
  readonly fromAccountId?: string | null;
  readonly toAccountId?: string | null;
  readonly description: string;
  readonly frequency: (typeof recurringTransactions.$inferSelect)["frequency"];
  readonly weekdayAdjustment?: RecurringWeekdayAdjustment;
}


export interface CashFlowAccountView {
  readonly id: string;
  readonly name: string;
  readonly institution: string;
  readonly kind: (typeof accounts.$inferSelect)["kind"];
  readonly currency: (typeof accounts.$inferSelect)["currency"];
  readonly isActive: boolean;
  readonly includeInAvailableCash: boolean;
  readonly isVisibleInCashFlow: boolean;
}


export interface CashFlowAnchorView {
  readonly id: string;
  readonly accountId: string;
  readonly asOf: string;
  readonly balanceMinor: number;
  readonly status: (typeof balanceSnapshots.$inferSelect)["status"];
  readonly isGenerated: boolean;
  readonly currency: (typeof balanceSnapshots.$inferSelect)["currency"];
}


export interface CashFlowPeriodWindowOptions {
  readonly asOfIso?: string;
  readonly selectedPeriodId?: string | null;
  readonly pastPeriods?: number;
  readonly futurePeriods?: number;
  readonly includeAll?: boolean;
}


export interface CashFlowObservedBalanceInput {
  readonly accountId: string;
  readonly asOf: string;
  readonly balanceMinor: number;
  readonly note?: string | null;
}


export interface CashFlowPaydayCheckView {
  readonly id: string;
  readonly accountId: string;
  readonly payDate: string;
  readonly projectedBalanceMinor: number;
  readonly actualBalanceMinor: number;
  readonly varianceMinor: number;
  readonly note?: string | null;
}


export interface CashFlowPeriodWindow {
  readonly periods: readonly CashFlowPeriodData[];
  readonly accounts: readonly CashFlowAccountView[];
  readonly anchors: readonly CashFlowAnchorView[];
  readonly paydayChecks: readonly CashFlowPaydayCheckView[];
  readonly paydayNotes: readonly AccountBalanceNoteView[];
  readonly projectionTransactions: readonly CashFlowTransactionView[];
  readonly projectionTransfers: readonly CashFlowTransferView[];
  readonly selectedPeriodId: string | null;
  readonly currentPeriodId: string | null;
  readonly currentPeriodPayDate: string | null;
  readonly totalPeriodCount: number;
}


export interface CashFlowTransactionUpdateInput {
  readonly accountId: string | null;
  readonly recurringTransactionId: string | null;
  readonly transactionDate: string;
  readonly description: string;
  readonly category: string | null;
  readonly amountMinor: number;
  readonly status: "planned" | "actual";
  readonly scope: "current" | "this_and_future";
}


export interface CashFlowTransactionCreateInput {
  readonly periodId: string;
  readonly accountId: string;
  readonly kind: "income" | "expense";
  readonly transactionDate: string;
  readonly description: string;
  readonly amountMinor: number;
}


export interface RecurringCashFlowSeriesInput {
  readonly name: string;
  readonly kind: RecurringCashFlowKind;
  readonly accountId: string | null;
  readonly fromAccountId?: string | null;
  readonly toAccountId?: string | null;
  readonly amountMinor: number;
  readonly frequency: RecurringCashFlowFrequency;
  readonly weekdayAdjustment?: RecurringWeekdayAdjustment;
  readonly startsOn: string;
  readonly nextOccurrenceOn: string;
  readonly endsOn: string | null;
  readonly note?: string | null;
  /** Transfer-only: treat from-account outflows as spending in Cash Flow totals/grouping. */
  readonly countsAsExpense?: boolean;
  /** When set, links this series to the Home monthly/bi-weekly household total card. */
  readonly homeHouseholdFrequency?: HomeHouseholdFrequency | null;
}


export type RecurringCashFlowWholeEditInput = Omit<RecurringCashFlowSeriesInput, "nextOccurrenceOn">;


export interface RecurringCashFlowVersionEditInput extends RecurringCashFlowWholeEditInput {}


export interface RecurringCashFlowVersionInput extends RecurringCashFlowSeriesInput {
  readonly previousEndsOn: string;
  readonly effectiveFrom: string;
  readonly versionNote?: string | null;
}


export interface RecurringCashFlowSeriesVersionView extends RecurringCashFlowVersionSchedule {
  readonly versionNote: string | null;
  readonly nextOccurrenceOn: string;
  readonly status: (typeof recurringTransactions.$inferSelect)["status"];
  readonly isCurrent: boolean;
}


export interface RecurringCashFlowExceptionView extends RecurringOccurrenceException {
  readonly transactionId: string | null;
  readonly transferId: string | null;
}


export interface RecurringCashFlowSeriesView {
  readonly id: string;
  readonly kind: RecurringCashFlowKind;
  readonly state: (typeof recurringCashFlowSeries.$inferSelect)["state"];
  readonly endedOn: string | null;
  readonly homeHouseholdFrequency: HomeHouseholdFrequency | null;
  readonly firstOccurrenceOn: string;
  readonly nextOccurrenceOn: string | null;
  readonly activeVersionId: string | null;
  readonly versions: readonly RecurringCashFlowSeriesVersionView[];
  readonly exceptions: readonly RecurringCashFlowExceptionView[];
}


export interface RecurringCashFlowGenerationInput {
  readonly throughDate: string;
  readonly fromDate?: string;
}


export interface RecurringCashFlowGenerationResult {
  readonly seriesId: string;
  readonly throughDate: string;
  readonly insertedCount: number;
  readonly updatedCount: number;
  readonly deletedCount: number;
  readonly skippedCount: number;
  readonly preservedCount: number;
  readonly affectedTransactionIds: readonly string[];
  readonly affectedTransferIds: readonly string[];
}


export interface RecurringCashFlowDeletionResult {
  readonly seriesId: string;
  readonly transactionCount: number;
  readonly transferCount: number;
  readonly sourceReferenceCount: number;
}


export interface RecurringCashFlowVersionDeletionResult {
  readonly seriesId: string;
  readonly versionId: string;
  readonly transactionCount: number;
  readonly transferCount: number;
  readonly sourceReferenceCount: number;
}


interface RemovedPlannedRecurringRecords {
  readonly transactionIds: readonly string[];
  readonly transferIds: readonly string[];
  readonly sourceReferenceCount: number;
}


async function removePlannedRecurringRecords(
  tx: RecurringDatabase,
  ownerId: string,
  transactionIds: readonly string[],
  transferIds: readonly string[],
): Promise<RemovedPlannedRecurringRecords> {
  const removableTransactions = transactionIds.length === 0 ? [] : await tx.select({ id: transactions.id }).from(transactions).where(and(
    eq(transactions.ownerId, ownerId),
    inArray(transactions.id, [...transactionIds]),
    eq(transactions.status, "planned"),
    eq(transactions.isGenerated, false),
  ));
  const removableTransfers = transferIds.length === 0 ? [] : await tx.select({ id: transfers.id }).from(transfers).where(and(
    eq(transfers.ownerId, ownerId),
    inArray(transfers.id, [...transferIds]),
    eq(transfers.status, "planned"),
    eq(transfers.isGenerated, false),
  ));
  const removedTransactionIds = removableTransactions.map((row) => row.id);
  const removedTransferIds = removableTransfers.map((row) => row.id);
  let sourceReferenceCount = 0;
  if (removedTransactionIds.length > 0) {
    const removedReferences = await tx.delete(sourceReferences).where(and(eq(sourceReferences.ownerId, ownerId), eq(sourceReferences.recordType, "transaction"), inArray(sourceReferences.recordId, removedTransactionIds))).returning({ id: sourceReferences.id });
    sourceReferenceCount += removedReferences.length;
    const deletedTransactions = await tx.delete(transactions).where(and(eq(transactions.ownerId, ownerId), inArray(transactions.id, removedTransactionIds))).returning({ id: transactions.id });
    if (deletedTransactions.length !== removedTransactionIds.length) throw new Error("Recurring Cash Flow transactions could not be deleted.");
  }
  if (removedTransferIds.length > 0) {
    const removedReferences = await tx.delete(sourceReferences).where(and(eq(sourceReferences.ownerId, ownerId), eq(sourceReferences.recordType, "transfer"), inArray(sourceReferences.recordId, removedTransferIds))).returning({ id: sourceReferences.id });
    sourceReferenceCount += removedReferences.length;
    const deletedTransfers = await tx.delete(transfers).where(and(eq(transfers.ownerId, ownerId), inArray(transfers.id, removedTransferIds))).returning({ id: transfers.id });
    if (deletedTransfers.length !== removedTransferIds.length) throw new Error("Recurring Cash Flow transfers could not be deleted.");
  }
  return { transactionIds: removedTransactionIds, transferIds: removedTransferIds, sourceReferenceCount };
}


async function currentOpenCashFlowPaydayStart(
  db: RecurringDatabase,
  ownerId: string,
  todayIso: string,
): Promise<string> {
  const [period] = await db.select({ payDate: cashFlowPeriods.payDate })
    .from(cashFlowPeriods)
    .where(and(eq(cashFlowPeriods.ownerId, ownerId), lte(cashFlowPeriods.payDate, todayIso)))
    .orderBy(desc(cashFlowPeriods.payDate), desc(cashFlowPeriods.id))
    .limit(1);
  return period?.payDate ?? todayIso;
}


interface CurrentOpenCashFlowPaydayWindow {
  readonly startsOn: string;
  readonly endsOn: string;
}


async function currentOpenCashFlowPaydayWindow(
  db: RecurringDatabase,
  ownerId: string,
  todayIso: string,
): Promise<CurrentOpenCashFlowPaydayWindow> {
  const [period] = await db.select({ payDate: cashFlowPeriods.payDate })
    .from(cashFlowPeriods)
    .where(and(eq(cashFlowPeriods.ownerId, ownerId), lte(cashFlowPeriods.payDate, todayIso)))
    .orderBy(desc(cashFlowPeriods.payDate), desc(cashFlowPeriods.id))
    .limit(1);
  const startsOn = period?.payDate ?? todayIso;
  const [nextPeriod] = period
    ? await db.select({ payDate: cashFlowPeriods.payDate })
      .from(cashFlowPeriods)
      .where(and(eq(cashFlowPeriods.ownerId, ownerId), gt(cashFlowPeriods.payDate, startsOn)))
      .orderBy(asc(cashFlowPeriods.payDate), asc(cashFlowPeriods.id))
      .limit(1)
    : [];
  return {
    startsOn,
    endsOn: nextPeriod ? addRecurringCashFlowDays(nextPeriod.payDate, -1) : addRecurringCashFlowDays(startsOn, 13),
  };
}


export interface RecurringCashFlowExceptionResult {
  readonly seriesId: string;
  readonly exceptionIds: readonly string[];
  readonly overrideGroupId: string | null;
  readonly generation: RecurringCashFlowGenerationResult;
}


export interface RecurringCashFlowOccurrenceExceptionInput {
  readonly seriesId: string;
  readonly versionId: string;
  readonly transactionId?: string | null;
  readonly transferId?: string | null;
  readonly scheduledOccurrenceOn: string;
  readonly endingOccurrenceOn?: string | null;
  readonly scope: "only_this_occurrence" | "selected_range";
  readonly kind: "override" | "skip";
  readonly dateOverride?: string | null;
  readonly amountOverrideMinor?: number | null;
  readonly accountOverrideId?: string | null;
  readonly fromAccountOverrideId?: string | null;
  readonly toAccountOverrideId?: string | null;
  readonly statusOverride?: "planned" | null;
  readonly note?: string | null;
}


export interface RecurringCashFlowOverrideGroupUpdateInput {
  readonly kind: "override" | "skip";
  readonly dateOverride?: string | null;
  readonly amountOverrideMinor?: number | null;
  readonly accountOverrideId?: string | null;
  readonly fromAccountOverrideId?: string | null;
  readonly toAccountOverrideId?: string | null;
  readonly statusOverride?: "planned" | null;
  readonly note?: string | null;
}


export interface RecurringCashFlowRestoreInput {
  readonly seriesId: string;
  readonly occurrenceId?: string | null;
  readonly overrideGroupId?: string | null;
  readonly scope: "occurrence" | "group";
}


export interface CashFlowTransferUpdateInput {
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly transferDate: string;
  readonly description: string;
  readonly amountMinor: number;
  readonly status: "planned" | "actual";
}


function choosePeriod(periods: readonly CashFlowPeriodView[], asOfIso: string): CashFlowPeriodView | undefined {
  return [...periods]
    .filter((period) => period.payDate <= asOfIso)
    .sort((left, right) => left.payDate.localeCompare(right.payDate) || left.id.localeCompare(right.id))
    .at(-1)
    ?? [...periods].sort((left, right) => left.payDate.localeCompare(right.payDate) || left.id.localeCompare(right.id))[0];
}


export function buildInitialCashFlowPeriods(
  ownerId: string,
  input: CashFlowInitialTimelineInput,
  currency: (typeof cashFlowPeriods.$inferInsert)["currency"] = "CAD",
): Array<{
  readonly ownerId: string;
  readonly label: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly payDate: string;
  readonly openingBalanceMinor: number;
  readonly currency: (typeof cashFlowPeriods.$inferInsert)["currency"];
  readonly status: "planned";
}> {
  if (!isIsoDate(input.firstPayday)) throw new RangeError("First payday must be a valid ISO date.");
  if (!isIsoDate(input.throughDate)) throw new RangeError("Timeline end date must be a valid ISO date.");
  if (input.firstPayday > input.throughDate) throw new RangeError("Timeline end date must be on or after the first payday.");

  const periods: Array<{
    readonly ownerId: string;
    readonly label: string;
    readonly startsOn: string;
    readonly endsOn: string;
    readonly payDate: string;
    readonly openingBalanceMinor: number;
    readonly currency: (typeof cashFlowPeriods.$inferInsert)["currency"];
    readonly status: "planned";
  }> = [];
  let previousEnd = addIsoDays(input.firstPayday, -14);
  while (true) {
    const endsOn = addIsoDays(previousEnd, 14);
    if (endsOn > input.throughDate) break;
    if (periods.length >= MAX_INITIAL_CASH_FLOW_PERIODS) {
      throw new RangeError(`Cash Flow setup cannot create more than ${MAX_INITIAL_CASH_FLOW_PERIODS} pay periods.`);
    }
    periods.push({
      ownerId,
      label: `Pay period ${endsOn}`,
      startsOn: addIsoDays(previousEnd, 1),
      endsOn,
      payDate: endsOn,
      openingBalanceMinor: 0,
      currency,
      status: "planned",
    });
    previousEnd = endsOn;
  }
  return periods;
}


type RecurringDatabase = Database | TransactionDatabase;


export function assertRecurringMinorUnits(value: number, fieldName: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${fieldName} must be a positive integer minor-unit value.`);
}


export function assertRecurringDate(value: string, fieldName: string): void {
  if (!isRecurringCashFlowIsoDate(value)) throw new Error(`${fieldName} must be a valid ISO date.`);
}


function assertRecurringSeriesName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 240) throw new Error("Recurring series name is invalid.");
  return trimmed;
}


export function normalizeCountsAsExpense(input: Pick<RecurringCashFlowSeriesInput, "kind" | "countsAsExpense">): boolean {
  if (input.kind !== "transfer") return false;
  return input.countsAsExpense === true;
}


function assertRecurringSeriesInput(input: RecurringCashFlowSeriesInput, effectiveFrom?: string): void {
  assertRecurringSeriesName(input.name);
  if (input.kind !== "income" && input.kind !== "expense" && input.kind !== "transfer") throw new Error("Recurring series kind is invalid.");
  assertRecurringMinorUnits(input.amountMinor, "Recurring amount");
  if (!["weekly", "biweekly", "monthly", "quarterly", "annual"].includes(input.frequency)) throw new Error("Recurring frequency is invalid.");
  const weekdayAdjustment = input.weekdayAdjustment ?? "none";
  if (!["none", "next_weekday", "previous_weekday"].includes(weekdayAdjustment)) throw new Error("Recurring weekday adjustment is invalid.");
  assertRecurringDate(input.startsOn, "Recurring start date");
  assertRecurringDate(input.nextOccurrenceOn, "Next occurrence date");
  if (input.endsOn) assertRecurringDate(input.endsOn, "Recurring end date");
  if (input.endsOn && input.endsOn < input.startsOn) throw new Error("Recurring end date must be on or after the start date.");
  if (input.countsAsExpense === true && input.kind !== "transfer") throw new Error("Only recurring transfers can count as expense.");
  if (input.kind === "transfer") {
    if (input.accountId !== null || !input.fromAccountId || !input.toAccountId || input.fromAccountId === input.toAccountId) throw new Error("Recurring transfers require two different source and destination accounts.");
  } else if ((input.fromAccountId ?? null) !== null || (input.toAccountId ?? null) !== null) {
    throw new Error("Income and expense recurring series cannot include transfer endpoints.");
  }
  const schedule = { frequency: input.frequency, startsOn: input.startsOn, endsOn: input.endsOn, weekdayAdjustment };
  assertRecurringCashFlowOccurrence(schedule, input.nextOccurrenceOn, "Next occurrence date");
  if (input.endsOn && input.nextOccurrenceOn > input.endsOn) throw new Error("Next occurrence date is outside the recurring schedule.");
  if (effectiveFrom) {
    assertRecurringDate(effectiveFrom, "Effective occurrence date");
    assertRecurringCashFlowOccurrence(schedule, effectiveFrom, "Effective occurrence date");
    if (input.endsOn && effectiveFrom > input.endsOn) throw new Error("Effective occurrence must be on or before the schedule end.");
    if (input.nextOccurrenceOn < effectiveFrom) throw new Error("Next occurrence must be on or after the effective occurrence.");
  }
}


function assertRecurringWholeEditInput(input: RecurringCashFlowWholeEditInput): void {
  assertRecurringSeriesName(input.name);
  if (input.kind !== "income" && input.kind !== "expense" && input.kind !== "transfer") throw new Error("Recurring series kind is invalid.");
  assertRecurringMinorUnits(input.amountMinor, "Recurring amount");
  if (!["weekly", "biweekly", "monthly", "quarterly", "annual"].includes(input.frequency)) throw new Error("Recurring frequency is invalid.");
  const weekdayAdjustment = input.weekdayAdjustment ?? "none";
  if (!["none", "next_weekday", "previous_weekday"].includes(weekdayAdjustment)) throw new Error("Recurring weekday adjustment is invalid.");
  assertRecurringDate(input.startsOn, "Recurring start date");
  if (input.endsOn) assertRecurringDate(input.endsOn, "Recurring end date");
  if (input.endsOn && input.endsOn < input.startsOn) throw new Error("Recurring end date must be on or after the start date.");
  if (input.countsAsExpense === true && input.kind !== "transfer") throw new Error("Only recurring transfers can count as expense.");
  if (input.kind === "transfer") {
    if (input.accountId !== null || !input.fromAccountId || !input.toAccountId || input.fromAccountId === input.toAccountId) throw new Error("Recurring transfers require two different source and destination accounts.");
  } else if ((input.fromAccountId ?? null) !== null || (input.toAccountId ?? null) !== null) {
    throw new Error("Income and expense recurring series cannot include transfer endpoints.");
  }
  const schedule = { frequency: input.frequency, startsOn: input.startsOn, endsOn: input.endsOn, weekdayAdjustment };
  if (input.endsOn && !isRecurringCashFlowOccurrence(schedule, input.endsOn)) throw new Error("Recurring end date must match the recurring schedule.");
}


interface RecurringContext {
  readonly series: typeof recurringCashFlowSeries.$inferSelect;
  readonly versions: readonly (typeof recurringTransactions.$inferSelect)[];
  readonly exceptions: readonly (typeof recurringCashFlowOccurrenceExceptions.$inferSelect)[];
}


async function loadRecurringContext(
  db: RecurringDatabase,
  ownerId: string,
  seriesId: string,
): Promise<RecurringContext> {
  const [series] = await db.select().from(recurringCashFlowSeries)
    .where(and(eq(recurringCashFlowSeries.ownerId, ownerId), eq(recurringCashFlowSeries.id, seriesId)))
    .limit(1);
  if (!series) throw new Error("Recurring Cash Flow series not found.");
  const [versions, exceptions] = await Promise.all([
    db.select().from(recurringTransactions)
      .where(and(eq(recurringTransactions.ownerId, ownerId), eq(recurringTransactions.seriesId, seriesId)))
      .orderBy(asc(recurringTransactions.effectiveFrom), asc(recurringTransactions.id)),
    db.select().from(recurringCashFlowOccurrenceExceptions)
      .where(and(eq(recurringCashFlowOccurrenceExceptions.ownerId, ownerId), eq(recurringCashFlowOccurrenceExceptions.seriesId, seriesId)))
      .orderBy(asc(recurringCashFlowOccurrenceExceptions.scheduledOccurrenceOn), asc(recurringCashFlowOccurrenceExceptions.id)),
  ]);
  if (versions.length === 0) throw new Error("Recurring Cash Flow series has no version.");
  return { series, versions, exceptions };
}


async function loadRecurringContexts(
  db: RecurringDatabase,
  ownerId: string,
  seriesRows: readonly (typeof recurringCashFlowSeries.$inferSelect)[],
): Promise<ReadonlyMap<string, RecurringContext>> {
  const contexts = new Map<string, { series: typeof recurringCashFlowSeries.$inferSelect; versions: (typeof recurringTransactions.$inferSelect)[]; exceptions: (typeof recurringCashFlowOccurrenceExceptions.$inferSelect)[] }>(
    seriesRows.map((series) => [series.id, { series, versions: [], exceptions: [] }]),
  );
  const seriesIds = seriesRows.map((series) => series.id);
  if (seriesIds.length === 0) return contexts;
  const [versionRows, exceptionRows] = await Promise.all([
    db.select().from(recurringTransactions)
      .where(and(eq(recurringTransactions.ownerId, ownerId), inArray(recurringTransactions.seriesId, seriesIds)))
      .orderBy(asc(recurringTransactions.effectiveFrom), asc(recurringTransactions.id)),
    db.select().from(recurringCashFlowOccurrenceExceptions)
      .where(and(eq(recurringCashFlowOccurrenceExceptions.ownerId, ownerId), inArray(recurringCashFlowOccurrenceExceptions.seriesId, seriesIds)))
      .orderBy(asc(recurringCashFlowOccurrenceExceptions.scheduledOccurrenceOn), asc(recurringCashFlowOccurrenceExceptions.id)),
  ]);
  for (const version of versionRows) contexts.get(version.seriesId)?.versions.push(version);
  for (const exception of exceptionRows) contexts.get(exception.seriesId)?.exceptions.push(exception);
  for (const context of contexts.values()) {
    if (context.versions.length === 0) throw new Error("Recurring Cash Flow series has no version.");
  }
  return contexts;
}


async function assertRecurringAccount(db: RecurringDatabase, ownerId: string, accountId: string | null): Promise<void> {
  if (!accountId) return;
  const [account] = await db.select({ id: accounts.id }).from(accounts)
    .where(and(eq(accounts.ownerId, ownerId), eq(accounts.id, accountId), eq(accounts.isActive, true)))
    .limit(1);
  if (!account) throw new Error("Recurring Cash Flow account is not active for this owner.");
}


function recurringSeriesView(
  context: Awaited<ReturnType<typeof loadRecurringContext>>,
  asOfIso: string,
): RecurringCashFlowSeriesView {
  const schedules = context.versions.map(recurringVersionSchedule);
  const current = selectRecurringCashFlowVersion(schedules, context.series.endedOn ?? asOfIso);
  const upcomingRow = context.series.state === "ended" || current
    ? null
    : context.versions
      .filter((version) => version.effectiveFrom > asOfIso)
      .sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom) || left.id.localeCompare(right.id))[0] ?? null;
  const upcoming = upcomingRow ? recurringVersionSchedule(upcomingRow) : null;
  const nextVersion = current ?? upcoming;
  const nextOccurrenceOn = context.series.state === "ended"
    ? null
    : current
      ? nextRecurringCashFlowOccurrenceAfter(current, asOfIso)
      : upcomingRow?.nextOccurrenceOn ?? null;
  const firstOccurrenceOn = schedules.map((version) => version.startsOn).sort()[0]!;
  const homeHouseholdFrequency = context.series.homeHouseholdFrequency === "biweekly" || context.series.homeHouseholdFrequency === "monthly"
    ? context.series.homeHouseholdFrequency
    : null;
  return {
    id: context.series.id,
    kind: context.series.kind,
    state: context.series.state,
    endedOn: context.series.endedOn,
    homeHouseholdFrequency,
    firstOccurrenceOn,
    nextOccurrenceOn,
    activeVersionId: current?.id ?? null,
    versions: context.versions.map((version) => ({
      ...recurringVersionSchedule(version),
      versionNote: version.versionNote,
      nextOccurrenceOn: version.id === nextVersion?.id && nextOccurrenceOn ? nextOccurrenceOn : version.nextOccurrenceOn,
      status: version.status,
      isCurrent: version.id === current?.id,
    })),
    exceptions: context.exceptions.map((exception) => ({ ...recurringExceptionSchedule(exception), transactionId: exception.transactionId })),
  };
}


function emptyRecurringGenerationResult(seriesId: string, throughDate: string): RecurringCashFlowGenerationResult {
  return { seriesId, throughDate, insertedCount: 0, updatedCount: 0, deletedCount: 0, skippedCount: 0, preservedCount: 0, affectedTransactionIds: [], affectedTransferIds: [] };
}
/** Upper bound on rows batched into one multi-row UPDATE (VALUES/CASE or inArray). */
const SET_UPDATE_CHUNK_SIZE = 500;


/**
 * Lower bound for the `listProjectionData` date predicates used by `getPeriodWindow`.
 *
 * Consumers of `projectionTransactions`/`projectionTransfers` (the Cash Flow page and the
 * dashboard read-model) feed these rows into `projectChainedCashFlow`, where a row dated before
 * the window start can only influence a projected balance when it lands on or after the baseline
 * anchor of its account: `projectAccountPeriod` skips events dated strictly before the seeding
 * anchor's `asOf` (except same-day events on the anchor date, hence the inclusive bound).
 *
 * Per active account the bound is therefore the latest anchor `asOf` on or before `windowStart`
 * (anchors include balance snapshots and payday checks; anything earlier is dead input). Accounts
 * with no such anchor need no history before `windowStart` because their running balance is null
 * until the first anchor inside the window, so their contribution is `windowStart`. The result is
 * the minimum across accounts, or `null` when nothing can bound the range (no accounts, or no
 * anchor on or before `windowStart` at all): in that case the caller stays unbounded.
 */
export function cashFlowProjectionDataLowerBound(
  accountIds: readonly string[],
  anchors: readonly { readonly accountId: string; readonly asOf: string }[],
  windowStart: string,
): string | null {
  let bound: string | null = null;
  for (const accountId of accountIds) {
    let cutoff: string | null = null;
    for (const anchor of anchors) {
      if (anchor.accountId === accountId && anchor.asOf <= windowStart && (cutoff === null || anchor.asOf > cutoff)) cutoff = anchor.asOf;
    }
    const accountBound = cutoff ?? windowStart;
    if (bound === null || accountBound < bound) bound = accountBound;
  }
  return bound;
}


export interface RecurringExceptionTarget {
  readonly exceptionId: string;
  readonly scheduledOccurrenceOn: string;
  readonly exceptionKind: "override" | "skip";
  readonly occurrenceKind: RecurringCashFlowKind;
}


/**
 * Resolves the transaction/transfer target for each occurrence exception after the generated
 * rows have been synced. Mirrors the previous per-exception SELECT: skipped occurrences and
 * non-transfer occurrences keep a `null` transfer target, transfer-kind occurrences keep a
 * `null` transaction target, and a missing generated row resolves to `null` (same behaviour as
 * the old `.limit(1)` select returning no row).
 */
export function recurringExceptionTargetUpdates(
  targets: readonly RecurringExceptionTarget[],
  transactionIdByDate: ReadonlyMap<string, string>,
  transferIdByDate: ReadonlyMap<string, string>,
): readonly { readonly exceptionId: string; readonly transactionId: string | null; readonly transferId: string | null }[] {
  return targets.map((target) => ({
    exceptionId: target.exceptionId,
    transactionId: target.exceptionKind === "skip" || target.occurrenceKind === "transfer"
      ? null
      : transactionIdByDate.get(target.scheduledOccurrenceOn) ?? null,
    transferId: target.exceptionKind === "skip" || target.occurrenceKind !== "transfer"
      ? null
      : transferIdByDate.get(target.scheduledOccurrenceOn) ?? null,
  }));
}

/** Builds the `CASE`-based column expression for the set-based exception target update. */
function recurringExceptionTargetCase(
  updates: readonly { readonly exceptionId: string; readonly transactionId: string | null; readonly transferId: string | null }[],
  pick: "transactionId" | "transferId",
): SQL {
  // Each branch carries a leading space so `then $n::uuid` cannot fuse with a following `when`.
  const branches: SQL[] = updates.map((update) => sql` when ${recurringCashFlowOccurrenceExceptions.id} = ${update.exceptionId}::uuid then ${update[pick]}::uuid`);
  return sql.join([sql`case`, ...branches, sql` else null end`], sql``);
}


/**
 * Applies transaction/transfer targets to freshly synced occurrence exceptions with one
 * `inArray` prefetch per table and chunked set-based UPDATEs, replacing the previous
 * per-exception SELECT/UPDATE pairs.
 */
async function applyRecurringExceptionTargets(
  db: TransactionDatabase,
  ownerId: string,
  seriesId: string,
  targets: readonly RecurringExceptionTarget[],
): Promise<void> {
  if (targets.length === 0) return;
  const transactionDates = [...new Set(targets.flatMap((target) => target.occurrenceKind === "transfer" ? [] : [target.scheduledOccurrenceOn]))];
  const transferDates = [...new Set(targets.flatMap((target) => target.occurrenceKind === "transfer" ? [target.scheduledOccurrenceOn] : []))];
  const [transactionRows, transferRows] = await Promise.all([
    transactionDates.length === 0
      ? Promise.resolve<readonly { readonly id: string; readonly scheduledOccurrenceOn: string | null }[]>([])
      : db.select({ id: transactions.id, scheduledOccurrenceOn: transactions.scheduledOccurrenceOn }).from(transactions).where(and(
        eq(transactions.ownerId, ownerId),
        eq(transactions.recurringSeriesId, seriesId),
        inArray(transactions.scheduledOccurrenceOn, transactionDates),
        eq(transactions.isGenerated, true),
        eq(transactions.status, "planned"),
        eq(transactions.isExcluded, false),
      )),
    transferDates.length === 0
      ? Promise.resolve<readonly { readonly id: string; readonly scheduledOccurrenceOn: string | null }[]>([])
      : db.select({ id: transfers.id, scheduledOccurrenceOn: transfers.scheduledOccurrenceOn }).from(transfers).where(and(
        eq(transfers.ownerId, ownerId),
        eq(transfers.recurringSeriesId, seriesId),
        inArray(transfers.scheduledOccurrenceOn, transferDates),
        eq(transfers.isGenerated, true),
        eq(transfers.status, "planned"),
      )),
  ]);
  const transactionIdByDate = new Map<string, string>();
  for (const row of transactionRows) {
    if (row.scheduledOccurrenceOn && !transactionIdByDate.has(row.scheduledOccurrenceOn)) transactionIdByDate.set(row.scheduledOccurrenceOn, row.id);
  }
  const transferIdByDate = new Map<string, string>();
  for (const row of transferRows) {
    if (row.scheduledOccurrenceOn && !transferIdByDate.has(row.scheduledOccurrenceOn)) transferIdByDate.set(row.scheduledOccurrenceOn, row.id);
  }
  const updates = recurringExceptionTargetUpdates(targets, transactionIdByDate, transferIdByDate);
  for (let index = 0; index < updates.length; index += SET_UPDATE_CHUNK_SIZE) {
    const chunk = updates.slice(index, index + SET_UPDATE_CHUNK_SIZE);
    const applied = await db.update(recurringCashFlowOccurrenceExceptions).set({
      transactionId: recurringExceptionTargetCase(chunk, "transactionId"),
      transferId: recurringExceptionTargetCase(chunk, "transferId"),
      updatedAt: new Date(),
    }).where(and(
      eq(recurringCashFlowOccurrenceExceptions.ownerId, ownerId),
      inArray(recurringCashFlowOccurrenceExceptions.id, chunk.map((update) => update.exceptionId)),
    )).returning({ id: recurringCashFlowOccurrenceExceptions.id });
    if (applied.length !== chunk.length) throw new Error("Recurring occurrence exception target update returned an unexpected row count.");
  }
}


export async function assertRecurringEndpoints(
  db: RecurringDatabase,
  ownerId: string,
  input: Pick<RecurringCashFlowSeriesInput, "kind" | "accountId" | "fromAccountId" | "toAccountId">,
): Promise<void> {
  if (input.kind !== "transfer") {
    await assertRecurringAccount(db, ownerId, input.accountId);
    return;
  }
  const fromAccountId = input.fromAccountId ?? null;
  const toAccountId = input.toAccountId ?? null;
  if (input.accountId !== null || fromAccountId === null || toAccountId === null || fromAccountId === toAccountId) {
    throw new Error("Recurring transfers require two different source and destination accounts.");
  }
  const rows = await db.select({ id: accounts.id }).from(accounts).where(and(
    eq(accounts.ownerId, ownerId),
    eq(accounts.isActive, true),
    inArray(accounts.id, [fromAccountId, toAccountId]),
  ));
  if (rows.length !== 2) throw new Error("Recurring Cash Flow account is not active for this owner.");
}


export async function recurringFutureThroughDate(
  db: RecurringDatabase,
  ownerId: string,
  seriesId: string,
  fromDate: string,
  fallbackEnd: string | null = null,
): Promise<string> {
  const [transactionRows, transferRows] = await Promise.all([
    db.select({ scheduledOccurrenceOn: transactions.scheduledOccurrenceOn }).from(transactions).where(and(
      eq(transactions.ownerId, ownerId),
      eq(transactions.recurringSeriesId, seriesId),
      eq(transactions.isGenerated, true),
      eq(transactions.status, "planned"),
      gte(transactions.scheduledOccurrenceOn, fromDate),
    )),
    db.select({ scheduledOccurrenceOn: transfers.scheduledOccurrenceOn }).from(transfers).where(and(
      eq(transfers.ownerId, ownerId),
      eq(transfers.recurringSeriesId, seriesId),
      eq(transfers.isGenerated, true),
      eq(transfers.status, "planned"),
      gte(transfers.scheduledOccurrenceOn, fromDate),
    )),
  ]);
  const existing = [...transactionRows, ...transferRows]
    .map((row) => row.scheduledOccurrenceOn)
    .filter((date): date is string => date !== null)
    .sort()
    .at(-1);
  return [fromDate, fallbackEnd ?? "", existing ?? ""].sort().at(-1) ?? fromDate;
}


async function earliestRewritableRecurringOccurrence(
  db: RecurringDatabase,
  ownerId: string,
  seriesId: string,
  kind: RecurringCashFlowKind,
  fromDate: string,
): Promise<string | null> {
  if (kind === "transfer") {
    const [row] = await db.select({ scheduledOccurrenceOn: transfers.scheduledOccurrenceOn }).from(transfers)
      .where(and(
        eq(transfers.ownerId, ownerId),
        eq(transfers.recurringSeriesId, seriesId),
        eq(transfers.isGenerated, true),
        eq(transfers.status, "planned"),
        gte(transfers.scheduledOccurrenceOn, fromDate),
      ))
      .orderBy(asc(transfers.scheduledOccurrenceOn), asc(transfers.id))
      .limit(1);
    return row?.scheduledOccurrenceOn ?? null;
  }
  const [row] = await db.select({ scheduledOccurrenceOn: transactions.scheduledOccurrenceOn }).from(transactions)
    .where(and(
      eq(transactions.ownerId, ownerId),
      eq(transactions.recurringSeriesId, seriesId),
      eq(transactions.isGenerated, true),
      eq(transactions.status, "planned"),
      eq(transactions.isExcluded, false),
      gte(transactions.scheduledOccurrenceOn, fromDate),
    ))
    .orderBy(asc(transactions.scheduledOccurrenceOn), asc(transactions.id))
    .limit(1);
  return row?.scheduledOccurrenceOn ?? null;
}


export async function syncGeneratedRecurringOccurrences(
  db: TransactionDatabase,
  ownerId: string,
  seriesId: string,
  fromDate: string,
  throughDate: string,
  options: {
    readonly ignoreSeriesState?: boolean;
    readonly removeFutureGenerated?: boolean;
    readonly preserveExistingRows?: boolean;
    readonly repairableGeneratedActualRange?: CurrentOpenCashFlowPaydayWindow;
  } = {},
): Promise<RecurringCashFlowGenerationResult> {
  assertRecurringDate(fromDate, "Generation start date");
  assertRecurringDate(throughDate, "Generation through date");
  if (options.repairableGeneratedActualRange) {
    assertRecurringDate(options.repairableGeneratedActualRange.startsOn, "Repairable generated actual start date");
    assertRecurringDate(options.repairableGeneratedActualRange.endsOn, "Repairable generated actual end date");
    if (options.repairableGeneratedActualRange.startsOn > options.repairableGeneratedActualRange.endsOn) throw new Error("Repairable generated actual date range is invalid.");
  }
  if (fromDate > throughDate) return emptyRecurringGenerationResult(seriesId, throughDate);
  const context = await loadRecurringContext(db, ownerId, seriesId);
  const canGenerate = options.ignoreSeriesState || context.series.state === "active";
  if (!canGenerate && !options.removeFutureGenerated) return emptyRecurringGenerationResult(seriesId, throughDate);
  const versions = context.versions.map(recurringVersionSchedule);
  const exceptions = context.exceptions.map(recurringExceptionSchedule);
  const occurrences = canGenerate && !options.removeFutureGenerated
    ? expandRecurringCashFlowOccurrences(seriesId, versions, exceptions, fromDate, throughDate)
    : [];
  const desiredByDate = new Map(occurrences.map((occurrence) => [occurrence.scheduledOccurrenceOn, occurrence]));
  const [existingRows, existingTransferRows] = await Promise.all([
    db.select({
      id: transactions.id,
      recurringOccurrenceId: transactions.recurringOccurrenceId,
      scheduledOccurrenceOn: transactions.scheduledOccurrenceOn,
      transactionDate: transactions.transactionDate,
      status: transactions.status,
      isExcluded: transactions.isExcluded,
      isGenerated: transactions.isGenerated,
    }).from(transactions)
      .where(and(
        eq(transactions.ownerId, ownerId),
        eq(transactions.recurringSeriesId, seriesId),
        gte(transactions.scheduledOccurrenceOn, fromDate),
        lte(transactions.scheduledOccurrenceOn, throughDate),
      ))
      .orderBy(asc(transactions.scheduledOccurrenceOn), asc(transactions.id)),
    db.select({
      id: transfers.id,
      recurringOccurrenceId: transfers.recurringOccurrenceId,
      scheduledOccurrenceOn: transfers.scheduledOccurrenceOn,
      transferDate: transfers.transferDate,
      status: transfers.status,
      isGenerated: transfers.isGenerated,
    }).from(transfers)
      .where(and(
        eq(transfers.ownerId, ownerId),
        eq(transfers.recurringSeriesId, seriesId),
        gte(transfers.scheduledOccurrenceOn, fromDate),
        lte(transfers.scheduledOccurrenceOn, throughDate),
      ))
      .orderBy(asc(transfers.scheduledOccurrenceOn), asc(transfers.id)),
  ]);
  const ownTransactionIds = new Set(existingRows.map((row) => row.id));
  const ownTransferIds = new Set(existingTransferRows.map((row) => row.id));
  const exceptionTransactionIds = new Set(context.exceptions.filter((exception) => exception.isActive && exception.transactionId).map((exception) => exception.transactionId!));
  const exceptionTransferIds = new Set(context.exceptions.filter((exception) => exception.isActive && exception.transferId).map((exception) => exception.transferId!));
  const isInRepairableActualRange = (scheduledOccurrenceOn: string | null): boolean => Boolean(
    scheduledOccurrenceOn
    && options.repairableGeneratedActualRange
    && scheduledOccurrenceOn >= options.repairableGeneratedActualRange.startsOn
    && scheduledOccurrenceOn <= options.repairableGeneratedActualRange.endsOn,
  );
  const isRepairableGeneratedTransactionRow = (row: (typeof existingRows)[number]): boolean => row.isGenerated
    && !row.isExcluded
    && !exceptionTransactionIds.has(row.id)
    && (row.status === "planned" || (row.status === "actual" && isInRepairableActualRange(row.scheduledOccurrenceOn)));
  const isRepairableGeneratedTransferRow = (row: (typeof existingTransferRows)[number]): boolean => row.isGenerated
    && !exceptionTransferIds.has(row.id)
    && (row.status === "planned" || (row.status === "actual" && isInRepairableActualRange(row.scheduledOccurrenceOn)));
  const isProtectedTransactionRow = (row: (typeof existingRows)[number]): boolean => !isRepairableGeneratedTransactionRow(row);
  const isProtectedTransferRow = (row: (typeof existingTransferRows)[number]): boolean => !isRepairableGeneratedTransferRow(row);
  const timelineCollisionCounts = new Map<string, number>();
  const timelineCollisionKey = (kind: RecurringCashFlowKind, name: string, date: string): string => `${kind}\u0000${name.trim().toLowerCase()}\u0000${date}`;
  const trackTimelineCollision = (kind: RecurringCashFlowKind, name: string, date: string): void => {
    const key = timelineCollisionKey(kind, name, date);
    timelineCollisionCounts.set(key, (timelineCollisionCounts.get(key) ?? 0) + 1);
  };
  if (options.preserveExistingRows) {
    const occurrenceDates = [...new Set(occurrences.flatMap((occurrence) => occurrence.transactionDate ? [occurrence.transactionDate] : []))].sort();
    const firstOccurrenceDate = occurrenceDates[0];
    const lastOccurrenceDate = occurrenceDates.at(-1);
    if (firstOccurrenceDate && lastOccurrenceDate) {
      const [timelineTransactions, timelineTransfers] = await Promise.all([
        db.select({ id: transactions.id, transactionDate: transactions.transactionDate, name: transactions.description, kind: transactions.kind }).from(transactions).where(and(eq(transactions.ownerId, ownerId), gte(transactions.transactionDate, firstOccurrenceDate), lte(transactions.transactionDate, lastOccurrenceDate))),
        db.select({ id: transfers.id, transferDate: transfers.transferDate, name: transfers.description }).from(transfers).where(and(eq(transfers.ownerId, ownerId), gte(transfers.transferDate, firstOccurrenceDate), lte(transfers.transferDate, lastOccurrenceDate))),
      ]);
      for (const row of timelineTransactions) {
        if (!ownTransactionIds.has(row.id)) trackTimelineCollision(row.kind === "adjustment" ? "transfer" : row.kind, row.name, row.transactionDate);
      }
      for (const row of timelineTransfers) {
        if (!ownTransferIds.has(row.id)) trackTimelineCollision("transfer", row.name, row.transferDate);
      }
    }
  }
  const rowsByDate = new Map<string, typeof existingRows>();
  for (const row of existingRows) {
    if (!row.scheduledOccurrenceOn) continue;
    const rows = rowsByDate.get(row.scheduledOccurrenceOn) ?? [];
    rows.push(row);
    rowsByDate.set(row.scheduledOccurrenceOn, rows);
  }
  let insertedCount = 0;
  let updatedCount = 0;
  let deletedCount = 0;
  let skippedCount = 0;
  let preservedCount = 0;
  const affectedTransactionIds: string[] = [];
  const affectedTransferIds: string[] = [];

  // Exception targets for deleted generated rows are collected during the loops below and
  // cleared with one owner-scoped UPDATE per column after all loops (TASK-031). This is
  // equivalent to the previous per-delete clearing: `transaction_id`/`transfer_id` carry
  // ON DELETE CASCADE foreign keys, so a surviving exception row can never point at a deleted
  // transaction or transfer, and no statement inside the loops reads back the cleared columns —
  // `exceptionTransactionIds`/`exceptionTransferIds` are snapshotted before the loops and the
  // `occurrence.exceptionId` relink updates overwrite both columns regardless of their prior
  // state. Because deleted targets are removed by the cascade, the row count affected by the
  // deferred UPDATEs is not deterministic, so no row-count assertion applies here.
  const clearedExceptionTransactionIds: string[] = [];
  const clearedExceptionTransferIds: string[] = [];

  const deleteGeneratedTransactionRow = async (row: (typeof existingRows)[number]): Promise<boolean> => {
    const [deleted] = await db.delete(transactions).where(and(
      eq(transactions.ownerId, ownerId),
      eq(transactions.id, row.id),
      eq(transactions.isGenerated, true),
      eq(transactions.status, row.status),
      eq(transactions.isExcluded, false),
    )).returning({ id: transactions.id });
    if (deleted) clearedExceptionTransactionIds.push(row.id);
    return Boolean(deleted);
  };

  const deleteGeneratedTransferRow = async (row: (typeof existingTransferRows)[number]): Promise<boolean> => {
    const [deleted] = await db.delete(transfers).where(and(
      eq(transfers.ownerId, ownerId),
      eq(transfers.id, row.id),
      eq(transfers.isGenerated, true),
      eq(transfers.status, row.status),
    )).returning({ id: transfers.id });
    if (deleted) clearedExceptionTransferIds.push(row.id);
    return Boolean(deleted);
  };

  for (const [scheduledOccurrenceOn, rows] of rowsByDate) {
    if (desiredByDate.has(scheduledOccurrenceOn)) continue;
    for (const row of rows) {
      if (isProtectedTransactionRow(row)) {
        preservedCount += 1;
        continue;
      }
      if (await deleteGeneratedTransactionRow(row)) {
        deletedCount += 1;
        affectedTransactionIds.push(row.id);
      }
    }
  }

  for (const row of existingTransferRows) {
    if (!row.scheduledOccurrenceOn || desiredByDate.has(row.scheduledOccurrenceOn)) continue;
    if (isProtectedTransferRow(row)) {
      preservedCount += 1;
      continue;
    }
    if (await deleteGeneratedTransferRow(row)) {
      deletedCount += 1;
      affectedTransferIds.push(row.id);
    }
  }

  for (const occurrence of occurrences) {
    const rows = rowsByDate.get(occurrence.scheduledOccurrenceOn) ?? [];
    const transferRows = existingTransferRows.filter((row) => row.scheduledOccurrenceOn === occurrence.scheduledOccurrenceOn);
    if (options.preserveExistingRows) {
      const scheduledRows = occurrence.kind === "transfer" ? transferRows : rows;
      const protectedRows = occurrence.kind === "transfer" ? transferRows.filter(isProtectedTransferRow) : rows.filter(isProtectedTransactionRow);
      const generatedRows = occurrence.kind === "transfer"
        ? transferRows.filter(isRepairableGeneratedTransferRow)
        : rows.filter(isRepairableGeneratedTransactionRow);
      const existingTimelineRowCount = occurrence.transactionDate ? timelineCollisionCounts.get(timelineCollisionKey(occurrence.kind, occurrence.name, occurrence.transactionDate)) ?? 0 : 0;
      if (protectedRows.length > 0 || (!occurrence.isSkipped && generatedRows.length === 0 && scheduledRows.length === 0 && existingTimelineRowCount > 0)) {
        preservedCount += protectedRows.length + (generatedRows.length === 0 && scheduledRows.length === 0 ? existingTimelineRowCount : 0);
        continue;
      }
    }
    if (occurrence.kind === "transfer") {
      const protectedRows = transferRows.filter(isProtectedTransferRow);
      if (protectedRows.length > 0) {
        preservedCount += protectedRows.length;
        continue;
      }
      const generated = transferRows.find(isRepairableGeneratedTransferRow);
      if (occurrence.isSkipped) {
        skippedCount += 1;
        if (generated) {
          if (await deleteGeneratedTransferRow(generated)) {
            deletedCount += 1;
            affectedTransferIds.push(generated.id);
          }
        }
        continue;
      }
      if (!occurrence.fromAccountId || !occurrence.toAccountId || occurrence.fromAccountId === occurrence.toAccountId) throw new Error("Recurring transfers require two different source and destination accounts.");
      await assertRecurringEndpoints(db, ownerId, { kind: "transfer", accountId: null, fromAccountId: occurrence.fromAccountId, toAccountId: occurrence.toAccountId });
      const transferDate = occurrence.transactionDate;
      if (!transferDate) throw new Error("Recurring occurrence has no transfer date.");
      const periodId = await resolveRecurringCashFlowPeriodId(db, ownerId, transferDate);
      const values = {
        ownerId,
        periodId,
        fromAccountId: occurrence.fromAccountId,
        toAccountId: occurrence.toAccountId,
        recurringTransactionId: occurrence.versionId,
        recurringSeriesId: occurrence.seriesId,
        scheduledOccurrenceOn: occurrence.scheduledOccurrenceOn,
        transferDate,
        amountMinor: occurrence.amountMinor,
        currency: "CAD" as const,
        status: generated?.status ?? ("planned" as const),
        description: occurrence.name,
        isGenerated: true,
        updatedAt: new Date(),
      };
      let transferId: string;
      if (generated) {
        const [updated] = await db.update(transfers).set(values)
          .where(and(eq(transfers.ownerId, ownerId), eq(transfers.id, generated.id), eq(transfers.isGenerated, true), eq(transfers.status, generated.status)))
          .returning({ id: transfers.id });
        if (!updated) throw new Error("Generated recurring transfer could not be updated.");
        transferId = updated.id;
        updatedCount += 1;
        affectedTransferIds.push(transferId);
      } else {
        const [inserted] = await db.insert(transfers).values({ ...values, recurringOccurrenceId: randomUUID() }).returning({ id: transfers.id });
        if (!inserted) throw new Error("Generated recurring transfer could not be inserted.");
        transferId = inserted.id;
        insertedCount += 1;
        affectedTransferIds.push(transferId);
      }
      if (occurrence.exceptionId) {
        await db.update(recurringCashFlowOccurrenceExceptions).set({ transactionId: null, transferId, updatedAt: new Date() })
          .where(and(eq(recurringCashFlowOccurrenceExceptions.ownerId, ownerId), eq(recurringCashFlowOccurrenceExceptions.id, occurrence.exceptionId), eq(recurringCashFlowOccurrenceExceptions.isActive, true)));
      }
      continue;
    }
    const protectedRows = rows.filter(isProtectedTransactionRow);
    if (protectedRows.length > 0) {
      preservedCount += protectedRows.length;
      continue;
    }
    const generated = rows.find(isRepairableGeneratedTransactionRow);
    if (occurrence.isSkipped) {
      skippedCount += 1;
      if (generated) {
        if (await deleteGeneratedTransactionRow(generated)) {
          deletedCount += 1;
          affectedTransactionIds.push(generated.id);
        }
      }
      continue;
    }
    const transactionDate = occurrence.transactionDate;
    if (!transactionDate) throw new Error("Recurring occurrence has no transaction date.");
    const periodId = await resolveRecurringCashFlowPeriodId(db, ownerId, transactionDate);
    await assertRecurringEndpoints(db, ownerId, { kind: occurrence.kind, accountId: occurrence.accountId, fromAccountId: null, toAccountId: null });
    const values = {
      ownerId,
      accountId: occurrence.accountId,
      periodId,
      recurringTransactionId: occurrence.versionId,
      recurringSeriesId: occurrence.seriesId,
      scheduledOccurrenceOn: occurrence.scheduledOccurrenceOn,
      transactionDate,
      kind: occurrence.kind,
      status: generated?.status ?? ("planned" as const),
      isExcluded: false,
      description: occurrence.name,
      amountMinor: occurrence.amountMinor,
      currency: "CAD" as const,
      isGenerated: true,
      updatedAt: new Date(),
    };
    let transactionId: string;
    if (generated) {
      const [updated] = await db.update(transactions).set(values)
        .where(and(eq(transactions.ownerId, ownerId), eq(transactions.id, generated.id), eq(transactions.isGenerated, true), eq(transactions.status, generated.status), eq(transactions.isExcluded, false)))
        .returning({ id: transactions.id });
      if (!updated) throw new Error("Generated recurring occurrence could not be updated.");
      transactionId = updated.id;
      updatedCount += 1;
      affectedTransactionIds.push(transactionId);
    } else {
      const [inserted] = await db.insert(transactions).values({ ...values, recurringOccurrenceId: randomUUID() }).returning({ id: transactions.id });
      if (!inserted) throw new Error("Generated recurring occurrence could not be inserted.");
      transactionId = inserted.id;
      insertedCount += 1;
      affectedTransactionIds.push(transactionId);
    }
    if (occurrence.exceptionId) {
      await db.update(recurringCashFlowOccurrenceExceptions).set({ transactionId, transferId: null, updatedAt: new Date() })
        .where(and(eq(recurringCashFlowOccurrenceExceptions.ownerId, ownerId), eq(recurringCashFlowOccurrenceExceptions.id, occurrence.exceptionId), eq(recurringCashFlowOccurrenceExceptions.isActive, true)));
    }
  }
  // Deferred exception-target clearing collected during the delete loops (see above). Rows that
  // were relinked inside the occurrence loop never match here: relinking assigns a newly created
  // transaction/transfer id, which cannot appear in these collected id sets.
  for (let index = 0; index < clearedExceptionTransactionIds.length; index += SET_UPDATE_CHUNK_SIZE) {
    const chunk = clearedExceptionTransactionIds.slice(index, index + SET_UPDATE_CHUNK_SIZE);
    await db.update(recurringCashFlowOccurrenceExceptions).set({ transactionId: null, transferId: null, updatedAt: new Date() })
      .where(and(
        eq(recurringCashFlowOccurrenceExceptions.ownerId, ownerId),
        inArray(recurringCashFlowOccurrenceExceptions.transactionId, chunk),
      ));
  }
  for (let index = 0; index < clearedExceptionTransferIds.length; index += SET_UPDATE_CHUNK_SIZE) {
    const chunk = clearedExceptionTransferIds.slice(index, index + SET_UPDATE_CHUNK_SIZE);
    await db.update(recurringCashFlowOccurrenceExceptions).set({ transactionId: null, transferId: null, updatedAt: new Date() })
      .where(and(
        eq(recurringCashFlowOccurrenceExceptions.ownerId, ownerId),
        inArray(recurringCashFlowOccurrenceExceptions.transferId, chunk),
      ));
  }
  const todayIso = toTorontoDateIso();
  const nextFromDate = throughDate > todayIso ? throughDate : todayIso;
  for (const version of versions) {
    const nextFrom = nextFromDate >= version.effectiveFrom
      ? addRecurringCashFlowDays(nextFromDate, 1)
      : version.effectiveFrom;
    const next = nextRecurringCashFlowOccurrence(version, nextFrom) ?? version.endsOn ?? version.effectiveFrom;
    await db.update(recurringTransactions).set({ nextOccurrenceOn: next, updatedAt: new Date() })
      .where(and(eq(recurringTransactions.ownerId, ownerId), eq(recurringTransactions.id, version.id), eq(recurringTransactions.seriesId, seriesId)));
  }
  await refreshCashFlowLinkedAccountProjections(db, ownerId);
  return {
    seriesId,
    throughDate,
    insertedCount,
    updatedCount,
    deletedCount,
    skippedCount,
    preservedCount,
    affectedTransactionIds: [...new Set(affectedTransactionIds)],
    affectedTransferIds: [...new Set(affectedTransferIds)],
  };
}


export function createCashFlowRepository(db: Database) {
  async function listPeriods(ownerId: string): Promise<readonly CashFlowPeriodView[]> {
    return db.select({
      id: cashFlowPeriods.id,
      label: cashFlowPeriods.label,
      startsOn: cashFlowPeriods.startsOn,
      endsOn: cashFlowPeriods.endsOn,
      payDate: cashFlowPeriods.payDate,
      openingBalanceMinor: cashFlowPeriods.openingBalanceMinor,
      currency: cashFlowPeriods.currency,
      status: cashFlowPeriods.status,
    }).from(cashFlowPeriods)
      .where(eq(cashFlowPeriods.ownerId, ownerId))
      .orderBy(asc(cashFlowPeriods.startsOn), asc(cashFlowPeriods.id));
  }

  async function listCashFlowAccounts(ownerId: string): Promise<readonly CashFlowAccountView[]> {
    return db.select({
      id: accounts.id,
      name: accounts.name,
      institution: institutions.name,
      kind: accounts.kind,
      currency: accounts.currency,
      isActive: accounts.isActive,
      includeInAvailableCash: accounts.includeInAvailableCash,
      isVisibleInCashFlow: accounts.isVisibleInCashFlow,
    }).from(accounts)
      .innerJoin(institutions, and(eq(institutions.id, accounts.institutionId), eq(institutions.ownerId, ownerId)))
      .where(and(eq(accounts.ownerId, ownerId), eq(accounts.isActive, true)))
      .orderBy(asc(accounts.timelineOrder), asc(accounts.name), asc(accounts.id));
  }

  async function getPeriodDataMany(ownerId: string, periodIds: readonly string[], preloadedPeriods?: readonly CashFlowPeriodView[]): Promise<readonly (CashFlowPeriodData | null)[]> {
    const uniquePeriodIds = [...new Set(periodIds)];
    if (uniquePeriodIds.length === 0) return [];
    const uniquePeriodIdSet = new Set(uniquePeriodIds);
    const periodRowsPromise = preloadedPeriods !== undefined
      ? Promise.resolve(preloadedPeriods.filter((row) => uniquePeriodIdSet.has(row.id)))
      : db.select({
        id: cashFlowPeriods.id,
        label: cashFlowPeriods.label,
        startsOn: cashFlowPeriods.startsOn,
        endsOn: cashFlowPeriods.endsOn,
        payDate: cashFlowPeriods.payDate,
        openingBalanceMinor: cashFlowPeriods.openingBalanceMinor,
        currency: cashFlowPeriods.currency,
        status: cashFlowPeriods.status,
      }).from(cashFlowPeriods)
        .where(and(eq(cashFlowPeriods.ownerId, ownerId), inArray(cashFlowPeriods.id, uniquePeriodIds)));
    const [periodRows, transactionRows, transferRows] = await Promise.all([
      periodRowsPromise,
      db.select({
        id: transactions.id,
        periodId: transactions.periodId,
        transactionDate: transactions.transactionDate,
        kind: transactions.kind,
        status: transactions.status,
        description: transactions.description,
        category: transactions.category,
        amountMinor: transactions.amountMinor,
        accountId: transactions.accountId,
        recurringTransactionId: transactions.recurringTransactionId,
        recurringSeriesId: transactions.recurringSeriesId,
        recurringOccurrenceId: transactions.recurringOccurrenceId,
        scheduledOccurrenceOn: transactions.scheduledOccurrenceOn,
        isGenerated: transactions.isGenerated,
      }).from(transactions)
        .where(and(eq(transactions.ownerId, ownerId), inArray(transactions.periodId, uniquePeriodIds), eq(transactions.isExcluded, false)))
        .orderBy(asc(transactions.transactionDate), asc(transactions.id)),
      db.select({
        id: transfers.id,
        periodId: transfers.periodId,
        recurringTransactionId: transfers.recurringTransactionId,
        recurringSeriesId: transfers.recurringSeriesId,
        recurringOccurrenceId: transfers.recurringOccurrenceId,
        scheduledOccurrenceOn: transfers.scheduledOccurrenceOn,
        isGenerated: transfers.isGenerated,
        transferDate: transfers.transferDate,
        status: transfers.status,
        description: transfers.description,
        amountMinor: transfers.amountMinor,
        fromAccountId: transfers.fromAccountId,
        toAccountId: transfers.toAccountId,
        countsAsExpense: recurringTransactions.countsAsExpense,
      }).from(transfers)
        .leftJoin(recurringTransactions, eq(recurringTransactions.id, transfers.recurringTransactionId))
        .where(and(eq(transfers.ownerId, ownerId), inArray(transfers.periodId, uniquePeriodIds)))
        .orderBy(asc(transfers.transferDate), asc(transfers.id)),
    ]);
    const periodById = new Map(periodRows.map((row) => [row.id, row] as const));
    const transactionsByPeriodId = new Map<string, typeof transactionRows>();
    for (const row of transactionRows) {
      if (!row.periodId) continue;
      const bucket = transactionsByPeriodId.get(row.periodId);
      if (bucket) bucket.push(row);
      else transactionsByPeriodId.set(row.periodId, [row]);
    }
    const transfersByPeriodId = new Map<string, typeof transferRows>();
    for (const row of transferRows) {
      if (!row.periodId) continue;
      const bucket = transfersByPeriodId.get(row.periodId);
      if (bucket) bucket.push(row);
      else transfersByPeriodId.set(row.periodId, [row]);
    }
    const recurringTransactionIds = transactionRows.filter((row) => row.recurringSeriesId).map((row) => row.id);
    const activeExceptionRows = recurringTransactionIds.length === 0 ? [] : await db.select({ transactionId: recurringCashFlowOccurrenceExceptions.transactionId, exceptionId: recurringCashFlowOccurrenceExceptions.id })
      .from(recurringCashFlowOccurrenceExceptions)
      .where(and(eq(recurringCashFlowOccurrenceExceptions.ownerId, ownerId), eq(recurringCashFlowOccurrenceExceptions.isActive, true), inArray(recurringCashFlowOccurrenceExceptions.transactionId, recurringTransactionIds)));
    const exceptionByTransactionId = new Map(activeExceptionRows.flatMap((row) => row.transactionId ? [[row.transactionId, row.exceptionId] as const] : []));
    const names = await accountNamesFor(db, ownerId, [
      ...transactionRows.map((row) => row.accountId),
      ...transferRows.flatMap((row) => [row.fromAccountId, row.toAccountId]),
    ]);

    return periodIds.map((periodId) => {
      const period = periodById.get(periodId);
      if (!period) return null;
      const periodTransactions = transactionsByPeriodId.get(periodId) ?? [];
      const periodTransfers = transfersByPeriodId.get(periodId) ?? [];
      return {
        period,
        transactions: periodTransactions.map((row) => ({
          id: row.id,
          accountId: row.accountId,
          recurringTransactionId: row.recurringTransactionId,
          recurringSeriesId: row.recurringSeriesId,
          recurringOccurrenceId: row.recurringOccurrenceId,
          recurringExceptionId: row.recurringSeriesId ? exceptionByTransactionId.get(row.id) ?? null : null,
          scheduledOccurrenceOn: row.scheduledOccurrenceOn,
          isGenerated: row.isGenerated,
          transactionDate: row.transactionDate,
          kind: row.kind,
          status: row.status,
          description: row.description,
          category: row.category,
          amountMinor: row.amountMinor,
          accountName: row.accountId ? names.get(row.accountId) ?? "Unassigned" : "Unassigned",
        })),
        transfers: periodTransfers.map((row) => ({
          id: row.id,
          recurringTransactionId: row.recurringTransactionId,
          recurringSeriesId: row.recurringSeriesId,
          recurringOccurrenceId: row.recurringOccurrenceId,
          scheduledOccurrenceOn: row.scheduledOccurrenceOn,
          isGenerated: row.isGenerated,
          transferDate: row.transferDate,
          status: row.status,
          description: row.description,
          amountMinor: row.amountMinor,
          fromAccountId: row.fromAccountId,
          toAccountId: row.toAccountId,
          fromAccountName: names.get(row.fromAccountId) ?? "Unassigned",
          toAccountName: names.get(row.toAccountId) ?? "Unassigned",
          countsAsExpense: row.countsAsExpense === true,
        })),
      };
    });
  }

  async function getPeriodData(ownerId: string, periodId: string, preloadedPeriods?: readonly CashFlowPeriodView[]): Promise<CashFlowPeriodData | null> {
    const [data] = await getPeriodDataMany(ownerId, [periodId], preloadedPeriods);
    return data ?? null;
  }

  async function listProjectionData(ownerId: string, throughDate: string, lowerBoundDate: string | null, activeAccountIds: readonly string[]): Promise<{
    readonly transactions: readonly CashFlowTransactionView[];
    readonly transfers: readonly CashFlowTransferView[];
  }> {
    // TASK-022: rows dated before `lowerBoundDate` can no longer affect any consumer output.
    // For `projectChainedCashFlow` they are dead input (see `cashFlowProjectionDataLowerBound`),
    // and window rows are already loaded per period by `getPeriodDataMany`. The exceptions below
    // keep everything consumers still read outside the bound:
    // - rows tied to a recurring series (recurring range options and the `hasRecurring` style
    //   recurring-existence checks consider them regardless of date),
    // - rows that `projectChainedCashFlow` turns into warnings (unassigned/unknown-account rows
    //   are attributed to the first window period), and
    // - rows violating the engine's minor-unit guards, which also surface as warnings.
    const transactionDateBounds = lowerBoundDate === null ? lte(transactions.transactionDate, throughDate) : and(
      lte(transactions.transactionDate, throughDate),
      or(
        gte(transactions.transactionDate, lowerBoundDate),
        isNotNull(transactions.recurringSeriesId),
        and(
          inArray(transactions.kind, ["income", "expense"]),
          or(isNull(transactions.accountId), notInArray(transactions.accountId, [...activeAccountIds]), gt(transactions.amountMinor, Number.MAX_SAFE_INTEGER)),
        ),
      ),
    );
    const transferDateBounds = lowerBoundDate === null ? lte(transfers.transferDate, throughDate) : and(
      lte(transfers.transferDate, throughDate),
      or(
        gte(transfers.transferDate, lowerBoundDate),
        or(notInArray(transfers.fromAccountId, [...activeAccountIds]), notInArray(transfers.toAccountId, [...activeAccountIds]), eq(transfers.fromAccountId, transfers.toAccountId)),
        or(lte(transfers.amountMinor, 0), gt(transfers.amountMinor, Number.MAX_SAFE_INTEGER)),
      ),
    );
    const [transactionRows, transferRows] = await Promise.all([
      db.select({
        id: transactions.id,
        transactionDate: transactions.transactionDate,
        kind: transactions.kind,
        status: transactions.status,
        description: transactions.description,
        category: transactions.category,
        amountMinor: transactions.amountMinor,
        accountId: transactions.accountId,
        recurringTransactionId: transactions.recurringTransactionId,
        recurringSeriesId: transactions.recurringSeriesId,
        recurringOccurrenceId: transactions.recurringOccurrenceId,
        scheduledOccurrenceOn: transactions.scheduledOccurrenceOn,
        isGenerated: transactions.isGenerated,
      }).from(transactions)
        .where(and(eq(transactions.ownerId, ownerId), eq(transactions.isExcluded, false), transactionDateBounds))
        .orderBy(asc(transactions.transactionDate), asc(transactions.id)),
      db.select({
        id: transfers.id,
        recurringTransactionId: transfers.recurringTransactionId,
        recurringSeriesId: transfers.recurringSeriesId,
        recurringOccurrenceId: transfers.recurringOccurrenceId,
        scheduledOccurrenceOn: transfers.scheduledOccurrenceOn,
        isGenerated: transfers.isGenerated,
        transferDate: transfers.transferDate,
        status: transfers.status,
        description: transfers.description,
        amountMinor: transfers.amountMinor,
        fromAccountId: transfers.fromAccountId,
        toAccountId: transfers.toAccountId,
        countsAsExpense: recurringTransactions.countsAsExpense,
      }).from(transfers)
        .leftJoin(recurringTransactions, eq(recurringTransactions.id, transfers.recurringTransactionId))
        .where(and(eq(transfers.ownerId, ownerId), transferDateBounds))
        .orderBy(asc(transfers.transferDate), asc(transfers.id)),
    ]);
    const recurringTransactionIds = transactionRows.filter((row) => row.recurringSeriesId).map((row) => row.id);
    const activeExceptionRows = recurringTransactionIds.length === 0 ? [] : await db.select({ transactionId: recurringCashFlowOccurrenceExceptions.transactionId, exceptionId: recurringCashFlowOccurrenceExceptions.id })
      .from(recurringCashFlowOccurrenceExceptions)
      .where(and(eq(recurringCashFlowOccurrenceExceptions.ownerId, ownerId), eq(recurringCashFlowOccurrenceExceptions.isActive, true), inArray(recurringCashFlowOccurrenceExceptions.transactionId, recurringTransactionIds)));
    const exceptionByTransactionId = new Map(activeExceptionRows.flatMap((row) => row.transactionId ? [[row.transactionId, row.exceptionId] as const] : []));
    const names = await accountNamesFor(db, ownerId, [
      ...transactionRows.map((row) => row.accountId),
      ...transferRows.flatMap((row) => [row.fromAccountId, row.toAccountId]),
    ]);
    return {
      transactions: transactionRows.map((row) => ({
        id: row.id,
        accountId: row.accountId,
        recurringTransactionId: row.recurringTransactionId,
        recurringSeriesId: row.recurringSeriesId,
        recurringOccurrenceId: row.recurringOccurrenceId,
        recurringExceptionId: row.recurringSeriesId ? exceptionByTransactionId.get(row.id) ?? null : null,
        scheduledOccurrenceOn: row.scheduledOccurrenceOn,
        isGenerated: row.isGenerated,
        transactionDate: row.transactionDate,
        kind: row.kind,
        status: row.status,
        description: row.description,
        category: row.category,
        amountMinor: row.amountMinor,
        accountName: row.accountId ? names.get(row.accountId) ?? "Unassigned" : "Unassigned",
      })),
      transfers: transferRows.map((row) => ({
        id: row.id,
        recurringTransactionId: row.recurringTransactionId,
        recurringSeriesId: row.recurringSeriesId,
        recurringOccurrenceId: row.recurringOccurrenceId,
        scheduledOccurrenceOn: row.scheduledOccurrenceOn,
        isGenerated: row.isGenerated,
        transferDate: row.transferDate,
        status: row.status,
        description: row.description,
        amountMinor: row.amountMinor,
        fromAccountId: row.fromAccountId,
        toAccountId: row.toAccountId,
        fromAccountName: names.get(row.fromAccountId) ?? "Unassigned",
        toAccountName: names.get(row.toAccountId) ?? "Unassigned",
        countsAsExpense: row.countsAsExpense === true,
      })),
    };
  }

  const listRecurringSeries = async (
    ownerId: string,
    options: { readonly includeHistory?: boolean; readonly asOfIso?: string } = {},
  ): Promise<readonly RecurringCashFlowSeriesView[]> => {
    const seriesRows = await db.select().from(recurringCashFlowSeries)
      .where(eq(recurringCashFlowSeries.ownerId, ownerId))
      .orderBy(asc(recurringCashFlowSeries.createdAt), asc(recurringCashFlowSeries.id));
    const asOfIso = options.asOfIso ?? toTorontoDateIso();
    assertRecurringDate(asOfIso, "Recurring series view date");
    const contexts = await loadRecurringContexts(db, ownerId, seriesRows);
    const views = seriesRows.map((series) => {
      const view = recurringSeriesView(contexts.get(series.id)!, asOfIso);
      if (options.includeHistory === false) {
        return { ...view, versions: view.versions.filter((version) => version.isCurrent) };
      }
      return view;
    });
    return views;
  };

  const createRecurringSeries = async (ownerId: string, input: RecurringCashFlowSeriesInput): Promise<RecurringCashFlowSeriesView> => {
    assertRecurringSeriesInput(input);
    const homeHouseholdFrequency = input.homeHouseholdFrequency === "biweekly" || input.homeHouseholdFrequency === "monthly"
      ? input.homeHouseholdFrequency
      : null;
    if (homeHouseholdFrequency && input.frequency !== homeHouseholdFrequency) {
      throw new Error("Home household Cash Flow series frequency must match the Home card (biweekly or monthly).");
    }
    const seriesId = await db.transaction(async (tx) => {
      await assertRecurringEndpoints(tx, ownerId, input);
      if (homeHouseholdFrequency) {
        const existingHomeLinks = await tx.select({
          id: recurringCashFlowSeries.id,
          homeHouseholdFrequency: recurringCashFlowSeries.homeHouseholdFrequency,
          state: recurringCashFlowSeries.state,
        }).from(recurringCashFlowSeries)
          .where(and(
            eq(recurringCashFlowSeries.ownerId, ownerId),
            or(eq(recurringCashFlowSeries.homeHouseholdFrequency, "biweekly"), eq(recurringCashFlowSeries.homeHouseholdFrequency, "monthly")),
          ));
        const activeHomeLink = existingHomeLinks.find((row) => row.state !== "ended");
        if (activeHomeLink) {
          if (activeHomeLink.homeHouseholdFrequency === homeHouseholdFrequency) {
            throw new Error("A Cash Flow series is already linked to this Home household total.");
          }
          throw new Error("A Cash Flow series is already linked to the other Home household total (bi-weekly or monthly). Only one household total may be linked.");
        }
      }
      const [series] = await tx.insert(recurringCashFlowSeries).values({
        ownerId,
        kind: input.kind,
        state: "active",
        endedOn: null,
        homeHouseholdFrequency,
      }).returning();
      if (!series) throw new Error("Recurring Cash Flow series could not be created.");
      const [version] = await tx.insert(recurringTransactions).values({
        ownerId,
        seriesId: series.id,
        accountId: input.accountId,
        fromAccountId: input.fromAccountId ?? null,
        toAccountId: input.toAccountId ?? null,
        kind: input.kind,
        frequency: input.frequency,
        weekdayAdjustment: input.weekdayAdjustment ?? "none",
        description: input.name.trim(),
        amountMinor: input.amountMinor,
        currency: "CAD",
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        effectiveFrom: input.nextOccurrenceOn,
        effectiveTo: null,
        versionNote: input.note ?? null,
        countsAsExpense: normalizeCountsAsExpense(input),
        nextOccurrenceOn: input.nextOccurrenceOn,
        status: "planned",
      }).returning();
      if (!version) throw new Error("Recurring Cash Flow version could not be created.");

      const [startingPeriod, latestOwnerPeriod] = await Promise.all([
        tx.select({ id: cashFlowPeriods.id }).from(cashFlowPeriods)
          .where(and(eq(cashFlowPeriods.ownerId, ownerId), lte(cashFlowPeriods.payDate, input.startsOn)))
          .orderBy(desc(cashFlowPeriods.payDate), desc(cashFlowPeriods.id))
          .limit(1),
        tx.select({ endsOn: cashFlowPeriods.endsOn }).from(cashFlowPeriods)
          .where(eq(cashFlowPeriods.ownerId, ownerId))
          .orderBy(desc(cashFlowPeriods.endsOn), desc(cashFlowPeriods.id))
          .limit(1),
      ]).then(([starts, latest]) => [starts[0], latest[0]] as const);
      const generationThroughDate = startingPeriod && latestOwnerPeriod
        ? input.endsOn && input.endsOn < latestOwnerPeriod.endsOn ? input.endsOn : latestOwnerPeriod.endsOn
        : null;
      const generation = generationThroughDate && input.startsOn <= generationThroughDate
        ? await syncGeneratedRecurringOccurrences(tx, ownerId, series.id, input.startsOn, generationThroughDate, { preserveExistingRows: true })
        : emptyRecurringGenerationResult(series.id, generationThroughDate ?? input.startsOn);

      await tx.insert(auditEvents).values({
        ownerId,
        actorUserId: ownerId,
        action: "created",
        entityType: "recurring_series",
        entityId: series.id,
        metadata: {
          operation: "recurring_series_create",
          versionId: version.id,
          generationThroughDate,
          insertedCount: generation.insertedCount,
          updatedCount: generation.updatedCount,
          deletedCount: generation.deletedCount,
          skippedCount: generation.skippedCount,
          preservedCount: generation.preservedCount,
          affectedTransactionIds: generation.affectedTransactionIds,
          affectedTransferIds: generation.affectedTransferIds,
        },
      });
      return series.id;
    });
    return recurringSeriesView(await loadRecurringContext(db, ownerId, seriesId), toTorontoDateIso());
  };

  const setRecurringSeriesState = async (ownerId: string, seriesId: string, state: "active" | "paused"): Promise<RecurringCashFlowSeriesView> => {
    const id = await db.transaction(async (tx) => {
      const [series] = await tx.select().from(recurringCashFlowSeries).where(and(eq(recurringCashFlowSeries.ownerId, ownerId), eq(recurringCashFlowSeries.id, seriesId))).limit(1);
      if (!series) throw new Error("Recurring Cash Flow series not found.");
      if (series.state === "ended") throw new Error("An ended recurring series cannot be resumed or paused.");
      if (series.state === state) return series.id;
      const todayIso = toTorontoDateIso();
      const fromDate = addRecurringCashFlowDays(todayIso, 1);
      const throughDate = await recurringFutureThroughDate(tx, ownerId, seriesId, fromDate, addRecurringCashFlowDays(todayIso, 365));
      const [updated] = await tx.update(recurringCashFlowSeries).set({ state, endedOn: null, updatedAt: new Date() })
        .where(and(eq(recurringCashFlowSeries.ownerId, ownerId), eq(recurringCashFlowSeries.id, seriesId))).returning({ id: recurringCashFlowSeries.id });
      if (!updated) throw new Error("Recurring Cash Flow series could not be updated.");
      const generation = state === "paused"
        ? await syncGeneratedRecurringOccurrences(tx, ownerId, seriesId, fromDate, throughDate, { removeFutureGenerated: true })
        : await syncGeneratedRecurringOccurrences(tx, ownerId, seriesId, fromDate, throughDate);
      await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "updated", entityType: "recurring_series", entityId: seriesId, metadata: { operation: state === "paused" ? "recurring_series_pause" : "recurring_series_resume", state, insertedCount: generation.insertedCount, updatedCount: generation.updatedCount, deletedCount: generation.deletedCount, preservedCount: generation.preservedCount, affectedTransactionIds: generation.affectedTransactionIds, affectedTransferIds: generation.affectedTransferIds } });
      return updated.id;
    });
    return recurringSeriesView(await loadRecurringContext(db, ownerId, id), toTorontoDateIso());
  };

  const endRecurringSeries = async (ownerId: string, seriesId: string, endingOccurrenceOn: string): Promise<RecurringCashFlowSeriesView> => {
    assertRecurringDate(endingOccurrenceOn, "Ending occurrence date");
    const id = await db.transaction(async (tx) => {
      const context = await loadRecurringContext(tx, ownerId, seriesId);
      if (context.series.state === "ended") return context.series.id;
      const schedules = context.versions.map(recurringVersionSchedule);
      const version = selectRecurringCashFlowVersion(schedules, endingOccurrenceOn);
      if (!version || !isRecurringCashFlowOccurrence(version, endingOccurrenceOn)) {
        throw new Error("Choose an occurrence that belongs to the active recurring schedule.");
      }
      const exception = context.exceptions.find((candidate) => candidate.isActive && candidate.scheduledOccurrenceOn === endingOccurrenceOn);
      if (exception?.kind === "skip") throw new Error("A skipped occurrence cannot end a recurring series.");
      const todayIso = toTorontoDateIso();
      const fromDate = addRecurringCashFlowDays(todayIso, 1);
      await syncGeneratedRecurringOccurrences(tx, ownerId, seriesId, fromDate, endingOccurrenceOn);
      const throughDate = await recurringFutureThroughDate(tx, ownerId, seriesId, addRecurringCashFlowDays(endingOccurrenceOn, 1), endingOccurrenceOn);
      const [updated] = await tx.update(recurringCashFlowSeries).set({ state: "ended", endedOn: endingOccurrenceOn, updatedAt: new Date() })
        .where(and(eq(recurringCashFlowSeries.ownerId, ownerId), eq(recurringCashFlowSeries.id, seriesId))).returning({ id: recurringCashFlowSeries.id });
      if (!updated) throw new Error("Recurring Cash Flow series could not be ended.");
      await tx.update(recurringTransactions).set({ endsOn: endingOccurrenceOn, effectiveTo: endingOccurrenceOn, nextOccurrenceOn: endingOccurrenceOn, updatedAt: new Date() })
        .where(and(eq(recurringTransactions.ownerId, ownerId), eq(recurringTransactions.id, version.id)));
      const generation = await syncGeneratedRecurringOccurrences(tx, ownerId, seriesId, addRecurringCashFlowDays(endingOccurrenceOn, 1), throughDate, { removeFutureGenerated: true });
      await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "updated", entityType: "recurring_series", entityId: seriesId, metadata: { operation: "recurring_series_end", endingOccurrenceOn, removedGeneratedCount: generation.deletedCount, preservedCount: generation.preservedCount, affectedTransactionIds: generation.affectedTransactionIds, affectedTransferIds: generation.affectedTransferIds } });
      return updated.id;
    });
    return recurringSeriesView(await loadRecurringContext(db, ownerId, id), toTorontoDateIso());
  };

  const deleteRecurringSeries = async (ownerId: string, seriesId: string): Promise<RecurringCashFlowDeletionResult> => {
    return db.transaction(async (tx) => {
      const [series] = await tx.select({ id: recurringCashFlowSeries.id })
        .from(recurringCashFlowSeries)
        .where(and(eq(recurringCashFlowSeries.ownerId, ownerId), eq(recurringCashFlowSeries.id, seriesId)))
        .limit(1);
      if (!series) throw new Error("Recurring Cash Flow series not found.");

      const [transactionRows, transferRows] = await Promise.all([
        tx.select({ id: transactions.id }).from(transactions).where(and(eq(transactions.ownerId, ownerId), eq(transactions.recurringSeriesId, seriesId))),
        tx.select({ id: transfers.id }).from(transfers).where(and(eq(transfers.ownerId, ownerId), eq(transfers.recurringSeriesId, seriesId))),
      ]);
      const transactionIds = transactionRows.map((row) => row.id);
      const transferIds = transferRows.map((row) => row.id);
      let sourceReferenceCount = 0;

      if (transactionIds.length > 0) {
        const deletedReferences = await tx.delete(sourceReferences).where(and(eq(sourceReferences.ownerId, ownerId), eq(sourceReferences.recordType, "transaction"), inArray(sourceReferences.recordId, transactionIds))).returning({ id: sourceReferences.id });
        sourceReferenceCount += deletedReferences.length;
        const deletedTransactions = await tx.delete(transactions).where(and(eq(transactions.ownerId, ownerId), inArray(transactions.id, transactionIds))).returning({ id: transactions.id });
        if (deletedTransactions.length !== transactionIds.length) throw new Error("Recurring Cash Flow transactions could not be deleted.");
      }
      if (transferIds.length > 0) {
        const deletedReferences = await tx.delete(sourceReferences).where(and(eq(sourceReferences.ownerId, ownerId), eq(sourceReferences.recordType, "transfer"), inArray(sourceReferences.recordId, transferIds))).returning({ id: sourceReferences.id });
        sourceReferenceCount += deletedReferences.length;
        const deletedTransfers = await tx.delete(transfers).where(and(eq(transfers.ownerId, ownerId), inArray(transfers.id, transferIds))).returning({ id: transfers.id });
        if (deletedTransfers.length !== transferIds.length) throw new Error("Recurring Cash Flow transfers could not be deleted.");
      }

      await tx.insert(auditEvents).values({
        ownerId,
        actorUserId: ownerId,
        action: "deleted",
        entityType: "recurring_series",
        entityId: seriesId,
        metadata: { operation: "recurring_series_delete", transactionCount: transactionIds.length, transferCount: transferIds.length, sourceReferenceCount },
      });
      const [deletedSeries] = await tx.delete(recurringCashFlowSeries)
        .where(and(eq(recurringCashFlowSeries.ownerId, ownerId), eq(recurringCashFlowSeries.id, seriesId)))
        .returning({ id: recurringCashFlowSeries.id });
      if (!deletedSeries) throw new Error("Recurring Cash Flow series could not be deleted.");
      await refreshCashFlowLinkedAccountProjections(tx, ownerId);
      return { seriesId, transactionCount: transactionIds.length, transferCount: transferIds.length, sourceReferenceCount };
    });
  };

  const deleteRecurringSeriesVersion = async (ownerId: string, seriesId: string, versionId: string): Promise<RecurringCashFlowVersionDeletionResult> => {
    return db.transaction(async (tx) => {
      const context = await loadRecurringContext(tx, ownerId, seriesId);
      const target = context.versions.find((version) => version.id === versionId);
      if (!target) throw new Error("Recurring Cash Flow version not found.");
      if (context.versions.length <= 1) throw new Error("A recurring series must keep at least one version.");

      const schedules = partitionRecurringCashFlowVersions(context.versions.map(recurringVersionSchedule), seriesId);
      const current = selectRecurringCashFlowVersion(schedules, context.series.endedOn ?? toTorontoDateIso());
      if (current?.id === versionId) throw new Error("The current recurring version cannot be deleted; create a new version instead.");

      const [seriesTransactions, seriesTransfers, activeExceptions] = await Promise.all([
        tx.select({
          id: transactions.id,
          recurringTransactionId: transactions.recurringTransactionId,
          scheduledOccurrenceOn: transactions.scheduledOccurrenceOn,
          transactionDate: transactions.transactionDate,
          status: transactions.status,
          isGenerated: transactions.isGenerated,
          isExcluded: transactions.isExcluded,
        }).from(transactions).where(and(
          eq(transactions.ownerId, ownerId),
          eq(transactions.recurringSeriesId, seriesId),
        )),
        tx.select({
          id: transfers.id,
          recurringTransactionId: transfers.recurringTransactionId,
          scheduledOccurrenceOn: transfers.scheduledOccurrenceOn,
          transferDate: transfers.transferDate,
          status: transfers.status,
          isGenerated: transfers.isGenerated,
        }).from(transfers).where(and(
          eq(transfers.ownerId, ownerId),
          eq(transfers.recurringSeriesId, seriesId),
        )),
        tx.select({ id: recurringCashFlowOccurrenceExceptions.id }).from(recurringCashFlowOccurrenceExceptions).where(and(
          eq(recurringCashFlowOccurrenceExceptions.ownerId, ownerId),
          eq(recurringCashFlowOccurrenceExceptions.seriesId, seriesId),
          eq(recurringCashFlowOccurrenceExceptions.versionId, versionId),
          eq(recurringCashFlowOccurrenceExceptions.isActive, true),
        )),
      ]);
      const isWithinTargetRange = (scheduledOccurrenceOn: string | null): boolean => scheduledOccurrenceOn !== null
        && scheduledOccurrenceOn >= target.effectiveFrom
        && (target.effectiveTo === null || scheduledOccurrenceOn <= target.effectiveTo);
      const targetTransactions = seriesTransactions.filter((row) => row.recurringTransactionId === versionId || isWithinTargetRange(row.scheduledOccurrenceOn ?? row.transactionDate));
      const targetTransfers = seriesTransfers.filter((row) => row.recurringTransactionId === versionId || isWithinTargetRange(row.scheduledOccurrenceOn ?? row.transferDate));
      const isDeletableTransaction = (row: typeof targetTransactions[number]): boolean => row.recurringTransactionId === versionId
        && row.status === "planned"
        && row.isGenerated
        && !row.isExcluded;
      const isDeletableTransfer = (row: typeof targetTransfers[number]): boolean => row.recurringTransactionId === versionId
        && row.status === "planned"
        && row.isGenerated;
      const protectedTransactions = targetTransactions.filter((row) => !isDeletableTransaction(row));
      const protectedTransfers = targetTransfers.filter((row) => !isDeletableTransfer(row));
      if (protectedTransactions.length > 0 || protectedTransfers.length > 0 || activeExceptions.length > 0) {
        throw new Error("This recurring version has protected Cash Flow rows or active occurrence overrides and cannot be deleted.");
      }

      const generatedTransactions = targetTransactions.filter(isDeletableTransaction);
      const generatedTransfers = targetTransfers.filter(isDeletableTransfer);
      const transactionIds = generatedTransactions.map((row) => row.id);
      const transferIds = generatedTransfers.map((row) => row.id);
      let sourceReferenceCount = 0;
      if (transactionIds.length > 0) {
        const deletedReferences = await tx.delete(sourceReferences).where(and(
          eq(sourceReferences.ownerId, ownerId),
          eq(sourceReferences.recordType, "transaction"),
          inArray(sourceReferences.recordId, transactionIds),
        )).returning({ id: sourceReferences.id });
        sourceReferenceCount += deletedReferences.length;
        const deletedTransactions = await tx.delete(transactions).where(and(eq(transactions.ownerId, ownerId), inArray(transactions.id, transactionIds))).returning({ id: transactions.id });
        if (deletedTransactions.length !== transactionIds.length) throw new Error("Recurring Cash Flow transactions could not be deleted.");
      }
      if (transferIds.length > 0) {
        const deletedReferences = await tx.delete(sourceReferences).where(and(
          eq(sourceReferences.ownerId, ownerId),
          eq(sourceReferences.recordType, "transfer"),
          inArray(sourceReferences.recordId, transferIds),
        )).returning({ id: sourceReferences.id });
        sourceReferenceCount += deletedReferences.length;
        const deletedTransfers = await tx.delete(transfers).where(and(eq(transfers.ownerId, ownerId), inArray(transfers.id, transferIds))).returning({ id: transfers.id });
        if (deletedTransfers.length !== transferIds.length) throw new Error("Recurring Cash Flow transfers could not be deleted.");
      }

      const targetIndex = schedules.findIndex((version) => version.id === versionId);
      const predecessor = targetIndex > 0 ? schedules[targetIndex - 1] : null;
      const successor = targetIndex >= 0 ? schedules[targetIndex + 1] : null;
      const successorRow = successor ? context.versions.find((version) => version.id === successor.id) : null;
      if (successorRow?.supersedesVersionId === versionId) {
        await tx.update(recurringTransactions)
          .set({ supersedesVersionId: predecessor?.id ?? null, updatedAt: new Date() })
          .where(and(eq(recurringTransactions.ownerId, ownerId), eq(recurringTransactions.id, successorRow.id), eq(recurringTransactions.seriesId, seriesId)));
      }

      await tx.insert(auditEvents).values({
        ownerId,
        actorUserId: ownerId,
        action: "deleted",
        entityType: "recurring_version",
        entityId: versionId,
        metadata: {
          operation: "recurring_version_delete",
          seriesId,
          predecessorVersionId: predecessor?.id ?? null,
          successorVersionId: successor?.id ?? null,
          transactionCount: transactionIds.length,
          transferCount: transferIds.length,
          sourceReferenceCount,
        },
      });
      const [deletedVersion] = await tx.delete(recurringTransactions).where(and(
        eq(recurringTransactions.ownerId, ownerId),
        eq(recurringTransactions.seriesId, seriesId),
        eq(recurringTransactions.id, versionId),
      )).returning({ id: recurringTransactions.id });
      if (!deletedVersion) throw new Error("Recurring Cash Flow version could not be deleted.");
      await refreshCashFlowLinkedAccountProjections(tx, ownerId);
      return { seriesId, versionId, transactionCount: transactionIds.length, transferCount: transferIds.length, sourceReferenceCount };
    });
  };

  const updateRecurringSeriesVersion = async (
    ownerId: string,
    seriesId: string,
    versionId: string,
    input: RecurringCashFlowVersionEditInput,
  ): Promise<RecurringCashFlowSeriesView> => {
    assertRecurringWholeEditInput(input);
    const editedSchedule = {
      frequency: input.frequency,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      weekdayAdjustment: input.weekdayAdjustment ?? "none",
    };
    assertRecurringCashFlowOccurrence(editedSchedule, input.startsOn, "Version start date");
    if (input.endsOn) assertRecurringCashFlowOccurrence(editedSchedule, input.endsOn, "Version end date");

    const editedSeriesId = await db.transaction(async (tx) => {
      const context = await loadRecurringContext(tx, ownerId, seriesId);
      const target = context.versions.find((version) => version.id === versionId);
      if (!target) throw new Error("Recurring Cash Flow version not found.");
      if (context.series.kind !== input.kind || target.kind !== input.kind) throw new Error("The edited recurring version cannot change the recurring series kind.");
      await assertRecurringEndpoints(tx, ownerId, input);

      const todayIso = toTorontoDateIso();
      const schedules = partitionRecurringCashFlowVersions(context.versions.map(recurringVersionSchedule), seriesId);
      const current = selectRecurringCashFlowVersion(schedules, context.series.endedOn ?? todayIso);
      if (current?.id === versionId) throw new Error("The current recurring version must be changed with This and future.");
      const targetIndex = schedules.findIndex((version) => version.id === versionId);
      if (targetIndex < 0) throw new Error("Recurring Cash Flow version not found.");
      const predecessor = targetIndex > 0 ? schedules[targetIndex - 1]! : null;
      const successor = targetIndex < schedules.length - 1 ? schedules[targetIndex + 1]! : null;
      if (predecessor?.effectiveTo && input.startsOn <= predecessor.effectiveTo) throw new Error("The edited recurring version overlaps an adjacent history version.");
      if (successor && input.endsOn === null) throw new Error("A historical recurring version needs an ending occurrence before the next version.");
      if (successor && input.endsOn && input.endsOn >= successor.effectiveFrom) throw new Error("The edited recurring version overlaps an adjacent history version.");

      const [seriesTransactions, seriesTransfers] = await Promise.all([
        tx.select({
          id: transactions.id,
          recurringTransactionId: transactions.recurringTransactionId,
          scheduledOccurrenceOn: transactions.scheduledOccurrenceOn,
          transactionDate: transactions.transactionDate,
          status: transactions.status,
          isGenerated: transactions.isGenerated,
          isExcluded: transactions.isExcluded,
        }).from(transactions).where(and(
          eq(transactions.ownerId, ownerId),
          eq(transactions.recurringSeriesId, seriesId),
        )),
        tx.select({
          id: transfers.id,
          recurringTransactionId: transfers.recurringTransactionId,
          scheduledOccurrenceOn: transfers.scheduledOccurrenceOn,
          transferDate: transfers.transferDate,
          status: transfers.status,
          isGenerated: transfers.isGenerated,
        }).from(transfers).where(and(
          eq(transfers.ownerId, ownerId),
          eq(transfers.recurringSeriesId, seriesId),
        )),
      ]);
      const isWithinRange = (date: string | null, startsOn: string, endsOn: string | null): boolean => date !== null
        && date >= startsOn
        && (endsOn === null || date <= endsOn);
      const isWithinOldOrEditedRange = (date: string | null): boolean => isWithinRange(date, target.effectiveFrom, target.effectiveTo)
        || isWithinRange(date, input.startsOn, input.endsOn);
      const targetTransactions = seriesTransactions.filter((row) => row.recurringTransactionId === versionId || isWithinOldOrEditedRange(row.scheduledOccurrenceOn ?? row.transactionDate));
      const targetTransfers = seriesTransfers.filter((row) => row.recurringTransactionId === versionId || isWithinOldOrEditedRange(row.scheduledOccurrenceOn ?? row.transferDate));
      const protectedTransactions = targetTransactions.filter((row) => row.recurringTransactionId !== versionId
        || row.status !== "planned"
        || !row.isGenerated
        || row.isExcluded);
      const protectedTransfers = targetTransfers.filter((row) => row.recurringTransactionId !== versionId
        || row.status !== "planned"
        || !row.isGenerated);
      const activeExceptions = context.exceptions.filter((exception) => exception.versionId === versionId && exception.isActive);
      const protectedTransactionCount = protectedTransactions.length;
      const protectedTransferCount = protectedTransfers.length;
      const activeExceptionCount = activeExceptions.length;

      const nextOccurrenceOn = nextRecurringCashFlowOccurrence(editedSchedule, input.startsOn) ?? input.endsOn ?? input.startsOn;
      const [updatedVersion] = await tx.update(recurringTransactions).set({
        accountId: input.accountId,
        fromAccountId: input.fromAccountId ?? null,
        toAccountId: input.toAccountId ?? null,
        kind: input.kind,
        frequency: input.frequency,
        weekdayAdjustment: input.weekdayAdjustment ?? "none",
        description: input.name.trim(),
        amountMinor: input.amountMinor,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        effectiveFrom: input.startsOn,
        effectiveTo: input.endsOn,
        versionNote: input.note ?? null,
        countsAsExpense: normalizeCountsAsExpense(input),
        nextOccurrenceOn,
        updatedAt: new Date(),
      }).where(and(
        eq(recurringTransactions.ownerId, ownerId),
        eq(recurringTransactions.seriesId, seriesId),
        eq(recurringTransactions.id, versionId),
      )).returning({ id: recurringTransactions.id });
      if (!updatedVersion) throw new Error("Recurring Cash Flow version could not be updated.");

      const regenerationFrom = [target.effectiveFrom, input.startsOn].sort()[0]!;
      const regenerationThrough = target.effectiveTo === null || input.endsOn === null
        ? await recurringFutureThroughDate(tx, ownerId, seriesId, regenerationFrom, addRecurringCashFlowDays(todayIso, 365))
        : [target.effectiveTo, input.endsOn].sort().at(-1)!;
      const generation = await syncGeneratedRecurringOccurrences(tx, ownerId, seriesId, regenerationFrom, regenerationThrough, { preserveExistingRows: true });
      await tx.insert(auditEvents).values({
        ownerId,
        actorUserId: ownerId,
        action: "updated",
        entityType: "recurring_version",
        entityId: versionId,
        metadata: {
          operation: "recurring_version_edit",
          seriesId,
          predecessorVersionId: predecessor?.id ?? null,
          successorVersionId: successor?.id ?? null,
          previousEffectiveFrom: target.effectiveFrom,
          previousEffectiveTo: target.effectiveTo,
          effectiveFrom: input.startsOn,
          effectiveTo: input.endsOn,
          insertedCount: generation.insertedCount,
          updatedCount: generation.updatedCount,
          deletedCount: generation.deletedCount,
          preservedCount: generation.preservedCount,
          protectedTransactionCount,
          protectedTransferCount,
          activeExceptionCount,
          affectedTransactionIds: generation.affectedTransactionIds,
          affectedTransferIds: generation.affectedTransferIds,
        },
      });
      return seriesId;
    });
    return recurringSeriesView(await loadRecurringContext(db, ownerId, editedSeriesId), toTorontoDateIso());
  };

  const changeRecurringSeriesVersion = async (ownerId: string, input: RecurringCashFlowVersionInput & { readonly seriesId: string }): Promise<RecurringCashFlowSeriesView> => {
    assertRecurringSeriesInput(input, input.effectiveFrom);
    assertRecurringDate(input.previousEndsOn, "Previous schedule end date");
    if (input.previousEndsOn >= input.effectiveFrom) throw new Error("The old schedule must end before the new schedule starts.");
    const id = await db.transaction(async (tx) => {
      const context = await loadRecurringContext(tx, ownerId, input.seriesId);
      await assertRecurringEndpoints(tx, ownerId, input);
      const todayIso = toTorontoDateIso();
      const eligibleFutureOccurrence = addRecurringCashFlowDays(todayIso, 1);
      if (input.effectiveFrom < eligibleFutureOccurrence) {
        throw new Error("A new recurring version must begin on a future occurrence.");
      }
      if (context.series.state === "ended" && context.series.endedOn !== null && input.effectiveFrom > context.series.endedOn) {
        throw new Error("A new version cannot begin after the series ended.");
      }
      const schedules = context.versions.map(recurringVersionSchedule);
      partitionRecurringCashFlowVersions(schedules, input.seriesId);
      const prior = selectRecurringCashFlowVersion(schedules, input.previousEndsOn);
      if (!prior || prior.kind !== input.kind) throw new Error("The replacement version does not match the current recurring series.");
      if (!isRecurringCashFlowOccurrence(prior, input.previousEndsOn)) {
        throw new Error("The old schedule end date must be one of its scheduled occurrences.");
      }
      if (context.versions.some((version) => version.effectiveFrom === input.effectiveFrom)) throw new Error("A recurring version already begins on that occurrence.");
      if (context.versions.some((version) => version.id !== prior.id && version.effectiveFrom > input.previousEndsOn && version.effectiveFrom < input.effectiveFrom)) {
        throw new Error("Another recurring version already exists between the old and new schedules.");
      }
      const nextVersion = schedules.find((candidate) => candidate.effectiveFrom > input.effectiveFrom);
      const nextBoundary = nextVersion ? addRecurringCashFlowDays(nextVersion.effectiveFrom, -1) : null;
      const boundedEndsOn = nextBoundary && (!input.endsOn || input.endsOn > nextBoundary) ? nextBoundary : input.endsOn;
      if (boundedEndsOn && boundedEndsOn < input.nextOccurrenceOn) throw new Error("The replacement version ends before its next occurrence.");
      await tx.update(recurringTransactions).set({ effectiveTo: input.previousEndsOn, endsOn: input.previousEndsOn, updatedAt: new Date() })
        .where(and(eq(recurringTransactions.ownerId, ownerId), eq(recurringTransactions.id, prior.id)));
      const [replacement] = await tx.insert(recurringTransactions).values({
        ownerId,
        seriesId: input.seriesId,
        supersedesVersionId: prior.id,
        accountId: input.accountId,
        fromAccountId: input.fromAccountId ?? null,
        toAccountId: input.toAccountId ?? null,
        kind: input.kind,
        frequency: input.frequency,
        weekdayAdjustment: input.weekdayAdjustment ?? "none",
        description: input.name.trim(),
        amountMinor: input.amountMinor,
        currency: "CAD",
        startsOn: input.startsOn,
        endsOn: boundedEndsOn,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: nextBoundary ? boundedEndsOn : null,
        versionNote: input.versionNote ?? input.note ?? null,
        countsAsExpense: normalizeCountsAsExpense(input),
        nextOccurrenceOn: input.nextOccurrenceOn,
        status: "planned",
      }).returning({ id: recurringTransactions.id });
      if (!replacement) throw new Error("Recurring replacement version could not be created.");
      const obsoleteAfter = [todayIso, addRecurringCashFlowDays(input.previousEndsOn, 1)].sort().at(-1)!;
      const [obsoleteTransactions, obsoleteTransfers] = await Promise.all([
        tx.select({ id: transactions.id }).from(transactions).where(and(
          eq(transactions.ownerId, ownerId),
          eq(transactions.recurringSeriesId, input.seriesId),
          eq(transactions.recurringTransactionId, prior.id),
          eq(transactions.status, "planned"),
          eq(transactions.isGenerated, false),
          gte(transactions.transactionDate, obsoleteAfter),
        )),
        tx.select({ id: transfers.id }).from(transfers).where(and(
          eq(transfers.ownerId, ownerId),
          eq(transfers.recurringSeriesId, input.seriesId),
          eq(transfers.recurringTransactionId, prior.id),
          eq(transfers.status, "planned"),
          eq(transfers.isGenerated, false),
          gte(transfers.transferDate, obsoleteAfter),
        )),
      ]);
      const removed = await removePlannedRecurringRecords(tx, ownerId, obsoleteTransactions.map((row) => row.id), obsoleteTransfers.map((row) => row.id));
      const fromDate = addRecurringCashFlowDays(toTorontoDateIso(), 1);
      const throughDate = await recurringFutureThroughDate(tx, ownerId, input.seriesId, fromDate, boundedEndsOn);
      const generation = await syncGeneratedRecurringOccurrences(tx, ownerId, input.seriesId, fromDate, throughDate);
      await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "created", entityType: "recurring_version", entityId: replacement.id, metadata: { operation: "recurring_version_change", seriesId: input.seriesId, supersedesVersionId: prior.id, previousEndsOn: input.previousEndsOn, effectiveFrom: input.effectiveFrom, removedImportedTransactionIds: removed.transactionIds, removedImportedTransferIds: removed.transferIds, removedSourceReferenceCount: removed.sourceReferenceCount, insertedCount: generation.insertedCount, updatedCount: generation.updatedCount, deletedCount: generation.deletedCount, preservedCount: generation.preservedCount, affectedTransactionIds: generation.affectedTransactionIds, affectedTransferIds: generation.affectedTransferIds } });
      return input.seriesId;
    });
    return recurringSeriesView(await loadRecurringContext(db, ownerId, id), toTorontoDateIso());
  };

  const renameRecurringSeries = async (ownerId: string, seriesId: string, name: string): Promise<{
    readonly seriesId: string;
    readonly oldNames: readonly string[];
    readonly newName: string;
    readonly versionIds: readonly string[];
    readonly transactionIds: readonly string[];
    readonly transferIds: readonly string[];
  }> => {
    const newName = assertRecurringSeriesName(name);
    return db.transaction(async (tx) => {
      const [series] = await tx.select({ id: recurringCashFlowSeries.id })
        .from(recurringCashFlowSeries)
        .where(and(eq(recurringCashFlowSeries.ownerId, ownerId), eq(recurringCashFlowSeries.id, seriesId)))
        .limit(1);
      if (!series) throw new Error("Recurring Cash Flow series not found.");

      const versionRows = await tx.select({ id: recurringTransactions.id, description: recurringTransactions.description })
        .from(recurringTransactions)
        .where(and(eq(recurringTransactions.ownerId, ownerId), eq(recurringTransactions.seriesId, seriesId)))
        .orderBy(asc(recurringTransactions.effectiveFrom), asc(recurringTransactions.id));
      const oldNames = [...new Set(versionRows.map((row) => row.description))];

      const updatedVersions = await tx.update(recurringTransactions)
        .set({ description: newName, updatedAt: new Date() })
        .where(and(eq(recurringTransactions.ownerId, ownerId), eq(recurringTransactions.seriesId, seriesId)))
        .returning({ id: recurringTransactions.id });
      const updatedTransactions = await tx.update(transactions)
        .set({ description: newName, updatedAt: new Date() })
        .where(and(eq(transactions.ownerId, ownerId), eq(transactions.recurringSeriesId, seriesId)))
        .returning({ id: transactions.id });
      const updatedTransfers = await tx.update(transfers)
        .set({ description: newName, updatedAt: new Date() })
        .where(and(eq(transfers.ownerId, ownerId), eq(transfers.recurringSeriesId, seriesId)))
        .returning({ id: transfers.id });

      await tx.insert(auditEvents).values({
        ownerId,
        actorUserId: ownerId,
        action: "updated",
        entityType: "recurring_series",
        entityId: seriesId,
        metadata: {
          operation: "recurring_series_rename",
          oldNames,
          newName,
          affectedVersionCount: updatedVersions.length,
          affectedVersionIds: updatedVersions.map((row) => row.id),
          affectedTransactionCount: updatedTransactions.length,
          affectedTransactionIds: updatedTransactions.map((row) => row.id),
          affectedTransferCount: updatedTransfers.length,
          affectedTransferIds: updatedTransfers.map((row) => row.id),
        },
      });

      return {
        seriesId,
        oldNames,
        newName,
        versionIds: updatedVersions.map((row) => row.id),
        transactionIds: updatedTransactions.map((row) => row.id),
        transferIds: updatedTransfers.map((row) => row.id),
      };
    });
  };

  const updateRecurringSeriesEntirely = async (ownerId: string, seriesId: string, input: RecurringCashFlowWholeEditInput): Promise<RecurringCashFlowSeriesView> => {
    assertRecurringWholeEditInput(input);
    const id = await db.transaction(async (tx) => {
      const context = await loadRecurringContext(tx, ownerId, seriesId);
      await assertRecurringEndpoints(tx, ownerId, input);
      if (context.series.kind !== input.kind) throw new Error("An entire series edit cannot change the recurring series kind.");
      const todayIso = toTorontoDateIso();
      const activeExceptions = context.exceptions.filter((exception) => exception.isActive);
      if (context.series.state === "ended" || activeExceptions.length > 0 || context.versions.length !== 1) throw new Error("Entire series edits are unavailable after occurrence overrides or version history exists; use This and future.");
      const schedules = context.versions.map(recurringVersionSchedule);
      const current = selectRecurringCashFlowVersion(schedules, todayIso) ?? schedules.at(-1);
      if (!current) throw new Error("Recurring Cash Flow series has no version.");
      const currentOpenPeriod = await currentOpenCashFlowPaydayWindow(tx, ownerId, todayIso);
      const schedule = { frequency: input.frequency, startsOn: input.startsOn, endsOn: input.endsOn, weekdayAdjustment: input.weekdayAdjustment ?? "none" };
      const firstOccurrenceOn = nextRecurringCashFlowOccurrence(schedule, addRecurringCashFlowDays(input.startsOn, -2));
      const firstEditedOccurrenceInCurrentPeriod = nextRecurringCashFlowOccurrence(schedule, currentOpenPeriod.startsOn);
      const currentPeriodOccurrence = firstEditedOccurrenceInCurrentPeriod && firstEditedOccurrenceInCurrentPeriod <= currentOpenPeriod.endsOn
        ? firstEditedOccurrenceInCurrentPeriod
        : null;
      const earliestExistingOccurrence = await earliestRewritableRecurringOccurrence(tx, ownerId, seriesId, input.kind, currentOpenPeriod.startsOn);
      const effectiveFrom = currentPeriodOccurrence
        ?? nextRecurringCashFlowOccurrence(schedule, earliestExistingOccurrence ?? currentOpenPeriod.startsOn)
        ?? firstOccurrenceOn;
      if (!effectiveFrom) throw new Error("Recurring schedule has no occurrence for the edited series.");
      const regenerationBoundary = earliestExistingOccurrence && earliestExistingOccurrence < effectiveFrom
        ? earliestExistingOccurrence
        : effectiveFrom;
      await tx.update(recurringTransactions).set({
        accountId: input.accountId,
        fromAccountId: input.fromAccountId ?? null,
        toAccountId: input.toAccountId ?? null,
        kind: input.kind,
        frequency: input.frequency,
        weekdayAdjustment: input.weekdayAdjustment ?? "none",
        description: input.name.trim(),
        amountMinor: input.amountMinor,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        effectiveFrom,
        effectiveTo: null,
        versionNote: input.note ?? null,
        countsAsExpense: normalizeCountsAsExpense(input),
        nextOccurrenceOn: effectiveFrom,
        updatedAt: new Date(),
      }).where(and(eq(recurringTransactions.ownerId, ownerId), eq(recurringTransactions.id, current.id), eq(recurringTransactions.seriesId, seriesId)));
      let movedTransactionCount = 0;
      let movedTransferCount = 0;
      if (input.kind === "transfer") {
        const movedTransfers = await tx.update(transfers).set({ fromAccountId: input.fromAccountId!, toAccountId: input.toAccountId!, updatedAt: new Date() })
          .where(and(eq(transfers.ownerId, ownerId), eq(transfers.recurringSeriesId, seriesId)))
          .returning({ id: transfers.id });
        movedTransferCount = movedTransfers.length;
      } else {
        const movedTransactions = await tx.update(transactions).set({ accountId: input.accountId, updatedAt: new Date() })
          .where(and(eq(transactions.ownerId, ownerId), eq(transactions.recurringSeriesId, seriesId)))
          .returning({ id: transactions.id });
        movedTransactionCount = movedTransactions.length;
      }
      // Reconcile from the current open period so an edited series can repair
      // the current-period generated row and remove obsolete generated rows
      // before a newly selected future start date.
      const throughDate = await recurringFutureThroughDate(tx, ownerId, seriesId, regenerationBoundary, input.endsOn ?? addRecurringCashFlowDays(todayIso, 365));
      const generation = await syncGeneratedRecurringOccurrences(tx, ownerId, seriesId, regenerationBoundary, throughDate, { preserveExistingRows: true, repairableGeneratedActualRange: currentOpenPeriod });
      await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "updated", entityType: "recurring_series", entityId: seriesId, metadata: { operation: "recurring_series_entire_edit", regenerationBoundary, effectiveFrom, movedTransactionCount, movedTransferCount, preservedRows: generation.preservedCount, activeExceptions: 0, insertedCount: generation.insertedCount, updatedCount: generation.updatedCount, deletedCount: generation.deletedCount, preservedCount: generation.preservedCount, affectedTransactionIds: generation.affectedTransactionIds, affectedTransferIds: generation.affectedTransferIds } });
      return seriesId;
    });
    return recurringSeriesView(await loadRecurringContext(db, ownerId, id), toTorontoDateIso());
  };

  const listHomeHouseholdCashFlowLinks = async (ownerId: string): Promise<readonly HomeHouseholdCashFlowLinkView[]> => {
    const asOfIso = toTorontoDateIso();
    const seriesRows = await db.select().from(recurringCashFlowSeries)
      .where(and(
        eq(recurringCashFlowSeries.ownerId, ownerId),
        or(eq(recurringCashFlowSeries.homeHouseholdFrequency, "biweekly"), eq(recurringCashFlowSeries.homeHouseholdFrequency, "monthly")),
      ))
      .orderBy(asc(recurringCashFlowSeries.homeHouseholdFrequency), asc(recurringCashFlowSeries.id));
    const contexts = await loadRecurringContexts(db, ownerId, seriesRows);
    const views: HomeHouseholdCashFlowLinkView[] = [];
    for (const series of seriesRows) {
      if (series.homeHouseholdFrequency !== "biweekly" && series.homeHouseholdFrequency !== "monthly") continue;
      const view = recurringSeriesView(contexts.get(series.id)!, asOfIso);
      const version = view.versions.find((candidate) => candidate.isCurrent) ?? view.versions.at(-1);
      if (!version) continue;
      views.push({
        frequency: series.homeHouseholdFrequency,
        seriesId: series.id,
        seriesState: series.state,
        name: version.name,
        kind: version.kind,
        amountMinor: version.amountMinor,
        scheduleFrequency: version.frequency,
        countsAsExpense: version.countsAsExpense === true,
        nextOccurrenceOn: view.nextOccurrenceOn,
      });
    }
    return views;
  };

  const updateHomeHouseholdCashFlowAmount = async (
    ownerId: string,
    frequency: HomeHouseholdFrequency,
    amountMinor: number,
  ): Promise<HomeHouseholdCashFlowLinkView> => {
    assertRecurringMinorUnits(amountMinor, "Home household Cash Flow amount");
    if (frequency !== "biweekly" && frequency !== "monthly") throw new Error("Home household frequency is invalid.");
    const seriesId = await db.transaction(async (tx) => {
      const [series] = await tx.select().from(recurringCashFlowSeries)
        .where(and(eq(recurringCashFlowSeries.ownerId, ownerId), eq(recurringCashFlowSeries.homeHouseholdFrequency, frequency)))
        .limit(1);
      if (!series) throw new Error("No Cash Flow series is linked to this Home household total.");
      if (series.state === "ended") throw new Error("The linked Cash Flow series has ended; create a new link instead.");
      const context = await loadRecurringContext(tx, ownerId, series.id);
      const todayIso = toTorontoDateIso();
      const schedules = context.versions.map(recurringVersionSchedule);
      const current = selectRecurringCashFlowVersion(schedules, todayIso) ?? schedules.at(-1);
      if (!current) throw new Error("Linked Cash Flow series has no version.");
      // Update current and any future versions so planned/future occurrences pick up the home total.
      const versionIds = context.versions
        .filter((version) => version.id === current.id || version.effectiveFrom >= current.effectiveFrom)
        .map((version) => version.id);
      const updated = await tx.update(recurringTransactions).set({
        amountMinor,
        updatedAt: new Date(),
      }).where(and(
        eq(recurringTransactions.ownerId, ownerId),
        eq(recurringTransactions.seriesId, series.id),
        inArray(recurringTransactions.id, versionIds),
      )).returning({ id: recurringTransactions.id });
      if (updated.length === 0) throw new Error("Linked Cash Flow series amount could not be updated.");
      const fromDate = await currentOpenCashFlowPaydayStart(tx, ownerId, todayIso);
      const throughDate = await recurringFutureThroughDate(tx, ownerId, series.id, fromDate, addRecurringCashFlowDays(todayIso, 365));
      const generation = await syncGeneratedRecurringOccurrences(tx, ownerId, series.id, fromDate, throughDate, { preserveExistingRows: true });
      await tx.insert(auditEvents).values({
        ownerId,
        actorUserId: ownerId,
        action: "updated",
        entityType: "recurring_series",
        entityId: series.id,
        metadata: {
          operation: "home_household_cash_flow_amount_sync",
          frequency,
          amountMinor,
          versionIds: updated.map((row) => row.id),
          insertedCount: generation.insertedCount,
          updatedCount: generation.updatedCount,
          deletedCount: generation.deletedCount,
          preservedCount: generation.preservedCount,
          affectedTransactionIds: generation.affectedTransactionIds,
          affectedTransferIds: generation.affectedTransferIds,
        },
      });
      return series.id;
    });
    const links = await listHomeHouseholdCashFlowLinks(ownerId);
    const link = links.find((entry) => entry.seriesId === seriesId);
    if (!link) throw new Error("Linked Cash Flow series could not be reloaded.");
    return link;
  };

  const setRecurringTransferCountsAsExpense = async (
    ownerId: string,
    seriesId: string,
    countsAsExpense: boolean,
  ): Promise<RecurringCashFlowSeriesView> => {
    const id = await db.transaction(async (tx) => {
      const context = await loadRecurringContext(tx, ownerId, seriesId);
      if (context.series.kind !== "transfer") throw new Error("Only recurring transfers can count as expense.");
      const updated = await tx.update(recurringTransactions).set({
        countsAsExpense: countsAsExpense === true,
        updatedAt: new Date(),
      }).where(and(
        eq(recurringTransactions.ownerId, ownerId),
        eq(recurringTransactions.seriesId, seriesId),
        eq(recurringTransactions.kind, "transfer"),
      )).returning({ id: recurringTransactions.id });
      if (updated.length === 0) throw new Error("Recurring transfer series versions could not be updated.");
      await tx.insert(auditEvents).values({
        ownerId,
        actorUserId: ownerId,
        action: "updated",
        entityType: "recurring_series",
        entityId: seriesId,
        metadata: {
          operation: "recurring_transfer_counts_as_expense",
          countsAsExpense: countsAsExpense === true,
          versionIds: updated.map((row) => row.id),
          versionCount: updated.length,
        },
      });
      return seriesId;
    });
    return recurringSeriesView(await loadRecurringContext(db, ownerId, id), toTorontoDateIso());
  };

  const generateRecurringOccurrences = async (ownerId: string, seriesId: string, input: RecurringCashFlowGenerationInput): Promise<RecurringCashFlowGenerationResult> => {
    const result = await db.transaction(async (tx) => {
      const context = await loadRecurringContext(tx, ownerId, seriesId);
      const todayIso = toTorontoDateIso();
      const currentOpenPeriod = await currentOpenCashFlowPaydayWindow(tx, ownerId, todayIso);
      let reanchoredVersionId: string | null = null;
      let reanchoredEffectiveFrom: string | null = null;
      if (context.series.state === "active" && context.versions.length === 1) {
        const version = context.versions[0]!;
        const schedule = recurringVersionSchedule(version);
        const firstOccurrenceInCurrentPeriod = nextRecurringCashFlowOccurrence(schedule, currentOpenPeriod.startsOn);
        if (version.effectiveTo === null
          && firstOccurrenceInCurrentPeriod
          && firstOccurrenceInCurrentPeriod <= currentOpenPeriod.endsOn
          && firstOccurrenceInCurrentPeriod < version.effectiveFrom) {
          const [reanchoredVersion] = await tx.update(recurringTransactions).set({
            effectiveFrom: firstOccurrenceInCurrentPeriod,
            nextOccurrenceOn: firstOccurrenceInCurrentPeriod,
            updatedAt: new Date(),
          }).where(and(
            eq(recurringTransactions.ownerId, ownerId),
            eq(recurringTransactions.id, version.id),
            eq(recurringTransactions.seriesId, seriesId),
            eq(recurringTransactions.effectiveFrom, version.effectiveFrom),
          )).returning({ id: recurringTransactions.id });
          if (reanchoredVersion) {
            reanchoredVersionId = reanchoredVersion.id;
            reanchoredEffectiveFrom = firstOccurrenceInCurrentPeriod;
          }
        }
      }
      const requestedFromDate = input.fromDate ?? context.versions.map((version) => version.startsOn).sort()[0]!;
      const fromDate = [requestedFromDate, currentOpenPeriod.startsOn].sort().at(-1)!;
      const generation = await syncGeneratedRecurringOccurrences(tx, ownerId, seriesId, fromDate, input.throughDate, { preserveExistingRows: true, repairableGeneratedActualRange: currentOpenPeriod });
      await tx.insert(auditEvents).values({
        ownerId,
        actorUserId: ownerId,
        action: "updated",
        entityType: "recurring_series",
        entityId: seriesId,
        metadata: {
          operation: "recurring_occurrence_generation",
          throughDate: input.throughDate,
          fromDate,
          reanchoredVersionId,
          reanchoredEffectiveFrom,
          insertedCount: generation.insertedCount,
          updatedCount: generation.updatedCount,
          deletedCount: generation.deletedCount,
          skippedCount: generation.skippedCount,
          preservedCount: generation.preservedCount,
          affectedTransactionIds: generation.affectedTransactionIds,
        },
      });
      return generation;
    });
    return result;
  };

  const recurringExceptionOccurrences = async (
    tx: TransactionDatabase,
    ownerId: string,
    input: RecurringCashFlowOccurrenceExceptionInput,
  ): Promise<{ readonly context: Awaited<ReturnType<typeof loadRecurringContext>>; readonly occurrences: readonly RecurringCashFlowOccurrence[] }> => {
    assertRecurringDate(input.scheduledOccurrenceOn, "Occurrence date");
    const endingOccurrenceOn = input.scope === "selected_range" ? input.endingOccurrenceOn : input.scheduledOccurrenceOn;
    if (!endingOccurrenceOn) throw new Error("Choose the ending occurrence for the selected range.");
    assertRecurringDate(endingOccurrenceOn, "Ending occurrence date");
    if (endingOccurrenceOn < input.scheduledOccurrenceOn) throw new Error("The ending occurrence must be on or after the selected occurrence.");
    if (input.scope === "selected_range" && input.dateOverride) throw new Error("A selected range cannot move occurrences to different dates.");
    if (input.kind === "skip" && (input.dateOverride || input.amountOverrideMinor !== null && input.amountOverrideMinor !== undefined || input.accountOverrideId || input.fromAccountOverrideId || input.toAccountOverrideId || input.statusOverride)) {
      throw new Error("Skipped occurrences cannot include value overrides.");
    }
    if (input.kind === "override" && !input.dateOverride && input.amountOverrideMinor === null && input.amountOverrideMinor === undefined && !input.accountOverrideId && !input.fromAccountOverrideId && !input.toAccountOverrideId && !input.statusOverride) {
      throw new Error("Choose at least one occurrence override.");
    }
    if (input.dateOverride) assertRecurringDate(input.dateOverride, "Override date");
    if (input.amountOverrideMinor !== null && input.amountOverrideMinor !== undefined) assertRecurringMinorUnits(input.amountOverrideMinor, "Override amount");
    await assertRecurringAccount(tx, ownerId, input.accountOverrideId ?? null);
    if ((input.fromAccountOverrideId ?? null) !== null || (input.toAccountOverrideId ?? null) !== null) {
      await assertRecurringEndpoints(tx, ownerId, { kind: "transfer", accountId: null, fromAccountId: input.fromAccountOverrideId ?? null, toAccountId: input.toAccountOverrideId ?? null });
    }
    const context = await loadRecurringContext(tx, ownerId, input.seriesId);
    const schedules = context.versions.map(recurringVersionSchedule);
    const occurrences = expandRecurringCashFlowOccurrences(input.seriesId, schedules, [], input.scheduledOccurrenceOn, endingOccurrenceOn)
      .filter((occurrence) => occurrence.scheduledOccurrenceOn >= input.scheduledOccurrenceOn && occurrence.scheduledOccurrenceOn <= endingOccurrenceOn);
    if (occurrences.length === 0 || occurrences.at(-1)?.scheduledOccurrenceOn !== endingOccurrenceOn) throw new Error("Choose a scheduled occurrence range.");
    if (occurrences.some((occurrence) => occurrence.versionId !== input.versionId || occurrence.isSkipped || occurrence.status !== "planned")) {
      throw new Error("Only consecutive planned occurrences from one version can be changed.");
    }
    if (input.transactionId) {
      const firstOccurrence = occurrences[0]!;
      if (firstOccurrence.kind === "transfer") throw new Error("Recurring occurrence transaction not found.");
      const [transaction] = await tx.select({ id: transactions.id }).from(transactions).where(and(
        eq(transactions.ownerId, ownerId),
        eq(transactions.id, input.transactionId),
        eq(transactions.recurringSeriesId, input.seriesId),
        eq(transactions.scheduledOccurrenceOn, firstOccurrence.scheduledOccurrenceOn),
        eq(transactions.isGenerated, true),
        eq(transactions.status, "planned"),
        eq(transactions.isExcluded, false),
      )).limit(1);
      if (!transaction) throw new Error("Recurring occurrence transaction not found.");
    }
    if (input.transferId) {
      const firstOccurrence = occurrences[0]!;
      if (firstOccurrence.kind !== "transfer") throw new Error("Recurring occurrence transfer not found.");
      const [transfer] = await tx.select({ id: transfers.id }).from(transfers).where(and(
        eq(transfers.ownerId, ownerId),
        eq(transfers.id, input.transferId),
        eq(transfers.recurringSeriesId, input.seriesId),
        eq(transfers.scheduledOccurrenceOn, firstOccurrence.scheduledOccurrenceOn),
        eq(transfers.isGenerated, true),
        eq(transfers.status, "planned"),
      )).limit(1);
      if (!transfer) throw new Error("Recurring occurrence transfer not found.");
    }
    for (const occurrence of occurrences) {
      if (occurrence.kind === "transfer") {
        const rows = await tx.select({ status: transfers.status, isGenerated: transfers.isGenerated })
          .from(transfers)
          .where(and(eq(transfers.ownerId, ownerId), eq(transfers.recurringSeriesId, input.seriesId), eq(transfers.scheduledOccurrenceOn, occurrence.scheduledOccurrenceOn)));
        if (rows.some((row) => row.status === "actual" || !row.isGenerated)) throw new Error("Actual, manual, or excluded occurrences cannot be changed.");
      } else {
        const rows = await tx.select({ status: transactions.status, isGenerated: transactions.isGenerated, isExcluded: transactions.isExcluded })
          .from(transactions)
          .where(and(eq(transactions.ownerId, ownerId), eq(transactions.recurringSeriesId, input.seriesId), eq(transactions.scheduledOccurrenceOn, occurrence.scheduledOccurrenceOn)));
        if (rows.some((row) => row.status === "actual" || !row.isGenerated || row.isExcluded)) throw new Error("Actual, manual, or excluded occurrences cannot be changed.");
      }
    }
    return { context, occurrences };
  };

  const applyRecurringOccurrenceException = async (ownerId: string, input: RecurringCashFlowOccurrenceExceptionInput): Promise<RecurringCashFlowExceptionResult> => {
    const result = await db.transaction(async (tx) => {
      const { occurrences } = await recurringExceptionOccurrences(tx, ownerId, input);
      const endingOccurrenceOn = occurrences.at(-1)!.scheduledOccurrenceOn;
      let overrideGroupId: string | null = null;
      if (input.scope === "selected_range") {
        const [group] = await tx.insert(recurringCashFlowOverrideGroups).values({ ownerId, seriesId: input.seriesId, versionId: input.versionId, note: input.note ?? null, isActive: true }).returning({ id: recurringCashFlowOverrideGroups.id });
        if (!group) throw new Error("Recurring override group could not be created.");
        overrideGroupId = group.id;
      }
      const existing = await tx.select({ id: recurringCashFlowOccurrenceExceptions.id, overrideGroupId: recurringCashFlowOccurrenceExceptions.overrideGroupId })
        .from(recurringCashFlowOccurrenceExceptions)
        .where(and(eq(recurringCashFlowOccurrenceExceptions.ownerId, ownerId), eq(recurringCashFlowOccurrenceExceptions.seriesId, input.seriesId), eq(recurringCashFlowOccurrenceExceptions.isActive, true), gte(recurringCashFlowOccurrenceExceptions.scheduledOccurrenceOn, input.scheduledOccurrenceOn), lte(recurringCashFlowOccurrenceExceptions.scheduledOccurrenceOn, endingOccurrenceOn)));
      for (const oldException of existing) {
        await tx.update(recurringCashFlowOccurrenceExceptions).set({ isActive: false, transactionId: null, transferId: null, updatedAt: new Date() })
          .where(and(eq(recurringCashFlowOccurrenceExceptions.ownerId, ownerId), eq(recurringCashFlowOccurrenceExceptions.id, oldException.id), eq(recurringCashFlowOccurrenceExceptions.isActive, true)));
      }
      const exceptionIds: string[] = [];
      for (const occurrence of occurrences) {
        const [exception] = await tx.insert(recurringCashFlowOccurrenceExceptions).values({
          ownerId,
          seriesId: input.seriesId,
          versionId: input.versionId,
          transactionId: null,
          transferId: null,
          scheduledOccurrenceOn: occurrence.scheduledOccurrenceOn,
          overrideGroupId,
          kind: input.kind,
          dateOverride: input.scope === "only_this_occurrence" ? input.dateOverride ?? null : null,
          amountOverrideMinor: input.kind === "override" ? input.amountOverrideMinor ?? null : null,
          accountOverrideId: input.kind === "override" ? input.accountOverrideId ?? null : null,
          fromAccountOverrideId: input.kind === "override" ? input.fromAccountOverrideId ?? null : null,
          toAccountOverrideId: input.kind === "override" ? input.toAccountOverrideId ?? null : null,
          statusOverride: input.kind === "override" ? input.statusOverride ?? null : null,
          note: input.note ?? null,
          isActive: true,
        }).returning({ id: recurringCashFlowOccurrenceExceptions.id });
        if (!exception) throw new Error("Recurring occurrence exception could not be created.");
        exceptionIds.push(exception.id);
      }
      const generation = await syncGeneratedRecurringOccurrences(tx, ownerId, input.seriesId, input.scheduledOccurrenceOn, endingOccurrenceOn, { ignoreSeriesState: true });
      // TASK-030: exception targets are applied with one prefetch per table and chunked
      // set-based UPDATEs instead of a SELECT/UPDATE pair per exception. The inserted
      // exceptions are zipped with `occurrences` by index — the loop above inserted one
      // exception per occurrence in order, which is what the previous `find` on
      // `scheduledOccurrenceOn` resolved to.
      await applyRecurringExceptionTargets(
        tx,
        ownerId,
        input.seriesId,
        occurrences.map((occurrence, index) => ({
          exceptionId: exceptionIds[index]!,
          scheduledOccurrenceOn: occurrence.scheduledOccurrenceOn,
          exceptionKind: input.kind,
          occurrenceKind: occurrence.kind,
        })),
      );
      await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "created", entityType: "recurring_exception", entityId: exceptionIds[0] ?? null, metadata: { operation: "recurring_occurrence_exception", seriesId: input.seriesId, exceptionIds, overrideGroupId, scope: input.scope, occurrenceCount: exceptionIds.length, affectedTransactionIds: generation.affectedTransactionIds } });
      if (overrideGroupId) await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "created", entityType: "recurring_override_group", entityId: overrideGroupId, metadata: { operation: "recurring_override_group_create", seriesId: input.seriesId, exceptionIds } });
      return { seriesId: input.seriesId, exceptionIds, overrideGroupId, generation };
    });
    return result;
  };

  const updateRecurringOverrideGroup = async (ownerId: string, overrideGroupId: string, input: RecurringCashFlowOverrideGroupUpdateInput): Promise<RecurringCashFlowExceptionResult> => {
    if (input.dateOverride) throw new Error("A range override cannot move occurrences to different dates.");
    if (input.kind === "skip" && (input.amountOverrideMinor !== null && input.amountOverrideMinor !== undefined || input.accountOverrideId || input.fromAccountOverrideId || input.toAccountOverrideId || input.statusOverride)) throw new Error("Skipped occurrences cannot include value overrides.");
    if (input.kind === "override" && input.amountOverrideMinor !== null && input.amountOverrideMinor !== undefined) assertRecurringMinorUnits(input.amountOverrideMinor, "Override amount");
    const result = await db.transaction(async (tx) => {
      const [group] = await tx.select().from(recurringCashFlowOverrideGroups).where(and(eq(recurringCashFlowOverrideGroups.ownerId, ownerId), eq(recurringCashFlowOverrideGroups.id, overrideGroupId), eq(recurringCashFlowOverrideGroups.isActive, true))).limit(1);
      if (!group) throw new Error("Recurring override group not found.");
      await assertRecurringAccount(tx, ownerId, input.accountOverrideId ?? null);
      if ((input.fromAccountOverrideId ?? null) !== null || (input.toAccountOverrideId ?? null) !== null) await assertRecurringEndpoints(tx, ownerId, { kind: "transfer", accountId: null, fromAccountId: input.fromAccountOverrideId ?? null, toAccountId: input.toAccountOverrideId ?? null });
      const groupContext = await loadRecurringContext(tx, ownerId, group.seriesId);
      const exceptions = await tx.select().from(recurringCashFlowOccurrenceExceptions).where(and(eq(recurringCashFlowOccurrenceExceptions.ownerId, ownerId), eq(recurringCashFlowOccurrenceExceptions.overrideGroupId, overrideGroupId), eq(recurringCashFlowOccurrenceExceptions.isActive, true))).orderBy(asc(recurringCashFlowOccurrenceExceptions.scheduledOccurrenceOn));
      if (exceptions.length === 0) throw new Error("Recurring override group has no active occurrences.");
      await tx.update(recurringCashFlowOverrideGroups).set({ note: input.note ?? null, updatedAt: new Date() }).where(and(eq(recurringCashFlowOverrideGroups.ownerId, ownerId), eq(recurringCashFlowOverrideGroups.id, overrideGroupId), eq(recurringCashFlowOverrideGroups.isActive, true)));
      await tx.update(recurringCashFlowOccurrenceExceptions).set({ kind: input.kind, dateOverride: null, amountOverrideMinor: input.kind === "override" ? input.amountOverrideMinor ?? null : null, accountOverrideId: input.kind === "override" ? input.accountOverrideId ?? null : null, fromAccountOverrideId: input.kind === "override" ? input.fromAccountOverrideId ?? null : null, toAccountOverrideId: input.kind === "override" ? input.toAccountOverrideId ?? null : null, statusOverride: input.kind === "override" ? input.statusOverride ?? null : null, note: input.note ?? null, transactionId: null, transferId: null, updatedAt: new Date() }).where(and(eq(recurringCashFlowOccurrenceExceptions.ownerId, ownerId), eq(recurringCashFlowOccurrenceExceptions.overrideGroupId, overrideGroupId), eq(recurringCashFlowOccurrenceExceptions.isActive, true)));
      const first = exceptions[0]!.scheduledOccurrenceOn;
      const last = exceptions.at(-1)!.scheduledOccurrenceOn;
      const generation = await syncGeneratedRecurringOccurrences(tx, ownerId, group.seriesId, first, last, { ignoreSeriesState: true });
      const exceptionIds = exceptions.map((exception) => exception.id);
      // TASK-030: same set-based exception target application as applyRecurringOccurrenceException.
      await applyRecurringExceptionTargets(
        tx,
        ownerId,
        group.seriesId,
        exceptions.map((exception) => ({
          exceptionId: exception.id,
          scheduledOccurrenceOn: exception.scheduledOccurrenceOn,
          exceptionKind: input.kind,
          occurrenceKind: groupContext.series.kind,
        })),
      );
      await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "updated", entityType: "recurring_override_group", entityId: overrideGroupId, metadata: { operation: "recurring_override_group_edit", seriesId: group.seriesId, exceptionIds, affectedTransactionIds: generation.affectedTransactionIds } });
      return { seriesId: group.seriesId, exceptionIds, overrideGroupId, generation };
    });
    return result;
  };

  const restoreRecurringOccurrence = async (ownerId: string, input: RecurringCashFlowRestoreInput): Promise<RecurringCashFlowGenerationResult> => {
    if (input.scope === "group") {
      if (!input.overrideGroupId) throw new Error("Choose an override group to restore.");
      return db.transaction(async (tx) => {
        const [group] = await tx.select().from(recurringCashFlowOverrideGroups).where(and(eq(recurringCashFlowOverrideGroups.ownerId, ownerId), eq(recurringCashFlowOverrideGroups.id, input.overrideGroupId!))).limit(1);
        if (!group) throw new Error("Recurring override group not found.");
        const exceptions = await tx.select().from(recurringCashFlowOccurrenceExceptions).where(and(eq(recurringCashFlowOccurrenceExceptions.ownerId, ownerId), eq(recurringCashFlowOccurrenceExceptions.overrideGroupId, group.id), eq(recurringCashFlowOccurrenceExceptions.isActive, true))).orderBy(asc(recurringCashFlowOccurrenceExceptions.scheduledOccurrenceOn));
        if (exceptions.length === 0) throw new Error("Recurring override group has no active occurrences.");
        await tx.update(recurringCashFlowOccurrenceExceptions).set({ isActive: false, transactionId: null, transferId: null, updatedAt: new Date() }).where(and(eq(recurringCashFlowOccurrenceExceptions.ownerId, ownerId), eq(recurringCashFlowOccurrenceExceptions.overrideGroupId, group.id), eq(recurringCashFlowOccurrenceExceptions.isActive, true)));
        await tx.update(recurringCashFlowOverrideGroups).set({ isActive: false, updatedAt: new Date() }).where(and(eq(recurringCashFlowOverrideGroups.ownerId, ownerId), eq(recurringCashFlowOverrideGroups.id, group.id)));
        const generation = await syncGeneratedRecurringOccurrences(tx, ownerId, group.seriesId, exceptions[0]!.scheduledOccurrenceOn, exceptions.at(-1)!.scheduledOccurrenceOn, { ignoreSeriesState: true });
        await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "updated", entityType: "recurring_override_group", entityId: group.id, metadata: { operation: "recurring_override_group_restore", seriesId: group.seriesId, exceptionIds: exceptions.map((exception) => exception.id), affectedTransactionIds: generation.affectedTransactionIds, affectedTransferIds: generation.affectedTransferIds } });
        return generation;
      });
    }
    if (!input.occurrenceId) throw new Error("Choose an occurrence to restore.");
    const occurrenceId = input.occurrenceId;
    return db.transaction(async (tx) => {
      const [transaction] = await tx.select({ id: transactions.id, scheduledOccurrenceOn: transactions.scheduledOccurrenceOn }).from(transactions).where(and(eq(transactions.ownerId, ownerId), eq(transactions.recurringSeriesId, input.seriesId), or(eq(transactions.recurringOccurrenceId, occurrenceId), eq(transactions.id, occurrenceId)))).limit(1);
      const [transfer] = await tx.select({ id: transfers.id, scheduledOccurrenceOn: transfers.scheduledOccurrenceOn }).from(transfers).where(and(eq(transfers.ownerId, ownerId), eq(transfers.recurringSeriesId, input.seriesId), or(eq(transfers.recurringOccurrenceId, occurrenceId), eq(transfers.id, occurrenceId)))).limit(1);
      const scheduledOccurrenceOn = transaction?.scheduledOccurrenceOn ?? transfer?.scheduledOccurrenceOn;
      const [exception] = await tx.select().from(recurringCashFlowOccurrenceExceptions).where(and(eq(recurringCashFlowOccurrenceExceptions.ownerId, ownerId), eq(recurringCashFlowOccurrenceExceptions.seriesId, input.seriesId), eq(recurringCashFlowOccurrenceExceptions.isActive, true), scheduledOccurrenceOn ? eq(recurringCashFlowOccurrenceExceptions.scheduledOccurrenceOn, scheduledOccurrenceOn) : eq(recurringCashFlowOccurrenceExceptions.id, occurrenceId))).limit(1);
      if (!exception) throw new Error("Recurring occurrence exception not found.");
      await tx.update(recurringCashFlowOccurrenceExceptions).set({ isActive: false, transactionId: null, transferId: null, updatedAt: new Date() }).where(and(eq(recurringCashFlowOccurrenceExceptions.ownerId, ownerId), eq(recurringCashFlowOccurrenceExceptions.id, exception.id), eq(recurringCashFlowOccurrenceExceptions.isActive, true)));
      if (exception.overrideGroupId) {
        const remaining = await tx.select({ id: recurringCashFlowOccurrenceExceptions.id }).from(recurringCashFlowOccurrenceExceptions).where(and(eq(recurringCashFlowOccurrenceExceptions.ownerId, ownerId), eq(recurringCashFlowOccurrenceExceptions.overrideGroupId, exception.overrideGroupId), eq(recurringCashFlowOccurrenceExceptions.isActive, true))).limit(1);
        if (remaining.length === 0) await tx.update(recurringCashFlowOverrideGroups).set({ isActive: false, updatedAt: new Date() }).where(and(eq(recurringCashFlowOverrideGroups.ownerId, ownerId), eq(recurringCashFlowOverrideGroups.id, exception.overrideGroupId)));
      }
      const generation = await syncGeneratedRecurringOccurrences(tx, ownerId, input.seriesId, exception.scheduledOccurrenceOn, exception.scheduledOccurrenceOn, { ignoreSeriesState: true });
      await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "updated", entityType: "recurring_exception", entityId: exception.id, metadata: { operation: "recurring_occurrence_restore", seriesId: input.seriesId, affectedTransactionIds: generation.affectedTransactionIds, affectedTransferIds: generation.affectedTransferIds } });
      return generation;
    });
  };

  return {
    async listExcludedExpenses(ownerId: string): Promise<readonly CashFlowExcludedExpenseView[]> {
      const rows = await db.select({
        id: transactions.id,
        accountId: transactions.accountId,
        recurringTransactionId: transactions.recurringTransactionId,
        transactionDate: transactions.transactionDate,
        status: transactions.status,
        description: transactions.description,
        category: transactions.category,
        amountMinor: transactions.amountMinor,
      }).from(transactions)
        .where(and(eq(transactions.ownerId, ownerId), eq(transactions.kind, "expense"), eq(transactions.isExcluded, true)))
        .orderBy(desc(transactions.transactionDate), asc(transactions.id));
      const names = await accountNamesFor(db, ownerId, rows.map((row) => row.accountId));
      return rows.map((row) => ({
        ...row,
        accountName: row.accountId ? names.get(row.accountId) ?? "Unassigned" : "Unassigned",
      }));
    },
    async listRecurringTransactions(ownerId: string): Promise<readonly CashFlowRecurringTransactionView[]> {
      const series = await listRecurringSeries(ownerId, { includeHistory: false });
      return series.flatMap((entry) => {
        if (entry.state === "ended") return [];
        const version = entry.versions.find((candidate) => candidate.isCurrent) ?? entry.versions[0];
        return version ? [{ id: version.id, kind: version.kind, accountId: version.accountId, fromAccountId: version.fromAccountId, toAccountId: version.toAccountId, description: version.name, frequency: version.frequency, weekdayAdjustment: version.weekdayAdjustment }] : [];
      }).sort((left, right) => left.description.localeCompare(right.description) || left.id.localeCompare(right.id));
    },
    listRecurringSeries,
    listHomeHouseholdCashFlowLinks,
    updateHomeHouseholdCashFlowAmount,
    createRecurringSeries,
    setRecurringSeriesState,
    setRecurringTransferCountsAsExpense,
    endRecurringSeries,
    deleteRecurringSeries,
    deleteRecurringSeriesVersion,
    updateRecurringSeriesVersion,
    changeRecurringSeriesVersion,
    renameRecurringSeries,
    updateRecurringSeriesEntirely,
    generateRecurringOccurrences,
    applyRecurringOccurrenceException,
    updateRecurringOverrideGroup,
    restoreRecurringOccurrence,
    listPeriods,
    getPeriodData,
    async getCurrentPeriod(ownerId: string, asOfIso = new Date().toISOString().slice(0, 10)): Promise<CashFlowPeriodData | null> {
      const periods = await listPeriods(ownerId);
      const period = choosePeriod(periods, asOfIso);
      return period ? getPeriodData(ownerId, period.id, periods) : null;
    },
    async createInitialTimeline(ownerId: string, input: CashFlowInitialTimelineInput): Promise<TimelineExtensionResult> {
      return db.transaction(async (tx) => {
        const [existingPeriod] = await tx.select({ id: cashFlowPeriods.id })
          .from(cashFlowPeriods)
          .where(eq(cashFlowPeriods.ownerId, ownerId))
          .limit(1);
        if (existingPeriod) throw new Error("Cash Flow already has a timeline.");

        const ownerAccounts = await tx.select({ id: accounts.id })
          .from(accounts)
          .where(and(eq(accounts.ownerId, ownerId), eq(accounts.isActive, true)));
        if (ownerAccounts.length === 0) throw new Error("Add an active account before setting up Cash Flow.");

        const periods = buildInitialCashFlowPeriods(ownerId, input);
        if (periods.length === 0) throw new Error("Cash Flow setup needs at least one pay period.");
        await tx.insert(cashFlowPeriods).values(periods);

        let snapshotsCreated = 0;
        for (const account of ownerAccounts) {
          const result = await recalculateAccountProjection(tx, ownerId, account.id, { fromDate: periods[0]!.payDate, futureAfter: null });
          snapshotsCreated += result.snapshotsCreated;
        }
        await tx.insert(auditEvents).values({
          ownerId,
          actorUserId: ownerId,
          action: "created",
          entityType: "cash_flow_initial_timeline",
          entityId: null,
          metadata: { operation: "cash_flow_initial_timeline_create", firstPayday: input.firstPayday, throughDate: input.throughDate, periodsCreated: periods.length, snapshotsCreated },
        });
        return { throughDate: input.throughDate, periodsCreated: periods.length, snapshotsCreated };
      });
    },
    async createInitialCashFlowIncome(ownerId: string, input: InitialCashFlowIncomeInput): Promise<InitialCashFlowIncomeResult> {
      const recurringInput: RecurringCashFlowSeriesInput = {
        name: input.name,
        kind: "income",
        accountId: input.accountId,
        fromAccountId: null,
        toAccountId: null,
        amountMinor: input.amountMinor,
        frequency: input.frequency,
        weekdayAdjustment: "none",
        startsOn: input.startsOn,
        nextOccurrenceOn: input.startsOn,
        endsOn: null,
        note: input.note ?? null,
        countsAsExpense: false,
      };
      assertRecurringSeriesInput(recurringInput);
      assertRecurringDate(input.throughDate, "Cash Flow end date");
      if (input.throughDate < input.startsOn) throw new Error("Cash Flow end date must be on or after the first income.");

      return db.transaction(async (tx) => {
        const existingPeriods = await tx.select({ id: cashFlowPeriods.id, payDate: cashFlowPeriods.payDate, endsOn: cashFlowPeriods.endsOn })
          .from(cashFlowPeriods)
          .where(eq(cashFlowPeriods.ownerId, ownerId))
          .orderBy(asc(cashFlowPeriods.payDate), asc(cashFlowPeriods.id));

        const [existingSeries] = await tx.select({ id: recurringCashFlowSeries.id })
          .from(recurringCashFlowSeries)
          .where(eq(recurringCashFlowSeries.ownerId, ownerId))
          .limit(1);
        if (existingSeries) throw new Error("Cash Flow already has recurring movement.");

        await assertRecurringEndpoints(tx, ownerId, recurringInput);
        const periods = existingPeriods.length === 0 ? buildInitialCashFlowPeriods(ownerId, {
          firstPayday: input.startsOn,
          throughDate: input.throughDate,
        }) : [];
        const lastPeriod = existingPeriods.at(-1) ?? periods.at(-1);
        if (!lastPeriod) throw new Error("Cash Flow setup needs at least one pay period.");
        if (periods.length > 0) await tx.insert(cashFlowPeriods).values(periods);

        const [series] = await tx.insert(recurringCashFlowSeries).values({
          ownerId,
          kind: "income",
          state: "active",
          endedOn: null,
          homeHouseholdFrequency: null,
        }).returning();
        if (!series) throw new Error("Recurring Cash Flow series could not be created.");

        const [version] = await tx.insert(recurringTransactions).values({
          ownerId,
          seriesId: series.id,
          accountId: input.accountId,
          fromAccountId: null,
          toAccountId: null,
          kind: "income",
          frequency: input.frequency,
          weekdayAdjustment: "none",
          description: input.name.trim(),
          amountMinor: input.amountMinor,
          currency: "CAD",
          startsOn: input.startsOn,
          endsOn: null,
          effectiveFrom: input.startsOn,
          effectiveTo: null,
          versionNote: input.note ?? null,
          countsAsExpense: false,
          nextOccurrenceOn: input.startsOn,
          status: "planned",
        }).returning();
        if (!version) throw new Error("Recurring Cash Flow version could not be created.");

        const generation = await syncGeneratedRecurringOccurrences(tx, ownerId, series.id, input.startsOn, lastPeriod.endsOn, { preserveExistingRows: true });
        await tx.insert(auditEvents).values({
          ownerId,
          actorUserId: ownerId,
          action: "created",
          entityType: "recurring_series",
          entityId: series.id,
          metadata: {
            operation: "cash_flow_initial_income_create",
            accountId: input.accountId,
            versionId: version.id,
            periodsCreated: periods.length,
            generatedCount: generation.insertedCount,
            generationThroughDate: lastPeriod.endsOn,
          },
        });
        return {
          accountId: input.accountId,
          seriesId: series.id,
          periodsCreated: periods.length,
          generatedCount: generation.insertedCount,
        };
      });
    },
    async createCashFlowTransaction(ownerId: string, input: CashFlowTransactionCreateInput): Promise<void> {
      if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error("Transaction amount must be a positive integer minor-unit value.");
      await db.transaction(async (tx) => {
        await assertCashFlowDateInForwardPeriod(tx, ownerId, input.periodId, input.transactionDate);
        const [account] = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.ownerId, ownerId), eq(accounts.id, input.accountId), eq(accounts.isActive, true))).limit(1);
        if (!account) throw new Error("Cash-flow account is not active.");
        const [inserted] = await tx.insert(transactions).values({
          ownerId,
          accountId: input.accountId,
          periodId: input.periodId,
          transactionDate: input.transactionDate,
          kind: input.kind,
          status: "planned",
          isExcluded: false,
          isGenerated: false,
          description: input.description.trim(),
          amountMinor: input.amountMinor,
          currency: "CAD",
        }).returning({ id: transactions.id });
        if (!inserted) throw new Error("Cash-flow transaction could not be created.");
        await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "created", entityType: "transaction", entityId: inserted.id, metadata: { operation: "cash_flow_transaction_create", periodId: input.periodId, kind: input.kind } });
        await refreshCashFlowLinkedAccountProjections(tx, ownerId);
      });
    },
    async setCashFlowAccountVisibility(ownerId: string, accountId: string, isVisibleInCashFlow: boolean): Promise<void> {
      await db.transaction(async (tx) => {
        const [updated] = await tx.update(accounts).set({ isVisibleInCashFlow }).where(and(eq(accounts.ownerId, ownerId), eq(accounts.id, accountId), eq(accounts.isActive, true))).returning({ id: accounts.id });
        if (!updated) throw new Error("Cash-flow account is not active.");
        await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "updated", entityType: "account", entityId: accountId, metadata: { operation: "cash_flow_account_visibility", isVisibleInCashFlow } });
      });
    },
    async updateIncomeTransaction(ownerId: string, transactionId: string, amountMinor: number): Promise<void> {
      await db.transaction(async (tx) => {
        const [updated] = await tx.update(transactions)
          .set({ amountMinor, updatedAt: new Date() })
          .where(and(eq(transactions.id, transactionId), eq(transactions.ownerId, ownerId), eq(transactions.kind, "income")))
          .returning({ id: transactions.id });
        if (!updated) throw new Error("Income transaction not found.");
        await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "updated", entityType: "transaction", entityId: transactionId, metadata: { operation: "income_amount", amountMinor } });
        await refreshCashFlowLinkedAccountProjections(tx, ownerId);
      });
    },
    async excludeExpenseTransaction(ownerId: string, transactionId: string): Promise<void> {
      await db.transaction(async (tx) => {
        const [excluded] = await tx.update(transactions)
          .set({ isExcluded: true, updatedAt: new Date() })
          .where(and(eq(transactions.id, transactionId), eq(transactions.ownerId, ownerId), eq(transactions.kind, "expense"), eq(transactions.isExcluded, false)))
          .returning({ id: transactions.id });
        if (!excluded) throw new Error("Cash-flow expense not found.");
        await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "updated", entityType: "transaction", entityId: transactionId, metadata: { operation: "cash_flow_expense_exclude_period" } });
        await refreshCashFlowLinkedAccountProjections(tx, ownerId);
      });
    },
    async restoreExpenseTransaction(ownerId: string, transactionId: string): Promise<void> {
      await db.transaction(async (tx) => {
        const [restored] = await tx.update(transactions)
          .set({ isExcluded: false, updatedAt: new Date() })
          .where(and(eq(transactions.id, transactionId), eq(transactions.ownerId, ownerId), eq(transactions.kind, "expense"), eq(transactions.isExcluded, true)))
          .returning({ id: transactions.id });
        if (!restored) throw new Error("Excluded cash-flow expense not found.");
        await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "updated", entityType: "transaction", entityId: transactionId, metadata: { operation: "cash_flow_expense_restore" } });
        await refreshCashFlowLinkedAccountProjections(tx, ownerId);
      });
    },
    async updateTransaction(ownerId: string, transactionId: string, input: CashFlowTransactionUpdateInput): Promise<void> {
      await db.transaction(async (tx) => {
        const [existing] = await tx.select({ kind: transactions.kind, isGenerated: transactions.isGenerated, status: transactions.status, recurringSeriesId: transactions.recurringSeriesId }).from(transactions).where(and(eq(transactions.id, transactionId), eq(transactions.ownerId, ownerId))).limit(1);
        if (!existing) throw new Error("Cash-flow transaction not found.");
        if (existing.isGenerated && existing.status === "planned" && existing.recurringSeriesId) throw new Error("Use recurring occurrence controls for generated planned records.");
        if (input.scope === "this_and_future" && input.recurringTransactionId) throw new Error("Use the recurring series manager for This and future changes.");
        const periodId = await resolveCashFlowPeriodId(tx, ownerId, input.transactionDate);
        if (input.accountId) {
          const [account] = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, input.accountId), eq(accounts.ownerId, ownerId), eq(accounts.isActive, true))).limit(1);
          if (!account) throw new Error("Cash-flow account is not active.");
        }
        let recurringSeriesId: string | null = null;
        if (input.recurringTransactionId) {
          const [version] = await tx.select({ id: recurringTransactions.id, seriesId: recurringTransactions.seriesId, kind: recurringTransactions.kind }).from(recurringTransactions).where(and(eq(recurringTransactions.id, input.recurringTransactionId), eq(recurringTransactions.ownerId, ownerId))).limit(1);
          if (!version || version.kind !== existing.kind) throw new Error("Recurring series does not match the transaction.");
          recurringSeriesId = version.seriesId;
        }
        const [updated] = await tx.update(transactions)
          .set({ accountId: input.accountId, periodId, recurringTransactionId: input.recurringTransactionId, recurringSeriesId, recurringOccurrenceId: null, scheduledOccurrenceOn: null, transactionDate: input.transactionDate, description: input.description.trim(), category: input.category?.trim() || null, amountMinor: input.amountMinor, status: input.status, updatedAt: new Date() })
          .where(and(eq(transactions.id, transactionId), eq(transactions.ownerId, ownerId)))
          .returning({ id: transactions.id });
        if (!updated) throw new Error("Cash-flow transaction not found.");
        await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "updated", entityType: "transaction", entityId: transactionId, metadata: { operation: "cash_flow_edit", scope: input.scope } });
        await refreshCashFlowLinkedAccountProjections(tx, ownerId);
      });
    },
    async updateTransfer(ownerId: string, transferId: string, input: CashFlowTransferUpdateInput): Promise<void> {
      await db.transaction(async (tx) => {
        const [existing] = await tx.select({ fromAccountId: transfers.fromAccountId, toAccountId: transfers.toAccountId, isGenerated: transfers.isGenerated, status: transfers.status, recurringSeriesId: transfers.recurringSeriesId })
          .from(transfers)
          .where(and(eq(transfers.id, transferId), eq(transfers.ownerId, ownerId)))
          .limit(1);
        if (!existing) throw new Error("Cash-flow transfer not found.");
        if (existing.isGenerated && existing.status === "planned" && existing.recurringSeriesId) throw new Error("Use recurring occurrence controls for generated planned records.");
        const periodId = await resolveCashFlowPeriodId(tx, ownerId, input.transferDate);
        if (input.fromAccountId === input.toAccountId) throw new Error("Transfer accounts must be different.");
        const eligibleAccounts = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.ownerId, ownerId), eq(accounts.isActive, true), inArray(accounts.id, [input.fromAccountId, input.toAccountId])));
        if (eligibleAccounts.length !== 2) throw new Error("Transfer accounts must be active owner accounts.");
        const [updated] = await tx.update(transfers)
          .set({ fromAccountId: input.fromAccountId, toAccountId: input.toAccountId, periodId, transferDate: input.transferDate, description: input.description.trim(), amountMinor: input.amountMinor, status: input.status, updatedAt: new Date() })
          .where(and(eq(transfers.id, transferId), eq(transfers.ownerId, ownerId)))
          .returning({ id: transfers.id });
        if (!updated) throw new Error("Cash-flow transfer not found.");
        const today = toTorontoDateIso();
        for (const accountId of new Set([existing.fromAccountId, existing.toAccountId, input.fromAccountId, input.toAccountId])) {
          await recalculateAccountProjection(tx, ownerId, accountId, { fromDate: addIsoDays(today, 1), futureAfter: today });
        }
        await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "updated", entityType: "transfer", entityId: transferId, metadata: { operation: "cash_flow_edit" } });
      });
    },
    async recordCashFlowPaydayBalance(ownerId: string, input: CashFlowObservedBalanceInput): Promise<CashFlowPaydayCheckView> {
      return db.transaction(async (tx) => {
        const account = await requireCashFlowObservedBalanceContext(tx, ownerId, input);
        const [existingCheck] = await tx.select({
          id: cashFlowPaydayChecks.id,
          projectedBalanceMinor: cashFlowPaydayChecks.projectedBalanceMinor,
          actualBalanceMinor: cashFlowPaydayChecks.actualBalanceMinor,
        }).from(cashFlowPaydayChecks)
          .where(and(eq(cashFlowPaydayChecks.ownerId, ownerId), eq(cashFlowPaydayChecks.accountId, input.accountId), eq(cashFlowPaydayChecks.payDate, input.asOf)))
          .limit(1);
        let projectedBalanceMinor = existingCheck?.projectedBalanceMinor ?? null;
        if (!existingCheck) {
          const [previousPeriod] = await tx.select({ payDate: cashFlowPeriods.payDate })
            .from(cashFlowPeriods)
            .where(and(eq(cashFlowPeriods.ownerId, ownerId), lt(cashFlowPeriods.payDate, input.asOf)))
            .orderBy(desc(cashFlowPeriods.payDate), desc(cashFlowPeriods.id))
            .limit(1);
          if (!previousPeriod) throw new Error("No previous Cash Flow payday is available for comparison.");
          const endingsByAccount = await cashFlowEndingBalancesByAccountAndPayDate(tx, ownerId);
          projectedBalanceMinor = endingsByAccount.get(account.id)?.get(previousPeriod.payDate) ?? null;
        }
        if (projectedBalanceMinor === null) throw new Error("No projected balance is available for this payday.");
        const [existingSnapshot] = await tx.select({ id: balanceSnapshots.id, balanceMinor: balanceSnapshots.balanceMinor })
          .from(balanceSnapshots)
          .where(and(eq(balanceSnapshots.ownerId, ownerId), eq(balanceSnapshots.accountId, input.accountId), eq(balanceSnapshots.asOf, input.asOf)))
          .limit(1);
        let importedAnchorPreserved = false;
        if (existingSnapshot) {
          const [sourceReference] = await tx.select({ id: sourceReferences.id })
            .from(sourceReferences)
            .where(and(eq(sourceReferences.ownerId, ownerId), eq(sourceReferences.recordType, "balance_snapshot"), eq(sourceReferences.recordId, existingSnapshot.id)))
            .limit(1);
          importedAnchorPreserved = Boolean(sourceReference);
        }
        const [check] = await tx.insert(cashFlowPaydayChecks).values({
          ownerId,
          accountId: input.accountId,
          payDate: input.asOf,
          projectedBalanceMinor,
          actualBalanceMinor: input.balanceMinor,
        }).onConflictDoUpdate({
          target: [cashFlowPaydayChecks.ownerId, cashFlowPaydayChecks.accountId, cashFlowPaydayChecks.payDate],
          set: { actualBalanceMinor: input.balanceMinor, updatedAt: new Date() },
        }).returning({
          id: cashFlowPaydayChecks.id,
          accountId: cashFlowPaydayChecks.accountId,
          payDate: cashFlowPaydayChecks.payDate,
          projectedBalanceMinor: cashFlowPaydayChecks.projectedBalanceMinor,
          actualBalanceMinor: cashFlowPaydayChecks.actualBalanceMinor,
        });
        if (!check) throw new Error("Cash Flow payday check save returned no row.");
        await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "updated", entityType: "cash_flow_payday_check", entityId: check.id, metadata: { operation: "cash_flow_payday_check", asOf: input.asOf, projectedBalanceMinor: check.projectedBalanceMinor, actualBalanceMinor: check.actualBalanceMinor, varianceMinor: check.actualBalanceMinor - check.projectedBalanceMinor, importedAnchorPreserved } });
        const note = input.note === undefined
          ? (await tx.select({ note: accountBalanceNotes.note }).from(accountBalanceNotes).where(and(eq(accountBalanceNotes.ownerId, ownerId), eq(accountBalanceNotes.accountId, input.accountId), eq(accountBalanceNotes.asOf, input.asOf))).limit(1))[0]?.note ?? null
          : (await upsertAccountBalanceNote(tx, ownerId, input.accountId, input.asOf, input.note))?.note ?? null;
        if (input.note !== undefined) {
          await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: note ? "updated" : "deleted", entityType: "account_balance_note", entityId: null, metadata: { operation: note ? "upsert" : "clear", accountId: input.accountId, asOf: input.asOf } });
        }
        if (importedAnchorPreserved) {
          await recalculateAccountProjection(tx, ownerId, input.accountId, { fromDate: input.asOf, futureAfter: toTorontoDateIso() });
          return paydayCheckView({ ...check, note });
        }
        const [snapshot] = await tx.insert(balanceSnapshots).values({
          ownerId,
          accountId: input.accountId,
          asOf: input.asOf,
          balanceMinor: input.balanceMinor,
          status: "actual",
          isGenerated: false,
          currency: account.currency,
        }).onConflictDoUpdate({
          target: [balanceSnapshots.accountId, balanceSnapshots.asOf],
          set: { balanceMinor: input.balanceMinor, status: "actual", isGenerated: false, currency: account.currency },
        }).returning({ id: balanceSnapshots.id });
        if (!snapshot) throw new Error("Cash Flow balance anchor save returned no row.");
        await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "updated", entityType: "balance_snapshot", entityId: snapshot.id, metadata: { operation: "cash_flow_observed_balance", asOf: input.asOf, status: "actual" } });
        await recalculateAccountProjection(tx, ownerId, input.accountId, { fromDate: input.asOf, futureAfter: toTorontoDateIso() });
        return paydayCheckView({ ...check, note });
      });
    },

    async updateCashFlowPaydayNote(ownerId: string, input: AccountBalanceNoteMutationInput): Promise<AccountBalanceNoteView | null> {
      return db.transaction(async (tx) => {
        await requireCashFlowObservedBalanceContext(tx, ownerId, input);
        const [existing] = await tx.select({ id: accountBalanceNotes.id })
          .from(accountBalanceNotes)
          .where(and(eq(accountBalanceNotes.ownerId, ownerId), eq(accountBalanceNotes.accountId, input.accountId), eq(accountBalanceNotes.asOf, input.asOf)))
          .limit(1);
        const note = await upsertAccountBalanceNote(tx, ownerId, input.accountId, input.asOf, input.note);
        if (note || existing) {
          await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: note ? (existing ? "updated" : "created") : "deleted", entityType: "account_balance_note", entityId: note?.id ?? existing?.id ?? null, metadata: { operation: note ? "upsert" : "clear", accountId: input.accountId, asOf: input.asOf } });
        }
        return note;
      });
    },

    async resetCashFlowPaydayBalance(ownerId: string, input: Pick<CashFlowObservedBalanceInput, "accountId" | "asOf">): Promise<void> {
      return db.transaction(async (tx) => {
        await requireCashFlowObservedBalanceContext(tx, ownerId, input);
        const [check] = await tx.select({ id: cashFlowPaydayChecks.id })
          .from(cashFlowPaydayChecks)
          .where(and(eq(cashFlowPaydayChecks.ownerId, ownerId), eq(cashFlowPaydayChecks.accountId, input.accountId), eq(cashFlowPaydayChecks.payDate, input.asOf)))
          .limit(1);
        const [snapshot] = await tx.select({ id: balanceSnapshots.id, status: balanceSnapshots.status, isGenerated: balanceSnapshots.isGenerated })
          .from(balanceSnapshots)
          .where(and(
            eq(balanceSnapshots.ownerId, ownerId),
            eq(balanceSnapshots.accountId, input.accountId),
            eq(balanceSnapshots.asOf, input.asOf),
          ))
          .limit(1);
        if (!check) throw new Error("No observed payday balance was found.");
        const [sourceReference] = snapshot ? await tx.select({ id: sourceReferences.id })
          .from(sourceReferences)
          .where(and(eq(sourceReferences.ownerId, ownerId), eq(sourceReferences.recordType, "balance_snapshot"), eq(sourceReferences.recordId, snapshot.id)))
          .limit(1) : [];
        const deletedChecks = await tx.delete(cashFlowPaydayChecks)
          .where(and(eq(cashFlowPaydayChecks.ownerId, ownerId), eq(cashFlowPaydayChecks.id, check.id)))
          .returning({ id: cashFlowPaydayChecks.id });
        if (deletedChecks.length !== 1) throw new Error("Observed payday balance was not reset.");
        await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "deleted", entityType: "cash_flow_payday_check", entityId: deletedChecks[0]!.id, metadata: { operation: "cash_flow_payday_check_reset", asOf: input.asOf, importedAnchorPreserved: Boolean(sourceReference) } });
        if (sourceReference) {
          await recalculateAccountProjection(tx, ownerId, input.accountId, { fromDate: input.asOf, futureAfter: toTorontoDateIso() });
          return;
        }
        if (snapshot) {
          const deleted = await tx.delete(balanceSnapshots)
            .where(and(
              eq(balanceSnapshots.ownerId, ownerId),
              eq(balanceSnapshots.id, snapshot.id),
              eq(balanceSnapshots.status, "actual"),
              eq(balanceSnapshots.isGenerated, false),
            ))
            .returning({ id: balanceSnapshots.id });
          if (deleted.length !== 1) throw new Error("Observed payday balance was not reset.");
          await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "deleted", entityType: "balance_snapshot", entityId: deleted[0]!.id, metadata: { operation: "cash_flow_observed_balance_reset", asOf: input.asOf } });
        }
        await recalculateAccountProjection(tx, ownerId, input.accountId, { fromDate: input.asOf, futureAfter: toTorontoDateIso() });
      });
    },

    async listUpcoming(ownerId: string, asOfIso = new Date().toISOString().slice(0, 10), limit = 4, preloadedPeriods?: readonly CashFlowPeriodView[]): Promise<readonly CashFlowPeriodData[]> {
      const periods = preloadedPeriods ?? await listPeriods(ownerId);
      const upcoming = periods.filter((period) => period.endsOn >= asOfIso).slice(0, limit);
      return getPeriodDataMany(ownerId, upcoming.map((period) => period.id), periods).then((rows) => rows.flatMap((row) => row ? [row] : []));
    },
    async getPeriodWindow(ownerId: string, options: CashFlowPeriodWindowOptions = {}, preloadedPeriods?: readonly CashFlowPeriodView[] | Promise<readonly CashFlowPeriodView[]>): Promise<CashFlowPeriodWindow> {
      const asOfIso = options.asOfIso ?? new Date().toISOString().slice(0, 10);
      const periods = preloadedPeriods !== undefined ? await preloadedPeriods : await listPeriods(ownerId);
      const accountRowsPromise = listCashFlowAccounts(ownerId);
      const current = choosePeriod(periods, asOfIso);
      const selected = options.selectedPeriodId ? periods.find((period) => period.id === options.selectedPeriodId) : current;
      if (!selected) return { periods: [], accounts: await accountRowsPromise, anchors: [], paydayChecks: [], paydayNotes: [], projectionTransactions: [], projectionTransfers: [], selectedPeriodId: null, currentPeriodId: current?.id ?? null, currentPeriodPayDate: current?.payDate ?? null, totalPeriodCount: periods.length };
      const selectedIndex = periods.findIndex((period) => period.id === selected.id);
      const past = Math.max(0, Math.min(options.pastPeriods ?? 2, 24));
      const future = Math.max(0, Math.min(options.futurePeriods ?? 3, 24));
      const start = options.includeAll ? 0 : Math.max(0, selectedIndex - past);
      const end = options.includeAll ? periods.length : Math.min(periods.length, selectedIndex + future + 1);
      const windowPeriods = periods.slice(start, end);
      const lastWindowPeriod = windowPeriods.at(-1);
      const nextPeriod = periods[end];
      const windowEnd = nextPeriod
        ? addIsoDays(nextPeriod.payDate, -1)
        : lastWindowPeriod
          ? addIsoDays(lastWindowPeriod.payDate, 13)
          : selected.endsOn;
      const [accountRows, anchorRows, paydayCheckRows] = await Promise.all([
        accountRowsPromise,
        db.select({
          id: balanceSnapshots.id,
          accountId: balanceSnapshots.accountId,
          asOf: balanceSnapshots.asOf,
          balanceMinor: balanceSnapshots.balanceMinor,
          status: balanceSnapshots.status,
          isGenerated: balanceSnapshots.isGenerated,
          currency: balanceSnapshots.currency,
        }).from(balanceSnapshots)
          .innerJoin(accounts, and(eq(accounts.id, balanceSnapshots.accountId), eq(accounts.ownerId, ownerId), eq(accounts.isActive, true)))
          .where(and(
            eq(balanceSnapshots.ownerId, ownerId),
            or(eq(balanceSnapshots.status, "actual"), and(eq(balanceSnapshots.status, "planned"), eq(balanceSnapshots.isGenerated, false))),
          ))
          .orderBy(asc(balanceSnapshots.asOf), asc(balanceSnapshots.accountId), asc(balanceSnapshots.id),
          ),
        db.select({
          id: cashFlowPaydayChecks.id,
          accountId: cashFlowPaydayChecks.accountId,
          payDate: cashFlowPaydayChecks.payDate,
          projectedBalanceMinor: cashFlowPaydayChecks.projectedBalanceMinor,
          actualBalanceMinor: cashFlowPaydayChecks.actualBalanceMinor,
        }).from(cashFlowPaydayChecks)
          .where(eq(cashFlowPaydayChecks.ownerId, ownerId))
          .orderBy(asc(cashFlowPaydayChecks.payDate), asc(cashFlowPaydayChecks.accountId), asc(cashFlowPaydayChecks.id)),
      ]);
      // TASK-022: the projection row scan is lower-bounded by the earliest per-account seeding
      // anchor that can still feed `projectChainedCashFlow` (balance snapshots and payday checks
      // are the exact anchor set consumers pass in). `null` keeps the historical behaviour of an
      // unbounded scan.
      const projectionLowerBound = cashFlowProjectionDataLowerBound(
        accountRows.map((account) => account.id),
        [
          ...anchorRows.map((anchor) => ({ accountId: anchor.accountId, asOf: anchor.asOf })),
          ...paydayCheckRows.map((check) => ({ accountId: check.accountId, asOf: check.payDate })),
        ],
        windowPeriods[0]!.payDate,
      );
      const [data, noteRows, projectionData] = await Promise.all([
        getPeriodDataMany(ownerId, windowPeriods.map((period) => period.id), periods),
        db.select({ id: accountBalanceNotes.id, accountId: accountBalanceNotes.accountId, asOf: accountBalanceNotes.asOf, note: accountBalanceNotes.note })
          .from(accountBalanceNotes)
          .where(eq(accountBalanceNotes.ownerId, ownerId))
          .orderBy(asc(accountBalanceNotes.asOf), asc(accountBalanceNotes.accountId), asc(accountBalanceNotes.id)),
        listProjectionData(ownerId, windowEnd, projectionLowerBound, accountRows.map((account) => account.id)),
      ]);
      const notesByKey = new Map(noteRows.flatMap((row) => row.note === null ? [] : [[`${row.accountId}:${row.asOf}`, row.note] as const]));
      const paydayCheckAnchorKeys = new Set(paydayCheckRows.map((check) => `${check.accountId}:${check.payDate}`));
      const currenciesByAccount = new Map(accountRows.map((account) => [account.id, account.currency] as const));
      const anchors = [
        ...anchorRows.filter((anchor) => !paydayCheckAnchorKeys.has(`${anchor.accountId}:${anchor.asOf}`)),
        ...paydayCheckRows.map((check) => ({
          id: `payday-check:${check.id}`,
          accountId: check.accountId,
          asOf: check.payDate,
          balanceMinor: check.actualBalanceMinor,
          status: "actual" as const,
          isGenerated: false,
          currency: currenciesByAccount.get(check.accountId) ?? "CAD" as const,
        })),
      ];
      return {
        periods: data.flatMap((row) => row ? [row] : []),
        accounts: accountRows,
        anchors,
        paydayChecks: paydayCheckRows.map((check) => paydayCheckView({ ...check, note: notesByKey.get(`${check.accountId}:${check.payDate}`) ?? null })),
        paydayNotes: noteRows.flatMap((row) => row.note === null ? [] : [accountBalanceNoteView({ id: row.id, accountId: row.accountId, asOf: row.asOf, note: row.note })]),
        projectionTransactions: projectionData.transactions,
        projectionTransfers: projectionData.transfers,
        selectedPeriodId: selected.id,
        currentPeriodId: current?.id ?? null,
        currentPeriodPayDate: current?.payDate ?? null,
        totalPeriodCount: periods.length,
      };
    },
    listCashFlowAccounts,
  };
}


async function requireCashFlowObservedBalanceContext(
  db: TransactionDatabase,
  ownerId: string,
  input: Pick<CashFlowObservedBalanceInput, "accountId" | "asOf">,
): Promise<{ readonly id: string; readonly currency: (typeof accounts.$inferSelect)["currency"] }> {
  const todayIso = toTorontoDateIso();
  if (input.asOf > todayIso) throw new Error("Observed balance can only be recorded for today or an earlier payday.");
  const [period] = await db.select({ id: cashFlowPeriods.id })
    .from(cashFlowPeriods)
    .where(and(eq(cashFlowPeriods.ownerId, ownerId), eq(cashFlowPeriods.payDate, input.asOf)))
    .limit(1);
  if (!period) throw new Error("Observed balance date must match a Cash Flow payday.");
  const availableAccounts = await db.select({ id: accounts.id, currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.ownerId, ownerId), eq(accounts.isActive, true), eq(accounts.includeInAvailableCash, true)))
    .orderBy(asc(accounts.id));
  if (availableAccounts.length !== 1) throw new Error("Payday checks require exactly one active account included in available cash.");
  const account = availableAccounts[0]!;
  if (account.id !== input.accountId) throw new Error("Payday check account must be the sole account included in available cash.");
  return account;
}


async function assertCashFlowDateInForwardPeriod(db: Database | TransactionDatabase, ownerId: string, periodId: string, date: string): Promise<void> {
  const [period] = await db.select({ payDate: cashFlowPeriods.payDate })
    .from(cashFlowPeriods)
    .where(and(eq(cashFlowPeriods.ownerId, ownerId), eq(cashFlowPeriods.id, periodId)))
    .limit(1);
  if (!period) throw new Error("Cash-flow period not found.");
  const [nextPeriod] = await db.select({ payDate: cashFlowPeriods.payDate })
    .from(cashFlowPeriods)
    .where(and(eq(cashFlowPeriods.ownerId, ownerId), gt(cashFlowPeriods.payDate, period.payDate)))
    .orderBy(asc(cashFlowPeriods.payDate), asc(cashFlowPeriods.id))
    .limit(1);
  const endsOn = nextPeriod ? addIsoDays(nextPeriod.payDate, -1) : addIsoDays(period.payDate, 13);
  if (date < period.payDate || date > endsOn) throw new Error("Transaction date must be inside the selected Cash-flow period.");
}


async function resolveCashFlowPeriodId(db: Database | TransactionDatabase, ownerId: string, date: string): Promise<string> {
  const [period] = await db.select({ id: cashFlowPeriods.id })
    .from(cashFlowPeriods)
    .where(and(eq(cashFlowPeriods.ownerId, ownerId), lte(cashFlowPeriods.startsOn, date), gte(cashFlowPeriods.endsOn, date)))
    .orderBy(asc(cashFlowPeriods.startsOn), asc(cashFlowPeriods.id))
    .limit(1);
  if (!period) throw new Error("Cash-flow date is outside an owner period.");
  return period.id;
}


async function resolveRecurringCashFlowPeriodId(db: Database | TransactionDatabase, ownerId: string, date: string): Promise<string> {
  const [period] = await db.select({ id: cashFlowPeriods.id })
    .from(cashFlowPeriods)
    .where(and(eq(cashFlowPeriods.ownerId, ownerId), lte(cashFlowPeriods.payDate, date)))
    .orderBy(desc(cashFlowPeriods.payDate), desc(cashFlowPeriods.id))
    .limit(1);
  if (!period) throw new Error("Recurring cash-flow date is before the owner's first pay period.");
  return period.id;
}
