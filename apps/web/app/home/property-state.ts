export type PropertyActionField =
  | "id"
  | "asOf"
  | "marketValue"
  | "principal"
  | "effectiveOn"
  | "annualRate"
  | "compoundingConvention"
  | "paymentExpenseId"
  | "nextPaymentOn"
  | "renewalOn"
  | "payoffOn";

export interface PropertyActionState {
  readonly ok: boolean;
  readonly message: string;
  readonly fieldErrors: Partial<Record<PropertyActionField, string>>;
}

export const initialPropertyActionState: PropertyActionState = {
  ok: false,
  message: "",
  fieldErrors: {},
};

export function propertyValidationActionState(
  issues: readonly { path: readonly (string | number)[]; message: string }[],
): PropertyActionState {
  const fieldErrors: Partial<Record<PropertyActionField, string>> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (field === "asOf" || field === "marketValue" || field === "principal" || field === "effectiveOn" || field === "annualRate" || field === "compoundingConvention" || field === "paymentExpenseId" || field === "nextPaymentOn" || field === "renewalOn" || field === "payoffOn" || field === "id") fieldErrors[field] ??= issue.message;
  }
  return { ok: false, message: "Review the highlighted fields.", fieldErrors };
}

function safePropertyRepositoryError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message === "A Home profile already exists.") return message;
  if (message === "Home profile not found.") return "Create the Home profile before editing property data.";
  if (message === "Home market value not found.") return "That property value was not found.";
  if (message === "Mortgage balance anchor not found.") return "That mortgage balance anchor was not found.";
  if (message === "Mortgage term not found.") return "That mortgage term was not found.";
  if (message === "Payment expense not found.") return "Select an active household expense as the mortgage payment source.";
  if (message === "Mortgage payment source must be an active biweekly household expense greater than zero.") return message;
  if (message === "Actual mortgage balances cannot be future-dated.") return message;
  return "We couldn't save the Home change. Try again.";
}

export function propertyRepositoryErrorActionState(error: unknown): PropertyActionState {
  return { ok: false, message: safePropertyRepositoryError(error), fieldErrors: {} };
}
