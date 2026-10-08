import type { OnboardingState } from "./onboarding-types";

export interface OnboardingActionState {
  readonly ok: boolean;
  readonly message: string;
  readonly state: OnboardingState | null;
}

export const initialOnboardingActionState: OnboardingActionState = { ok: false, message: "", state: null };
