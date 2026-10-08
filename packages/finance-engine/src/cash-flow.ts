import type { CashFlowProjection, CurrencyCode, MinorUnits, PayPeriod } from "./domain";
import { money } from "./domain";
import { addMinorUnitsSafely, subtractMinorUnitsSafely } from "./net-worth-history";

export type CashFlowAnchorSource = "actual" | "manual";
export type CashFlowProjectionMovementKind = "anchor" | "income" | "expense" | "transfer-in" | "transfer-out";

export interface CashFlowProjectionAccount {
  readonly id: string;
  readonly name: string;
  readonly currency?: CurrencyCode;
  readonly includeInAvailableCash: boolean;
}

export interface CashFlowProjectionAnchor {
  readonly id: string;
  readonly accountId: string;
  readonly asOf: string;
  readonly balanceMinor: MinorUnits;
  readonly source: CashFlowAnchorSource;
}

export interface CashFlowProjectionTransaction {
  readonly id: string;
  readonly accountId: string | null;
  readonly transactionDate: string;
  readonly kind: "income" | "expense";
  readonly amountMinor: MinorUnits;
  readonly status: "actual" | "planned";
  readonly description?: string;
}

export interface CashFlowProjectionTransfer {
  readonly id: string;
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly transferDate: string;
  readonly amountMinor: MinorUnits;
  readonly status: "actual" | "planned";
  readonly description?: string;
  /** When true, from-account outflow is treated as spending for totals/grouping (still a transfer for balances). */
  readonly countsAsExpense?: boolean;
}

export interface CashFlowProjectionPeriodInput {
  readonly id: string;
  readonly label?: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly payDate: string;
}

export interface ChainedCashFlowInput {
  readonly accounts: readonly CashFlowProjectionAccount[];
  readonly anchors: readonly CashFlowProjectionAnchor[];
  readonly transactions: readonly CashFlowProjectionTransaction[];
  readonly transfers: readonly CashFlowProjectionTransfer[];
  readonly periods: readonly CashFlowProjectionPeriodInput[];
}

export interface CashFlowProjectionMovement {
  readonly id: string;
  readonly recordId: string;
  readonly accountId: string;
  readonly date: string;
  readonly kind: CashFlowProjectionMovementKind;
  readonly amountMinor: MinorUnits;
  readonly planned: boolean;
  readonly description: string;
  readonly counterpartAccountId?: string;
  readonly balanceAfterMinor: MinorUnits | null;
  readonly countsAsExpense?: boolean;
}

export interface CashFlowAccountPeriodProjection {
  readonly accountId: string;
  readonly accountName: string;
  readonly includeInAvailableCash: boolean;
  readonly openingBalanceMinor: MinorUnits | null;
  readonly incomeMinor: MinorUnits;
  readonly expenseMinor: MinorUnits;
  readonly transfersInMinor: MinorUnits;
  readonly transfersOutMinor: MinorUnits;
  readonly movements: readonly CashFlowProjectionMovement[];
  readonly endingBalanceMinor: MinorUnits | null;
  readonly endingSource: CashFlowAnchorSource | "projected" | "unavailable";
}

export interface ChainedCashFlowPeriodProjection {
  readonly period: CashFlowProjectionPeriodInput;
  readonly accounts: readonly CashFlowAccountPeriodProjection[];
  readonly openingBalanceMinor: MinorUnits | null;
  readonly incomeMinor: MinorUnits;
  readonly spendingMinor: MinorUnits;
  readonly transfersInMinor: MinorUnits;
  readonly transfersOutMinor: MinorUnits;
  readonly availableCashDeltaMinor: MinorUnits;
  readonly availableBeforeNextPayMinor: MinorUnits | null;
  readonly endingBalanceMinor: MinorUnits | null;
  readonly warnings: readonly string[];
}

