"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  recurringOccurrenceExceptionInputSchema,
  recurringOccurrenceRestoreInputSchema,
  recurringOverrideGroupUpdateInputSchema,
  recurringSeriesCreateInputSchema,
  recurringSeriesDeleteInputSchema,
  recurringSeriesEndInputSchema,
  recurringSeriesGenerationInputSchema,
  recurringSeriesPauseResumeInputSchema,
  recurringSeriesRenameInputSchema,
  recurringSeriesWholeEditInputSchema,
  recurringSeriesVersionChangeInputSchema,
  recurringSeriesVersionDeleteInputSchema,
  recurringSeriesVersionEditInputSchema,
  recurringTransferCountsAsExpenseInputSchema,
  cashFlowInitialIncomeInputSchema,
} from "@athena/validation";
import { adjustRecurringCashFlowWeekday, createCashFlowRepository, isRecurringCashFlowIsoDate, type RecurringWeekdayAdjustment } from "@athena/database";
import { withWritableAuthenticatedDatabase } from "../../lib/server/owner-database";
import { formDataText, type CashFlowActionState } from "./action-helpers";

function successState(message: string): CashFlowActionState {
  return { ok: true, message };
}

async function withRecurringRepository<T>(callback: (repository: ReturnType<typeof createCashFlowRepository>, ownerId: string) => Promise<T>): Promise<T> {
  return withWritableAuthenticatedDatabase((database, user) => callback(createCashFlowRepository(database), user.owner.id), { requireTwoFactor: true });
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function formDataCheckbox(formData: FormData, name: string): boolean {
  const value = formData.get(name);
  return value === "true" || value === "on" || value === "1";
}

function recurringFrequencyFromForm(kind: string, frequency: string): string {
  return frequency || (kind === "income" ? "biweekly" : "");
}

function safeRepositoryMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const allowed = [
    "Recurring Cash Flow series not found.",
    "Recurring Cash Flow series could not be deleted.",
    "Recurring Cash Flow version not found.",
    "Recurring Cash Flow version could not be deleted.",
    "Recurring Cash Flow version could not be updated.",
    "Recurring series name is invalid.",
    "Recurring series name is unchanged.",
    "Recurring Cash Flow account is not active for this owner.",
    "Cash Flow already has a timeline.",
    "Cash Flow already has recurring movement.",
    "Cash Flow end date must be a valid ISO date.",
    "Cash Flow end date must be on or after the first income.",
    "Cash Flow setup needs at least one pay period.",
    "Cash Flow setup cannot create more than 260 pay periods.",
    "Use recurring occurrence controls for generated planned records.",
    "Use the recurring series manager for This and future changes.",
    "An ended recurring series cannot be resumed or paused.",
    "Choose an occurrence that belongs to the active recurring schedule.",
    "A skipped occurrence cannot end a recurring series.",
    "The old schedule end date must be one of its scheduled occurrences.",
    "The old schedule must end before the new schedule starts.",
    "Another recurring version already exists between the old and new schedules.",
    "A recurring version already begins on that occurrence.",
    "Only consecutive planned occurrences from one version can be changed.",
    "Actual, manual, or excluded occurrences cannot be changed.",
    "Choose a scheduled occurrence range.",
    "Choose at least one occurrence override.",
    "Skipped occurrences cannot include value overrides.",
    "A selected range cannot move occurrences to different dates.",
    "Recurring override group not found.",
    "Recurring override group has no active occurrences.",
    "Recurring occurrence exception not found.",
    "Entire series edits are unavailable after occurrence overrides or version history exists; use This and future.",
    "An entire series edit cannot change income to expense or vice versa.",
    "An entire series edit cannot change the recurring series kind.",
    "Recurring transfers require two different source and destination accounts.",
    "Recurring occurrence transfer not found.",
    "Recurring occurrence transaction not found.",
    "A new recurring version must begin on a future occurrence.",
    "The current recurring version cannot be deleted; create a new version instead.",
    "A recurring series must keep at least one version.",
    "This recurring version has protected Cash Flow rows or active occurrence overrides and cannot be deleted.",
    "The current recurring version must be changed with This and future.",
    "The edited recurring version cannot change the recurring series kind.",
    "The edited recurring version overlaps an adjacent history version.",
    "A historical recurring version needs an ending occurrence before the next version.",
    "Version start date must match the selected recurring schedule.",
    "Version end date must match the selected recurring schedule.",
    "Recurring end date must match the recurring schedule.",
  ];
  return allowed.includes(message) ? message : "We couldn't save the recurring Cash Flow change.";
}

