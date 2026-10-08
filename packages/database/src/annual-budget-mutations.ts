import { moveAnnualExpenseRemainder, annualExpenseDueDate, deriveAnnualExpenseValues } from "@athena/finance-engine";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Database } from "./client";
import { recalculateAnnualBudgetLinkedAccountProjections } from "./repositories/account-timeline";
import {
  accounts,
  annualExpensePayments,
  annualExpenseValues,
  annualExpenses,
  annualBudgets,
  auditEvents,
} from "./drizzle-schema";

export type AnnualBudgetMutationScope = "current_year" | "this_and_future";

export interface AnnualExpenseYearOverrideMutationInput {
  readonly annualExpenseId: string;
  readonly taxYear: number;
  readonly budgetId?: string;
  readonly plannedAmountMinor?: number | null;
  readonly dueDate?: string | null;
  readonly note?: string | null;
  readonly scope: AnnualBudgetMutationScope;
}

export interface AnnualExpensePaymentMutationInput {
  readonly id?: string;
  readonly annualExpenseValueId: string;
  readonly paymentOn: string;
  readonly amountMinor: number;
  readonly note?: string | null;
}

export interface AnnualExpenseRemainderTransferInput {
  readonly annualExpenseId: string;
  readonly taxYear: number;
}

export interface AnnualExpenseRemainderTransferResult {
  readonly sourceAnnualExpenseId: string;
  readonly sourceAnnualExpenseValueId: string;
  readonly sourceTaxYear: number;
  readonly sourceDueDate: string;
  readonly targetAnnualExpenseId: string;
  readonly targetAnnualExpenseValueId: string;
  readonly targetTaxYear: number;
  readonly targetDueDate: string;
  readonly amountMovedMinor: number;
}

type AnnualBudgetTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

function assertOwnerId(ownerId: string): void {
  if (!ownerId.trim()) throw new RangeError("Owner ID is required.");
}

function assertYear(year: number): void {
  if (!Number.isSafeInteger(year) || year < 1900 || year > 2200) throw new RangeError("Tax year must be between 1900 and 2200.");
}

function assertSafeNonnegative(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer.`);
}

function assertPositive(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer.`);
}

function assertIsoDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError(`${label} must be a valid ISO date.`);
  const parsed = new Date(`${value}T00:00:00Z`);
  const normalized = `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}-${String(parsed.getUTCDate()).padStart(2, "0")}`;
  if (Number.isNaN(parsed.getTime()) || normalized !== value) throw new RangeError(`${label} must be a valid ISO date.`);
}

function dueParts(dueDate: string | null | undefined, taxYear: number): { readonly dueMonthOverride: number | null; readonly dueDayOverride: number | null } | null {
  if (dueDate === undefined) return null;
  if (dueDate === null) return { dueMonthOverride: null, dueDayOverride: null };
  assertIsoDate(dueDate, "Due date");
  if (Number(dueDate.slice(0, 4)) !== taxYear) throw new RangeError("Due date must be within the selected tax year.");
  return { dueMonthOverride: Number(dueDate.slice(5, 7)), dueDayOverride: Number(dueDate.slice(8, 10)) };
}

async function ownerExpense(tx: AnnualBudgetTransaction, ownerId: string, expenseId: string) {
  const [expense] = await tx.select({
    id: annualExpenses.id,
    budgetId: annualExpenses.budgetId,
    budgetIsActive: annualBudgets.isActive,
    linkedAccountId: annualBudgets.linkedAccountId,
    name: annualExpenses.name,
    amountMinor: annualExpenses.amountMinor,
    dueMonth: annualExpenses.dueMonth,
    dueDay: annualExpenses.dueDay,
    isActive: annualExpenses.isActive,
  }).from(annualExpenses)
    .innerJoin(annualBudgets, and(eq(annualBudgets.id, annualExpenses.budgetId), eq(annualBudgets.ownerId, ownerId)))
    .where(and(eq(annualExpenses.id, expenseId), eq(annualExpenses.ownerId, ownerId)))
    .limit(1);
  if (!expense) throw new Error("Annual expense not found.");
  return expense;
}

