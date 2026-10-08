export type ProjectActionField =
  | "id"
  | "projectId"
  | "sourceProjectId"
  | "expenseId"
  | "participantId"
  | "name"
  | "year"
  | "ownerParticipates"
  | "projectNote"
  | "description"
  | "expenseOn"
  | "quantity"
  | "amount"
  | "note"
  | "participantName"
  | "paidAmount"
  | "confirm";

export interface ProjectActionState {
  readonly ok: boolean;
  readonly message: string;
  readonly fieldErrors: Partial<Record<ProjectActionField, string>>;
}

export const initialProjectActionState: ProjectActionState = {
  ok: false,
  message: "",
  fieldErrors: {},
};

const fields: readonly ProjectActionField[] = [
  "id", "projectId", "sourceProjectId", "expenseId", "participantId", "name", "year", "ownerParticipates", "projectNote", "description", "expenseOn", "quantity", "amount", "note", "participantName", "paidAmount", "confirm",
];

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

export function validationActionState(issues: readonly { path: readonly (string | number)[]; message: string }[]): ProjectActionState {
  const fieldErrors: Partial<Record<ProjectActionField, string>> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? "");
    if (fields.includes(field as ProjectActionField)) fieldErrors[field as ProjectActionField] ??= issue.message;
  }
  return { ok: false, message: "Review the highlighted fields.", fieldErrors };
}

function safeRepositoryError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message === "Project not found.") return "That project was not found.";
  if (message === "Project expense not found.") return "That project expense was not found.";
  if (message === "Project participant not found.") return "That project participant was not found.";
  if (message === "Project is already archived.") return "That project is already archived.";
  if (message === "Project is already active.") return "That project is already active.";
  if (message.includes("must be") || message === "Owner ID is required.") return "Review the highlighted fields.";
  return "We couldn't save the project change. Try again.";
}

export function repositoryErrorActionState(error: unknown): ProjectActionState {
  return { ok: false, message: safeRepositoryError(error), fieldErrors: {} };
}
