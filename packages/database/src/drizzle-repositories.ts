import { and, asc, eq, lte, or, sql } from "drizzle-orm";
import { toTorontoDateIso } from "./account-timeline";
import type { Database } from "./client";
import type { DrizzleAccountKind, DrizzleCurrencyCode } from "./drizzle-schema";
import { accounts, balanceSnapshots, cashFlowPaydayChecks, institutions } from "./drizzle-schema";

export interface AccountEffectiveBalance {
  readonly accountId: string;
  readonly asOf: string;
  readonly balanceMinor: number;
}

/**
 * Merges the latest balance snapshot and payday check for one account.
 * A payday check supersedes a snapshot at the same as_of, matching the
 * previous cross-source precedence of the JS reduction.
 */
export function pickLatestEffectiveBalance(
  snapshot: AccountEffectiveBalance | undefined,
  paydayCheck: AccountEffectiveBalance | undefined,
): AccountEffectiveBalance | undefined {
  if (!paydayCheck) return snapshot;
  if (!snapshot) return paydayCheck;
  return paydayCheck.asOf >= snapshot.asOf ? paydayCheck : snapshot;
}

export function createAccountRepository(db: Database) {
  return {
    async listByOwner(ownerId: string) {
      return db.select().from(accounts).where(eq(accounts.ownerId, ownerId)).orderBy(accounts.name);
    },
    async listWithLatestBalances(ownerId: string, asOf = toTorontoDateIso()) {
      const rankedSnapshots = db.$with("ranked_balance_snapshots").as(
        db.select({
          accountId: balanceSnapshots.accountId,
          asOf: balanceSnapshots.asOf,
          balanceMinor: balanceSnapshots.balanceMinor,
          rn: sql<number>`row_number() over (partition by ${balanceSnapshots.accountId} order by ${balanceSnapshots.asOf} desc, ${balanceSnapshots.id} desc)`.as("rn"),
        }).from(balanceSnapshots)
          .where(and(
            eq(balanceSnapshots.ownerId, ownerId),
            lte(balanceSnapshots.asOf, asOf),
            or(eq(balanceSnapshots.status, "actual"), and(eq(balanceSnapshots.status, "planned"), eq(balanceSnapshots.isGenerated, false))),
          )),
      );
      const rankedPaydayChecks = db.$with("ranked_payday_checks").as(
        db.select({
          accountId: cashFlowPaydayChecks.accountId,
          asOf: cashFlowPaydayChecks.payDate,
          balanceMinor: cashFlowPaydayChecks.actualBalanceMinor,
          rn: sql<number>`row_number() over (partition by ${cashFlowPaydayChecks.accountId} order by ${cashFlowPaydayChecks.payDate} desc, ${cashFlowPaydayChecks.id} desc)`.as("rn"),
        }).from(cashFlowPaydayChecks)
          .where(and(eq(cashFlowPaydayChecks.ownerId, ownerId), lte(cashFlowPaydayChecks.payDate, asOf))),
      );
      const [accountRows, snapshotRows, paydayCheckRows] = await Promise.all([
        db.select({
          id: accounts.id,
          name: accounts.name,
          kind: accounts.kind,
          currency: accounts.currency,
          institution: institutions.name,
          includeInAvailableCash: accounts.includeInAvailableCash,
          isActive: accounts.isActive,
        }).from(accounts)
          .innerJoin(institutions, and(eq(institutions.id, accounts.institutionId), eq(institutions.ownerId, ownerId)))
          .where(eq(accounts.ownerId, ownerId))
          .orderBy(asc(accounts.name), asc(accounts.id)),
        db.with(rankedSnapshots).select({
          accountId: rankedSnapshots.accountId,
          asOf: rankedSnapshots.asOf,
          balanceMinor: rankedSnapshots.balanceMinor,
        }).from(rankedSnapshots)
          .where(sql`rn = 1`),
        db.with(rankedPaydayChecks).select({
          accountId: rankedPaydayChecks.accountId,
          asOf: rankedPaydayChecks.asOf,
          balanceMinor: rankedPaydayChecks.balanceMinor,
        }).from(rankedPaydayChecks)
          .where(sql`rn = 1`),
      ]);
      const latestSnapshotByAccount = new Map(snapshotRows.map((row) => [row.accountId, row] as const));
      const latestCheckByAccount = new Map(paydayCheckRows.map((row) => [row.accountId, row] as const));
      return accountRows.map((account) => {
        const latest = pickLatestEffectiveBalance(latestSnapshotByAccount.get(account.id), latestCheckByAccount.get(account.id));
        return {
          id: account.id,
          name: account.name,
          kind: account.kind,
          currency: account.currency,
          institution: account.institution,
          includeInAvailableCash: account.includeInAvailableCash,
          asOf: latest?.asOf ?? null,
          balanceMinor: latest?.balanceMinor ?? null,
          isActive: account.isActive,
        };
      });
    },
    async create(input: { ownerId: string; institutionId: string; groupId?: string | null; name: string; kind: DrizzleAccountKind; currency: DrizzleCurrencyCode }) {
      const [created] = await db.insert(accounts).values(input).returning();
      if (!created) throw new Error("Account insert returned no row");
      return created;
    },
  };
}
