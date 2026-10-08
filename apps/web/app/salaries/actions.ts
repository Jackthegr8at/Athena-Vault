"use server";

import { revalidatePath } from "next/cache";
import {
  rrqYearLimitInputSchema,
  salaryFinalizedYearCreateInputSchema,
  salarySnapshotCreateInputSchema,
  salarySnapshotIdSchema,
  salarySnapshotUpdateInputSchema,
  salaryFinalizationInputSchema,
  salaryYearCreateInputSchema,
  salaryYearIdSchema,
  salaryYearUpdateInputSchema,
} from "@athena/validation";
import { createSalaryTrackingRepository } from "@athena/database";
import { withWritableAuthenticatedDatabase } from "../../lib/server/owner-database";
import {
  emptyToNull,
  formDataBoolean,
  formDataText,
  repositoryErrorActionState,
  validationActionState,
  type SalaryActionState,
} from "./action-helpers";

function successState(message: string): SalaryActionState {
  return { ok: true, message, fieldErrors: {} };
}

async function withSalaryRepository<T>(callback: (repository: ReturnType<typeof createSalaryTrackingRepository>, ownerId: string) => Promise<T>): Promise<T> {
  return withWritableAuthenticatedDatabase((database, user) => callback(createSalaryTrackingRepository(database), user.owner.id), { requireTwoFactor: true });
}

function yearData(formData: FormData) {
  return {
    taxYear: formDataText(formData, "taxYear"),
    annualBase: emptyToNull(formDataText(formData, "annualBase")),
    payPeriodsPerYearOverride: emptyToNull(formDataText(formData, "payPeriodsPerYearOverride")),
    note: emptyToNull(formDataText(formData, "note")),
  };
}

function snapshotData(formData: FormData) {
  return {
    id: emptyToNull(formDataText(formData, "snapshotId")),
    salaryYearId: formDataText(formData, "salaryYearId"),
    snapshotOn: formDataText(formData, "snapshotOn"),
    federalCumulative: formDataText(formData, "federalCumulative"),
    provincialCumulative: formDataText(formData, "provincialCumulative"),
    rrqContributionYtd: formData.has("rrqContributionYtd") ? emptyToNull(formDataText(formData, "rrqContributionYtd")) : undefined,
    completedPayNumberOverride: emptyToNull(formDataText(formData, "completedPayNumberOverride")),
    note: emptyToNull(formDataText(formData, "note")),
  };
}

function rrqYearLimitData(formData: FormData) {
  return {
    taxYear: formDataText(formData, "taxYear"),
    firstMaximum: formDataText(formData, "firstMaximum"),
    additionalMaximum: formDataText(formData, "additionalMaximum"),
    ympe: formDataText(formData, "ympe"),
    yampe: formDataText(formData, "yampe"),
    firstRate: formDataText(formData, "firstRate"),
    additionalRate: formDataText(formData, "additionalRate"),
  };
}