function errorState(error: unknown): CashFlowActionState {
  return { ok: false, message: safeRepositoryMessage(error) };
}

function validationState(error: { issues: readonly { message: string }[] }): CashFlowActionState {
  return { ok: false, message: error.issues[0]?.message ?? "Review the recurring Cash Flow fields." };
}

function revalidateCashFlow(): void {
  revalidatePath("/");
  revalidatePath("/cash-flow");
  revalidatePath("/cash-flow/recurring");
  revalidatePath("/accounts");
}

export async function createRecurringSeriesAction(_previousState: CashFlowActionState, formData: FormData): Promise<CashFlowActionState> {
  const kind = formDataText(formData, "kind");
  const startsOn = formDataText(formData, "startsOn");
  const weekdayAdjustment = formDataText(formData, "weekdayAdjustment") || "none";
  const nextOccurrenceOn = isRecurringCashFlowIsoDate(startsOn) && ["none", "next_weekday", "previous_weekday"].includes(weekdayAdjustment)
    ? adjustRecurringCashFlowWeekday(startsOn, weekdayAdjustment as RecurringWeekdayAdjustment)
    : startsOn;
  const parsed = recurringSeriesCreateInputSchema.safeParse({
    name: formDataText(formData, "name"),
    kind,
    accountId: emptyToNull(formDataText(formData, "accountId")),
    fromAccountId: emptyToNull(formDataText(formData, "fromAccountId")),
    toAccountId: emptyToNull(formDataText(formData, "toAccountId")),
    amount: formDataText(formData, "amount"),
    frequency: recurringFrequencyFromForm(kind, formDataText(formData, "frequency")),
    weekdayAdjustment,
    startsOn,
    nextOccurrenceOn,
    endsOn: emptyToNull(formDataText(formData, "endsOn")),
    note: emptyToNull(formDataText(formData, "note")),
    countsAsExpense: formDataCheckbox(formData, "countsAsExpense"),
  });
  if (!parsed.success) return validationState(parsed.error);
  try {
    await withRecurringRepository((repository, ownerId) => repository.createRecurringSeries(ownerId, {
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
    }));
    revalidateCashFlow();
    return successState("Recurring Cash Flow series added.");
  } catch (error) {
    return errorState(error);
  }
}

export async function createInitialCashFlowIncomeAction(_previousState: CashFlowActionState, formData: FormData): Promise<CashFlowActionState> {
  const parsed = cashFlowInitialIncomeInputSchema.safeParse({
    name: formDataText(formData, "name"),
    accountId: formDataText(formData, "accountId"),
    amount: formDataText(formData, "amount"),
    frequency: formDataText(formData, "frequency") || undefined,
    startsOn: formDataText(formData, "startsOn"),
    throughDate: formDataText(formData, "throughDate"),
    note: emptyToNull(formDataText(formData, "note")),
  });
  if (!parsed.success) return validationState(parsed.error);
  try {
    await withRecurringRepository((repository, ownerId) => repository.createInitialCashFlowIncome(ownerId, {
      accountId: parsed.data.accountId,
      name: parsed.data.name,
      amountMinor: parsed.data.amount,
      frequency: parsed.data.frequency,
      startsOn: parsed.data.startsOn,
      throughDate: parsed.data.throughDate,
      note: parsed.data.note,
    }));
    revalidateCashFlow();
  } catch (error) {
    return errorState(error);
  }
  redirect("/cash-flow");
}

