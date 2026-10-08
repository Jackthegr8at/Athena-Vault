import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  repository: {
    createRecurringSeries: vi.fn(),
    createInitialCashFlowIncome: vi.fn(),
    changeRecurringSeriesVersion: vi.fn(),
    updateRecurringSeriesVersion: vi.fn(),
    renameRecurringSeries: vi.fn(),
    updateRecurringSeriesEntirely: vi.fn(),
    setRecurringSeriesState: vi.fn(),
    endRecurringSeries: vi.fn(),
    deleteRecurringSeries: vi.fn(),
    deleteRecurringSeriesVersion: vi.fn(),
    generateRecurringOccurrences: vi.fn(),
    applyRecurringOccurrenceException: vi.fn(),
    updateRecurringOverrideGroup: vi.fn(),
    restoreRecurringOccurrence: vi.fn(),
  },
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  owner: vi.fn(async () => ({ id: "00000000-0000-0000-0000-000000000001" })),
  getServerDatabase: vi.fn(() => ({})),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@athena/database", async () => {
  const actual = await vi.importActual<typeof import("@athena/database")>("@athena/database");
  return { ...actual, createCashFlowRepository: vi.fn(() => mocks.repository) };
});
vi.mock("../../lib/server/owner-database", () => ({
  withWritableAuthenticatedDatabase: async (callback: (database: unknown, user: { readonly owner: { readonly id: string }; readonly authUserId: string; readonly session: { readonly id: string } }) => unknown) => callback(mocks.getServerDatabase(), { owner: await mocks.owner(), authUserId: "auth-user", session: { id: "session" } }),
}));
vi.mock("../../lib/server/database", () => ({ getServerDatabase: mocks.getServerDatabase }));

import { applyRecurringOccurrenceExceptionAction, changeRecurringSeriesVersionAction, createInitialCashFlowIncomeAction, createRecurringSeriesAction, deleteRecurringSeriesAction, deleteRecurringSeriesVersionAction, editRecurringSeriesVersionAction, generateRecurringOccurrencesAction, renameRecurringSeriesAction, restoreRecurringOccurrenceAction, updateRecurringSeriesEntirelyAction } from "./recurring-actions";
import { initialCashFlowActionState } from "./action-helpers";