export interface ChainedCashFlowProjection {
  readonly periods: readonly ChainedCashFlowPeriodProjection[];
  readonly warnings: readonly string[];
}

interface ProjectionEvent {
  readonly id: string;
  readonly recordId: string;
  readonly accountId: string;
  readonly date: string;
  readonly kind: Exclude<CashFlowProjectionMovementKind, "anchor">;
  readonly amountMinor: MinorUnits;
  readonly planned: boolean;
  readonly description: string;
  readonly counterpartAccountId?: string;
  readonly priority: number;
  readonly countsAsExpense?: boolean;
}

interface AnchorEvent {
  readonly id: string;
  readonly recordId: string;
  readonly accountId: string;
  readonly date: string;
  readonly kind: "anchor";
  readonly amountMinor: MinorUnits;
  readonly source: CashFlowAnchorSource;
  readonly priority: 0;
}

function minor(value: number): MinorUnits {
  return value as MinorUnits;
}

function safeNumberFromBigInt(value: bigint, label: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new RangeError(`${label} is outside the safe integer range.`);
  return result;
}

function isSafeMinor(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function signedMovement(event: Pick<ProjectionEvent, "kind" | "amountMinor">): number {
  return event.kind === "income" || event.kind === "transfer-in" ? event.amountMinor : -event.amountMinor;
}

function compareLexicographic(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareEvents(left: ProjectionEvent | AnchorEvent, right: ProjectionEvent | AnchorEvent): number {
  return compareLexicographic(left.date, right.date)
    || left.priority - right.priority
    || compareLexicographic(left.id, right.id)
    || compareLexicographic(left.recordId, right.recordId);
}

function periodForDate(periods: readonly CashFlowProjectionPeriodInput[], date: string): CashFlowProjectionPeriodInput | null {
  const fallback = periods.at(-1) ?? null;
  for (const period of periods) {
    if (period.startsOn <= date && date <= period.endsOn) return period;
    if (period.startsOn > date) return period;
  }
  return fallback;
}

function latestAnchorOnOrBefore(anchors: readonly CashFlowProjectionAnchor[], date: string): CashFlowProjectionAnchor | null {
  let low = 0;
  let high = anchors.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (anchors[middle]!.asOf <= date) low = middle + 1;
    else high = middle;
  }
  return low === 0 ? null : anchors[low - 1]!;
}

function latestAnchorAfter(anchors: readonly CashFlowProjectionAnchor[], afterExclusive: string, throughInclusive: string): CashFlowProjectionAnchor | null {
  let low = 0;
  let high = anchors.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (anchors[middle]!.asOf <= throughInclusive) low = middle + 1;
    else high = middle;
  }
  const candidate = low === 0 ? null : anchors[low - 1]!;
  return candidate && candidate.asOf > afterExclusive ? candidate : null;
}

function warningForRecord(
  periodWarnings: Map<string, string[]>,
  periods: readonly CashFlowProjectionPeriodInput[],
  date: string,
  message: string,
): void {
  const period = periodForDate(periods, date);
  if (!period) return;
  const warnings = periodWarnings.get(period.id) ?? [];
  if (!warnings.includes(message)) warnings.push(message);
  periodWarnings.set(period.id, warnings);
}

interface EventCursor {
  index: number;
  lastPeriodEnd: string | null;
}

