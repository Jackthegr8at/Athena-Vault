import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  repository: {
    createYear: vi.fn(),
    createFinalizedYear: vi.fn(),
    updateYear: vi.fn(),
    deleteYear: vi.fn(),
    createSnapshot: vi.fn(),
    updateSnapshot: vi.fn(),
    deleteSnapshot: vi.fn(),
    upsertRrqYearLimits: vi.fn(),
    finalizeYear: vi.fn(),
    updateFinalFederal: vi.fn(),
    reopenYear: vi.fn(),
  },
  owner: vi.fn(async () => ({ id: "00000000-0000-0000-0000-000000000001" })),
  getServerDatabase: vi.fn(() => ({})),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@athena/database", () => ({ createSalaryTrackingRepository: vi.fn(() => mocks.repository) }));
vi.mock("../../lib/server/owner-database", () => ({
  withWritableAuthenticatedDatabase: async (callback: (database: unknown, user: { readonly owner: { readonly id: string }; readonly authUserId: string; readonly session: { readonly id: string } }) => unknown) => callback(mocks.getServerDatabase(), { owner: await mocks.owner(), authUserId: "auth-user", session: { id: "session" } }),
}));
vi.mock("../../lib/server/database", () => ({ getServerDatabase: mocks.getServerDatabase }));

import {
  createFinalizedSalaryYearAction,
  createSalarySnapshotAction,
  createSalaryYearAction,
  deleteSalarySnapshotAction,
  deleteSalaryYearAction,
  finalizeSalaryYearAction,
  reopenSalaryYearAction,
  updateFinalFederalSalaryYearAction,
  updateRrqYearLimitsAction,
  updateSalarySnapshotAction,
  updateSalaryYearAction,
} from "./actions";
import { initialSalaryActionState, repositoryErrorActionState } from "./action-helpers";

const yearId = "00000000-0000-0000-0000-000000000010";
const snapshotId = "00000000-0000-0000-0000-000000000011";

