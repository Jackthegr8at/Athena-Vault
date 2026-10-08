"use client";

import Link from "next/link";
import { UserRoundPlus } from "lucide-react";
import { SignOutButton } from "./sign-out-button";

export function UserMenu({ isAdmin, isDemo = false }: { readonly isAdmin: boolean; readonly isDemo?: boolean }) {
  return (
    <div className="user-menu" style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
      {isDemo ? <span className="user-menu-demo-badge" role="status">Shared demo · Read-only</span> : null}
      {isAdmin && !isDemo ? (
        <Link className="account-secondary-button user-menu-invite" href="/admin/invite">
          <UserRoundPlus aria-hidden="true" size={20} strokeWidth={1.8} />
          <span>Invite user</span>
        </Link>
      ) : null}
      <SignOutButton />
    </div>
  );
}
