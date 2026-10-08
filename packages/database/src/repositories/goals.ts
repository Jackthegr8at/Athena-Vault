import { and, asc, eq, isNull, ne } from "drizzle-orm";
import type { Database } from "../client";
import {
  accountContributionRules,
  accounts,
  financialGoals,
  financialGoalPlans,
  recurringCashFlowOccurrenceExceptions,
  recurringCashFlowSeries,
  recurringTransactions,
  transactions,
  transfers,
} from "../drizzle-schema";
import { addIsoDays } from "../account-contributions";
import { addRecurringCashFlowDays } from "../recurring-cash-flow";
import { toTorontoDateIso } from "../account-timeline";
import { recalculateAccountProjection, refreshCashFlowLinkedAccountProjections, type TransactionDatabase } from "./shared";
import { recurringFutureThroughDate, syncGeneratedRecurringOccurrences } from "./cash-flow";

export type FinancialGoalView = Pick<
  typeof financialGoals.$inferSelect,
  "id" | "name" | "targetMinor" | "currentMinor" | "targetDate" | "priority" | "status" | "currency"
>;

export interface FinancialGoalCreateInput {
  readonly name: string;
  readonly targetMinor: number;
  readonly currentMinor: number;
  readonly targetDate: string | null;
  readonly priority: number;
}

export interface FinancialGoalUpdateInput extends FinancialGoalCreateInput {
  readonly id: string;
}

const goalViewColumns = {
  id: financialGoals.id,
  name: financialGoals.name,
  targetMinor: financialGoals.targetMinor,
  currentMinor: financialGoals.currentMinor,
  targetDate: financialGoals.targetDate,
  priority: financialGoals.priority,
  status: financialGoals.status,
  currency: financialGoals.currency,
} as const;

const LIABILITY_ACCOUNT_KINDS: Record<string, true> = { credit: true, loan: true };

function isEligibleGoalDestination(
  account: Pick<typeof accounts.$inferSelect, "isActive" | "currency" | "kind">,
): boolean {
  if (!account.isActive || account.currency !== "CAD") return false;
  return LIABILITY_ACCOUNT_KINDS[account.kind] !== true;
}

interface LinkedGoalPlan {
  readonly planId: string;
  readonly ruleId: string;
  readonly ruleStartsOn: string;
  readonly accountId: string;
  readonly isEnabled: boolean;
  readonly ruleIsEnabled: boolean;
  readonly isActive: boolean;
  readonly currency: (typeof accounts.$inferSelect)["currency"];
  readonly kind: (typeof accounts.$inferSelect)["kind"];
}

async function loadLinkedPlan(
  tx: TransactionDatabase,
  ownerId: string,
  goalId: string,
): Promise<LinkedGoalPlan | undefined> {
  const rows = await tx
    .select({
      planId: financialGoalPlans.id,
      ruleId: accountContributionRules.id,
      ruleStartsOn: accountContributionRules.startsOn,
      accountId: accountContributionRules.accountId,
      isEnabled: financialGoalPlans.isEnabled,
      ruleIsEnabled: accountContributionRules.isEnabled,
      isActive: accounts.isActive,
      currency: accounts.currency,
      kind: accounts.kind,
    })
    .from(financialGoalPlans)
    .innerJoin(
      accountContributionRules,
      and(
        eq(financialGoalPlans.ownerId, accountContributionRules.ownerId),
        eq(financialGoalPlans.contributionRuleId, accountContributionRules.id),
      ),
    )
    .innerJoin(
      accounts,
      and(
        eq(accountContributionRules.ownerId, accounts.ownerId),
        eq(accountContributionRules.accountId, accounts.id),
      ),
    )
    .where(and(eq(financialGoalPlans.ownerId, ownerId), eq(financialGoalPlans.goalId, goalId)))
    .limit(1);
  return rows[0];
}

interface LinkedGoalSeriesPlan {
  readonly planId: string;
  readonly cashFlowSeriesId: string;
  readonly isEnabled: boolean;
  readonly seriesState: (typeof recurringCashFlowSeries.$inferSelect)["state"];
  readonly fromAccountId: string | null;
  readonly toAccountId: string | null;
}

