import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  goalRepository: {
    create: vi.fn(),
    update: vi.fn(),
    updateProgress: vi.fn(),
    setStatus: vi.fn(),
    delete: vi.fn(),
    restore: vi.fn(),
    listByOwner: vi.fn(),
  },
  goalPlanRepository: {
    savePlan: vi.fn(),
    setEnabled: vi.fn(),
    getByGoal: vi.fn(),
    listByOwner: vi.fn(),
    listEligibleDestinationAccounts: vi.fn(),
  },
  schemas: {
    goalCreateInputSchema: { safeParse: vi.fn() },
    goalUpdateInputSchema: { safeParse: vi.fn() },
    goalProgressInputSchema: { safeParse: vi.fn() },
    goalStatusInputSchema: { safeParse: vi.fn() },
    goalDeleteInputSchema: { safeParse: vi.fn() },
    goalIdSchema: { safeParse: vi.fn() },
    goalAchievedInputSchema: { safeParse: vi.fn() },
    goalPlanSaveInputSchema: { safeParse: vi.fn() },
    goalPlanEnabledInputSchema: { safeParse: vi.fn() },
  },
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  owner: vi.fn(async () => ({ id: "00000000-0000-0000-0000-000000000001" })),
  getServerDatabase: vi.fn(() => ({})),
  toTorontoDateIso: vi.fn(() => "2026-09-11"),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@athena/database", () => ({
  createGoalRepository: vi.fn(() => mocks.goalRepository),
  createGoalPlanRepository: vi.fn(() => mocks.goalPlanRepository),
  toTorontoDateIso: mocks.toTorontoDateIso,
}));
vi.mock("@athena/validation", () => mocks.schemas);
vi.mock("../../lib/server/owner-database", () => ({
  withWritableAuthenticatedDatabase: async (callback: (database: unknown, user: { readonly owner: { readonly id: string }; readonly authUserId: string; readonly session: { readonly id: string } }) => unknown) =>
    callback(mocks.getServerDatabase(), { owner: await mocks.owner(), authUserId: "auth-user", session: { id: "session" } }),
}));
vi.mock("../../lib/server/database", () => ({ getServerDatabase: mocks.getServerDatabase }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import {
  deleteGoalAction,
  disableGoalPlanAction,
  goalPlanPreviewsAction,
  restoreGoalAction,
  saveGoalPlanAction,
  setGoalStatusAction,
} from "./actions";
import { initialGoalActionState } from "./action-helpers";

function formData(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

describe("goal server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.schemas.goalCreateInputSchema.safeParse.mockReturnValue({ success: true, data: { name: "Goal", target: 1000, current: 0, targetDate: "2027-01-01", priority: 0 } });
    mocks.schemas.goalUpdateInputSchema.safeParse.mockReturnValue({ success: true, data: { id: "00000000-0000-0000-0000-000000000002", name: "Goal", target: 1000, current: 0, targetDate: "2027-01-01", priority: 0 } });
    mocks.schemas.goalProgressInputSchema.safeParse.mockReturnValue({ success: true, data: { id: "00000000-0000-0000-0000-000000000002", current: 500 } });
    mocks.schemas.goalStatusInputSchema.safeParse.mockReturnValue({ success: true, data: { id: "00000000-0000-0000-0000-000000000002", status: "achieved" } });
    mocks.schemas.goalDeleteInputSchema.safeParse.mockReturnValue({ success: true, data: { id: "00000000-0000-0000-0000-000000000002", confirm: true } });
    mocks.schemas.goalIdSchema.safeParse.mockReturnValue({ success: true, data: "00000000-0000-0000-0000-000000000002" });
    mocks.schemas.goalAchievedInputSchema.safeParse.mockReturnValue({ success: true, data: { id: "00000000-0000-0000-0000-000000000002", stopContributions: true } });
    mocks.schemas.goalPlanSaveInputSchema.safeParse.mockReturnValue({ success: true, data: { goalId: "00000000-0000-0000-0000-000000000002", accountId: "00000000-0000-0000-0000-000000000003", sourceAccountId: "00000000-0000-0000-0000-000000000004", amount: 5000, frequency: "weekly", countsAsExpense: false } });
    mocks.schemas.goalPlanEnabledInputSchema.safeParse.mockReturnValue({ success: true, data: { goalId: "00000000-0000-0000-0000-000000000002", enabled: false } });
    mocks.goalRepository.create.mockResolvedValue({ id: "goal" });
    mocks.goalRepository.update.mockResolvedValue({ id: "goal" });
    mocks.goalRepository.updateProgress.mockResolvedValue({ id: "goal" });
    mocks.goalRepository.setStatus.mockResolvedValue({ id: "goal" });
    mocks.goalRepository.delete.mockResolvedValue(undefined);
    mocks.goalRepository.restore.mockResolvedValue({ goal: { id: "goal" }, planEnabled: true });
    mocks.goalPlanRepository.savePlan.mockResolvedValue({ id: "plan" });
    mocks.goalPlanRepository.setEnabled.mockResolvedValue({ id: "plan" });
  });

  it("returns an owner-scoped preview for the requested goal", async () => {
    mocks.goalRepository.listByOwner.mockResolvedValueOnce([{
      id: "00000000-0000-0000-0000-000000000002",
      name: "Emergency reserve",
      targetMinor: 300000,
      currentMinor: 100000,
      targetDate: "2027-01-01",
      priority: 1,
      status: "active",
      currency: "CAD",
    }]);

    const result = await goalPlanPreviewsAction("00000000-0000-0000-0000-000000000002");

    expect(mocks.goalRepository.listByOwner).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.previews).toHaveLength(3);
      expect(result.previews[0]).toEqual(expect.objectContaining({ frequency: "weekly", remainingMinor: 200000 }));
    }
  });
  it("does not return a preview for a goal outside the authenticated owner", async () => {
    mocks.goalRepository.listByOwner.mockResolvedValueOnce([]);

    const result = await goalPlanPreviewsAction("00000000-0000-0000-0000-000000000002");

    expect(result).toEqual({ ok: false, message: "That goal was not found." });
    expect(mocks.goalRepository.listByOwner).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001");
  });

  it("rejects an invalid preview goal id before opening the repository", async () => {
    mocks.schemas.goalIdSchema.safeParse.mockReturnValueOnce({ success: false });

    const result = await goalPlanPreviewsAction("not-a-uuid");

    expect(result).toEqual({ ok: false, message: "Goal ID is invalid." });
    expect(mocks.goalRepository.listByOwner).not.toHaveBeenCalled();
  });

  it("rejects invalid save-plan input before touching the repository", async () => {
    mocks.schemas.goalPlanSaveInputSchema.safeParse.mockReturnValueOnce({
      success: false,
      error: { issues: [{ path: ["amount"], message: "Amount is required." }] },
    });
    const result = await saveGoalPlanAction(initialGoalActionState, formData({ goalId: "00000000-0000-0000-0000-000000000002", accountId: "00000000-0000-0000-0000-000000000003", frequency: "weekly" }));
    expect(result.ok).toBe(false);
    expect(result.fieldErrors.amount).toBe("Amount is required.");
    expect(mocks.goalPlanRepository.savePlan).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("surfaces source account validation errors on the source field", async () => {
    mocks.schemas.goalPlanSaveInputSchema.safeParse.mockReturnValueOnce({
      success: false,
      error: { issues: [{ path: ["sourceAccountId"], message: "Source and destination accounts must be different." }] },
    });
    const result = await saveGoalPlanAction(initialGoalActionState, formData({
      goalId: "00000000-0000-0000-0000-000000000002",
      accountId: "00000000-0000-0000-0000-000000000003",
      sourceAccountId: "00000000-0000-0000-0000-000000000003",
      amount: "50.00",
      frequency: "weekly",
    }));
    expect(result.ok).toBe(false);
    expect(result.fieldErrors.sourceAccountId).toBe("Source and destination accounts must be different.");
    expect(mocks.goalPlanRepository.savePlan).not.toHaveBeenCalled();
  });

  it("saves a goal plan with the server owner and revalidates goals, accounts, and cash flow", async () => {
    const result = await saveGoalPlanAction(initialGoalActionState, formData({
      goalId: "00000000-0000-0000-0000-000000000002",
      accountId: "00000000-0000-0000-0000-000000000003",
      sourceAccountId: "00000000-0000-0000-0000-000000000004",
      amount: "50.00",
      frequency: "weekly",
    }));
    expect(result).toEqual({ ok: true, message: "Goal saving plan saved.", fieldErrors: {} });
    expect(mocks.goalPlanRepository.savePlan).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", {
      goalId: "00000000-0000-0000-0000-000000000002",
      accountId: "00000000-0000-0000-0000-000000000003",
      sourceAccountId: "00000000-0000-0000-0000-000000000004",
      amountMinor: 5000,
      frequency: "weekly",
      countsAsExpense: false,
    }, "2026-09-11");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/goals");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/accounts");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/cash-flow");
  });

  it("passes countsAsExpense opt-in through to the repository", async () => {
    mocks.schemas.goalPlanSaveInputSchema.safeParse.mockReturnValueOnce({ success: true, data: { goalId: "00000000-0000-0000-0000-000000000002", accountId: "00000000-0000-0000-0000-000000000003", sourceAccountId: "00000000-0000-0000-0000-000000000004", amount: 5000, frequency: "weekly", countsAsExpense: true } });
    const result = await saveGoalPlanAction(initialGoalActionState, formData({
      goalId: "00000000-0000-0000-0000-000000000002",
      accountId: "00000000-0000-0000-0000-000000000003",
      sourceAccountId: "00000000-0000-0000-0000-000000000004",
      amount: "50.00",
      frequency: "weekly",
      countsAsExpense: "on",
    }));
    expect(result.ok).toBe(true);
    expect(mocks.goalPlanRepository.savePlan).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", expect.objectContaining({ countsAsExpense: true }), "2026-09-11");
  });

  it("disables a goal plan through the owner-scoped repository", async () => {
    const result = await disableGoalPlanAction(initialGoalActionState, formData({
      goalId: "00000000-0000-0000-0000-000000000002",
      enabled: "false",
    }));
    expect(result).toEqual({ ok: true, message: "Goal saving plan disabled.", fieldErrors: {} });
    expect(mocks.goalPlanRepository.setEnabled).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002", false, "2026-09-11");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/goals");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/accounts");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/cash-flow");
  });

  it("marks a goal achieved and stops contributions", async () => {
    const result = await setGoalStatusAction(initialGoalActionState, formData({
      id: "00000000-0000-0000-0000-000000000002",
      status: "achieved",
      stopContributions: "true",
    }));
    expect(result).toEqual({ ok: true, message: "Goal marked as achieved.", fieldErrors: {} });
    expect(mocks.goalRepository.setStatus).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002", "achieved", { stopContributions: true, todayIso: "2026-09-11" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/goals");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/accounts");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/cash-flow");
  });

  it("marks a goal achieved and preserves contributions", async () => {
    mocks.schemas.goalAchievedInputSchema.safeParse.mockReturnValueOnce({ success: true, data: { id: "00000000-0000-0000-0000-000000000002", stopContributions: false } });
    const result = await setGoalStatusAction(initialGoalActionState, formData({
      id: "00000000-0000-0000-0000-000000000002",
      status: "achieved",
      stopContributions: "false",
    }));
    expect(result).toEqual({ ok: true, message: "Goal marked as achieved.", fieldErrors: {} });
    expect(mocks.goalRepository.setStatus).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002", "achieved", { stopContributions: false, todayIso: "2026-09-11" });
  });

  it("restores a goal and reports when the linked plan stays disabled", async () => {
    mocks.goalRepository.restore.mockResolvedValueOnce({ goal: { id: "goal" }, planEnabled: false });
    const result = await restoreGoalAction(initialGoalActionState, formData({ id: "00000000-0000-0000-0000-000000000002" }));
    expect(result).toEqual({ ok: true, message: "Goal restored, but the linked saving plan is still disabled.", fieldErrors: {} });
    expect(mocks.goalRepository.restore).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002", "2026-09-11");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/goals");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/accounts");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/cash-flow");
  });

  it("deletes a goal through the transactional repository method", async () => {
    const result = await deleteGoalAction(initialGoalActionState, formData({ id: "00000000-0000-0000-0000-000000000002", confirm: "true" }));
    expect(result).toEqual({ ok: true, message: "Goal deleted.", fieldErrors: {} });
    expect(mocks.goalRepository.delete).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002", "2026-09-11");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/goals");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/accounts");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/cash-flow");
  });

  it("derives owner identity from the authenticated session and ignores form owner fields", async () => {
    await saveGoalPlanAction(initialGoalActionState, formData({
      ownerId: "another-owner",
      goalId: "00000000-0000-0000-0000-000000000002",
      accountId: "00000000-0000-0000-0000-000000000003",
      sourceAccountId: "00000000-0000-0000-0000-000000000004",
      amount: "50.00",
      frequency: "weekly",
    }));
    expect(mocks.goalPlanRepository.savePlan).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", expect.any(Object), "2026-09-11");
  });

  it("maps repository errors to safe messages without leaking details", async () => {
    mocks.goalPlanRepository.savePlan.mockRejectedValueOnce(new Error("Goal plan destination account is not eligible."));
    const result = await saveGoalPlanAction(initialGoalActionState, formData({
      goalId: "00000000-0000-0000-0000-000000000002",
      accountId: "00000000-0000-0000-0000-000000000003",
      sourceAccountId: "00000000-0000-0000-0000-000000000004",
      amount: "50.00",
      frequency: "weekly",
    }));
    expect(result).toEqual({ ok: false, message: "The selected account is not eligible for this goal plan.", fieldErrors: {} });
    expect(result.message).not.toContain("Goal plan destination account is not eligible.");
  });

  it("maps source account repository errors to safe messages", async () => {
    mocks.goalPlanRepository.savePlan.mockRejectedValueOnce(new Error("Goal plan source account is not visible in Cash Flow."));
    const result = await saveGoalPlanAction(initialGoalActionState, formData({
      goalId: "00000000-0000-0000-0000-000000000002",
      accountId: "00000000-0000-0000-0000-000000000003",
      sourceAccountId: "00000000-0000-0000-0000-000000000004",
      amount: "50.00",
      frequency: "weekly",
    }));
    expect(result.ok).toBe(false);
    expect(result.message).toBe("The selected source account is not visible in Cash Flow.");
    expect(result.message).not.toContain("Goal plan source account");
  });

  it("does not leak raw database errors to the client", async () => {
    mocks.goalPlanRepository.savePlan.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint "financial_goal_plans_owner_series_idx"'));
    const result = await saveGoalPlanAction(initialGoalActionState, formData({
      goalId: "00000000-0000-0000-0000-000000000002",
      accountId: "00000000-0000-0000-0000-000000000003",
      sourceAccountId: "00000000-0000-0000-0000-000000000004",
      amount: "50.00",
      frequency: "weekly",
    }));
    expect(result.ok).toBe(false);
    expect(result.message).toBe("That Cash Flow transfer is already linked to another goal plan.");
    expect(result.message).not.toContain("duplicate key");
    expect(result.message).not.toContain("financial_goal_plans_owner_series_idx");
  });
});