async function ownerBudget(tx: AnnualBudgetTransaction, ownerId: string, budgetId: string) {
  const [budget] = await tx.select({ id: annualBudgets.id, linkedAccountId: annualBudgets.linkedAccountId })
    .from(annualBudgets)
    .where(and(eq(annualBudgets.id, budgetId), eq(annualBudgets.ownerId, ownerId), eq(annualBudgets.isActive, true)))
    .limit(1);
  if (!budget) throw new Error("Annual budget not found.");
  const [account] = await tx.select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, budget.linkedAccountId), eq(accounts.ownerId, ownerId)))
    .limit(1);
  if (!account) throw new Error("Annual budget linked account not found.");
  return budget;
}

async function ensureOccurrence(
  tx: AnnualBudgetTransaction,
  ownerId: string,
  expense: Pick<Awaited<ReturnType<typeof ownerExpense>>, "id" | "budgetId" | "amountMinor">,
  taxYear: number,
) {
  const [existing] = await tx.select({
    id: annualExpenseValues.id,
    budgetId: annualExpenseValues.budgetId,
    amountOverrideMinor: annualExpenseValues.amountOverrideMinor,
  }).from(annualExpenseValues)
    .where(and(
      eq(annualExpenseValues.ownerId, ownerId),
      eq(annualExpenseValues.annualExpenseId, expense.id),
      eq(annualExpenseValues.taxYear, taxYear),
    ))
    .limit(1);
  if (existing) return existing;
  const [created] = await tx.insert(annualExpenseValues).values({
    ownerId,
    annualExpenseId: expense.id,
    budgetId: expense.budgetId,
    taxYear,
    amountMinor: expense.amountMinor,
    amountOverrideMinor: null,
    dueMonthOverride: null,
    dueDayOverride: null,
    note: null,
    fundedMinor: 0,
    currency: "CAD",
  }).onConflictDoNothing().returning({
    id: annualExpenseValues.id,
    budgetId: annualExpenseValues.budgetId,
    amountOverrideMinor: annualExpenseValues.amountOverrideMinor,
  });
  if (created) return created;
  const [concurrent] = await tx.select({
    id: annualExpenseValues.id,
    budgetId: annualExpenseValues.budgetId,
    amountOverrideMinor: annualExpenseValues.amountOverrideMinor,
  }).from(annualExpenseValues)
    .where(and(
      eq(annualExpenseValues.ownerId, ownerId),
      eq(annualExpenseValues.annualExpenseId, expense.id),
      eq(annualExpenseValues.taxYear, taxYear),
    ))
    .limit(1);
  if (!concurrent) throw new Error("Annual expense occurrence insert returned no row.");
  return concurrent;
}

async function paymentValueIds(tx: AnnualBudgetTransaction, ownerId: string, valueIds: readonly string[]): Promise<Set<string>> {
  if (valueIds.length === 0) return new Set();
  const rows = await tx.select({ annualExpenseValueId: annualExpensePayments.annualExpenseValueId })
    .from(annualExpensePayments)
    .where(and(eq(annualExpensePayments.ownerId, ownerId), inArray(annualExpensePayments.annualExpenseValueId, [...valueIds])));
  return new Set(rows.map((row) => row.annualExpenseValueId));
}

interface AnnualExpenseRemainderTemplateRow {
  readonly id: string;
  readonly budgetId: string;
  readonly name: string;
  readonly amountMinor: number;
  readonly dueMonth: number | null;
  readonly dueDay: number | null;
}

interface AnnualExpenseRemainderValueRow {
  readonly id: string;
  readonly annualExpenseId: string;
  readonly budgetId: string;
  readonly taxYear: number;
  readonly amountMinor: number;
  readonly amountOverrideMinor: number | null;
  readonly dueMonthOverride: number | null;
  readonly dueDayOverride: number | null;
}

interface AnnualExpenseRemainderCandidate {
  readonly annualExpenseId: string;
  readonly valueId: string | null;
  readonly taxYear: number;
  readonly dueDate: string;
  readonly plannedAmountMinor: number;
}

function occurrenceDueDate(
  taxYear: number,
  template: Pick<AnnualExpenseRemainderTemplateRow, "dueMonth" | "dueDay">,
  value?: Pick<AnnualExpenseRemainderValueRow, "dueMonthOverride" | "dueDayOverride">,
): string | null {
  const dueMonth = value?.dueMonthOverride ?? template.dueMonth;
  if (dueMonth === null) return null;
  return annualExpenseDueDate(taxYear, dueMonth, value?.dueDayOverride ?? template.dueDay);
}

