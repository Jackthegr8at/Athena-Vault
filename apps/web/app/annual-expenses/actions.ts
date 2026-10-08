"use server";

import { revalidatePath } from "next/cache";
import {
  annualBudgetArchiveInputSchema,
  annualBudgetCreateInputSchema,
  annualBudgetRestoreInputSchema,
  annualBudgetReorderInputSchema,
  annualBudgetUpdateInputSchema,
  annualBudgetYearSchema,
  annualExpenseArchiveInputSchema,
  annualExpenseIdSchema,
  annualExpenseMoveInputSchema,
  annualExpensePaymentMutationSchema,
  annualExpenseRemainderTransferInputSchema,
  annualExpenseTemplateInputSchema,
  annualExpenseYearOverrideInputSchema,
} from "@athena/validation";
import { createAnnualBudgetMutationRepository, createAnnualBudgetRepository, toTorontoDateIso } from "@athena/database";
import { withWritableAuthenticatedDatabase } from "../../lib/server/owner-database";
import {
  emptyToNull,
  formDataBoolean,
  formDataText,
  repositoryErrorActionState,
  validationActionState,
  type AnnualExpenseActionState,
} from "./action-helpers";

function successState(message: string): AnnualExpenseActionState {
  return { ok: true, message, fieldErrors: {} };
}

async function withBudgetRepository<T>(callback: (repository: ReturnType<typeof createAnnualBudgetRepository>, ownerId: string) => Promise<T>): Promise<T> {
  return withWritableAuthenticatedDatabase((database, user) => callback(createAnnualBudgetRepository(database), user.owner.id), { requireTwoFactor: true });
}

async function withBudgetMutationRepository<T>(callback: (repository: ReturnType<typeof createAnnualBudgetMutationRepository>, ownerId: string) => Promise<T>): Promise<T> {
  return withWritableAuthenticatedDatabase((database, user) => callback(createAnnualBudgetMutationRepository(database), user.owner.id), { requireTwoFactor: true });
}

function revalidateAnnualExpenses(): void {
  revalidatePath("/annual-expenses");
  revalidatePath("/accounts");
}

function parseTemplate(formData: FormData) {
  return annualExpenseTemplateInputSchema.safeParse({
    id: emptyToNull(formDataText(formData, "id")),
    budgetId: formDataText(formData, "budgetId"),
    name: formDataText(formData, "name"),
    amount: formDataText(formData, "amount"),
    dueMonth: formDataText(formData, "dueMonth"),
    dueDay: emptyToNull(formDataText(formData, "dueDay")),
    isActive: true,
  });
}

