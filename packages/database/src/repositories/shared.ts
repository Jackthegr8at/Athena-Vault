import { and, asc, eq, gte, inArray, or, sql } from "drizzle-orm";
import type { Database } from "../client";
import {
  annualExpenseDueDate,
  applyAnnualBudgetEventsToTimeline,
  money,
  projectAnnualBudget,
  projectChainedCashFlow,
} from "@athena/finance-engine";
import {
  accounts,
  annualExpensePayments,
  annualExpenseValues,
  annualExpenses,
  annualBudgets,
  accountContributionExceptions,
  accountBalanceNotes,
  accountContributionRules,
  balanceSnapshots,
  cashFlowPaydayChecks,
  cashFlowPeriods,
  recurringCashFlowOccurrenceExceptions,
  recurringTransactions,
  sourceReferences,
  transactions,
  transfers,
  users,
} from "../drizzle-schema";
import {
  addIsoDays,
  calculateProjectedTimeline,
  contributionFrequencies,
  nextContributionOccurrence,
  type ContributionExceptionKind,
  type ContributionExceptionSchedule,
  type ContributionFrequency,
  type ContributionPeriod,
  type ContributionRuleSchedule,
} from "../account-contributions";
import {
  type RecurringCashFlowVersionSchedule,
  type RecurringOccurrenceException,
} from "../recurring-cash-flow";
import {
  FUTURE_ACCOUNT_TIMELINE_STATUS_ERROR,
  periodPositionLabel,
  selectClosestPaydayOnOrBefore,
  toTorontoDateIso,
  type SnapshotStatus,
} from "../account-timeline";

import type { AccountBalanceNoteView, AccountContributionExceptionView, AccountContributionRuleView, AccountProjectionRecalculationResult } from "./account-timeline";

import type { CashFlowPaydayCheckView } from "./cash-flow";

export type OwnerRecord = Pick<typeof users.$inferSelect, "id" | "email" | "displayName" | "isDemo" | "demoFixtureVersion" | "createdAt">;


export interface TimelineExtensionResult {
  readonly throughDate: string;
  readonly periodsCreated: number;
  readonly snapshotsCreated: number;
}


export async function accountNamesFor(
  db: Database,
  ownerId: string,
  accountIds: readonly (string | null)[],
): Promise<ReadonlyMap<string, string>> {
  const ids = [...new Set(accountIds.flatMap((id) => id ? [id] : []))];
  if (ids.length === 0) return new Map();
  const rows = await db.select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.ownerId, ownerId), inArray(accounts.id, ids)));
  return new Map(rows.map((row) => [row.id, row.name]));
}


export function recurringVersionSchedule(row: typeof recurringTransactions.$inferSelect): RecurringCashFlowVersionSchedule {
  return {
    id: row.id,
    seriesId: row.seriesId,
    name: row.description,
    kind: row.kind,
    accountId: row.accountId,
    fromAccountId: row.fromAccountId,
    toAccountId: row.toAccountId,
    amountMinor: row.amountMinor,
    frequency: row.frequency,
    weekdayAdjustment: row.weekdayAdjustment,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    countsAsExpense: row.kind === "transfer" && row.countsAsExpense === true,
  };
}


export function recurringExceptionSchedule(row: typeof recurringCashFlowOccurrenceExceptions.$inferSelect): RecurringOccurrenceException {
  if (row.statusOverride !== null && row.statusOverride !== "planned") throw new Error("Recurring exception contains an unsupported status.");
  return {
    id: row.id,
    seriesId: row.seriesId,
    versionId: row.versionId,
    scheduledOccurrenceOn: row.scheduledOccurrenceOn,
    kind: row.kind,
    dateOverride: row.dateOverride,
    amountOverrideMinor: row.amountOverrideMinor,
    accountOverrideId: row.accountOverrideId,
    fromAccountOverrideId: row.fromAccountOverrideId,
    toAccountOverrideId: row.toAccountOverrideId,
    transferId: row.transferId,
    statusOverride: row.statusOverride,
    note: row.note,
    overrideGroupId: row.overrideGroupId,
    isActive: row.isActive,
  };
}


export type TransactionDatabase = Parameters<Parameters<Database["transaction"]>[0]>[0];


export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error && isUniqueViolation(error.cause);
}


export function requireOwnerText(value: string, label: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}


export type TimelineDatabase = Database | TransactionDatabase;


/** Maximum rows per batched multi-row write (AGENTS.md chunking rule). */
export const OWNER_WRITE_CHUNK_SIZE = 500;


export function accountBalanceNoteView(row: {
  id: string;
  accountId: string;
  asOf: string;
  note: string;
}): AccountBalanceNoteView {
  return row;
}


