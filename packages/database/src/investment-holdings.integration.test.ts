import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDatabase, type Database } from "./client";
import { createInvestmentHoldingsRepository } from "./repositories/investment-holdings";
import { expectIntegrationRollback } from "./integration-test-helpers";
import {
  accounts,
  auditEvents,
  balanceSnapshots,
  institutions,
  investmentHoldingPrices,
  investmentHoldingTransactions,
  investmentHoldings,
  users,
} from "./drizzle-schema";

const connectionString = process.env.DATABASE_URL;
const database = connectionString ? createDatabase(connectionString) : undefined;

describe.skipIf(!database)("investment holdings repository", () => {
  it("keeps multiple mutual-fund/ETF positions owner-scoped and replays exact ledger state", async () => {
    if (!database) return;

    const ownerA = "00000000-0000-4000-8000-0000000000a1";
    const ownerB = "00000000-0000-4000-8000-0000000000b1";
    const institutionA = "10000000-0000-4000-8000-0000000000a1";
    const institutionB = "10000000-0000-4000-8000-0000000000b1";
    const rdspAccountA = "20000000-0000-4000-8000-0000000000a1";
    const ordinaryAccountA = "20000000-0000-4000-8000-0000000000a2";
    const rdspAccountB = "20000000-0000-4000-8000-0000000000b1";
    const balanceIdAOlder = "30000000-0000-4000-8000-0000000000a1";
    const balanceIdANewer = "30000000-0000-4000-8000-0000000000a2";
    const balanceIdBEarlier = "30000000-0000-4000-8000-0000000000b1";
    const balanceIdBLater = "30000000-0000-4000-8000-0000000000b2";
    const rollbackMarker = new Error("investment holdings integration rollback");

    await expectIntegrationRollback(database.transaction(async (tx) => {
      await tx.insert(users).values([
        { id: ownerA, email: "investment-holdings-owner-a@athena-vault.local" },
        { id: ownerB, email: "investment-holdings-owner-b@athena-vault.local" },
      ]);
      await tx.insert(institutions).values([
        { id: institutionA, ownerId: ownerA, name: "Holdings institution A", currency: "CAD" },
        { id: institutionB, ownerId: ownerB, name: "Holdings institution B", currency: "CAD" },
      ]);
      await tx.insert(accounts).values([
        { id: rdspAccountA, ownerId: ownerA, institutionId: institutionA, name: "REEI A", kind: "rdsp", currency: "CAD" },
        { id: ordinaryAccountA, ownerId: ownerA, institutionId: institutionA, name: "Not a REEI", kind: "checking", currency: "CAD" },
        { id: rdspAccountB, ownerId: ownerB, institutionId: institutionB, name: "REEI B", kind: "rdsp", currency: "CAD" },
      ]);
      await tx.insert(balanceSnapshots).values([
        { id: balanceIdAOlder, ownerId: ownerA, accountId: rdspAccountA, asOf: "2026-09-01", balanceMinor: 100_000, status: "actual", currency: "CAD" },
        { id: balanceIdANewer, ownerId: ownerA, accountId: rdspAccountA, asOf: "2026-09-08", balanceMinor: 144_850, status: "actual", currency: "CAD" },
        { id: balanceIdBEarlier, ownerId: ownerB, accountId: rdspAccountB, asOf: "2026-09-08", balanceMinor: 50_000, status: "actual", currency: "CAD" },
        { id: balanceIdBLater, ownerId: ownerB, accountId: rdspAccountB, asOf: "2026-09-15", balanceMinor: 60_000, status: "actual", currency: "CAD" },
      ]);

      const repository = createInvestmentHoldingsRepository(tx as unknown as Database);
      const mutualFundId = await repository.createHolding(ownerA, { accountId: rdspAccountA, instrumentType: "mutual_fund", symbol: "RBF123", name: "Balanced fund", currency: "CAD" });
      const repeatedMutualFundId = await repository.createHolding(ownerA, { accountId: rdspAccountA, instrumentType: "mutual_fund", symbol: "RBF123", name: "Balanced fund - second position", currency: "CAD" });
      const etfId = await repository.createHolding(ownerA, { accountId: rdspAccountA, instrumentType: "etf", symbol: "XBAL.TO", name: "US ETF position", currency: "USD" });
      const ownerBHoldingId = await repository.createHolding(ownerB, { accountId: rdspAccountB, instrumentType: "etf", symbol: "VTI", name: "Owner B ETF", currency: "USD" });

      const openingId = await repository.createTransaction(ownerA, mutualFundId, {
        occurredOn: "2026-09-01", kind: "opening", unitsMicros: 10_000_000, amountMinor: 100_000, feeMinor: 0, note: "Statement opening position",
      });
      await repository.createTransaction(ownerA, mutualFundId, {
        occurredOn: "2026-09-02", kind: "buy", unitsMicros: 5_000_000, amountMinor: 60_000, feeMinor: 1_000, note: null,
      });
      await repository.createTransaction(ownerA, mutualFundId, {
        occurredOn: "2026-09-03", kind: "sell", unitsMicros: 2_000_000, amountMinor: 20_000, feeMinor: 100, note: "Partial sale",
      });
      const temporaryBuyId = await repository.createTransaction(ownerA, mutualFundId, {
        occurredOn: "2026-09-04", kind: "buy", unitsMicros: 1_000_000, amountMinor: 12_000, feeMinor: 0, note: null,
      });
      await repository.deleteTransaction(ownerA, mutualFundId, temporaryBuyId);

      await repository.createTransaction(ownerA, etfId, {
        occurredOn: "2026-09-01", kind: "opening", unitsMicros: 1_000_000, amountMinor: 10_000, feeMinor: 0, note: null,
      });

      await repository.upsertPrice(ownerA, mutualFundId, { effectiveOn: "2026-09-08", priceMinor: 10_000, source: "market", provider: "Yahoo Finance" });
      await repository.upsertPrice(ownerA, mutualFundId, { effectiveOn: "2026-09-08", priceMinor: 10_000, source: "manual", provider: null });
      await repository.upsertPrice(ownerA, repeatedMutualFundId, { effectiveOn: "2026-09-08", priceMinor: 0, source: "manual", provider: null });
      await repository.upsertPrice(ownerA, etfId, { effectiveOn: "2026-09-08", priceMinor: 11_000, source: "market", provider: "Yahoo Finance" });
      await repository.upsertFxRate(ownerA, { effectiveOn: "2026-09-08", ratePpm: 1_300_000, source: "market", provider: "Yahoo Finance" });
      await repository.upsertFxRate(ownerA, { effectiveOn: "2026-09-08", ratePpm: 1_350_000, source: "manual", provider: null });

      const page = await repository.getPageData(ownerA, "2026-09-08");
      expect(page.accounts).toHaveLength(1);
      expect(page.accounts[0]?.holdings).toHaveLength(3);
      expect(page.accounts[0]?.holdings.map((holding) => holding.id)).toEqual(expect.arrayContaining([mutualFundId, repeatedMutualFundId, etfId]));
      const mutualFund = page.accounts[0]?.holdings.find((holding) => holding.id === mutualFundId);
      const etf = page.accounts[0]?.holdings.find((holding) => holding.id === etfId);
      expect(mutualFund?.valuation).toMatchObject({ unitsMicros: 13_000_000, costBasisMinor: 139_533, marketValueMinor: 130_000, price: { source: "manual" } });
      expect(etf?.valuation).toMatchObject({ marketValueMinor: 11_000, fxRate: { source: "manual", ratePpm: 1_350_000 }, cadMarketValueMinor: 14_850 });
      expect(page.accounts[0]?.summary.cadMarketValueMinor).toBe(144_850);
      expect(page.accounts[0]?.reconciliation.status).toBe("matched");

      const ownerBPage = await repository.getPageData(ownerB, "2026-09-08");
      expect(ownerBPage.accounts).toHaveLength(1);
      expect(ownerBPage.accounts[0]?.holdings.map((holding) => holding.id)).toEqual([ownerBHoldingId]);
      expect(page.accounts[0]?.latestBalance).toEqual({ accountId: rdspAccountA, asOf: "2026-09-08", balanceMinor: 144_850 });
      expect(ownerBPage.accounts[0]?.latestBalance).toEqual({ accountId: rdspAccountB, asOf: "2026-09-08", balanceMinor: 50_000 });
      expect(await tx.select({ id: investmentHoldings.id }).from(investmentHoldings).where(and(eq(investmentHoldings.ownerId, ownerA), eq(investmentHoldings.accountId, rdspAccountA)))).toHaveLength(3);
      expect(await tx.select({ id: investmentHoldingTransactions.id }).from(investmentHoldingTransactions).where(eq(investmentHoldingTransactions.id, openingId))).toHaveLength(1);

      await expect(repository.createHolding(ownerA, { accountId: ordinaryAccountA, instrumentType: "mutual_fund", symbol: "BAD", name: "Not allowed", currency: "CAD" })).rejects.toThrow("REEI/RDSP Account not found or inactive.");
      await expect(repository.createTransaction(ownerA, ownerBHoldingId, { occurredOn: "2026-09-08", kind: "opening", unitsMicros: 1_000_000, amountMinor: 100, feeMinor: 0, note: null })).rejects.toThrow("Investment holding not found.");
      await expect(repository.createTransaction(ownerA, mutualFundId, { occurredOn: "2026-09-08", kind: "sell", unitsMicros: 99_000_000, amountMinor: 1, feeMinor: 0, note: null })).rejects.toThrow("Cannot sell more units than are available.");
      await expect(repository.deleteTransaction(ownerA, mutualFundId, "40000000-0000-4000-8000-0000000000a1")).rejects.toThrow("Investment holding transaction not found.");

      await expect(repository.deleteHolding(ownerB, mutualFundId)).rejects.toThrow("Investment holding not found.");
      await repository.deleteHolding(ownerA, mutualFundId);
      expect(await tx.select({ id: investmentHoldings.id }).from(investmentHoldings).where(eq(investmentHoldings.id, mutualFundId))).toHaveLength(0);
      expect(await tx.select({ id: investmentHoldingTransactions.id }).from(investmentHoldingTransactions).where(eq(investmentHoldingTransactions.holdingId, mutualFundId))).toHaveLength(0);
      expect(await tx.select({ id: investmentHoldingPrices.id }).from(investmentHoldingPrices).where(eq(investmentHoldingPrices.holdingId, mutualFundId))).toHaveLength(0);
      expect(await tx.select({ action: auditEvents.action, metadata: auditEvents.metadata }).from(auditEvents).where(and(eq(auditEvents.ownerId, ownerA), eq(auditEvents.entityType, "investment_holding"), eq(auditEvents.entityId, mutualFundId)))).toEqual([
        { action: "deleted", metadata: expect.objectContaining({ operation: "investment_holding_delete", symbol: "RBF123", name: "Balanced fund" }) },
      ]);

      throw rollbackMarker;
    }), rollbackMarker);
  });
});
