import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  budgetRepository: {
    createBudget: vi.fn(),
    updateBudget: vi.fn(),
    archiveBudget: vi.fn(),
    restoreBudget: vi.fn(),
    createExpense: vi.fn(),
    updateExpense: vi.fn(),
    moveExpense: vi.fn(),
    setExpenseArchived: vi.fn(),
  },
  mutationRepository: {
    upsertYearOverride: vi.fn(),
    moveRemainingToNext: vi.fn(),
    createPayment: vi.fn(),
    updatePayment: vi.fn(),
    deletePayment: vi.fn(),
  },
  revalidatePath: vi.fn(),
  owner: vi.fn(async () => ({ id: "00000000-0000-0000-0000-000000000001" })),
  getServerDatabase: vi.fn(() => ({})),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@athena/database", () => ({
  createAnnualBudgetRepository: vi.fn(() => mocks.budgetRepository),
  createAnnualBudgetMutationRepository: vi.fn(() => mocks.mutationRepository),
}));
vi.mock("../../lib/server/owner-database", () => ({
  withWritableAuthenticatedDatabase: async (callback: (database: unknown, user: { readonly owner: { readonly id: string }; readonly authUserId: string; readonly session: { readonly id: string } }) => unknown) => callback(mocks.getServerDatabase(), { owner: await mocks.owner(), authUserId: "auth-user", session: { id: "session" } }),
}));
vi.mock("../../lib/server/database", () => ({ getServerDatabase: mocks.getServerDatabase }));

import {
  archiveAnnualBudgetAction,
  archiveAnnualExpenseAction,
  createAnnualBudgetAction,
  createAnnualExpenseAction,
  moveAnnualExpenseAction,
  moveAnnualExpenseRemainderAction,
  mutateAnnualExpensePaymentAction,
  restoreAnnualBudgetAction,
  saveAnnualExpenseYearOverrideAction,
  updateAnnualBudgetAction,
} from "./actions";
import { initialAnnualExpenseActionState, repositoryErrorActionState, shouldCloseSuccessfulUpdate } from "./action-helpers";

const budgetId = "00000000-0000-0000-0000-000000000010";
const otherBudgetId = "00000000-0000-0000-0000-000000000011";
const expenseId = "00000000-0000-0000-0000-000000000020";
const occurrenceId = "00000000-0000-0000-0000-000000000021";
const paymentId = "00000000-0000-0000-0000-000000000022";

