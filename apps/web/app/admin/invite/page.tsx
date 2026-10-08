import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "../../../lib/server/auth-session";
import { getServerDatabase } from "../../../lib/server/database";
import { getPrimaryOwnerId } from "../../../lib/server/auth-setup";
import { SignOutButton } from "../../components/sign-out-button";
import { InviteForm } from "./invite-form";

export const dynamic = "force-dynamic";

export default async function InvitePage() {
  const [user, primaryId] = await Promise.all([requireAuthenticatedUser(), getPrimaryOwnerId(getServerDatabase())]);
  if (user.owner.isDemo) redirect("/");
  if (!primaryId || user.authUserId !== primaryId) {
    redirect("/");
  }

  return (
    <main className="main auth-page">
      <section className="card auth-card" aria-labelledby="invite-heading">
        <div className="top-actions" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <Link className="account-secondary-button" href="/">← Home</Link>
          <SignOutButton />
        </div>
        <p className="eyebrow">Admin</p>
        <h1 id="invite-heading" className="page-title">Invite a user</h1>
        <p className="card-subtitle">Create a one-time invitation for a new workspace owner.</p>
        <InviteForm />
      </section>
    </main>
  );
}