function formData(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

describe("salary server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const method of Object.values(mocks.repository)) method.mockResolvedValue(undefined);
  });

  it("validates before touching the repository and uses the authenticated owner", async () => {
    const invalid = await createSalarySnapshotAction(initialSalaryActionState, new FormData());
    expect(invalid).toMatchObject({ ok: false, message: "Review the highlighted fields." });
    expect(mocks.repository.createSnapshot).not.toHaveBeenCalled();

    await createSalaryYearAction(initialSalaryActionState, formData({ taxYear: "2026", annualBase: "82 502,00", payPeriodsPerYearOverride: "26", note: "" }));
    expect(mocks.repository.createYear).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", {
      taxYear: 2026,
      annualBaseMinor: 8_250_200,
      payPeriodsPerYearOverride: 26,
      note: null,
    });
  });

  it("creates and updates snapshots with fixed-point values", async () => {
    await createSalarySnapshotAction(initialSalaryActionState, formData({
      salaryYearId: yearId,
      snapshotOn: "2026-08-05",
      federalCumulative: "65,587.10",
      provincialCumulative: "67 153,59",
      rrqContributionYtd: "3,650.00",
      completedPayNumberOverride: "16",
      note: "Pay stub",
    }));
    expect(mocks.repository.createSnapshot).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", yearId, {
      snapshotOn: "2026-08-05", federalCumulativeMinor: 6_558_710, provincialCumulativeMinor: 6_715_359, rrqContributionYtdMinor: 365_000, completedPayNumberOverride: 16, note: "Pay stub",
    });

    await updateSalarySnapshotAction(initialSalaryActionState, formData({ snapshotId, salaryYearId: yearId, snapshotOn: "2026-08-19", federalCumulative: "70,000.00", provincialCumulative: "71,000.00", rrqContributionYtd: "3,179.00", completedPayNumberOverride: "", note: "" }));
    expect(mocks.repository.updateSnapshot).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", snapshotId, {
      snapshotOn: "2026-08-19", federalCumulativeMinor: 7_000_000, provincialCumulativeMinor: 7_100_000, rrqContributionYtdMinor: 317_900, completedPayNumberOverride: null, note: null,
    });
  });

  it("preserves RRQ when an update request omits the optional field", async () => {
    await updateSalarySnapshotAction(initialSalaryActionState, formData({ snapshotId, salaryYearId: yearId, snapshotOn: "2026-08-19", federalCumulative: "70,000.00", provincialCumulative: "71,000.00", completedPayNumberOverride: "", note: "" }));
    expect(mocks.repository.updateSnapshot).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", snapshotId, {
      snapshotOn: "2026-08-19", federalCumulativeMinor: 7_000_000, provincialCumulativeMinor: 7_100_000, completedPayNumberOverride: null, note: null,
    });
  });

  it("updates RRQ yearly limits through the authenticated owner", async () => {
    await updateRrqYearLimitsAction(initialSalaryActionState, formData({ taxYear: "2026", firstMaximum: "4,479.30", additionalMaximum: "416.00", ympe: "74,600.00", yampe: "85,000.00", firstRate: "6.30", additionalRate: "4.00" }));
    expect(mocks.repository.upsertRrqYearLimits).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", {
      taxYear: 2026,
      firstMaximumMinor: 447_930,
      additionalMaximumMinor: 41_600,
      ympeMinor: 7_460_000,
      yampeMinor: 8_500_000,
      firstRateBps: 630,
      additionalRateBps: 400,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/salaries");

    const invalid = await updateRrqYearLimitsAction(initialSalaryActionState, formData({ taxYear: "2026", firstMaximum: "4,479.30", additionalMaximum: "416.00", ympe: "85,000.00", yampe: "74,600.00", firstRate: "6.30", additionalRate: "4.00" }));
    expect(invalid.fieldErrors.yampe).toBe("YAMPE must be at least YMPE.");
    expect(mocks.repository.upsertRrqYearLimits).toHaveBeenCalledOnce();
  });

  it("creates a missing historical year directly as finalized income", async () => {
    const result = await createFinalizedSalaryYearAction(initialSalaryActionState, formData({
      taxYear: "2024",
      finalFederal: "80 099,25",
      note: "Official federal",
    }));
    expect(result).toMatchObject({ ok: true, message: "Finalized federal income saved." });
    expect(mocks.repository.createFinalizedYear).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", {
      taxYear: 2024,
      finalFederalMinor: 8_009_925,
      note: "Official federal",
    });
  });

  it("requires explicit confirmation for deletion, finalization, and reopening", async () => {
    expect((await deleteSalaryYearAction(initialSalaryActionState, formData({ salaryYearId: yearId, confirm: "false" }))).fieldErrors.confirm).toBe("Confirm deleting this salary year.");
    expect((await deleteSalarySnapshotAction(initialSalaryActionState, formData({ snapshotId, confirm: "false" }))).fieldErrors.confirm).toBe("Confirm deleting this salary snapshot.");
    expect((await finalizeSalaryYearAction(initialSalaryActionState, formData({ salaryYearId: yearId, confirm: "false" }))).fieldErrors.confirm).toBe("Confirm finalizing this salary year.");
    expect((await reopenSalaryYearAction(initialSalaryActionState, formData({ salaryYearId: yearId, confirm: "false" }))).fieldErrors.confirm).toBe("Confirm reopening this salary year.");
    expect(mocks.repository.deleteYear).not.toHaveBeenCalled();
    expect(mocks.repository.finalizeYear).not.toHaveBeenCalled();
  });

  it("requires and forwards an editable fixed-point official amount during finalization", async () => {
    const invalid = await finalizeSalaryYearAction(initialSalaryActionState, formData({ salaryYearId: yearId, confirm: "true" }));
    expect(invalid.fieldErrors.finalFederal).toBeDefined();
    expect(mocks.repository.finalizeYear).not.toHaveBeenCalled();

    await finalizeSalaryYearAction(initialSalaryActionState, formData({ salaryYearId: yearId, finalFederal: "70 500,25", confirm: "true" }));
    expect(mocks.repository.finalizeYear).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", yearId, 7_050_025);

    await updateFinalFederalSalaryYearAction(initialSalaryActionState, formData({ salaryYearId: yearId, finalFederal: "70,600.75" }));
    expect(mocks.repository.updateFinalFederal).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", yearId, 7_060_075);
  });

  it("runs lifecycle actions through the authenticated owner and hides repository details", async () => {
    await updateSalaryYearAction(initialSalaryActionState, formData({ salaryYearId: yearId, taxYear: "2026", annualBase: "82,502.00", payPeriodsPerYearOverride: "26", note: "Updated" }));
    await deleteSalaryYearAction(initialSalaryActionState, formData({ salaryYearId: yearId, confirm: "true" }));
    await deleteSalarySnapshotAction(initialSalaryActionState, formData({ snapshotId, confirm: "true" }));
    await finalizeSalaryYearAction(initialSalaryActionState, formData({ salaryYearId: yearId, finalFederal: "70,000.00", confirm: "true" }));
    await updateFinalFederalSalaryYearAction(initialSalaryActionState, formData({ salaryYearId: yearId, finalFederal: "70,100.00" }));
    await reopenSalaryYearAction(initialSalaryActionState, formData({ salaryYearId: yearId, confirm: "true" }));
    expect(mocks.repository.updateYear).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", yearId, { annualBaseMinor: 8_250_200, payPeriodsPerYearOverride: 26, note: "Updated" });
    expect(mocks.repository.deleteYear).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", yearId);
    expect(mocks.repository.finalizeYear).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", yearId, 7_000_000);
    expect(mocks.repository.updateFinalFederal).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", yearId, 7_010_000);
    expect(repositoryErrorActionState(new Error("DATABASE_URL=secret")).message).toBe("We couldn't save the salary change. Try again.");
  });
});
