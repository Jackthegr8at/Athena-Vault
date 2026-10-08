import { and, asc, desc, eq } from "drizzle-orm";
import type { Database } from "../client";
import {
  annualizeMaintenanceAmount,
  annualizeMaintenanceItems,
  maintenanceFrequencies,
  monthlyMaintenanceReserve,
  type MaintenanceFrequency,
} from "../annual-maintenance";
import {
  accounts,
  annualMaintenanceItems,
  householdExpenses,
  liabilities,
  recurringCashFlowSeries,
} from "../drizzle-schema";
import {
  type RecurringCashFlowFrequency,
  type RecurringCashFlowKind,
} from "../recurring-cash-flow";

import type { TransactionDatabase } from "./shared";

import { isUniqueViolation } from "./shared";

export type HomeHouseholdFrequency = "biweekly" | "monthly";


export interface HomeHouseholdCashFlowLinkView {
  readonly frequency: HomeHouseholdFrequency;
  readonly seriesId: string;
  readonly seriesState: (typeof recurringCashFlowSeries.$inferSelect)["state"];
  readonly name: string;
  readonly kind: RecurringCashFlowKind;
  readonly amountMinor: number;
  readonly scheduleFrequency: RecurringCashFlowFrequency;
  readonly countsAsExpense: boolean;
  readonly nextOccurrenceOn: string | null;
}


export interface HouseholdExpenseView {
  readonly id: string;
  readonly name: string;
  readonly category: string | null;
  readonly frequency: (typeof householdExpenses.$inferSelect)["frequency"];
  readonly amountMinor: number;
  readonly annualAmountMinor: number;
  readonly accountId: string | null;
  readonly accountName: string | null;
  readonly startsOn: string | null;
  readonly endsOn: string | null;
  readonly currency: (typeof householdExpenses.$inferSelect)["currency"];
  readonly isActive: boolean;
}


export interface AnnualMaintenanceItemView {
  readonly id: string;
  readonly name: string;
  readonly amountMinor: number;
  readonly frequency: MaintenanceFrequency;
  readonly annualizedAmountMinor: number;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}


export type AnnualMaintenanceSummaryView = Pick<
  HouseholdExpenseView,
  "id" | "name" | "category" | "frequency" | "amountMinor" | "annualAmountMinor" | "currency"
>;


export interface AnnualMaintenanceMutationResult {
  readonly item: AnnualMaintenanceItemView | null;
  readonly summary: AnnualMaintenanceSummaryView;
}


export interface LiabilityView {
  readonly id: string;
  readonly name: string;
  readonly lender: string | null;
  readonly kind: (typeof liabilities.$inferSelect)["kind"];
  readonly status: (typeof liabilities.$inferSelect)["status"];
  readonly currentBalanceMinor: number;
  readonly minimumPaymentMinor: number;
  readonly paymentFrequency: (typeof liabilities.$inferSelect)["paymentFrequency"];
  readonly asOf: string;
  readonly currency: (typeof liabilities.$inferSelect)["currency"];
}


function isSupportedMaintenanceFrequency(value: string): value is MaintenanceFrequency {
  return (maintenanceFrequencies as readonly string[]).includes(value);
}


function maintenanceItemView(row: typeof annualMaintenanceItems.$inferSelect): AnnualMaintenanceItemView {
  if (!isSupportedMaintenanceFrequency(row.frequency)) {
    throw new Error("Annual maintenance item has an unsupported frequency.");
  }
  return {
    id: row.id,
    name: row.name,
    amountMinor: row.amountMinor,
    frequency: row.frequency,
    annualizedAmountMinor: annualizeMaintenanceAmount(row.amountMinor, row.frequency),
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}


function maintenanceSummaryView(row: HouseholdExpenseView): AnnualMaintenanceSummaryView {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    frequency: row.frequency,
    amountMinor: row.amountMinor,
    annualAmountMinor: row.annualAmountMinor,
    currency: row.currency,
  };
}


async function syncMaintenanceSummary(tx: TransactionDatabase, ownerId: string): Promise<AnnualMaintenanceSummaryView> {
  const activeItems = await tx.select({ amountMinor: annualMaintenanceItems.amountMinor, frequency: annualMaintenanceItems.frequency })
    .from(annualMaintenanceItems)
    .where(and(eq(annualMaintenanceItems.ownerId, ownerId), eq(annualMaintenanceItems.isActive, true)));
  const annualAmountMinor = annualizeMaintenanceItems(activeItems.map((item) => {
    if (!isSupportedMaintenanceFrequency(item.frequency)) {
      throw new Error("Annual maintenance item has an unsupported frequency.");
    }
    return { amountMinor: item.amountMinor, frequency: item.frequency };
  }));
  const [summary] = await tx.update(householdExpenses)
    .set({
      name: "Annual maintenance",
      category: "annual-maintenance",
      frequency: "monthly",
      amountMinor: monthlyMaintenanceReserve(annualAmountMinor),
      annualAmountMinor,
      updatedAt: new Date(),
    })
    .where(and(
      eq(householdExpenses.ownerId, ownerId),
      eq(householdExpenses.name, "Annual maintenance"),
      eq(householdExpenses.category, "annual-maintenance"),
      eq(householdExpenses.isActive, true),
    ))
    .returning({
      id: householdExpenses.id,
      name: householdExpenses.name,
      category: householdExpenses.category,
      frequency: householdExpenses.frequency,
      amountMinor: householdExpenses.amountMinor,
      annualAmountMinor: householdExpenses.annualAmountMinor,
      currency: householdExpenses.currency,
      accountId: householdExpenses.accountId,
      accountName: householdExpenses.accountId,
      startsOn: householdExpenses.startsOn,
      endsOn: householdExpenses.endsOn,
      isActive: householdExpenses.isActive,
    });
  if (!summary) throw new Error("Annual maintenance summary not found.");
  return maintenanceSummaryView(summary as HouseholdExpenseView);
}