export async function changeRecurringSeriesVersionAction(_previousState: CashFlowActionState, formData: FormData): Promise<CashFlowActionState> {
  const newScheduleStartsOn = formDataText(formData, "newScheduleStartsOn");
  const weekdayAdjustment = formDataText(formData, "weekdayAdjustment") || "none";
  const nextOccurrenceOn = isRecurringCashFlowIsoDate(newScheduleStartsOn)
    && ["none", "next_weekday", "previous_weekday"].includes(weekdayAdjustment)
    ? adjustRecurringCashFlowWeekday(newScheduleStartsOn, weekdayAdjustment as RecurringWeekdayAdjustment)
    : newScheduleStartsOn;
  const parsed = recurringSeriesVersionChangeInputSchema.safeParse({
    seriesId: formDataText(formData, "seriesId"),
    name: formDataText(formData, "name"),
    kind: formDataText(formData, "kind"),
    accountId: emptyToNull(formDataText(formData, "accountId")),
    fromAccountId: emptyToNull(formDataText(formData, "fromAccountId")),
    toAccountId: emptyToNull(formDataText(formData, "toAccountId")),
    amount: formDataText(formData, "amount"),
    frequency: formDataText(formData, "frequency"),
    weekdayAdjustment,
    startsOn: newScheduleStartsOn,
    nextOccurrenceOn,
    endsOn: emptyToNull(formDataText(formData, "endsOn")),
    note: emptyToNull(formDataText(formData, "note")),
    previousEndsOn: formDataText(formData, "previousEndsOn"),
    effectiveFrom: nextOccurrenceOn,
    versionNote: emptyToNull(formDataText(formData, "versionNote")),
    countsAsExpense: formDataCheckbox(formData, "countsAsExpense"),
  });
  if (!parsed.success) return validationState(parsed.error);
  try {
    await withRecurringRepository((repository, ownerId) => repository.changeRecurringSeriesVersion(ownerId, {
      seriesId: parsed.data.seriesId,
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
      previousEndsOn: parsed.data.previousEndsOn,
      effectiveFrom: parsed.data.effectiveFrom,
      versionNote: parsed.data.versionNote,
      countsAsExpense: parsed.data.countsAsExpense,
    }));
    revalidateCashFlow();
    return successState("This and future recurring terms saved as a new version.");
  } catch (error) {
    return errorState(error);
  }
}

export async function editRecurringSeriesVersionAction(_previousState: CashFlowActionState, formData: FormData): Promise<CashFlowActionState> {
  const parsed = recurringSeriesVersionEditInputSchema.safeParse({
    seriesId: formDataText(formData, "seriesId"),
    versionId: formDataText(formData, "versionId"),
    name: formDataText(formData, "name"),
    kind: formDataText(formData, "kind"),
    accountId: emptyToNull(formDataText(formData, "accountId")),
    fromAccountId: emptyToNull(formDataText(formData, "fromAccountId")),
    toAccountId: emptyToNull(formDataText(formData, "toAccountId")),
    amount: formDataText(formData, "amount"),
    frequency: formDataText(formData, "frequency"),
    weekdayAdjustment: formDataText(formData, "weekdayAdjustment") || "none",
    startsOn: formDataText(formData, "startsOn"),
    endsOn: emptyToNull(formDataText(formData, "endsOn")),
    note: emptyToNull(formDataText(formData, "versionNote")),
    countsAsExpense: formDataCheckbox(formData, "countsAsExpense"),
    confirm: formDataText(formData, "confirm") === "true",
  });
  if (!parsed.success) return validationState(parsed.error);
  try {
    await withRecurringRepository((repository, ownerId) => repository.updateRecurringSeriesVersion(ownerId, parsed.data.seriesId, parsed.data.versionId, {
      name: parsed.data.name,
      kind: parsed.data.kind,
      accountId: parsed.data.accountId,
      fromAccountId: parsed.data.fromAccountId,
      toAccountId: parsed.data.toAccountId,
      amountMinor: parsed.data.amount,
      frequency: parsed.data.frequency,
      weekdayAdjustment: parsed.data.weekdayAdjustment,
      startsOn: parsed.data.startsOn,
      endsOn: parsed.data.endsOn ?? null,
      note: parsed.data.note,
      countsAsExpense: parsed.data.countsAsExpense,
    }));
    revalidateCashFlow();
    return successState("Recurring history version updated; protected occurrences were left unchanged.");
  } catch (error) {
    return errorState(error);
  }
}

export async function setRecurringTransferCountsAsExpenseAction(_previousState: CashFlowActionState, formData: FormData): Promise<CashFlowActionState> {
  const parsed = recurringTransferCountsAsExpenseInputSchema.safeParse({
    seriesId: formDataText(formData, "seriesId"),
    countsAsExpense: formDataCheckbox(formData, "countsAsExpense"),
    confirm: formDataText(formData, "confirm") === "true",
  });
  if (!parsed.success) return validationState(parsed.error);
  try {
    await withRecurringRepository((repository, ownerId) => repository.setRecurringTransferCountsAsExpense(ownerId, parsed.data.seriesId, parsed.data.countsAsExpense));
    revalidateCashFlow();
    return successState(parsed.data.countsAsExpense ? "Transfer now counts as spending in Cash Flow." : "Transfer no longer counts as spending in Cash Flow.");
  } catch (error) {
    return errorState(error);
  }
}