function projectAccountPeriod(
  account: CashFlowProjectionAccount,
  anchors: readonly CashFlowProjectionAnchor[],
  events: readonly ProjectionEvent[],
  period: CashFlowProjectionPeriodInput,
  previous: CashFlowAccountPeriodProjection | null,
  previousEnd: string | null,
  eventCursor: EventCursor,
): CashFlowAccountPeriodProjection {
  const baselineAnchor = previousEnd
    ? latestAnchorAfter(anchors, previousEnd, period.startsOn)
      ?? (previous?.endingBalanceMinor === null ? latestAnchorOnOrBefore(anchors, period.startsOn) : null)
    : latestAnchorOnOrBefore(anchors, period.startsOn);
  let running: number | null = baselineAnchor?.balanceMinor ?? previous?.endingBalanceMinor ?? null;
  let lastAppliedDate = baselineAnchor?.asOf ?? previousEnd;
  const allowSameDayEventsAfterInitialAnchor = previousEnd === null && baselineAnchor !== null && baselineAnchor.asOf < period.startsOn;
  let lastAnchorSource: CashFlowAnchorSource | null = baselineAnchor?.source
    ?? (previous?.endingSource === "actual" || previous?.endingSource === "manual" ? previous.endingSource : null);
  let hasPlannedMovement = false;
  const sharedCursor = eventCursor.lastPeriodEnd === null || period.startsOn > eventCursor.lastPeriodEnd;
  let eventIndex = sharedCursor ? eventCursor.index : 0;
  while (eventIndex < events.length && events[eventIndex]!.date < period.startsOn) {
    const event = events[eventIndex]!;
    eventIndex += 1;
    if (running === null) continue;
    if (lastAppliedDate && (event.date < lastAppliedDate || (event.date === lastAppliedDate && !allowSameDayEventsAfterInitialAnchor))) continue;
    running = addMinorUnitsSafely(running, signedMovement(event), "Running balance total");
    if (event.planned) hasPlannedMovement = true;
  }
  const openingBalanceMinor = running === null ? null : minor(running);
  const movements: CashFlowProjectionMovement[] = [];
  let incomeMinor = 0;
  let expenseMinor = 0;
  let transfersInMinor = 0;
  let transfersOutMinor = 0;
  const periodEvents: Array<ProjectionEvent | AnchorEvent> = anchors
    .filter((anchor) => anchor.asOf >= period.startsOn && anchor.asOf <= period.endsOn)
    .map((anchor): AnchorEvent => ({ id: anchor.id, recordId: anchor.id, accountId: anchor.accountId, date: anchor.asOf, kind: "anchor", amountMinor: anchor.balanceMinor, source: anchor.source, priority: 0 }));
  while (eventIndex < events.length && events[eventIndex]!.date <= period.endsOn) {
    periodEvents.push(events[eventIndex]!);
    eventIndex += 1;
  }
  eventCursor.index = eventIndex;
  eventCursor.lastPeriodEnd = period.endsOn;
  periodEvents.sort(compareEvents);

  for (const event of periodEvents) {
    if (event.kind === "anchor") {
      running = event.amountMinor;
      lastAppliedDate = event.date;
      lastAnchorSource = event.source;
      hasPlannedMovement = false;
      movements.push({
        id: `anchor:${event.id}`,
        recordId: event.recordId,
        accountId: event.accountId,
        date: event.date,
        kind: "anchor",
        amountMinor: event.amountMinor,
        planned: false,
        description: `${event.source === "actual" ? "Actual" : "Manual"} balance anchor`,
        balanceAfterMinor: minor(running),
      });
      continue;
    }

    if (lastAppliedDate && event.date < lastAppliedDate) continue;
    if (event.kind === "income") incomeMinor = addMinorUnitsSafely(incomeMinor, event.amountMinor, "Income total");
    if (event.kind === "expense" || (event.kind === "transfer-out" && event.countsAsExpense)) expenseMinor = addMinorUnitsSafely(expenseMinor, event.amountMinor, "Expense total");
    if (event.kind === "transfer-in") transfersInMinor = addMinorUnitsSafely(transfersInMinor, event.amountMinor, "Transfers-in total");
    if (event.kind === "transfer-out" && !event.countsAsExpense) transfersOutMinor = addMinorUnitsSafely(transfersOutMinor, event.amountMinor, "Transfers-out total");
    if (event.planned) hasPlannedMovement = true;
    if (running !== null) running = addMinorUnitsSafely(running, signedMovement(event), "Running balance total");
    movements.push({
      id: event.id,
      recordId: event.recordId,
      accountId: event.accountId,
      date: event.date,
      kind: event.kind,
      amountMinor: event.amountMinor,
      planned: event.planned,
      description: event.description,
      ...(event.counterpartAccountId ? { counterpartAccountId: event.counterpartAccountId } : {}),
      ...(event.countsAsExpense ? { countsAsExpense: true } : {}),
      balanceAfterMinor: running === null ? null : minor(running),
    });
  }

  const endingBalanceMinor = running === null ? null : minor(running);
  const endingSource = endingBalanceMinor === null
    ? "unavailable"
    : hasPlannedMovement || !lastAnchorSource
      ? "projected"
      : lastAnchorSource;
  return {
    accountId: account.id,
    accountName: account.name,
    includeInAvailableCash: account.includeInAvailableCash,
    openingBalanceMinor,
    incomeMinor: minor(incomeMinor),
    expenseMinor: minor(expenseMinor),
    transfersInMinor: minor(transfersInMinor),
    transfersOutMinor: minor(transfersOutMinor),
    movements,
    endingBalanceMinor,
    endingSource,
  };
}

