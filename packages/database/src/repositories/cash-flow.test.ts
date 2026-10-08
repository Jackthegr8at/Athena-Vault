import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";
import { money, projectChainedCashFlow } from "@athena/finance-engine";
import { createDatabase, withDatabaseContext, type Database } from "../client";
import {
  accounts,
  balanceSnapshots,
  cashFlowPaydayChecks,
  cashFlowPeriods,
  institutions,
  recurringCashFlowSeries,
  recurringTransactions,
  transactions,
  transfers,
  users,
} from "../drizzle-schema";
import { forwardPaydayBounds } from "./shared";
import {
  buildInitialCashFlowPeriods,
  cashFlowProjectionDataLowerBound,
  createCashFlowRepository,
  MAX_INITIAL_CASH_FLOW_PERIODS,
  recurringExceptionTargetUpdates,
  type CashFlowPeriodWindow,
} from "./cash-flow";

describe("initial Cash Flow timeline construction", () => {
  it("builds consecutive planned 14-day periods from the selected first payday", () => {
    const periods = buildInitialCashFlowPeriods("owner-1", {
      firstPayday: "2026-08-19",
      throughDate: "2026-09-30",
    });

    expect(periods).toEqual([
      {
        ownerId: "owner-1",
        label: "Pay period 2026-08-19",
        startsOn: "2026-08-06",
        endsOn: "2026-08-19",
        payDate: "2026-08-19",
        openingBalanceMinor: 0,
        currency: "CAD",
        status: "planned",
      },
      {
        ownerId: "owner-1",
        label: "Pay period 2026-09-02",
        startsOn: "2026-08-20",
        endsOn: "2026-09-02",
        payDate: "2026-09-02",
        openingBalanceMinor: 0,
        currency: "CAD",
        status: "planned",
      },
      {
        ownerId: "owner-1",
        label: "Pay period 2026-09-16",
        startsOn: "2026-09-03",
        endsOn: "2026-09-16",
        payDate: "2026-09-16",
        openingBalanceMinor: 0,
        currency: "CAD",
        status: "planned",
      },
      {
        ownerId: "owner-1",
        label: "Pay period 2026-09-30",
        startsOn: "2026-09-17",
        endsOn: "2026-09-30",
        payDate: "2026-09-30",
        openingBalanceMinor: 0,
        currency: "CAD",
        status: "planned",
      },
    ]);
  });

  it("rejects reversed dates and an unbounded horizon", () => {
    expect(() => buildInitialCashFlowPeriods("owner-1", { firstPayday: "2026-12-31", throughDate: "2026-08-19" })).toThrow("on or after the first payday");
    expect(() => buildInitialCashFlowPeriods("owner-1", { firstPayday: "2026-08-19", throughDate: "2040-01-01" })).toThrow(`more than ${MAX_INITIAL_CASH_FLOW_PERIODS} pay periods`);
  });
});