type HouseholdExpenseFrequency = (typeof householdExpenses.$inferSelect)["frequency"];


function assertHouseholdExpenseMinorUnits(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
}


const householdAnnualizationFactors: Readonly<Record<HouseholdExpenseFrequency, number>> = {
  weekly: 52,
  biweekly: 26,
  monthly: 12,
  quarterly: 4,
  annual: 1,
};


function annualizeHouseholdAmount(amountMinor: number, frequency: HouseholdExpenseFrequency): number {
  assertHouseholdExpenseMinorUnits(amountMinor, "Expense amount");
  const annualizedAmount = amountMinor * householdAnnualizationFactors[frequency];
  assertHouseholdExpenseMinorUnits(annualizedAmount, "Annualized expense amount");
  return annualizedAmount;
}


export function createHouseholdRepository(db: Database) {
  return {
    async listExpenses(ownerId: string): Promise<readonly HouseholdExpenseView[]> {
      return db.select({
        id: householdExpenses.id,
        name: householdExpenses.name,
        category: householdExpenses.category,
        frequency: householdExpenses.frequency,
        amountMinor: householdExpenses.amountMinor,
        annualAmountMinor: householdExpenses.annualAmountMinor,
        accountId: householdExpenses.accountId,
        accountName: accounts.name,
        startsOn: householdExpenses.startsOn,
        endsOn: householdExpenses.endsOn,
        currency: householdExpenses.currency,
        isActive: householdExpenses.isActive,
      }).from(householdExpenses)
        .leftJoin(accounts, and(eq(accounts.id, householdExpenses.accountId), eq(accounts.ownerId, ownerId)))
        .where(eq(householdExpenses.ownerId, ownerId))
        .orderBy(asc(householdExpenses.name), asc(householdExpenses.id));
    },
    async listMaintenanceItems(ownerId: string): Promise<readonly AnnualMaintenanceItemView[]> {
      const rows = await db.select().from(annualMaintenanceItems)
        .where(and(eq(annualMaintenanceItems.ownerId, ownerId), eq(annualMaintenanceItems.isActive, true)))
        .orderBy(asc(annualMaintenanceItems.name), asc(annualMaintenanceItems.id));
      return rows.map(maintenanceItemView);
    },
    async getMaintenanceSummary(ownerId: string): Promise<AnnualMaintenanceSummaryView | null> {
      const [summary] = await db.select({
        id: householdExpenses.id,
        name: householdExpenses.name,
        category: householdExpenses.category,
        frequency: householdExpenses.frequency,
        amountMinor: householdExpenses.amountMinor,
        annualAmountMinor: householdExpenses.annualAmountMinor,
        currency: householdExpenses.currency,
        accountId: householdExpenses.accountId,
        accountName: accounts.name,
        startsOn: householdExpenses.startsOn,
        endsOn: householdExpenses.endsOn,
        isActive: householdExpenses.isActive,
      }).from(householdExpenses)
        .leftJoin(accounts, and(eq(accounts.id, householdExpenses.accountId), eq(accounts.ownerId, ownerId)))
        .where(and(
          eq(householdExpenses.ownerId, ownerId),
          eq(householdExpenses.name, "Annual maintenance"),
          eq(householdExpenses.category, "annual-maintenance"),
          eq(householdExpenses.isActive, true),
        ))
        .limit(1);
      return summary ? maintenanceSummaryView(summary) : null;
    },
    async createMaintenanceItem(ownerId: string, input: { name: string; amountMinor: number; frequency: MaintenanceFrequency }): Promise<AnnualMaintenanceMutationResult> {
      try {
        return await db.transaction(async (tx) => {
          const [item] = await tx.insert(annualMaintenanceItems).values({ ownerId, ...input, isActive: true }).returning();
          if (!item) throw new Error("Annual maintenance item insert returned no row.");
          return { item: maintenanceItemView(item), summary: await syncMaintenanceSummary(tx, ownerId) };
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new Error("An annual maintenance item with this name already exists.");
        throw error;
      }
    },
    async updateMaintenanceItem(ownerId: string, itemId: string, input: { name: string; amountMinor: number; frequency: MaintenanceFrequency }): Promise<AnnualMaintenanceMutationResult> {
      try {
        return await db.transaction(async (tx) => {
          const [item] = await tx.update(annualMaintenanceItems)
            .set({ ...input, updatedAt: new Date() })
            .where(and(
              eq(annualMaintenanceItems.id, itemId),
              eq(annualMaintenanceItems.ownerId, ownerId),
              eq(annualMaintenanceItems.isActive, true),
            ))
            .returning();
          if (!item) throw new Error("Annual maintenance item not found.");
          return { item: maintenanceItemView(item), summary: await syncMaintenanceSummary(tx, ownerId) };
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new Error("An annual maintenance item with this name already exists.");
        throw error;
      }
    },
    async deleteMaintenanceItem(ownerId: string, itemId: string): Promise<{ summary: AnnualMaintenanceSummaryView }> {
      return db.transaction(async (tx) => {
        const deleted = await tx.delete(annualMaintenanceItems)
          .where(and(
            eq(annualMaintenanceItems.id, itemId),
            eq(annualMaintenanceItems.ownerId, ownerId),
            eq(annualMaintenanceItems.isActive, true),
          ))
          .returning({ id: annualMaintenanceItems.id });
        if (deleted.length === 0) throw new Error("Annual maintenance item not found.");
        return { summary: await syncMaintenanceSummary(tx, ownerId) };
      });
    },
    async createExpense(ownerId: string, input: { name: string; category: string | null; frequency: HouseholdExpenseFrequency; amountMinor: number; accountId: string | null }): Promise<void> {
      const annualAmountMinor = annualizeHouseholdAmount(input.amountMinor, input.frequency);
      try {
        await db.transaction(async (tx) => {
          if (input.accountId) {
            const [account] = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, input.accountId), eq(accounts.ownerId, ownerId))).limit(1);
            if (!account) throw new Error("Account not found.");
          }
          const [expense] = await tx.insert(householdExpenses).values({
            ownerId,
            accountId: input.accountId,
            name: input.name,
            category: input.category,
            frequency: input.frequency,
            amountMinor: input.amountMinor,
            annualAmountMinor,
            currency: "CAD",
            isActive: true,
          }).returning({ id: householdExpenses.id });
          if (!expense) throw new Error("Household expense insert returned no row.");
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new Error("A household expense with this name already exists.");
        throw error;
      }
    },
    async updateExpense(ownerId: string, itemId: string, input: { name: string; category: string | null; frequency: HouseholdExpenseFrequency; amountMinor: number; accountId: string | null }): Promise<void> {
      const annualAmountMinor = annualizeHouseholdAmount(input.amountMinor, input.frequency);
      try {
        await db.transaction(async (tx) => {
          if (input.accountId) {
            const [account] = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, input.accountId), eq(accounts.ownerId, ownerId))).limit(1);
            if (!account) throw new Error("Account not found.");
          }
          const [expense] = await tx.update(householdExpenses)
            .set({
              accountId: input.accountId,
              name: input.name,
              category: input.category,
              frequency: input.frequency,
              amountMinor: input.amountMinor,
              annualAmountMinor,
              updatedAt: new Date(),
            })
            .where(and(eq(householdExpenses.id, itemId), eq(householdExpenses.ownerId, ownerId)))
            .returning({ id: householdExpenses.id });
          if (!expense) throw new Error("Household expense not found.");
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new Error("A household expense with this name already exists.");
        throw error;
      }
    },
    async archiveExpense(ownerId: string, itemId: string): Promise<void> {
      const [expense] = await db.update(householdExpenses)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(householdExpenses.id, itemId), eq(householdExpenses.ownerId, ownerId)))
        .returning({ id: householdExpenses.id });
      if (!expense) throw new Error("Household expense not found.");
    },
    async restoreExpense(ownerId: string, itemId: string): Promise<void> {
      const [expense] = await db.update(householdExpenses)
        .set({ isActive: true, updatedAt: new Date() })
        .where(and(eq(householdExpenses.id, itemId), eq(householdExpenses.ownerId, ownerId)))
        .returning({ id: householdExpenses.id });
      if (!expense) throw new Error("Household expense not found.");
    },
    async deleteExpense(ownerId: string, itemId: string): Promise<void> {
      const [expense] = await db.delete(householdExpenses)
        .where(and(eq(householdExpenses.id, itemId), eq(householdExpenses.ownerId, ownerId)))
        .returning({ id: householdExpenses.id });
      if (!expense) throw new Error("Household expense not found.");
    },
    async listLiabilities(ownerId: string): Promise<readonly LiabilityView[]> {
      return db.select({
        id: liabilities.id,
        name: liabilities.name,
        lender: liabilities.lender,
        kind: liabilities.kind,
        status: liabilities.status,
        currentBalanceMinor: liabilities.currentBalanceMinor,
        minimumPaymentMinor: liabilities.minimumPaymentMinor,
        paymentFrequency: liabilities.paymentFrequency,
        asOf: liabilities.asOf,
        currency: liabilities.currency,
      }).from(liabilities)
        .where(eq(liabilities.ownerId, ownerId))
        .orderBy(asc(liabilities.name), desc(liabilities.asOf));
    },
  };
}