export function paydayCheckView(row: {
  id: string;
  accountId: string;
  payDate: string;
  projectedBalanceMinor: number;
  actualBalanceMinor: number;
  note?: string | null;
}): CashFlowPaydayCheckView {
  return {
    id: row.id,
    accountId: row.accountId,
    payDate: row.payDate,
    projectedBalanceMinor: row.projectedBalanceMinor,
    actualBalanceMinor: row.actualBalanceMinor,
    varianceMinor: row.actualBalanceMinor - row.projectedBalanceMinor,
    note: row.note ?? null,
  };
}


export function normalizedAccountBalanceNote(value: string | null | undefined): string | null {
  const note = value?.trim() ?? "";
  if (note.length > 500) throw new RangeError("Note must be 500 characters or fewer.");
  return note || null;
}


export function accountContributionRuleSchedule(row: {
  id: string;
  amountMinor: number;
  frequency: string;
  startsOn: string;
  endsOn: string | null;
  isEnabled: boolean;
}): ContributionRuleSchedule {
  if (!(contributionFrequencies as readonly string[]).includes(row.frequency)) throw new Error("Stored contribution rule has an unsupported frequency.");
  return { ...row, frequency: row.frequency as ContributionFrequency };
}


export function accountContributionExceptionSchedule(row: {
  ruleId: string;
  occurrenceOn: string;
  kind: ContributionExceptionKind;
  amountMinor: number | null;
}): ContributionExceptionSchedule {
  return row;
}


export async function loadContributionRules(
  db: TimelineDatabase,
  ownerId: string,
  accountIds?: readonly string[],
  nextDate = toTorontoDateIso(),
): Promise<ReadonlyMap<string, AccountContributionRuleView[]>> {
  const rules = await db.select({
    id: accountContributionRules.id,
    accountId: accountContributionRules.accountId,
    amountMinor: accountContributionRules.amountMinor,
    frequency: accountContributionRules.frequency,
    startsOn: accountContributionRules.startsOn,
    endsOn: accountContributionRules.endsOn,
    isEnabled: accountContributionRules.isEnabled,
  }).from(accountContributionRules)
    .where(accountIds && accountIds.length > 0
      ? and(eq(accountContributionRules.ownerId, ownerId), inArray(accountContributionRules.accountId, accountIds))
      : eq(accountContributionRules.ownerId, ownerId))
    .orderBy(asc(accountContributionRules.startsOn), asc(accountContributionRules.id));
  const ruleIds = rules.map((rule) => rule.id);
  const exceptions = ruleIds.length === 0 ? [] : await db.select({
    id: accountContributionExceptions.id,
    ruleId: accountContributionExceptions.ruleId,
    occurrenceOn: accountContributionExceptions.occurrenceOn,
    kind: accountContributionExceptions.kind,
    amountMinor: accountContributionExceptions.amountMinor,
  }).from(accountContributionExceptions)
    .where(and(eq(accountContributionExceptions.ownerId, ownerId), inArray(accountContributionExceptions.ruleId, ruleIds)))
    .orderBy(asc(accountContributionExceptions.occurrenceOn), asc(accountContributionExceptions.id));
  const exceptionsByRule = new Map<string, AccountContributionExceptionView[]>();
  for (const exception of exceptions) {
    const list = exceptionsByRule.get(exception.ruleId) ?? [];
    list.push({ id: exception.id, occurrenceOn: exception.occurrenceOn, kind: exception.kind, amountMinor: exception.amountMinor });
    exceptionsByRule.set(exception.ruleId, list);
  }
  const result = new Map<string, AccountContributionRuleView[]>();
  for (const rule of rules) {
    const ruleExceptions = exceptionsByRule.get(rule.id) ?? [];
    const schedule = accountContributionRuleSchedule(rule);
    const list = result.get(rule.accountId) ?? [];
    list.push({
      ...rule,
      frequency: schedule.frequency,
      nextOccurrenceOn: nextContributionOccurrence(schedule, nextDate, ruleExceptions.map((exception) => accountContributionExceptionSchedule({
        ruleId: rule.id,
        occurrenceOn: exception.occurrenceOn,
        kind: exception.kind,
        amountMinor: exception.amountMinor,
      }))),
      exceptions: ruleExceptions,
    });
    result.set(rule.accountId, list);
  }
  return result;
}