describe("cashFlowProjectionDataLowerBound", () => {
  const windowStart = "2026-01-01";

  it("returns null when there are no accounts to bound", () => {
    expect(cashFlowProjectionDataLowerBound([], [{ accountId: "a", asOf: "2025-01-01" }], windowStart)).toBeNull();
  });

  it("uses the latest anchor on or before the window start per account and returns the minimum", () => {
    const bound = cashFlowProjectionDataLowerBound(
      ["a", "b"],
      [
        { accountId: "a", asOf: "2025-12-10" },
        { accountId: "a", asOf: "2025-12-20" },
        { accountId: "a", asOf: "2026-06-01" },
        { accountId: "b", asOf: "2025-12-18" },
      ],
      windowStart,
    );
    expect(bound).toBe("2025-12-18");
  });

  it("bounds anchorless accounts at the window start so they cannot widen the scan", () => {
    const bound = cashFlowProjectionDataLowerBound(
      ["a", "b"],
      [{ accountId: "a", asOf: "2025-12-20" }],
      windowStart,
    );
    expect(bound).toBe("2025-12-20");
    expect(cashFlowProjectionDataLowerBound(["a"], [], windowStart)).toBe(windowStart);
  });
  it("bounds at the window start when anchors exist only after it", () => {
    // Anchorless accounts and anchors after the window start contribute `windowStart`, so the
    // scan is bounded even though no pre-window anchor exists: for `projectChainedCashFlow`
    // those accounts carry running = null until their first anchor inside the window.
    const bound = cashFlowProjectionDataLowerBound(
      ["a", "b"],
      [{ accountId: "a", asOf: "2026-02-01" }, { accountId: "b", asOf: "2026-03-01" }],
      windowStart,
    );
    expect(bound).toBe(windowStart);
  });

  it("keeps the bound inclusive of the anchor date and ignores anchors for unknown accounts", () => {
    expect(cashFlowProjectionDataLowerBound(["a"], [{ accountId: "a", asOf: windowStart }], windowStart)).toBe(windowStart);
    expect(cashFlowProjectionDataLowerBound(["a"], [{ accountId: "ghost", asOf: "2020-01-01" }], windowStart)).toBe(windowStart);
  });
});

describe("recurringExceptionTargetUpdates", () => {
  it("links transactions for override exceptions on income/expense occurrences", () => {
    const updates = recurringExceptionTargetUpdates(
      [
        { exceptionId: "ex-1", scheduledOccurrenceOn: "2026-02-01", exceptionKind: "override", occurrenceKind: "expense" },
        { exceptionId: "ex-2", scheduledOccurrenceOn: "2026-02-15", exceptionKind: "override", occurrenceKind: "income" },
      ],
      new Map([["2026-02-01", "txn-1"], ["2026-02-15", "txn-2"]]),
      new Map(),
    );
    expect(updates).toEqual([
      { exceptionId: "ex-1", transactionId: "txn-1", transferId: null },
      { exceptionId: "ex-2", transactionId: "txn-2", transferId: null },
    ]);
  });

  it("links transfers for override exceptions on transfer occurrences", () => {
    const updates = recurringExceptionTargetUpdates(
      [{ exceptionId: "ex-1", scheduledOccurrenceOn: "2026-02-01", exceptionKind: "override", occurrenceKind: "transfer" }],
      new Map([["2026-02-01", "txn-ignored"]]),
      new Map([["2026-02-01", "tr-1"]]),
    );
    expect(updates).toEqual([{ exceptionId: "ex-1", transactionId: null, transferId: "tr-1" }]);
  });

  it("clears both targets for skipped occurrences regardless of generated rows", () => {
    const updates = recurringExceptionTargetUpdates(
      [
        { exceptionId: "ex-1", scheduledOccurrenceOn: "2026-02-01", exceptionKind: "skip", occurrenceKind: "expense" },
        { exceptionId: "ex-2", scheduledOccurrenceOn: "2026-02-01", exceptionKind: "skip", occurrenceKind: "transfer" },
      ],
      new Map([["2026-02-01", "txn-1"]]),
      new Map([["2026-02-01", "tr-1"]]),
    );
    expect(updates).toEqual([
      { exceptionId: "ex-1", transactionId: null, transferId: null },
      { exceptionId: "ex-2", transactionId: null, transferId: null },
    ]);
  });

  it("resolves a missing generated row to null like the previous per-exception select", () => {
    const updates = recurringExceptionTargetUpdates(
      [{ exceptionId: "ex-1", scheduledOccurrenceOn: "2026-02-01", exceptionKind: "override", occurrenceKind: "expense" }],
      new Map(),
      new Map(),
    );
    expect(updates).toEqual([{ exceptionId: "ex-1", transactionId: null, transferId: null }]);
  });
});

const connectionString = process.env.DATABASE_URL;
const database = connectionString ? createDatabase(connectionString) : undefined;

