"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LockKeyhole, Mail, UserRound } from "lucide-react";
import { authClient } from "../../lib/auth-client";
import { setupFirstUserAction } from "./actions";

export function SetupForm({ setupTokenRequired }: { readonly setupTokenRequired: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      await setupFirstUserAction({ email, password, displayName, setupToken });
      const result = await authClient.signIn.email({ email, password, callbackURL: "/" });
      if (result.error) {
        setMessage(`Account created, but automatic sign-in failed: ${result.error.message || "Unknown error"}.`);
        setPending(false);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch (error) {
      setPending(false);
      setMessage(error instanceof Error ? error.message : "Setup failed.");
    }
  }

  return (
    <form method="post" onSubmit={submit} className="login-form">
      <label>
        <span className="login-field-label">Email</span>
        <span className="login-input-shell">
          <Mail aria-hidden="true" size={17} strokeWidth={1.8} />
          <input name="email" type="email" autoComplete="email" placeholder="Enter your email address" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </span>
      </label>
      <label>
        <span className="login-field-label">Display name (optional)</span>
        <span className="login-input-shell">
          <UserRound aria-hidden="true" size={17} strokeWidth={1.8} />
          <input name="displayName" type="text" autoComplete="name" placeholder="How should we address you?" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </span>
      </label>
      <label>
        <span className="login-field-label">Password</span>
        <span className="login-input-shell">
          <LockKeyhole aria-hidden="true" size={17} strokeWidth={1.8} />
          <input name="password" type="password" autoComplete="new-password" placeholder="Create a secure password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </span>
      </label>
      {setupTokenRequired ? <label>
        <span className="login-field-label">Setup token</span>
        <span className="login-input-shell">
          <KeyRound aria-hidden="true" size={17} strokeWidth={1.8} />
          <input name="setupToken" type="password" autoComplete="off" placeholder="Enter the setup token" value={setupToken} onChange={(event) => setSetupToken(event.target.value)} required />
        </span>
      </label> : null}
      <button className="login-submit-button" type="submit" disabled={pending}>{pending ? "Creating…" : "Create account"}</button>
      {message ? <p className="login-error-message" role="alert">{message}</p> : null}
    </form>
  );
}