export function projectChainedCashFlow(input: ChainedCashFlowInput): ChainedCashFlowProjection {
  const accounts = [...input.accounts];
  const periods = [...input.periods].sort((left, right) => compareLexicographic(left.startsOn, right.startsOn) || compareLexicographic(left.id, right.id));
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const anchorsByAccount = new Map<string, CashFlowProjectionAnchor[]>();
  const eventsByAccount = new Map<string, ProjectionEvent[]>();
  const periodWarnings = new Map<string, string[]>();
  const globalWarnings: string[] = [];

  for (const anchor of input.anchors) {
    if (!Number.isSafeInteger(anchor.balanceMinor)) {
      throw new RangeError("Anchor balance must be a safe integer minor-unit amount.");
    }
    if (!accountById.has(anchor.accountId)) {
      const message = `Anchor ${anchor.id} is assigned to an unknown account and was ignored.`;
      if (!globalWarnings.includes(message)) globalWarnings.push(message);
      continue;
    }
    const anchors = anchorsByAccount.get(anchor.accountId) ?? [];
    anchors.push(anchor);
    anchorsByAccount.set(anchor.accountId, anchors);
  }
  for (const anchors of anchorsByAccount.values()) anchors.sort((left, right) => compareLexicographic(left.asOf, right.asOf) || compareLexicographic(left.id, right.id));

  const addEvent = (event: ProjectionEvent): void => {
    const events = eventsByAccount.get(event.accountId) ?? [];
    events.push(event);
    eventsByAccount.set(event.accountId, events);
  };
  for (const transaction of input.transactions) {
    if (!isSafeMinor(transaction.amountMinor)) {
      warningForRecord(periodWarnings, periods, transaction.transactionDate, `Transaction ${transaction.id} has an invalid non-negative minor-unit amount and was ignored.`);
      continue;
    }
    if (!transaction.accountId || !accountById.has(transaction.accountId)) {
      warningForRecord(periodWarnings, periods, transaction.transactionDate, `${transaction.description ?? "A transaction"} is unassigned and was excluded from account balances.`);
      continue;
    }
    addEvent({
      id: `transaction:${transaction.id}`,
      recordId: transaction.id,
      accountId: transaction.accountId,
      date: transaction.transactionDate,
      kind: transaction.kind,
      amountMinor: transaction.amountMinor,
      planned: transaction.status === "planned",
      description: transaction.description ?? (transaction.kind === "income" ? "Income" : "Expense"),
      priority: transaction.kind === "income" ? 10 : 30,
    });
  }
  for (const transfer of input.transfers) {
    if (!isSafeMinor(transfer.amountMinor) || transfer.amountMinor <= 0) {
      warningForRecord(periodWarnings, periods, transfer.transferDate, `Transfer ${transfer.id} has an invalid positive minor-unit amount and was ignored.`);
      continue;
    }
    const fromAccount = accountById.get(transfer.fromAccountId);
    const toAccount = accountById.get(transfer.toAccountId);
    if (!fromAccount || !toAccount || transfer.fromAccountId === transfer.toAccountId) {
      warningForRecord(periodWarnings, periods, transfer.transferDate, `${transfer.description ?? "A transfer"} is unassigned and was excluded from account balances.`);
      continue;
    }
    const planned = transfer.status === "planned";
    const countsAsExpense = transfer.countsAsExpense === true;
    addEvent({
      id: `transfer:${transfer.id}:in`,
      recordId: transfer.id,
      accountId: toAccount.id,
      date: transfer.transferDate,
      kind: "transfer-in",
      amountMinor: transfer.amountMinor,
      planned,
      description: transfer.description ?? "Transfer in",
      counterpartAccountId: fromAccount.id,
      priority: 20,
    });
    addEvent({
      id: `transfer:${transfer.id}:out`,
      recordId: transfer.id,
      accountId: fromAccount.id,
      date: transfer.transferDate,
      kind: "transfer-out",
      amountMinor: transfer.amountMinor,
      planned,
      description: transfer.description ?? "Transfer out",
      counterpartAccountId: toAccount.id,
      priority: 40,
      ...(countsAsExpense ? { countsAsExpense: true } : {}),
    });
  }
  for (const events of eventsByAccount.values()) events.sort(compareEvents);

  const sortedTransactions = [...input.transactions].sort((left, right) => compareLexicographic(left.transactionDate, right.transactionDate));
  const sortedTransfers = [...input.transfers].sort((left, right) => compareLexicographic(left.transferDate, right.transferDate));
  const eventCursors = new Map(accounts.map((account) => [account.id, { index: 0, lastPeriodEnd: null as string | null }]));
  let transactionCursor = 0;
  let transferCursor = 0;
  let previousMetricPeriodEnd: string | null = null;
  const previousByAccount = new Map<string, CashFlowAccountPeriodProjection>();
  const projections: ChainedCashFlowPeriodProjection[] = [];
  for (const period of periods) {
    const accountProjections = accounts.map((account) => {
      const projection = projectAccountPeriod(
        account,
        anchorsByAccount.get(account.id) ?? [],
        eventsByAccount.get(account.id) ?? [],
        period,
        previousByAccount.get(account.id) ?? null,
        projections.at(-1)?.period.endsOn ?? null,
        eventCursors.get(account.id)!,
      );
      previousByAccount.set(account.id, projection);
      return projection;
    });
    let transactionIndex = previousMetricPeriodEnd === null || period.startsOn > previousMetricPeriodEnd ? transactionCursor : 0;
    while (transactionIndex < sortedTransactions.length && sortedTransactions[transactionIndex]!.transactionDate < period.startsOn) transactionIndex += 1;
    const periodEvents: CashFlowProjectionTransaction[] = [];
    while (transactionIndex < sortedTransactions.length && sortedTransactions[transactionIndex]!.transactionDate <= period.endsOn) {
      const transaction = sortedTransactions[transactionIndex]!;
      transactionIndex += 1;
      if (transaction.accountId && accountById.has(transaction.accountId) && isSafeMinor(transaction.amountMinor)) periodEvents.push(transaction);
    }
    transactionCursor = transactionIndex;
    let transferIndex = previousMetricPeriodEnd === null || period.startsOn > previousMetricPeriodEnd ? transferCursor : 0;
    while (transferIndex < sortedTransfers.length && sortedTransfers[transferIndex]!.transferDate < period.startsOn) transferIndex += 1;
    const periodTransfers: CashFlowProjectionTransfer[] = [];
    while (transferIndex < sortedTransfers.length && sortedTransfers[transferIndex]!.transferDate <= period.endsOn) {
      const transfer = sortedTransfers[transferIndex]!;
      transferIndex += 1;
      if (accountById.has(transfer.fromAccountId) && accountById.has(transfer.toAccountId) && transfer.fromAccountId !== transfer.toAccountId && isSafeMinor(transfer.amountMinor) && transfer.amountMinor > 0) periodTransfers.push(transfer);
    }
    transferCursor = transferIndex;
    previousMetricPeriodEnd = period.endsOn;

    const incomeMinor = periodEvents.filter((event) => event.kind === "income").reduce((sum, event) => addMinorUnitsSafely(sum, event.amountMinor, "Income total"), 0);
    const purePeriodTransfers = periodTransfers.filter((transfer) => transfer.countsAsExpense !== true);
    const expensePeriodTransfers = periodTransfers.filter((transfer) => transfer.countsAsExpense === true);
    const spendingMinor = addMinorUnitsSafely(
      periodEvents.filter((event) => event.kind === "expense").reduce((sum, event) => addMinorUnitsSafely(sum, event.amountMinor, "Expense total"), 0),
      expensePeriodTransfers.reduce((sum, transfer) => addMinorUnitsSafely(sum, transfer.amountMinor, "Expense total"), 0),
      "Spending total",
    );
    // Period timeline transfer metrics are available-cash boundary flows only:
    // - Transfers in: money entering included accounts from outside available cash
    // - Transfers out: money leaving included accounts to outside available cash
    // Internal included↔included transfers are neutral and excluded from both columns.
    // Do not mirror total transfer volume into both columns (that made every outflow look like an inflow).
    const transfersInMinor = purePeriodTransfers.reduce((sum, transfer) => {
      const fromIncluded = accountById.get(transfer.fromAccountId)?.includeInAvailableCash ?? false;
      const toIncluded = accountById.get(transfer.toAccountId)?.includeInAvailableCash ?? false;
      return !fromIncluded && toIncluded ? addMinorUnitsSafely(sum, transfer.amountMinor, "Transfers-in total") : sum;
    }, 0);
    const transfersOutMinor = purePeriodTransfers.reduce((sum, transfer) => {
      const fromIncluded = accountById.get(transfer.fromAccountId)?.includeInAvailableCash ?? false;
      const toIncluded = accountById.get(transfer.toAccountId)?.includeInAvailableCash ?? false;
      return fromIncluded && !toIncluded ? addMinorUnitsSafely(sum, transfer.amountMinor, "Transfers-out total") : sum;
    }, 0);
    const availableCashDeltaBigInt = periodTransfers.reduce((sum, transfer) => {
      const fromIncluded = accountById.get(transfer.fromAccountId)?.includeInAvailableCash ?? false;
      const toIncluded = accountById.get(transfer.toAccountId)?.includeInAvailableCash ?? false;
      const delta = fromIncluded && !toIncluded ? -transfer.amountMinor : !fromIncluded && toIncluded ? transfer.amountMinor : 0;
      return sum + BigInt(delta);
    }, 0n) + periodEvents.reduce((sum, event) => {
      const account = event.accountId ? accountById.get(event.accountId) : undefined;
      if (!account || !account.includeInAvailableCash) return sum;
      return sum + BigInt(event.kind === "income" ? event.amountMinor : -event.amountMinor);
    }, 0n);
    const availableCashDeltaMinor = safeNumberFromBigInt(availableCashDeltaBigInt, "Available cash delta total");
    const availableAccounts = accountProjections.filter((account) => account.includeInAvailableCash);
    const availableBeforeNextPayMinor = availableAccounts.some((account) => account.endingBalanceMinor === null)
      ? null
      : minor(safeNumberFromBigInt(availableAccounts.reduce((sum, account) => sum + BigInt(account.endingBalanceMinor ?? 0), 0n), "Available cash total"));
    const openingBalanceMinor = availableAccounts.some((account) => account.openingBalanceMinor === null)
      ? null
      : minor(safeNumberFromBigInt(availableAccounts.reduce((sum, account) => sum + BigInt(account.openingBalanceMinor ?? 0), 0n), "Opening balance total"));
    const warnings = [...(periodWarnings.get(period.id) ?? [])];
    for (const account of accountProjections) {
      if (account.endingBalanceMinor === null) warnings.push(`${account.accountName} has no Actual or manual balance anchor for this forecast.`);
      if (account.endingBalanceMinor !== null && account.endingBalanceMinor < 0) warnings.push(`${account.accountName} is projected below zero.`);
    }
    for (const warning of globalWarnings) if (!warnings.includes(warning)) warnings.push(warning);
    projections.push({
      period,
      accounts: accountProjections,
      openingBalanceMinor,
      incomeMinor: minor(incomeMinor),
      spendingMinor: minor(spendingMinor),
      transfersInMinor: minor(transfersInMinor),
      transfersOutMinor: minor(transfersOutMinor),
      availableCashDeltaMinor: minor(availableCashDeltaMinor),
      availableBeforeNextPayMinor,
      endingBalanceMinor: availableBeforeNextPayMinor,
      warnings,
    });
  }
  return {
    periods: projections,
    warnings: [...new Set(projections.flatMap((period) => period.warnings))],
  };
}

