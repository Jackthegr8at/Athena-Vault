"use server";

import { revalidatePath } from "next/cache";
import {
  goalAchievedInputSchema,
  goalCreateInputSchema,
  goalDeleteInputSchema,
  goalIdSchema,
  goalPlanEnabledInputSchema,
  goalPlanSaveInputSchema,
  goalProgressInputSchema,
  goalStatusInputSchema,
  goalUpdateInputSchema,
} from "@athena/validation";
import { createGoalPlanRepository, createGoalRepository, toTorontoDateIso } from "@athena/database";
import { withWritableAuthenticatedDatabase } from "../../lib/server/owner-database";
import { computeGoalPlanPreviews } from "./goal-previews";
import type { GoalPlanFrequencyPreview } from "./goal-plan-utils";
import {
  formDataBoolean,
  formDataText,
  repositoryErrorActionState,
  validationActionState,
  type GoalActionState,
} from "./action-helpers";

function successState(message: string): GoalActionState {
  return { ok: true, message, fieldErrors: {} };
}

async function withGoalRepository<T>(callback: (repository: ReturnType<typeof createGoalRepository>, ownerId: string) => Promise<T>): Promise<T> {
  return withWritableAuthenticatedDatabase((database, user) => callback(createGoalRepository(database), user.owner.id), { requireTwoFactor: true });
}

async function withGoalPlanRepository<T>(callback: (repository: ReturnType<typeof createGoalPlanRepository>, ownerId: string) => Promise<T>): Promise<T> {
  return withWritableAuthenticatedDatabase((database, user) => callback(createGoalPlanRepository(database), user.owner.id), { requireTwoFactor: true });
}

export type GoalPlanPreviewsResult =
  | { readonly ok: true; readonly previews: readonly GoalPlanFrequencyPreview[] }
  | { readonly ok: false; readonly message: string };

export async function goalPlanPreviewsAction(goalId: string): Promise<GoalPlanPreviewsResult> {
  const parsed = goalIdSchema.safeParse(goalId);
  if (!parsed.success) return { ok: false, message: "Goal ID is invalid." };
  try {
    return await withWritableAuthenticatedDatabase(async (database, user) => {
      const goal = (await createGoalRepository(database).listByOwner(user.owner.id)).find((entry) => entry.id === parsed.data);
      if (!goal) return { ok: false, message: "That goal was not found." };
      return { ok: true, previews: computeGoalPlanPreviews(goal, toTorontoDateIso()) };
    }, { requireTwoFactor: true });
  } catch (error) {
    return { ok: false, message: repositoryErrorActionState(error).message };
  }
}

function goalData(formData: FormData) {
  return {
    name: formDataText(formData, "name"),
    target: formDataText(formData, "target"),
    current: formDataText(formData, "current") || "0",
    targetDate: formDataText(formData, "targetDate"),
    priority: formDataText(formData, "priority"),
  };
}

export async function createGoalAction(_previousState: GoalActionState, formData: FormData): Promise<GoalActionState> {
  const parsed = goalCreateInputSchema.safeParse(goalData(formData));
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withGoalRepository((repository, ownerId) => repository.create(ownerId, {
      name: parsed.data.name,
      targetMinor: parsed.data.target,
      currentMinor: parsed.data.current,
      targetDate: parsed.data.targetDate,
      priority: parsed.data.priority,
    }));
  } catch (error) {
    return repositoryErrorActionState(error);
  }
  revalidatePath("/goals");
  return successState("Goal created.");
}

export async function updateGoalAction(_previousState: GoalActionState, formData: FormData): Promise<GoalActionState> {
  const parsed = goalUpdateInputSchema.safeParse({ id: formDataText(formData, "id"), ...goalData(formData) });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withGoalRepository((repository, ownerId) => repository.update(ownerId, {
      id: parsed.data.id,
      name: parsed.data.name,
      targetMinor: parsed.data.target,
      currentMinor: parsed.data.current,
      targetDate: parsed.data.targetDate,
      priority: parsed.data.priority,
    }));
  } catch (error) {
    return repositoryErrorActionState(error);
  }
  revalidatePath("/goals");
  return successState("Goal updated.");
}

