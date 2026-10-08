export type GoalActionField =
  | "id"
  | "name"
  | "target"
  | "current"
  | "targetDate"
  | "priority"
  | "status"
  | "confirm"
  | "goalId"
  | "accountId"
  | "sourceAccountId"
  | "amount"
  | "frequency"
  | "startsOn"
  | "countsAsExpense"
  | "stopContributions"
  | "enabled"
  | "planId";

export interface GoalActionState {
  readonly ok: boolean;
  readonly message: string;
  readonly fieldErrors: Partial<Record<GoalActionField, string>>;
}

export const initialGoalActionState: GoalActionState = {
  ok: false,
  message: "",
  fieldErrors: {},
};

export function formDataText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export function emptyToNull(value: string): string | null {
  const normalized = value.trim();
  return normalized || null;
}

export function formDataBoolean(formData: FormData, key: string): boolean {
  const value = formDataText(formData, key);
  return value === "true" || value === "on" || value === "1";
}

export function validationActionState(issues: readonly { path: readonly (string | number)[]; message: string }[]): GoalActionState {
  const fieldErrors: Partial<Record<GoalActionField, string>> = {};
  const fields: readonly GoalActionField[] = [
    "id", "name", "target", "current", "targetDate", "priority", "status", "confirm",
    "goalId", "accountId", "sourceAccountId", "amount", "frequency", "startsOn", "countsAsExpense",
    "stopContributions", "enabled", "planId",
  ];
  for (const issue of issues) {
    const field = String(issue.path[0] ?? "");
    if (fields.includes(field as GoalActionField)) fieldErrors[field as GoalActionField] ??= issue.message;
  }
  return { ok: false, message: "Review the highlighted fields.", fieldErrors };
}

function safeRepositoryError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/financial_goal_plans_owner_series_idx/i.test(message)) return "That Cash Flow transfer is already linked to another goal plan.";
  if (message === "Goal not found.") return "That goal was not found.";
  if (message === "Goal could not be created.") return "We couldn't create the goal. Try again.";
  if (/duplicate key|financial_goals_owner_name_idx/i.test(message)) return "A goal with that name already exists.";
  if (message === "Goal plan not found.") return "That goal plan was not found.";
  if (message === "Goal plan destination account is not eligible.") return "The selected account is not eligible for this goal plan.";
  if (/source account.*required/i.test(message)) return "Select a source account that is visible in Cash Flow.";
  if (/source account.*not eligible|source account.*ineligible/i.test(message)) return "The selected source account is not eligible for this goal plan.";
  if (/source account.*not visible|source account.*hidden/i.test(message)) return "The selected source account is not visible in Cash Flow.";
  if (/source.*destination.*(differ|same|equal)|same account/i.test(message)) return "Choose two different accounts for the source and destination.";
  if (/series not found|cash flow series not found/i.test(message)) return "The linked Cash Flow transfer was not found.";
  if (/cash flow.*(sync|synchroniz)|transfer.*sync/i.test(message)) return "We couldn't synchronize the Cash Flow transfer. Try again.";
  if (message === "Goal target date is required.") return "A target date is required for the goal plan.";
  if (message === "Goal target date must be on or after today.") return "The goal target date must be today or in the future.";
  if (message === "Start date must be on or after today.") return "Start date must be today or later.";
  if (message === "Start date must be on or before the target date.") return "Start date must be on or before the target date.";
  if (message === "Contribution amount must be a positive safe integer.") return "Enter a valid positive amount.";
  if (message === "Goal plan frequency is not supported.") return "That plan frequency is not supported.";
  if (message === "Contribution rule not found.") return "The linked contribution rule was not found.";
  if (message === "Linked plan unavailable.") return "The linked plan is unavailable. Choose a different account or disable the plan.";
  return "We couldn't save the goal change. Try again.";
}

export function repositoryErrorActionState(error: unknown): GoalActionState {
  return { ok: false, message: safeRepositoryError(error), fieldErrors: {} };
}
