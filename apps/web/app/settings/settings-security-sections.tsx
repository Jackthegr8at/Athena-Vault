"use client";

import React, { type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { KeyRound, LockKeyhole, Monitor, ShieldCheck } from "lucide-react";
import { PASSWORD_POLICY_ERROR } from "../../lib/password-policy";
import type { SettingsSecurityActivity, SettingsSecuritySession } from "./security-summary";
import { DemoSessionPrivacyNotice, SettingsReadOnlyWorkspaceNotice, SettingsTwoFactorDemoNotice } from "./settings-demo-notices";
import {
  formatSessionDate,
  PasswordField,
  type PasswordValues,
  type PasswordVisibility,
  sessionDeviceLabel,
  TwoFactorPasswordField,
} from "./settings-presentation";

// The TOTP dialog pulls in the QR-code library; defer it until enrollment opens.
const TwoFactorEnrollmentDialog = dynamic(() => import("./settings-two-factor-dialog").then((module) => module.TwoFactorEnrollmentDialog), { ssr: false });

export interface SettingsPasskey {
  readonly id: string;
  readonly name?: string;
  readonly createdAt?: Date | string;
}

interface PasskeySectionProps {
  readonly enabled: boolean;
  readonly twoFactorEnabled: boolean;
  readonly readOnly: boolean;
  readonly passkeys: readonly SettingsPasskey[];
  readonly name: string;
  readonly message: string | null;
  readonly pending: boolean;
  readonly onNameChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onAdd: () => void;
  readonly onRemove: (id: string) => void;
}

export function SettingsPasskeySection({ enabled, twoFactorEnabled, readOnly, passkeys, name, message, pending, onNameChange, onAdd, onRemove }: PasskeySectionProps) {
  if (!enabled) return null;

  return (
    <section className={`card section-card settings-card settings-passkey-card editorial-page-art-surface ${twoFactorEnabled ? "" : "is-before-two-factor"}`} aria-labelledby="settings-passkey-heading">
      <div className="settings-card-header"><div><p className="eyebrow"><KeyRound aria-hidden="true" size={15} strokeWidth={1.8} /> Passkeys</p><h2 className="card-title" id="settings-passkey-heading">Additional sign-in methods</h2><p className="card-subtitle">Passkeys add a convenient sign-in option. They do not replace your password, authenticator app, or backup codes.</p></div></div>
      {readOnly ? <DemoSessionPrivacyNotice /> : <>
        <div className="settings-passkey-policy"><strong>Security policy</strong><span>Passkeys can provide step-up verification for password changes and TOTP disabling. Adding or removing a passkey still requires a recent sign-in.</span></div>
        <div className="settings-passkey-actions"><input aria-label="Passkey name" value={name} onChange={onNameChange} maxLength={80} /><button className="navy-action-button" type="button" onClick={onAdd} disabled={pending || !name.trim()}>{pending ? "Waiting for your device…" : "Add passkey"}</button></div>
        {message ? <p className="settings-password-message" role="alert">{message}</p> : null}
        {passkeys.length ? <div className="settings-passkey-list">{passkeys.map((passkey) => <div className="settings-passkey-row" key={passkey.id}><span><strong>{passkey.name || "Passkey"}</strong><small>Registered {passkey.createdAt ? formatSessionDate(String(passkey.createdAt)) : "date unavailable"}</small></span><button type="button" onClick={() => onRemove(passkey.id)} disabled={pending || passkeys.length <= 1}>Remove</button></div>)}</div> : <p className="settings-sessions-empty">No passkeys registered.</p>}
      </>}
    </section>
  );
}

interface PasswordSectionProps {
  readonly readOnly: boolean;
  readonly twoFactorEnabled: boolean;
  readonly passkeysEnabled: boolean;
  readonly values: PasswordValues;
  readonly visibility: PasswordVisibility;
  readonly totpCode: string;
  readonly pending: boolean;
  readonly message: string | null;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  readonly onValueChange: (field: keyof PasswordValues, event: ChangeEvent<HTMLInputElement>) => void;
  readonly onVisibilityToggle: (field: keyof PasswordVisibility) => void;
  readonly onTotpCodeChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onPasskeyChange: () => void;
}

export function SettingsPasswordSection({ readOnly, twoFactorEnabled, passkeysEnabled, values, visibility, totpCode, pending, message, onSubmit, onValueChange, onVisibilityToggle, onTotpCodeChange, onPasskeyChange }: PasswordSectionProps) {
  return (
    <section className="card section-card settings-card editorial-page-art-surface" aria-labelledby="settings-password-heading">
      <div className="settings-card-header">
        <div>
          <p className="eyebrow"><LockKeyhole aria-hidden="true" size={14} strokeWidth={1.8} /> {readOnly ? "Shared demo access" : "Account security"}</p>
          <h2 className="card-title" id="settings-password-heading">{readOnly ? "Read-only workspace" : "Change password"}</h2>
          <p className="card-subtitle">{readOnly ? "This shared demo is available for exploring Athena Vault. Data and credentials cannot be changed." : "Update the password for your signed-in account. You will be signed out everywhere after it changes."}</p>
        </div>
      </div>
      {readOnly ? <SettingsReadOnlyWorkspaceNotice /> : <form className="settings-password-form" onSubmit={onSubmit}>
        <PasswordField id="currentPassword" label="Current password" autoComplete="current-password" value={values.currentPassword} visible={visibility.currentPassword} onChange={(event) => onValueChange("currentPassword", event)} onToggle={() => onVisibilityToggle("currentPassword")} />
        <PasswordField id="newPassword" label="New password" autoComplete="new-password" value={values.newPassword} visible={visibility.newPassword} onChange={(event) => onValueChange("newPassword", event)} onToggle={() => onVisibilityToggle("newPassword")} />
        <PasswordField id="confirmPassword" label="Confirm new password" autoComplete="new-password" value={values.confirmPassword} visible={visibility.confirmPassword} onChange={(event) => onValueChange("confirmPassword", event)} onToggle={() => onVisibilityToggle("confirmPassword")} />
        {twoFactorEnabled ? <label className="settings-password-field" htmlFor="password-change-totp-code"><span className="settings-password-label">Authenticator code</span><span className="settings-password-input-shell"><ShieldCheck aria-hidden="true" size={17} strokeWidth={1.8} /><input id="password-change-totp-code" name="passwordChangeTotpCode" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} value={totpCode} onChange={onTotpCodeChange} required /></span><small>Required with your current password, unless you use a passkey.</small></label> : null}
        <p className="settings-password-requirement">{PASSWORD_POLICY_ERROR}</p>
        <div className="settings-password-actions">
          <button className="navy-action-button" type="submit" disabled={pending}><span className="navy-action-icon" aria-hidden="true"><LockKeyhole size={14} strokeWidth={2.2} /></span><span>{pending ? "Changing…" : "Change password"}</span></button>
          {passkeysEnabled ? <button className="account-secondary-button" type="button" onClick={onPasskeyChange} disabled={pending}>{pending ? "Verifying…" : "Use a passkey instead"}</button> : null}
          <Link className="account-secondary-button" href="/">Cancel</Link>
        </div>
        {message ? <p className="settings-password-message" role="alert" aria-live="polite">{message}</p> : null}
      </form>}
    </section>
  );
}