export async function upsertAccountBalanceNote(
  db: TimelineDatabase,
  ownerId: string,
  accountId: string,
  asOf: string,
  value: string | null | undefined,
): Promise<AccountBalanceNoteView | null> {
  const note = normalizedAccountBalanceNote(value);
  if (note === null) {
    await db.delete(accountBalanceNotes)
      .where(and(eq(accountBalanceNotes.ownerId, ownerId), eq(accountBalanceNotes.accountId, accountId), eq(accountBalanceNotes.asOf, asOf)));
    return null;
  }
  const [row] = await db.insert(accountBalanceNotes).values({ ownerId, accountId, asOf, note })
    .onConflictDoUpdate({
      target: [accountBalanceNotes.ownerId, accountBalanceNotes.accountId, accountBalanceNotes.asOf],
      set: { note, updatedAt: new Date() },
    })
    .returning({ id: accountBalanceNotes.id, accountId: accountBalanceNotes.accountId, asOf: accountBalanceNotes.asOf, note: accountBalanceNotes.note });
  const savedNote = row?.note;
  if (!row || savedNote === null || savedNote === undefined) throw new Error("Account balance note save returned no row.");
  return accountBalanceNoteView({ ...row, note: savedNote });
}


export interface ProjectionRecalculationRequest {
  readonly fromDate: string;
  readonly futureAfter?: string | null;
}


export interface ProjectionRecalculationCounts {
  readonly snapshotsCreated: number;
  readonly snapshotsUpdated: number;
}


export async function annualBudgetEventsForAccount(
  db: TimelineDatabase,
  ownerId: string,
  accountId: string,
  anchor: { readonly asOf: string; readonly balanceMinor: number },
  forecastStart: string,
  forecastEnd: string,
): Promise<readonly { readonly date: string; readonly kind: "payment" | "withdrawal"; readonly amountMinor: number }[]> {
  const budgetRows = await db.select({ id: annualBudgets.id })
    .from(annualBudgets)
    .where(and(eq(annualBudgets.ownerId, ownerId), eq(annualBudgets.linkedAccountId, accountId), eq(annualBudgets.isActive, true)));
  const budgetIds = budgetRows.map((budget) => budget.id);
  if (budgetIds.length === 0) return [];
  const valueRows = await db.select({
    id: annualExpenseValues.id,
    taxYear: annualExpenseValues.taxYear,
    amountMinor: annualExpenseValues.amountMinor,
    amountOverrideMinor: annualExpenseValues.amountOverrideMinor,
    dueMonthOverride: annualExpenseValues.dueMonthOverride,
    dueDayOverride: annualExpenseValues.dueDayOverride,
    name: annualExpenses.name,
    dueMonth: annualExpenses.dueMonth,
    dueDay: annualExpenses.dueDay,
  }).from(annualExpenseValues)
    .innerJoin(annualExpenses, and(eq(annualExpenses.id, annualExpenseValues.annualExpenseId), eq(annualExpenses.ownerId, ownerId)))
    .where(and(eq(annualExpenseValues.ownerId, ownerId), inArray(annualExpenseValues.budgetId, budgetIds)))
    .orderBy(asc(annualExpenseValues.taxYear), asc(annualExpenseValues.id));
  const valueIds = valueRows.map((value) => value.id);
  const paymentRows = valueIds.length === 0 ? [] : await db.select({
    id: annualExpensePayments.id,
    annualExpenseValueId: annualExpensePayments.annualExpenseValueId,
    paymentOn: annualExpensePayments.paymentOn,
    amountMinor: annualExpensePayments.amountMinor,
  }).from(annualExpensePayments)
    .where(and(eq(annualExpensePayments.ownerId, ownerId), inArray(annualExpensePayments.annualExpenseValueId, valueIds)))
    .orderBy(asc(annualExpensePayments.paymentOn), asc(annualExpensePayments.id));
  const paymentsByValue = new Map<string, typeof paymentRows>();
  for (const payment of paymentRows) {
    const payments = paymentsByValue.get(payment.annualExpenseValueId) ?? [];
    payments.push(payment);
    paymentsByValue.set(payment.annualExpenseValueId, payments);
  }
  const occurrences = valueRows.flatMap((value) => {
    const month = value.dueMonthOverride ?? value.dueMonth;
    if (month === null) return [];
    const day = value.dueDayOverride ?? value.dueDay;
    const dueDate = annualExpenseDueDate(value.taxYear, month, day);
    return [{
      id: value.id,
      name: value.name,
      plannedAmountMinor: value.amountOverrideMinor ?? value.amountMinor,
      dueDate,
      payments: (paymentsByValue.get(value.id) ?? []).map((payment) => ({
        id: payment.id,
        paymentOn: payment.paymentOn,
        amountMinor: payment.amountMinor,
      })),
    }];
  });
  if (occurrences.length === 0) return [];
  return projectAnnualBudget({
    budgetId: accountId,
    forecastStart,
    forecastEnd,
    anchor,
    contributions: [],
    occurrences,
  }).events.flatMap((event) => event.kind === "payment" || event.kind === "withdrawal"
    ? [{ date: event.date, kind: event.kind, amountMinor: event.amountMinor }]
    : []);
}


