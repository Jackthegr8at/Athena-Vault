import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const returning = vi.fn(async () => [{ id: "owner-a" }]);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  return {
    database: { update },
    users: { id: "users.id", onboardingState: "users.onboardingState" },
    eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
    update,
    set,
    where,
    returning,
    revalidatePath: vi.fn(),
    withWritableAuthenticatedDatabase: vi.fn(async (callback: (database: unknown, user: unknown) => unknown) => callback(
      { update },
      { owner: { id: "owner-a" }, authUserId: "auth-a", session: { id: "session-a" } },
    )),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@athena/database", () => ({ eq: mocks.eq, users: mocks.users }));
vi.mock("../lib/server/owner-database", () => ({ withWritableAuthenticatedDatabase: mocks.withWritableAuthenticatedDatabase }));

import { initialOnboardingActionState } from "./onboarding-types";
import { updateOnboardingStateAction } from "./onboarding-actions";

function formData(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

describe("Overview onboarding state action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.returning.mockResolvedValue([{ id: "owner-a" }]);
    mocks.withWritableAuthenticatedDatabase.mockImplementation(async (callback: (database: unknown, user: unknown) => unknown) => callback(
      { update: mocks.update },
      { owner: { id: "owner-a" }, authUserId: "auth-a", session: { id: "session-a" } },
    ));
  });

  it("rejects invalid state before touching the database", async () => {
    const result = await updateOnboardingStateAction(initialOnboardingActionState, formData({ state: "delete-all", ownerId: "owner-b" }));
    expect(result.ok).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("uses the authenticated owner and ignores a posted owner identifier", async () => {
    const result = await updateOnboardingStateAction(initialOnboardingActionState, formData({ state: "dismissed", ownerId: "owner-b" }));
    expect(result).toEqual({ ok: true, message: "Getting started is hidden. You can enable it again in Settings if needed.", state: "dismissed" });
    expect(mocks.set).toHaveBeenCalledWith({ onboardingState: "dismissed" });
    expect(mocks.where).toHaveBeenCalledWith({ left: "users.id", right: "owner-a" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("does not re-render the dashboard when opening the guide", async () => {
    const result = await updateOnboardingStateAction(initialOnboardingActionState, formData({ state: "active" }));

    expect(result).toEqual({ ok: true, message: "Getting started is visible again.", state: "active" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("is idempotent for repeated updates and hides database failure details", async () => {
    const completedResult = await updateOnboardingStateAction(initialOnboardingActionState, formData({ state: "completed" }));
    expect(completedResult).toEqual({ ok: true, message: "Getting started marked complete. You can reopen it any time.", state: "completed" });
    await updateOnboardingStateAction(initialOnboardingActionState, formData({ state: "completed" }));
    expect(mocks.update).toHaveBeenCalledTimes(2);

    mocks.returning.mockRejectedValueOnce(new Error("DATABASE_URL=secret"));
    const result = await updateOnboardingStateAction(initialOnboardingActionState, formData({ state: "active" }));
    expect(result).toEqual({ ok: false, message: "We couldn't update Getting started. Try again.", state: null });
  });
});
