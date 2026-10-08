import React from "react";
import { ShieldCheck } from "lucide-react";

export function SettingsReadOnlyWorkspaceNotice() {
  return <div className="settings-read-only-notice" role="status"><strong>Shared demo workspace</strong><span>Use Log out when you are finished. Changes to financial data, settings, invitations, and sessions are disabled.</span></div>;
}

export function SettingsTwoFactorDemoNotice() {
  return <p className="settings-two-factor-demo" role="status">Not available on the demo workspace.</p>;
}

export function DemoSessionPrivacyNotice() {
  return <section className="card section-card settings-sessions-section" aria-labelledby="settings-demo-privacy-heading">
    <div className="settings-sessions-header"><div><p className="eyebrow"><ShieldCheck aria-hidden="true" size={15} strokeWidth={1.8} /> Privacy</p><h2 className="card-title" id="settings-demo-privacy-heading">Session details stay private</h2><p className="card-subtitle">Demo workspaces do not display session lists, devices, dates, or sign-out controls.</p></div></div>
    <p className="settings-sessions-empty">This shared demo is read-only: session metadata is never loaded or shown, and no sessions can be revoked here.</p>
  </section>;
}