export function addUtcDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year!, month! - 1, day!));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}


export function utcDaysBetween(left: string, right: string): number {
  return Math.round((new Date(`${right}T00:00:00.000Z`).getTime() - new Date(`${left}T00:00:00.000Z`).getTime()) / 86_400_000);
}


export function forwardPaydayBounds(periods: readonly { readonly payDate: string }[]): readonly { readonly startsOn: string; readonly endsOn: string }[] {
  return periods.map((period, index) => {
    const next = periods[index + 1];
    const previous = periods[index - 1];
    const cadenceDays = next
      ? utcDaysBetween(period.payDate, next.payDate)
      : previous
        ? utcDaysBetween(previous.payDate, period.payDate)
        : 14;
    const safeCadenceDays = cadenceDays > 0 && cadenceDays <= 62 ? cadenceDays : 14;
    return { startsOn: period.payDate, endsOn: addUtcDays(period.payDate, safeCadenceDays - 1) };
  });
}


export interface CashFlowEndingBalancesPeriod {
  readonly id: string;
  readonly label?: string;
  readonly payDate: string;
  readonly startsOn: string;
  readonly endsOn: string;
}


/** Loads every cash_flow_periods row for the owner, ordered by (pay_date, id). */
export async function loadCashFlowProjectionPeriods(
  db: TimelineDatabase,
  ownerId: string,
): Promise<readonly CashFlowEndingBalancesPeriod[]> {
  return db.select({
    id: cashFlowPeriods.id,
    label: cashFlowPeriods.label,
    payDate: cashFlowPeriods.payDate,
    startsOn: cashFlowPeriods.startsOn,
    endsOn: cashFlowPeriods.endsOn,
  }).from(cashFlowPeriods).where(eq(cashFlowPeriods.ownerId, ownerId)).orderBy(asc(cashFlowPeriods.payDate), asc(cashFlowPeriods.id));
}


/**
 * Earliest transaction/transfer date that can still affect a balance returned by
 * `projectChainedCashFlow`. In `projectAccountPeriod` every anchor (actual
 * snapshot, manual planned snapshot, or payday check) resets the running balance
 * and suppresses all earlier events, so for each account the earliest relevant
 * date is the latest anchor on or before the first projected pay date — events
 * strictly before it can never reach any returned opening/ending balance.
 * Events dated exactly on the bound still apply (same-day events after a
 * baseline anchor), so callers MUST apply the bound inclusively (`date >= bound`).
 * An account with no anchor on or before the first pay date has no cutoff, so
 * the overall bound falls back to `null` (unbounded), per TASK-021.
 */
export function cashFlowHistoryLowerBound(
  accountIds: readonly string[],
  anchors: readonly { readonly accountId: string; readonly asOf: string }[],
  firstPayDate: string,
): string | null {
  const anchorDatesByAccount = new Map<string, string[]>();
  for (const anchor of anchors) {
    const dates = anchorDatesByAccount.get(anchor.accountId) ?? [];
    dates.push(anchor.asOf);
    anchorDatesByAccount.set(anchor.accountId, dates);
  }
  let bound: string | null = null;
  for (const accountId of accountIds) {
    const dates = anchorDatesByAccount.get(accountId);
    const latestQualifying = dates?.filter((asOf) => asOf <= firstPayDate).sort().at(-1);
    if (!latestQualifying) return null;
    if (bound === null || latestQualifying < bound) bound = latestQualifying;
  }
  return bound;
}


export interface CashFlowEndingBalancesOptions {
  /**
   * Already-loaded cash_flow_periods rows (any order); when supplied the
   * function does not re-query them. Rows are re-sorted by (payDate, id) to
   * match the database ordering.
   */
  readonly periods?: readonly CashFlowEndingBalancesPeriod[] | Promise<readonly CashFlowEndingBalancesPeriod[]>;
  /**
   * Inclusive lower bound applied to transaction/transfer history reads.
   * `undefined` (default) derives the anchor bound via
   * `cashFlowHistoryLowerBound`; `null` loads unbounded history (equivalence
   * testing); a date string forces that bound.
   */
  readonly historyLowerBound?: string | null;
}


/**
 * Periods + contribution rules loaded once per owner and shared across a
 * multi-account projection recalculation (TASK-018/TASK-028).
 */
export interface AccountProjectionPreloadedData {
  /** Period rows keyed by pay date; `payDate` is projected onto `asOf`. */
  readonly periods?: readonly CashFlowEndingBalancesPeriod[];
  /** Rule map covering every account being recalculated (from loadContributionRules). */
  readonly contributionRules?: ReadonlyMap<string, AccountContributionRuleView[]>;
}