function formData(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

describe("annual expense server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.budgetRepository.createBudget.mockResolvedValue(budgetId);
    mocks.budgetRepository.updateBudget.mockResolvedValue(undefined);
    mocks.budgetRepository.archiveBudget.mockResolvedValue(undefined);
    mocks.budgetRepository.restoreBudget.mockResolvedValue(undefined);
    mocks.budgetRepository.createExpense.mockResolvedValue(expenseId);
    mocks.budgetRepository.updateExpense.mockResolvedValue(undefined);
    mocks.budgetRepository.moveExpense.mockResolvedValue(undefined);
    mocks.budgetRepository.setExpenseArchived.mockResolvedValue(undefined);
    mocks.mutationRepository.upsertYearOverride.mockResolvedValue(occurrenceId);
    mocks.mutationRepository.moveRemainingToNext.mockResolvedValue({ targetDueDate: "2026-10-01", targetTaxYear: 2026, amountMovedMinor: 5_000 });
    mocks.mutationRepository.createPayment.mockResolvedValue(paymentId);
    mocks.mutationRepository.updatePayment.mockResolvedValue(undefined);
    mocks.mutationRepository.deletePayment.mockResolvedValue(undefined);
  });

  it("validates template fields before touching the repository", async () => {
    const result = await createAnnualExpenseAction(initialAnnualExpenseActionState, new FormData());
    expect(result).toMatchObject({ ok: false, message: "Review the highlighted fields." });
    expect(result.fieldErrors.name).toBe("Annual expense name is required.");
    expect(mocks.budgetRepository.createExpense).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("creates and updates budgets with the authenticated owner and revalidates both dependent pages", async () => {
    const created = await createAnnualBudgetAction(initialAnnualExpenseActionState, formData({ name: "  Travel reserve  ", linkedAccountId: budgetId, ownerId: "another-owner" }));
    expect(created).toEqual({ ok: true, message: "Annual budget created.", fieldErrors: {} });
    expect(mocks.budgetRepository.createBudget).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", { name: "Travel reserve", linkedAccountId: budgetId });

    const updated = await updateAnnualBudgetAction(initialAnnualExpenseActionState, formData({ id: budgetId, name: "Travel reserve renamed", linkedAccountId: otherBudgetId }));
    expect(updated).toEqual({ ok: true, message: "Annual budget updated.", fieldErrors: {} });
    expect(mocks.budgetRepository.updateBudget).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", budgetId, { name: "Travel reserve renamed", linkedAccountId: otherBudgetId });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/annual-expenses");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/accounts");
  });

  it("requires confirmation for budget archive and restore actions", async () => {
    const archiveResult = await archiveAnnualBudgetAction(initialAnnualExpenseActionState, formData({ id: budgetId, confirm: "false" }));
    const restoreResult = await restoreAnnualBudgetAction(initialAnnualExpenseActionState, formData({ id: budgetId, linkedAccountId: otherBudgetId, confirm: "false" }));
    expect(archiveResult.fieldErrors.confirm).toBe("Confirm the annual budget archive.");
    expect(restoreResult.fieldErrors.confirm).toBe("Confirm the annual budget restore.");
    expect(mocks.budgetRepository.archiveBudget).not.toHaveBeenCalled();
    expect(mocks.budgetRepository.restoreBudget).not.toHaveBeenCalled();
  });

  it("maps active-name and active-account conflicts without exposing repository details", () => {
    expect(repositoryErrorActionState(new Error("Annual budget name is already in use.")).message).toBe("An active annual budget with this name already exists.");
    expect(repositoryErrorActionState(new Error("Annual budget linked account is already assigned to another active budget.")).message).toBe("That account already funds another active budget.");
  });

  it("uses the server owner and converts CAD amounts for template creation", async () => {
    const result = await createAnnualExpenseAction(initialAnnualExpenseActionState, formData({
      ownerId: "another-owner",
      budgetId,
      taxYear: "2026",
      name: "  Insurance  ",
      amount: "125.50",
      dueMonth: "2",
      dueDay: "31",
    }));
    expect(result).toEqual({ ok: true, message: "Annual expense added.", fieldErrors: {} });
    expect(mocks.budgetRepository.createExpense).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", {
      budgetId,
      taxYear: 2026,
      name: "Insurance",
      amountMinor: 12550,
      dueMonth: 2,
      dueDay: 31,
      isActive: true,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/annual-expenses");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/accounts");
  });

  it("supports current-year and future-scope overrides with bounded dates", async () => {
    await saveAnnualExpenseYearOverrideAction(initialAnnualExpenseActionState, formData({
      annualExpenseId: expenseId,
      taxYear: "2026",
      budgetId: otherBudgetId,
      plannedAmount: "80.00",
      dueDate: "2026-04-30",
      note: "Renewal",
      scope: "this_and_future",
    }));
    expect(mocks.mutationRepository.upsertYearOverride).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", {
      annualExpenseId: expenseId,
      taxYear: 2026,
      budgetId: otherBudgetId,
      plannedAmountMinor: 8000,
      dueDate: "2026-04-30",
      note: "Renewal",
      scope: "this_and_future",
    });
  });

  it("requires confirmation for movement and archive actions", async () => {
    const moveResult = await moveAnnualExpenseAction(initialAnnualExpenseActionState, formData({ annualExpenseId: expenseId, targetBudgetId: otherBudgetId, fromYear: "2026", confirm: "false" }));
    const remainderResult = await moveAnnualExpenseRemainderAction(initialAnnualExpenseActionState, formData({ annualExpenseId: expenseId, taxYear: "2026", confirm: "false" }));
    const archiveResult = await archiveAnnualExpenseAction(initialAnnualExpenseActionState, formData({ annualExpenseId: expenseId, archived: "true", confirm: "false" }));
    expect(moveResult.fieldErrors.confirm).toBe("Confirm the budget move.");
    expect(remainderResult.fieldErrors.confirm).toBe("Confirm moving the annual-expense remainder.");
    expect(archiveResult.fieldErrors.confirm).toBe("Confirm the archive change.");
    expect(mocks.budgetRepository.moveExpense).not.toHaveBeenCalled();
    expect(mocks.mutationRepository.moveRemainingToNext).not.toHaveBeenCalled();
    expect(mocks.budgetRepository.setExpenseArchived).not.toHaveBeenCalled();
  });

  it("moves a remainder with the authenticated owner and revalidates dependent pages", async () => {
    const result = await moveAnnualExpenseRemainderAction(initialAnnualExpenseActionState, formData({
      annualExpenseId: expenseId,
      taxYear: "2026",
      confirm: "true",
      ownerId: "another-owner",
    }));
    expect(result).toEqual({ ok: true, message: "Annual expense remainder moved to the next matching expense on 2026-10-01.", fieldErrors: {} });
    expect(mocks.mutationRepository.moveRemainingToNext).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", { annualExpenseId: expenseId, taxYear: 2026 });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/annual-expenses");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/accounts");
  });

  it("creates, edits, and removes payment entries only after validation", async () => {
    await mutateAnnualExpensePaymentAction(initialAnnualExpenseActionState, formData({ mode: "create", annualExpenseValueId: occurrenceId, paymentOn: "2026-04-01", amount: "20.00", note: "First", confirm: "true" }));
    expect(mocks.mutationRepository.createPayment).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", { annualExpenseValueId: occurrenceId, paymentOn: "2026-04-01", amountMinor: 2000, note: "First" });
    await mutateAnnualExpensePaymentAction(initialAnnualExpenseActionState, formData({ mode: "update", paymentId, annualExpenseValueId: occurrenceId, paymentOn: "2026-04-02", amount: "25.00", note: "Updated", confirm: "true" }));
    expect(mocks.mutationRepository.updatePayment).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", paymentId, { id: paymentId, annualExpenseValueId: occurrenceId, paymentOn: "2026-04-02", amountMinor: 2500, note: "Updated" });
    await mutateAnnualExpensePaymentAction(initialAnnualExpenseActionState, formData({ mode: "delete", paymentId, confirm: "true" }));
    expect(mocks.mutationRepository.deletePayment).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", paymentId);
    const invalid = await mutateAnnualExpensePaymentAction(initialAnnualExpenseActionState, formData({ mode: "create", annualExpenseValueId: occurrenceId, paymentOn: "2026-04-01", amount: "0", confirm: "true" }));
    expect(invalid.ok).toBe(false);
    expect(mocks.mutationRepository.createPayment).toHaveBeenCalledTimes(1);
  });

  it("does not expose repository details in action errors", () => {
    expect(repositoryErrorActionState(new Error("Failed query: DATABASE_URL=secret")).message)
      .toBe("We couldn't save the annual-expense change. Try again.");
  });

  it("closes a template modal only for a fresh successful update result", () => {
    const successful = { ok: true, message: "Annual expense updated.", fieldErrors: {} };
    const failed = { ok: false, message: "Review the highlighted fields.", fieldErrors: { name: "Name is required." } };
    expect(shouldCloseSuccessfulUpdate(successful, successful, false, true)).toBe(false);
    expect(shouldCloseSuccessfulUpdate(successful, { ...successful }, true, true)).toBe(false);
    expect(shouldCloseSuccessfulUpdate(successful, failed, false, true)).toBe(false);
    expect(shouldCloseSuccessfulUpdate(successful, { ...successful }, false, true)).toBe(true);
  });
});