function plannedAmount(
  template: Pick<AnnualExpenseRemainderTemplateRow, "amountMinor">,
  value?: Pick<AnnualExpenseRemainderValueRow, "amountMinor" | "amountOverrideMinor">,
): number {
  return value?.amountOverrideMinor ?? value?.amountMinor ?? template.amountMinor;
}

function nextRemainderCandidate(
  templates: readonly AnnualExpenseRemainderTemplateRow[],
  values: readonly AnnualExpenseRemainderValueRow[],
  sourceExpenseId: string,
  sourceTaxYear: number,
  sourceDueDate: string,
): AnnualExpenseRemainderCandidate | null {
  const candidates: AnnualExpenseRemainderCandidate[] = [];
  for (const template of templates) {
    if (template.id === sourceExpenseId) continue;
    const templateValues = values.filter((value) => value.annualExpenseId === template.id && value.budgetId === template.budgetId);
    const valueByYear = new Map(templateValues.map((value) => [value.taxYear, value]));
    for (const value of templateValues) {
      const dueDate = occurrenceDueDate(value.taxYear, template, value);
      if (dueDate) candidates.push({ annualExpenseId: template.id, valueId: value.id, taxYear: value.taxYear, dueDate, plannedAmountMinor: plannedAmount(template, value) });
    }
    const firstStoredYear = templateValues.reduce((first, value) => Math.min(first, value.taxYear), 2201);
    for (const taxYear of [sourceTaxYear, sourceTaxYear + 1]) {
      if (taxYear > 2200 || taxYear < firstStoredYear || valueByYear.has(taxYear)) continue;
      const dueDate = occurrenceDueDate(taxYear, template);
      if (dueDate) candidates.push({ annualExpenseId: template.id, valueId: null, taxYear, dueDate, plannedAmountMinor: plannedAmount(template) });
    }
  }
  return candidates
    .filter((candidate) => candidate.dueDate > sourceDueDate)
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate)
      || left.annualExpenseId.localeCompare(right.annualExpenseId)
      || left.taxYear - right.taxYear
      || (left.valueId ?? "").localeCompare(right.valueId ?? ""))[0] ?? null;
}

async function lockRemainderTemplates(tx: AnnualBudgetTransaction, ownerId: string, budgetId: string, name: string): Promise<void> {
  await tx.execute(sql`
    select id
    from public.annual_expenses
    where owner_id = ${ownerId}
      and budget_id = ${budgetId}
      and name = ${name}
      and is_active = true
    order by id
    for update;
  `);
}

async function lockRemainderValues(tx: AnnualBudgetTransaction, ownerId: string, budgetId: string, name: string): Promise<void> {
  await tx.execute(sql`
    select value_row.id
    from public.annual_expense_values as value_row
    inner join public.annual_expenses as expense_row
      on expense_row.id = value_row.annual_expense_id
     and expense_row.owner_id = value_row.owner_id
    where value_row.owner_id = ${ownerId}
      and value_row.budget_id = ${budgetId}
      and expense_row.budget_id = ${budgetId}
      and expense_row.name = ${name}
      and expense_row.is_active = true
    order by value_row.id
    for update of value_row;
  `);
}

async function lockRemainderValue(tx: AnnualBudgetTransaction, ownerId: string, valueId: string): Promise<void> {
  await tx.execute(sql`
    select id
    from public.annual_expense_values
    where owner_id = ${ownerId}
      and id = ${valueId}
    for update;
  `);
}

async function lockOccurrencePayments(tx: AnnualBudgetTransaction, ownerId: string, valueId: string): Promise<void> {
  await tx.execute(sql`
    select id
    from public.annual_expense_payments
    where owner_id = ${ownerId}
      and annual_expense_value_id = ${valueId}
    order by id
    for update;
  `);
}