export async function renameRecurringSeriesAction(_previousState: CashFlowActionState, formData: FormData): Promise<CashFlowActionState> {
  const parsed = recurringSeriesRenameInputSchema.safeParse({
    seriesId: formDataText(formData, "seriesId"),
    name: formDataText(formData, "name"),
    confirm: formDataText(formData, "confirm") === "true",
  });
  if (!parsed.success) return validationState(parsed.error);
  try {
    await withRecurringRepository((repository, ownerId) => repository.renameRecurringSeries(ownerId, parsed.data.seriesId, parsed.data.name));
    revalidateCashFlow();
    return successState("Recurring Cash Flow series renamed.");
  } catch (error) {
    return errorState(error);
  }
}

export async function updateRecurringSeriesEntirelyAction(_previousState: CashFlowActionState, formData: FormData): Promise<CashFlowActionState> {
  const parsed = recurringSeriesWholeEditInputSchema.safeParse({
    seriesId: formDataText(formData, "seriesId"),
    name: formDataText(formData, "name"),
    kind: formDataText(formData, "kind"),
    accountId: emptyToNull(formDataText(formData, "accountId")),
    fromAccountId: emptyToNull(formDataText(formData, "fromAccountId")),
    toAccountId: emptyToNull(formDataText(formData, "toAccountId")),
    amount: formDataText(formData, "amount"),
    frequency: formDataText(formData, "frequency"),
    weekdayAdjustment: formDataText(formData, "weekdayAdjustment") || "none",
    startsOn: formDataText(formData, "startsOn"),
    endsOn: emptyToNull(formDataText(formData, "endsOn")),
    note: emptyToNull(formDataText(formData, "note")),
    countsAsExpense: formDataCheckbox(formData, "countsAsExpense"),
    confirm: formDataText(formData, "confirm") === "true",
  });
  if (!parsed.success) return validationState(parsed.error);
  try {
    await withRecurringRepository((repository, ownerId) => repository.updateRecurringSeriesEntirely(ownerId, parsed.data.seriesId, {
      name: parsed.data.name,
      kind: parsed.data.kind,
      accountId: parsed.data.accountId,
      fromAccountId: parsed.data.fromAccountId,
      toAccountId: parsed.data.toAccountId,
      amountMinor: parsed.data.amount,
      frequency: parsed.data.frequency,
      weekdayAdjustment: parsed.data.weekdayAdjustment,
      startsOn: parsed.data.startsOn,
      endsOn: parsed.data.endsOn ?? null,
      note: parsed.data.note,
      countsAsExpense: parsed.data.countsAsExpense,
    }));
    revalidateCashFlow();
    return successState("Entire series saved and projected Cash Flow rows regenerated.");
  } catch (error) {
    return errorState(error);
  }
}

export async function setRecurringSeriesStateAction(_previousState: CashFlowActionState, formData: FormData): Promise<CashFlowActionState> {
  const parsed = recurringSeriesPauseResumeInputSchema.safeParse({ seriesId: formDataText(formData, "seriesId"), state: formDataText(formData, "state"), confirm: formDataText(formData, "confirm") === "true" });
  if (!parsed.success) return validationState(parsed.error);
  try {
    await withRecurringRepository((repository, ownerId) => repository.setRecurringSeriesState(ownerId, parsed.data.seriesId, parsed.data.state));
    revalidateCashFlow();
    return successState(parsed.data.state === "paused" ? "Recurring series paused." : "Recurring series resumed.");
  } catch (error) {
    return errorState(error);
  }
}

export async function endRecurringSeriesAction(_previousState: CashFlowActionState, formData: FormData): Promise<CashFlowActionState> {
  const parsed = recurringSeriesEndInputSchema.safeParse({ seriesId: formDataText(formData, "seriesId"), endingOccurrenceOn: formDataText(formData, "endingOccurrenceOn"), confirm: formDataText(formData, "confirm") === "true" });
  if (!parsed.success) return validationState(parsed.error);
  try {
    await withRecurringRepository((repository, ownerId) => repository.endRecurringSeries(ownerId, parsed.data.seriesId, parsed.data.endingOccurrenceOn));
    revalidateCashFlow();
    return successState("Recurring series ended. Its history remains available.");
  } catch (error) {
    return errorState(error);
  }
}

