import {
  annualExpenseDueDate,
  deriveAnnualExpenseValues,
  type AnnualBudgetStatus,
} from "@athena/finance-engine";
import { and, asc, desc, eq, gte, inArray, isNull, ne } from "drizzle-orm";
import type { Database } from "./client";
import { recalculateAnnualBudgetLinkedAccountProjections } from "./repositories/account-timeline";
import {
  accounts,
  annualExpensePayments,
  annualExpenseValues,
  annualExpenses,
  annualBudgets,
  auditEvents,
  institutions,
} from "./drizzle-schema";

export interface AnnualBudgetPaymentView {
  readonly id: string;
  readonly paymentOn: string;
  readonly amountMinor: number;
  readonly note: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AnnualBudgetOccurrenceView {
  readonly id: string | null;
  readonly taxYear: number;
  readonly budgetId: string;
  readonly plannedAmountMinor: number;
  readonly templateAmountMinor: number;
  readonly dueMonth: number | null;
  readonly dueDay: number | null;
  readonly dueDate: string | null;
  readonly amountOverrideMinor: number | null;
  readonly dueDateOverridden: boolean;
  readonly note: string | null;
  readonly legacyFundedMinor: number;
  readonly paidMinor: number;
  readonly remainingMinor: number;
  readonly varianceMinor: number;
  readonly status: AnnualBudgetStatus;
  readonly payments: readonly AnnualBudgetPaymentView[];
}

export interface AnnualBudgetItemView {
  readonly id: string;
  readonly budgetId: string;
  readonly name: string;
  readonly amountMinor: number;
  readonly dueMonth: number | null;
  readonly dueDay: number | null;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly occurrence: AnnualBudgetOccurrenceView;
  readonly history: readonly AnnualBudgetOccurrenceView[];
}

export interface AnnualBudgetView {
  readonly id: string;
  readonly name: string;
  readonly linkedAccountId: string;
  readonly linkedAccountName: string;
  readonly isActive: boolean;
  readonly displayOrder: number;
  readonly itemCount: number;
  readonly totalPlannedMinor: number;
  readonly totalPaidMinor: number;
  readonly totalRemainingMinor: number;
  readonly items: readonly AnnualBudgetItemView[];
}

export interface AnnualBudgetSummary {
  readonly taxYear: number;
  readonly budgets: readonly AnnualBudgetView[];
}

export interface AnnualBudgetAccountOption {
  readonly id: string;
  readonly name: string;
  readonly institutionName: string;
}

export interface AnnualBudgetCreateInput {
  readonly name: string;
  readonly linkedAccountId: string;
}

export interface AnnualBudgetUpdateInput {
  readonly name: string;
  readonly linkedAccountId: string;
}

export interface AnnualBudgetRestoreInput {
  readonly linkedAccountId?: string | null;
}

export interface AnnualBudgetListEligibleAccountsOptions {
  readonly includeBudgetId?: string;
}

export interface AnnualExpenseTemplateMutationInput {
  readonly name: string;
  readonly amountMinor: number;
  readonly amountChanged?: boolean;
  readonly dueMonth: number | null;
  readonly dueDay: number | null;
  readonly isActive?: boolean;
}

export interface AnnualExpenseCreateInput extends AnnualExpenseTemplateMutationInput {
  readonly budgetId: string;
  readonly taxYear: number;
}

export interface AnnualExpenseUpdateInput extends AnnualExpenseTemplateMutationInput {
  readonly fromYear?: number;
}

type AnnualBudgetQuery = Database;
type AnnualBudgetTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

function assertOwnerId(ownerId: string): void {
  if (!ownerId.trim()) throw new RangeError("Owner ID is required.");
}

function assertBudgetName(name: string): string {
  const normalized = name.trim();
  if (!normalized) throw new RangeError("Annual budget name is required.");
  if (normalized.length > 120) throw new RangeError("Annual budget name must be 120 characters or fewer.");
  return normalized;
}

function assertSafeNonnegative(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer.`);
}

function assertYear(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1900 || value > 2200) throw new RangeError("Tax year must be between 1900 and 2200.");
}

function assertDueMonth(value: number | null): void {
  if (value !== null && (!Number.isSafeInteger(value) || value < 1 || value > 12)) throw new RangeError("Due month must be between 1 and 12.");
}

function assertDueDay(value: number | null): void {
  if (value !== null && (!Number.isSafeInteger(value) || value < 1 || value > 31)) throw new RangeError("Due day must be between 1 and 31.");
}

function assertTemplateInput(input: AnnualExpenseTemplateMutationInput): void {
  if (!input.name.trim()) throw new RangeError("Annual expense name is required.");
  if (input.name.trim().length > 120) throw new RangeError("Annual expense name must be 120 characters or fewer.");
  assertSafeNonnegative(input.amountMinor, "Annual expense amount");
  assertDueMonth(input.dueMonth);
  assertDueDay(input.dueDay);
}

function effectiveDueDate(taxYear: number, dueMonth: number | null, dueDay: number | null): string | null {
  return dueMonth === null ? null : annualExpenseDueDate(taxYear, dueMonth, dueDay);
}

function occurrenceView(
  value: {
    readonly id: string | null;
    readonly taxYear: number;
    readonly budgetId: string;
    readonly amountMinor: number;
    readonly amountOverrideMinor: number | null;
    readonly dueMonthOverride: number | null;
    readonly dueDayOverride: number | null;
    readonly note: string | null;
    readonly fundedMinor: number;
  },
  template: {
    readonly amountMinor: number;
    readonly dueMonth: number | null;
    readonly dueDay: number | null;
  },
  payments: readonly AnnualBudgetPaymentView[],
): AnnualBudgetOccurrenceView {
  const dueMonth = value.dueMonthOverride ?? template.dueMonth;
  const dueDay = value.dueDayOverride ?? template.dueDay;
  const plannedAmountMinor = value.amountOverrideMinor ?? value.amountMinor;
  const derived = deriveAnnualExpenseValues(plannedAmountMinor, payments);
  return {
    id: value.id,
    taxYear: value.taxYear,
    budgetId: value.budgetId,
    plannedAmountMinor,
    templateAmountMinor: template.amountMinor,
    dueMonth,
    dueDay,
    dueDate: effectiveDueDate(value.taxYear, dueMonth, dueDay),
    amountOverrideMinor: value.amountOverrideMinor,
    dueDateOverridden: value.dueMonthOverride !== null || value.dueDayOverride !== null,
    note: value.note,
    legacyFundedMinor: value.fundedMinor,
    ...derived,
    payments,
  };
}

async function ownerBudgetMutationRow(
  queryDb: AnnualBudgetQuery | AnnualBudgetTransaction,
  ownerId: string,
  budgetId: string,
  requireActive: boolean,
) {
  const [budget] = await queryDb.select({
    id: annualBudgets.id,
    name: annualBudgets.name,
    linkedAccountId: annualBudgets.linkedAccountId,
    isActive: annualBudgets.isActive,
    displayOrder: annualBudgets.displayOrder,
  }).from(annualBudgets)
    .where(and(
      eq(annualBudgets.id, budgetId),
      eq(annualBudgets.ownerId, ownerId),
      ...(requireActive ? [eq(annualBudgets.isActive, true)] : []),
    ))
    .limit(1);
  if (!budget) throw new Error("Annual budget not found.");
  return budget;
}

async function ensureEligibleBudgetAccount(
  tx: AnnualBudgetTransaction,
  ownerId: string,
  linkedAccountId: string,
  excludeBudgetId?: string,
) {
  const [account] = await tx.select({ id: accounts.id, name: accounts.name, isActive: accounts.isActive })
    .from(accounts)
    .where(and(eq(accounts.id, linkedAccountId), eq(accounts.ownerId, ownerId)))
    .limit(1);
  if (!account) throw new Error("Annual budget linked account not found.");
  if (!account.isActive) throw new Error("Annual budget linked account is not active.");

  const [assignment] = await tx.select({ id: annualBudgets.id })
    .from(annualBudgets)
    .where(and(
      eq(annualBudgets.ownerId, ownerId),
      eq(annualBudgets.linkedAccountId, linkedAccountId),
      eq(annualBudgets.isActive, true),
      ...(excludeBudgetId ? [ne(annualBudgets.id, excludeBudgetId)] : []),
    ))
    .limit(1);
  if (assignment) throw new Error("Annual budget linked account is already assigned to another active budget.");
  return account;
}

async function nextBudgetDisplayOrder(tx: AnnualBudgetTransaction, ownerId: string): Promise<number> {
  const [last] = await tx.select({ displayOrder: annualBudgets.displayOrder })
    .from(annualBudgets)
    .where(eq(annualBudgets.ownerId, ownerId))
    .orderBy(desc(annualBudgets.displayOrder), desc(annualBudgets.id))
    .limit(1);
  return (last?.displayOrder ?? -1) + 1;
}

async function updateBudgetInTransaction(
  tx: AnnualBudgetTransaction,
  ownerId: string,
  budgetId: string,
  input: AnnualBudgetUpdateInput,
): Promise<void> {
  const budget = await ownerBudgetMutationRow(tx, ownerId, budgetId, true);
  const name = assertBudgetName(input.name);
  const account = await ensureEligibleBudgetAccount(tx, ownerId, input.linkedAccountId, budget.id);
  const [updated] = await tx.update(annualBudgets)
    .set({ name, linkedAccountId: account.id, updatedAt: new Date() })
    .where(and(eq(annualBudgets.id, budget.id), eq(annualBudgets.ownerId, ownerId), eq(annualBudgets.isActive, true)))
    .returning({ id: annualBudgets.id });
  if (!updated) throw new Error("Annual budget not found.");

  if (budget.linkedAccountId !== account.id) {
    await recalculateAnnualBudgetLinkedAccountProjections(tx, ownerId, [budget.linkedAccountId, account.id]);
  }
  await tx.insert(auditEvents).values({
    ownerId,
    actorUserId: ownerId,
    action: "updated",
    entityType: "annual_budget",
    entityId: budget.id,
    metadata: {
      operation: budget.linkedAccountId === account.id && budget.name !== name ? "rename" : "update",
      previousName: budget.name,
      name,
      previousLinkedAccountId: budget.linkedAccountId,
      linkedAccountId: account.id,
    },
  });
}

async function ownerBudget(queryDb: AnnualBudgetQuery | AnnualBudgetTransaction, ownerId: string, budgetId: string, requireActive = true) {
  const [budget] = await queryDb.select({
    id: annualBudgets.id,
    name: annualBudgets.name,
    linkedAccountId: annualBudgets.linkedAccountId,
    isActive: annualBudgets.isActive,
  }).from(annualBudgets)
    .where(and(
      eq(annualBudgets.id, budgetId),
      eq(annualBudgets.ownerId, ownerId),
      ...(requireActive ? [eq(annualBudgets.isActive, true)] : []),
    ))
    .limit(1);
  if (!budget) throw new Error("Annual budget not found.");
  const [account] = await queryDb.select({ id: accounts.id, name: accounts.name, isActive: accounts.isActive })
    .from(accounts)
    .where(and(eq(accounts.id, budget.linkedAccountId), eq(accounts.ownerId, ownerId)))
    .limit(1);
  if (!account) throw new Error("Annual budget linked account not found.");
  if (!account.isActive && requireActive) throw new Error("Annual budget linked account is not active.");
  return { ...budget, linkedAccountName: account.name };
}

async function ownerExpense(queryDb: AnnualBudgetQuery | AnnualBudgetTransaction, ownerId: string, expenseId: string) {
  const [expense] = await queryDb.select({
    id: annualExpenses.id,
    budgetId: annualExpenses.budgetId,
    name: annualExpenses.name,
    amountMinor: annualExpenses.amountMinor,
    dueMonth: annualExpenses.dueMonth,
    dueDay: annualExpenses.dueDay,
    isActive: annualExpenses.isActive,
    createdAt: annualExpenses.createdAt,
    updatedAt: annualExpenses.updatedAt,
  }).from(annualExpenses)
    .innerJoin(annualBudgets, and(eq(annualBudgets.id, annualExpenses.budgetId), eq(annualBudgets.ownerId, ownerId)))
    .where(and(eq(annualExpenses.id, expenseId), eq(annualExpenses.ownerId, ownerId)))
    .limit(1);
  if (!expense) throw new Error("Annual expense not found.");
  return expense;
}

async function readSummary(queryDb: AnnualBudgetQuery, ownerId: string, taxYear: number): Promise<AnnualBudgetSummary> {
  assertOwnerId(ownerId);
  assertYear(taxYear);
  const [budgetRows, expenseRows, valueRows] = await Promise.all([
    queryDb.select({
      id: annualBudgets.id,
      name: annualBudgets.name,
      linkedAccountId: annualBudgets.linkedAccountId,
      linkedAccountName: accounts.name,
      isActive: annualBudgets.isActive,
      displayOrder: annualBudgets.displayOrder,
    }).from(annualBudgets)
      .innerJoin(accounts, and(eq(accounts.id, annualBudgets.linkedAccountId), eq(accounts.ownerId, ownerId)))
      .where(eq(annualBudgets.ownerId, ownerId))
      .orderBy(asc(annualBudgets.displayOrder), asc(annualBudgets.id)),
    queryDb.select({
      id: annualExpenses.id,
      budgetId: annualExpenses.budgetId,
      name: annualExpenses.name,
      amountMinor: annualExpenses.amountMinor,
      dueMonth: annualExpenses.dueMonth,
      dueDay: annualExpenses.dueDay,
      isActive: annualExpenses.isActive,
      createdAt: annualExpenses.createdAt,
      updatedAt: annualExpenses.updatedAt,
    }).from(annualExpenses)
      .innerJoin(annualBudgets, and(eq(annualBudgets.id, annualExpenses.budgetId), eq(annualBudgets.ownerId, ownerId)))
      .where(eq(annualExpenses.ownerId, ownerId))
      .orderBy(asc(annualExpenses.name), asc(annualExpenses.id)),
    queryDb.select({
      id: annualExpenseValues.id,
      annualExpenseId: annualExpenseValues.annualExpenseId,
      budgetId: annualExpenseValues.budgetId,
      taxYear: annualExpenseValues.taxYear,
      amountMinor: annualExpenseValues.amountMinor,
      amountOverrideMinor: annualExpenseValues.amountOverrideMinor,
      dueMonthOverride: annualExpenseValues.dueMonthOverride,
      dueDayOverride: annualExpenseValues.dueDayOverride,
      note: annualExpenseValues.note,
      fundedMinor: annualExpenseValues.fundedMinor,
    }).from(annualExpenseValues)
      .where(and(eq(annualExpenseValues.ownerId, ownerId)))
      .orderBy(asc(annualExpenseValues.taxYear), asc(annualExpenseValues.id)),
  ]);

  const valueIds = valueRows.map((row) => row.id);
  const paymentRows = valueIds.length === 0 ? [] : await queryDb.select({
    id: annualExpensePayments.id,
    annualExpenseValueId: annualExpensePayments.annualExpenseValueId,
    paymentOn: annualExpensePayments.paymentOn,
    amountMinor: annualExpensePayments.amountMinor,
    note: annualExpensePayments.note,
    createdAt: annualExpensePayments.createdAt,
    updatedAt: annualExpensePayments.updatedAt,
  }).from(annualExpensePayments)
    .where(and(eq(annualExpensePayments.ownerId, ownerId), inArray(annualExpensePayments.annualExpenseValueId, valueIds)))
    .orderBy(asc(annualExpensePayments.paymentOn), asc(annualExpensePayments.id));

  const paymentsByValue = new Map<string, AnnualBudgetPaymentView[]>();
  for (const row of paymentRows) {
    const values = paymentsByValue.get(row.annualExpenseValueId) ?? [];
    values.push(row);
    paymentsByValue.set(row.annualExpenseValueId, values);
  }
  const valuesByExpense = new Map<string, typeof valueRows>();
  for (const row of valueRows) {
    const values = valuesByExpense.get(row.annualExpenseId) ?? [];
    values.push(row);
    valuesByExpense.set(row.annualExpenseId, values);
  }

  const items = expenseRows.map((expense) => {
    const history = (valuesByExpense.get(expense.id) ?? []).map((value) => occurrenceView(value, expense, paymentsByValue.get(value.id) ?? []));
    const storedOccurrence = history.find((value) => value.taxYear === taxYear);
    const occurrence = storedOccurrence ?? occurrenceView({
      id: null,
      taxYear,
      budgetId: expense.budgetId,
      amountMinor: expense.amountMinor,
      amountOverrideMinor: null,
      dueMonthOverride: null,
      dueDayOverride: null,
      note: null,
      fundedMinor: 0,
    }, expense, []);
    return {
      id: expense.id,
      budgetId: expense.budgetId,
      name: expense.name,
      amountMinor: expense.amountMinor,
      dueMonth: expense.dueMonth,
      dueDay: expense.dueDay,
      isActive: expense.isActive,
      createdAt: expense.createdAt,
      updatedAt: expense.updatedAt,
      occurrence,
      history,
    } satisfies AnnualBudgetItemView;
  });

  return {
    taxYear,
    budgets: budgetRows.map((budget) => {
      const budgetItems = items
        .filter((item) => item.occurrence.budgetId === budget.id)
        .sort((left, right) => (left.occurrence.dueDate ?? "9999-12-31").localeCompare(right.occurrence.dueDate ?? "9999-12-31") || left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
      const activeItems = budgetItems.filter((item) => item.isActive);
      return {
        ...budget,
        itemCount: activeItems.length,
        totalPlannedMinor: activeItems.reduce((sum, item) => sum + item.occurrence.plannedAmountMinor, 0),
        totalPaidMinor: activeItems.reduce((sum, item) => sum + item.occurrence.paidMinor, 0),
        totalRemainingMinor: activeItems.reduce((sum, item) => sum + item.occurrence.remainingMinor, 0),
        items: budgetItems,
      } satisfies AnnualBudgetView;
    }),
  };
}

export function createAnnualBudgetRepository(db: Database) {
  return {
    async listByOwner(ownerId: string, taxYear = new Date().getUTCFullYear()): Promise<AnnualBudgetSummary> {
      return readSummary(db, ownerId, taxYear);
    },

    async getSummary(ownerId: string, taxYear = new Date().getUTCFullYear()): Promise<AnnualBudgetSummary> {
      return readSummary(db, ownerId, taxYear);
    },

    async listEligibleFundingAccounts(
      ownerId: string,
      options: AnnualBudgetListEligibleAccountsOptions = {},
    ): Promise<readonly AnnualBudgetAccountOption[]> {
      assertOwnerId(ownerId);
      const [accountRows, assignmentRows] = await Promise.all([
        db.select({ id: accounts.id, name: accounts.name, institutionName: institutions.name })
          .from(accounts)
          .innerJoin(institutions, and(eq(institutions.id, accounts.institutionId), eq(institutions.ownerId, ownerId)))
          .where(and(eq(accounts.ownerId, ownerId), eq(accounts.isActive, true)))
          .orderBy(asc(accounts.name), asc(accounts.id)),
        db.select({ linkedAccountId: annualBudgets.linkedAccountId })
          .from(annualBudgets)
          .where(and(
            eq(annualBudgets.ownerId, ownerId),
            eq(annualBudgets.isActive, true),
            ...(options.includeBudgetId ? [ne(annualBudgets.id, options.includeBudgetId)] : []),
          )),
      ]);
      const assignedAccountIds = new Set(assignmentRows.map((row) => row.linkedAccountId));
      return accountRows.filter((account) => !assignedAccountIds.has(account.id));
    },

    async createBudget(ownerId: string, input: AnnualBudgetCreateInput): Promise<string> {
      assertOwnerId(ownerId);
      const name = assertBudgetName(input.name);
      try {
        return await db.transaction(async (tx) => {
          const account = await ensureEligibleBudgetAccount(tx, ownerId, input.linkedAccountId);
          const displayOrder = await nextBudgetDisplayOrder(tx, ownerId);
          const [created] = await tx.insert(annualBudgets).values({
            ownerId,
            name,
            linkedAccountId: account.id,
            isActive: true,
            displayOrder,
          }).returning({ id: annualBudgets.id });
          if (!created) throw new Error("Annual budget insert returned no row.");
          await recalculateAnnualBudgetLinkedAccountProjections(tx, ownerId, [account.id]);
          await tx.insert(auditEvents).values({
            ownerId,
            actorUserId: ownerId,
            action: "created",
            entityType: "annual_budget",
            entityId: created.id,
            metadata: { operation: "create", name, linkedAccountId: account.id, displayOrder },
          });
          return created.id;
        });
      } catch (error) {
        throw mapAnnualBudgetUniqueViolation(error);
      }
    },

    async updateBudget(ownerId: string, budgetId: string, input: AnnualBudgetUpdateInput): Promise<void> {
      assertOwnerId(ownerId);
      try {
        await db.transaction(async (tx) => updateBudgetInTransaction(tx, ownerId, budgetId, input));
      } catch (error) {
        throw mapAnnualBudgetUniqueViolation(error);
      }
    },

    async moveBudget(ownerId: string, budgetId: string, direction: "up" | "down"): Promise<void> {
      assertOwnerId(ownerId);
      await db.transaction(async (tx) => {
        const budgets = await tx.select({ id: annualBudgets.id, displayOrder: annualBudgets.displayOrder })
          .from(annualBudgets)
          .where(and(eq(annualBudgets.ownerId, ownerId), eq(annualBudgets.isActive, true)))
          .orderBy(asc(annualBudgets.displayOrder), asc(annualBudgets.id));
        const index = budgets.findIndex((budget) => budget.id === budgetId);
        const neighborIndex = direction === "up" ? index - 1 : index + 1;
        if (index < 0 || neighborIndex < 0 || neighborIndex >= budgets.length) return;
        const current = budgets[index]!;
        const neighbor = budgets[neighborIndex]!;
        await tx.update(annualBudgets).set({ displayOrder: neighbor.displayOrder, updatedAt: new Date() }).where(and(eq(annualBudgets.ownerId, ownerId), eq(annualBudgets.id, current.id)));
        await tx.update(annualBudgets).set({ displayOrder: current.displayOrder, updatedAt: new Date() }).where(and(eq(annualBudgets.ownerId, ownerId), eq(annualBudgets.id, neighbor.id)));
        await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "updated", entityType: "annual_budget", entityId: current.id, metadata: { operation: "reorder", direction, neighborBudgetId: neighbor.id } });
      });
    },

    async renameBudget(ownerId: string, budgetId: string, name: string): Promise<void> {
      assertOwnerId(ownerId);
      try {
        await db.transaction(async (tx) => {
          const budget = await ownerBudgetMutationRow(tx, ownerId, budgetId, true);
          await updateBudgetInTransaction(tx, ownerId, budget.id, { name, linkedAccountId: budget.linkedAccountId });
        });
      } catch (error) {
        throw mapAnnualBudgetUniqueViolation(error);
      }
    },

    async relinkBudget(ownerId: string, budgetId: string, linkedAccountId: string): Promise<void> {
      assertOwnerId(ownerId);
      try {
        await db.transaction(async (tx) => {
          const budget = await ownerBudgetMutationRow(tx, ownerId, budgetId, true);
          await updateBudgetInTransaction(tx, ownerId, budget.id, { name: budget.name, linkedAccountId });
        });
      } catch (error) {
        throw mapAnnualBudgetUniqueViolation(error);
      }
    },

    async archiveBudget(ownerId: string, budgetId: string): Promise<void> {
      assertOwnerId(ownerId);
      await db.transaction(async (tx) => {
        const budget = await ownerBudgetMutationRow(tx, ownerId, budgetId, true);
        const [updated] = await tx.update(annualBudgets)
          .set({ isActive: false, updatedAt: new Date() })
          .where(and(eq(annualBudgets.id, budget.id), eq(annualBudgets.ownerId, ownerId), eq(annualBudgets.isActive, true)))
          .returning({ id: annualBudgets.id });
        if (!updated) throw new Error("Annual budget not found.");
        await recalculateAnnualBudgetLinkedAccountProjections(tx, ownerId, [budget.linkedAccountId]);
        await tx.insert(auditEvents).values({
          ownerId,
          actorUserId: ownerId,
          action: "updated",
          entityType: "annual_budget",
          entityId: budget.id,
          metadata: { operation: "archive", linkedAccountId: budget.linkedAccountId },
        });
      });
    },

    async restoreBudget(ownerId: string, budgetId: string, input: AnnualBudgetRestoreInput = {}): Promise<void> {
      assertOwnerId(ownerId);
      try {
        await db.transaction(async (tx) => {
          const budget = await ownerBudgetMutationRow(tx, ownerId, budgetId, false);
          if (budget.isActive) throw new Error("Annual budget is already active.");
          const linkedAccountId = input.linkedAccountId ?? budget.linkedAccountId;
          const account = await ensureEligibleBudgetAccount(tx, ownerId, linkedAccountId, budget.id);
          const [updated] = await tx.update(annualBudgets)
            .set({ isActive: true, linkedAccountId: account.id, updatedAt: new Date() })
            .where(and(eq(annualBudgets.id, budget.id), eq(annualBudgets.ownerId, ownerId), eq(annualBudgets.isActive, false)))
            .returning({ id: annualBudgets.id });
          if (!updated) throw new Error("Annual budget not found.");
          const accountsToRecalculate = budget.linkedAccountId === account.id
            ? [account.id]
            : [budget.linkedAccountId, account.id];
          await recalculateAnnualBudgetLinkedAccountProjections(tx, ownerId, accountsToRecalculate);
          await tx.insert(auditEvents).values({
            ownerId,
            actorUserId: ownerId,
            action: "updated",
            entityType: "annual_budget",
            entityId: budget.id,
            metadata: {
              operation: "restore",
              previousLinkedAccountId: budget.linkedAccountId,
              linkedAccountId: account.id,
            },
          });
        });
      } catch (error) {
        throw mapAnnualBudgetUniqueViolation(error);
      }
    },

    async createExpense(ownerId: string, input: AnnualExpenseCreateInput): Promise<string> {
      assertOwnerId(ownerId);
      assertYear(input.taxYear);
      assertTemplateInput(input);
      const budget = await ownerBudget(db, ownerId, input.budgetId);
      return db.transaction(async (tx) => {
          const [expense] = await tx.insert(annualExpenses).values({
            ownerId,
            budgetId: budget.id,
            accountId: null,
            envelopeId: null,
            name: input.name.trim(),
            amountMinor: input.amountMinor,
            fundedMinor: 0,
            dueMonth: input.dueMonth,
            dueDay: input.dueDay,
            currency: "CAD",
            isActive: input.isActive ?? true,
          }).returning({ id: annualExpenses.id });
          if (!expense) throw new Error("Annual expense insert returned no row.");
          await tx.insert(annualExpenseValues).values({
            ownerId,
            annualExpenseId: expense.id,
            budgetId: budget.id,
            taxYear: input.taxYear,
            amountMinor: input.amountMinor,
            amountOverrideMinor: null,
            dueMonthOverride: null,
            dueDayOverride: null,
            note: null,
            fundedMinor: 0,
            currency: "CAD",
          });
          await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "created", entityType: "annual_expense", entityId: expense.id, metadata: { operation: "template", budgetId: budget.id, taxYear: input.taxYear } });
          return expense.id;
      });
    },

    async updateExpense(ownerId: string, expenseId: string, input: AnnualExpenseUpdateInput): Promise<void> {
      assertOwnerId(ownerId);
      assertTemplateInput(input);
      const fromYear = input.fromYear ?? new Date().getUTCFullYear();
      assertYear(fromYear);
      await db.transaction(async (tx) => {
          const expense = await ownerExpense(tx, ownerId, expenseId);
          const amountChanged = input.amountChanged ?? (expense.amountMinor !== input.amountMinor);
          const [updated] = await tx.update(annualExpenses)
            .set({
              name: input.name.trim(),
              ...(amountChanged ? { amountMinor: input.amountMinor } : {}),
              dueMonth: input.dueMonth,
              dueDay: input.dueDay,
              isActive: input.isActive ?? expense.isActive,
              updatedAt: new Date(),
            })
            .where(and(eq(annualExpenses.id, expenseId), eq(annualExpenses.ownerId, ownerId)))
            .returning({ id: annualExpenses.id });
          if (!updated) throw new Error("Annual expense not found.");
          const futureValues = await tx.select({ id: annualExpenseValues.id })
            .from(annualExpenseValues)
            .where(and(
              eq(annualExpenseValues.ownerId, ownerId),
              eq(annualExpenseValues.annualExpenseId, expenseId),
              sqlTaxYearAtOrAfter(annualExpenseValues.taxYear, fromYear),
              isNull(annualExpenseValues.amountOverrideMinor),
              isNull(annualExpenseValues.dueMonthOverride),
              isNull(annualExpenseValues.dueDayOverride),
            ));
          if (amountChanged && futureValues.length > 0) {
            const valueIds = futureValues.map((value) => value.id);
            const rows = await tx.update(annualExpenseValues)
              .set({ amountMinor: input.amountMinor, dueMonthOverride: null, dueDayOverride: null, updatedAt: new Date() })
              .where(and(
                eq(annualExpenseValues.ownerId, ownerId),
                eq(annualExpenseValues.annualExpenseId, expenseId),
                inArray(annualExpenseValues.id, valueIds),
                isNull(annualExpenseValues.amountOverrideMinor),
                isNull(annualExpenseValues.dueMonthOverride),
                isNull(annualExpenseValues.dueDayOverride),
              ))
              .returning({ id: annualExpenseValues.id });
            if (rows.length !== valueIds.length) throw new Error("Annual expense value update did not affect every selected row.");
          }
          await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "updated", entityType: "annual_expense", entityId: expenseId, metadata: { operation: "template", fromYear } });
      });
    },

    async moveExpense(ownerId: string, expenseId: string, targetBudgetId: string, fromYear = new Date().getUTCFullYear()): Promise<void> {
      assertOwnerId(ownerId);
      assertYear(fromYear);
      await db.transaction(async (tx) => {
        const expense = await ownerExpense(tx, ownerId, expenseId);
        const target = await ownerBudget(tx, ownerId, targetBudgetId);
        if (expense.budgetId === target.id) return;
        await tx.update(annualExpenses)
          .set({ budgetId: target.id, updatedAt: new Date() })
          .where(and(eq(annualExpenses.id, expenseId), eq(annualExpenses.ownerId, ownerId)));
        const values = await tx.select({ id: annualExpenseValues.id, taxYear: annualExpenseValues.taxYear })
          .from(annualExpenseValues)
          .where(and(
            eq(annualExpenseValues.ownerId, ownerId),
            eq(annualExpenseValues.annualExpenseId, expenseId),
            sqlTaxYearAtOrAfter(annualExpenseValues.taxYear, fromYear),
          ));
        const valueIds = values.map((value) => value.id);
        if (valueIds.length > 0) {
          const paidRows = await tx.select({ annualExpenseValueId: annualExpensePayments.annualExpenseValueId })
            .from(annualExpensePayments)
            .where(and(eq(annualExpensePayments.ownerId, ownerId), inArray(annualExpensePayments.annualExpenseValueId, valueIds)));
          const paidIds = new Set(paidRows.map((row) => row.annualExpenseValueId));
          const unpaidIds = valueIds.filter((id) => !paidIds.has(id));
          if (unpaidIds.length > 0) {
            const rows = await tx.update(annualExpenseValues).set({ budgetId: target.id, updatedAt: new Date() })
              .where(and(eq(annualExpenseValues.ownerId, ownerId), inArray(annualExpenseValues.id, unpaidIds)))
              .returning({ id: annualExpenseValues.id });
            if (rows.length !== unpaidIds.length) throw new Error("Annual expense value move did not affect every selected row.");
          }
        }
        await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "updated", entityType: "annual_expense", entityId: expenseId, metadata: { operation: "move", fromBudgetId: expense.budgetId, targetBudgetId: target.id, fromYear } });
      });
    },

    async setExpenseArchived(ownerId: string, expenseId: string, archived: boolean): Promise<void> {
      assertOwnerId(ownerId);
      await db.transaction(async (tx) => {
        await ownerExpense(tx, ownerId, expenseId);
        const [updated] = await tx.update(annualExpenses)
          .set({ isActive: !archived, updatedAt: new Date() })
          .where(and(eq(annualExpenses.id, expenseId), eq(annualExpenses.ownerId, ownerId)))
          .returning({ id: annualExpenses.id });
        if (!updated) throw new Error("Annual expense not found.");
        await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "updated", entityType: "annual_expense", entityId: expenseId, metadata: { operation: archived ? "archive" : "restore" } });
      });
    },
  };
}

function sqlTaxYearAtOrAfter(column: typeof annualExpenseValues.taxYear, year: number) {
  return gte(column, year);
}

function mapAnnualBudgetUniqueViolation(error: unknown): unknown {
  if (!isUniqueViolation(error)) return error;
  const constraint = uniqueViolationConstraint(error);
  if (constraint.includes("owner_name") || constraint.includes("annual_budgets_owner_name_active_idx")) return new Error("Annual budget name is already in use.");
  if (constraint.includes("owner_account") || constraint.includes("annual_budgets_owner_account_active_idx")) return new Error("Annual budget linked account is already assigned to another active budget.");
  return new Error("Annual budget conflicts with another active budget.");
}

function uniqueViolationConstraint(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const parts: string[] = [];
  if ("constraint" in error && typeof (error as { constraint?: unknown }).constraint === "string") parts.push((error as { constraint: string }).constraint);
  if ("constraint_name" in error && typeof (error as { constraint_name?: unknown }).constraint_name === "string") parts.push((error as { constraint_name: string }).constraint_name);
  if ("detail" in error && typeof (error as { detail?: unknown }).detail === "string") parts.push((error as { detail: string }).detail);
  if ("message" in error && typeof (error as { message?: unknown }).message === "string") parts.push((error as { message: string }).message);
  if ("cause" in error) parts.push(uniqueViolationConstraint((error as { cause?: unknown }).cause));
  return parts.join(" ");
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && (error as { code?: unknown }).code === "23505") return true;
  if ("cause" in error) return isUniqueViolation((error as { cause?: unknown }).cause);
  return false;
}
