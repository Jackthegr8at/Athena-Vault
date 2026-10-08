import { AcceptInviteForm } from "./accept-invite-form";

export const dynamic = "force-dynamic";

type InviteSearchParams = { readonly token?: string | string[] };

export default async function InvitePage({ searchParams }: { readonly searchParams?: Promise<InviteSearchParams> }) {
  const params = searchParams ? await searchParams : {};
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  return (
    <main className="main auth-page">
      <section className="card auth-card" aria-labelledby="invite-heading">
        <p className="eyebrow">Accept invitation</p>
        <h1 id="invite-heading" className="page-title">Join Athena Vault</h1>
        <p className="card-subtitle">Enter your invitation token and set your password.</p>
        <AcceptInviteForm initialToken={token ?? ""} />
      </section>
    </main>
  );
}
