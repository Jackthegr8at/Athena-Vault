export const ONBOARDING_STATE_VALUES = ["active", "dismissed", "completed"] as const;
export type OnboardingState = (typeof ONBOARDING_STATE_VALUES)[number];

export const ONBOARDING_STEP_IDS = ["account", "balance", "recurring"] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number];

export interface OnboardingCompletionInput {
  readonly hasActiveAccount: boolean;
  readonly hasActiveAccountBalance: boolean;
  readonly hasActiveRecurringMovement: boolean;
}

export interface OnboardingProgress {
  readonly account: boolean;
  readonly balance: boolean;
  readonly recurring: boolean;
  readonly completedCount: number;
  readonly nextStepId: OnboardingStepId | null;
}

export interface OnboardingSnapshot extends OnboardingProgress {
  readonly state: OnboardingState;
}

export interface OnboardingActionState {
  readonly ok: boolean;
  readonly message: string;
  readonly state: OnboardingState | null;
}

export const initialOnboardingActionState: OnboardingActionState = { ok: false, message: "", state: null };

export function isOnboardingState(value: unknown): value is OnboardingState {
  return typeof value === "string" && (ONBOARDING_STATE_VALUES as readonly string[]).includes(value);
}

export function deriveOnboardingProgress(input: OnboardingCompletionInput): OnboardingProgress {
  const account = input.hasActiveAccount;
  const balance = input.hasActiveAccountBalance;
  const recurring = input.hasActiveRecurringMovement;
  const completed = [account, balance, recurring];

  return {
    account,
    balance,
    recurring,
    completedCount: completed.filter(Boolean).length,
    nextStepId: account ? (balance ? (recurring ? null : "recurring") : "balance") : "account",
  };
}

export function isOnboardingGuideVisible(snapshot: OnboardingSnapshot): boolean {
  return snapshot.state === "active" && snapshot.completedCount < ONBOARDING_STEP_IDS.length;
}
