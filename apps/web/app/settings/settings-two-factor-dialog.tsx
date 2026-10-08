"use client";

import React, { useEffect, useId, useRef, type ChangeEvent, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { createPortal } from "react-dom";

export interface TwoFactorEnrollmentDialogProps {
  readonly open: boolean;
  readonly totpUri: string | null;
  readonly backupCodes: readonly string[];
  readonly backupCodesAcknowledged: boolean;
  readonly code: string;
  readonly verified: boolean;
  readonly pending: boolean;
  readonly message: string | null;
  readonly onCodeChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onBackupCodesAcknowledgedChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onVerify: (event: FormEvent<HTMLFormElement>) => void;
  readonly onClose: () => void;
}

export function TwoFactorEnrollmentDialog({
  open,
  totpUri,
  backupCodes,
  backupCodesAcknowledged,
  code,
  verified,
  pending,
  message,
  onCodeChange,
  onBackupCodesAcknowledgedChange,
  onVerify,
  onClose,
}: TwoFactorEnrollmentDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const id = useId();
  const titleId = `settings-two-factor-dialog-title-${id}`;
  const descriptionId = `settings-two-factor-dialog-description-${id}`;

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute("open", "");
      }
    }
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      if (dialog.open) {
        if (typeof dialog.close === "function") dialog.close();
        else dialog.removeAttribute("open");
      }
      const trigger = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (trigger?.isConnected) {
        window.requestAnimationFrame(() => {
          if (trigger.isConnected) trigger.focus();
        });
      }
    };
  }, [open]);

  if (!open || !totpUri) return null;

  const canClose = !verified || backupCodesAcknowledged;
  const handleNativeCancel = (event: React.SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    if (!pending && canClose) onClose();
  };

  const handleDialogClick = (event: React.MouseEvent<HTMLDialogElement>) => {
    if (!pending && canClose && event.target === event.currentTarget) onClose();
  };

  const dialog = <dialog
    ref={dialogRef}
    className="settings-two-factor-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    aria-describedby={descriptionId}
    aria-busy={pending}
    onCancel={handleNativeCancel}
    onClick={handleDialogClick}
  >
    <div className="settings-two-factor-dialog-surface" onClick={(event) => event.stopPropagation()}>
      <header className="settings-two-factor-dialog-header">
        <div className="settings-two-factor-dialog-heading">
          <span className="settings-two-factor-dialog-icon"><ShieldCheck aria-hidden="true" size={23} strokeWidth={1.7} /></span>
          <div>
            <p className="eyebrow">Secure sign-in</p>
            <h2 id={titleId}>Set up two-factor authentication</h2>
            <p id={descriptionId}>Scan the code with your authenticator app, then confirm it to protect your account.</p>
          </div>
        </div>
        <button ref={closeButtonRef} className="settings-two-factor-dialog-close" type="button" onClick={onClose} disabled={pending || !canClose} aria-label="Close two-factor setup" title={!canClose ? "Confirm that you saved your backup codes before closing" : undefined}><span aria-hidden="true">×</span></button>
      </header>

      {verified ? <div className="settings-two-factor-dialog-success" role="status"><span className="settings-two-factor-dialog-success-icon"><ShieldCheck aria-hidden="true" size={20} strokeWidth={1.8} /></span><span><strong>Two-factor authentication is enabled</strong><small>Your authenticator code will be required at the next sign-in.</small></span></div> : null}

      <div className="settings-two-factor-dialog-grid">
        <div className="settings-two-factor-dialog-qr">
          <QRCodeSVG value={totpUri} size={196} level="M" marginSize={4} bgColor="#FFFDF8" fgColor="#111C26" title="Authenticator setup QR code" />
          <span>Scan with your authenticator app</span>
        </div>
        <div className="settings-two-factor-dialog-steps">
          <div className="settings-two-factor-dialog-step"><span className="settings-two-factor-dialog-step-number">1</span><div><strong>Scan the QR code</strong><p>Open Google Authenticator, 1Password, Authy, or another TOTP app and add this account.</p><details className="settings-two-factor-dialog-manual"><summary>Can&apos;t scan? Enter the <code>otpauth://</code> setup key manually</summary><code className="settings-two-factor-dialog-manual-code" dir="ltr">{totpUri}</code></details></div></div>
          {verified ? <div className="settings-two-factor-dialog-step"><span className="settings-two-factor-dialog-step-number">✓</span><div><strong>Setup confirmed</strong><p>Save your backup codes below before closing this window.</p></div></div> : <div className="settings-two-factor-dialog-step"><span className="settings-two-factor-dialog-step-number">2</span><div><strong>Confirm your authenticator</strong><p>Enter the current six-digit code from your app.</p><form className="settings-two-factor-dialog-form" onSubmit={onVerify}><label className="settings-password-field" htmlFor="two-factor-code"><span className="settings-password-label">Authenticator code</span><span className="settings-password-input-shell"><ShieldCheck aria-hidden="true" size={17} strokeWidth={1.8} /><input id="two-factor-code" name="twoFactorCode" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} value={code} onChange={onCodeChange} required /></span></label><button className="navy-action-button" type="submit" disabled={pending}><span className="navy-action-icon" aria-hidden="true"><ShieldCheck size={14} strokeWidth={2.2} /></span><span>{pending ? "Verifying…" : "Verify and enable"}</span></button></form></div></div>}
        </div>
      </div>

      {message ? <p className="settings-two-factor-dialog-message" role="alert" aria-live="polite">{message}</p> : null}
      <div className="settings-two-factor-dialog-codes" aria-live="polite"><div><strong>Save your backup codes</strong><span>Use these one-time codes if you lose access to your authenticator app.</span></div><ul>{backupCodes.map((backupCode) => <li key={backupCode}><code dir="ltr">{backupCode}</code></li>)}</ul>{verified ? <div className="settings-two-factor-dialog-acknowledgement"><label><input type="checkbox" checked={backupCodesAcknowledged} onChange={onBackupCodesAcknowledgedChange} required aria-describedby="settings-two-factor-backup-codes-note" /><span>I saved my backup codes in a secure place.</span></label><small id="settings-two-factor-backup-codes-note">This confirmation is required before you can close setup.</small></div> : null}</div>

      <footer className="settings-two-factor-dialog-footer"><span>{verified ? (backupCodesAcknowledged ? "Backup codes acknowledged." : "Save your codes, then confirm below to finish setup.") : "You can finish setup after verifying the code."}</span><button className="account-secondary-button" type="button" onClick={onClose} disabled={pending || !canClose} title={!canClose ? "Confirm that you saved your backup codes before closing" : undefined}>{verified ? "Done" : "Cancel"}</button></footer>
    </div>
  </dialog>;

  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
}
