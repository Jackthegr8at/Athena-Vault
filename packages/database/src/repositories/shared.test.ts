import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createDatabase, type Database } from "../client";
import { addIsoDays } from "../account-contributions";
import { cashFlowEndingBalancesByAccountAndPayDate, cashFlowHistoryLowerBound } from "./shared";
import { createAccountTimelineRepository } from "./account-timeline";
import { toTorontoDateIso } from "../account-timeline";
import {
  accounts,
  balanceSnapshots,
  cashFlowPaydayChecks,
  cashFlowPeriods,
  institutions,
  transactions,
  transfers,
  users,
} from "../drizzle-schema";

const connectionString = process.env.DATABASE_URL;
const database = connectionString ? createDatabase(connectionString) : undefined;

describe("cashFlowHistoryLowerBound", () => {
  const firstPayDate = "2026-01-16";

  it("returns null when an account has no anchors", () => {
    expect(cashFlowHistoryLowerBound(["a", "b"], [], firstPayDate)).toBeNull();
    expect(cashFlowHistoryLowerBound(
      ["a", "b"],
      [{ accountId: "a", asOf: "2026-01-01" }],
      firstPayDate,
    )).toBeNull();
  });

  it("returns the minimum latest anchor on or before the first pay date", () => {
    expect(cashFlowHistoryLowerBound(
      ["a", "b"],
      [
        { accountId: "a", asOf: "2025-06-01" },
        { accountId: "a", asOf: "2026-01-10" },
        { accountId: "b", asOf: "2025-12-30" },
      ],
      firstPayDate,
    )).toBe("2025-12-30");
  });

  it("ignores anchors after the first pay date", () => {
    expect(cashFlowHistoryLowerBound(
      ["a"],
      [
        { accountId: "a", asOf: "2026-01-02" },
        { accountId: "a", asOf: "2026-03-01" },
      ],
      firstPayDate,
    )).toBe("2026-01-02");
  });

  it("returns null when every anchor is after the first pay date", () => {
    expect(cashFlowHistoryLowerBound(
      ["a"],
      [{ accountId: "a", asOf: "2026-02-01" }],
      firstPayDate,
    )).toBeNull();
  });

  it("treats an anchor on the first pay date as qualifying (same-day tie)", () => {
    expect(cashFlowHistoryLowerBound(
      ["a", "b"],
      [
        { accountId: "a", asOf: "2026-01-16" },
        { accountId: "b", asOf: "2025-11-01" },
      ],
      firstPayDate,
    )).toBe("2025-11-01");
  });

  it("ignores anchors belonging to other owners' accounts", () => {
    expect(cashFlowHistoryLowerBound(
      ["a"],
      [
        { accountId: "foreign", asOf: "2020-01-01" },
        { accountId: "a", asOf: "2026-01-05" },
      ],
      firstPayDate,
    )).toBe("2026-01-05");
  });
});