export type TwoFactorPendingAction = "enable" | "verify" | "disable" | "passkey" | null;

interface TwoFactorSectionProps {
  readonly sectionRef: React.RefObject<HTMLElement | null>;
  readonly enabled: boolean;
  readonly readOnly: boolean;
  readonly passkeysEnabled: boolean;
  readonly password: string;
  readonly code: string;
  readonly disableCode: string;
  readonly totpUri: string | null;
  readonly backupCodes: readonly string[];
  readonly backupCodesAcknowledged: boolean;
  readonly pendingAction: TwoFactorPendingAction;
  readonly message: string | null;
  readonly enrollmentOpen: boolean;
  readonly enrollmentVerified: boolean;
  readonly onPasswordChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onCodeChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onDisableCodeChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onBackupCodesAcknowledgedChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onBeginEnrollment: (event: FormEvent<HTMLFormElement>) => void;
  readonly onVerifyEnrollment: (event: FormEvent<HTMLFormElement>) => void;
  readonly onDisable: (event: FormEvent<HTMLFormElement>) => void;
  readonly onDisableWithPasskey: () => void;
  readonly onCloseEnrollment: () => void;
}

export function SettingsTwoFactorSection({
  sectionRef,
  enabled,
  readOnly,
  passkeysEnabled,
  password,
  code,
  disableCode,
  totpUri,
  backupCodes,
  backupCodesAcknowledged,
  pendingAction,
  message,
  enrollmentOpen,
  enrollmentVerified,
  onPasswordChange,
  onCodeChange,
  onDisableCodeChange,
  onBackupCodesAcknowledgedChange,
  onBeginEnrollment,
  onVerifyEnrollment,
  onDisable,
  onDisableWithPasskey,
  onCloseEnrollment,
}: TwoFactorSectionProps) {
  const clearMessageOnPasswordChange = (event: ChangeEvent<HTMLInputElement>) => onPasswordChange(event);
  const clearMessageOnCodeChange = (event: ChangeEvent<HTMLInputElement>) => onCodeChange(event);
  const clearMessageOnDisableCodeChange = (event: ChangeEvent<HTMLInputElement>) => onDisableCodeChange(event);

  return <section ref={sectionRef} id="settings-two-factor-section" tabIndex={-1} className={`card section-card settings-two-factor-section editorial-page-art-surface ${enabled ? "is-enabled" : "is-disabled"}`} aria-labelledby="settings-two-factor-heading">
    <div className="settings-card-header">
      <div>
        <p className="eyebrow"><ShieldCheck aria-hidden="true" size={14} strokeWidth={1.8} /> Sign-in protection</p>
        <h2 className="card-title" id="settings-two-factor-heading">Two-factor authentication</h2>
        <p className="card-subtitle">Use an authenticator app to add a second check after your password.</p>
      </div>
      <span className={`settings-two-factor-status ${enabled ? "is-enabled" : "is-disabled"}`} role="status">{enabled ? "Enabled" : "Not enabled"}</span>
    </div>
    {readOnly ? <SettingsTwoFactorDemoNotice /> : enabled ? <>
      <p className="settings-two-factor-copy">Disabling requires your current password and an authenticator code, or a valid passkey.</p>
      <form className="settings-two-factor-form" onSubmit={onDisable}>
        <TwoFactorPasswordField value={password} onChange={clearMessageOnPasswordChange} />
        <label className="settings-password-field" htmlFor="two-factor-disable-code"><span className="settings-password-label">Authenticator code</span><span className="settings-password-input-shell"><ShieldCheck aria-hidden="true" size={17} strokeWidth={1.8} /><input id="two-factor-disable-code" name="twoFactorDisableCode" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} value={disableCode} onChange={clearMessageOnDisableCodeChange} required /></span></label>
        <div className="settings-password-actions">
          <button className="settings-two-factor-disable-button" type="submit" disabled={pendingAction !== null}><span>{pendingAction === "disable" ? "Disabling…" : "Disable two-factor authentication"}</span></button>
          {passkeysEnabled ? <button className="account-secondary-button" type="button" onClick={onDisableWithPasskey} disabled={pendingAction !== null}>{pendingAction === "passkey" ? "Verifying…" : "Use a passkey instead"}</button> : null}
        </div>
      </form>
    </> : <>
      <p className="settings-two-factor-copy">Protect this account with a time-based code from an authenticator app. Your current password is required to begin.</p>
      <form className="settings-two-factor-form" onSubmit={onBeginEnrollment}>
        <TwoFactorPasswordField value={password} onChange={clearMessageOnPasswordChange} />
        <div className="settings-password-actions"><button className="navy-action-button" type="submit" disabled={pendingAction !== null}><span className="navy-action-icon" aria-hidden="true"><ShieldCheck size={14} strokeWidth={2.2} /></span><span>{pendingAction === "enable" ? "Starting setup…" : "Enable TOTP"}</span></button></div>
      </form>
    </>}
    {message && !enrollmentOpen ? <p className="settings-password-message" role="alert" aria-live="polite">{message}</p> : null}
    {enrollmentOpen ? <TwoFactorEnrollmentDialog open={enrollmentOpen} totpUri={totpUri} backupCodes={backupCodes} backupCodesAcknowledged={backupCodesAcknowledged} code={code} verified={enrollmentVerified} pending={pendingAction !== null} message={message} onCodeChange={clearMessageOnCodeChange} onBackupCodesAcknowledgedChange={onBackupCodesAcknowledgedChange} onVerify={onVerifyEnrollment} onClose={onCloseEnrollment} /> : null}
  </section>;
}

