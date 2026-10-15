import type { CashFlowRecurringOptionSeries } from "./recurring-editor";
import type { SerializedExcludedExpense } from "./client";
export function isRecurringDetails(value: unknown): value is readonly CashFlowRecurringOptionSeries[] {
  return Array.isArray(value) && value.every(row => row && typeof row.id === "string" && ["active", "paused", "ended"].includes(row.state) && Array.isArray(row.versions) && row.versions.every((v: Record<string, unknown>) => v && typeof v.id === "string" && typeof v.name === "string" && typeof v.frequency === "string" && ["income", "expense", "transfer"].includes(String(v.kind)) && ["planned", "actual"].includes(String(v.status)) && typeof v.isCurrent === "boolean" && Number.isSafeInteger(v.amountMinor)));
}
export function isExcludedDetails(value: unknown): value is readonly SerializedExcludedExpense[] {
  return Array.isArray(value) && value.every(row => row && typeof row.id === "string" && typeof row.accountName === "string" && typeof row.transactionDate === "string" && typeof row.description === "string" && ["actual", "planned"].includes(row.status) && Number.isSafeInteger(row.amountMinor));
}