describe.skipIf(!database)("cashFlowEndingBalancesByAccountAndPayDate history bound", () => {
  it("produces identical balances with the derived bound and with unbounded history", async () => {
    if (!database) return;

    const owner = randomUUID();
    const institutionId = randomUUID();
    const accountA = randomUUID();
    const accountB = randomUUID();
    const anchorEarly = "2024-06-01";
    const firstPayDate = "2024-06-14";
    // ~2.5 years of biweekly periods.
    const payDates = Array.from({ length: 66 }, (_, index) => addIsoDays(firstPayDate, index * 14));

    const rollbackMarker = new Error("history bound rollback");
    await expect(
      database.transaction(async (tx) => {
        await tx.insert(users).values({ id: owner, email: `history-bound-${owner}@athena-vault.local` });
        await tx.insert(institutions).values({ id: institutionId, ownerId: owner, name: "History Bound Bank", currency: "CAD" });
        await tx.insert(accounts).values([
          { id: accountA, ownerId: owner, institutionId, name: "Chequing", kind: "checking", currency: "CAD", timelineOrder: 0, includeInAvailableCash: true, useCashFlowPlannedTimeline: true },
          { id: accountB, ownerId: owner, institutionId, name: "Savings", kind: "savings", currency: "CAD", timelineOrder: 1, includeInAvailableCash: true, useCashFlowPlannedTimeline: true },
        ]);
        await tx.insert(cashFlowPeriods).values(payDates.map((payDate) => ({
          ownerId: owner,
          label: `Pay period ${payDate}`,
          startsOn: addIsoDays(payDate, -13),
          endsOn: payDate,
          payDate,
          openingBalanceMinor: 0,
          currency: "CAD" as const,
          status: "planned" as const,
        })));

        // Anchors: A anchored well before the first pay date; B anchored on the
        // first pay date itself (same-day tie). A payday check on B later in the
        // window supersedes a snapshot on the same date.
        const laterCheckDate = payDates[40]!;
        await tx.insert(balanceSnapshots).values([
          { ownerId: owner, accountId: accountA, asOf: anchorEarly, balanceMinor: 1_000_00, status: "actual", isGenerated: false, currency: "CAD" },
          { ownerId: owner, accountId: accountB, asOf: firstPayDate, balanceMinor: 500_00, status: "actual", isGenerated: false, currency: "CAD" },
          { ownerId: owner, accountId: accountB, asOf: laterCheckDate, balanceMinor: 999_00, status: "actual", isGenerated: false, currency: "CAD" },
        ]);
        await tx.insert(cashFlowPaydayChecks).values({
          ownerId: owner,
          accountId: accountB,
          payDate: laterCheckDate,
          projectedBalanceMinor: 900_00,
          actualBalanceMinor: 888_00,
        });

        // History both before the derived bound (must not affect balances) and
        // after it (must affect them), including a same-day-as-anchor event.
        await tx.insert(transactions).values([
          { ownerId: owner, accountId: accountA, transactionDate: "2024-05-20", kind: "income", amountMinor: 777_00, status: "actual", description: "Pre-bound income" },
          { ownerId: owner, accountId: accountA, transactionDate: anchorEarly, kind: "expense", amountMinor: 100_00, status: "actual", description: "Same-day expense" },
          { ownerId: owner, accountId: accountA, transactionDate: "2024-07-01", kind: "expense", amountMinor: 50_00, status: "actual", description: "Post-anchor expense" },
          { ownerId: owner, accountId: accountA, transactionDate: "2025-01-15", kind: "income", amountMinor: 200_00, status: "planned", description: "Planned income" },
          { ownerId: owner, accountId: accountA, transactionDate: "2025-02-01", kind: "expense", amountMinor: 30_00, status: "actual", isExcluded: true, description: "Excluded expense" },
        ]);
        await tx.insert(transfers).values([
          { ownerId: owner, fromAccountId: accountA, toAccountId: accountB, transferDate: "2024-05-25", amountMinor: 999_00, status: "actual", description: "Pre-bound transfer" },
          { ownerId: owner, fromAccountId: accountA, toAccountId: accountB, transferDate: "2024-08-02", amountMinor: 250_00, status: "actual", description: "Post-bound transfer" },
        ]);

        const boundedEndings = await cashFlowEndingBalancesByAccountAndPayDate(tx as unknown as Database, owner, "ending");
        const unboundedEndings = await cashFlowEndingBalancesByAccountAndPayDate(tx as unknown as Database, owner, "ending", { historyLowerBound: null });
        const boundedOpenings = await cashFlowEndingBalancesByAccountAndPayDate(tx as unknown as Database, owner, "opening");
        const unboundedOpenings = await cashFlowEndingBalancesByAccountAndPayDate(tx as unknown as Database, owner, "opening", { historyLowerBound: null });

        expect(boundedEndings.size).toBeGreaterThan(0);
        expect(boundedEndings).toEqual(unboundedEndings);
        expect(boundedOpenings).toEqual(unboundedOpenings);

        // NOTE-010: a preloaded period list produces the same result and skips
        // the duplicate cash_flow_periods select.
        const periodRows = await tx.select({
          id: cashFlowPeriods.id,
          label: cashFlowPeriods.label,
          payDate: cashFlowPeriods.payDate,
          startsOn: cashFlowPeriods.startsOn,
          endsOn: cashFlowPeriods.endsOn,
        }).from(cashFlowPeriods).where(eq(cashFlowPeriods.ownerId, owner));
        const preloadedEndings = await cashFlowEndingBalancesByAccountAndPayDate(tx as unknown as Database, owner, "ending", { periods: periodRows });
        expect(preloadedEndings).toEqual(boundedEndings);

        throw rollbackMarker;
      }),
    ).rejects.toThrow(rollbackMarker.message);
  });

  it("keeps results identical when an unanchored account disables the bound", async () => {
    if (!database) return;

    const owner = randomUUID();
    const institutionId = randomUUID();
    const anchoredAccount = randomUUID();
    const unanchoredAccount = randomUUID();
    const firstPayDate = "2025-01-10";
    const payDates = Array.from({ length: 30 }, (_, index) => addIsoDays(firstPayDate, index * 14));

    const rollbackMarker = new Error("unanchored bound rollback");
    await expect(
      database.transaction(async (tx) => {
        await tx.insert(users).values({ id: owner, email: `history-bound-mixed-${owner}@athena-vault.local` });
        await tx.insert(institutions).values({ id: institutionId, ownerId: owner, name: "Mixed Bank", currency: "CAD" });
        await tx.insert(accounts).values([
          { id: anchoredAccount, ownerId: owner, institutionId, name: "Anchored", kind: "checking", currency: "CAD", timelineOrder: 0, includeInAvailableCash: true, useCashFlowPlannedTimeline: true },
          { id: unanchoredAccount, ownerId: owner, institutionId, name: "Unanchored", kind: "savings", currency: "CAD", timelineOrder: 1, includeInAvailableCash: true, useCashFlowPlannedTimeline: true },
        ]);
        await tx.insert(cashFlowPeriods).values(payDates.map((payDate) => ({
          ownerId: owner,
          label: `Pay period ${payDate}`,
          startsOn: addIsoDays(payDate, -13),
          endsOn: payDate,
          payDate,
          openingBalanceMinor: 0,
          currency: "CAD" as const,
          status: "planned" as const,
        })));
        await tx.insert(balanceSnapshots).values({
          ownerId: owner,
          accountId: anchoredAccount,
          asOf: "2025-01-01",
          balanceMinor: 700_00,
          status: "actual",
          isGenerated: false,
          currency: "CAD",
        });
        await tx.insert(transactions).values([
          { ownerId: owner, accountId: anchoredAccount, transactionDate: "2024-11-01", kind: "expense" as const, amountMinor: 40_00, status: "actual" as const, description: "Pre-anchor expense" },
          { ownerId: owner, accountId: unanchoredAccount, transactionDate: "2024-11-01", kind: "expense" as const, amountMinor: 15_00, status: "actual" as const, description: "Unanchored expense" },
        ]);

        const bounded = await cashFlowEndingBalancesByAccountAndPayDate(tx as unknown as Database, owner, "ending");
        const unbounded = await cashFlowEndingBalancesByAccountAndPayDate(tx as unknown as Database, owner, "ending", { historyLowerBound: null });
        expect(bounded).toEqual(unbounded);

        throw rollbackMarker;
      }),
    ).rejects.toThrow(rollbackMarker.message);
  });
});