interface SessionSectionProps {
  readonly readOnly: boolean;
  readonly sessions: readonly SettingsSecuritySession[] | null;
  readonly confirmationId: string | null;
  readonly actionId: string | null;
  readonly message: string | null;
  readonly onConfirmRevoke: (id: string) => void;
  readonly onCancelRevoke: () => void;
  readonly onRequestRevoke: (id: string) => void;
}

export function SettingsSessionSection({ readOnly, sessions, confirmationId, actionId, message, onConfirmRevoke, onCancelRevoke, onRequestRevoke }: SessionSectionProps) {
  if (readOnly) return <DemoSessionPrivacyNotice />;

  return <section className="card section-card settings-sessions-section editorial-page-art-surface" aria-labelledby="settings-sessions-heading">
    <div className="settings-sessions-header"><div><p className="eyebrow"><Monitor aria-hidden="true" size={15} strokeWidth={1.8} /> Sessions</p><h2 className="card-title" id="settings-sessions-heading">Active sessions</h2><p className="card-subtitle">Review the devices currently signed in to your account.</p></div><span className="settings-session-count">{sessions === null ? "Unavailable" : `${sessions.length} active`}</span></div>
    {sessions === null ? <p className="settings-sessions-empty">Active session details are currently unavailable.</p> : sessions.length === 0 ? <p className="settings-sessions-empty">No active sessions found.</p> : <div className="settings-session-list">{sessions.map((session) => <div className="settings-session-row" key={session.id}><span className="settings-session-icon"><Monitor aria-hidden="true" size={19} strokeWidth={1.7} /></span><div className="settings-session-copy"><strong>{sessionDeviceLabel(session.userAgent)}{session.isCurrent ? <span className="settings-current-session-badge">Current session</span> : null}</strong><small>Signed in {formatSessionDate(session.createdAt)} · Last active {formatSessionDate(session.updatedAt)}</small><small>Expires {formatSessionDate(session.expiresAt)}</small></div><div className="settings-session-actions">{confirmationId === session.id ? <div className="settings-row-confirmation" role="alertdialog" aria-label={`Confirm revocation of ${sessionDeviceLabel(session.userAgent)}`}><span>Revoke this session?</span><div><button className="settings-session-confirm-button" type="button" onClick={() => onConfirmRevoke(session.id)} disabled={actionId === session.id}>{actionId === session.id ? "Revoking…" : "Confirm"}</button><button className="settings-session-cancel-button" type="button" onClick={onCancelRevoke} disabled={actionId === session.id}>Cancel</button></div></div> : <button className="settings-session-revoke-button" type="button" onClick={() => onRequestRevoke(session.id)}>Revoke</button>}</div></div>)}</div>}
    {message ? <p className="settings-session-message" role="alert" aria-live="polite">{message}</p> : null}
  </section>;
}