export async function deleteRecurringSeriesAction(_previousState: CashFlowActionState, formData: FormData): Promise<CashFlowActionState> {
  const parsed = recurringSeriesDeleteInputSchema.safeParse({ seriesId: formDataText(formData, "seriesId"), confirm: formDataText(formData, "confirm") === "true" });
  if (!parsed.success) return validationState(parsed.error);
  try {
    const result = await withRecurringRepository((repository, ownerId) => repository.deleteRecurringSeries(ownerId, parsed.data.seriesId));
    revalidateCashFlow();
    return successState(`Recurring series deleted with ${result.transactionCount + result.transferCount} linked Cash Flow row${result.transactionCount + result.transferCount === 1 ? "" : "s"}.`);
  } catch (error) {
    return errorState(error);
  }
}

export async function deleteRecurringSeriesVersionAction(_previousState: CashFlowActionState, formData: FormData): Promise<CashFlowActionState> {
  const parsed = recurringSeriesVersionDeleteInputSchema.safeParse({
    seriesId: formDataText(formData, "seriesId"),
    versionId: formDataText(formData, "versionId"),
    confirm: formDataText(formData, "confirm") === "true",
  });
  if (!parsed.success) return validationState(parsed.error);
  try {
    const result = await withRecurringRepository((repository, ownerId) => repository.deleteRecurringSeriesVersion(ownerId, parsed.data.seriesId, parsed.data.versionId));
    revalidateCashFlow();
    const rowCount = result.transactionCount + result.transferCount;
    return successState(`Recurring version deleted with ${rowCount} linked Cash Flow row${rowCount === 1 ? "" : "s"}.`);
  } catch (error) {
    return errorState(error);
  }
}

export async function generateRecurringOccurrencesAction(_previousState: CashFlowActionState, formData: FormData): Promise<CashFlowActionState> {
  const parsed = recurringSeriesGenerationInputSchema.safeParse({ seriesId: formDataText(formData, "seriesId"), throughDate: formDataText(formData, "throughDate") });
  if (!parsed.success) return validationState(parsed.error);
  try {
    const result = await withRecurringRepository((repository, ownerId) => repository.generateRecurringOccurrences(ownerId, parsed.data.seriesId, { throughDate: parsed.data.throughDate }));
    revalidateCashFlow();
    return successState(`Regenerated ${result.insertedCount + result.updatedCount} planned occurrences; preserved ${result.preservedCount}.`);
  } catch (error) {
    return errorState(error);
  }
}

