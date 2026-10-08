"use server";

import { revalidatePath } from "next/cache";
import { createOwnerRepository } from "@athena/database";
import { ownerDisplayNameInputSchema } from "@athena/validation";
import { withWritableAuthenticatedDatabase } from "../lib/server/owner-database";
import {
  overviewRepositoryErrorActionState,
  overviewValidationActionState,
  type OverviewActionState,
} from "./overview-action-helpers";

function formDataText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function successState(message: string): OverviewActionState {
  return { ok: true, message, fieldErrors: {} };
}

export async function updateOwnerDisplayNameAction(
  _previousState: OverviewActionState,
  formData: FormData,
): Promise<OverviewActionState> {
  const parsed = ownerDisplayNameInputSchema.safeParse({ displayName: formDataText(formData, "displayName") });
  if (!parsed.success) return overviewValidationActionState(parsed.error.issues);

  try {
    await withWritableAuthenticatedDatabase((database, user) => createOwnerRepository(database).updateDisplayName(user.owner.id, parsed.data.displayName), { requireTwoFactor: false });
    revalidatePath("/");
    return successState("Display name updated.");
  } catch (error) {
    return overviewRepositoryErrorActionState(error);
  }
}