export function projectCashFlow(period: PayPeriod): CashFlowProjection {
  if (!Number.isSafeInteger(period.openingBalance)) {
    throw new RangeError("Anchor balance must be a safe integer minor-unit amount.");
  }
  const income = period.items.filter((item) => item.kind === "income").reduce((sum, item) => addMinorUnitsSafely(sum, item.amount, "Income total"), 0);
  const expenses = period.items.filter((item) => item.kind === "expense").reduce((sum, item) => addMinorUnitsSafely(sum, item.amount, "Expense total"), 0);
  const transferItems = period.items.filter((item) => item.kind === "transfer");
  const transferIn = transferItems.filter((item) => item.direction === "in").reduce((sum, item) => addMinorUnitsSafely(sum, item.amount, "Transfers-in total"), 0);
  const transferOut = transferItems.filter((item) => item.direction !== "in").reduce((sum, item) => addMinorUnitsSafely(sum, item.amount, "Transfers-out total"), 0);
  const transfers = subtractMinorUnitsSafely(transferIn, transferOut, "Transfers total");
  const endingBalance = safeNumberFromBigInt(BigInt(period.openingBalance) + BigInt(income) + BigInt(transfers) - BigInt(expenses), "Ending balance total");
  const signedAmount = (item: PayPeriod["items"][number]) => item.kind === "income" || (item.kind === "transfer" && item.direction === "in") ? item.amount : -item.amount;
  const actual = period.items.filter((item) => !item.planned).reduce((sum, item) => addMinorUnitsSafely(sum, signedAmount(item), "Actual total"), 0);
  const planned = period.items.filter((item) => item.planned).reduce((sum, item) => addMinorUnitsSafely(sum, signedAmount(item), "Planned total"), 0);
  const warnings: string[] = [];
  if (endingBalance < 0) warnings.push("Projected balance is below zero.");
  if (period.items.some((item) => item.amount < 0)) warnings.push("One or more inputs use a negative amount.");
  if (transferItems.some((item) => item.direction === undefined)) warnings.push("A transfer is missing an explicit direction and is treated as outgoing.");
  return {
    openingBalance: money(period.openingBalance),
    income: money(income),
    expenses: money(expenses),
    transfers: money(transfers),
    transferIn: money(transferIn),
    transferOut: money(transferOut),
    endingBalance: money(endingBalance),
    availableBeforeNextPay: money(endingBalance),
    variance: money(subtractMinorUnitsSafely(actual, planned, "Variance total")),
    warnings,
  };
}