export async function applyRecurringOccurrenceExceptionAction(_previousState: CashFlowActionState, formData: FormData): Promise<CashFlowActionState> {
  const kind = formDataText(formData, "kind");
  const submittedScope = formDataText(formData, "scope");
  const rangeEnding = submittedScope.startsWith("selected_range:") ? submittedScope.slice("selected_range:".length) : emptyToNull(formDataText(formData, "endingOccurrenceOn"));
  const amountOverride = emptyToNull(formDataText(formData, "amountOverride"));
  const parsed = recurringOccurrenceExceptionInputSchema.safeParse({
    seriesId: formDataText(formData, "seriesId"),
    versionId: formDataText(formData, "versionId"),
    transactionId: emptyToNull(formDataText(formData, "transactionId")),
    transferId: emptyToNull(formDataText(formData, "transferId")),
    scheduledOccurrenceOn: formDataText(formData, "scheduledOccurrenceOn"),
    scope: submittedScope.startsWith("selected_range:") ? "selected_range" : submittedScope,
    endingOccurrenceOn: rangeEnding,
    kind,
    dateOverride: kind === "skip" ? null : emptyToNull(formDataText(formData, "dateOverride")),
    amountOverride: kind === "skip" ? null : amountOverride,
    accountOverrideId: kind === "skip" ? null : emptyToNull(formDataText(formData, "accountOverrideId")),
    fromAccountOverrideId: kind === "skip" ? null : emptyToNull(formDataText(formData, "fromAccountOverrideId")),
    toAccountOverrideId: kind === "skip" ? null : emptyToNull(formDataText(formData, "toAccountOverrideId")),
    statusOverride: kind === "skip" ? null : emptyToNull(formDataText(formData, "statusOverride")),
    note: emptyToNull(formDataText(formData, "note")),
  });
  if (!parsed.success) return validationState(parsed.error);
  try {
    const result = await withRecurringRepository((repository, ownerId) => repository.applyRecurringOccurrenceException(ownerId, {
      seriesId: parsed.data.seriesId,
      versionId: parsed.data.versionId,
      transactionId: parsed.data.transactionId ?? null,
      scheduledOccurrenceOn: parsed.data.scheduledOccurrenceOn,
      endingOccurrenceOn: parsed.data.endingOccurrenceOn ?? null,
      scope: parsed.data.scope,
      kind: parsed.data.kind,
      dateOverride: parsed.data.dateOverride ?? null,
      amountOverrideMinor: parsed.data.amountOverride ?? null,
      accountOverrideId: parsed.data.accountOverrideId ?? null,
      fromAccountOverrideId: parsed.data.fromAccountOverrideId ?? null,
      toAccountOverrideId: parsed.data.toAccountOverrideId ?? null,
      transferId: parsed.data.transferId ?? null,
      statusOverride: parsed.data.statusOverride ?? null,
      note: parsed.data.note,
    }));
    revalidateCashFlow();
    return successState(`${result.exceptionIds.length} occurrence exception${result.exceptionIds.length === 1 ? "" : "s"} saved.`);
  } catch (error) {
    return errorState(error);
  }
}

export async function updateRecurringOverrideGroupAction(_previousState: CashFlowActionState, formData: FormData): Promise<CashFlowActionState> {
  const kind = formDataText(formData, "kind");
  const parsed = recurringOverrideGroupUpdateInputSchema.safeParse({
    overrideGroupId: formDataText(formData, "overrideGroupId"),
    kind,
    dateOverride: null,
    amountOverride: kind === "skip" ? null : emptyToNull(formDataText(formData, "amountOverride")),
    accountOverrideId: kind === "skip" ? null : emptyToNull(formDataText(formData, "accountOverrideId")),
    statusOverride: kind === "skip" ? null : emptyToNull(formDataText(formData, "statusOverride")),
    note: emptyToNull(formDataText(formData, "note")),
  });
  if (!parsed.success) return validationState(parsed.error);
  try {
    const result = await withRecurringRepository((repository, ownerId) => repository.updateRecurringOverrideGroup(ownerId, parsed.data.overrideGroupId, {
      kind: parsed.data.kind,
      dateOverride: null,
      amountOverrideMinor: parsed.data.amountOverride ?? null,
      accountOverrideId: parsed.data.accountOverrideId ?? null,
      statusOverride: parsed.data.statusOverride ?? null,
      note: parsed.data.note,
    }));
    revalidateCashFlow();
    return successState(`Updated ${result.exceptionIds.length} grouped occurrences.`);
  } catch (error) {
    return errorState(error);
  }
}

export async function restoreRecurringOccurrenceAction(_previousState: CashFlowActionState, formData: FormData): Promise<CashFlowActionState> {
  const parsed = recurringOccurrenceRestoreInputSchema.safeParse({
    seriesId: formDataText(formData, "seriesId"),
    occurrenceId: emptyToNull(formDataText(formData, "occurrenceId")),
    overrideGroupId: emptyToNull(formDataText(formData, "overrideGroupId")),
    scope: formDataText(formData, "restoreScope") || formDataText(formData, "scope"),
    confirm: formDataText(formData, "confirm") === "true",
  });
  if (!parsed.success) return validationState(parsed.error);
  try {
    const result = await withRecurringRepository((repository, ownerId) => repository.restoreRecurringOccurrence(ownerId, {
      seriesId: parsed.data.seriesId,
      occurrenceId: parsed.data.occurrenceId,
      overrideGroupId: parsed.data.overrideGroupId,
      scope: parsed.data.scope,
    }));
    revalidateCashFlow();
    return successState(`Restored the occurrence; ${result.updatedCount + result.insertedCount} planned row${result.updatedCount + result.insertedCount === 1 ? "" : "s"} recalculated.`);
  } catch (error) {
    return errorState(error);
  }
}
