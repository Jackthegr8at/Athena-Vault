"use server";

import { createCalculationWorkbooksRepository } from "@athena/database";
import {
  calculationWorkbookDeleteInputSchema,
  calculationWorkbookSaveInputSchema,
} from "@athena/validation";
import { revalidatePath } from "next/cache";
import { withWritableAuthenticatedDatabase } from "../../lib/server/owner-database";

function isDuplicateNameError(error: unknown): boolean {
  if (error instanceof Error) {
    const text = (error.message + (error.cause instanceof Error ? `; ${error.cause.message}` : "")).toLowerCase();
    return text.includes("calculation_workbooks_owner_name_idx") || (text.includes("unique constraint") && text.includes("name"));
  }
  if (error && typeof error === "object" && "cause" in error) {
    return isDuplicateNameError((error as { cause: unknown }).cause);
  }
  return false;
}

function failure(error: unknown): { readonly ok: false; readonly message: string } {
  if (error instanceof RangeError || (error instanceof Error && error.message === "Workbook not found.")) {
    return { ok: false, message: error.message };
  }
  if (isDuplicateNameError(error)) {
    return { ok: false, message: "A workbook with this name already exists. Please choose a different name." };
  }
  return { ok: false, message: "The workbook could not be saved. Please try again." };
}

export async function createCalculationWorkbookAction() {
  try {
    const created = await withWritableAuthenticatedDatabase((database, user) => (
      createCalculationWorkbooksRepository(database).create(user.owner.id, { name: "" })
    ), { requireTwoFactor: true });
    revalidatePath("/workbooks");
    return { ok: true as const, workbook: { id: created.id, name: created.name, updatedAt: created.updatedAt.toISOString() } };
  } catch (error) {
    return failure(error);
  }
}

export async function saveCalculationWorkbookAction(input: unknown) {
  const parsed = calculationWorkbookSaveInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "The workbook data is invalid." };

  try {
    const saved = await withWritableAuthenticatedDatabase((database, user) => (
      createCalculationWorkbooksRepository(database).update(user.owner.id, parsed.data.id, {
        name: parsed.data.name,
        snapshot: { ...parsed.data.snapshot, name: parsed.data.name },
      })
    ), { requireTwoFactor: true });
    revalidatePath("/workbooks");
    return { ok: true as const, workbook: { id: saved.id, name: saved.name, updatedAt: saved.updatedAt.toISOString() } };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteCalculationWorkbookAction(input: unknown) {
  const parsed = calculationWorkbookDeleteInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "The workbook selection is invalid." };

  try {
    await withWritableAuthenticatedDatabase((database, user) => (
      createCalculationWorkbooksRepository(database).delete(user.owner.id, parsed.data.id)
    ), { requireTwoFactor: true });
    revalidatePath("/workbooks");
    return { ok: true as const };
  } catch (error) {
    return failure(error);
  }
}
