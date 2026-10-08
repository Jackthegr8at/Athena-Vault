"use server";

import { revalidatePath } from "next/cache";
import { maintenanceItemIdSchema, maintenanceItemInputSchema } from "@athena/validation";
import { createHouseholdRepository } from "@athena/database";
import { withWritableAuthenticatedDatabase } from "../../lib/server/owner-database";
import {
  formDataText,
  repositoryErrorActionState,
  validationActionState,
  type MaintenanceActionState,
} from "./action-helpers";

function successState(message: string): MaintenanceActionState {
  return { ok: true, message, fieldErrors: {} };
}

function inputFromFormData(formData: FormData) {
  return maintenanceItemInputSchema.safeParse({
    name: formDataText(formData, "name"),
    amount: formDataText(formData, "amount"),
    frequency: formDataText(formData, "frequency"),
  });
}

function repositoryInput(input: { name: string; amount: number; frequency: "weekly" | "biweekly" | "monthly" | "annual" }) {
  return { name: input.name, amountMinor: input.amount, frequency: input.frequency };
}

export async function createMaintenanceItemAction(
  _previousState: MaintenanceActionState,
  formData: FormData,
): Promise<MaintenanceActionState> {
  const parsed = inputFromFormData(formData);
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withWritableAuthenticatedDatabase((database, user) => createHouseholdRepository(database).createMaintenanceItem(user.owner.id, repositoryInput(parsed.data)), { requireTwoFactor: true });
    revalidatePath("/home");
    return successState("Annual maintenance item added.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function updateMaintenanceItemAction(
  _previousState: MaintenanceActionState,
  formData: FormData,
): Promise<MaintenanceActionState> {
  const parsedId = maintenanceItemIdSchema.safeParse(formDataText(formData, "id"));
  const parsedInput = inputFromFormData(formData);
  if (!parsedId.success || !parsedInput.success) {
    const issues = [
      ...(parsedId.success ? [] : parsedId.error.issues.map((issue) => ({ ...issue, path: ["id", ...issue.path] }))),
      ...(parsedInput.success ? [] : parsedInput.error.issues),
    ];
    return validationActionState(issues);
  }
  try {
    await withWritableAuthenticatedDatabase((database, user) => createHouseholdRepository(database).updateMaintenanceItem(user.owner.id, parsedId.data, repositoryInput(parsedInput.data)), { requireTwoFactor: true });
    revalidatePath("/home");
    return successState("Annual maintenance item updated.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function deleteMaintenanceItemAction(
  _previousState: MaintenanceActionState,
  formData: FormData,
): Promise<MaintenanceActionState> {
  const parsedId = maintenanceItemIdSchema.safeParse(formDataText(formData, "id"));
  if (!parsedId.success) return validationActionState(parsedId.error.issues.map((issue) => ({ ...issue, path: ["id", ...issue.path] })));
  try {
    await withWritableAuthenticatedDatabase((database, user) => createHouseholdRepository(database).deleteMaintenanceItem(user.owner.id, parsedId.data), { requireTwoFactor: true });
    revalidatePath("/home");
    return successState("Annual maintenance item deleted.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}
