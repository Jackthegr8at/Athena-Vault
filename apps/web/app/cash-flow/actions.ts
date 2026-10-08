"use server";

import { revalidatePath } from "next/cache";
import { accountBalanceNoteInputSchema, balanceSnapshotInputSchema, cashFlowAccountVisibilityInputSchema, cashFlowIncomeUpdateInputSchema, cashFlowInitialTimelineInputSchema, cashFlowTransactionCreateInputSchema, cashFlowTransactionDeleteInputSchema, cashFlowTransactionRestoreInputSchema, cashFlowTransactionUpdateInputSchema, cashFlowTransferUpdateInputSchema, deleteBalanceSnapshotInputSchema } from "@athena/validation";
import { createCashFlowRepository } from "@athena/database";
import { withWritableAuthenticatedDatabase } from "../../lib/server/owner-database";
import { formDataText, type CashFlowActionState } from "./action-helpers";

function successState(message: string): CashFlowActionState {
  return { ok: true, message };
}

async function withCashFlowRepository<T>(callback: (repository: ReturnType<typeof createCashFlowRepository>, ownerId: string) => Promise<T>): Promise<T> {
  return withWritableAuthenticatedDatabase((database, user) => callback(createCashFlowRepository(database), user.owner.id), { requireTwoFactor: true });
}

const safeObservedBalanceErrors = new Set([
  "Observed balance can only be recorded for today or an earlier payday.",
  "Observed balance date must match a Cash Flow payday.",
  "Payday checks require exactly one active account included in available cash.",
  "Payday check account must be the sole account included in available cash.",
  "No previous Cash Flow payday is available for comparison.",
  "No projected balance is available for this payday.",
  "Imported balance anchors cannot be changed from Cash Flow.",
  "No observed payday balance was found.",
  "Imported balance anchors cannot be reset from Cash Flow.",
]);

const safeInitialTimelineErrors = new Set([
  "Cash Flow already has a timeline.",
  "Add an active account before setting up Cash Flow.",
  "First payday must be a valid ISO date.",
  "Timeline end date must be a valid ISO date.",
  "Timeline end date must be on or after the first payday.",
  "Cash Flow setup needs at least one pay period.",
  "Cash Flow setup cannot create more than 260 pay periods.",
]);

function observedBalanceErrorState(error: unknown, fallback: string): CashFlowActionState {
  const message = error instanceof Error ? error.message : "";
  return { ok: false, message: safeObservedBalanceErrors.has(message) ? message : fallback };
}

