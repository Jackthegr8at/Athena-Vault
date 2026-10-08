import { and, asc, eq, inArray, isNull, ne, type SQL } from "drizzle-orm";
import type { Database } from "../client";
import {
  accountContributionRules,
  accounts,
  auditEvents,
  financialGoals,
  financialGoalPlans,
  institutions,
  recurringCashFlowSeries,
  recurringTransactions,
  transactions,
  transfers,
} from "../drizzle-schema";
import { addRecurringCashFlowDays, nextRecurringCashFlowOccurrence } from "../recurring-cash-flow";
import { recalculateAccountProjection, refreshCashFlowLinkedAccountProjections, type TimelineDatabase } from "./shared";
import { computeGoalPlanDefaultStartDate, GOAL_SAVING_PLAN_FREQUENCIES, validateGoalPlanStartDate, type GoalSavingPlanFrequency } from "../goal-saving-plans";
import { recurringFutureThroughDate, syncGeneratedRecurringOccurrences } from "./cash-flow";

export const GOAL_PLAN_FREQUENCIES = GOAL_SAVING_PLAN_FREQUENCIES;
export type GoalPlanFrequency = GoalSavingPlanFrequency;

export interface GoalPlanAccountView {
  readonly id: string;
  readonly name: string;
  readonly institution: string;
  readonly kind: string;
  readonly currency: string;
}

export interface GoalPlanSourceAccountView extends GoalPlanAccountView {
  readonly isVisibleInCashFlow: boolean;
}

