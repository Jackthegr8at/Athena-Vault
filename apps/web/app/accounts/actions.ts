"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAccountTimelineRepository } from "@athena/database";
import type { AccountTimelineSectionKey } from "@athena/database";
import {
  accountBalanceNoteInputSchema,
  accountCreateInputSchema,
  accountAvailabilityInputSchema,
  accountCashFlowPlannedTimelineInputSchema,
  accountIdSchema,
  accountMetadataInputSchema,
  accountContributionExceptionInputSchema,
  accountContributionRuleInputSchema,
  accountReorderInputSchema,
  accountProjectionRecalculationInputSchema,
  accountTimelineExtensionInputSchema,
  balanceSnapshotInputSchema,
  deleteBalanceSnapshotInputSchema,
  periodConfirmationInputSchema,
  snapshotStatusSchema,
} from "@athena/validation";
import { toTorontoDateIso } from "@athena/database";
import { withWritableAuthenticatedDatabase } from "../../lib/server/owner-database";
import {
  emptyToNull,
  formDataText,
  repositoryErrorActionState,
  validationActionState,
  type AccountActionState,
} from "./action-helpers";

function successState(message: string): AccountActionState {
  return { ok: true, message, fieldErrors: {} };
}

async function withAccountRepository<T>(callback: (repository: ReturnType<typeof createAccountTimelineRepository>, ownerId: string) => Promise<T>): Promise<T> {
  return withWritableAuthenticatedDatabase((database, user) => callback(createAccountTimelineRepository(database), user.owner.id), { requireTwoFactor: true });
}

function defaultStatusForDate(asOf: string): "actual" | "planned" {
  return asOf <= toTorontoDateIso() ? "actual" : "planned";
}

function metadataFromFormData(formData: FormData) {
  return accountMetadataInputSchema.safeParse({
    name: formDataText(formData, "name"),
    institutionName: formDataText(formData, "institutionName"),
    kind: formDataText(formData, "kind"),
    customTypeLabel: emptyToNull(formDataText(formData, "customTypeLabel")),
    lastFour: emptyToNull(formDataText(formData, "lastFour")),
  });
}

function actionStatus(asOf: string, value: string) {
  const parsed = snapshotStatusSchema.safeParse(value || defaultStatusForDate(asOf));
  return parsed.success ? parsed.data : value;
}