export async function recordCashFlowPaydayBalanceAction(_previousState: CashFlowActionState, formData: FormData): Promise<CashFlowActionState> {
  const parsed = balanceSnapshotInputSchema.safeParse({
    accountId: formDataText(formData, "accountId"),
    asOf: formDataText(formData, "asOf"),
    balance: formDataText(formData, "balance"),
    status: "actual",
    note: formDataText(formData, "note"),
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Review the observed balance." };
  try {
    await withCashFlowRepository((repository, ownerId) => repository.recordCashFlowPaydayBalance(ownerId, {
      accountId: parsed.data.accountId,
      asOf: parsed.data.asOf,
      balanceMinor: parsed.data.balance,
      note: parsed.data.note,
    }));
    revalidatePath("/");
    revalidatePath("/cash-flow");
    revalidatePath("/accounts");
    return successState("Observed payday balance saved.");
  } catch (error) {
    return observedBalanceErrorState(error, "We couldn't save the observed payday balance.");
  }
}

export async function updateCashFlowPaydayNoteAction(_previousState: CashFlowActionState, formData: FormData): Promise<CashFlowActionState> {
  const parsed = accountBalanceNoteInputSchema.safeParse({
    accountId: formDataText(formData, "accountId"),
    asOf: formDataText(formData, "asOf"),
    note: formDataText(formData, "note"),
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Review the period note." };
  try {
    await withCashFlowRepository((repository, ownerId) => repository.updateCashFlowPaydayNote(ownerId, parsed.data));
    revalidatePath("/");
    revalidatePath("/cash-flow");
    revalidatePath("/accounts");
    return successState("Period note saved.");
  } catch (error) {
    return observedBalanceErrorState(error, "We couldn't save the period note.");
  }
}

export async function resetCashFlowPaydayBalanceAction(_previousState: CashFlowActionState, formData: FormData): Promise<CashFlowActionState> {
  const parsed = deleteBalanceSnapshotInputSchema.safeParse({
    accountId: formDataText(formData, "accountId"),
    asOf: formDataText(formData, "asOf"),
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Review the observed balance." };
  try {
    await withCashFlowRepository((repository, ownerId) => repository.resetCashFlowPaydayBalance(ownerId, parsed.data));
    revalidatePath("/");
    revalidatePath("/cash-flow");
    revalidatePath("/accounts");
    return successState("Observed payday balance reset.");
  } catch (error) {
    return observedBalanceErrorState(error, "We couldn't reset the observed payday balance.");
  }
}

export async function createCashFlowTransactionAction(_previousState: CashFlowActionState, formData: FormData): Promise<CashFlowActionState> {
  const parsed = cashFlowTransactionCreateInputSchema.safeParse({
    periodId: formDataText(formData, "periodId"),
    accountId: formDataText(formData, "accountId"),
    kind: formDataText(formData, "kind"),
    transactionDate: formDataText(formData, "transactionDate"),
    description: formDataText(formData, "description"),
    amount: formDataText(formData, "amount"),
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Review the transaction details." };
  try {
    await withCashFlowRepository((repository, ownerId) => repository.createCashFlowTransaction(ownerId, {
      periodId: parsed.data.periodId,
      accountId: parsed.data.accountId,
      kind: parsed.data.kind,
      transactionDate: parsed.data.transactionDate,
      description: parsed.data.description,
      amountMinor: parsed.data.amount,
    }));
    revalidatePath("/");
    revalidatePath("/cash-flow");
    return successState("Transaction added to this period.");
  } catch {
    return { ok: false, message: "We couldn't add this transaction." };
  }
}

export async function createInitialCashFlowTimelineAction(_previousState: CashFlowActionState, formData: FormData): Promise<CashFlowActionState> {
  const parsed = cashFlowInitialTimelineInputSchema.safeParse({
    firstPayday: formDataText(formData, "firstPayday"),
    throughDate: formDataText(formData, "throughDate"),
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Review the Cash Flow dates." };
  try {
    const result = await withCashFlowRepository((repository, ownerId) => repository.createInitialTimeline(ownerId, parsed.data));
    revalidatePath("/");
    revalidatePath("/cash-flow");
    revalidatePath("/cash-flow/recurring");
    revalidatePath("/accounts");
    return successState(`${result.periodsCreated} pay periods are ready. Add recurring income next.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return { ok: false, message: safeInitialTimelineErrors.has(message) ? message : "We couldn't set up Cash Flow." };
  }
}

export async function toggleCashFlowAccountVisibilityAction(formData: FormData): Promise<void> {
  const visibility = formDataText(formData, "isVisibleInCashFlow");
  const parsed = cashFlowAccountVisibilityInputSchema.safeParse({
    accountId: formDataText(formData, "accountId"),
    isVisibleInCashFlow: visibility === "true" ? true : visibility === "false" ? false : undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Review the account visibility setting.");
  await withCashFlowRepository((repository, ownerId) => repository.setCashFlowAccountVisibility(ownerId, parsed.data.accountId, parsed.data.isVisibleInCashFlow));
  revalidatePath("/");
  revalidatePath("/cash-flow");
}

export async function excludeCashFlowExpenseAction(_previousState: CashFlowActionState, formData: FormData): Promise<CashFlowActionState> {
  const parsed = cashFlowTransactionDeleteInputSchema.safeParse({ id: formDataText(formData, "id"), confirm: formDataText(formData, "confirm") === "true" });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Confirm the expense deletion." };
  try {
    await withCashFlowRepository((repository, ownerId) => repository.excludeExpenseTransaction(ownerId, parsed.data.id));
    revalidatePath("/");
    revalidatePath("/cash-flow");
    return successState("Expense excluded from this period.");
  } catch {
    return { ok: false, message: "We couldn't delete this expense." };
  }
}

export async function restoreCashFlowExpenseAction(_previousState: CashFlowActionState, formData: FormData): Promise<CashFlowActionState> {
  const parsed = cashFlowTransactionRestoreInputSchema.safeParse({ id: formDataText(formData, "id"), confirm: formDataText(formData, "confirm") === "true" });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Confirm the expense restoration." };
  try {
    await withCashFlowRepository((repository, ownerId) => repository.restoreExpenseTransaction(ownerId, parsed.data.id));
    revalidatePath("/");
    revalidatePath("/cash-flow");
    return successState("Expense restored to this period.");
  } catch {
    return { ok: false, message: "We couldn't restore this expense." };
  }
}

export async function updateCashFlowRecordAction(_previousState: CashFlowActionState, formData: FormData): Promise<CashFlowActionState> {
  const kind = formDataText(formData, "recordKind");
  const raw = {
    id: formDataText(formData, "id"),
    fromAccountId: formDataText(formData, "fromAccountId"),
    toAccountId: formDataText(formData, "toAccountId"),
    accountId: formDataText(formData, "accountId") || null,
    recurringTransactionId: formDataText(formData, "recurringTransactionId") || null,
    scope: formDataText(formData, "recordScope") || formDataText(formData, "scope") || "current",
    transactionDate: formDataText(formData, "recordDate"),
    transferDate: formDataText(formData, "recordDate"),
    description: formDataText(formData, "description"),
    category: formDataText(formData, "category") || null,
    amount: formDataText(formData, "amount"),
    status: formDataText(formData, "status"),
  };
  const parsedTransfer = kind === "transfer" ? cashFlowTransferUpdateInputSchema.safeParse(raw) : null;
  const parsedTransaction = kind === "transfer" ? null : cashFlowTransactionUpdateInputSchema.safeParse(raw);
  if (parsedTransfer && !parsedTransfer.success) return { ok: false, message: parsedTransfer.error.issues[0]?.message ?? "Review the record details." };
  if (parsedTransaction && !parsedTransaction.success) return { ok: false, message: parsedTransaction.error.issues[0]?.message ?? "Review the record details." };
  try {
    await withCashFlowRepository(async (repository, ownerId) => {
    if (kind === "transfer") {
      await repository.updateTransfer(ownerId, parsedTransfer!.data.id, { fromAccountId: parsedTransfer!.data.fromAccountId, toAccountId: parsedTransfer!.data.toAccountId, transferDate: parsedTransfer!.data.transferDate, description: parsedTransfer!.data.description, amountMinor: parsedTransfer!.data.amount, status: parsedTransfer!.data.status });
    } else {
      await repository.updateTransaction(ownerId, parsedTransaction!.data.id, { accountId: parsedTransaction!.data.accountId, recurringTransactionId: parsedTransaction!.data.recurringTransactionId, transactionDate: parsedTransaction!.data.transactionDate, description: parsedTransaction!.data.description, category: parsedTransaction!.data.category ?? null, amountMinor: parsedTransaction!.data.amount, status: parsedTransaction!.data.status, scope: parsedTransaction!.data.scope });
    }
    });
    revalidatePath("/");
    revalidatePath("/cash-flow");
    return successState("Cash-flow record saved.");
  } catch {
    return { ok: false, message: "We couldn't save this cash-flow record." };
  }
}

export async function updateIncomeTransactionAction(_previousState: CashFlowActionState, formData: FormData): Promise<CashFlowActionState> {
  const parsed = cashFlowIncomeUpdateInputSchema.safeParse({
    id: formDataText(formData, "id"),
    amount: formDataText(formData, "amount"),
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Review the income amount." };
  try {
    await withCashFlowRepository((repository, ownerId) => repository.updateIncomeTransaction(ownerId, parsed.data.id, parsed.data.amount));
    revalidatePath("/");
    revalidatePath("/cash-flow");
    return successState("Income amount saved.");
  } catch {
    return { ok: false, message: "We couldn't save the income amount." };
  }
}
