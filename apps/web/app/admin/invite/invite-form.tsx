"use client";

import { useState } from "react";
import { createInvitationAction } from "./actions";

export function InviteForm() {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    setToken(null);
    try {
      const generated = await createInvitationAction({ email, displayName });
      setToken(generated);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Invitation creation failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="login-form">
      <label>Email<input name="email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label>Display name (optional)<input name="displayName" type="text" autoComplete="off" value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
      <button className="account-primary-button" type="submit" disabled={pending}>{pending ? "Creating…" : "Create invitation"}</button>
      {message ? <p className="account-message is-error" role="alert">{message}</p> : null}
      {token ? (
        <div className="account-message is-success" role="status">
          <p>Invitation created. Copy the invite and share it with the new user.</p>
          <div className="invitation-actions" style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
            <button
              type="button"
              className="account-secondary-button"
              onClick={() => {
                void navigator.clipboard.writeText(`${window.location.origin}/invite?token=${token}`);
                setCopied("link");
              }}
            >
              Copy link
            </button>
            <button
              type="button"
              className="account-secondary-button"
              onClick={() => {
                void navigator.clipboard.writeText(token);
                setCopied("token");
              }}
            >
              Copy token
            </button>
          </div>
          {copied ? <p className="invitation-copied" style={{ marginTop: "0.5rem" }}>Copied {copied}.</p> : null}
        </div>
      ) : null}
    </form>
  );
}
