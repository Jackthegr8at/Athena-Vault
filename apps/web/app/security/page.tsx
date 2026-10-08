import React from "react";
import Link from "next/link";
import Image from "next/image";
import { Database, KeyRound, LockKeyhole, Server, ShieldCheck, UserRound } from "lucide-react";
import "./security.css";
import { getAuthenticatedUser } from "../../lib/server/auth-session";
import { AnimatedLineBackground } from "../components/animated-line-background";

export const dynamic = "force-dynamic";

const protections = [
  { icon: LockKeyhole, title: "Protected authentication", detail: "Athena Vault uses Better Auth email/password authentication with secure session handling." },
  { icon: Server, title: "Session security", detail: "Sessions are stored server-side, expire automatically, and can be revoked from Account settings." },
  { icon: UserRound, title: "Owner-scoped access", detail: "Every financial request is resolved through the authenticated user and their owner-scoped workspace." },
  { icon: Database, title: "Private data boundary", detail: "Financial data stays inside the private application and database boundary; it is not used for public sharing." },
];

export default async function SecurityPage() {
  const authenticatedUser = await getAuthenticatedUser();
  const returnHref = authenticatedUser ? "/settings" : "/login";
  const returnLabel = authenticatedUser ? "Back to Settings" : "Back to Login";
  const twoFactorEnabled = authenticatedUser?.twoFactorEnabled === true;
  const twoFactorStatus = twoFactorEnabled ? "Enabled" : "Available";
  const twoFactorStatusClass = twoFactorEnabled ? "is-enabled" : "is-available";
  const twoFactorDescription = twoFactorEnabled
    ? "Your authenticator app or a backup code is required after your password when signing in to a new session."
    : "Add an authenticator app from Account settings to require a second check after your password.";

  return <main className="public-security-page">
    <div className="public-security-shell">
      <header className="public-security-header">
        <Link href="/" className="public-security-brand" aria-label="Athena Vault home"><Image src="/brand/athena-vault-wordmark.svg" alt="Athena Vault" width={220} height={59} /></Link>
        <Link className="public-security-return" href={returnHref}>{returnLabel}</Link>
      </header>
      <section className="public-security-hero" aria-labelledby="public-security-title">
        <AnimatedLineBackground lineCount={9} opacity={0.3} speed={17} scale={1.08} strokeWidth={1.18} density={1.05} drift={0.24} waveAmplitude={38} pulseStrength={0.86} direction="right-to-left" color="#9F9270" accentColor="#E0C681" seed="public-security" className="animated-line-background--public-security" />
        <span className="public-security-hero-icon"><ShieldCheck aria-hidden="true" size={29} strokeWidth={1.6} /></span>
        <p className="eyebrow">Security at Athena Vault</p>
        <h1 id="public-security-title">Your financial workspace,<br /><em>protected by design.</em></h1>
        <p>We use layered authentication, owner-scoped authorization, and private deployment boundaries to help keep your financial workspace secure.</p>
      </section>
      <section className="public-security-card" aria-labelledby="public-security-protections-heading">
        <div className="public-security-card-heading"><p className="eyebrow">How it works</p><h2 id="public-security-protections-heading">Built for private, accountable access.</h2></div>
        <div className="public-security-protection-grid">{protections.map(({ icon: Icon, title, detail }) => <article className="public-security-protection" key={title}><span className="public-security-protection-icon"><Icon aria-hidden="true" size={19} strokeWidth={1.7} /></span><h3>{title}</h3><p>{detail}</p></article>)}</div>
      </section>
      <section className="public-security-card public-security-status-card" aria-labelledby="public-security-status-heading">
        <div className="public-security-card-heading"><p className="eyebrow">Current capabilities</p><h2 id="public-security-status-heading">Security features you can use today.</h2></div>
        <div className="public-security-status-list">
          <div><strong>Password changes</strong><span className="public-security-status is-enabled">Enabled</span><p>Change your password from Account settings and sign out all sessions after the update.</p></div>
          <div><strong>Active sessions</strong><span className="public-security-status is-enabled">Enabled</span><p>Review devices and revoke individual sessions or all sessions.</p></div>
          <div><strong>Password recovery</strong><span className="public-security-status is-pending">Not configured</span><p>Email recovery is not enabled until a private mail delivery service is configured.</p></div>
          <div><strong>Password protection</strong><span className="public-security-status is-enabled">Enabled</span><p>New passwords follow the workspace policy and are checked against known breached-password data without sending the password itself.</p></div>
          <div><strong>Content security</strong><span className="public-security-status is-enabled">Enabled</span><p>Production responses use a fresh security nonce to help prevent unauthorized scripts from running.</p></div>
          <div><strong>Two-factor authentication</strong><span className={`public-security-status ${twoFactorStatusClass}`}>{twoFactorStatus}</span><p>{twoFactorDescription}</p></div>
        </div>
      </section>
      <footer className="public-security-footer"><span><KeyRound aria-hidden="true" size={16} strokeWidth={1.7} /> Keep your password private and use a unique password for this workspace.</span><Link href={returnHref}>{returnLabel}<span aria-hidden="true">→</span></Link></footer>
    </div>
  </main>;
}