/**
 * Cash Flow projected balances keyed by accountId → payDate.
 * Account timeline cells display openings; projection recalculation uses endings.
 */

export async function cashFlowEndingBalancesByAccountAndPayDate(
  db: TimelineDatabase,
  ownerId: string,
  balanceKind: "opening" | "ending" = "ending",
  options: CashFlowEndingBalancesOptions = {},
): Promise<ReadonlyMap<string, ReadonlyMap<string, number>>> {
  const [accountRows, periodRows, snapshotRows, paydayCheckRows] = await Promise.all([
    db.select({
      id: accounts.id,
      name: accounts.name,
      currency: accounts.currency,
      includeInAvailableCash: accounts.includeInAvailableCash,
    }).from(accounts).where(and(eq(accounts.ownerId, ownerId), eq(accounts.isActive, true))),
    options.periods !== undefined
      ? Promise.resolve(options.periods).then((rows) => [...rows]
        .sort((left, right) => left.payDate.localeCompare(right.payDate) || left.id.localeCompare(right.id)))
      : loadCashFlowProjectionPeriods(db, ownerId),
    db.select({
      id: balanceSnapshots.id,
      accountId: balanceSnapshots.accountId,
      asOf: balanceSnapshots.asOf,
      balanceMinor: balanceSnapshots.balanceMinor,
      status: balanceSnapshots.status,
    }).from(balanceSnapshots).where(and(
      eq(balanceSnapshots.ownerId, ownerId),
      or(eq(balanceSnapshots.status, "actual"), and(eq(balanceSnapshots.status, "planned"), eq(balanceSnapshots.isGenerated, false))),
    )),
    db.select({
      id: cashFlowPaydayChecks.id,
      accountId: cashFlowPaydayChecks.accountId,
      asOf: cashFlowPaydayChecks.payDate,
      balanceMinor: cashFlowPaydayChecks.actualBalanceMinor,
    }).from(cashFlowPaydayChecks).where(eq(cashFlowPaydayChecks.ownerId, ownerId)),
  ]);

  if (accountRows.length === 0 || periodRows.length === 0) return new Map();

  const paydayCheckAnchorKeys = new Set(paydayCheckRows.map((check) => `${check.accountId}:${check.asOf}`));
  const anchors = [
    ...snapshotRows
      .filter((snapshot) => !paydayCheckAnchorKeys.has(`${snapshot.accountId}:${snapshot.asOf}`))
      .map((snapshot) => ({
        id: snapshot.id,
        accountId: snapshot.accountId,
        asOf: snapshot.asOf,
        balanceMinor: money(snapshot.balanceMinor),
        source: snapshot.status === "actual" ? "actual" as const : "manual" as const,
      })),
    ...paydayCheckRows.map((check) => ({
      id: `payday-check:${check.id}`,
      accountId: check.accountId,
      asOf: check.asOf,
      balanceMinor: money(check.balanceMinor),
      source: "actual" as const,
    })),
  ];

  // Anchors reset the running balance, so history before this bound cannot
  // change any returned balance (cashFlowHistoryLowerBound). Inclusive bound.
  const historyLowerBound = options.historyLowerBound !== undefined
    ? options.historyLowerBound
    : cashFlowHistoryLowerBound(accountRows.map((account) => account.id), anchors, periodRows[0]!.payDate);
  const [transactionRows, transferRows] = await Promise.all([
    db.select({
      id: transactions.id,
      accountId: transactions.accountId,
      transactionDate: transactions.transactionDate,
      kind: transactions.kind,
      amountMinor: transactions.amountMinor,
      status: transactions.status,
      description: transactions.description,
      isExcluded: transactions.isExcluded,
    }).from(transactions).where(and(
      eq(transactions.ownerId, ownerId),
      eq(transactions.isExcluded, false),
      ...(historyLowerBound ? [gte(transactions.transactionDate, historyLowerBound)] : []),
    )),
    db.select({
      id: transfers.id,
      fromAccountId: transfers.fromAccountId,
      toAccountId: transfers.toAccountId,
      transferDate: transfers.transferDate,
      amountMinor: transfers.amountMinor,
      status: transfers.status,
      description: transfers.description,
      recurringTransactionId: transfers.recurringTransactionId,
    }).from(transfers).where(and(
      eq(transfers.ownerId, ownerId),
      ...(historyLowerBound ? [gte(transfers.transferDate, historyLowerBound)] : []),
    )),
  ]);

  const versionIds = [...new Set(transferRows.map((row) => row.recurringTransactionId).filter((id): id is string => id !== null))];
  const versionCountsAsExpense = versionIds.length === 0
    ? new Map<string, boolean>()
    : new Map((await db.select({
      id: recurringTransactions.id,
      countsAsExpense: recurringTransactions.countsAsExpense,
    }).from(recurringTransactions).where(and(eq(recurringTransactions.ownerId, ownerId), inArray(recurringTransactions.id, versionIds))))
      .map((row) => [row.id, row.countsAsExpense === true] as const));
  const bounds = forwardPaydayBounds(periodRows);
  const chain = projectChainedCashFlow({
    accounts: accountRows.map((account) => ({
      id: account.id,
      name: account.name,
      currency: account.currency,
      includeInAvailableCash: account.includeInAvailableCash,
    })),
    anchors,
    transactions: transactionRows.flatMap((transaction) => (
      transaction.kind === "income" || transaction.kind === "expense"
        ? [{
          id: transaction.id,
          accountId: transaction.accountId,
          transactionDate: transaction.transactionDate,
          kind: transaction.kind,
          amountMinor: money(transaction.amountMinor),
          status: transaction.status,
          description: transaction.description,
        }]
        : []
    )),
    transfers: transferRows.map((transfer) => ({
      id: transfer.id,
      fromAccountId: transfer.fromAccountId,
      toAccountId: transfer.toAccountId,
      transferDate: transfer.transferDate,
      amountMinor: money(transfer.amountMinor),
      status: transfer.status,
      description: transfer.description,
      countsAsExpense: transfer.recurringTransactionId
        ? versionCountsAsExpense.get(transfer.recurringTransactionId) === true
        : false,
    })),
    periods: periodRows.map((period, index) => ({
      id: period.id,
      label: period.label,
      payDate: period.payDate,
      startsOn: bounds[index]!.startsOn,
      endsOn: bounds[index]!.endsOn,
    })),
  });

  const byAccount = new Map<string, Map<string, number>>();
  for (const period of chain.periods) {
    for (const account of period.accounts) {
      const balanceMinor = balanceKind === "opening" ? account.openingBalanceMinor : account.endingBalanceMinor;
      if (balanceMinor === null) continue;
      const payDate = period.period.payDate;
      const accountMap = byAccount.get(account.accountId) ?? new Map<string, number>();
      accountMap.set(payDate, balanceMinor);
      byAccount.set(account.accountId, accountMap);
    }
  }
  return byAccount;
}


