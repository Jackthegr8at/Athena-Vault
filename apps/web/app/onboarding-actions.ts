"use server";

import { revalidatePath } from "next/cache";
import { eq, users } from "@athena/database";
import { withWritableAuthenticatedDatabase } from "../lib/server/owner-database";
import { isOnboardingState, type OnboardingActionState, type OnboardingState } from "./onboarding-types";
import { onboardingStateMessage } from "../lib/server/onboarding";

function formDataText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function updateOnboardingStateAction(
  _previousState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const stateValue = formDataText(formData, "state");
  if (!isOnboardingState(stateValue)) return { ok: false, message: "We couldn't update Getting started. Try again.", state: null };
  const state = stateValue as OnboardingState;

  try {
    await withWritableAuthenticatedDatabase(async (database, user) => {
      const updated = await database.update(users)
        .set({ onboardingState: state })
        .where(eq(users.id, user.owner.id))
        .returning({ id: users.id });
      if (updated.length !== 1) throw new Error("Onboarding owner was not updated.");
    }, { requireTwoFactor: false });
    // Opening the guide is handled by the client action state. Revalidating the
    // whole dashboard here can make an otherwise successful action fail while
    // the dashboard is rendered again. The other states change which version
    // of the card is shown after navigation, so they still invalidate it.
    if (state !== "active") revalidatePath("/");
    return { ok: true, message: onboardingStateMessage(state), state };
  } catch {
    return { ok: false, message: "We couldn't update Getting started. Try again.", state: null };
  }
}