export async function createSalaryYearAction(_previousState: SalaryActionState, formData: FormData): Promise<SalaryActionState> {
  const parsed = salaryYearCreateInputSchema.safeParse(yearData(formData));
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withSalaryRepository((repository, ownerId) => repository.createYear(ownerId, {
      taxYear: parsed.data.taxYear,
      annualBaseMinor: parsed.data.annualBase,
      payPeriodsPerYearOverride: parsed.data.payPeriodsPerYearOverride,
      note: parsed.data.note,
    }));
    return successState("Salary year created.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function createFinalizedSalaryYearAction(_previousState: SalaryActionState, formData: FormData): Promise<SalaryActionState> {
  const parsed = salaryFinalizedYearCreateInputSchema.safeParse({
    taxYear: formDataText(formData, "taxYear"),
    finalFederal: formDataText(formData, "finalFederal"),
    note: emptyToNull(formDataText(formData, "note")),
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withSalaryRepository((repository, ownerId) => repository.createFinalizedYear(ownerId, {
      taxYear: parsed.data.taxYear,
      finalFederalMinor: parsed.data.finalFederal,
      note: parsed.data.note,
    }));
    return successState("Finalized federal income saved.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function updateSalaryYearAction(_previousState: SalaryActionState, formData: FormData): Promise<SalaryActionState> {
  const id = salaryYearIdSchema.safeParse(formDataText(formData, "salaryYearId"));
  const parsed = salaryYearUpdateInputSchema.safeParse(yearData(formData));
  if (!id.success || !parsed.success) return validationActionState([
    ...(id.success ? [] : id.error.issues.map((issue) => ({ ...issue, path: ["salaryYearId", ...issue.path] }))),
    ...(parsed.success ? [] : parsed.error.issues),
  ]);
  try {
    await withSalaryRepository((repository, ownerId) => repository.updateYear(ownerId, id.data, {
      annualBaseMinor: parsed.data.annualBase,
      payPeriodsPerYearOverride: parsed.data.payPeriodsPerYearOverride,
      note: parsed.data.note,
    }));
    return successState("Salary year updated.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function deleteSalaryYearAction(_previousState: SalaryActionState, formData: FormData): Promise<SalaryActionState> {
  const parsed = salaryYearIdSchema.safeParse(formDataText(formData, "salaryYearId"));
  const confirm = formDataBoolean(formData, "confirm");
  if (!parsed.success || !confirm) return validationActionState([
    ...(parsed.success ? [] : parsed.error.issues.map((issue) => ({ ...issue, path: ["salaryYearId", ...issue.path] }))),
    ...(confirm ? [] : [{ path: ["confirm"], message: "Confirm deleting this salary year." }]),
  ]);
  try {
    await withSalaryRepository((repository, ownerId) => repository.deleteYear(ownerId, parsed.data));
    return successState("Salary year and its snapshots were deleted.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function createSalarySnapshotAction(_previousState: SalaryActionState, formData: FormData): Promise<SalaryActionState> {
  const parsed = salarySnapshotCreateInputSchema.safeParse(snapshotData(formData));
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withSalaryRepository((repository, ownerId) => repository.createSnapshot(ownerId, parsed.data.salaryYearId, {
      snapshotOn: parsed.data.snapshotOn,
      federalCumulativeMinor: parsed.data.federalCumulative,
      provincialCumulativeMinor: parsed.data.provincialCumulative,
      ...(parsed.data.rrqContributionYtd === undefined ? {} : { rrqContributionYtdMinor: parsed.data.rrqContributionYtd }),
      completedPayNumberOverride: parsed.data.completedPayNumberOverride,
      note: parsed.data.note,
    }));
    return successState("Salary snapshot saved.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function updateSalarySnapshotAction(_previousState: SalaryActionState, formData: FormData): Promise<SalaryActionState> {
  const parsed = salarySnapshotUpdateInputSchema.safeParse(snapshotData(formData));
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withSalaryRepository((repository, ownerId) => repository.updateSnapshot(ownerId, parsed.data.id, {
      snapshotOn: parsed.data.snapshotOn,
      federalCumulativeMinor: parsed.data.federalCumulative,
      provincialCumulativeMinor: parsed.data.provincialCumulative,
      ...(parsed.data.rrqContributionYtd === undefined ? {} : { rrqContributionYtdMinor: parsed.data.rrqContributionYtd }),
      completedPayNumberOverride: parsed.data.completedPayNumberOverride,
      note: parsed.data.note,
    }));
    return successState("Salary snapshot updated.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function updateRrqYearLimitsAction(_previousState: SalaryActionState, formData: FormData): Promise<SalaryActionState> {
  const parsed = rrqYearLimitInputSchema.safeParse(rrqYearLimitData(formData));
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withSalaryRepository((repository, ownerId) => repository.upsertRrqYearLimits(ownerId, {
      taxYear: parsed.data.taxYear,
      firstMaximumMinor: parsed.data.firstMaximum,
      additionalMaximumMinor: parsed.data.additionalMaximum,
      ympeMinor: parsed.data.ympe,
      yampeMinor: parsed.data.yampe,
      firstRateBps: parsed.data.firstRate,
      additionalRateBps: parsed.data.additionalRate,
    }));
    revalidatePath("/salaries");
    return successState("RRQ yearly limits updated.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function deleteSalarySnapshotAction(_previousState: SalaryActionState, formData: FormData): Promise<SalaryActionState> {
  const parsed = salarySnapshotIdSchema.safeParse(formDataText(formData, "snapshotId"));
  const confirm = formDataBoolean(formData, "confirm");
  if (!parsed.success || !confirm) return validationActionState([
    ...(parsed.success ? [] : parsed.error.issues.map((issue) => ({ ...issue, path: ["snapshotId", ...issue.path] }))),
    ...(confirm ? [] : [{ path: ["confirm"], message: "Confirm deleting this salary snapshot." }]),
  ]);
  try {
    await withSalaryRepository((repository, ownerId) => repository.deleteSnapshot(ownerId, parsed.data));
    return successState("Salary snapshot deleted.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function finalizeSalaryYearAction(_previousState: SalaryActionState, formData: FormData): Promise<SalaryActionState> {
  const parsed = salaryFinalizationInputSchema.safeParse({
    salaryYearId: formDataText(formData, "salaryYearId"),
    finalFederal: formDataText(formData, "finalFederal"),
  });
  const confirm = formDataBoolean(formData, "confirm");
  if (!parsed.success || !confirm) return validationActionState([
    ...(parsed.success ? [] : parsed.error.issues),
    ...(confirm ? [] : [{ path: ["confirm"], message: "Confirm finalizing this salary year." }]),
  ]);
  try {
    await withSalaryRepository((repository, ownerId) => repository.finalizeYear(ownerId, parsed.data.salaryYearId, parsed.data.finalFederal));
    return successState("Salary year finalized from the latest federal snapshot.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function updateFinalFederalSalaryYearAction(_previousState: SalaryActionState, formData: FormData): Promise<SalaryActionState> {
  const parsed = salaryFinalizationInputSchema.safeParse({
    salaryYearId: formDataText(formData, "salaryYearId"),
    finalFederal: formDataText(formData, "finalFederal"),
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withSalaryRepository((repository, ownerId) => repository.updateFinalFederal(ownerId, parsed.data.salaryYearId, parsed.data.finalFederal));
    return successState("Final federal amount updated.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function reopenSalaryYearAction(_previousState: SalaryActionState, formData: FormData): Promise<SalaryActionState> {
  const parsed = salaryYearIdSchema.safeParse(formDataText(formData, "salaryYearId"));
  const confirm = formDataBoolean(formData, "confirm");
  if (!parsed.success || !confirm) return validationActionState([
    ...(parsed.success ? [] : parsed.error.issues.map((issue) => ({ ...issue, path: ["salaryYearId", ...issue.path] }))),
    ...(confirm ? [] : [{ path: ["confirm"], message: "Confirm reopening this salary year." }]),
  ]);
  try {
    await withSalaryRepository((repository, ownerId) => repository.reopenYear(ownerId, parsed.data));
    return successState("Salary year reopened for corrections.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}