export async function refreshCashFlowLinkedAccountProjections(
  db: TransactionDatabase,
  ownerId: string,
): Promise<AccountProjectionRecalculationResult> {
  const linkedAccounts = await db.select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.ownerId, ownerId), eq(accounts.isActive, true), eq(accounts.useCashFlowPlannedTimeline, true)))
    .orderBy(asc(accounts.name), asc(accounts.id));
  if (linkedAccounts.length === 0) return { accountCount: 0, snapshotsCreated: 0, snapshotsUpdated: 0 };
  const today = toTorontoDateIso();
  const periodsPromise = loadCashFlowProjectionPeriods(db, ownerId);
  const [cashFlowEndings, periods, contributionRules] = await Promise.all([
    cashFlowEndingBalancesByAccountAndPayDate(db, ownerId, "ending", { periods: periodsPromise }),
    periodsPromise,
    loadContributionRules(db, ownerId, linkedAccounts.map((account) => account.id), today),
  ]);
  const preloaded: AccountProjectionPreloadedData = { periods, contributionRules };
  let snapshotsCreated = 0;
  let snapshotsUpdated = 0;
  for (const account of linkedAccounts) {
    const counts = await recalculateAccountProjection(db, ownerId, account.id, {
      fromDate: addIsoDays(today, 1),
      futureAfter: today,
    }, cashFlowEndings, preloaded);
    snapshotsCreated += counts.snapshotsCreated;
    snapshotsUpdated += counts.snapshotsUpdated;
  }
  return { accountCount: linkedAccounts.length, snapshotsCreated, snapshotsUpdated };
}


