import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDatabase, withDatabaseObservation } from "../client";
import { users, institutions, accounts, cashFlowPeriods, balanceSnapshots, accountBalanceNotes, cashFlowPaydayChecks } from "../drizzle-schema";
import { createAccountTimelineRepository } from "./account-timeline";
// Dedicated explicit opt-in only; never consume the application's DATABASE_URL.
const url = process.env.ATHENA_SYNTHETIC_TEST_DATABASE_URL;
const db = url ? createDatabase(url) : undefined;
describe.skipIf(!db)("bounded Accounts timeline synthetic database", () => {
  it("matches visible full-history values for two owners, archives, notes, checks and CF overlays", async () => {
    if (!db) return;
    const marker = new Error("synthetic test rollback");
    let fullRows = 0; let boundedRows = 0;
    const boundedQueries: number[] = [];
    await expect(db.transaction(async tx => {
      const owners = ["00000000-0000-0000-0000-00000000f301", "00000000-0000-0000-0000-00000000f302"];
      await tx.insert(users).values(owners.map((id, i) => ({ id, email: `synthetic-${i}@example.invalid` })));
      for (const ownerId of owners) {
        const [bank] = await tx.insert(institutions).values({ ownerId, name: "Synthetic Bank", currency: "CAD" }).returning();
        const rows = await tx.insert(accounts).values([
          { ownerId, institutionId: bank!.id, name: "Synthetic active", kind: "checking" as const, currency: "CAD" as const, useCashFlowPlannedTimeline: true },
          { ownerId, institutionId: bank!.id, name: "Synthetic archived", kind: "savings" as const, currency: "CAD" as const, isActive: false },
        ]).returning();
        const dates = Array.from({ length: 40 }, (_, i) => new Date(Date.UTC(2030, 0, 1 + 14 * i)).toISOString().slice(0, 10));
        await tx.insert(cashFlowPeriods).values(dates.map((date, i) => ({ ownerId, label: `Synthetic ${i}`, payDate: date, startsOn: date, endsOn: date, status: "planned" as const, openingBalanceMinor: 0 })));
        for (const account of rows) {
          await tx.insert(balanceSnapshots).values(dates.map((date, i) => ({ ownerId, accountId: account.id, asOf: date, balanceMinor: i * 100, status: i < 10 ? "actual" as const : "planned" as const, isGenerated: i !== 15, currency: "CAD" as const })));
          await tx.insert(accountBalanceNotes).values({ ownerId, accountId: account.id, asOf: dates[20]!, note: "Synthetic note" });
          await tx.insert(cashFlowPaydayChecks).values({ ownerId, accountId: account.id, payDate: dates[20]!, actualBalanceMinor: 9999, projectedBalanceMinor: 2000 });
        }
        const repo = createAccountTimelineRepository(tx as unknown as Parameters<typeof createAccountTimelineRepository>[0]);
        for (const includeArchived of [false, true]) {
          const full = await repo.getTimeline(ownerId, { includeArchived, selectedDate: dates[20] });
          const bounded = await withDatabaseObservation("synthetic-bounded", () => repo.getTimelineWindow(ownerId, { includeArchived, todayIso: dates[20]!, selectedDate: dates[20], pastPeriods: 1, futurePeriods: 1 }), { onObservation: event => boundedQueries.push(event.queryCount) });
          expect(bounded.paydays).toEqual(full.paydays);
          expect(bounded.selectedValues).toEqual(full.selectedValues);
          expect(bounded.accounts.map(a => a.id)).toEqual(full.accounts.map(a => a.id));
          for (const account of bounded.accounts) {
            const original = full.accounts.find(a => a.id === account.id)!;
            const visible = (date: string) => date >= dates[19]! && date <= dates[21]!;
            expect(account.snapshots.filter(s => visible(s.asOf))).toEqual(original.snapshots.filter(s => visible(s.asOf)));
            expect(account.notes).toEqual(original.notes.filter(n => visible(n.asOf)));
            expect(account.snapshots.some(s => s.status === "actual" && s.asOf < dates[19]!)).toBe(true);
            fullRows += original.snapshots.length; boundedRows += account.snapshots.length;
          }
        }
      }
      expect(boundedRows).toBeLessThan(fullRows);
      expect(new Set(boundedQueries).size).toBe(1);
      const plan = await tx.execute(sql`explain (format json) select id from balance_snapshots where owner_id = ${owners[0]} and as_of between '2030-09-01' and '2030-11-01'`);
      expect(plan.length).toBeGreaterThan(0);
      await tx.execute(sql`select set_config('app.owner_id', ${owners[0]}, true)`);
      await tx.execute(sql`set local role athena_app`);
      const isolatedRepo = createAccountTimelineRepository(tx as unknown as Parameters<typeof createAccountTimelineRepository>[0]);
      expect((await isolatedRepo.getTimelineWindow(owners[1]!, { todayIso: "2030-10-08" })).accounts).toEqual([]);
      throw marker;
    })).rejects.toBe(marker);
    console.log(JSON.stringify({ synthetic: true, fullSnapshotRows: fullRows, boundedSnapshotRows: boundedRows, boundedQueries }));
  });
});
