import "./server-only";

import { accounts, and, balanceSnapshots, eq, recurringCashFlowSeries, sql, users, type Database } from "@athena/database";
import {
  deriveOnboardingProgress,
  isOnboardingState,
  type OnboardingSnapshot,
  type OnboardingState,
} from "../../app/onboarding-types";

export interface OnboardingPrecomputedFlags {
  readonly hasAccount?: boolean;
  readonly hasBalance?: boolean;
  readonly hasRecurring?: boolean;
}

export async function getOnboardingSnapshot(database: Database, ownerId: string, precomputed: OnboardingPrecomputedFlags = {}): Promise<OnboardingSnapshot> {
  const [userRows, activeAccountRows, activeBalanceRows, activeRecurringRows] = await Promise.all([
    database.select({ onboardingState: users.onboardingState })
      .from(users)
      .where(eq(users.id, ownerId))
      .limit(1),
    precomputed.hasAccount === undefined
      ? database.select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.ownerId, ownerId), eq(accounts.isActive, true)))
        .limit(1)
      : null,
    precomputed.hasBalance === undefined
      ? database.select({ id: balanceSnapshots.id })
        .from(balanceSnapshots)
        .innerJoin(accounts, and(
          eq(balanceSnapshots.accountId, accounts.id),
          eq(accounts.ownerId, ownerId),
          eq(accounts.isActive, true),
        ))
        .where(eq(balanceSnapshots.ownerId, ownerId))
        .limit(1)
      : null,
    precomputed.hasRecurring === undefined
      ? database.select({ id: recurringCashFlowSeries.id })
        .from(recurringCashFlowSeries)
        .where(and(
          eq(recurringCashFlowSeries.ownerId, ownerId),
          eq(recurringCashFlowSeries.state, "active"),
          sql`${recurringCashFlowSeries.kind} IN ('income', 'expense')`,
        ))
        .limit(1)
      : null,
  ]);

  const stateValue = userRows[0]?.onboardingState;
  if (!isOnboardingState(stateValue)) throw new Error("Onboarding state is invalid.");

  const progress = deriveOnboardingProgress({
    hasActiveAccount: precomputed.hasAccount ?? activeAccountRows!.length > 0,
    hasActiveAccountBalance: precomputed.hasBalance ?? activeBalanceRows!.length > 0,
    hasActiveRecurringMovement: precomputed.hasRecurring ?? activeRecurringRows!.length > 0,
  });
  return { state: stateValue, ...progress };
}

export function onboardingStateMessage(state: OnboardingState): string {
  if (state === "dismissed") return "Getting started is hidden. You can enable it again in Settings if needed.";
  if (state === "completed") return "Getting started marked complete. You can reopen it any time.";
  return "Getting started is visible again.";
}
