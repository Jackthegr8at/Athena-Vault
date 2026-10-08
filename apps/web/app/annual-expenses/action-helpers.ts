export type AnnualExpenseActionField =
  | "id"
  | "linkedAccountId"
  | "budgetId"
  | "annualExpenseId"
  | "annualExpenseValueId"
  | "name"
  | "amount"
  | "plannedAmount"
  | "dueMonth"
  | "dueDay"
  | "dueDate"
  | "taxYear"
  | "paymentOn"
  | "note"
  | "confirm"
  | "scope";

export interface AnnualExpenseActionState {
  readonly ok: boolean;
  readonly message: string;
  readonly fieldErrors: Partial<Record<AnnualExpenseActionField, string>>;
}

export const initialAnnualExpenseActionState: AnnualExpenseActionState = {
  ok: false,
  message: "",
  fieldErrors: {},
};

export function shouldCloseSuccessfulUpdate(
  previousState: AnnualExpenseActionState,
  nextState: AnnualExpenseActionState,
  pending: boolean,
  showMessage: boolean,
): boolean {
  return showMessage && !pending && nextState !== previousState && nextState.ok;
}

export function formDataText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function formDataBoolean(formData: FormData, key: string): boolean {
  const value = formDataText(formData, key);
  return value === "true" || value === "on" || value === "1";
}

export function validationActionState(issues: readonly { path: readonly (string | number)[]; message: string }[]): AnnualExpenseActionState {
  const fieldErrors: Partial<Record<AnnualExpenseActionField, string>> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === "string" && field in fieldErrors || [
      "id", "linkedAccountId", "budgetId", "annualExpenseId", "annualExpenseValueId", "name", "amount", "plannedAmount", "dueMonth", "dueDay", "dueDate", "taxYear", "paymentOn", "note", "confirm", "scope",
    ].includes(String(field))) {
      fieldErrors[field as AnnualExpenseActionField] ??= issue.message;
    }
  }
  return { ok: false, message: "Review the highlighted fields.", fieldErrors };
}

function safeRepositoryError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message === "Annual expense not found.") return "That annual expense was not found.";
  if (message === "Annual expense is archived.") return "Restore this annual expense before moving its remainder.";
  if (message === "Annual expense budget is archived.") return "Restore this budget before moving an annual-expense remainder.";
  if (message === "Annual expense changed while preparing remainder transfer.") return "This annual expense changed while preparing the transfer. Refresh and try again.";
  if (message === "Annual expense due date is required before moving its remainder.") return "A due date is required before moving an annual-expense remainder.";
  if (message === "Annual expense has no later matching occurrence.") return "No later expense with the same name was found in this budget.";
  if (message === "Annual expense has no remaining amount to move.") return "There is no remaining amount to move from this occurrence.";
  if (message === "Cannot move a remainder from an over-budget annual expense.") return "An over-budget occurrence has no remainder available to move.";
  if (message === "Annual expense occurrence not found.") return "That annual expense year is not available.";
  if (message === "Annual expense payment not found.") return "That payment was not found.";
  if (message === "Annual budget not found.") return "That annual budget was not found.";
  if (message === "Annual budget linked account not found.") return "The linked annual-budget account was not found.";
  if (message === "Annual budget linked account is not active.") return "Choose an active funding account.";
  if (message === "Annual budget linked account is already assigned to another active budget.") return "That account already funds another active budget.";
  if (message === "Annual budget name is already in use.") return "An active annual budget with this name already exists.";
  if (message === "Annual budget conflicts with another active budget.") return "That annual budget conflicts with another active budget.";
  if (message === "Annual budget is already active.") return "That annual budget is already active.";
  return "We couldn't save the annual-expense change. Try again.";
}

export function repositoryErrorActionState(error: unknown): AnnualExpenseActionState {
  return { ok: false, message: safeRepositoryError(error), fieldErrors: {} };
}
