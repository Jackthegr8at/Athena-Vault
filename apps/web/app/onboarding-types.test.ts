import { describe, expect, it } from "vitest";
import { deriveOnboardingProgress, isOnboardingGuideVisible } from "./onboarding-types";

describe("Overview onboarding progress", () => {
  it("starts with the account step and no completed steps", () => {
    expect(deriveOnboardingProgress({
      hasActiveAccount: false,
      hasActiveAccountBalance: false,
      hasActiveRecurringMovement: false,
    })).toEqual({ account: false, balance: false, recurring: false, completedCount: 0, nextStepId: "account" });
  });

  it("keeps the balance step incomplete without an active account", () => {
    expect(deriveOnboardingProgress({
      hasActiveAccount: false,
      hasActiveAccountBalance: true,
      hasActiveRecurringMovement: true,
    })).toMatchObject({ completedCount: 2, nextStepId: "account" });
  });

  it("advances through partial setup and ignores transfer-only movement in the loader contract", () => {
    expect(deriveOnboardingProgress({
      hasActiveAccount: true,
      hasActiveAccountBalance: true,
      hasActiveRecurringMovement: false,
    })).toEqual({ account: true, balance: true, recurring: false, completedCount: 2, nextStepId: "recurring" });
  });

  it("hides only dismissed/completed guides or an active guide with every step complete", () => {
    expect(isOnboardingGuideVisible({ state: "active", account: true, balance: true, recurring: false, completedCount: 2, nextStepId: "recurring" })).toBe(true);
    expect(isOnboardingGuideVisible({ state: "active", account: true, balance: true, recurring: true, completedCount: 3, nextStepId: null })).toBe(false);
    expect(isOnboardingGuideVisible({ state: "dismissed", account: false, balance: false, recurring: false, completedCount: 0, nextStepId: "account" })).toBe(false);
    expect(isOnboardingGuideVisible({ state: "completed", account: false, balance: false, recurring: false, completedCount: 0, nextStepId: "account" })).toBe(false);
  });
});
