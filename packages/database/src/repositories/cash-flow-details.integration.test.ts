import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDatabase } from "../client";
import { users, institutions, accounts, transactions } from "../drizzle-schema";
import { createCashFlowRepository } from "./cash-flow";
const url = process.env.ATHENA_SYNTHETIC_TEST_DATABASE_URL;
const db = url ? createDatabase(url) : undefined;
describe.skipIf(!db)("deferred Cash Flow synthetic database", () => {
  it("counts only owner excluded expenses and respects application-role isolation", async () => {
    if (!db) return;
    const marker = new Error("synthetic rollback");
    await expect(db.transaction(async tx => {
      const owners = ["00000000-0000-0000-0000-00000000f401", "00000000-0000-0000-0000-00000000f402"];
      for (const [index, ownerId] of owners.entries()) {
        await tx.insert(users).values({ id: ownerId, email: `synthetic-details-${index}@example.invalid` });
        const [bank] = await tx.insert(institutions).values({ ownerId, name: "Synthetic Bank", currency: "CAD" }).returning();
        const [account] = await tx.insert(accounts).values({ ownerId, institutionId: bank!.id, name: "Synthetic cash", kind: "checking", currency: "CAD" }).returning();
        await tx.insert(transactions).values([
          { ownerId, accountId: account!.id, kind: "expense", description: "Synthetic excluded", amountMinor: 100, transactionDate: "2030-01-01", status: "planned", isExcluded: true },
          { ownerId, accountId: account!.id, kind: "expense", description: "Synthetic included", amountMinor: 100, transactionDate: "2030-01-01", status: "planned", isExcluded: false },
        ]);
      }
      const repo = createCashFlowRepository(tx as unknown as Parameters<typeof createCashFlowRepository>[0]);
      for (const owner of owners) {
        expect(await repo.countExcludedExpenses(owner)).toBe(1);
        expect(await repo.listExcludedExpenses(owner)).toHaveLength(1);
        expect(await repo.getRecurringEditorDetails(owner)).toEqual([]);
      }
      await tx.execute(sql`select set_config('app.owner_id', ${owners[0]}, true)`);
      await tx.execute(sql`set local role athena_app`);
      expect(await repo.countExcludedExpenses(owners[1]!)).toBe(0);
      expect(await repo.listExcludedExpenses(owners[1]!)).toEqual([]);
      throw marker;
    })).rejects.toBe(marker);
  });
});
