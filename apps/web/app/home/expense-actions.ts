"use server";

import { revalidatePath } from "next/cache";
import { createHouseholdRepository } from "@athena/database";
import { householdExpenseInputSchema, householdExpenseIdSchema } from "@athena/validation";
import { withWritableAuthenticatedDatabase } from "../../lib/server/owner-database";
import { type HouseholdExpenseActionField, type HouseholdExpenseActionState } from "./expense-state";

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function formDataText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function successState(message: string): HouseholdExpenseActionState {
  return { ok: true, message, fieldErrors: {} };
}

function validationActionState(
  issues: readonly { path: readonly (string | number)[]; message: string }[],
): HouseholdExpenseActionState {
  const fieldErrors: Partial<Record<HouseholdExpenseActionField, string>> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (field === "id" || field === "name" || field === "category" || field === "frequency" || field === "amount" || field === "accountId") {
      fieldErrors[field] ??= issue.message;
    }
  }
  return { ok: false, message: "Review the highlighted fields.", fieldErrors };
}

function safeRepositoryError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message === "A household expense with this name already exists.") return message;
  if (message === "Household expense not found.") return "That household expense was not found.";
  if (message === "Account not found.") return "Selected account was not found.";
  if (message === "Household expense insert returned no row.") return "We couldn't create the expense. Try again.";
  return "We couldn't save the household expense. Try again.";
}

function repositoryErrorActionState(error: unknown): HouseholdExpenseActionState {
  return { ok: false, message: safeRepositoryError(error), fieldErrors: {} };
}

function inputFromFormData(formData: FormData) {
  const accountId = emptyToNull(formDataText(formData, "accountId"));
  const category = emptyToNull(formDataText(formData, "category"));
  return householdExpenseInputSchema.safeParse({
    name: formDataText(formData, "name"),
    category,
    frequency: formDataText(formData, "frequency"),
    amount: formDataText(formData, "amount"),
    accountId,
  });
}

function repositoryInput(input: { name: string; category: string | null; frequency: "weekly" | "biweekly" | "monthly" | "quarterly" | "annual"; amount: number; accountId: string | null }) {
  return {
    name: input.name,
    category: input.category,
    frequency: input.frequency,
    amountMinor: input.amount,
    accountId: input.accountId,
  };
}

export async function createHouseholdExpenseAction(
  _previousState: HouseholdExpenseActionState,
  formData: FormData,
): Promise<HouseholdExpenseActionState> {
  const parsed = inputFromFormData(formData);
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withWritableAuthenticatedDatabase((database, user) => createHouseholdRepository(database).createExpense(user.owner.id, repositoryInput(parsed.data)), { requireTwoFactor: true });
    revalidatePath("/home");
    return successState("Household expense added.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function updateHouseholdExpenseAction(
  _previousState: HouseholdExpenseActionState,
  formData: FormData,
): Promise<HouseholdExpenseActionState> {
  const parsedId = householdExpenseIdSchema.safeParse(formDataText(formData, "id"));
  const parsedInput = inputFromFormData(formData);
  if (!parsedId.success || !parsedInput.success) {
    const issues = [
      ...(parsedId.success ? [] : parsedId.error.issues.map((issue) => ({ ...issue, path: ["id", ...issue.path] }))),
      ...(parsedInput.success ? [] : parsedInput.error.issues),
    ];
    return validationActionState(issues);
  }
  try {
    await withWritableAuthenticatedDatabase((database, user) => createHouseholdRepository(database).updateExpense(user.owner.id, parsedId.data, repositoryInput(parsedInput.data)), { requireTwoFactor: true });
    revalidatePath("/home");
    return successState("Household expense updated.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function archiveHouseholdExpenseAction(
  _previousState: HouseholdExpenseActionState,
  formData: FormData,
): Promise<HouseholdExpenseActionState> {
  const parsedId = householdExpenseIdSchema.safeParse(formDataText(formData, "id"));
  if (!parsedId.success) return validationActionState(parsedId.error.issues.map((issue) => ({ ...issue, path: ["id", ...issue.path] })));
  try {
    await withWritableAuthenticatedDatabase((database, user) => createHouseholdRepository(database).archiveExpense(user.owner.id, parsedId.data), { requireTwoFactor: true });
    revalidatePath("/home");
    return successState("Household expense archived.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function restoreHouseholdExpenseAction(
  _previousState: HouseholdExpenseActionState,
  formData: FormData,
): Promise<HouseholdExpenseActionState> {
  const parsedId = householdExpenseIdSchema.safeParse(formDataText(formData, "id"));
  if (!parsedId.success) return validationActionState(parsedId.error.issues.map((issue) => ({ ...issue, path: ["id", ...issue.path] })));
  try {
    await withWritableAuthenticatedDatabase((database, user) => createHouseholdRepository(database).restoreExpense(user.owner.id, parsedId.data), { requireTwoFactor: true });
    revalidatePath("/home");
    return successState("Household expense restored.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function deleteHouseholdExpenseAction(
  _previousState: HouseholdExpenseActionState,
  formData: FormData,
): Promise<HouseholdExpenseActionState> {
  const parsedId = householdExpenseIdSchema.safeParse(formDataText(formData, "id"));
  if (!parsedId.success) return validationActionState(parsedId.error.issues.map((issue) => ({ ...issue, path: ["id", ...issue.path] })));
  try {
    await withWritableAuthenticatedDatabase((database, user) => createHouseholdRepository(database).deleteExpense(user.owner.id, parsedId.data), { requireTwoFactor: true });
    revalidatePath("/home");
    return successState("Household expense deleted.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}
