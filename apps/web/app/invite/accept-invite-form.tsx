"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "../../lib/auth-client";
import { acceptInvitationAction } from "./actions";

export function AcceptInviteForm({ initialToken }: { readonly initialToken: string }) {
  const router = useRouter();
  const [token, setToken] = useState(initialToken);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      await acceptInvitationAction({ token, email, password, displayName });
      const result = await authClient.signIn.email({ email, password, callbackURL: "/" });
      if (result.error) {
        setMessage(`Account created, but automatic sign-in failed: ${result.error.message || "Unknown error"}.`);
        setPending(false);
        return;
      }
      router.push("/");
      router.refresh();
    } catch (error) {
      setPending(false);
      setMessage(error instanceof Error ? error.message : "Invitation failed.");
    }
  }

  return (
    <form method="post" onSubmit={submit} className="login-form">
      <label>Invitation token<input name="token" type="text" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} required /></label>
      <label>Email<input name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label>Display name (optional)<input name="displayName" type="text" autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
      <label>Password<input name="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      <button className="account-primary-button" type="submit" disabled={pending}>{pending ? "Creating…" : "Create account"}</button>
      {message ? <p className="account-message is-error" role="alert">{message}</p> : null}
    </form>
  );
}