async function loadLinkedSeriesPlan(
  tx: TransactionDatabase,
  ownerId: string,
  goalId: string,
): Promise<LinkedGoalSeriesPlan | undefined> {
  const rows = await tx
    .select({
      planId: financialGoalPlans.id,
      cashFlowSeriesId: financialGoalPlans.cashFlowSeriesId,
      isEnabled: financialGoalPlans.isEnabled,
      seriesState: recurringCashFlowSeries.state,
      fromAccountId: recurringTransactions.fromAccountId,
      toAccountId: recurringTransactions.toAccountId,
    })
    .from(financialGoalPlans)
    .innerJoin(
      recurringCashFlowSeries,
      and(
        eq(recurringCashFlowSeries.ownerId, financialGoalPlans.ownerId),
        eq(recurringCashFlowSeries.id, financialGoalPlans.cashFlowSeriesId),
      ),
    )
    .leftJoin(
      recurringTransactions,
      and(
        eq(recurringTransactions.ownerId, financialGoalPlans.ownerId),
        eq(recurringTransactions.seriesId, financialGoalPlans.cashFlowSeriesId),
        isNull(recurringTransactions.effectiveTo),
      ),
    )
    .where(and(eq(financialGoalPlans.ownerId, ownerId), eq(financialGoalPlans.goalId, goalId)))
    .limit(1);
  const row = rows[0];
  if (!row?.cashFlowSeriesId) return undefined;
  return {
    planId: row.planId,
    cashFlowSeriesId: row.cashFlowSeriesId,
    isEnabled: row.isEnabled,
    seriesState: row.seriesState,
    fromAccountId: row.fromAccountId,
    toAccountId: row.toAccountId,
  };
}

async function setLinkedSeriesPlanEnabled(
  tx: TransactionDatabase,
  ownerId: string,
  plan: LinkedGoalSeriesPlan,
  enabled: boolean,
  todayIso: string,
): Promise<void> {
  const fromDate = addRecurringCashFlowDays(todayIso, 1);
  const throughDate = await recurringFutureThroughDate(tx, ownerId, plan.cashFlowSeriesId, fromDate, null);
  await tx
    .update(recurringCashFlowSeries)
    .set({ state: enabled ? "active" : "paused", endedOn: null, updatedAt: new Date() })
    .where(
      and(
        eq(recurringCashFlowSeries.ownerId, ownerId),
        eq(recurringCashFlowSeries.id, plan.cashFlowSeriesId),
      ),
    );
  await syncGeneratedRecurringOccurrences(tx, ownerId, plan.cashFlowSeriesId, fromDate, throughDate, enabled
    ? { preserveExistingRows: true }
    : { removeFutureGenerated: true });
  await tx
    .update(financialGoalPlans)
    .set({ isEnabled: enabled, updatedAt: new Date() })
    .where(and(eq(financialGoalPlans.ownerId, ownerId), eq(financialGoalPlans.id, plan.planId)));
}

async function isSeriesPlanEligible(
  tx: TransactionDatabase,
  ownerId: string,
  plan: LinkedGoalSeriesPlan,
): Promise<boolean> {
  if (!plan.fromAccountId || !plan.toAccountId) return false;
  const [source] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.ownerId, ownerId),
        eq(accounts.id, plan.fromAccountId),
        eq(accounts.isActive, true),
        eq(accounts.currency, "CAD"),
        eq(accounts.isVisibleInCashFlow, true),
      ),
    )
    .limit(1);
  if (!source) return false;
  const [destination] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.ownerId, ownerId),
        eq(accounts.id, plan.toAccountId),
        eq(accounts.isActive, true),
        eq(accounts.currency, "CAD"),
        ne(accounts.kind, "credit"),
        ne(accounts.kind, "loan"),
      ),
    )
    .limit(1);
  return Boolean(destination);
}

async function updateGoalStatus(
  tx: TransactionDatabase,
  ownerId: string,
  id: string,
  status: "active" | "achieved" | "archived",
): Promise<FinancialGoalView> {
  const [row] = await tx
    .update(financialGoals)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(financialGoals.id, id), eq(financialGoals.ownerId, ownerId)))
    .returning(goalViewColumns);
  if (!row) throw new Error("Goal not found.");
  return row;
}

