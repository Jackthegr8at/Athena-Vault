import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  repository: {
    createAccount: vi.fn(),
    updateAccount: vi.fn(),
    updateAvailableCash: vi.fn(),
    updateCashFlowPlannedTimeline: vi.fn(),
    archiveAccount: vi.fn(),
    restoreAccount: vi.fn(),
    deleteAccount: vi.fn(),
    upsertBalanceSnapshot: vi.fn(),
    updateAccountBalanceNote: vi.fn(),
    confirmPeriod: vi.fn(),
    reorderAccounts: vi.fn(),
    recalculateAccountProjections: vi.fn(),
    recalculateAllAccountProjections: vi.fn(),
  },
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  owner: vi.fn(async () => ({ id: "00000000-0000-0000-0000-000000000001" })),
  getServerDatabase: vi.fn(() => ({})),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@athena/database", () => ({
  createAccountTimelineRepository: vi.fn(() => mocks.repository),
  toTorontoDateIso: vi.fn(() => "2026-08-05"),
}));
vi.mock("../../lib/server/owner-database", () => ({
  withWritableAuthenticatedDatabase: async (callback: (database: unknown, user: { readonly owner: { readonly id: string }; readonly authUserId: string; readonly session: { readonly id: string } }) => unknown) => callback(mocks.getServerDatabase(), { owner: await mocks.owner(), authUserId: "auth-user", session: { id: "session" } }),
}));
vi.mock("../../lib/server/database", () => ({ getServerDatabase: mocks.getServerDatabase }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import {
  confirmPeriodAction,
  createAccountAction,
  deleteAccountAction,
  recalculateProjectionsAction,
  reorderAccountsAction,
  updateAccountAction,
  updateAccountAvailableCashAction,
  updateAccountCashFlowPlannedTimelineAction,
  upsertBalanceSnapshotAction,
  updateAccountBalanceNoteAction,
} from "./actions";
import { initialAccountActionState } from "./action-helpers";

function formData(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

describe("account server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.repository.createAccount.mockResolvedValue({ id: "account" });
    mocks.repository.updateAvailableCash.mockResolvedValue({ id: "account", includeInAvailableCash: true });
    mocks.repository.updateCashFlowPlannedTimeline.mockResolvedValue({ id: "account", useCashFlowPlannedTimeline: true });
    mocks.repository.upsertBalanceSnapshot.mockResolvedValue({ id: "snapshot" });
    mocks.repository.confirmPeriod.mockResolvedValue({ updatedCount: 1 });
    mocks.repository.recalculateAccountProjections.mockResolvedValue({ accountCount: 1, snapshotsCreated: 2, snapshotsUpdated: 1 });
    mocks.repository.recalculateAllAccountProjections.mockResolvedValue({ accountCount: 2, snapshotsCreated: 3, snapshotsUpdated: 4 });
    mocks.repository.reorderAccounts.mockResolvedValue({ section: "other:reserve", accountIds: ["00000000-0000-0000-0000-000000000002"] });
  });

  it("returns field errors for invalid account input", async () => {
    const result = await createAccountAction(initialAccountActionState, formData({ name: " ", institutionName: "CIBC", kind: "checking" }));
    expect(result.ok).toBe(false);
    expect(result.fieldErrors.name).toBe("Account name is required.");
    expect(mocks.repository.createAccount).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("ignores client owner fields and defaults a future initial snapshot to Projected", async () => {
    await createAccountAction(initialAccountActionState, formData({
      ownerId: "another-owner",
      name: "Reserve",
      institutionName: "CIBC",
      kind: "cash",
      lastFour: "4242",
      initialBalance: "10.00",
      initialBalanceDate: "2026-08-19",
    }));
    expect(mocks.repository.createAccount).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", expect.objectContaining({
      name: "Reserve",
      lastFour: "4242",
      initialSnapshot: { asOf: "2026-08-19", balanceMinor: 1000, status: "planned" },
    }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/accounts");
  });

  it("accepts and normalizes an alphanumeric REEI/RDSP account identifier", async () => {
    const result = await createAccountAction(initialAccountActionState, formData({
      name: "Disability savings",
      institutionName: "CIBC",
      kind: "rdsp",
      lastFour: "a1b2",
    }));

    expect(result.ok).toBe(true);
    expect(mocks.repository.createAccount).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", expect.objectContaining({
      kind: "rdsp",
      lastFour: "A1B2",
    }));
  });

  it("keeps alphabetic account identifiers invalid for non-REEI accounts", async () => {
    const result = await createAccountAction(initialAccountActionState, formData({
      name: "Chequing",
      institutionName: "CIBC",
      kind: "checking",
      lastFour: "a1b2",
    }));

    expect(result.ok).toBe(false);
    expect(result.fieldErrors.lastFour).toBe("Enter exactly four digits.");
    expect(mocks.repository.createAccount).not.toHaveBeenCalled();
  });

  it("treats a blank optional opening amount as no snapshot even when the date is prefilled", async () => {
    const result = await createAccountAction(initialAccountActionState, formData({
      name: "Reserve",
      institutionName: "CIBC",
      kind: "cash",
      initialBalance: "",
      initialBalanceDate: "2026-08-05",
    }));

    expect(result.ok).toBe(true);
    expect(mocks.repository.createAccount).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", expect.objectContaining({ initialSnapshot: undefined }));
  });

  it("preserves an entered zero opening balance as a real snapshot", async () => {
    const result = await createAccountAction(initialAccountActionState, formData({
      name: "Zero reserve",
      institutionName: "CIBC",
      kind: "cash",
      initialBalance: "0.00",
      initialBalanceDate: "2026-08-05",
    }));

    expect(result.ok).toBe(true);
    expect(mocks.repository.createAccount).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", expect.objectContaining({
      initialSnapshot: { asOf: "2026-08-05", balanceMinor: 0, status: "actual" },
    }));
  });

  it("routes the first main account to first-income setup", async () => {
    mocks.repository.createAccount.mockResolvedValueOnce({ id: "account", isMainAccount: true });

    await createAccountAction(initialAccountActionState, formData({
      name: "Main account",
      institutionName: "CIBC",
      kind: "checking",
    }));

    expect(mocks.redirect).toHaveBeenCalledWith("/cash-flow/recurring?first=1");
  });

  it("updates and clears the optional account last four", async () => {
    await updateAccountAction(initialAccountActionState, formData({ id: "00000000-0000-0000-0000-000000000002", name: "Reserve", institutionName: "CIBC", kind: "cash", lastFour: "7713" }));
    expect(mocks.repository.updateAccount).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002", {
      name: "Reserve",
      institutionName: "CIBC",
      kind: "cash",
      customTypeLabel: null,
      lastFour: "7713",
    });
    await updateAccountAction(initialAccountActionState, formData({ id: "00000000-0000-0000-0000-000000000002", name: "Reserve", institutionName: "CIBC", kind: "cash", lastFour: "" }));
    expect(mocks.repository.updateAccount).toHaveBeenLastCalledWith("00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002", {
      name: "Reserve",
      institutionName: "CIBC",
      kind: "cash",
      customTypeLabel: null,
      lastFour: null,
    });
  });

  it("defaults a past balance edit to Actual and hides repository details", async () => {
    mocks.repository.upsertBalanceSnapshot.mockRejectedValueOnce(new Error("duplicate key; DATABASE_URL=secret"));
    const result = await upsertBalanceSnapshotAction(initialAccountActionState, formData({
      ownerId: "another-owner",
      accountId: "00000000-0000-0000-0000-000000000002",
      asOf: "2026-08-05",
      balance: "-12.34",
    }));
    expect(result).toEqual({ ok: false, message: "We couldn't save the account change. Try again.", fieldErrors: {} });
    expect(mocks.repository.upsertBalanceSnapshot).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002", {
      asOf: "2026-08-05",
      balanceMinor: -1234,
      status: "actual",
      note: null,
    });
    expect(result.message).not.toContain("secret");
  });

  it("confirms a current or historical period through the owner-scoped repository", async () => {
    const result = await confirmPeriodAction(initialAccountActionState, formData({
      ownerId: "another-owner",
      asOf: "2026-08-05",
    }));
    expect(result).toEqual({ ok: true, message: "Selected period marked as Confirmed.", fieldErrors: {} });
    expect(mocks.repository.confirmPeriod).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", "2026-08-05");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/accounts");
  });

  it("surfaces the safe repository rejection for a tampered future confirmation", async () => {
    mocks.repository.confirmPeriod.mockRejectedValueOnce(new Error("Future pay periods must remain Projected."));
    const result = await confirmPeriodAction(initialAccountActionState, formData({ asOf: "2026-08-19" }));
    expect(result).toEqual({ ok: false, message: "Future pay periods must remain Projected.", fieldErrors: {} });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("surfaces the same future-status rejection for a forged balance upsert", async () => {
    mocks.repository.upsertBalanceSnapshot.mockRejectedValueOnce(new Error("Future pay periods must remain Projected."));
    const result = await upsertBalanceSnapshotAction(initialAccountActionState, formData({
      accountId: "00000000-0000-0000-0000-000000000002",
      asOf: "2026-08-19",
      balance: "10.00",
      status: "actual",
    }));
    expect(result).toEqual({ ok: false, message: "Future pay periods must remain Projected.", fieldErrors: {} });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("saves an account/payday note through the owner-scoped repository", async () => {
    const result = await updateAccountBalanceNoteAction(initialAccountActionState, formData({
      accountId: "00000000-0000-0000-0000-000000000002",
      asOf: "2026-08-05",
      note: "Temporary overdraft while rent cleared",
    }));
    expect(result).toEqual({ ok: true, message: "Period note saved.", fieldErrors: {} });
    expect(mocks.repository.updateAccountBalanceNote).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", {
      accountId: "00000000-0000-0000-0000-000000000002",
      asOf: "2026-08-05",
      note: "Temporary overdraft while rent cleared",
    });
  });

  it("updates available-cash inclusion with the server owner and without metadata fields", async () => {
    const accountId = "00000000-0000-0000-0000-000000000002";
    const result = await updateAccountAvailableCashAction(initialAccountActionState, formData({
      ownerId: "another-owner",
      accountId,
      includeInAvailableCash: "true",
    }));
    expect(result).toEqual({ ok: true, message: "Available-cash setting saved.", fieldErrors: {} });
    expect(mocks.repository.updateAvailableCash).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", accountId, true);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/accounts");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/cash-flow");
  });

  it("treats an unchecked availability control as false", async () => {
    const accountId = "00000000-0000-0000-0000-000000000003";
    await updateAccountAvailableCashAction(initialAccountActionState, formData({ accountId }));
    expect(mocks.repository.updateAvailableCash).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", accountId, false);
  });

  it("updates cash-flow planned timeline opt-in with the server owner", async () => {
    const accountId = "00000000-0000-0000-0000-000000000002";
    const result = await updateAccountCashFlowPlannedTimelineAction(initialAccountActionState, formData({
      ownerId: "another-owner",
      accountId,
      useCashFlowPlannedTimeline: "true",
    }));
    expect(result).toEqual({
      ok: true,
      message: "Cash Flow planned timeline enabled for this account.",
      fieldErrors: {},
    });
    expect(mocks.repository.updateCashFlowPlannedTimeline).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", accountId, true);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/accounts");
  });

  it("treats an unchecked cash-flow planned timeline control as false", async () => {
    const accountId = "00000000-0000-0000-0000-000000000003";
    const result = await updateAccountCashFlowPlannedTimelineAction(initialAccountActionState, formData({ accountId }));
    expect(result.message).toContain("contribution rules");
    expect(mocks.repository.updateCashFlowPlannedTimeline).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", accountId, false);
  });

  it("recalculates only the selected account with the server owner", async () => {
    const result = await recalculateProjectionsAction(initialAccountActionState, formData({
      accountId: "00000000-0000-0000-0000-000000000002",
      scope: "account",
    }));
    expect(result).toEqual({ ok: true, message: "Recalculated this account: 2 created, 1 updated.", fieldErrors: {} });
    expect(mocks.repository.recalculateAccountProjections).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002");
    expect(mocks.repository.recalculateAllAccountProjections).not.toHaveBeenCalled();
  });

  it("supports the all-account projection scope", async () => {
    const result = await recalculateProjectionsAction(initialAccountActionState, formData({
      accountId: "00000000-0000-0000-0000-000000000002",
      scope: "all",
    }));
    expect(result.message).toBe("Recalculated all accounts: 3 created, 4 updated.");
    expect(mocks.repository.recalculateAllAccountProjections).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001");
    expect(mocks.repository.recalculateAccountProjections).not.toHaveBeenCalled();
  });

  it("persists a validated section-local account order with the server owner", async () => {
    const result = await reorderAccountsAction(initialAccountActionState, formData({
      section: "other:reserve",
      accountIds: JSON.stringify(["00000000-0000-0000-0000-000000000002"]),
    }));
    expect(result).toEqual({ ok: true, message: "Account order saved.", fieldErrors: {} });
    expect(mocks.repository.reorderAccounts).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000001",
      "other:reserve",
      ["00000000-0000-0000-0000-000000000002"],
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/accounts");
  });

  it("rejects malformed reorder payloads before touching the repository", async () => {
    const result = await reorderAccountsAction(initialAccountActionState, formData({ section: "other:reserve", accountIds: "not-json" }));
    expect(result.ok).toBe(false);
    expect(mocks.repository.reorderAccounts).not.toHaveBeenCalled();
  });

  it("deletes an account with the server owner and revalidates paths", async () => {
    mocks.repository.deleteAccount.mockResolvedValue(undefined);
    const accountId = "00000000-0000-0000-0000-000000000002";
    const result = await deleteAccountAction(initialAccountActionState, formData({
      ownerId: "another-owner",
      id: accountId,
    }));
    expect(result).toEqual({ ok: true, message: "Account permanently deleted.", fieldErrors: {} });
    expect(mocks.repository.deleteAccount).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", accountId);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/accounts");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/cash-flow");
  });

  it("surfaces delete blocking errors from the repository", async () => {
    mocks.repository.deleteAccount.mockRejectedValueOnce(
      new Error("Cannot delete this account while transfers still reference it. Remove or reassign those transfers first."),
    );
    const result = await deleteAccountAction(initialAccountActionState, formData({
      id: "00000000-0000-0000-0000-000000000002",
    }));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("transfers still reference it");
  });
});