/**
 * Maps a period window's rows into the exact `projectChainedCashFlow` input shape used by
 * apps/web/app/cash-flow/page.tsx (the dashboard composes the same input in app/page.tsx).
 */
function projectionInputFor(
  window: CashFlowPeriodWindow,
  transactionRows: readonly {
    readonly id: string;
    readonly transactionDate: string;
    readonly kind: "income" | "expense" | "adjustment";
    readonly status: "planned" | "actual";
    readonly description: string;
    readonly amountMinor: number;
    readonly accountId: string | null;
  }[],
  transferRows: readonly {
    readonly id: string;
    readonly transferDate: string;
    readonly status: "planned" | "actual";
    readonly description: string;
    readonly amountMinor: number;
    readonly fromAccountId: string;
    readonly toAccountId: string;
    readonly countsAsExpense: boolean | null;
  }[],
) {
  const bounds = forwardPaydayBounds(window.periods.map((entry) => entry.period));
  const periods = window.periods.map((entry, index) => ({
    id: entry.period.id,
    label: entry.period.label,
    startsOn: bounds[index]!.startsOn,
    endsOn: bounds[index]!.endsOn,
    payDate: entry.period.payDate,
  }));
  return {
    accounts: window.accounts.map((account) => ({ id: account.id, name: account.name, currency: account.currency, includeInAvailableCash: account.includeInAvailableCash })),
    anchors: window.anchors.map((anchor) => ({
      id: anchor.id,
      accountId: anchor.accountId,
      asOf: anchor.asOf,
      balanceMinor: money(anchor.balanceMinor),
      source: anchor.status === "actual" ? "actual" as const : "manual" as const,
    })),
    transactions: transactionRows.flatMap((transaction) => transaction.kind === "income" || transaction.kind === "expense" ? [{
      id: transaction.id,
      accountId: transaction.accountId,
      transactionDate: transaction.transactionDate,
      kind: transaction.kind,
      amountMinor: money(transaction.amountMinor),
      status: transaction.status,
      description: transaction.description,
    }] : []),
    transfers: transferRows.map((transfer) => ({
      id: transfer.id,
      fromAccountId: transfer.fromAccountId,
      toAccountId: transfer.toAccountId,
      transferDate: transfer.transferDate,
      amountMinor: money(transfer.amountMinor),
      status: transfer.status,
      description: transfer.description,
      countsAsExpense: transfer.countsAsExpense === true,
    })),
    periods,
  };
}