describe.skipIf(!database)("batched projection writes and reorder", () => {
  it("recalculateAllAccountProjections + reorderAccounts + extendTimeline keep owner state consistent", async () => {
    if (!database) return;

    const owner = randomUUID();
    const institutionId = randomUUID();
    const accountA = randomUUID();
    const accountB = randomUUID();
    const todayIso = toTorontoDateIso();
    const firstPayDate = addIsoDays(todayIso, 14);
    const payDates = Array.from({ length: 8 }, (_, index) => addIsoDays(firstPayDate, index * 14));

    const rollbackMarker = new Error("batched writes rollback");
    await expect(
      database.transaction(async (tx) => {
        const repository = createAccountTimelineRepository(tx as unknown as Database);
        await tx.insert(users).values({ id: owner, email: `batched-writes-${owner}@athena-vault.local` });
        await tx.insert(institutions).values({ id: institutionId, ownerId: owner, name: "Batch Bank", currency: "CAD" });
        await tx.insert(accounts).values([
          { id: accountA, ownerId: owner, institutionId, name: "Chequing", kind: "checking", currency: "CAD", timelineOrder: 0 },
          { id: accountB, ownerId: owner, institutionId, name: "Savings", kind: "savings", currency: "CAD", timelineOrder: 1 },
        ]);
        await tx.insert(cashFlowPeriods).values(payDates.map((payDate) => ({
          ownerId: owner,
          label: `Pay period ${payDate}`,
          startsOn: addIsoDays(payDate, -13),
          endsOn: payDate,
          payDate,
          openingBalanceMinor: 0,
          currency: "CAD" as const,
          status: "planned" as const,
        })));
        await tx.insert(balanceSnapshots).values({
          ownerId: owner,
          accountId: accountA,
          asOf: todayIso,
          balanceMinor: 2_000_00,
          status: "actual",
          isGenerated: false,
          currency: "CAD",
        });

        const result = await repository.recalculateAllAccountProjections(owner);
        expect(result.accountCount).toBe(2);
        expect(result.snapshotsCreated).toBeGreaterThan(0);

        const snapshotRows = await tx.select({
          accountId: balanceSnapshots.accountId,
          asOf: balanceSnapshots.asOf,
          balanceMinor: balanceSnapshots.balanceMinor,
          status: balanceSnapshots.status,
          isGenerated: balanceSnapshots.isGenerated,
        }).from(balanceSnapshots).where(eq(balanceSnapshots.ownerId, owner));
        // Every generated cell must be a planned generated snapshot dated on a payday.
        const generated = snapshotRows.filter((row) => row.isGenerated);
        expect(generated.length).toBe(result.snapshotsCreated);
        for (const row of generated) {
          expect(row.status).toBe("planned");
          expect(payDates).toContain(row.asOf);
        }

        const reorder = await repository.reorderAccounts(owner, "liquid", [accountB, accountA]);
        expect(reorder.accountIds).toEqual([accountB, accountA]);
        const orderedAccounts = await tx.select({ id: accounts.id, timelineOrder: accounts.timelineOrder })
          .from(accounts)
          .where(eq(accounts.ownerId, owner));
        expect(new Map(orderedAccounts.map((row) => [row.id, row.timelineOrder])))
          .toEqual(new Map([[accountB, 0], [accountA, 1]]));

        const extension = await repository.extendTimeline(owner, addIsoDays(payDates.at(-1)!, 42));
        expect(extension.periodsCreated).toBe(3);
        expect(extension.snapshotsCreated).toBeGreaterThan(0);

        throw rollbackMarker;
      }),
    ).rejects.toThrow(rollbackMarker.message);
  });
});