function formData(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

describe("recurring Cash Flow server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.repository.createRecurringSeries.mockResolvedValue({ id: "00000000-0000-0000-0000-000000000010" });
    mocks.repository.createInitialCashFlowIncome.mockResolvedValue({ periodsCreated: 27, generatedCount: 27, seriesId: "00000000-0000-0000-0000-000000000010", accountId: "00000000-0000-0000-0000-000000000002" });
    mocks.repository.deleteRecurringSeries.mockResolvedValue({ transactionCount: 3, transferCount: 1, sourceReferenceCount: 0 });
    mocks.repository.deleteRecurringSeriesVersion.mockResolvedValue({ seriesId: "00000000-0000-0000-0000-000000000010", versionId: "00000000-0000-0000-0000-000000000011", transactionCount: 1, transferCount: 1, sourceReferenceCount: 0 });
    mocks.repository.generateRecurringOccurrences.mockResolvedValue({ insertedCount: 3, updatedCount: 2, preservedCount: 1 });
    mocks.repository.applyRecurringOccurrenceException.mockResolvedValue({ exceptionIds: ["00000000-0000-0000-0000-000000000020"] });
    mocks.repository.restoreRecurringOccurrence.mockResolvedValue({ insertedCount: 0, updatedCount: 1 });
    mocks.repository.changeRecurringSeriesVersion.mockResolvedValue({ id: "00000000-0000-0000-0000-000000000010" });
    mocks.repository.updateRecurringSeriesVersion.mockResolvedValue({ id: "00000000-0000-0000-0000-000000000010" });
    mocks.repository.renameRecurringSeries.mockResolvedValue({ seriesId: "00000000-0000-0000-0000-000000000010", oldNames: ["Beneva ioniq 5"], newName: "Beneva renouvelée", versionIds: ["00000000-0000-0000-0000-000000000011"], transactionIds: [], transferIds: [] });
    mocks.repository.updateRecurringSeriesEntirely.mockResolvedValue({ id: "00000000-0000-0000-0000-000000000010" });
  });

  it("derives the first and next occurrence from the single creation start date", async () => {
    const result = await createRecurringSeriesAction(initialCashFlowActionState, formData({
      name: "Paycheque",
      kind: "income",
      accountId: "00000000-0000-0000-0000-000000000002",
      amount: "123.45",
      frequency: "",
      startsOn: "2026-08-12",
      nextOccurrenceOn: "2026-08-26",
      endsOn: "",
      note: "Salary",
    }));
    expect(result).toEqual({ ok: true, message: "Recurring Cash Flow series added." });
    expect(mocks.repository.createRecurringSeries).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", expect.objectContaining({ amountMinor: 12345, frequency: "biweekly", startsOn: "2026-08-12", nextOccurrenceOn: "2026-08-12", endsOn: null }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/cash-flow");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/cash-flow/recurring");
  });

  it("derives the next occurrence from a weekday-adjusted first occurrence", async () => {
    const result = await createRecurringSeriesAction(initialCashFlowActionState, formData({
      name: "Monthly expense",
      kind: "expense",
      accountId: "00000000-0000-0000-0000-000000000002",
      amount: "50.00",
      frequency: "monthly",
      weekdayAdjustment: "previous_weekday",
      startsOn: "2026-08-15",
      endsOn: "",
      note: "",
    }));
    expect(result).toEqual({ ok: true, message: "Recurring Cash Flow series added." });
    expect(mocks.repository.createRecurringSeries).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", expect.objectContaining({ startsOn: "2026-08-15", nextOccurrenceOn: "2026-08-14", weekdayAdjustment: "previous_weekday" }));
  });

  it("persists the first income, revalidates affected routes, then redirects server-side", async () => {
    await createInitialCashFlowIncomeAction(initialCashFlowActionState, formData({
      name: "Paycheque",
      accountId: "00000000-0000-0000-0000-000000000002",
      amount: "1850.50",
      frequency: "",
      startsOn: "2026-08-19",
      throughDate: "2027-08-18",
      note: "Main income",
    }));

    expect(mocks.repository.createInitialCashFlowIncome).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", {
      accountId: "00000000-0000-0000-0000-000000000002",
      name: "Paycheque",
      amountMinor: 185050,
      frequency: "biweekly",
      startsOn: "2026-08-19",
      throughDate: "2027-08-18",
      note: "Main income",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/cash-flow");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/cash-flow/recurring");
    expect(mocks.redirect).toHaveBeenCalledWith("/cash-flow");
    const persistenceOrder = mocks.repository.createInitialCashFlowIncome.mock.invocationCallOrder[0]!;
    const lastRevalidationOrder = mocks.revalidatePath.mock.invocationCallOrder.at(-1)!;
    const redirectOrder = mocks.redirect.mock.invocationCallOrder[0]!;
    expect(persistenceOrder).toBeLessThan(lastRevalidationOrder);
    expect(lastRevalidationOrder).toBeLessThan(redirectOrder);
  });

  it("rejects invalid dates before repository access", async () => {
    const result = await createRecurringSeriesAction(initialCashFlowActionState, formData({ name: "Bad", kind: "expense", accountId: "", amount: "1.00", frequency: "monthly", startsOn: "2026-02-30", nextOccurrenceOn: "2026-02-30", endsOn: "", note: "" }));
    expect(result.ok).toBe(false);
    expect(mocks.repository.createRecurringSeries).not.toHaveBeenCalled();
  });

  it("derives the new schedule anchor from one start date and preserves the explicit old ending", async () => {
    const result = await changeRecurringSeriesVersionAction(initialCashFlowActionState, formData({
      seriesId: "00000000-0000-0000-0000-000000000010",
      name: "Beneva ioniq 5",
      kind: "expense",
      accountId: "00000000-0000-0000-0000-000000000002",
      fromAccountId: "",
      toAccountId: "",
      amount: "78.16",
      frequency: "biweekly",
      weekdayAdjustment: "none",
      previousEndsOn: "2026-08-19",
      newScheduleStartsOn: "2026-08-28",
      endsOn: "",
      note: "",
      versionNote: "Moved payment date",
    }));

    expect(result).toEqual({ ok: true, message: "This and future recurring terms saved as a new version." });
    expect(mocks.repository.changeRecurringSeriesVersion).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", expect.objectContaining({
      previousEndsOn: "2026-08-19",
      effectiveFrom: "2026-08-28",
      startsOn: "2026-08-28",
      nextOccurrenceOn: "2026-08-28",
      amountMinor: 7816,
    }));
  });

  it("derives the effective version occurrence from a weekday-adjusted start date", async () => {
    const result = await changeRecurringSeriesVersionAction(initialCashFlowActionState, formData({
      seriesId: "00000000-0000-0000-0000-000000000010",
      name: "Monthly expense",
      kind: "expense",
      accountId: "00000000-0000-0000-0000-000000000002",
      fromAccountId: "",
      toAccountId: "",
      amount: "28.20",
      frequency: "monthly",
      weekdayAdjustment: "next_weekday",
      previousEndsOn: "2026-10-15",
      newScheduleStartsOn: "2026-11-15",
      endsOn: "",
      note: "",
      versionNote: "Moved payment date",
    }));

    expect(result).toEqual({ ok: true, message: "This and future recurring terms saved as a new version." });
    expect(mocks.repository.changeRecurringSeriesVersion).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", expect.objectContaining({
      startsOn: "2026-11-15",
      effectiveFrom: "2026-11-16",
      nextOccurrenceOn: "2026-11-16",
      weekdayAdjustment: "next_weekday",
    }));
  });

  it("edits a saved recurring history version in place with its selected dates", async () => {
    const result = await editRecurringSeriesVersionAction(initialCashFlowActionState, formData({
      seriesId: "00000000-0000-0000-0000-000000000010",
      versionId: "00000000-0000-0000-0000-000000000011",
      name: "Beneva ioniq 5 corrected",
      kind: "expense",
      accountId: "00000000-0000-0000-0000-000000000002",
      fromAccountId: "",
      toAccountId: "",
      amount: "79.16",
      frequency: "biweekly",
      weekdayAdjustment: "none",
      startsOn: "2026-08-12",
      endsOn: "2026-08-26",
      versionNote: "Corrected historical amount",
      confirm: "true",
    }));

    expect(result).toEqual({ ok: true, message: "Recurring history version updated; protected occurrences were left unchanged." });
    expect(mocks.repository.updateRecurringSeriesVersion).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000010", "00000000-0000-0000-0000-000000000011", expect.objectContaining({
      amountMinor: 7916,
      startsOn: "2026-08-12",
      endsOn: "2026-08-26",
      note: "Corrected historical amount",
    }));
  });

  it("rejects recurring history edits without explicit confirmation", async () => {
    const result = await editRecurringSeriesVersionAction(initialCashFlowActionState, formData({
      seriesId: "00000000-0000-0000-0000-000000000010",
      versionId: "00000000-0000-0000-0000-000000000011",
      name: "Beneva ioniq 5",
      kind: "expense",
      accountId: "00000000-0000-0000-0000-000000000002",
      amount: "79.16",
      frequency: "biweekly",
      weekdayAdjustment: "none",
      startsOn: "2026-08-12",
      endsOn: "2026-08-26",
      versionNote: "",
      confirm: "false",
    }));

    expect(result.ok).toBe(false);
    expect(mocks.repository.updateRecurringSeriesVersion).not.toHaveBeenCalled();
  });

  it("renames a full recurring series through the owner-scoped repository action", async () => {
    const result = await renameRecurringSeriesAction(initialCashFlowActionState, formData({
      seriesId: "00000000-0000-0000-0000-000000000010",
      name: "  Beneva renouvelée  ",
      confirm: "true",
    }));

    expect(result).toEqual({ ok: true, message: "Recurring Cash Flow series renamed." });
    expect(mocks.repository.renameRecurringSeries).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000010", "Beneva renouvelée");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/cash-flow/recurring");
  });

  it("rejects an invalid full-series rename before repository access", async () => {
    const result = await renameRecurringSeriesAction(initialCashFlowActionState, formData({
      seriesId: "00000000-0000-0000-0000-000000000010",
      name: "   ",
      confirm: "true",
    }));

    expect(result.ok).toBe(false);
    expect(mocks.repository.renameRecurringSeries).not.toHaveBeenCalled();
  });

  it("passes a selected range exception with integer override amount", async () => {
    const result = await applyRecurringOccurrenceExceptionAction(initialCashFlowActionState, formData({
      seriesId: "00000000-0000-0000-0000-000000000010",
      versionId: "00000000-0000-0000-0000-000000000011",
      transactionId: "00000000-0000-0000-0000-000000000012",
      scheduledOccurrenceOn: "2026-08-14",
      scope: "selected_range",
      endingOccurrenceOn: "2026-09-18",
      kind: "override",
      dateOverride: "",
      amountOverride: "10.50",
      accountOverrideId: "00000000-0000-0000-0000-000000000002",
      statusOverride: "planned",
      note: "Temporary range",
    }));
    expect(result).toEqual({ ok: true, message: "1 occurrence exception saved." });
    expect(mocks.repository.applyRecurringOccurrenceException).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", expect.objectContaining({ transactionId: "00000000-0000-0000-0000-000000000012", amountOverrideMinor: 1050, scope: "selected_range", endingOccurrenceOn: "2026-09-18" }));
  });

  it("derives the explicit selected-range ending occurrence from the submitted option", async () => {
    await applyRecurringOccurrenceExceptionAction(initialCashFlowActionState, formData({
      seriesId: "00000000-0000-0000-0000-000000000010",
      versionId: "00000000-0000-0000-0000-000000000011",
      transactionId: "00000000-0000-0000-0000-000000000012",
      scheduledOccurrenceOn: "2026-08-14",
      scope: "selected_range:2026-10-09",
      kind: "skip",
      note: "Selected range",
    }));
    expect(mocks.repository.applyRecurringOccurrenceException).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", expect.objectContaining({ scope: "selected_range", endingOccurrenceOn: "2026-10-09", kind: "skip" }));
  });

  it("keeps generated transfer edits in the recurring exception path", async () => {
    await applyRecurringOccurrenceExceptionAction(initialCashFlowActionState, formData({
      seriesId: "00000000-0000-0000-0000-000000000010",
      versionId: "00000000-0000-0000-0000-000000000011",
      transferId: "00000000-0000-0000-0000-000000000013",
      fromAccountOverrideId: "00000000-0000-0000-0000-000000000002",
      toAccountOverrideId: "00000000-0000-0000-0000-000000000003",
      scheduledOccurrenceOn: "2026-08-14",
      scope: "only_this_occurrence",
      kind: "override",
      dateOverride: "",
      amountOverride: "10.50",
      accountOverrideId: "",
      statusOverride: "planned",
      note: "Transfer exception",
    }));
    expect(mocks.repository.applyRecurringOccurrenceException).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", expect.objectContaining({ transferId: "00000000-0000-0000-0000-000000000013", fromAccountOverrideId: "00000000-0000-0000-0000-000000000002", toAccountOverrideId: "00000000-0000-0000-0000-000000000003" }));
  });

  it("keeps skip submissions free of stale override fields and uses the exception scope", async () => {
    await applyRecurringOccurrenceExceptionAction(initialCashFlowActionState, formData({
      seriesId: "00000000-0000-0000-0000-000000000010",
      versionId: "00000000-0000-0000-0000-000000000011",
      transactionId: "00000000-0000-0000-0000-000000000012",
      scheduledOccurrenceOn: "2026-08-14",
      scope: "only_this_occurrence",
      restoreScope: "occurrence",
      endingOccurrenceOn: "",
      kind: "skip",
      dateOverride: "2026-08-15",
      amountOverride: "10.50",
      accountOverrideId: "00000000-0000-0000-0000-000000000002",
      statusOverride: "planned",
      note: "Skip this date",
    }));
    expect(mocks.repository.applyRecurringOccurrenceException).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", expect.objectContaining({ scope: "only_this_occurrence", kind: "skip", dateOverride: null, amountOverrideMinor: null, accountOverrideId: null, statusOverride: null }));
  });

  it("reports generated and preserved counts from regeneration", async () => {
    const result = await generateRecurringOccurrencesAction(initialCashFlowActionState, formData({ seriesId: "00000000-0000-0000-0000-000000000010", throughDate: "2026-12-31" }));
    expect(result).toEqual({ ok: true, message: "Regenerated 5 planned occurrences; preserved 1." });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/accounts");
  });

  it("saves the full series and regenerates projected Cash Flow rows automatically", async () => {
    const result = await updateRecurringSeriesEntirelyAction(initialCashFlowActionState, formData({
      seriesId: "00000000-0000-0000-0000-000000000010",
      name: "AI (Leonardo)",
      kind: "expense",
      accountId: "00000000-0000-0000-0000-000000000002",
      amount: "19.50",
      frequency: "monthly",
      weekdayAdjustment: "none",
      startsOn: "2026-08-20",
      endsOn: "",
      note: "",
      countsAsExpense: "false",
      confirm: "true",
    }));

    expect(result).toEqual({ ok: true, message: "Entire series saved and projected Cash Flow rows regenerated." });
    expect(mocks.repository.updateRecurringSeriesEntirely).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000010", expect.objectContaining({ amountMinor: 1950, startsOn: "2026-08-20" }));
    expect(mocks.repository.updateRecurringSeriesEntirely.mock.calls[0]?.[2]).not.toHaveProperty("nextOccurrenceOn");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/cash-flow");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/cash-flow/recurring");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/accounts");
  });

  it("deletes a recurring series only after explicit confirmation", async () => {
    const result = await deleteRecurringSeriesAction(initialCashFlowActionState, formData({ seriesId: "00000000-0000-0000-0000-000000000010", confirm: "true" }));
    expect(result).toEqual({ ok: true, message: "Recurring series deleted with 4 linked Cash Flow rows." });
    expect(mocks.repository.deleteRecurringSeries).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000010");
  });

  it("rejects recurring series deletion without explicit confirmation", async () => {
    const result = await deleteRecurringSeriesAction(initialCashFlowActionState, formData({ seriesId: "00000000-0000-0000-0000-000000000010", confirm: "false" }));
    expect(result.ok).toBe(false);
    expect(mocks.repository.deleteRecurringSeries).not.toHaveBeenCalled();
  });

  it("deletes a recurring version only after explicit confirmation", async () => {
    const result = await deleteRecurringSeriesVersionAction(initialCashFlowActionState, formData({ seriesId: "00000000-0000-0000-0000-000000000010", versionId: "00000000-0000-0000-0000-000000000011", confirm: "true" }));
    expect(result).toEqual({ ok: true, message: "Recurring version deleted with 2 linked Cash Flow rows." });
    expect(mocks.repository.deleteRecurringSeriesVersion).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000010", "00000000-0000-0000-0000-000000000011");
  });

  it("rejects recurring version deletion without explicit confirmation", async () => {
    const result = await deleteRecurringSeriesVersionAction(initialCashFlowActionState, formData({ seriesId: "00000000-0000-0000-0000-000000000010", versionId: "00000000-0000-0000-0000-000000000011", confirm: "false" }));
    expect(result.ok).toBe(false);
    expect(mocks.repository.deleteRecurringSeriesVersion).not.toHaveBeenCalled();
  });

  it("requires an explicit restore scope and occurrence ID", async () => {
    const result = await restoreRecurringOccurrenceAction(initialCashFlowActionState, formData({ seriesId: "00000000-0000-0000-0000-000000000010", occurrenceId: "", overrideGroupId: "", scope: "occurrence", confirm: "false" }));
    expect(result.ok).toBe(false);
    expect(mocks.repository.restoreRecurringOccurrence).not.toHaveBeenCalled();
  });

  it("uses the hidden occurrence restore scope when the shared editor form submits", async () => {
    const result = await restoreRecurringOccurrenceAction(initialCashFlowActionState, formData({
      seriesId: "00000000-0000-0000-0000-000000000010",
      occurrenceId: "00000000-0000-0000-0000-000000000012",
      overrideGroupId: "",
      scope: "only_this_occurrence",
      restoreScope: "occurrence",
      confirm: "true",
    }));
    expect(result.ok).toBe(true);
    expect(mocks.repository.restoreRecurringOccurrence).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", expect.objectContaining({ scope: "occurrence" }));
  });
});
