"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      // authClient pulls in passkey/WebAuthn code; load it only when signing out.
      const { authClient } = await import("../../lib/auth-client");
      await authClient.signOut();
    } catch {
      // Ignore Better Auth errors; the session may already be gone.
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <button type="button" onClick={signOut} disabled={pending} className="account-secondary-button user-menu-logout">
      <LogOut aria-hidden="true" size={20} strokeWidth={1.8} />
      <span>{pending ? "Signing out…" : "Log out"}</span>
    </button>
  );
}