export async function recalculateAccountProjection(
  db: TimelineDatabase,
  ownerId: string,
  accountId: string,
  request: ProjectionRecalculationRequest,
  cashFlowEndingsByAccount?: ReadonlyMap<string, ReadonlyMap<string, number>>,
  preloaded?: AccountProjectionPreloadedData,
): Promise<ProjectionRecalculationCounts> {
  const [account, periodRows, snapshotRows] = await Promise.all([
    db.select({
      id: accounts.id,
      currency: accounts.currency,
      useCashFlowPlannedTimeline: accounts.useCashFlowPlannedTimeline,
    })
      .from(accounts)
      .where(and(eq(accounts.ownerId, ownerId), eq(accounts.id, accountId)))
      .limit(1),
    preloaded?.periods !== undefined
      ? Promise.resolve([...preloaded.periods]
        .map((period) => ({ startsOn: period.startsOn, endsOn: period.endsOn, asOf: period.payDate }))
        .sort((left, right) => left.asOf.localeCompare(right.asOf) || left.startsOn.localeCompare(right.startsOn)))
      : db.select({ startsOn: cashFlowPeriods.startsOn, endsOn: cashFlowPeriods.endsOn, asOf: cashFlowPeriods.payDate })
        .from(cashFlowPeriods)
        .where(eq(cashFlowPeriods.ownerId, ownerId))
        .orderBy(asc(cashFlowPeriods.payDate), asc(cashFlowPeriods.id)),
    db.select({
      id: balanceSnapshots.id,
      asOf: balanceSnapshots.asOf,
      balanceMinor: balanceSnapshots.balanceMinor,
      status: balanceSnapshots.status,
      isGenerated: balanceSnapshots.isGenerated,
    }).from(balanceSnapshots)
      .where(and(eq(balanceSnapshots.ownerId, ownerId), eq(balanceSnapshots.accountId, accountId)))
      .orderBy(asc(balanceSnapshots.asOf), asc(balanceSnapshots.id)),
  ]);
  if (!account[0]) throw new Error("Account not found.");
  const ruleMap = preloaded?.contributionRules ?? await loadContributionRules(db, ownerId, [accountId]);
  const rules = (ruleMap.get(accountId) ?? []).map((rule) => accountContributionRuleSchedule(rule));
  const exceptions = (ruleMap.get(accountId) ?? []).flatMap((rule) => rule.exceptions.map((exception) => accountContributionExceptionSchedule({
    ruleId: rule.id,
    occurrenceOn: exception.occurrenceOn,
    kind: exception.kind,
    amountMinor: exception.amountMinor,
  })));
  // Account timeline planned cells are driven by contribution rules + annual budget events.
  // Cash Flow transfers must not move accounts that only live in CF (e.g. CIBC with 0 rules).
  // Opted-in CF accounts use projected endings, which already include transfer effects.
  const endingBalanceOverridesByAsOf = account[0].useCashFlowPlannedTimeline
    ? (cashFlowEndingsByAccount ?? await cashFlowEndingBalancesByAccountAndPayDate(db, ownerId)).get(accountId)
    : undefined;
  const periods: ContributionPeriod[] = periodRows.map((period) => ({ startsOn: period.startsOn, endsOn: period.endsOn, asOf: period.asOf }));
  const calculated = calculateProjectedTimeline(periods, snapshotRows, rules, exceptions, {
    fromDate: request.fromDate,
    futureAfter: request.futureAfter,
    endingBalanceOverridesByAsOf,
  });
  const forecastStart = request.futureAfter ?? request.fromDate;
  const forecastEnd = [...periods.map((period) => period.asOf ?? period.endsOn), ...snapshotRows.map((snapshot) => snapshot.asOf)].sort().at(-1);
  const actualAnchor = [...snapshotRows]
    .filter((snapshot) => snapshot.status === "actual" && snapshot.asOf <= forecastStart)
    .sort((left, right) => left.asOf.localeCompare(right.asOf) || left.id.localeCompare(right.id))
    .at(-1);
  const annualEvents = actualAnchor && forecastEnd && forecastEnd >= forecastStart
    ? await annualBudgetEventsForAccount(db, ownerId, accountId, { asOf: actualAnchor.asOf, balanceMinor: actualAnchor.balanceMinor }, forecastStart, forecastEnd)
    : [];
  const calculatedWithAnnualEvents = actualAnchor
    ? applyAnnualBudgetEventsToTimeline(calculated, { asOf: actualAnchor.asOf, balanceMinor: actualAnchor.balanceMinor }, annualEvents)
    : calculated;
  const previousById = new Map(snapshotRows.map((snapshot) => [snapshot.id, snapshot]));
  const snapshotInserts: (typeof balanceSnapshots.$inferInsert)[] = [];
  const snapshotUpdates: { readonly id: string; readonly balanceMinor: number; readonly isGenerated: boolean }[] = [];
  for (const next of calculatedWithAnnualEvents) {
    if (next.id === null) {
      snapshotInserts.push({
        ownerId,
        accountId,
        asOf: next.asOf,
        balanceMinor: next.balanceMinor,
        status: "planned",
        isGenerated: true,
        currency: account[0].currency,
      });
      continue;
    }

    const previous = previousById.get(next.id);
    if (!previous || previous.balanceMinor === next.balanceMinor && previous.isGenerated === next.isGenerated) continue;
    snapshotUpdates.push({ id: next.id, balanceMinor: next.balanceMinor, isGenerated: next.isGenerated });
  }
  let snapshotsCreated = 0;
  let snapshotsUpdated = 0;
  for (let start = 0; start < snapshotInserts.length; start += OWNER_WRITE_CHUNK_SIZE) {
    const chunk = snapshotInserts.slice(start, start + OWNER_WRITE_CHUNK_SIZE);
    const created = await db.insert(balanceSnapshots).values(chunk)
      .onConflictDoNothing({ target: [balanceSnapshots.accountId, balanceSnapshots.asOf] })
      .returning({ id: balanceSnapshots.id });
    snapshotsCreated += created.length;
  }
  for (let start = 0; start < snapshotUpdates.length; start += OWNER_WRITE_CHUNK_SIZE) {
    const chunk = snapshotUpdates.slice(start, start + OWNER_WRITE_CHUNK_SIZE);
    const valueRows = sql.join(
      chunk.map((row) => sql`(${row.id}::uuid, ${row.balanceMinor}::bigint, ${row.isGenerated}::boolean)`),
      sql`, `,
    );
    const updated = await db.execute(sql`
      update public.balance_snapshots as b
      set balance_minor = v.balance_minor, is_generated = v.is_generated
      from (values ${valueRows}) as v(id, balance_minor, is_generated)
      where b.owner_id = ${ownerId}
        and b.account_id = ${accountId}
        and b.id = v.id
        and b.status = 'planned'
        and b.is_generated = true
      returning b.id
    `);
    if (updated.length !== chunk.length) {
      throw new Error(`Balance snapshot projection update affected ${updated.length} row(s) but expected ${chunk.length}.`);
    }
    snapshotsUpdated += updated.length;
  }
  return { snapshotsCreated, snapshotsUpdated };
}