const authSecurityOperationLabels: Record<string, string> = {
  "password-change": "Password changed",
  "two-factor-enable": "Two-factor enabled",
  "two-factor-disable": "Two-factor disabled",
  "backup-codes-regenerate": "Backup codes regenerated",
  "session-revoke": "Session revoked",
  "session-create": "Signed in",
};

export function SettingsSecurityActivitySection({ activity }: { readonly activity: readonly SettingsSecurityActivity[] }) {
  return <section className="card section-card settings-card settings-activity-card editorial-page-art-surface" aria-labelledby="settings-activity-heading">
    <div className="settings-card-header">
      <div>
        <p className="eyebrow"><ShieldCheck aria-hidden="true" size={15} strokeWidth={1.8} /> Activity</p>
        <h2 className="card-title" id="settings-activity-heading">Security activity</h2>
        <p className="card-subtitle">Recent lifecycle events for this account.</p>
      </div>
    </div>
    {activity.length === 0 ? <p className="settings-sessions-empty">No recent security activity.</p> : <div className="settings-session-list">{activity.map((entry) => <div className="settings-session-row" key={`${entry.createdAt}-${entry.operation}`}><span className="settings-session-icon"><ShieldCheck aria-hidden="true" size={19} strokeWidth={1.7} /></span><div className="settings-session-copy"><strong>{authSecurityOperationLabels[entry.operation] ?? entry.operation}</strong><small>{formatSessionDate(entry.createdAt)} · {entry.status}</small></div></div>)}</div>}
  </section>;
}
