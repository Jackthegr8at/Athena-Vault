"use server";

import { createInvitation } from "../../../lib/server/auth-setup";

export async function createInvitationAction(formData: {
  readonly email: string;
  readonly displayName?: string;
}): Promise<string> {
  return createInvitation(formData);
}