async function setLinkedPlanEnabled(
  tx: TransactionDatabase,
  ownerId: string,
  plan: LinkedGoalPlan,
  enabled: boolean,
): Promise<void> {
  await tx
    .update(financialGoalPlans)
    .set({ isEnabled: enabled, updatedAt: new Date() })
    .where(and(eq(financialGoalPlans.ownerId, ownerId), eq(financialGoalPlans.id, plan.planId)));
  await tx
    .update(accountContributionRules)
    .set({ isEnabled: enabled, updatedAt: new Date() })
    .where(and(eq(accountContributionRules.ownerId, ownerId), eq(accountContributionRules.id, plan.ruleId)));
}

async function recalcForAccount(
  tx: TransactionDatabase,
  ownerId: string,
  accountId: string,
  todayIso: string,
  fromDate: string,
): Promise<void> {
  await recalculateAccountProjection(tx, ownerId, accountId, {
    fromDate,
    futureAfter: todayIso,
  });
}

export function createGoalRepository(db: Database) {
  return {
    async listByOwner(ownerId: string): Promise<readonly FinancialGoalView[]> {
      return db
        .select(goalViewColumns)
        .from(financialGoals)
        .where(eq(financialGoals.ownerId, ownerId))
        .orderBy(
          asc(financialGoals.priority),
          asc(financialGoals.targetDate),
          asc(financialGoals.name),
          asc(financialGoals.id),
        );
    },

    async create(ownerId: string, input: FinancialGoalCreateInput): Promise<FinancialGoalView> {
      const [row] = await db
        .insert(financialGoals)
        .values({
          ownerId,
          name: input.name,
          targetMinor: input.targetMinor,
          currentMinor: input.currentMinor,
          targetDate: input.targetDate,
          priority: input.priority,
        })
        .returning(goalViewColumns);
      if (!row) throw new Error("Goal could not be created.");
      return row;
    },

    async update(ownerId: string, input: FinancialGoalUpdateInput): Promise<FinancialGoalView> {
      const [row] = await db
        .update(financialGoals)
        .set({
          name: input.name,
          targetMinor: input.targetMinor,
          currentMinor: input.currentMinor,
          targetDate: input.targetDate,
          priority: input.priority,
          updatedAt: new Date(),
        })
        .where(and(eq(financialGoals.id, input.id), eq(financialGoals.ownerId, ownerId)))
        .returning(goalViewColumns);
      if (!row) throw new Error("Goal not found.");
      return row;
    },

    async updateProgress(ownerId: string, id: string, currentMinor: number): Promise<FinancialGoalView> {
      const [row] = await db
        .update(financialGoals)
        .set({
          currentMinor,
          updatedAt: new Date(),
        })
        .where(and(eq(financialGoals.id, id), eq(financialGoals.ownerId, ownerId)))
        .returning(goalViewColumns);
      if (!row) throw new Error("Goal not found.");
      return row;
    },

    async setStatus(
      ownerId: string,
      id: string,
      status: "active" | "achieved" | "archived",
      options?: { stopContributions?: boolean; todayIso?: string },
    ): Promise<FinancialGoalView> {
      const todayIso = options?.todayIso ?? toTorontoDateIso();

      return db.transaction(async (tx) => {
        const [goal] = await tx
          .select(goalViewColumns)
          .from(financialGoals)
          .where(and(eq(financialGoals.id, id), eq(financialGoals.ownerId, ownerId)))
          .limit(1);
        if (!goal) throw new Error("Goal not found.");

        const plan = await loadLinkedPlan(tx, ownerId, id);
        const seriesPlan = await loadLinkedSeriesPlan(tx, ownerId, id);

        if (seriesPlan) {
          if (status === "archived" && seriesPlan.isEnabled) {
            await setLinkedSeriesPlanEnabled(tx, ownerId, seriesPlan, false, todayIso);
          } else if (status === "achieved" && options?.stopContributions !== false && seriesPlan.isEnabled) {
            await setLinkedSeriesPlanEnabled(tx, ownerId, seriesPlan, false, todayIso);
          } else if (status === "active" && seriesPlan.seriesState !== "ended") {
            const eligible = await isSeriesPlanEligible(tx, ownerId, seriesPlan);
            if (eligible && !seriesPlan.isEnabled) {
              await setLinkedSeriesPlanEnabled(tx, ownerId, seriesPlan, true, todayIso);
            } else if (!eligible && seriesPlan.isEnabled) {
              await setLinkedSeriesPlanEnabled(tx, ownerId, seriesPlan, false, todayIso);
            }
          }
        } else if (plan) {
          if (status === "archived" && (plan.isEnabled || plan.ruleIsEnabled)) {
            await setLinkedPlanEnabled(tx, ownerId, plan, false);
            await recalcForAccount(tx, ownerId, plan.accountId, todayIso, plan.ruleStartsOn);
          } else if (status === "achieved" && options?.stopContributions !== false && (plan.isEnabled || plan.ruleIsEnabled)) {
            await setLinkedPlanEnabled(tx, ownerId, plan, false);
            await recalcForAccount(tx, ownerId, plan.accountId, todayIso, plan.ruleStartsOn);
          } else if (status === "active") {
            const eligible = isEligibleGoalDestination(plan);
            if (eligible && (!plan.isEnabled || !plan.ruleIsEnabled)) {
              await setLinkedPlanEnabled(tx, ownerId, plan, true);
              await recalcForAccount(tx, ownerId, plan.accountId, todayIso, plan.ruleStartsOn);
            } else if (!eligible && (plan.isEnabled || plan.ruleIsEnabled)) {
              await setLinkedPlanEnabled(tx, ownerId, plan, false);
              await recalcForAccount(tx, ownerId, plan.accountId, todayIso, plan.ruleStartsOn);
            }
          }
        }

        return updateGoalStatus(tx, ownerId, id, status);
      });
    },

    async restore(
      ownerId: string,
      id: string,
      todayIso: string,
    ): Promise<{ goal: FinancialGoalView; planEnabled: boolean }> {
      return db.transaction(async (tx) => {
        const [goal] = await tx
          .select(goalViewColumns)
          .from(financialGoals)
          .where(and(eq(financialGoals.id, id), eq(financialGoals.ownerId, ownerId)))
          .limit(1);
        if (!goal) throw new Error("Goal not found.");

        const plan = await loadLinkedPlan(tx, ownerId, id);
        const seriesPlan = await loadLinkedSeriesPlan(tx, ownerId, id);
        let planEnabled = false;

        if (seriesPlan) {
          if (seriesPlan.seriesState !== "ended") {
            const eligible = await isSeriesPlanEligible(tx, ownerId, seriesPlan);
            if (eligible) {
              if (!seriesPlan.isEnabled || seriesPlan.seriesState !== "active") {
                await setLinkedSeriesPlanEnabled(tx, ownerId, seriesPlan, true, todayIso);
              }
              planEnabled = true;
            } else if (seriesPlan.isEnabled) {
              await setLinkedSeriesPlanEnabled(tx, ownerId, seriesPlan, false, todayIso);
            }
          }
        } else if (plan) {
          const eligible = isEligibleGoalDestination(plan);
          if (eligible) {
            if (!plan.isEnabled || !plan.ruleIsEnabled) {
              await setLinkedPlanEnabled(tx, ownerId, plan, true);
              await recalcForAccount(tx, ownerId, plan.accountId, todayIso, plan.ruleStartsOn);
            }
            planEnabled = true;
          } else if (plan.isEnabled || plan.ruleIsEnabled) {
            await setLinkedPlanEnabled(tx, ownerId, plan, false);
            await recalcForAccount(tx, ownerId, plan.accountId, todayIso, plan.ruleStartsOn);
          }
        }

        const restored = await updateGoalStatus(tx, ownerId, id, "active");
        return { goal: restored, planEnabled };
      });
    },

    async delete(ownerId: string, id: string, todayIso?: string): Promise<void> {
      const effectiveTodayIso = todayIso ?? toTorontoDateIso();

      return db.transaction(async (tx) => {
        const [goal] = await tx
          .select(goalViewColumns)
          .from(financialGoals)
          .where(and(eq(financialGoals.id, id), eq(financialGoals.ownerId, ownerId)))
          .limit(1);
        if (!goal) throw new Error("Goal not found.");

        const plan = await loadLinkedPlan(tx, ownerId, id);
        const [cashFlowPlan] = await tx
          .select({ cashFlowSeriesId: financialGoalPlans.cashFlowSeriesId })
          .from(financialGoalPlans)
          .where(and(eq(financialGoalPlans.ownerId, ownerId), eq(financialGoalPlans.goalId, id)))
          .limit(1);

        if (cashFlowPlan?.cashFlowSeriesId) {
          await tx
            .delete(transfers)
            .where(
              and(
                eq(transfers.ownerId, ownerId),
                eq(transfers.recurringSeriesId, cashFlowPlan.cashFlowSeriesId),
                eq(transfers.isGenerated, true),
                eq(transfers.status, "planned"),
              ),
            );
        }

        if (plan) {
          await tx
            .delete(accountContributionRules)
            .where(and(eq(accountContributionRules.ownerId, ownerId), eq(accountContributionRules.id, plan.ruleId)));
          await recalcForAccount(
            tx,
            ownerId,
            plan.accountId,
            effectiveTodayIso,
            addIsoDays(effectiveTodayIso, 1),
          );
        }

        const rows = await tx
          .delete(financialGoals)
          .where(and(eq(financialGoals.id, id), eq(financialGoals.ownerId, ownerId)))
          .returning({ id: financialGoals.id });
        if (rows.length !== 1) throw new Error("Goal not found.");

        if (cashFlowPlan?.cashFlowSeriesId) {
          const seriesId = cashFlowPlan.cashFlowSeriesId;
          const [linkedTransaction, linkedTransfer, linkedVersion, linkedException] = await Promise.all([
            tx
              .select({ id: transactions.id })
              .from(transactions)
              .where(and(eq(transactions.ownerId, ownerId), eq(transactions.recurringSeriesId, seriesId)))
              .limit(1),
            tx
              .select({ id: transfers.id })
              .from(transfers)
              .where(and(eq(transfers.ownerId, ownerId), eq(transfers.recurringSeriesId, seriesId)))
              .limit(1),
            tx
              .select({ id: recurringTransactions.id })
              .from(recurringTransactions)
              .where(and(eq(recurringTransactions.ownerId, ownerId), eq(recurringTransactions.seriesId, seriesId)))
              .limit(1),
            tx
              .select({ id: recurringCashFlowOccurrenceExceptions.id })
              .from(recurringCashFlowOccurrenceExceptions)
              .where(and(eq(recurringCashFlowOccurrenceExceptions.ownerId, ownerId), eq(recurringCashFlowOccurrenceExceptions.seriesId, seriesId)))
              .limit(1),
          ]);
          const hasLinkedRows =
            linkedTransaction.length > 0 ||
            linkedTransfer.length > 0 ||
            linkedVersion.length > 0 ||
            linkedException.length > 0;

          if (!hasLinkedRows) {
            await tx
              .delete(recurringCashFlowSeries)
              .where(and(eq(recurringCashFlowSeries.ownerId, ownerId), eq(recurringCashFlowSeries.id, seriesId)));
          } else {
            await tx
              .update(recurringCashFlowSeries)
              .set({ state: "ended", endedOn: effectiveTodayIso, updatedAt: new Date() })
              .where(and(eq(recurringCashFlowSeries.ownerId, ownerId), eq(recurringCashFlowSeries.id, seriesId)));
            await tx
              .update(recurringTransactions)
              .set({ endsOn: effectiveTodayIso, effectiveTo: effectiveTodayIso, nextOccurrenceOn: effectiveTodayIso, updatedAt: new Date() })
              .where(
                and(
                  eq(recurringTransactions.ownerId, ownerId),
                  eq(recurringTransactions.seriesId, seriesId),
                  isNull(recurringTransactions.effectiveTo),
                ),
              );
            const fromDate = addRecurringCashFlowDays(effectiveTodayIso, 1);
            const throughDate = await recurringFutureThroughDate(tx, ownerId, seriesId, fromDate, null);
            await syncGeneratedRecurringOccurrences(tx, ownerId, seriesId, fromDate, throughDate, {
              removeFutureGenerated: true,
            });
          }
          await refreshCashFlowLinkedAccountProjections(tx, ownerId);
        }
      });
    },
  };
}
