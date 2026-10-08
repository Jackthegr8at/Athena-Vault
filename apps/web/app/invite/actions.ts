"use server";

import { acceptInvitation } from "../../lib/server/auth-setup";

export async function acceptInvitationAction(formData: {
  readonly token: string;
  readonly email: string;
  readonly password: string;
  readonly displayName?: string;
}): Promise<void> {
  return acceptInvitation(formData);
}
