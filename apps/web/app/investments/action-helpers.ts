export type InvestmentProjectionActionField =
  | "id"
  | "mode"
  | "name"
  | "notes"
  | "horizonYears"
  | "manualStartingAmountMinor"
  | "investmentAccountIds"
  | "accountSchedules"
  | "ratesBps"
  | "investmentAccountId"
  | "cashFlowAccountId"
  | "accountId"
  | "instrumentType"
  | "currency"
  | "symbol"
  | "holdingId"
  | "occurredOn"
  | "kind"
  | "units"
  | "amount"
  | "fee"
  | "note"
  | "effectiveOn"
  | "price"
  | "rate"
  | "valuationOn"
  | "transactionId"
  | "confirm";

export interface InvestmentProjectionActionState {
  readonly ok: boolean;
  readonly message: string;
  readonly fieldErrors: Partial<Record<InvestmentProjectionActionField, string>>;
}

export const initialInvestmentProjectionActionState: InvestmentProjectionActionState = {
  ok: false,
  message: "",
  fieldErrors: {},
};

const fields: readonly InvestmentProjectionActionField[] = [
  "id",
  "mode",
  "name",
  "notes",
  "horizonYears",
  "manualStartingAmountMinor",
  "investmentAccountIds",
  "accountSchedules",
  "ratesBps",
  "investmentAccountId",
  "cashFlowAccountId",
  "accountId",
  "instrumentType",
  "currency",
  "symbol",
  "holdingId",
  "occurredOn",
  "kind",
  "units",
  "amount",
  "fee",
  "note",
  "effectiveOn",
  "price",
  "rate",
  "valuationOn",
  "transactionId",
  "confirm",
];

const projectionIntegerKeys = new Set([
  "amountMinor",
  "annualIncreaseBps",
  "annualIncreaseMinor",
  "baseContributionMinor",
  "displayOrder",
  "manualStartingAmountMinor",
  "rateBps",
  "year",
]);

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

/**
 * Convert an integer string only when BigInt proves it is a safe application
 * number. Unsafe or non-integer values are left intact for Zod to reject;
 * they are never rounded through Number().
 */
export function safeIntegerValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = value.trim();
  if (!/^-?\d+$/.test(normalized)) return value;
  try {
    const integer = BigInt(normalized);
    if (integer < BigInt(Number.MIN_SAFE_INTEGER) || integer > BigInt(Number.MAX_SAFE_INTEGER)) return value;
    return Number(integer);
  } catch {
    return value;
  }
}

/** Parse a form scalar that represents non-negative integer minor units. */
export function formDataMinorUnits(formData: FormData, key: string): unknown {
  const raw = formData.get(key);
  if (raw === null || typeof raw !== "string" || raw.trim() === "") return undefined;
  return safeIntegerValue(raw);
}

function normalizeProjectionJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => safeIntegerValue(normalizeProjectionJson(item)));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    projectionIntegerKeys.has(key) ? safeIntegerValue(child) : normalizeProjectionJson(child),
  ]));
}

export function formDataJson(formData: FormData, key: string): unknown {
  const raw = formDataText(formData, key);
  if (!raw) return [];
  try {
    return normalizeProjectionJson(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function validationActionState(
  issues: readonly { path: readonly (string | number)[]; message: string }[],
): InvestmentProjectionActionState {
  const fieldErrors: Partial<Record<InvestmentProjectionActionField, string>> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? "");
    if (fields.includes(field as InvestmentProjectionActionField)) {
      fieldErrors[field as InvestmentProjectionActionField] ??= issue.message;
    }
  }
  return { ok: false, message: "Review the highlighted fields.", fieldErrors };
}

function safeRepositoryError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message === "Investment projection project not found.") return "That projection project was not found.";
  if (message === "Investment account not found.") return "That investment account was not found.";
  if (message === "Cash Flow account not found.") return "That Cash Flow account was not found or is inactive.";
  if (message === "REEI/RDSP Account not found or inactive.") return "Choose an active REEI/RDSP Account.";
  if (message === "Investment holding not found.") return "That holding was not found or is inactive.";
  if (message === "Investment holding transaction not found.") return "That holding transaction was not found.";
  if (message === "Cannot sell more units than are available.") return "The sale cannot exceed the units currently held.";
  if (message === "Market data is unavailable.") return "Market data is unavailable for this symbol. Try a provider symbol such as VEQT.TO or enter a manual price; your saved prices were not changed.";
  if (message.includes("FX rate") && message.includes("positive")) return "Enter a positive USD-to-CAD rate.";
  if (message === "One or more selected investment accounts were not found.") return "One or more selected investment accounts are unavailable.";
  if (message === "Investment projection project must be a portfolio project.") return "Only portfolio projects can have account schedules.";
  if (message === "Investment projection project must be a calculator project.") return "Only calculator projects can have a manual starting amount.";
  if (message.includes("schedule") && message.includes("not found")) return "That portfolio schedule was not found.";
  if (message.includes("override") && message.includes("not found")) return "That annual override was not found.";
  if (message.includes("safe integer") || message.includes("overflow")) return "One or more amounts are too large to project safely.";
  if (message.includes("duplicate key") || message.includes("investment_projection_projects_owner_name_idx")) return "A projection project with that name already exists.";
  if (message.includes("annual override") || message.includes("annual increase") || message.includes("contribution frequency")) return "Review each portfolio account schedule.";
  if (message.includes("must be") || message === "Owner ID is required.") return "Review the highlighted fields.";
  return "We couldn't save the investment projection change. Try again.";
}

export function repositoryErrorActionState(error: unknown): InvestmentProjectionActionState {
  return { ok: false, message: safeRepositoryError(error), fieldErrors: {} };
}
