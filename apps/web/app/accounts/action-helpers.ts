export type AccountActionField = "id" | "name" | "institutionName" | "kind" | "customTypeLabel" | "initialBalance" | "initialBalanceDate" | "initialStatus" | "accountId" | "asOf" | "balance" | "status" | "note" | "lastFour" | "ruleId" | "amount" | "frequency" | "startsOn" | "endsOn" | "isEnabled" | "recalculationScope" | "occurrenceDates" | "amountOverride" | "scope" | "throughDate" | "section" | "accountIds" | "includeInAvailableCash" | "useCashFlowPlannedTimeline";

export interface AccountActionState {
  readonly ok: boolean;
  readonly message: string;
  readonly fieldErrors: Partial<Record<AccountActionField, string>>;
}

export const initialAccountActionState: AccountActionState = { ok: false, message: "", fieldErrors: {} };

export function formDataText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function validationActionState(issues: readonly { path: readonly (string | number)[]; message: string }[]): AccountActionState {
  const fieldErrors: Partial<Record<AccountActionField, string>> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === "string" && field in fieldErrors === false) {
      fieldErrors[field as AccountActionField] = issue.message;
    }
  }
  return { ok: false, message: "Review the highlighted fields.", fieldErrors };
}

function safeRepositoryError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message === "Account name is required." || message === "Institution name is required.") return message;
  if (message === "An account with this name already exists at this institution.") return message;
  if (message === "Custom type labels are only allowed for Other accounts.") return message;
  if (message === "Account not found.") return "That account was not found.";
  if (message === "Contribution rule not found.") return "That recurring contribution rule was not found.";
  if (message === "Select at least one occurrence date.") return message;
  if (message === "Contribution amount must be a positive safe integer.") return "Contribution amount must be greater than zero.";
  if (message === "Timeline end date must be a valid ISO date.") return message;
  if (message === "Accounts can only be reordered inside their current section.") return message;
  if (message === "Account order must contain unique account IDs.") return message;
  if (message === "Use Cash Flow Payday Check to record the current balance for this account.") return message;
  if (message === "Imported balance anchors cannot be changed from Accounts.") return message;
  if (message === "Future pay periods must remain Projected.") return message;
  if (message.startsWith("Cannot delete this account")) return message;
  return "We couldn't save the account change. Try again.";
}

export function repositoryErrorActionState(error: unknown): AccountActionState {
  return { ok: false, message: safeRepositoryError(error), fieldErrors: {} };
}