export async function assertAccountTimelineSnapshotEditable(
  db: TimelineDatabase,
  ownerId: string,
  accountId: string,
  asOf: string,
  options: { readonly allowImportedAnchor?: boolean; readonly allowCurrentPaydayPlannedSnapshot?: boolean } = {},
): Promise<boolean> {
  const [account] = await db.select({ id: accounts.id, isActive: accounts.isActive })
    .from(accounts)
    .where(and(eq(accounts.ownerId, ownerId), eq(accounts.id, accountId)))
    .limit(1);
  if (!account || !account.isActive) throw new Error("Account not found.");

  if (!options.allowCurrentPaydayPlannedSnapshot && asOf === await currentAccountTimelinePayday(db, ownerId)) {
    const availableCashAccounts = await db.select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.ownerId, ownerId), eq(accounts.isActive, true), eq(accounts.includeInAvailableCash, true)));
    if (availableCashAccounts.length === 1 && availableCashAccounts[0]!.id === accountId) {
      throw new Error("Use Cash Flow Payday Check to record the current balance for this account.");
    }
  }

  const [snapshot] = await db.select({ id: balanceSnapshots.id })
    .from(balanceSnapshots)
    .where(and(eq(balanceSnapshots.ownerId, ownerId), eq(balanceSnapshots.accountId, accountId), eq(balanceSnapshots.asOf, asOf)))
    .limit(1);
  if (!snapshot) return false;
  const [sourceReference] = await db.select({ id: sourceReferences.id })
    .from(sourceReferences)
    .where(and(eq(sourceReferences.ownerId, ownerId), eq(sourceReferences.recordType, "balance_snapshot"), eq(sourceReferences.recordId, snapshot.id)))
    .limit(1);
  if (sourceReference && !options.allowImportedAnchor) throw new Error("Imported balance anchors cannot be changed from Accounts.");
  return Boolean(sourceReference);
}


export async function currentAccountTimelinePayday(
  db: TimelineDatabase,
  ownerId: string,
  todayIso: string = toTorontoDateIso(),
): Promise<string | null> {
  const periods = await db.select({ payDate: cashFlowPeriods.payDate })
    .from(cashFlowPeriods)
    .where(eq(cashFlowPeriods.ownerId, ownerId))
    .orderBy(asc(cashFlowPeriods.payDate), asc(cashFlowPeriods.id));
  return selectClosestPaydayOnOrBefore(periods.map((period) => period.payDate), todayIso);
}


export async function assertAccountTimelineStatusAllowed(
  db: TimelineDatabase,
  ownerId: string,
  asOf: string,
  status: SnapshotStatus,
): Promise<void> {
  if (status !== "actual") return;
  const currentPayday = await currentAccountTimelinePayday(db, ownerId);
  if (periodPositionLabel(asOf, currentPayday) === "Projected") throw new Error(FUTURE_ACCOUNT_TIMELINE_STATUS_ERROR);
}
