import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  repository: {
    createCashFlowTransaction: vi.fn(),
    createInitialTimeline: vi.fn(),
    excludeExpenseTransaction: vi.fn(),
    listExcludedExpenses: vi.fn(),
    restoreExpenseTransaction: vi.fn(),
    setCashFlowAccountVisibility: vi.fn(),
    updateTransaction: vi.fn(),
    updateTransfer: vi.fn(),
    updateIncomeTransaction: vi.fn(),
    recordCashFlowPaydayBalance: vi.fn(),
    updateCashFlowPaydayNote: vi.fn(),
    resetCashFlowPaydayBalance: vi.fn(),
  },
  revalidatePath: vi.fn(),
  owner: vi.fn(async () => ({ id: "00000000-0000-0000-0000-000000000001" })),
  getServerDatabase: vi.fn(() => ({})),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@athena/database", () => ({ createCashFlowRepository: vi.fn(() => mocks.repository) }));
vi.mock("../../lib/server/owner-database", () => ({
  withWritableAuthenticatedDatabase: async (callback: (database: unknown, user: { readonly owner: { readonly id: string }; readonly authUserId: string; readonly session: { readonly id: string } }) => unknown) => callback(mocks.getServerDatabase(), { owner: await mocks.owner(), authUserId: "auth-user", session: { id: "session" } }),
}));
vi.mock("../../lib/server/database", () => ({ getServerDatabase: mocks.getServerDatabase }));

import { createCashFlowTransactionAction, createInitialCashFlowTimelineAction, excludeCashFlowExpenseAction, recordCashFlowPaydayBalanceAction, resetCashFlowPaydayBalanceAction, restoreCashFlowExpenseAction, toggleCashFlowAccountVisibilityAction, updateCashFlowPaydayNoteAction, updateCashFlowRecordAction, updateIncomeTransactionAction } from "./actions";
import { focusIfConnected, initialCashFlowActionState, shouldCloseSuccessfulAction } from "./action-helpers";

