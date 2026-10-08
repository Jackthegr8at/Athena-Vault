import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import {
  calculateInvestmentHoldingValuation,
  summarizeInvestmentHoldingValuations,
  type InvestmentFxRateInput,
  type InvestmentHoldingCurrency,
  type InvestmentHoldingPriceInput,
  type InvestmentHoldingTransactionInput,
  type InvestmentHoldingValuation,
  type InvestmentQuoteSource,
} from "@athena/finance-engine";
import type { Database } from "../client";
import {
  accounts,
  auditEvents,
  balanceSnapshots,
  institutions,
  investmentFxRates,
  investmentHoldingPrices,
  investmentHoldingTransactions,
  investmentHoldings,
} from "../drizzle-schema";
import type { DrizzleCurrencyCode } from "../drizzle-schema";
import { toTorontoDateIso } from "../account-timeline";

export interface InvestmentHoldingCreateRepositoryInput {
  readonly accountId: string;
  readonly instrumentType: "mutual_fund" | "etf";
  readonly symbol: string;
  readonly name: string;
  readonly currency: "CAD" | "USD";
}

export interface InvestmentHoldingTransactionCreateRepositoryInput {
  readonly occurredOn: string;
  readonly kind: "opening" | "buy" | "sell" | "distribution" | "fee";
  readonly unitsMicros: number;
  readonly amountMinor: number;
  readonly feeMinor: number;
  readonly note: string | null;
}

export interface InvestmentHoldingPriceRepositoryInput {
  readonly effectiveOn: string;
  readonly priceMinor: number;
  readonly source: InvestmentQuoteSource;
  readonly provider: string | null;
  readonly quotedAt?: Date;
}

export interface InvestmentFxRateRepositoryInput {
  readonly effectiveOn: string;
  readonly ratePpm: number;
  readonly source: InvestmentQuoteSource;
  readonly provider: string | null;
  readonly quotedAt?: Date;
}

export interface InvestmentHoldingAccountView {
  readonly id: string;
  readonly name: string;
  readonly institution: string;
  readonly currency: DrizzleCurrencyCode;
  readonly latestBalance: {
    readonly asOf: string;
    readonly balanceMinor: number;
  } | null;
}

export interface InvestmentHoldingTransactionView extends InvestmentHoldingTransactionInput {
  readonly note: string | null;
}

export interface InvestmentHoldingView {
  readonly id: string;
  readonly accountId: string;
  readonly instrumentType: "mutual_fund" | "etf";
  readonly symbol: string;
  readonly name: string;
  readonly currency: InvestmentHoldingCurrency;
  readonly transactions: readonly InvestmentHoldingTransactionView[];
  readonly valuation: InvestmentHoldingValuation;
}

export interface InvestmentHoldingReconciliationView {
  readonly status: "unavailable" | "matched" | "difference";
  readonly message: string;
  readonly balanceMinor: number | null;
  readonly holdingsValueMinor: number | null;
  readonly differenceMinor: number | null;
}

export interface InvestmentHoldingAccountDataView extends InvestmentHoldingAccountView {
  readonly holdings: readonly InvestmentHoldingView[];
  readonly summary: ReturnType<typeof summarizeInvestmentHoldingValuations>;
  readonly reconciliation: InvestmentHoldingReconciliationView;
}

export interface InvestmentHoldingsPageData {
  readonly asOf: string;
  readonly accounts: readonly InvestmentHoldingAccountDataView[];
}

function requireSafeNonnegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer.`);
  return value;
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function normalizeInstrumentType(value: "fnb" | "mutual_fund" | "etf"): "mutual_fund" | "etf" {
  return value === "etf" ? "etf" : "mutual_fund";
}

function transactionView(row: typeof investmentHoldingTransactions.$inferSelect): InvestmentHoldingTransactionView {
  return {
    id: row.id,
    occurredOn: row.occurredOn,
    kind: row.kind,
    unitsMicros: row.unitsMicros,
    amountMinor: row.amountMinor,
    feeMinor: row.feeMinor,
    note: row.note,
  };
}

function reconciliation(
  account: InvestmentHoldingAccountView,
  summary: ReturnType<typeof summarizeInvestmentHoldingValuations>,
): InvestmentHoldingReconciliationView {
  const balanceMinor = account.latestBalance?.balanceMinor ?? null;
  const holdingsValueMinor = account.currency === "CAD"
    ? summary.cadMarketValueMinor
    : account.currency === "USD" && summary.nativeTotals.USD.marketValueMinor !== null && summary.nativeTotals.CAD.marketValueMinor === 0
      ? summary.nativeTotals.USD.marketValueMinor
      : null;
  if (balanceMinor === null) return { status: "unavailable", message: "No Account balance snapshot is available for comparison.", balanceMinor, holdingsValueMinor, differenceMinor: null };
  if (holdingsValueMinor === null) return { status: "unavailable", message: "A current price or USD-to-CAD rate is missing, so the holdings total cannot be compared yet.", balanceMinor, holdingsValueMinor, differenceMinor: null };
  const differenceMinor = holdingsValueMinor - balanceMinor;
  return differenceMinor === 0
    ? { status: "matched", message: "Holdings value matches the latest Account balance snapshot.", balanceMinor, holdingsValueMinor, differenceMinor }
    : { status: "difference", message: "Holdings value differs from the latest Account balance snapshot.", balanceMinor, holdingsValueMinor, differenceMinor };
}

async function assertActiveRdspAccount(db: Database, ownerId: string, accountId: string): Promise<typeof accounts.$inferSelect> {
  const [account] = await db.select().from(accounts).where(and(eq(accounts.ownerId, ownerId), eq(accounts.id, accountId), eq(accounts.kind, "rdsp"), eq(accounts.isActive, true))).limit(1);
  if (!account) throw new Error("REEI/RDSP Account not found or inactive.");
  return account;
}

async function assertHolding(db: Database, ownerId: string, holdingId: string): Promise<typeof investmentHoldings.$inferSelect> {
  const [holding] = await db.select().from(investmentHoldings).where(and(eq(investmentHoldings.ownerId, ownerId), eq(investmentHoldings.id, holdingId), eq(investmentHoldings.isActive, true))).limit(1);
  if (!holding) throw new Error("Investment holding not found.");
  return holding;
}

function transactionInput(row: typeof investmentHoldingTransactions.$inferSelect): InvestmentHoldingTransactionInput {
  return {
    id: row.id,
    occurredOn: row.occurredOn,
    kind: row.kind,
    unitsMicros: row.unitsMicros,
    amountMinor: row.amountMinor,
    feeMinor: row.feeMinor,
  };
}

function priceInput(row: typeof investmentHoldingPrices.$inferSelect): InvestmentHoldingPriceInput {
  return {
    id: row.id,
    effectiveOn: row.effectiveOn,
    priceMinor: row.priceMinor,
    source: row.source,
    provider: row.provider,
    quotedAt: row.quotedAt,
  };
}

function fxInput(row: typeof investmentFxRates.$inferSelect): InvestmentFxRateInput {
  return {
    id: row.id,
    baseCurrency: row.baseCurrency as InvestmentHoldingCurrency,
    quoteCurrency: row.quoteCurrency as InvestmentHoldingCurrency,
    effectiveOn: row.effectiveOn,
    ratePpm: row.ratePpm,
    source: row.source,
    provider: row.provider,
    quotedAt: row.quotedAt,
  };
}

export function createInvestmentHoldingsRepository(db: Database) {
  return {
    async getPageData(ownerId: string, asOf = toTorontoDateIso()): Promise<InvestmentHoldingsPageData> {
      const accountRows = await db.select({
        id: accounts.id,
        name: accounts.name,
        institution: institutions.name,
        currency: accounts.currency,
      }).from(accounts)
        .innerJoin(institutions, and(eq(institutions.id, accounts.institutionId), eq(institutions.ownerId, ownerId)))
        .where(and(eq(accounts.ownerId, ownerId), eq(accounts.kind, "rdsp"), eq(accounts.isActive, true)))
        .orderBy(asc(accounts.name), asc(accounts.id));
      const accountIds = accountRows.map((account) => account.id);
      const balanceRows = accountIds.length === 0 ? [] : await (() => {
        const ranked = db.$with("ranked_balance_snapshots").as(
          db.select({
            accountId: balanceSnapshots.accountId,
            asOf: balanceSnapshots.asOf,
            balanceMinor: balanceSnapshots.balanceMinor,
            id: balanceSnapshots.id,
            rn: sql`row_number() over (partition by ${balanceSnapshots.accountId} order by ${balanceSnapshots.asOf} desc, ${balanceSnapshots.id} asc)`.as("rn"),
          }).from(balanceSnapshots)
            .where(and(
              eq(balanceSnapshots.ownerId, ownerId),
              inArray(balanceSnapshots.accountId, accountIds),
              lte(balanceSnapshots.asOf, asOf),
            )),
        );
        return db.with(ranked).select({
          accountId: ranked.accountId,
          asOf: ranked.asOf,
          balanceMinor: ranked.balanceMinor,
        }).from(ranked)
          .where(sql`rn = 1`)
          .orderBy(asc(ranked.accountId));
      })();
      const latestBalanceByAccount = new Map(balanceRows.map((row) => [row.accountId, row] as const));

      const holdingRows = accountIds.length === 0 ? [] : await db.select().from(investmentHoldings)
        .where(and(eq(investmentHoldings.ownerId, ownerId), inArray(investmentHoldings.accountId, accountIds), eq(investmentHoldings.isActive, true)))
        .orderBy(asc(investmentHoldings.name), asc(investmentHoldings.symbol), asc(investmentHoldings.id));
      const holdingIds = holdingRows.map((holding) => holding.id);
      const transactionRows = holdingIds.length === 0 ? [] : await db.select().from(investmentHoldingTransactions)
        .where(and(eq(investmentHoldingTransactions.ownerId, ownerId), inArray(investmentHoldingTransactions.holdingId, holdingIds)))
        .orderBy(asc(investmentHoldingTransactions.occurredOn), asc(investmentHoldingTransactions.id));
      const priceRows = holdingIds.length === 0 ? [] : await db.select().from(investmentHoldingPrices)
        .where(and(eq(investmentHoldingPrices.ownerId, ownerId), inArray(investmentHoldingPrices.holdingId, holdingIds)))
        .orderBy(desc(investmentHoldingPrices.effectiveOn), asc(investmentHoldingPrices.id));
      const fxRows = await db.select().from(investmentFxRates)
        .where(eq(investmentFxRates.ownerId, ownerId))
        .orderBy(desc(investmentFxRates.effectiveOn), asc(investmentFxRates.id));

      const transactionsByHolding = new Map<string, typeof transactionRows>();
      for (const row of transactionRows) transactionsByHolding.set(row.holdingId, [...(transactionsByHolding.get(row.holdingId) ?? []), row]);
      const pricesByHolding = new Map<string, typeof priceRows>();
      for (const row of priceRows) pricesByHolding.set(row.holdingId, [...(pricesByHolding.get(row.holdingId) ?? []), row]);
      const fxInputs = fxRows.map(fxInput);
      const holdingsByAccount = new Map<string, InvestmentHoldingView[]>();
      for (const holding of holdingRows) {
        const transactions = transactionsByHolding.get(holding.id) ?? [];
        const prices = pricesByHolding.get(holding.id) ?? [];
        const valuation = calculateInvestmentHoldingValuation({
          currency: holding.currency as InvestmentHoldingCurrency,
          valuationOn: asOf,
          transactions: transactions.map(transactionInput),
          prices: prices.map(priceInput),
          fxRates: fxInputs,
        });
        const view: InvestmentHoldingView = {
          id: holding.id,
          accountId: holding.accountId,
          instrumentType: normalizeInstrumentType(holding.instrumentType),
          symbol: holding.symbol,
          name: holding.name,
          currency: holding.currency as InvestmentHoldingCurrency,
          transactions: transactions.map(transactionView),
          valuation,
        };
        holdingsByAccount.set(holding.accountId, [...(holdingsByAccount.get(holding.accountId) ?? []), view]);
      }

      const accountData = accountRows.map((account) => {
        const accountView: InvestmentHoldingAccountView = {
          id: account.id,
          name: account.name,
          institution: account.institution,
          currency: account.currency,
          latestBalance: latestBalanceByAccount.get(account.id) ?? null,
        };
        const holdings = holdingsByAccount.get(account.id) ?? [];
        const summary = summarizeInvestmentHoldingValuations(holdings.map((holding) => ({ currency: holding.currency, valuation: holding.valuation })));
        return { ...accountView, holdings, summary, reconciliation: reconciliation(accountView, summary) } satisfies InvestmentHoldingAccountDataView;
      });

      return { asOf, accounts: accountData };
    },

    async createHolding(ownerId: string, input: InvestmentHoldingCreateRepositoryInput): Promise<string> {
      await assertActiveRdspAccount(db, ownerId, input.accountId);
      const [created] = await db.insert(investmentHoldings).values({
        ownerId,
        accountId: input.accountId,
        instrumentType: input.instrumentType,
        symbol: requireText(input.symbol, "Symbol"),
        name: requireText(input.name, "Holding name"),
        currency: input.currency,
        isActive: true,
      }).returning({ id: investmentHoldings.id });
      if (!created) throw new Error("Investment holding insert returned no row.");
      return created.id;
    },

    async createTransaction(ownerId: string, holdingId: string, input: InvestmentHoldingTransactionCreateRepositoryInput): Promise<string> {
      return db.transaction(async (tx) => {
        const holding = await assertHolding(tx as unknown as Database, ownerId, holdingId);
        const existing = await tx.select().from(investmentHoldingTransactions)
          .where(and(eq(investmentHoldingTransactions.ownerId, ownerId), eq(investmentHoldingTransactions.holdingId, holdingId)))
          .orderBy(asc(investmentHoldingTransactions.occurredOn), asc(investmentHoldingTransactions.id));
        const id = randomUUID();
        const candidate = {
          id,
          occurredOn: input.occurredOn,
          kind: input.kind,
          unitsMicros: requireSafeNonnegativeInteger(input.unitsMicros, "Units"),
          amountMinor: requireSafeNonnegativeInteger(input.amountMinor, "Amount"),
          feeMinor: requireSafeNonnegativeInteger(input.feeMinor, "Fee"),
        } satisfies InvestmentHoldingTransactionInput;
        calculateInvestmentHoldingValuation({ currency: holding.currency as InvestmentHoldingCurrency, valuationOn: "9999-12-31", transactions: [...existing.map(transactionInput), candidate], prices: [] });
        const [created] = await tx.insert(investmentHoldingTransactions).values({ ownerId, holdingId, ...candidate, note: input.note }).returning({ id: investmentHoldingTransactions.id });
        if (!created) throw new Error("Investment holding transaction insert returned no row.");
        return created.id;
      });
    },

    async deleteHolding(ownerId: string, holdingId: string): Promise<void> {
      await db.transaction(async (tx) => {
        const holding = await assertHolding(tx as unknown as Database, ownerId, holdingId);
        const deleted = await tx.delete(investmentHoldings)
          .where(and(eq(investmentHoldings.ownerId, ownerId), eq(investmentHoldings.id, holdingId), eq(investmentHoldings.isActive, true)))
          .returning({ id: investmentHoldings.id });
        if (deleted.length !== 1) throw new Error("Investment holding not found.");
        await tx.insert(auditEvents).values({
          ownerId,
          actorUserId: ownerId,
          action: "deleted",
          entityType: "investment_holding",
          entityId: holdingId,
          metadata: { operation: "investment_holding_delete", symbol: holding.symbol, name: holding.name },
        });
      });
    },

    async deleteTransaction(ownerId: string, holdingId: string, transactionId: string): Promise<void> {
      await db.transaction(async (tx) => {
        await assertHolding(tx as unknown as Database, ownerId, holdingId);
        const deleted = await tx.delete(investmentHoldingTransactions)
          .where(and(eq(investmentHoldingTransactions.ownerId, ownerId), eq(investmentHoldingTransactions.holdingId, holdingId), eq(investmentHoldingTransactions.id, transactionId)))
          .returning({ id: investmentHoldingTransactions.id });
        if (deleted.length !== 1) throw new Error("Investment holding transaction not found.");
        const remaining = await tx.select().from(investmentHoldingTransactions)
          .where(and(eq(investmentHoldingTransactions.ownerId, ownerId), eq(investmentHoldingTransactions.holdingId, holdingId)))
          .orderBy(asc(investmentHoldingTransactions.occurredOn), asc(investmentHoldingTransactions.id));
        const [holding] = await tx.select({ currency: investmentHoldings.currency }).from(investmentHoldings)
          .where(and(eq(investmentHoldings.ownerId, ownerId), eq(investmentHoldings.id, holdingId))).limit(1);
        if (!holding) throw new Error("Investment holding not found.");
        calculateInvestmentHoldingValuation({ currency: holding.currency as InvestmentHoldingCurrency, valuationOn: "9999-12-31", transactions: remaining.map(transactionInput), prices: [] });
      });
    },

    async upsertPrice(ownerId: string, holdingId: string, input: InvestmentHoldingPriceRepositoryInput): Promise<void> {
      await db.transaction(async (tx) => {
        await assertHolding(tx as unknown as Database, ownerId, holdingId);
        await tx.insert(investmentHoldingPrices).values({ ownerId, holdingId, effectiveOn: input.effectiveOn, priceMinor: requireSafeNonnegativeInteger(input.priceMinor, "Price"), source: input.source, provider: input.provider, quotedAt: input.quotedAt ?? new Date(), updatedAt: new Date() }).onConflictDoUpdate({
          target: [investmentHoldingPrices.ownerId, investmentHoldingPrices.holdingId, investmentHoldingPrices.effectiveOn, investmentHoldingPrices.source],
          set: { priceMinor: input.priceMinor, provider: input.provider, quotedAt: input.quotedAt ?? new Date(), updatedAt: new Date() },
        });
      });
    },

    async upsertFxRate(ownerId: string, input: InvestmentFxRateRepositoryInput): Promise<void> {
      const ratePpm = requireSafeNonnegativeInteger(input.ratePpm, "FX rate");
      if (ratePpm <= 0) throw new Error("FX rate must be positive.");
      await db.insert(investmentFxRates).values({ ownerId, baseCurrency: "USD", quoteCurrency: "CAD", effectiveOn: input.effectiveOn, ratePpm, source: input.source, provider: input.provider, quotedAt: input.quotedAt ?? new Date(), updatedAt: new Date() }).onConflictDoUpdate({
        target: [investmentFxRates.ownerId, investmentFxRates.baseCurrency, investmentFxRates.quoteCurrency, investmentFxRates.effectiveOn, investmentFxRates.source],
        set: { ratePpm, provider: input.provider, quotedAt: input.quotedAt ?? new Date(), updatedAt: new Date() },
      });
    },

    async getHolding(ownerId: string, holdingId: string): Promise<typeof investmentHoldings.$inferSelect> {
      return assertHolding(db, ownerId, holdingId);
    },
  };
}
