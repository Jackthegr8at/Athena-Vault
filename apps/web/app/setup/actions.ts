"use server";

import { setupFirstUser } from "../../lib/server/auth-setup";

export async function setupFirstUserAction(formData: {
  readonly email: string;
  readonly password: string;
  readonly displayName?: string;
  readonly setupToken?: string;
}): Promise<void> {
  return setupFirstUser(formData);
}
