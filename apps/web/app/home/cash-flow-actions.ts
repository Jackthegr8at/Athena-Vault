"use server";

import { revalidatePath } from "next/cache";
import {
  homeHouseholdCashFlowAmountSyncInputSchema,
  homeHouseholdCashFlowCreateInputSchema,
} from "@athena/validation";
import { createCashFlowRepository, type HomeHouseholdFrequency } from "@athena/database";
import { withWritableAuthenticatedDatabase } from "../../lib/server/owner-database";
import { initialHouseholdExpenseActionState, type HouseholdExpenseActionState } from "./expense-state";

function successState(message: string): HouseholdExpenseActionState {
  return { ...initialHouseholdExpenseActionState, ok: true, message };
}

function errorState(message: string): HouseholdExpenseActionState {
  return { ...initialHouseholdExpenseActionState, ok: false, message };
}

function formDataText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function formDataCheckbox(formData: FormData, name: string): boolean {
  const value = formData.get(name);
  return value === "true" || value === "on" || value === "1";
}

function revalidateHomeAndCashFlow(): void {
  revalidatePath("/home");
  revalidatePath("/cash-flow");
  revalidatePath("/cash-flow/recurring");
}

export async function createHomeHouseholdCashFlowSeriesAction(
  _previousState: HouseholdExpenseActionState,
  formData: FormData,
): Promise<HouseholdExpenseActionState> {
  const parsed = homeHouseholdCashFlowCreateInputSchema.safeParse({
    name: formDataText(formData, "name"),
    kind: formDataText(formData, "kind"),
    accountId: emptyToNull(formDataText(formData, "accountId")),
    fromAccountId: emptyToNull(formDataText(formData, "fromAccountId")),
    toAccountId: emptyToNull(formDataText(formData, "toAccountId")),
    amount: formDataText(formData, "amount"),
    frequency: formDataText(formData, "frequency"),
    weekdayAdjustment: formDataText(formData, "weekdayAdjustment") || "none",
    startsOn: formDataText(formData, "startsOn"),
    nextOccurrenceOn: formDataText(formData, "nextOccurrenceOn"),
    endsOn: emptyToNull(formDataText(formData, "endsOn")),
    note: emptyToNull(formDataText(formData, "note")),
    countsAsExpense: formDataCheckbox(formData, "countsAsExpense"),
    homeHouseholdFrequency: formDataText(formData, "homeHouseholdFrequency"),
    confirm: formDataText(formData, "confirm") === "true",
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return errorState(first?.message ?? "Check the Cash Flow form and try again.");
  }
  try {
    await withWritableAuthenticatedDatabase((database, user) => createCashFlowRepository(database).createRecurringSeries(user.owner.id, {
      name: parsed.data.name,
      kind: parsed.data.kind,
      accountId: parsed.data.accountId,
      fromAccountId: parsed.data.fromAccountId,
      toAccountId: parsed.data.toAccountId,
      amountMinor: parsed.data.amount,
      frequency: parsed.data.frequency,
      weekdayAdjustment: parsed.data.weekdayAdjustment,
      startsOn: parsed.data.startsOn,
      nextOccurrenceOn: parsed.data.nextOccurrenceOn,
      endsOn: parsed.data.endsOn ?? null,
      note: parsed.data.note,
      countsAsExpense: parsed.data.countsAsExpense,
      homeHouseholdFrequency: parsed.data.homeHouseholdFrequency as HomeHouseholdFrequency,
    }), { requireTwoFactor: true });
    revalidateHomeAndCashFlow();
    return successState("Household total added to Cash Flow as a recurring series.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "A Cash Flow series is already linked to this Home household total.") return errorState(message);
    if (message.startsWith("A Cash Flow series is already linked to the other Home household total")) return errorState(message);
    if (message.includes("require two different") || message.includes("not active")) return errorState(message);
    return errorState("We couldn't add this household total to Cash Flow. Try again.");
  }
}

export async function syncHomeHouseholdCashFlowAmountAction(
  _previousState: HouseholdExpenseActionState,
  formData: FormData,
): Promise<HouseholdExpenseActionState> {
  const parsed = homeHouseholdCashFlowAmountSyncInputSchema.safeParse({
    homeHouseholdFrequency: formDataText(formData, "homeHouseholdFrequency"),
    amount: formDataText(formData, "amount"),
    confirm: formDataText(formData, "confirm") === "true",
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return errorState(first?.message ?? "Check the amount and try again.");
  }
  try {
    await withWritableAuthenticatedDatabase((database, user) => createCashFlowRepository(database).updateHomeHouseholdCashFlowAmount(
      user.owner.id,
      parsed.data.homeHouseholdFrequency as HomeHouseholdFrequency,
      parsed.data.amount,
    ), { requireTwoFactor: true });
    revalidateHomeAndCashFlow();
    return successState("Cash Flow recurring amount updated for current and planned future occurrences.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("No Cash Flow series") || message.startsWith("The linked") || message.startsWith("Linked")) {
      return errorState(message);
    }
    return errorState("We couldn't update the Cash Flow amount. Try again.");
  }
}