export interface FinancialGoalPlanView {
  readonly id: string;
  readonly goalId: string;
  readonly contributionRuleId: string | null;
  readonly cashFlowSeriesId: string | null;
  readonly accountId: string;
  readonly sourceAccountId: string | null;
  readonly enabled: boolean;
  readonly ruleEnabled: boolean;
  readonly amountMinor: number;
  readonly frequency: GoalPlanFrequency;
  readonly startsOn: string;
  readonly endsOn: string | null;
  readonly countsAsExpense: boolean;
  readonly sourceRequired: boolean;
  readonly goalName: string;
  readonly targetMinor: number;
  readonly targetDate: string | null;
  readonly priority: number;
  readonly goalStatus: "active" | "achieved" | "archived";
  readonly currency: string;
  readonly accountName: string;
  readonly accountKind: string;
  readonly institutionName: string;
  readonly sourceAccountName: string | null;
  readonly sourceAccountKind: string | null;
  readonly sourceInstitutionName: string | null;
  readonly sourceIsVisibleInCashFlow: boolean | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface GoalPlanDestinationAccountView {
  readonly id: string;
  readonly name: string;
  readonly institution: string;
  readonly kind: string;
  readonly currency: string;
}

export interface GoalPlanSaveInput {
  readonly goalId: string;
  readonly accountId: string;
  readonly sourceAccountId: string;
  readonly amountMinor: number;
  readonly frequency: GoalPlanFrequency;
  readonly startsOn?: string;
  readonly countsAsExpense?: boolean;
}

const planViewColumns = {
  id: financialGoalPlans.id,
  goalId: financialGoalPlans.goalId,
  contributionRuleId: financialGoalPlans.contributionRuleId,
  cashFlowSeriesId: financialGoalPlans.cashFlowSeriesId,
  isEnabled: financialGoalPlans.isEnabled,
  ruleAccountId: accountContributionRules.accountId,
  ruleAmountMinor: accountContributionRules.amountMinor,
  ruleFrequency: accountContributionRules.frequency,
  ruleStartsOn: accountContributionRules.startsOn,
  ruleEndsOn: accountContributionRules.endsOn,
  ruleIsEnabled: accountContributionRules.isEnabled,
  versionFromAccountId: recurringTransactions.fromAccountId,
  versionToAccountId: recurringTransactions.toAccountId,
  versionAmountMinor: recurringTransactions.amountMinor,
  versionFrequency: recurringTransactions.frequency,
  versionStartsOn: recurringTransactions.startsOn,
  versionEndsOn: recurringTransactions.endsOn,
  versionCountsAsExpense: recurringTransactions.countsAsExpense,
  goalName: financialGoals.name,
  targetMinor: financialGoals.targetMinor,
  targetDate: financialGoals.targetDate,
  priority: financialGoals.priority,
  goalStatus: financialGoals.status,
  currency: financialGoals.currency,
  createdAt: financialGoalPlans.createdAt,
  updatedAt: financialGoalPlans.updatedAt,
} as const;

function buildPlanViewQuery<T extends TimelineDatabase>(
  queryDb: T,
  where: SQL<unknown> | undefined,
) {
  return queryDb
    .select(planViewColumns)
    .from(financialGoalPlans)
    .innerJoin(
      financialGoals,
      and(eq(financialGoals.id, financialGoalPlans.goalId), eq(financialGoals.ownerId, financialGoalPlans.ownerId)),
    )
    .leftJoin(
      accountContributionRules,
      and(
        eq(accountContributionRules.id, financialGoalPlans.contributionRuleId),
        eq(accountContributionRules.ownerId, financialGoalPlans.ownerId),
      ),
    )
    .leftJoin(
      recurringCashFlowSeries,
      and(
        eq(recurringCashFlowSeries.id, financialGoalPlans.cashFlowSeriesId),
        eq(recurringCashFlowSeries.ownerId, financialGoalPlans.ownerId),
      ),
    )
    .leftJoin(
      recurringTransactions,
      and(
        eq(recurringTransactions.seriesId, recurringCashFlowSeries.id),
        eq(recurringTransactions.ownerId, recurringCashFlowSeries.ownerId),
        isNull(recurringTransactions.effectiveTo),
      ),
    )
    .where(where);
}

async function loadAccountDetails(
  db: TimelineDatabase,
  ownerId: string,
  accountIds: readonly (string | null | undefined)[],
): Promise<ReadonlyMap<string, GoalPlanSourceAccountView>> {
  const ids = [...new Set(accountIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      institution: institutions.name,
      kind: accounts.kind,
      currency: accounts.currency,
      isVisibleInCashFlow: accounts.isVisibleInCashFlow,
    })
    .from(accounts)
    .innerJoin(
      institutions,
      and(eq(institutions.id, accounts.institutionId), eq(institutions.ownerId, ownerId)),
    )
    .where(and(eq(accounts.ownerId, ownerId), inArray(accounts.id, ids))) ?? [];
  return new Map((rows ?? []).map((row) => [row.id, row]));
}

function toView(
  row: {
    readonly id: string;
    readonly goalId: string;
    readonly contributionRuleId: string | null;
    readonly cashFlowSeriesId: string | null;
    readonly isEnabled: boolean;
    readonly ruleAccountId: string | null;
    readonly ruleAmountMinor: number | null;
    readonly ruleFrequency: string | null;
    readonly ruleStartsOn: string | null;
    readonly ruleEndsOn: string | null;
    readonly ruleIsEnabled: boolean | null;
    readonly versionFromAccountId: string | null;
    readonly versionToAccountId: string | null;
    readonly versionAmountMinor: number | null;
    readonly versionFrequency: string | null;
    readonly versionStartsOn: string | null;
    readonly versionEndsOn: string | null;
    readonly versionCountsAsExpense: boolean | null;
    readonly goalName: string;
    readonly targetMinor: number;
    readonly targetDate: string | null;
    readonly priority: number;
    readonly goalStatus: "active" | "achieved" | "archived";
    readonly currency: string;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  },
  accountDetails: ReadonlyMap<string, GoalPlanSourceAccountView>,
): FinancialGoalPlanView {
  const sourceAccountId = row.versionFromAccountId ?? null;
  const destinationAccountId = row.versionToAccountId ?? row.ruleAccountId;
  const source = sourceAccountId ? accountDetails.get(sourceAccountId) : undefined;
  const destination = destinationAccountId ? accountDetails.get(destinationAccountId) : undefined;
  const amountMinor = row.versionAmountMinor ?? row.ruleAmountMinor;
  const frequency = row.versionFrequency ?? row.ruleFrequency;
  const startsOn = row.versionStartsOn ?? row.ruleStartsOn;
  const endsOn = row.versionEndsOn ?? row.ruleEndsOn;
  return {
    id: row.id,
    goalId: row.goalId,
    contributionRuleId: row.contributionRuleId,
    cashFlowSeriesId: row.cashFlowSeriesId,
    accountId: destinationAccountId!,
    sourceAccountId,
    enabled: row.isEnabled,
    ruleEnabled: row.ruleIsEnabled ?? false,
    amountMinor: amountMinor!,
    frequency: frequency as GoalPlanFrequency,
    startsOn: startsOn!,
    endsOn: endsOn ?? null,
    countsAsExpense: row.versionCountsAsExpense === true,
    sourceRequired: row.cashFlowSeriesId === null,
    goalName: row.goalName,
    targetMinor: row.targetMinor,
    targetDate: row.targetDate,
    priority: row.priority,
    goalStatus: row.goalStatus,
    currency: row.currency,
    accountName: destination?.name ?? "",
    accountKind: destination?.kind ?? "",
    institutionName: destination?.institution ?? "",
    sourceAccountName: source?.name ?? null,
    sourceAccountKind: source?.kind ?? null,
    sourceInstitutionName: source?.institution ?? null,
    sourceIsVisibleInCashFlow: source?.isVisibleInCashFlow ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDestinationView(row: {
  readonly id: string;
  readonly name: string;
  readonly institution: string;
  readonly kind: string;
  readonly currency: string;
}): GoalPlanDestinationAccountView {
  return {
    id: row.id,
    name: row.name,
    institution: row.institution,
    kind: row.kind,
    currency: row.currency,
  };
}

function validateAmount(value: number): void {
  if (!Number.isInteger(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new Error("Contribution amount must be a positive safe integer.");
  }
}

function validateFrequency(value: string): asserts value is GoalPlanFrequency {
  if (!(GOAL_PLAN_FREQUENCIES as readonly string[]).includes(value)) {
    throw new Error("Goal plan frequency is not supported.");
  }
}

export function createGoalPlanRepository(db: Database) {
  return {
    async listByOwner(ownerId: string): Promise<readonly FinancialGoalPlanView[]> {
      const rows = await buildPlanViewQuery(db, eq(financialGoalPlans.ownerId, ownerId)).orderBy(
        asc(financialGoals.priority),
        asc(financialGoals.targetDate),
        asc(financialGoals.name),
        asc(financialGoals.id),
      );
      const accountIds = rows.flatMap((row) => [row.versionFromAccountId, row.versionToAccountId, row.ruleAccountId]);
      const details = await loadAccountDetails(db, ownerId, accountIds);
      return rows.map((row) => toView(row, details));
    },

    async getByGoal(ownerId: string, goalId: string): Promise<FinancialGoalPlanView | null> {
      const rows = await buildPlanViewQuery(
        db,
        and(eq(financialGoalPlans.ownerId, ownerId), eq(financialGoalPlans.goalId, goalId)),
      ).limit(1);
      if (!rows[0]) return null;
      const details = await loadAccountDetails(db, ownerId, [
        rows[0].versionFromAccountId,
        rows[0].versionToAccountId,
        rows[0].ruleAccountId,
      ]);
      return toView(rows[0], details);
    },

    async listEligibleDestinationAccounts(
      ownerId: string,
    ): Promise<readonly GoalPlanDestinationAccountView[]> {
      const rows = await db
        .select({
          id: accounts.id,
          name: accounts.name,
          institution: institutions.name,
          kind: accounts.kind,
          currency: accounts.currency,
        })
        .from(accounts)
        .innerJoin(
          institutions,
          and(eq(institutions.id, accounts.institutionId), eq(institutions.ownerId, ownerId)),
        )
        .where(
          and(
            eq(accounts.ownerId, ownerId),
            eq(accounts.isActive, true),
            eq(accounts.currency, "CAD"),
            ne(accounts.kind, "credit"),
            ne(accounts.kind, "loan"),
          ),
        )
        .orderBy(asc(accounts.name), asc(accounts.id));
      return rows.map(toDestinationView);
    },

    async listEligibleSourceAccounts(
      ownerId: string,
    ): Promise<readonly GoalPlanSourceAccountView[]> {
      const rows = await db
        .select({
          id: accounts.id,
          name: accounts.name,
          institution: institutions.name,
          kind: accounts.kind,
          currency: accounts.currency,
          isVisibleInCashFlow: accounts.isVisibleInCashFlow,
        })
        .from(accounts)
        .innerJoin(
          institutions,
          and(eq(institutions.id, accounts.institutionId), eq(institutions.ownerId, ownerId)),
        )
        .where(
          and(
            eq(accounts.ownerId, ownerId),
            eq(accounts.isActive, true),
            eq(accounts.currency, "CAD"),
            eq(accounts.isVisibleInCashFlow, true),
          ),
        )
        .orderBy(asc(accounts.name), asc(accounts.id));
      return rows;
    },

    async savePlan(
      ownerId: string,
      input: GoalPlanSaveInput,
      todayIso: string,
    ): Promise<FinancialGoalPlanView> {
      validateAmount(input.amountMinor);
      validateFrequency(input.frequency);
      if (input.sourceAccountId === input.accountId) {
        throw new Error("Source and destination accounts must be different.");
      }
      const countsAsExpense = input.countsAsExpense === true;

      return db.transaction(async (tx) => {
        const [goal] = await tx
          .select({
            id: financialGoals.id,
            targetDate: financialGoals.targetDate,
          })
          .from(financialGoals)
          .where(
            and(
              eq(financialGoals.ownerId, ownerId),
              eq(financialGoals.id, input.goalId),
              eq(financialGoals.status, "active"),
            ),
          )
          .limit(1);
        if (!goal) {
          throw new Error("Goal plan not found.");
        }
        if (goal.targetDate === null) {
          throw new Error("Goal target date is required.");
        }
        if (goal.targetDate < todayIso) {
          throw new Error("Goal target date must be on or after today.");
        }
        const startsOn = input.startsOn !== undefined
          ? (validateGoalPlanStartDate({ startsOn: input.startsOn, todayIso, targetDate: goal.targetDate }), input.startsOn)
          : computeGoalPlanDefaultStartDate({ targetDate: goal.targetDate, frequency: input.frequency, todayIso });

        const [source] = await tx
          .select({ id: accounts.id })
          .from(accounts)
          .where(
            and(
              eq(accounts.ownerId, ownerId),
              eq(accounts.id, input.sourceAccountId),
              eq(accounts.isActive, true),
              eq(accounts.currency, "CAD"),
              eq(accounts.isVisibleInCashFlow, true),
            ),
          )
          .limit(1);
        if (!source) {
          throw new Error("Source account must be active, CAD, and visible in Cash Flow.");
        }

        const [destination] = await tx
          .select({ id: accounts.id })
          .from(accounts)
          .where(
            and(
              eq(accounts.ownerId, ownerId),
              eq(accounts.id, input.accountId),
              eq(accounts.isActive, true),
              eq(accounts.currency, "CAD"),
              ne(accounts.kind, "credit"),
              ne(accounts.kind, "loan"),
            ),
          )
          .limit(1);
        if (!destination) {
          throw new Error("Goal plan destination account is not eligible.");
        }

        const [existingPlan] = await tx
          .select({
            id: financialGoalPlans.id,
            contributionRuleId: financialGoalPlans.contributionRuleId,
            cashFlowSeriesId: financialGoalPlans.cashFlowSeriesId,
            isEnabled: financialGoalPlans.isEnabled,
          })
          .from(financialGoalPlans)
          .where(
            and(
              eq(financialGoalPlans.ownerId, ownerId),
              eq(financialGoalPlans.goalId, input.goalId),
            ),
          )
          .limit(1);

        let previousDestinationId: string | null = null;
        if (existingPlan?.contributionRuleId) {
          const detached = await tx
            .update(financialGoalPlans)
            .set({ contributionRuleId: null })
            .where(
              and(
                eq(financialGoalPlans.ownerId, ownerId),
                eq(financialGoalPlans.id, existingPlan.id),
              ),
            )
            .returning({ id: financialGoalPlans.id });
          if (detached.length !== 1) {
            throw new Error("Goal plan contribution rule could not be detached.");
          }

          const [rule] = await tx
            .select({ accountId: accountContributionRules.accountId })
            .from(accountContributionRules)
            .where(
              and(
                eq(accountContributionRules.ownerId, ownerId),
                eq(accountContributionRules.id, existingPlan.contributionRuleId),
              ),
            )
            .limit(1);
          previousDestinationId = rule?.accountId ?? null;
          await tx
            .delete(accountContributionRules)
            .where(
              and(
                eq(accountContributionRules.ownerId, ownerId),
                eq(accountContributionRules.id, existingPlan.contributionRuleId),
              ),
            );
        }

        if (existingPlan?.cashFlowSeriesId) {
          const seriesId = existingPlan.cashFlowSeriesId;
          const [currentVersion] = await tx
            .select({
              id: recurringTransactions.id,
              kind: recurringTransactions.kind,
              fromAccountId: recurringTransactions.fromAccountId,
              toAccountId: recurringTransactions.toAccountId,
            })
            .from(recurringTransactions)
            .where(
              and(
                eq(recurringTransactions.ownerId, ownerId),
                eq(recurringTransactions.seriesId, seriesId),
                isNull(recurringTransactions.effectiveTo),
              ),
            )
            .limit(1);

          if (currentVersion?.kind === "transfer") {
            previousDestinationId = currentVersion.toAccountId;

            const otherVersions = await tx
              .select({
                id: recurringTransactions.id,
                effectiveFrom: recurringTransactions.effectiveFrom,
              })
              .from(recurringTransactions)
              .where(
                and(
                  eq(recurringTransactions.ownerId, ownerId),
                  eq(recurringTransactions.seriesId, seriesId),
                  ne(recurringTransactions.id, currentVersion.id),
                ),
              )
              .orderBy(asc(recurringTransactions.effectiveFrom));
            for (const version of otherVersions) {
              if (version.effectiveFrom <= todayIso) continue;
              const [linkedTransaction, linkedTransfer] = await Promise.all([
                tx
                  .select({ id: transactions.id })
                  .from(transactions)
                  .where(and(eq(transactions.ownerId, ownerId), eq(transactions.recurringTransactionId, version.id)))
                  .limit(1),
                tx
                  .select({ id: transfers.id })
                  .from(transfers)
                  .where(and(eq(transfers.ownerId, ownerId), eq(transfers.recurringTransactionId, version.id)))
                  .limit(1),
              ]);
              if (!linkedTransaction && !linkedTransfer) {
                await tx
                  .delete(recurringTransactions)
                  .where(and(eq(recurringTransactions.ownerId, ownerId), eq(recurringTransactions.id, version.id)));
              } else {
                const closeTo = todayIso >= version.effectiveFrom ? todayIso : version.effectiveFrom;
                await tx
                  .update(recurringTransactions)
                  .set({ endsOn: closeTo, effectiveTo: closeTo, nextOccurrenceOn: closeTo, updatedAt: new Date() })
                  .where(and(eq(recurringTransactions.ownerId, ownerId), eq(recurringTransactions.id, version.id)));
              }
            }

            const schedule = {
              frequency: input.frequency,
              startsOn,
              endsOn: null as string | null,
              weekdayAdjustment: "none" as const,
            };
            const firstOccurrenceOn =
              nextRecurringCashFlowOccurrence(schedule, addRecurringCashFlowDays(startsOn, -2)) ?? startsOn;

            await tx
              .update(recurringCashFlowSeries)
              .set({ state: existingPlan.isEnabled ? "active" : "paused", endedOn: null, updatedAt: new Date() })
              .where(
                and(
                  eq(recurringCashFlowSeries.ownerId, ownerId),
                  eq(recurringCashFlowSeries.id, seriesId),
                ),
              );

            await tx
              .update(recurringTransactions)
              .set({
                accountId: null,
                fromAccountId: input.sourceAccountId,
                toAccountId: input.accountId,
                description: "Goal savings transfer",
                amountMinor: input.amountMinor,
                frequency: input.frequency,
                startsOn,
                endsOn: null,
                effectiveFrom: firstOccurrenceOn,
                effectiveTo: null,
                versionNote: null,
                countsAsExpense,
                nextOccurrenceOn: firstOccurrenceOn,
                updatedAt: new Date(),
              })
              .where(and(eq(recurringTransactions.ownerId, ownerId), eq(recurringTransactions.id, currentVersion.id)));

            const fromDate = addRecurringCashFlowDays(todayIso, 1);
            const throughDate = await recurringFutureThroughDate(tx, ownerId, seriesId, fromDate, goal.targetDate);
            await syncGeneratedRecurringOccurrences(tx, ownerId, seriesId, fromDate, throughDate, {
              removeFutureGenerated: true,
            });
            const regenerateThroughDate = await recurringFutureThroughDate(tx, ownerId, seriesId, firstOccurrenceOn, goal.targetDate);
            await syncGeneratedRecurringOccurrences(tx, ownerId, seriesId, firstOccurrenceOn, regenerateThroughDate, {
              preserveExistingRows: true,
            });

            await tx
              .update(financialGoalPlans)
              .set({ updatedAt: new Date() })
              .where(and(eq(financialGoalPlans.ownerId, ownerId), eq(financialGoalPlans.id, existingPlan.id)));

            if (previousDestinationId && previousDestinationId !== input.accountId) {
              await recalculateAccountProjection(tx, ownerId, previousDestinationId, {
                fromDate: todayIso,
                futureAfter: todayIso,
              });
            }
            await refreshCashFlowLinkedAccountProjections(tx, ownerId);

            await tx.insert(auditEvents).values({
              ownerId,
              actorUserId: null,
              action: "updated",
              entityType: "financial_goal_plans",
              entityId: existingPlan.id,
              metadata: {
                goalId: input.goalId,
                accountId: input.accountId,
                sourceAccountId: input.sourceAccountId,
                amountMinor: input.amountMinor,
                frequency: input.frequency,
                startsOn,
                countsAsExpense,
                enabled: existingPlan.isEnabled,
              },
            });

            const [view] = await buildPlanViewQuery(
              tx,
              and(eq(financialGoalPlans.ownerId, ownerId), eq(financialGoalPlans.id, existingPlan.id)),
            ).limit(1);
            if (!view) throw new Error("Goal plan could not be reloaded.");
            const details = await loadAccountDetails(tx, ownerId, [view.versionFromAccountId, view.versionToAccountId, view.ruleAccountId]);
            return toView(view, details);
          }

          const fromDate = todayIso;
          const throughDate = await recurringFutureThroughDate(
            tx,
            ownerId,
            existingPlan.cashFlowSeriesId,
            fromDate,
            goal.targetDate,
          );
          await tx
            .update(recurringCashFlowSeries)
            .set({ state: "ended", endedOn: todayIso, updatedAt: new Date() })
            .where(
              and(
                eq(recurringCashFlowSeries.ownerId, ownerId),
                eq(recurringCashFlowSeries.id, existingPlan.cashFlowSeriesId),
              ),
            );
          await tx
            .update(recurringTransactions)
            .set({ endsOn: todayIso, effectiveTo: todayIso, nextOccurrenceOn: todayIso, updatedAt: new Date() })
            .where(
              and(
                eq(recurringTransactions.ownerId, ownerId),
                eq(recurringTransactions.seriesId, existingPlan.cashFlowSeriesId),
                isNull(recurringTransactions.effectiveTo),
              ),
            );
          await syncGeneratedRecurringOccurrences(tx, ownerId, existingPlan.cashFlowSeriesId, fromDate, throughDate, {
            removeFutureGenerated: true,
          });
        }

        const [series] = await tx
          .insert(recurringCashFlowSeries)
          .values({
            ownerId,
            kind: "transfer",
            state: "active",
            endedOn: null,
            homeHouseholdFrequency: null,
          })
          .returning({ id: recurringCashFlowSeries.id });
        if (!series) throw new Error("Recurring Cash Flow series could not be created.");

        const schedule = {
          frequency: input.frequency,
          startsOn,
          endsOn: goal.targetDate,
          weekdayAdjustment: "none" as const,
        };
        const firstOccurrenceOn =
          nextRecurringCashFlowOccurrence(schedule, addRecurringCashFlowDays(startsOn, -2)) ?? startsOn;
        const [version] = await tx
          .insert(recurringTransactions)
          .values({
            ownerId,
            seriesId: series.id,
            accountId: null,
            fromAccountId: input.sourceAccountId,
            toAccountId: input.accountId,
            kind: "transfer",
            frequency: input.frequency,
            weekdayAdjustment: "none",
            description: "Goal savings transfer",
            amountMinor: input.amountMinor,
            currency: "CAD",
            startsOn,
            endsOn: goal.targetDate,
            effectiveFrom: firstOccurrenceOn,
            effectiveTo: null,
            versionNote: null,
            countsAsExpense,
            nextOccurrenceOn: firstOccurrenceOn,
            status: "planned",
          })
          .returning({ id: recurringTransactions.id });
        if (!version) throw new Error("Recurring Cash Flow version could not be created.");

        const throughDate = await recurringFutureThroughDate(
          tx,
          ownerId,
          series.id,
          firstOccurrenceOn,
          goal.targetDate,
        );
        await syncGeneratedRecurringOccurrences(tx, ownerId, series.id, firstOccurrenceOn, throughDate, {
          preserveExistingRows: true,
        });

        const nextEnabled = existingPlan ? existingPlan.isEnabled : true;
        let planId: string;
        if (existingPlan) {
          await tx
            .update(financialGoalPlans)
            .set({
              contributionRuleId: null,
              cashFlowSeriesId: series.id,
              isEnabled: nextEnabled,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(financialGoalPlans.ownerId, ownerId),
                eq(financialGoalPlans.id, existingPlan.id),
              ),
            );
          planId = existingPlan.id;
        } else {
          const [created] = await tx
            .insert(financialGoalPlans)
            .values({
              ownerId,
              goalId: input.goalId,
              contributionRuleId: null,
              cashFlowSeriesId: series.id,
              isEnabled: nextEnabled,
            })
            .returning({ id: financialGoalPlans.id });
          planId = created!.id;
        }

        if (previousDestinationId && previousDestinationId !== input.accountId) {
          await recalculateAccountProjection(tx, ownerId, previousDestinationId, {
            fromDate: todayIso,
            futureAfter: todayIso,
          });
        }
        await refreshCashFlowLinkedAccountProjections(tx, ownerId);

        await tx.insert(auditEvents).values({
          ownerId,
          actorUserId: null,
          action: existingPlan ? "updated" : "created",
          entityType: "financial_goal_plans",
          entityId: planId,
          metadata: {
            goalId: input.goalId,
            accountId: input.accountId,
            sourceAccountId: input.sourceAccountId,
            amountMinor: input.amountMinor,
            frequency: input.frequency,
            startsOn,
            countsAsExpense,
            enabled: nextEnabled,
          },
        });

        const [view] = await buildPlanViewQuery(
          tx,
          and(eq(financialGoalPlans.ownerId, ownerId), eq(financialGoalPlans.id, planId)),
        ).limit(1);
        if (!view) throw new Error("Goal plan could not be reloaded.");
        const details = await loadAccountDetails(tx, ownerId, [view.versionFromAccountId, view.versionToAccountId, view.ruleAccountId]);
        return toView(view, details);
      });
    },

    async setEnabled(
      ownerId: string,
      goalId: string,
      enabled: boolean,
      todayIso: string,
    ): Promise<FinancialGoalPlanView> {
      return db.transaction(async (tx) => {
        const [plan] = await tx
          .select({
            id: financialGoalPlans.id,
            contributionRuleId: financialGoalPlans.contributionRuleId,
            cashFlowSeriesId: financialGoalPlans.cashFlowSeriesId,
            isEnabled: financialGoalPlans.isEnabled,
          })
          .from(financialGoalPlans)
          .where(
            and(
              eq(financialGoalPlans.ownerId, ownerId),
              eq(financialGoalPlans.goalId, goalId),
            ),
          )
          .limit(1);
        if (!plan) {
          throw new Error("Goal plan not found.");
        }
        if (enabled && !plan.cashFlowSeriesId) {
          throw new Error("Source account required.");
        }

        if (plan.cashFlowSeriesId) {
          const fromDate = addRecurringCashFlowDays(todayIso, 1);
          const throughDate = await recurringFutureThroughDate(tx, ownerId, plan.cashFlowSeriesId, fromDate, null);
          if (enabled) {
            const [version] = await tx
              .select({
                fromAccountId: recurringTransactions.fromAccountId,
                toAccountId: recurringTransactions.toAccountId,
              })
              .from(recurringTransactions)
              .where(
                and(
                  eq(recurringTransactions.ownerId, ownerId),
                  eq(recurringTransactions.seriesId, plan.cashFlowSeriesId),
                  isNull(recurringTransactions.effectiveTo),
                ),
              )
              .limit(1);
            if (!version?.fromAccountId || !version?.toAccountId) {
              throw new Error("Source account required.");
            }
            const [source] = await tx
              .select({ id: accounts.id })
              .from(accounts)
              .where(
                and(
                  eq(accounts.ownerId, ownerId),
                  eq(accounts.id, version.fromAccountId),
                  eq(accounts.isActive, true),
                  eq(accounts.currency, "CAD"),
                  eq(accounts.isVisibleInCashFlow, true),
                ),
              )
              .limit(1);
            if (!source) {
              throw new Error("Source account must be active, CAD, and visible in Cash Flow.");
            }
            const [destination] = await tx
              .select({ id: accounts.id })
              .from(accounts)
              .where(
                and(
                  eq(accounts.ownerId, ownerId),
                  eq(accounts.id, version.toAccountId),
                  eq(accounts.isActive, true),
                  eq(accounts.currency, "CAD"),
                  ne(accounts.kind, "credit"),
                  ne(accounts.kind, "loan"),
                ),
              )
              .limit(1);
            if (!destination) {
              throw new Error("Goal plan destination account is not eligible.");
            }
            await tx
              .update(recurringCashFlowSeries)
              .set({ state: "active", endedOn: null, updatedAt: new Date() })
              .where(
                and(
                  eq(recurringCashFlowSeries.ownerId, ownerId),
                  eq(recurringCashFlowSeries.id, plan.cashFlowSeriesId),
                ),
              );
            await syncGeneratedRecurringOccurrences(tx, ownerId, plan.cashFlowSeriesId, fromDate, throughDate, {
              preserveExistingRows: true,
            });
          } else {
            await tx
              .update(recurringCashFlowSeries)
              .set({ state: "paused", endedOn: null, updatedAt: new Date() })
              .where(
                and(
                  eq(recurringCashFlowSeries.ownerId, ownerId),
                  eq(recurringCashFlowSeries.id, plan.cashFlowSeriesId),
                ),
              );
            await syncGeneratedRecurringOccurrences(tx, ownerId, plan.cashFlowSeriesId, fromDate, throughDate, {
              removeFutureGenerated: true,
            });
          }
        } else if (plan.contributionRuleId) {
          await tx
            .update(accountContributionRules)
            .set({ isEnabled: enabled, updatedAt: new Date() })
            .where(
              and(
                eq(accountContributionRules.ownerId, ownerId),
                eq(accountContributionRules.id, plan.contributionRuleId),
              ),
            );
        }

        await tx
          .update(financialGoalPlans)
          .set({ isEnabled: enabled, updatedAt: new Date() })
          .where(
            and(eq(financialGoalPlans.ownerId, ownerId), eq(financialGoalPlans.id, plan.id)),
          );

        await refreshCashFlowLinkedAccountProjections(tx, ownerId);

        await tx.insert(auditEvents).values({
          ownerId,
          actorUserId: null,
          action: "updated",
          entityType: "financial_goal_plans",
          entityId: plan.id,
          metadata: {
            goalId,
            enabled,
          },
        });
        const [view] = await buildPlanViewQuery(
          tx,
          and(eq(financialGoalPlans.ownerId, ownerId), eq(financialGoalPlans.id, plan.id)),
        ).limit(1);
        if (!view) throw new Error("Goal plan could not be reloaded.");
        const details = await loadAccountDetails(tx, ownerId, [view.versionFromAccountId, view.versionToAccountId, view.ruleAccountId]);
        return toView(view, details);
      });
    },
  };
}
