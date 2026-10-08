"use client";

import React, { useState } from "react";
import { Eye, EyeOff, KeyRound, LockKeyhole, Mail, UserRoundPlus } from "lucide-react";
import { authClient } from "../../lib/auth-client";
import { markLoginConnected } from "./login-greeting";

export function LoginForm({ nextPath, passkeysEnabled = false, onNavigate }: { readonly nextPath: string; readonly passkeysEnabled?: boolean; readonly onNavigate?: (path: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [twoFactorMethod, setTwoFactorMethod] = useState<"totp" | "backup">("totp");
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = onNavigate ?? ((path: string) => window.location.assign(path));

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const result = await authClient.signIn.email({ email, password, callbackURL: nextPath });
    setPending(false);
    if (result.error) {
      setMessage(result.error.message || "Email or password is incorrect.");
      return;
    }
    const signInData = result.data as unknown as { twoFactorRedirect?: boolean } | null | undefined;
    if (signInData?.twoFactorRedirect) {
      setTwoFactorRequired(true);
      setTwoFactorCode("");
      setMessage(null);
      return;
    }
    markLoginConnected();
    navigate(nextPath);
  }
  async function signInWithPasskey(): Promise<void> {
    setPending(true); setMessage(null);
    try {
      const result = await authClient.signIn.passkey({ autoFill: false });
      if (result.error) { setMessage("Passkey sign-in was not completed. Use your password or recovery method instead."); return; }
      markLoginConnected(); navigate(nextPath);
    } catch { setMessage("Passkey sign-in was not completed. Use your password or recovery method instead."); }
    finally { setPending(false); }
  }

  async function verifyTwoFactor(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const result = twoFactorMethod === "totp"
        ? await authClient.twoFactor.verifyTotp({ code: twoFactorCode })
        : await authClient.twoFactor.verifyBackupCode({ code: twoFactorCode });
      if (result.error) {
        setMessage("That verification code was not accepted. Check it and try again.");
        return;
      }
      markLoginConnected();
      navigate(nextPath);
    } catch {
      setMessage("That verification code was not accepted. Check it and try again.");
    } finally {
      setPending(false);
    }
  }

  return <>
    {twoFactorRequired ? <form method="post" onSubmit={verifyTwoFactor} className="login-form">
      <div className="login-two-factor-heading"><strong>Verify your sign-in</strong><span>Enter the code from your authenticator app to continue.</span></div>
      <label>
        <span className="login-field-label">{twoFactorMethod === "totp" ? "Authenticator code" : "Backup code"}</span>
        <span className="login-input-shell">
          <LockKeyhole aria-hidden="true" size={17} strokeWidth={1.8} />
          <input name="twoFactorCode" type="text" inputMode={twoFactorMethod === "totp" ? "numeric" : "text"} autoComplete="one-time-code" placeholder={twoFactorMethod === "totp" ? "Enter your six-digit code" : "Enter your backup code"} value={twoFactorCode} onChange={(event) => setTwoFactorCode(event.target.value)} required />
        </span>
      </label>
      <button className="login-submit-button" type="submit" disabled={pending}>{pending ? "Verifying…" : "Verify code"}</button>
      <button className="login-two-factor-switch" type="button" onClick={() => { setTwoFactorMethod((method) => method === "totp" ? "backup" : "totp"); setTwoFactorCode(""); setMessage(null); }} disabled={pending}>{twoFactorMethod === "totp" ? "Use a backup code" : "Use an authenticator code"}</button>
      {message ? <p className="login-error-message" role="alert">{message}</p> : null}
    </form> : <form method="post" onSubmit={submit} className="login-form">
      <label>
        <span className="login-field-label">Email</span>
        <span className="login-input-shell">
          <Mail aria-hidden="true" size={17} strokeWidth={1.8} />
          <input name="email" type="email" autoComplete="username" placeholder="Enter your email address" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </span>
      </label>
      <label>
        <span className="login-field-label">Password</span>
        <span className="login-input-shell">
          <LockKeyhole aria-hidden="true" size={17} strokeWidth={1.8} />
          <input name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          <button className="login-password-toggle" type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide password" : "Show password"}><span aria-hidden="true">{showPassword ? <EyeOff size={17} strokeWidth={1.8} /> : <Eye size={17} strokeWidth={1.8} />}</span></button>
        </span>
      </label>
      <button className="login-submit-button" type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
      {passkeysEnabled ? <button className="login-passkey-button" type="button" onClick={() => { void signInWithPasskey(); }} disabled={pending}><KeyRound aria-hidden="true" size={17} />Sign in with a passkey</button> : null}
      {message ? <p className="login-error-message" role="alert">{message}</p> : null}
    </form>}
    <div className="login-form-footer">
      <div className="login-divider" aria-hidden="true"><span>OR</span></div>
      <a className="login-invite-button" href="/invite"><UserRoundPlus aria-hidden="true" size={17} strokeWidth={1.8} />Accept an invitation</a>
    </div>
  </>;
}
