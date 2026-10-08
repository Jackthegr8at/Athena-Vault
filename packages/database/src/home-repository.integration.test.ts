import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type Database } from "./client";
import { createHomeRepository } from "./home";
import { expectIntegrationRollback } from "./integration-test-helpers";
import { householdExpenses, users } from "./drizzle-schema";

const connectionString = process.env.DATABASE_URL;
const database = connectionString ? createDatabase(connectionString) : undefined;
const ownerA = "00000000-0000-0000-0000-0000000000ea";
const ownerB = "00000000-0000-0000-0000-0000000000eb";

describe.skipIf(!database)("Home property repository", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-05T16:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps owners isolated, snapshots the linked payment, carries values, and preserves actual mortgage anchors", async () => {
    if (!database) return;
    const rollbackMarker = new Error("Home repository integration rollback");

    await expectIntegrationRollback(database.transaction(async (tx) => {
      await tx.insert(users).values([
        { id: ownerA, email: "home-owner-a@athena-vault.local" },
        { id: ownerB, email: "home-owner-b@athena-vault.local" },
      ]);
      const [hypo] = await tx.insert(householdExpenses).values({
        ownerId: ownerA,
        name: "Hypo",
        category: "home",
        frequency: "biweekly",
        amountMinor: 2_500,
        annualAmountMinor: 65_000,
        currency: "CAD",
      }).returning({ id: householdExpenses.id });
      if (!hypo) throw new Error("Hypo fixture was not created.");

      const repository = createHomeRepository(tx as unknown as Database);
      expect(await repository.getHome(ownerA)).toBeNull();
      await repository.createHome(ownerA);
      await repository.upsertMarketValue(ownerA, { asOf: "2026-08-05", marketValueMinor: 500_000 });
      await repository.upsertMortgageAnchor(ownerA, { asOf: "2026-08-05", principalMinor: 100_000 });
      await repository.saveMortgageTerms(ownerA, {
        effectiveOn: "2026-08-05",
        annualRateBps: 0,
        compoundingConvention: "canadian_semi_annual",
        paymentExpenseId: hypo.id,
        nextPaymentOn: "2026-08-19",
        renewalOn: "2029-08-05",
        payoffOn: "2051-08-05",
      });

      await tx.update(householdExpenses).set({ amountMinor: 3_000, annualAmountMinor: 78_000 }).where(and(eq(householdExpenses.ownerId, ownerA), eq(householdExpenses.id, hypo.id)));
      await repository.upsertMarketValue(ownerA, { asOf: "2026-09-02", marketValueMinor: 510_000 });

      const home = await repository.getHome(ownerA);
      expect(home).toMatchObject({ mortgageConfigured: true, currentEquityMinor: 400_000 });
      expect(home?.mortgageTerms[0]).toMatchObject({ paymentExpenseName: "Hypo", paymentMinor: 2_500 });
      expect(home?.timeline.find((row) => row.asOf === "2026-08-19")).toMatchObject({ marketValueMinor: 500_000, marketValueStatus: "projected", mortgagePrincipalMinor: 97_500, mortgageStatus: "projected", equityMinor: 402_500 });
      expect(home?.timeline.find((row) => row.asOf === "2026-09-02")).toMatchObject({ marketValueMinor: 510_000, mortgagePrincipalMinor: 95_000, mortgageStatus: "projected", equityMinor: 415_000 });
      expect(await repository.getCurrentEquity(ownerA, "2026-09-02")).toBe(415_000);

      await expect(repository.upsertMarketValue(ownerB, { asOf: "2026-08-05", marketValueMinor: 1 })).rejects.toThrow("Home profile not found");
      expect(await repository.getHome(ownerB)).toBeNull();

      throw rollbackMarker;
    }), rollbackMarker);
  });
});