export async function createAnnualBudgetAction(_previousState: AnnualExpenseActionState, formData: FormData): Promise<AnnualExpenseActionState> {
  const parsed = annualBudgetCreateInputSchema.safeParse({
    name: formDataText(formData, "name"),
    linkedAccountId: formDataText(formData, "linkedAccountId"),
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withBudgetRepository((repository, ownerId) => repository.createBudget(ownerId, parsed.data));
    revalidateAnnualExpenses();
    return successState("Annual budget created.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function moveAnnualBudgetAction(_previousState: AnnualExpenseActionState, formData: FormData): Promise<AnnualExpenseActionState> {
  const parsed = annualBudgetReorderInputSchema.safeParse({ id: formDataText(formData, "id"), direction: formDataText(formData, "direction") });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withBudgetRepository((repository, ownerId) => repository.moveBudget(ownerId, parsed.data.id, parsed.data.direction));
    revalidateAnnualExpenses();
    return successState("Annual budget order updated.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function updateAnnualBudgetAction(_previousState: AnnualExpenseActionState, formData: FormData): Promise<AnnualExpenseActionState> {
  const parsed = annualBudgetUpdateInputSchema.safeParse({
    id: formDataText(formData, "id"),
    name: formDataText(formData, "name"),
    linkedAccountId: formDataText(formData, "linkedAccountId"),
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withBudgetRepository((repository, ownerId) => repository.updateBudget(ownerId, parsed.data.id, {
      name: parsed.data.name,
      linkedAccountId: parsed.data.linkedAccountId,
    }));
    revalidateAnnualExpenses();
    return successState("Annual budget updated.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function archiveAnnualBudgetAction(_previousState: AnnualExpenseActionState, formData: FormData): Promise<AnnualExpenseActionState> {
  const parsed = annualBudgetArchiveInputSchema.safeParse({
    id: formDataText(formData, "id"),
    confirm: formDataBoolean(formData, "confirm"),
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withBudgetRepository((repository, ownerId) => repository.archiveBudget(ownerId, parsed.data.id));
    revalidateAnnualExpenses();
    return successState("Annual budget archived; items and history were preserved.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function restoreAnnualBudgetAction(_previousState: AnnualExpenseActionState, formData: FormData): Promise<AnnualExpenseActionState> {
  const parsed = annualBudgetRestoreInputSchema.safeParse({
    id: formDataText(formData, "id"),
    linkedAccountId: emptyToNull(formDataText(formData, "linkedAccountId")),
    confirm: formDataBoolean(formData, "confirm"),
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withBudgetRepository((repository, ownerId) => repository.restoreBudget(ownerId, parsed.data.id, { linkedAccountId: parsed.data.linkedAccountId }));
    revalidateAnnualExpenses();
    return successState("Annual budget restored.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function createAnnualExpenseAction(_previousState: AnnualExpenseActionState, formData: FormData): Promise<AnnualExpenseActionState> {
  const template = parseTemplate(formData);
  const taxYear = annualBudgetYearSchema.safeParse(formDataText(formData, "taxYear"));
  if (!template.success || !taxYear.success) {
    return validationActionState([
      ...(template.success ? [] : template.error.issues),
      ...(taxYear.success ? [] : taxYear.error.issues.map((issue) => ({ ...issue, path: ["taxYear", ...issue.path] }))),
    ]);
  }
  try {
    await withBudgetRepository((repository, ownerId) => repository.createExpense(ownerId, {
      budgetId: template.data.budgetId,
      taxYear: taxYear.data,
      name: template.data.name,
      amountMinor: template.data.amount,
      dueMonth: template.data.dueMonth,
      dueDay: template.data.dueDay ?? null,
      isActive: true,
    }));
    revalidateAnnualExpenses();
    return successState("Annual expense added.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function updateAnnualExpenseAction(_previousState: AnnualExpenseActionState, formData: FormData): Promise<AnnualExpenseActionState> {
  const id = annualExpenseIdSchema.safeParse(formDataText(formData, "id"));
  const template = parseTemplate(formData);
  const fromYear = annualBudgetYearSchema.safeParse(formDataText(formData, "fromYear") || Number(toTorontoDateIso().slice(0, 4)));
  if (!id.success || !template.success || !fromYear.success) {
    return validationActionState([
      ...(id.success ? [] : id.error.issues.map((issue) => ({ ...issue, path: ["id", ...issue.path] }))),
      ...(template.success ? [] : template.error.issues),
      ...(fromYear.success ? [] : fromYear.error.issues.map((issue) => ({ ...issue, path: ["taxYear", ...issue.path] }))),
    ]);
  }
  try {
    await withBudgetRepository((repository, ownerId) => repository.updateExpense(ownerId, id.data, {
      name: template.data.name,
      amountMinor: template.data.amount,
      ...(formData.has("amountChanged") ? { amountChanged: formDataBoolean(formData, "amountChanged") } : {}),
      dueMonth: template.data.dueMonth,
      dueDay: template.data.dueDay ?? null,
      fromYear: fromYear.data,
    }));
    revalidateAnnualExpenses();
    return successState("Annual expense updated.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function saveAnnualExpenseYearOverrideAction(_previousState: AnnualExpenseActionState, formData: FormData): Promise<AnnualExpenseActionState> {
  const parsed = annualExpenseYearOverrideInputSchema.safeParse({
    annualExpenseId: formDataText(formData, "annualExpenseId"),
    taxYear: formDataText(formData, "taxYear"),
    budgetId: emptyToNull(formDataText(formData, "budgetId")) ?? undefined,
    plannedAmount: emptyToNull(formDataText(formData, "plannedAmount")),
    dueDate: emptyToNull(formDataText(formData, "dueDate")),
    note: emptyToNull(formDataText(formData, "note")),
    scope: formDataText(formData, "scope") || "current_year",
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withBudgetMutationRepository((repository, ownerId) => repository.upsertYearOverride(ownerId, {
      annualExpenseId: parsed.data.annualExpenseId,
      taxYear: parsed.data.taxYear,
      budgetId: parsed.data.budgetId,
      plannedAmountMinor: parsed.data.plannedAmount,
      dueDate: parsed.data.dueDate,
      note: parsed.data.note,
      scope: parsed.data.scope,
    }));
    revalidateAnnualExpenses();
    return successState(parsed.data.scope === "this_and_future" ? "This year and future annual-expense defaults updated." : "Annual-expense year override saved.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function moveAnnualExpenseAction(_previousState: AnnualExpenseActionState, formData: FormData): Promise<AnnualExpenseActionState> {
  const parsed = annualExpenseMoveInputSchema.safeParse({
    annualExpenseId: formDataText(formData, "annualExpenseId"),
    targetBudgetId: formDataText(formData, "targetBudgetId"),
    confirm: formDataBoolean(formData, "confirm"),
  });
  const fromYear = annualBudgetYearSchema.safeParse(formDataText(formData, "fromYear"));
  if (!parsed.success || !fromYear.success) {
    return validationActionState([
      ...(parsed.success ? [] : parsed.error.issues),
      ...(fromYear.success ? [] : fromYear.error.issues.map((issue) => ({ ...issue, path: ["taxYear", ...issue.path] }))),
    ]);
  }
  try {
    await withBudgetRepository((repository, ownerId) => repository.moveExpense(ownerId, parsed.data.annualExpenseId, parsed.data.targetBudgetId, fromYear.data));
    revalidateAnnualExpenses();
    return successState("Annual expense moved; paid history was preserved.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function moveAnnualExpenseRemainderAction(_previousState: AnnualExpenseActionState, formData: FormData): Promise<AnnualExpenseActionState> {
  const parsed = annualExpenseRemainderTransferInputSchema.safeParse({
    annualExpenseId: formDataText(formData, "annualExpenseId"),
    taxYear: formDataText(formData, "taxYear"),
    confirm: formDataBoolean(formData, "confirm"),
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    const result = await withBudgetMutationRepository((repository, ownerId) => repository.moveRemainingToNext(ownerId, {
      annualExpenseId: parsed.data.annualExpenseId,
      taxYear: parsed.data.taxYear,
    }));
    revalidateAnnualExpenses();
    return successState(`Annual expense remainder moved to the next matching expense on ${result.targetDueDate}.`);
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function archiveAnnualExpenseAction(_previousState: AnnualExpenseActionState, formData: FormData): Promise<AnnualExpenseActionState> {
  const parsed = annualExpenseArchiveInputSchema.safeParse({
    annualExpenseId: formDataText(formData, "annualExpenseId"),
    archived: formDataBoolean(formData, "archived"),
    confirm: formDataBoolean(formData, "confirm"),
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withBudgetRepository((repository, ownerId) => repository.setExpenseArchived(ownerId, parsed.data.annualExpenseId, parsed.data.archived));
    revalidateAnnualExpenses();
    return successState(parsed.data.archived ? "Annual expense archived; history was preserved." : "Annual expense restored.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function mutateAnnualExpensePaymentAction(_previousState: AnnualExpenseActionState, formData: FormData): Promise<AnnualExpenseActionState> {
  const mode = formDataText(formData, "mode");
  const raw = mode === "delete"
    ? { mode, id: formDataText(formData, "paymentId"), confirm: formDataBoolean(formData, "confirm") }
    : {
        mode,
        confirm: formDataBoolean(formData, "confirm"),
        payment: {
          id: emptyToNull(formDataText(formData, "paymentId")),
          annualExpenseValueId: formDataText(formData, "annualExpenseValueId"),
          paymentOn: formDataText(formData, "paymentOn"),
          amount: formDataText(formData, "amount"),
          note: emptyToNull(formDataText(formData, "note")),
        },
      };
  const parsed = annualExpensePaymentMutationSchema.safeParse(raw);
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    return await withBudgetMutationRepository(async (repository, ownerId) => {
    if (parsed.data.mode === "delete") {
      await repository.deletePayment(ownerId, parsed.data.id);
    } else if (parsed.data.mode === "update") {
      await repository.updatePayment(ownerId, parsed.data.payment.id, {
        id: parsed.data.payment.id,
        annualExpenseValueId: parsed.data.payment.annualExpenseValueId,
        paymentOn: parsed.data.payment.paymentOn,
        amountMinor: parsed.data.payment.amount,
        note: parsed.data.payment.note,
      });
    } else {
      await repository.createPayment(ownerId, {
        annualExpenseValueId: parsed.data.payment.annualExpenseValueId,
        paymentOn: parsed.data.payment.paymentOn,
        amountMinor: parsed.data.payment.amount,
        note: parsed.data.payment.note,
      });
    }
    revalidateAnnualExpenses();
    return successState(parsed.data.mode === "create" ? "Payment added." : parsed.data.mode === "update" ? "Payment updated." : "Payment removed.");
    });
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}