describe.skipIf(!database)("TASK-022 listProjectionData lower bound equivalence", () => {
  async function unboundedRows(db: Database, ownerId: string, throughDate: string) {
    const [transactionRows, transferRows] = await Promise.all([
      db.select({
        id: transactions.id,
        transactionDate: transactions.transactionDate,
        kind: transactions.kind,
        status: transactions.status,
        description: transactions.description,
        amountMinor: transactions.amountMinor,
        accountId: transactions.accountId,
        recurringSeriesId: transactions.recurringSeriesId,
        isGenerated: transactions.isGenerated,
      }).from(transactions)
        .where(and(eq(transactions.ownerId, ownerId), eq(transactions.isExcluded, false), lte(transactions.transactionDate, throughDate)))
        .orderBy(transactions.transactionDate, transactions.id),
      db.select({
        id: transfers.id,
        transferDate: transfers.transferDate,
        status: transfers.status,
        description: transfers.description,
        amountMinor: transfers.amountMinor,
        fromAccountId: transfers.fromAccountId,
        toAccountId: transfers.toAccountId,
        recurringSeriesId: transfers.recurringSeriesId,
        isGenerated: transfers.isGenerated,
        countsAsExpense: recurringTransactions.countsAsExpense,
      }).from(transfers)
        .leftJoin(recurringTransactions, eq(recurringTransactions.id, transfers.recurringTransactionId))
        .where(and(eq(transfers.ownerId, ownerId), lte(transfers.transferDate, throughDate)))
        .orderBy(transfers.transferDate, transfers.id),
    ]);
    return { transactionRows, transferRows };
  }

  it("returns consumer-identical data with pastPeriods 2, futurePeriods 3 and includeAll", async () => {
    if (!database) return;
    const ownerId = randomUUID();
    const institutionId = randomUUID();
    const accountA = randomUUID();
    const accountB = randomUUID();
    const accountInactive = randomUUID();
    const seriesId = randomUUID();
    const versionId = randomUUID();
    const rollbackMarker = new Error("cash-flow bounded projection rollback");

    const payDates = ["2026-01-01", "2026-01-15", "2026-01-29", "2026-02-12", "2026-02-26", "2026-03-12"];
    const periodIds = payDates.map(() => randomUUID());

    await expect(
      withDatabaseContext(database as Database, { ownerId, authUserId: ownerId }, async (db) => {
        await db.insert(users).values({ id: ownerId, email: `cashflow-bounds-${ownerId}@athena-vault.local` });
        await db.insert(institutions).values({ id: institutionId, ownerId, name: "Bounds Bank", currency: "CAD" });
        await db.insert(accounts).values([
          { id: accountA, ownerId, institutionId, name: "Chequing", kind: "checking", currency: "CAD", timelineOrder: 0, includeInAvailableCash: true },
          { id: accountB, ownerId, institutionId, name: "Savings", kind: "savings", currency: "CAD", timelineOrder: 1 },
          { id: accountInactive, ownerId, institutionId, name: "Archived", kind: "checking", currency: "CAD", timelineOrder: 2, isActive: false },
        ]);
        await db.insert(cashFlowPeriods).values(payDates.map((payDate, index) => ({
          id: periodIds[index]!,
          ownerId,
          label: `Pay period ${payDate}`,
          startsOn: payDate,
          endsOn: payDates[index + 1] ?? "2026-03-25",
          payDate,
          openingBalanceMinor: 0,
          currency: "CAD" as const,
          status: "planned" as const,
        })));
        // Anchors: account A has history anchors, account B's latest anchor supersedes a snapshot
        // at the same date via the payday check, and the inactive account's anchor is ignored by
        // `listCashFlowAccounts` (it must not widen the bound).
        await db.insert(balanceSnapshots).values([
          { ownerId, accountId: accountA, asOf: "2025-12-10", balanceMinor: 200_000, status: "actual" },
          { ownerId, accountId: accountA, asOf: "2025-12-20", balanceMinor: 210_000, status: "actual" },
          { ownerId, accountId: accountA, asOf: "2026-06-01", balanceMinor: 1, status: "actual" },
          { ownerId, accountId: accountB, asOf: "2025-12-18", balanceMinor: 50_000, status: "planned", isGenerated: false },
          { ownerId, accountId: accountInactive, asOf: "2025-01-01", balanceMinor: 9_999_999, status: "actual" },
        ]);
        await db.insert(cashFlowPaydayChecks).values({
          ownerId,
          accountId: accountB,
          payDate: "2025-12-18",
          projectedBalanceMinor: 50_000,
          actualBalanceMinor: 60_000,
        });
        // Recurring series so a pre-bound recurring row exists (kept regardless of date).
        await db.insert(recurringCashFlowSeries).values({ id: seriesId, ownerId, kind: "expense", state: "ended", endedOn: "2025-12-15" });
        await db.insert(recurringTransactions).values({
          id: versionId,
          ownerId,
          seriesId,
          accountId: accountA,
          kind: "expense",
          frequency: "biweekly",
          description: "Old subscription",
          amountMinor: 1_500,
          startsOn: "2025-11-01",
          endsOn: "2025-12-15",
          effectiveFrom: "2025-11-01",
          nextOccurrenceOn: "2025-12-15",
          status: "actual",
        });
        const txnIds = {
          deadA: randomUUID(),        // manual expense before the bound on account A — droppable
          afterAnchor: randomUUID(),  // between A's latest anchor and the window start — must stay
          unassigned: randomUUID(),   // warning-producing row before the bound — must stay
          inactive: randomUUID(),     // inactive-account row before the bound — must stay
          recurring: randomUUID(),    // recurring row before the bound — must stay
          adjustment: randomUUID(),   // adjustment rows never reach the projection — droppable
          excluded: randomUUID(),     // excluded rows are already filtered — stays absent
          inWindow: randomUUID(),
        };
        await db.insert(transactions).values([
          { id: txnIds.deadA, ownerId, accountId: accountA, transactionDate: "2025-12-11", kind: "expense", status: "actual", isExcluded: false, isGenerated: false, description: "Old manual expense", amountMinor: 5_000 },
          { id: txnIds.afterAnchor, ownerId, accountId: accountA, transactionDate: "2025-12-21", kind: "expense", status: "actual", isExcluded: false, isGenerated: false, description: "Post-anchor spend", amountMinor: 4_000 },
          { id: txnIds.unassigned, ownerId, accountId: null, transactionDate: "2025-12-11", kind: "expense", status: "actual", isExcluded: false, isGenerated: false, description: "Unassigned expense", amountMinor: 1_000 },
          { id: txnIds.inactive, ownerId, accountId: accountInactive, transactionDate: "2025-12-11", kind: "expense", status: "actual", isExcluded: false, isGenerated: false, description: "Archived spend", amountMinor: 2_000 },
          { id: txnIds.recurring, ownerId, accountId: accountA, transactionDate: "2025-12-11", kind: "expense", status: "actual", isExcluded: false, isGenerated: false, description: "Old recurring expense", amountMinor: 1_500, recurringSeriesId: seriesId, recurringTransactionId: versionId },
          { id: txnIds.adjustment, ownerId, accountId: accountA, transactionDate: "2025-12-11", kind: "adjustment", status: "actual", isExcluded: false, isGenerated: false, description: "Opening adjustment", amountMinor: 900 },
          { id: txnIds.excluded, ownerId, accountId: accountA, transactionDate: "2026-01-05", kind: "expense", status: "actual", isExcluded: true, isGenerated: false, description: "Excluded expense", amountMinor: 700 },
          { id: txnIds.inWindow, ownerId, accountId: accountB, transactionDate: "2026-01-20", kind: "income", status: "planned", isExcluded: false, isGenerated: false, description: "In-window income", amountMinor: 3_000 },
        ]);
        const transferIds = {
          dead: randomUUID(),      // pre-bound transfer between A and B — droppable for the bound
          afterAnchor: randomUUID(),
          inactive: randomUUID(),  // warning-producing pre-bound transfer — must stay
          inWindow: randomUUID(),
        };
        await db.insert(transfers).values([
          { id: transferIds.dead, ownerId, fromAccountId: accountA, toAccountId: accountB, transferDate: "2025-12-11", status: "actual", isGenerated: false, description: "Old transfer", amountMinor: 10_000 },
          { id: transferIds.afterAnchor, ownerId, fromAccountId: accountA, toAccountId: accountB, transferDate: "2025-12-22", status: "actual", isGenerated: false, description: "Post-anchor transfer", amountMinor: 5_000 },
          { id: transferIds.inactive, ownerId, fromAccountId: accountInactive, toAccountId: accountB, transferDate: "2025-12-11", status: "actual", isGenerated: false, description: "Archived transfer", amountMinor: 1_000 },
          { id: transferIds.inWindow, ownerId, fromAccountId: accountB, toAccountId: accountA, transferDate: "2026-02-01", status: "planned", isGenerated: false, description: "In-window transfer", amountMinor: 2_500 },
        ]);

        const repository = createCashFlowRepository(db);
        const [windowAll, windowSliced] = await Promise.all([
          repository.getPeriodWindow(ownerId, { asOfIso: "2026-01-20", includeAll: true }),
          repository.getPeriodWindow(ownerId, { asOfIso: "2026-01-20", selectedPeriodId: periodIds[4]!, pastPeriods: 2, futurePeriods: 3 }),
        ]);

        expect(windowAll.periods.map((entry) => entry.period.id)).toEqual(periodIds);
        expect(windowAll.anchors.length).toBeGreaterThan(0);

        const windowStart = payDates[0]!;
        const windowEnd = "2026-03-25";
        const { transactionRows: unboundedTransactions, transferRows: unboundedTransfers } = await unboundedRows(db, ownerId, windowEnd);

        // Lower bound = min per account of its latest anchor on/before the window start:
        // A → 2025-12-20, B → 2025-12-18 ⇒ bound 2025-12-18.
        const expectedBound = "2025-12-18";
        const activeIds: readonly string[] = [accountA, accountB];

        const boundedTransactionIds = new Set(windowAll.projectionTransactions.map((row) => row.id));
        const boundedTransferIds = new Set(windowAll.projectionTransfers.map((row) => row.id));

        // Everything the unbounded query returned is either kept or provably dead input.
        for (const row of unboundedTransactions) {
          if (boundedTransactionIds.has(row.id)) continue;
          expect(row.transactionDate < expectedBound).toBe(true);
          const isWarningRow = (row.kind === "income" || row.kind === "expense")
            && (row.accountId === null || !activeIds.includes(row.accountId) || row.amountMinor > Number.MAX_SAFE_INTEGER);
          expect(isWarningRow || row.recurringSeriesId !== null).toBe(false);
        }
        for (const row of unboundedTransfers) {
          if (boundedTransferIds.has(row.id)) continue;
          expect(row.transferDate < expectedBound).toBe(true);
          const isWarningRow = !activeIds.includes(row.fromAccountId) || !activeIds.includes(row.toAccountId)
            || row.fromAccountId === row.toAccountId || row.amountMinor <= 0 || row.amountMinor > Number.MAX_SAFE_INTEGER;
          expect(isWarningRow).toBe(false);
        }

        // Carve-outs keep consumer-relevant pre-bound rows.
        expect(boundedTransactionIds.has(txnIds.deadA)).toBe(false);
        expect(boundedTransactionIds.has(txnIds.afterAnchor)).toBe(true);
        expect(boundedTransactionIds.has(txnIds.unassigned)).toBe(true);
        expect(boundedTransactionIds.has(txnIds.inactive)).toBe(true);
        expect(boundedTransactionIds.has(txnIds.recurring)).toBe(true);
        expect(boundedTransactionIds.has(txnIds.adjustment)).toBe(false);
        expect(boundedTransactionIds.has(txnIds.excluded)).toBe(false);
        expect(boundedTransactionIds.has(txnIds.inWindow)).toBe(true);
        expect(boundedTransferIds.has(transferIds.dead)).toBe(false);
        expect(boundedTransferIds.has(transferIds.afterAnchor)).toBe(true);
        expect(boundedTransferIds.has(transferIds.inactive)).toBe(true);
        expect(boundedTransferIds.has(transferIds.inWindow)).toBe(true);

        // The chained projection the consumers render is identical for bounded and unbounded inputs.
        const boundedChain = projectChainedCashFlow(projectionInputFor(windowAll, windowAll.projectionTransactions, windowAll.projectionTransfers));
        const unboundedChain = projectChainedCashFlow(projectionInputFor(windowAll, unboundedTransactions, unboundedTransfers));
        expect(boundedChain).toEqual(unboundedChain);

        // In-window rows are untouched by the bound: dead rows all predate the first payday.
        const inWindowTransactionIds = unboundedTransactions.filter((row) => row.transactionDate >= windowStart).map((row) => row.id);
        expect(inWindowTransactionIds.every((id) => boundedTransactionIds.has(id))).toBe(true);
        const inWindowTransferIds = unboundedTransfers.filter((row) => row.transferDate >= windowStart).map((row) => row.id);
        expect(inWindowTransferIds.every((id) => boundedTransferIds.has(id))).toBe(true);

        // The sliced window starts two periods before the selected one and applies the
        // anchor-derived bound from its own first payday (2026-01-29).
        expect(windowSliced.periods.map((entry) => entry.period.id)).toEqual(periodIds.slice(2));
        const slicedTransactionIds = new Set(windowSliced.projectionTransactions.map((row) => row.id));
        expect(slicedTransactionIds.has(txnIds.afterAnchor)).toBe(true);
        expect(slicedTransactionIds.has(txnIds.inWindow)).toBe(true);
        const slicedChain = projectChainedCashFlow(projectionInputFor(windowSliced, windowSliced.projectionTransactions, windowSliced.projectionTransfers));
        const slicedUnboundedChain = projectChainedCashFlow(projectionInputFor(windowSliced, unboundedTransactions, unboundedTransfers));
        expect(slicedChain).toEqual(slicedUnboundedChain);

        throw rollbackMarker;
      }),
    ).rejects.toThrow(rollbackMarker.message);
  });

  it("bounds the scan at the window start when no account has an anchor", async () => {
    if (!database) return;
    const ownerId = randomUUID();
    const institutionId = randomUUID();
    const accountA = randomUUID();
    const rollbackMarker = new Error("cash-flow anchorless bound rollback");

    const payDates = ["2026-01-01", "2026-01-15", "2026-01-29", "2026-02-12"];
    const periodIds = payDates.map(() => randomUUID());

    await expect(
      withDatabaseContext(database as Database, { ownerId, authUserId: ownerId }, async (db) => {
        await db.insert(users).values({ id: ownerId, email: `cashflow-anchorless-${ownerId}@athena-vault.local` });
        await db.insert(institutions).values({ id: institutionId, ownerId, name: "Anchorless Bank", currency: "CAD" });
        await db.insert(accounts).values([
          { id: accountA, ownerId, institutionId, name: "Chequing", kind: "checking", currency: "CAD", timelineOrder: 0, includeInAvailableCash: true },
        ]);
        await db.insert(cashFlowPeriods).values(payDates.map((payDate, index) => ({
          id: periodIds[index]!,
          ownerId,
          label: `Pay period ${payDate}`,
          startsOn: payDate,
          endsOn: payDates[index + 1] ?? "2026-02-25",
          payDate,
          openingBalanceMinor: 0,
          currency: "CAD" as const,
          status: "planned" as const,
        })));
        const staleId = randomUUID();
        const inWindowId = randomUUID();
        await db.insert(transactions).values([
          { id: staleId, ownerId, accountId: accountA, transactionDate: "2025-06-01", kind: "expense", status: "actual", isExcluded: false, isGenerated: false, description: "Pre-window expense", amountMinor: 9_900 },
          { id: inWindowId, ownerId, accountId: accountA, transactionDate: "2026-01-10", kind: "income", status: "actual", isExcluded: false, isGenerated: false, description: "Window income", amountMinor: 8_000 },
        ]);

        const repository = createCashFlowRepository(db);
        const window = await repository.getPeriodWindow(ownerId, { asOfIso: "2026-01-20", pastPeriods: 2, futurePeriods: 3 });
        const ids = new Set(window.projectionTransactions.map((row) => row.id));
        expect(ids.has(staleId)).toBe(false);
        expect(ids.has(inWindowId)).toBe(true);

        const windowEnd = "2026-02-25";
        const { transactionRows: unboundedTransactions, transferRows: unboundedTransfers } = await unboundedRows(db, ownerId, windowEnd);
        const boundedChain = projectChainedCashFlow(projectionInputFor(window, window.projectionTransactions, window.projectionTransfers));
        const unboundedChain = projectChainedCashFlow(projectionInputFor(window, unboundedTransactions, unboundedTransfers));
        expect(boundedChain).toEqual(unboundedChain);

        throw rollbackMarker;
      }),
    ).rejects.toThrow(rollbackMarker.message);
  });
});
