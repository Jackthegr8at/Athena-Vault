import { getAuthenticatedUser } from "../../lib/server/auth-session";
import { SignOutButton } from "./sign-out-button";

export async function GlobalHeader() {
  let user = null;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return null;
  }

  if (!user) return null;

  return (
    <header className="global-header">
      <span className="global-header-title">Athena Vault</span>
      <SignOutButton />
    </header>
  );
}