export async function updateGoalProgressAction(_previousState: GoalActionState, formData: FormData): Promise<GoalActionState> {
  const parsed = goalProgressInputSchema.safeParse({
    id: formDataText(formData, "id"),
    current: formDataText(formData, "current"),
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withGoalRepository((repository, ownerId) => repository.updateProgress(ownerId, parsed.data.id, parsed.data.current));
  } catch (error) {
    return repositoryErrorActionState(error);
  }
  revalidatePath("/goals");
  return successState("Goal progress updated.");
}

export async function setGoalStatusAction(_previousState: GoalActionState, formData: FormData): Promise<GoalActionState> {
  const parsed = goalStatusInputSchema.safeParse({
    id: formDataText(formData, "id"),
    status: formDataText(formData, "status"),
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);

  let stopContributions: boolean | undefined;
  if (parsed.data.status === "achieved") {
    const achieved = goalAchievedInputSchema.safeParse({
      id: parsed.data.id,
      stopContributions: formDataText(formData, "stopContributions"),
    });
    if (!achieved.success) return validationActionState(achieved.error.issues);
    stopContributions = achieved.data.stopContributions;
  }

  try {
    await withGoalRepository((repository, ownerId) => repository.setStatus(ownerId, parsed.data.id, parsed.data.status, { stopContributions, todayIso: toTorontoDateIso() }));
  } catch (error) {
    return repositoryErrorActionState(error);
  }
  revalidatePath("/goals");
  revalidatePath("/accounts");
  revalidatePath("/cash-flow");
  const message = parsed.data.status === "achieved" ? "Goal marked as achieved." : parsed.data.status === "archived" ? "Goal archived." : "Goal restored.";
  return successState(message);
}

export async function deleteGoalAction(_previousState: GoalActionState, formData: FormData): Promise<GoalActionState> {
  const parsed = goalDeleteInputSchema.safeParse({
    id: formDataText(formData, "id"),
    confirm: formDataBoolean(formData, "confirm"),
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withGoalRepository((repository, ownerId) => repository.delete(ownerId, parsed.data.id, toTorontoDateIso()));
  } catch (error) {
    return repositoryErrorActionState(error);
  }
  revalidatePath("/goals");
  revalidatePath("/accounts");
  revalidatePath("/cash-flow");
  return successState("Goal deleted.");
}

export async function restoreGoalAction(_previousState: GoalActionState, formData: FormData): Promise<GoalActionState> {
  const parsedId = goalIdSchema.safeParse(formDataText(formData, "id"));
  if (!parsedId.success) return validationActionState(parsedId.error.issues);
  try {
    const result = await withGoalRepository((repository, ownerId) => repository.restore(ownerId, parsedId.data, toTorontoDateIso()));
    revalidatePath("/goals");
    revalidatePath("/accounts");
    revalidatePath("/cash-flow");
    return successState(result.planEnabled ? "Goal restored." : "Goal restored, but the linked saving plan is still disabled.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function saveGoalPlanAction(_previousState: GoalActionState, formData: FormData): Promise<GoalActionState> {
  const parsed = goalPlanSaveInputSchema.safeParse({
    goalId: formDataText(formData, "goalId"),
    accountId: formDataText(formData, "accountId"),
    sourceAccountId: formDataText(formData, "sourceAccountId"),
    amount: formDataText(formData, "amount"),
    frequency: formDataText(formData, "frequency"),
    startsOn: formDataText(formData, "startsOn"),
    countsAsExpense: formDataText(formData, "countsAsExpense"),
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withGoalPlanRepository((repository, ownerId) => repository.savePlan(ownerId, {
      goalId: parsed.data.goalId,
      accountId: parsed.data.accountId,
      sourceAccountId: parsed.data.sourceAccountId,
      amountMinor: parsed.data.amount,
      frequency: parsed.data.frequency,
      startsOn: parsed.data.startsOn,
      countsAsExpense: parsed.data.countsAsExpense,
    }, toTorontoDateIso()));
  } catch (error) {
    return repositoryErrorActionState(error);
  }
  revalidatePath("/goals");
  revalidatePath("/accounts");
  revalidatePath("/cash-flow");
  return successState("Goal saving plan saved.");
}

export async function disableGoalPlanAction(_previousState: GoalActionState, formData: FormData): Promise<GoalActionState> {
  const parsed = goalPlanEnabledInputSchema.safeParse({
    goalId: formDataText(formData, "goalId"),
    enabled: formDataText(formData, "enabled"),
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withGoalPlanRepository((repository, ownerId) => repository.setEnabled(ownerId, parsed.data.goalId, parsed.data.enabled, toTorontoDateIso()));
  } catch (error) {
    return repositoryErrorActionState(error);
  }
  revalidatePath("/goals");
  revalidatePath("/accounts");
  revalidatePath("/cash-flow");
  return successState(parsed.data.enabled ? "Goal saving plan enabled." : "Goal saving plan disabled.");
}