export function createAnnualBudgetMutationRepository(db: Database) {
  return {
    async upsertYearOverride(ownerId: string, input: AnnualExpenseYearOverrideMutationInput): Promise<string> {
      assertOwnerId(ownerId);
      assertYear(input.taxYear);
      if (input.plannedAmountMinor !== undefined && input.plannedAmountMinor !== null) assertSafeNonnegative(input.plannedAmountMinor, "Planned amount");
      if (input.scope !== "current_year" && input.scope !== "this_and_future") throw new RangeError("Unsupported annual budget mutation scope.");
      const dateParts = dueParts(input.dueDate, input.taxYear);
      return db.transaction(async (tx) => {
        const expense = await ownerExpense(tx, ownerId, input.annualExpenseId);
        const targetBudget = input.budgetId ? await ownerBudget(tx, ownerId, input.budgetId) : null;
        const occurrence = await ensureOccurrence(tx, ownerId, expense, input.taxYear);
        const selectedBudgetId = targetBudget?.id ?? occurrence.budgetId;
        const selectedSet: {
          budgetId: string;
          amountOverrideMinor: number | null;
          dueMonthOverride?: number | null;
          dueDayOverride?: number | null;
          note?: string | null;
          updatedAt: Date;
        } = {
          budgetId: selectedBudgetId,
          amountOverrideMinor: input.plannedAmountMinor === undefined ? occurrence.amountOverrideMinor : input.plannedAmountMinor,
          updatedAt: new Date(),
        };
        if (dateParts) {
          selectedSet.dueMonthOverride = dateParts.dueMonthOverride;
          selectedSet.dueDayOverride = dateParts.dueDayOverride;
        }
        if (input.note !== undefined) selectedSet.note = input.note?.trim() || null;
        const [selected] = await tx.update(annualExpenseValues)
          .set(selectedSet)
          .where(and(eq(annualExpenseValues.id, occurrence.id), eq(annualExpenseValues.ownerId, ownerId)))
          .returning({ id: annualExpenseValues.id });
        if (!selected) throw new Error("Annual expense occurrence not found.");

        if (input.scope === "this_and_future") {
          const templateSet: {
            budgetId?: string;
            amountMinor?: number;
            dueMonth?: number | null;
            dueDay?: number | null;
            updatedAt: Date;
          } = { updatedAt: new Date() };
          if (targetBudget) templateSet.budgetId = targetBudget.id;
          if (input.plannedAmountMinor !== undefined && input.plannedAmountMinor !== null) templateSet.amountMinor = input.plannedAmountMinor;
          if (dateParts) {
            templateSet.dueMonth = dateParts.dueMonthOverride;
            templateSet.dueDay = dateParts.dueDayOverride;
          }
          if (Object.keys(templateSet).length > 1) {
            await tx.update(annualExpenses)
              .set(templateSet)
              .where(and(eq(annualExpenses.id, expense.id), eq(annualExpenses.ownerId, ownerId)));
          }
          const futureValues = await tx.select({
            id: annualExpenseValues.id,
            budgetId: annualExpenseValues.budgetId,
            amountOverrideMinor: annualExpenseValues.amountOverrideMinor,
            dueMonthOverride: annualExpenseValues.dueMonthOverride,
            dueDayOverride: annualExpenseValues.dueDayOverride,
          }).from(annualExpenseValues)
            .where(and(
              eq(annualExpenseValues.ownerId, ownerId),
              eq(annualExpenseValues.annualExpenseId, expense.id),
              gte(annualExpenseValues.taxYear, input.taxYear + 1),
            ))
            .orderBy(asc(annualExpenseValues.taxYear), asc(annualExpenseValues.id));
          const futurePaidIds = await paymentValueIds(tx, ownerId, futureValues.map((future) => future.id));
          for (const future of futureValues) {
            if (futurePaidIds.has(future.id)) continue;
            const futureSet: { budgetId?: string; amountMinor?: number; updatedAt: Date } = { updatedAt: new Date() };
            if (targetBudget) futureSet.budgetId = targetBudget.id;
            if (input.plannedAmountMinor !== undefined && input.plannedAmountMinor !== null && future.amountOverrideMinor === null) futureSet.amountMinor = input.plannedAmountMinor;
            if (Object.keys(futureSet).length > 1) {
              await tx.update(annualExpenseValues).set(futureSet)
                .where(and(eq(annualExpenseValues.id, future.id), eq(annualExpenseValues.ownerId, ownerId)));
            }
          }
        }
        await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "updated", entityType: "annual_expense_value", entityId: selected.id, metadata: { operation: "override", taxYear: input.taxYear, scope: input.scope, budgetId: selectedBudgetId } });
        return selected.id;
      });
    },

    async moveRemainingToNext(ownerId: string, input: AnnualExpenseRemainderTransferInput): Promise<AnnualExpenseRemainderTransferResult> {
      assertOwnerId(ownerId);
      assertYear(input.taxYear);
      return db.transaction(async (tx) => {
        const sourceExpenseHint = await ownerExpense(tx, ownerId, input.annualExpenseId);
        await lockRemainderTemplates(tx, ownerId, sourceExpenseHint.budgetId, sourceExpenseHint.name);
        await lockRemainderValues(tx, ownerId, sourceExpenseHint.budgetId, sourceExpenseHint.name);
        const sourceExpense = await ownerExpense(tx, ownerId, input.annualExpenseId);
        if (sourceExpense.budgetId !== sourceExpenseHint.budgetId || sourceExpense.name !== sourceExpenseHint.name) {
          throw new Error("Annual expense changed while preparing remainder transfer.");
        }
        if (!sourceExpense.isActive) throw new Error("Annual expense is archived.");
        if (!sourceExpense.budgetIsActive) throw new Error("Annual expense budget is archived.");

        const sourceOccurrence = await ensureOccurrence(tx, ownerId, sourceExpense, input.taxYear);
        if (sourceOccurrence.budgetId !== sourceExpense.budgetId) throw new Error("Annual expense occurrence belongs to another budget.");
        await lockOccurrencePayments(tx, ownerId, sourceOccurrence.id);

        const [lockedSourceValue] = await tx.select({
          id: annualExpenseValues.id,
          annualExpenseId: annualExpenseValues.annualExpenseId,
          budgetId: annualExpenseValues.budgetId,
          taxYear: annualExpenseValues.taxYear,
          amountMinor: annualExpenseValues.amountMinor,
          amountOverrideMinor: annualExpenseValues.amountOverrideMinor,
          dueMonthOverride: annualExpenseValues.dueMonthOverride,
          dueDayOverride: annualExpenseValues.dueDayOverride,
        }).from(annualExpenseValues)
          .where(and(eq(annualExpenseValues.id, sourceOccurrence.id), eq(annualExpenseValues.ownerId, ownerId)))
          .limit(1);
        if (!lockedSourceValue) throw new Error("Annual expense occurrence not found.");

        const sourceDueDate = occurrenceDueDate(input.taxYear, sourceExpense, lockedSourceValue);
        if (!sourceDueDate) throw new Error("Annual expense due date is required before moving its remainder.");
        const sourcePlannedAmountMinor = plannedAmount(sourceExpense, lockedSourceValue);
        const sourcePayments = await tx.select({ amountMinor: annualExpensePayments.amountMinor })
          .from(annualExpensePayments)
          .where(and(eq(annualExpensePayments.ownerId, ownerId), eq(annualExpensePayments.annualExpenseValueId, lockedSourceValue.id)))
          .orderBy(asc(annualExpensePayments.id));
        const sourceDerived = deriveAnnualExpenseValues(sourcePlannedAmountMinor, sourcePayments);

        const templateRows = await tx.select({
          id: annualExpenses.id,
          budgetId: annualExpenses.budgetId,
          name: annualExpenses.name,
          amountMinor: annualExpenses.amountMinor,
          dueMonth: annualExpenses.dueMonth,
          dueDay: annualExpenses.dueDay,
        }).from(annualExpenses)
          .where(and(
            eq(annualExpenses.ownerId, ownerId),
            eq(annualExpenses.budgetId, sourceExpense.budgetId),
            eq(annualExpenses.name, sourceExpense.name),
            eq(annualExpenses.isActive, true),
          ))
          .orderBy(asc(annualExpenses.id));
        const templateIds = templateRows.map((template) => template.id);
        const valueRows: AnnualExpenseRemainderValueRow[] = templateIds.length === 0 ? [] : await tx.select({
          id: annualExpenseValues.id,
          annualExpenseId: annualExpenseValues.annualExpenseId,
          budgetId: annualExpenseValues.budgetId,
          taxYear: annualExpenseValues.taxYear,
          amountMinor: annualExpenseValues.amountMinor,
          amountOverrideMinor: annualExpenseValues.amountOverrideMinor,
          dueMonthOverride: annualExpenseValues.dueMonthOverride,
          dueDayOverride: annualExpenseValues.dueDayOverride,
        }).from(annualExpenseValues)
          .where(and(eq(annualExpenseValues.ownerId, ownerId), inArray(annualExpenseValues.annualExpenseId, templateIds)))
          .orderBy(asc(annualExpenseValues.taxYear), asc(annualExpenseValues.id));
        const target = nextRemainderCandidate(templateRows, valueRows, sourceExpense.id, input.taxYear, sourceDueDate);
        if (!target) throw new Error("Annual expense has no later matching occurrence.");

        const targetTemplate = templateRows.find((template) => template.id === target.annualExpenseId);
        if (!targetTemplate) throw new Error("Annual expense remainder target is no longer available.");
        const targetOccurrence = await ensureOccurrence(tx, ownerId, targetTemplate, target.taxYear);
        await lockRemainderValue(tx, ownerId, targetOccurrence.id);
        const [lockedTargetValue] = await tx.select({
          id: annualExpenseValues.id,
          annualExpenseId: annualExpenseValues.annualExpenseId,
          budgetId: annualExpenseValues.budgetId,
          taxYear: annualExpenseValues.taxYear,
          amountMinor: annualExpenseValues.amountMinor,
          amountOverrideMinor: annualExpenseValues.amountOverrideMinor,
          dueMonthOverride: annualExpenseValues.dueMonthOverride,
          dueDayOverride: annualExpenseValues.dueDayOverride,
        }).from(annualExpenseValues)
          .where(and(eq(annualExpenseValues.id, targetOccurrence.id), eq(annualExpenseValues.ownerId, ownerId)))
          .limit(1);
        if (!lockedTargetValue || lockedTargetValue.budgetId !== sourceExpense.budgetId) throw new Error("Annual expense remainder target is no longer available.");
        const targetDueDate = occurrenceDueDate(target.taxYear, targetTemplate, lockedTargetValue);
        if (!targetDueDate || targetDueDate <= sourceDueDate) throw new Error("Annual expense remainder target is no longer later.");
        const targetPlannedAmountMinor = plannedAmount(targetTemplate, lockedTargetValue);
        const transfer = moveAnnualExpenseRemainder(sourcePlannedAmountMinor, sourceDerived.paidMinor, targetPlannedAmountMinor);
        const updatedAt = new Date();
        const updatedSource = await tx.update(annualExpenseValues)
          .set({ amountOverrideMinor: transfer.sourcePlannedAmountMinor, updatedAt })
          .where(and(eq(annualExpenseValues.id, lockedSourceValue.id), eq(annualExpenseValues.ownerId, ownerId)))
          .returning({ id: annualExpenseValues.id });
        if (updatedSource.length !== 1) throw new Error("Annual expense source update returned an unexpected row count.");
        const updatedTarget = await tx.update(annualExpenseValues)
          .set({ amountOverrideMinor: transfer.targetPlannedAmountMinor, updatedAt })
          .where(and(eq(annualExpenseValues.id, lockedTargetValue.id), eq(annualExpenseValues.ownerId, ownerId)))
          .returning({ id: annualExpenseValues.id });
        if (updatedTarget.length !== 1) throw new Error("Annual expense target update returned an unexpected row count.");

        await recalculateAnnualBudgetLinkedAccountProjections(tx, ownerId, [sourceExpense.linkedAccountId]);
        await tx.insert(auditEvents).values({
          ownerId,
          actorUserId: ownerId,
          action: "updated",
          entityType: "annual_expense_remainder_transfer",
          entityId: lockedSourceValue.id,
          metadata: {
            operation: "annual_expense_remainder_transfer",
            sourceAnnualExpenseId: sourceExpense.id,
            sourceAnnualExpenseValueId: lockedSourceValue.id,
            sourceTaxYear: input.taxYear,
            sourceDueDate,
            sourcePaidMinor: sourceDerived.paidMinor,
            previousSourcePlannedAmountMinor: sourcePlannedAmountMinor,
            sourcePlannedAmountMinor: transfer.sourcePlannedAmountMinor,
            targetAnnualExpenseId: target.annualExpenseId,
            targetAnnualExpenseValueId: lockedTargetValue.id,
            targetTaxYear: target.taxYear,
            targetDueDate,
            previousTargetPlannedAmountMinor: targetPlannedAmountMinor,
            targetPlannedAmountMinor: transfer.targetPlannedAmountMinor,
            amountMovedMinor: transfer.amountMovedMinor,
          },
        });
        return {
          sourceAnnualExpenseId: sourceExpense.id,
          sourceAnnualExpenseValueId: lockedSourceValue.id,
          sourceTaxYear: input.taxYear,
          sourceDueDate,
          targetAnnualExpenseId: target.annualExpenseId,
          targetAnnualExpenseValueId: lockedTargetValue.id,
          targetTaxYear: target.taxYear,
          targetDueDate,
          amountMovedMinor: transfer.amountMovedMinor,
        };
      });
    },

    async createPayment(ownerId: string, input: AnnualExpensePaymentMutationInput): Promise<string> {
      assertOwnerId(ownerId);
      assertIsoDate(input.paymentOn, "Payment date");
      assertPositive(input.amountMinor, "Payment amount");
      return db.transaction(async (tx) => {
        await ownerValue(tx, ownerId, input.annualExpenseValueId);
        const [payment] = await tx.insert(annualExpensePayments).values({
          ownerId,
          annualExpenseValueId: input.annualExpenseValueId,
          paymentOn: input.paymentOn,
          amountMinor: input.amountMinor,
          note: input.note?.trim() || null,
        }).returning({ id: annualExpensePayments.id });
        if (!payment) throw new Error("Annual expense payment insert returned no row.");
        await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "created", entityType: "annual_expense_payment", entityId: payment.id, metadata: { annualExpenseValueId: input.annualExpenseValueId, paymentOn: input.paymentOn } });
        return payment.id;
      });
    },

    async updatePayment(ownerId: string, paymentId: string, input: AnnualExpensePaymentMutationInput): Promise<void> {
      assertOwnerId(ownerId);
      assertIsoDate(input.paymentOn, "Payment date");
      assertPositive(input.amountMinor, "Payment amount");
      await db.transaction(async (tx) => {
        const [existing] = await tx.select({ id: annualExpensePayments.id })
          .from(annualExpensePayments)
          .where(and(eq(annualExpensePayments.id, paymentId), eq(annualExpensePayments.ownerId, ownerId)))
          .limit(1);
        if (!existing) throw new Error("Annual expense payment not found.");
        await ownerValue(tx, ownerId, input.annualExpenseValueId);
        const [updated] = await tx.update(annualExpensePayments).set({
          annualExpenseValueId: input.annualExpenseValueId,
          paymentOn: input.paymentOn,
          amountMinor: input.amountMinor,
          note: input.note?.trim() || null,
          updatedAt: new Date(),
        }).where(and(eq(annualExpensePayments.id, paymentId), eq(annualExpensePayments.ownerId, ownerId)))
          .returning({ id: annualExpensePayments.id });
        if (!updated) throw new Error("Annual expense payment not found.");
        await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "updated", entityType: "annual_expense_payment", entityId: paymentId, metadata: { annualExpenseValueId: input.annualExpenseValueId, paymentOn: input.paymentOn } });
      });
    },

    async deletePayment(ownerId: string, paymentId: string): Promise<void> {
      assertOwnerId(ownerId);
      await db.transaction(async (tx) => {
        const [deleted] = await tx.delete(annualExpensePayments)
          .where(and(eq(annualExpensePayments.id, paymentId), eq(annualExpensePayments.ownerId, ownerId)))
          .returning({ id: annualExpensePayments.id });
        if (!deleted) throw new Error("Annual expense payment not found.");
        await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "deleted", entityType: "annual_expense_payment", entityId: paymentId, metadata: {} });
      });
    },
  };
}

async function ownerValue(tx: AnnualBudgetTransaction, ownerId: string, valueId: string) {
  const [value] = await tx.select({ id: annualExpenseValues.id })
    .from(annualExpenseValues)
    .innerJoin(annualExpenses, and(eq(annualExpenses.id, annualExpenseValues.annualExpenseId), eq(annualExpenses.ownerId, ownerId)))
    .innerJoin(annualBudgets, and(eq(annualBudgets.id, annualExpenseValues.budgetId), eq(annualBudgets.ownerId, ownerId)))
    .where(and(eq(annualExpenseValues.id, valueId), eq(annualExpenseValues.ownerId, ownerId)))
    .limit(1);
  if (!value) throw new Error("Annual expense occurrence not found.");
  return value;
}