function formData(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

describe("cash-flow server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.repository.createCashFlowTransaction.mockResolvedValue(undefined);
    mocks.repository.createInitialTimeline.mockResolvedValue({ throughDate: "2026-12-31", periodsCreated: 10, snapshotsCreated: 0 });
    mocks.repository.excludeExpenseTransaction.mockResolvedValue(undefined);
    mocks.repository.restoreExpenseTransaction.mockResolvedValue(undefined);
    mocks.repository.setCashFlowAccountVisibility.mockResolvedValue(undefined);
    mocks.repository.updateTransaction.mockResolvedValue(undefined);
    mocks.repository.updateTransfer.mockResolvedValue(undefined);
    mocks.repository.updateIncomeTransaction.mockResolvedValue(undefined);
    mocks.repository.recordCashFlowPaydayBalance.mockResolvedValue({ id: "snapshot" });
    mocks.repository.updateCashFlowPaydayNote.mockResolvedValue({ id: "note" });
    mocks.repository.resetCashFlowPaydayBalance.mockResolvedValue(undefined);
  });

  it("records an observed payday balance in minor units and revalidates account views", async () => {
    const result = await recordCashFlowPaydayBalanceAction(initialCashFlowActionState, formData({
      accountId: "00000000-0000-0000-0000-000000000002",
      asOf: "2026-08-05",
      balance: "2150.00",
      note: "Rent cleared later than expected",
    }));
    expect(result).toEqual({ ok: true, message: "Observed payday balance saved." });
    expect(mocks.repository.recordCashFlowPaydayBalance).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", {
      accountId: "00000000-0000-0000-0000-000000000002",
      asOf: "2026-08-05",
      balanceMinor: 215000,
      note: "Rent cleared later than expected",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/cash-flow");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/accounts");
  });

  it("saves an account/payday note through the owner-scoped repository", async () => {
    const result = await updateCashFlowPaydayNoteAction(initialCashFlowActionState, formData({
      accountId: "00000000-0000-0000-0000-000000000002",
      asOf: "2026-08-05",
      note: "Temporary overdraft while rent cleared",
    }));
    expect(result).toEqual({ ok: true, message: "Period note saved." });
    expect(mocks.repository.updateCashFlowPaydayNote).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", {
      accountId: "00000000-0000-0000-0000-000000000002",
      asOf: "2026-08-05",
      note: "Temporary overdraft while rent cleared",
    });
  });

  it("resets an observed payday balance through the owner-scoped repository", async () => {
    const result = await resetCashFlowPaydayBalanceAction(initialCashFlowActionState, formData({
      accountId: "00000000-0000-0000-0000-000000000002",
      asOf: "2026-08-05",
    }));
    expect(result).toEqual({ ok: true, message: "Observed payday balance reset." });
    expect(mocks.repository.resetCashFlowPaydayBalance).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", {
      accountId: "00000000-0000-0000-0000-000000000002",
      asOf: "2026-08-05",
    });
  });

  it("creates a planned transaction for the selected account and period", async () => {
    const result = await createCashFlowTransactionAction(initialCashFlowActionState, formData({
      periodId: "00000000-0000-0000-0000-000000000010",
      accountId: "00000000-0000-0000-0000-000000000002",
      kind: "expense",
      transactionDate: "2026-08-12",
      description: "One-off expense",
      amount: "25.50",
    }));
    expect(result).toEqual({ ok: true, message: "Transaction added to this period." });
    expect(mocks.repository.createCashFlowTransaction).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", {
      periodId: "00000000-0000-0000-0000-000000000010",
      accountId: "00000000-0000-0000-0000-000000000002",
      kind: "expense",
      transactionDate: "2026-08-12",
      description: "One-off expense",
      amountMinor: 2550,
    });
  });

  it("creates the initial owner timeline and revalidates the Cash Flow routes", async () => {
    const result = await createInitialCashFlowTimelineAction(initialCashFlowActionState, formData({
      firstPayday: "2026-08-19",
      throughDate: "2026-12-31",
    }));
    expect(result).toEqual({ ok: true, message: "10 pay periods are ready. Add recurring income next." });
    expect(mocks.repository.createInitialTimeline).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", {
      firstPayday: "2026-08-19",
      throughDate: "2026-12-31",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/cash-flow");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/cash-flow/recurring");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/accounts");
  });

  it("rejects an invalid initial timeline before reaching the repository", async () => {
    const result = await createInitialCashFlowTimelineAction(initialCashFlowActionState, formData({
      firstPayday: "2026-12-31",
      throughDate: "2026-08-19",
    }));
    expect(result).toEqual({ ok: false, message: "Timeline end date must be on or after the first payday." });
    expect(mocks.repository.createInitialTimeline).not.toHaveBeenCalled();
  });

  it("persists Cash Flow account visibility and revalidates the page", async () => {
    await toggleCashFlowAccountVisibilityAction(formData({
      accountId: "00000000-0000-0000-0000-000000000002",
      isVisibleInCashFlow: "false",
    }));
    expect(mocks.repository.setCashFlowAccountVisibility).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002", false);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/cash-flow");
  });

  it("rejects an invalid Cash Flow account visibility request", async () => {
    await expect(toggleCashFlowAccountVisibilityAction(formData({ accountId: "not-an-id", isVisibleInCashFlow: "false" }))).rejects.toThrow("Account ID is invalid.");
    expect(mocks.repository.setCashFlowAccountVisibility).not.toHaveBeenCalled();
  });

  it("requires confirmation before deleting an expense", async () => {
    const result = await excludeCashFlowExpenseAction(initialCashFlowActionState, formData({ id: "00000000-0000-0000-0000-000000000001" }));
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Invalid literal value, expected true");
  });

  it("restores only after explicit confirmation and revalidates the owner views", async () => {
    const id = "00000000-0000-0000-0000-000000000001";
    const invalid = await restoreCashFlowExpenseAction(initialCashFlowActionState, formData({ id, confirm: "false" }));
    expect(invalid.ok).toBe(false);
    expect(mocks.repository.restoreExpenseTransaction).not.toHaveBeenCalled();

    const result = await restoreCashFlowExpenseAction(initialCashFlowActionState, formData({ id, confirm: "true" }));
    expect(result).toEqual({ ok: true, message: "Expense restored to this period." });
    expect(mocks.repository.restoreExpenseTransaction).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", id);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/cash-flow");
  });

  it("validates the income transaction id and amount before writing", async () => {
    const result = await updateIncomeTransactionAction(initialCashFlowActionState, new FormData());
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Cash-flow transaction ID is invalid.");
  });

  it("validates editable transaction records before writing", async () => {
    const result = await updateCashFlowRecordAction(initialCashFlowActionState, formData({
      recordKind: "transaction",
      id: "00000000-0000-0000-0000-000000000001",
      recordDate: "2026-08-05",
      description: "",
      amount: "10.00",
      status: "actual",
    }));
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Description is required.");
  });

  it("updates income and expense records with current or linked-future scope", async () => {
    const recurringId = "00000000-0000-0000-0000-000000000010";
    for (const kind of ["income", "expense"] as const) {
      const result = await updateCashFlowRecordAction(initialCashFlowActionState, formData({
        recordKind: kind,
        id: `00000000-0000-0000-0000-00000000000${kind === "income" ? "2" : "3"}`,
        accountId: "00000000-0000-0000-0000-000000000004",
        recurringTransactionId: recurringId,
        recordDate: "2026-08-05",
        description: `${kind} update`,
        category: kind === "expense" ? "Household" : "",
        amount: "10.50",
        status: "planned",
        scope: "this_and_future",
      }));
      expect(result).toEqual({ ok: true, message: "Cash-flow record saved." });
    }
    expect(mocks.repository.updateTransaction).toHaveBeenNthCalledWith(1, "00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002", {
      accountId: "00000000-0000-0000-0000-000000000004",
      recurringTransactionId: recurringId,
      transactionDate: "2026-08-05",
      description: "income update",
      category: null,
      amountMinor: 1050,
      status: "planned",
      scope: "this_and_future",
    });
    expect(mocks.repository.updateTransaction).toHaveBeenNthCalledWith(2, "00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000003", expect.objectContaining({ description: "expense update", category: "Household", scope: "this_and_future" }));
  });

  it("requires distinct account selections for transfer edits", async () => {
    const result = await updateCashFlowRecordAction(initialCashFlowActionState, formData({
      recordKind: "transfer",
      id: "00000000-0000-0000-0000-000000000001",
      fromAccountId: "00000000-0000-0000-0000-000000000002",
      toAccountId: "00000000-0000-0000-0000-000000000002",
      recordDate: "2026-08-05",
      description: "Transfer",
      amount: "10.00",
      status: "planned",
    }));
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Choose two different accounts.");
  });

  it("updates transfers through the transfer repository path and returns a fresh success state", async () => {
    const result = await updateCashFlowRecordAction(initialCashFlowActionState, formData({
      recordKind: "transfer",
      id: "00000000-0000-0000-0000-000000000005",
      fromAccountId: "00000000-0000-0000-0000-000000000002",
      toAccountId: "00000000-0000-0000-0000-000000000003",
      recordDate: "2026-08-05",
      description: "Transfer update",
      amount: "10.00",
      status: "actual",
    }));
    expect(result).toEqual({ ok: true, message: "Cash-flow record saved." });
    expect(result).not.toBe(initialCashFlowActionState);
    expect(mocks.repository.updateTransfer).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000005", {
      fromAccountId: "00000000-0000-0000-0000-000000000002",
      toAccountId: "00000000-0000-0000-0000-000000000003",
      transferDate: "2026-08-05",
      description: "Transfer update",
      amountMinor: 1000,
      status: "actual",
    });
  });

  it("only treats a new successful action result as modal-close eligible", () => {
    const successful = { ok: true, message: "Cash-flow record saved." };
    const failed = { ok: false, message: "Review the record details." };
    expect(shouldCloseSuccessfulAction(successful, successful, false, true)).toBe(false);
    expect(shouldCloseSuccessfulAction(successful, { ...successful }, true, true)).toBe(false);
    expect(shouldCloseSuccessfulAction(successful, failed, false, true)).toBe(false);
    expect(shouldCloseSuccessfulAction(successful, { ...successful }, false, true)).toBe(true);
  });

  it("does not focus a detached record trigger after exclusion success", () => {
    const focus = vi.fn();
    focusIfConnected({ isConnected: false, focus });
    expect(focus).not.toHaveBeenCalled();
    focusIfConnected({ isConnected: true, focus });
    expect(focus).toHaveBeenCalledOnce();
  });

  it("rejects negative income amounts", async () => {
    const formData = new FormData();
    formData.set("id", "00000000-0000-0000-0000-000000000001");
    formData.set("amount", "-1.00");
    const result = await updateIncomeTransactionAction(initialCashFlowActionState, formData);
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Income amount cannot be negative.");
  });
});
