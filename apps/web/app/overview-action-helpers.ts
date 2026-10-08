export type OverviewActionField = "displayName";

export interface OverviewActionState {
  readonly ok: boolean;
  readonly message: string;
  readonly fieldErrors: Partial<Record<OverviewActionField, string>>;
}

export const initialOverviewActionState: OverviewActionState = {
  ok: false,
  message: "",
  fieldErrors: {},
};

export function overviewValidationActionState(
  issues: readonly { path: readonly (string | number)[]; message: string }[],
): OverviewActionState {
  const fieldErrors: Partial<Record<OverviewActionField, string>> = {};
  for (const issue of issues) {
    if (issue.path[0] === "displayName") fieldErrors.displayName ??= issue.message;
  }
  return { ok: false, message: "Review the highlighted field.", fieldErrors };
}

function safeOverviewRepositoryError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message === "Owner not found.") return "Your owner profile could not be found. Try again.";
  if (message === "Owner display name is invalid.") return "Display name must be between 1 and 80 characters.";
  return "We couldn't save your display name. Try again.";
}

export function overviewRepositoryErrorActionState(error: unknown): OverviewActionState {
  return { ok: false, message: safeOverviewRepositoryError(error), fieldErrors: {} };
}
