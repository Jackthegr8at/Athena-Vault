export type SalaryActionField =
  | "id"
  | "salaryYearId"
  | "snapshotId"
  | "taxYear"
  | "annualBase"
  | "finalFederal"
  | "payPeriodsPerYearOverride"
  | "snapshotOn"
  | "federalCumulative"
  | "provincialCumulative"
  | "rrqContributionYtd"
  | "firstMaximum"
  | "additionalMaximum"
  | "ympe"
  | "yampe"
  | "firstRate"
  | "additionalRate"
  | "completedPayNumberOverride"
  | "note"
  | "confirm";

export interface SalaryActionState {
  readonly ok: boolean;
  readonly message: string;
  readonly fieldErrors: Partial<Record<SalaryActionField, string>>;
}

export const initialSalaryActionState: SalaryActionState = {
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

export function validationActionState(issues: readonly { path: readonly (string | number)[]; message: string }[]): SalaryActionState {
  const fieldErrors: Partial<Record<SalaryActionField, string>> = {};
  const fields: readonly SalaryActionField[] = [
    "id", "salaryYearId", "snapshotId", "taxYear", "annualBase", "finalFederal", "payPeriodsPerYearOverride", "snapshotOn",
    "federalCumulative", "provincialCumulative", "rrqContributionYtd", "firstMaximum", "additionalMaximum", "ympe", "yampe", "firstRate", "additionalRate", "completedPayNumberOverride", "note", "confirm",
  ];
  for (const issue of issues) {
    const field = String(issue.path[0] ?? "");
    if (fields.includes(field as SalaryActionField)) fieldErrors[field as SalaryActionField] ??= issue.message;
  }
  return { ok: false, message: "Review the highlighted fields.", fieldErrors };
}

function safeRepositoryError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message === "Salary year not found.") return "That salary year was not found.";
  if (message === "Salary snapshot not found.") return "That salary snapshot was not found.";
  if (message === "Salary year is already finalized.") return "That year is already finalized.";
  if (message === "Salary year is already in progress.") return "That year is already in progress.";
  if (message === "Salary year is not finalized.") return "That year must be finalized before its official amount can be edited.";
  if (message === "Salary year needs a snapshot before it can be finalized.") return "Add a federal snapshot before finalizing this year.";
  if (message === "Snapshot date is not on the biweekly payday schedule. Enter a completed-pay override.") return "This date is off the payday rhythm; enter the completed-pay override.";
  if (message === "Completed pay number cannot exceed total pay periods.") return "Completed pay cannot exceed the year's total pay periods.";
  if (message === "RRQ contribution YTD must be a non-negative safe integer.") return "RRQ contribution YTD must be a non-negative amount.";
  if (message === "RRQ YAMPE cannot be below YMPE.") return "YAMPE must be at least YMPE.";
  if (message === "RRQ year limits could not be saved.") return "We couldn't save the RRQ yearly limits. Try again.";
  return "We couldn't save the salary change. Try again.";
}

export function repositoryErrorActionState(error: unknown): SalaryActionState {
  return { ok: false, message: safeRepositoryError(error), fieldErrors: {} };
}

export function shouldCloseSuccessfulSalaryUpdate(
  previousState: SalaryActionState,
  nextState: SalaryActionState,
  pending: boolean,
  showMessage: boolean,
): boolean {
  return showMessage && !pending && nextState !== previousState && nextState.ok;
}
