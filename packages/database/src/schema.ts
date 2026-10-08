import type { AccountKind } from "./account-timeline";

export interface UserRecord { id: string; email: string; createdAt: string; }
export interface InstitutionRecord { id: string; ownerId: string; name: string; currency: "CAD" | "USD" | "EUR"; }
export interface AccountRecord { id: string; ownerId: string; institutionId: string; name: string; kind: AccountKind; balanceMinor: number; }
export interface EnvelopeRecord { id: string; ownerId: string; name: string; targetMinor: number; balanceMinor: number; }
export interface BalanceSnapshotRecord { id: string; ownerId: string; accountId: string; asOf: string; balanceMinor: number; }
export interface ImportBatchRecord { id: string; ownerId: string; sourceFile: string; sheetCount: number; cellCount: number; formulaCount: number; status: "passed" | "warning" | "blocked"; }

export const tableNames = ["users", "institutions", "accounts", "account_groups", "envelopes", "transactions", "transfers", "recurring_transactions", "recurring_cash_flow_series", "recurring_cash_flow_override_groups", "recurring_cash_flow_occurrence_exceptions", "balance_snapshots", "annual_expenses", "projection_scenarios", "financial_goals", "liabilities", "investment_accounts", "import_batches", "audit_events"] as const;