export async function createAccountAction(_previousState: AccountActionState, formData: FormData): Promise<AccountActionState> {
  const initialBalance = emptyToNull(formDataText(formData, "initialBalance"));
  // The form keeps a convenient default date even when the optional amount is blank.
  // A blank amount means no opening snapshot; an entered zero remains a real balance.
  const initialBalanceDate = initialBalance === null ? null : emptyToNull(formDataText(formData, "initialBalanceDate"));
  const parsed = accountCreateInputSchema.safeParse({
    ...metadataFromFormData(formData).data,
    name: formDataText(formData, "name"),
    institutionName: formDataText(formData, "institutionName"),
    kind: formDataText(formData, "kind"),
    customTypeLabel: emptyToNull(formDataText(formData, "customTypeLabel")),
    lastFour: emptyToNull(formDataText(formData, "lastFour")),
    initialBalance,
    initialBalanceDate,
    initialStatus: initialBalanceDate ? actionStatus(initialBalanceDate, formDataText(formData, "initialStatus")) : "planned",
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  let created: { readonly isMainAccount?: boolean };
  try {
    const initialSnapshot = typeof parsed.data.initialBalance === "number" && typeof parsed.data.initialBalanceDate === "string"
      ? { asOf: parsed.data.initialBalanceDate, balanceMinor: parsed.data.initialBalance, status: parsed.data.initialStatus }
      : undefined;
    created = await withAccountRepository((repository, ownerId) => repository.createAccount(ownerId, {
      name: parsed.data.name,
      institutionName: parsed.data.institutionName,
      kind: parsed.data.kind,
      customTypeLabel: parsed.data.customTypeLabel,
      lastFour: parsed.data.lastFour,
      initialSnapshot,
    }));
  } catch (error) {
    return repositoryErrorActionState(error);
  }
  revalidatePath("/accounts");
  if (created.isMainAccount) redirect("/cash-flow/recurring?first=1");
  return successState("Account added.");
}

export async function updateAccountAction(_previousState: AccountActionState, formData: FormData): Promise<AccountActionState> {
  const parsedId = accountIdSchema.safeParse(formDataText(formData, "id"));
  const parsed = metadataFromFormData(formData);
  if (!parsedId.success || !parsed.success) {
    const issues = [
      ...(parsedId.success ? [] : parsedId.error.issues.map((issue) => ({ ...issue, path: ["id", ...issue.path] }))),
      ...(parsed.success ? [] : parsed.error.issues),
    ];
    return validationActionState(issues);
  }
  try {
    await withAccountRepository((repository, ownerId) => repository.updateAccount(ownerId, parsedId.data, parsed.data));
    revalidatePath("/accounts");
    return successState("Account updated.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function updateAccountAvailableCashAction(_previousState: AccountActionState, formData: FormData): Promise<AccountActionState> {
  const parsed = accountAvailabilityInputSchema.safeParse({
    accountId: formDataText(formData, "accountId"),
    includeInAvailableCash: formData.has("includeInAvailableCash"),
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withAccountRepository((repository, ownerId) => repository.updateAvailableCash(ownerId, parsed.data.accountId, parsed.data.includeInAvailableCash));
    revalidatePath("/accounts");
    revalidatePath("/cash-flow");
    return successState("Available-cash setting saved.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function updateAccountCashFlowPlannedTimelineAction(_previousState: AccountActionState, formData: FormData): Promise<AccountActionState> {
  const parsed = accountCashFlowPlannedTimelineInputSchema.safeParse({
    accountId: formDataText(formData, "accountId"),
    useCashFlowPlannedTimeline: formData.has("useCashFlowPlannedTimeline"),
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withAccountRepository((repository, ownerId) => repository.updateCashFlowPlannedTimeline(ownerId, parsed.data.accountId, parsed.data.useCashFlowPlannedTimeline));
    revalidatePath("/accounts");
    revalidatePath("/cash-flow");
    return successState(parsed.data.useCashFlowPlannedTimeline
      ? "Cash Flow planned timeline enabled for this account."
      : "Cash Flow planned timeline disabled; contribution rules apply.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function archiveAccountAction(_previousState: AccountActionState, formData: FormData): Promise<AccountActionState> {
  const parsedId = accountIdSchema.safeParse(formDataText(formData, "id"));
  if (!parsedId.success) return validationActionState(parsedId.error.issues.map((issue) => ({ ...issue, path: ["id", ...issue.path] })));
  try {
    await withAccountRepository((repository, ownerId) => repository.archiveAccount(ownerId, parsedId.data));
    revalidatePath("/accounts");
    return successState("Account archived. Its history was preserved.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function restoreAccountAction(_previousState: AccountActionState, formData: FormData): Promise<AccountActionState> {
  const parsedId = accountIdSchema.safeParse(formDataText(formData, "id"));
  if (!parsedId.success) return validationActionState(parsedId.error.issues.map((issue) => ({ ...issue, path: ["id", ...issue.path] })));
  try {
    await withAccountRepository((repository, ownerId) => repository.restoreAccount(ownerId, parsedId.data));
    revalidatePath("/accounts");
    return successState("Account restored.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function deleteAccountAction(_previousState: AccountActionState, formData: FormData): Promise<AccountActionState> {
  const parsedId = accountIdSchema.safeParse(formDataText(formData, "id"));
  if (!parsedId.success) return validationActionState(parsedId.error.issues.map((issue) => ({ ...issue, path: ["id", ...issue.path] })));
  try {
    await withAccountRepository((repository, ownerId) => repository.deleteAccount(ownerId, parsedId.data));
    revalidatePath("/accounts");
    revalidatePath("/cash-flow");
    revalidatePath("/");
    return successState("Account permanently deleted.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function upsertBalanceSnapshotAction(_previousState: AccountActionState, formData: FormData): Promise<AccountActionState> {
  const asOf = formDataText(formData, "asOf");
  const parsed = balanceSnapshotInputSchema.safeParse({
    accountId: formDataText(formData, "accountId"),
    asOf,
    balance: formDataText(formData, "balance"),
    status: actionStatus(asOf, formDataText(formData, "status")),
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withAccountRepository((repository, ownerId) => repository.upsertBalanceSnapshot(ownerId, parsed.data.accountId, {
      asOf: parsed.data.asOf,
      balanceMinor: parsed.data.balance,
      status: parsed.data.status,
      note: parsed.data.note,
    }));
    revalidatePath("/accounts");
    revalidatePath("/cash-flow");
    revalidatePath("/");
    return successState("Balance saved.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function updateAccountBalanceNoteAction(_previousState: AccountActionState, formData: FormData): Promise<AccountActionState> {
  const parsed = accountBalanceNoteInputSchema.safeParse({
    accountId: formDataText(formData, "accountId"),
    asOf: formDataText(formData, "asOf"),
    note: formDataText(formData, "note"),
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withAccountRepository((repository, ownerId) => repository.updateAccountBalanceNote(ownerId, parsed.data));
    revalidatePath("/accounts");
    revalidatePath("/cash-flow");
    revalidatePath("/");
    return successState("Period note saved.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function deleteBalanceSnapshotAction(_previousState: AccountActionState, formData: FormData): Promise<AccountActionState> {
  const parsed = deleteBalanceSnapshotInputSchema.safeParse({
    accountId: formDataText(formData, "accountId"),
    asOf: formDataText(formData, "asOf"),
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withAccountRepository((repository, ownerId) => repository.deleteBalanceSnapshot(ownerId, parsed.data.accountId, parsed.data.asOf));
    revalidatePath("/accounts");
    return successState("Balance reset.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function confirmPeriodAction(_previousState: AccountActionState, formData: FormData): Promise<AccountActionState> {
  const parsed = periodConfirmationInputSchema.safeParse({ asOf: formDataText(formData, "asOf") });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    const result = await withAccountRepository((repository, ownerId) => repository.confirmPeriod(ownerId, parsed.data.asOf));
    revalidatePath("/accounts");
    return successState(result.updatedCount > 0 ? "Selected period marked as Confirmed." : "Selected period already uses Confirmed values.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function recalculateProjectionsAction(_previousState: AccountActionState, formData: FormData): Promise<AccountActionState> {
  const parsed = accountProjectionRecalculationInputSchema.safeParse({
    accountId: formDataText(formData, "accountId"),
    scope: formDataText(formData, "scope"),
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    const result = await withAccountRepository((repository, ownerId) => parsed.data.scope === "all"
      ? repository.recalculateAllAccountProjections(ownerId)
      : repository.recalculateAccountProjections(ownerId, parsed.data.accountId));
    revalidatePath("/accounts");
    const changed = result.snapshotsCreated + result.snapshotsUpdated;
    const scopeLabel = parsed.data.scope === "all" ? "all accounts" : "this account";
    return successState(changed > 0
      ? `Recalculated ${scopeLabel}: ${result.snapshotsCreated} created, ${result.snapshotsUpdated} updated.`
      : `Recalculated ${scopeLabel}; no projection snapshots needed changes.`);
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function reorderAccountsAction(_previousState: AccountActionState, formData: FormData): Promise<AccountActionState> {
  let accountIds: unknown = null;
  try {
    accountIds = JSON.parse(formDataText(formData, "accountIds"));
  } catch {
    accountIds = null;
  }
  const parsed = accountReorderInputSchema.safeParse({
    section: formDataText(formData, "section"),
    accountIds,
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withAccountRepository((repository, ownerId) => repository.reorderAccounts(ownerId, parsed.data.section as AccountTimelineSectionKey, parsed.data.accountIds));
    revalidatePath("/accounts");
    return successState("Account order saved.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

function booleanFormValue(formData: FormData, key: string): boolean {
  return formDataText(formData, key) === "on" || formDataText(formData, key) === "true";
}

function contributionRuleFromFormData(formData: FormData) {
  return accountContributionRuleInputSchema.safeParse({
    id: emptyToNull(formDataText(formData, "id")),
    accountId: formDataText(formData, "accountId"),
    amount: formDataText(formData, "amount"),
    frequency: formDataText(formData, "frequency"),
    startsOn: formDataText(formData, "startsOn"),
    endsOn: emptyToNull(formDataText(formData, "endsOn")),
    isEnabled: booleanFormValue(formData, "isEnabled"),
    recalculationScope: formDataText(formData, "recalculationScope"),
  });
}

export async function saveContributionRuleAction(_previousState: AccountActionState, formData: FormData): Promise<AccountActionState> {
  const parsed = contributionRuleFromFormData(formData);
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withAccountRepository((repository, ownerId) => repository.saveContributionRule(ownerId, {
      id: parsed.data.id ?? undefined,
      accountId: parsed.data.accountId,
      amountMinor: parsed.data.amount,
      frequency: parsed.data.frequency,
      startsOn: parsed.data.startsOn,
      endsOn: parsed.data.endsOn ?? null,
      isEnabled: parsed.data.isEnabled,
    }, parsed.data.recalculationScope));
    revalidatePath("/accounts");
    return successState(parsed.data.id ? "Recurring contribution updated." : "Recurring contribution added.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function deleteContributionRuleAction(_previousState: AccountActionState, formData: FormData): Promise<AccountActionState> {
  const parsed = accountIdSchema.safeParse(formDataText(formData, "ruleId"));
  if (!parsed.success) return validationActionState(parsed.error.issues.map((issue) => ({ ...issue, path: ["ruleId", ...issue.path] })));
  try {
    await withAccountRepository((repository, ownerId) => repository.deleteContributionRule(ownerId, parsed.data));
    revalidatePath("/accounts");
    return successState("Recurring contribution deleted.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function updateContributionExceptionsAction(_previousState: AccountActionState, formData: FormData): Promise<AccountActionState> {
  const parsed = accountContributionExceptionInputSchema.safeParse({
    ruleId: formDataText(formData, "ruleId"),
    occurrenceDates: formDataText(formData, "occurrenceDates"),
    kind: formDataText(formData, "kind"),
    amountOverride: emptyToNull(formDataText(formData, "amountOverride")),
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withAccountRepository((repository, ownerId) => repository.updateContributionExceptions(ownerId, {
      ruleId: parsed.data.ruleId,
      occurrenceDates: parsed.data.occurrenceDates,
      kind: parsed.data.kind,
      amountMinor: parsed.data.amountOverride ?? null,
    }));
    revalidatePath("/accounts");
    return successState(parsed.data.kind === "restore" ? "Contribution exceptions restored." : "Contribution exceptions saved.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function extendAccountTimelineAction(_previousState: AccountActionState, formData: FormData): Promise<AccountActionState> {
  const parsed = accountTimelineExtensionInputSchema.safeParse({ throughDate: formDataText(formData, "throughDate") });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    const result = await withAccountRepository((repository, ownerId) => repository.extendTimeline(ownerId, parsed.data.throughDate));
    revalidatePath("/accounts");
    return successState(result.periodsCreated > 0 ? `Timeline extended through ${result.throughDate}.` : "Timeline already reaches that date.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}
