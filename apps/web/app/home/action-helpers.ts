export type MaintenanceActionField = "id" | "name" | "amount" | "frequency";

export interface MaintenanceActionState {
  readonly ok: boolean;
  readonly message: string;
  readonly fieldErrors: Partial<Record<MaintenanceActionField, string>>;
}

export const initialMaintenanceActionState: MaintenanceActionState = {
  ok: false,
  message: "",
  fieldErrors: {},
};

export function formDataText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export function validationActionState(issues: readonly { path: readonly (string | number)[]; message: string }[]): MaintenanceActionState {
  const fieldErrors: Partial<Record<MaintenanceActionField, string>> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (field === "id" || field === "name" || field === "amount" || field === "frequency") {
      fieldErrors[field] ??= issue.message;
    }
  }
  return { ok: false, message: "Review the highlighted fields.", fieldErrors };
}

function safeRepositoryError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message === "An annual maintenance item with this name already exists.") return message;
  if (message === "Annual maintenance item not found.") return "That annual maintenance item was not found.";
  if (message === "Annual maintenance summary not found.") return "Annual maintenance is not configured for this owner.";
  return "We couldn't save the annual maintenance change. Try again.";
}

export function repositoryErrorActionState(error: unknown): MaintenanceActionState {
  return { ok: false, message: safeRepositoryError(error), fieldErrors: {} };
}
