"use client";

import React, { useActionState, useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronDown, KeyRound, Link2, LockKeyhole, Monitor, ShieldCheck, type LucideIcon } from "lucide-react";
import { authClient } from "../../lib/auth-client";
import { ConfirmationDialog } from "../components/confirmation-dialog";
import {
  isPasswordPolicyValid,
  PASSWORD_BREACH_CHECK_UNAVAILABLE_ERROR,
  PASSWORD_COMPROMISED_ERROR,
  PASSWORD_POLICY_ERROR,
} from "../../lib/password-policy";
import { revokeSettingsSessionAction } from "./actions";
import { ActionNotification } from "../components/action-notification";
import { initialOnboardingActionState, type OnboardingActionState, type OnboardingState } from "../onboarding-types";
import { updateOnboardingStateAction } from "../onboarding-actions";
import type { SettingsSecuritySession, SettingsSecuritySummary } from "./security-summary";
import { formatSessionDate, type PasswordValues, type PasswordVisibility, SecurityMetric } from "./settings-presentation";
import { SettingsOnboardingRestoreSection } from "./settings-onboarding-restore-section";
import {
  SettingsPasskeySection,
  SettingsPasswordSection,
  SettingsSecurityActivitySection,
  SettingsSessionSection,
  SettingsTwoFactorSection,
  type SettingsPasskey,
} from "./settings-security-sections";









export function validatePasswordChange(values: PasswordValues, options: { readonly requireCurrentPassword?: boolean } = {}): string | null {
  if (options.requireCurrentPassword !== false && !values.currentPassword) return "Enter your current password.";
  if (!values.newPassword) return "Enter a new password.";
  if (!isPasswordPolicyValid(values.newPassword)) return PASSWORD_POLICY_ERROR;
  if (values.newPassword !== values.confirmPassword) return "New password and confirmation do not match.";
  return null;
}

export function getPasswordChangeErrorMessage(error: { readonly code?: string }): string {
  if (error.code === "PASSWORD_COMPROMISED") return PASSWORD_COMPROMISED_ERROR;
  if (error.code === "INTERNAL_SERVER_ERROR") return PASSWORD_BREACH_CHECK_UNAVAILABLE_ERROR;
  if (error.code === "SESSION_NOT_FRESH") return "For security, changing your password requires a recent sign-in. Sign out and sign in again, then try once more.";
  if (error.code === "SECURITY_STEP_UP_REQUIRED") return "For security, verify your authenticator code or use a passkey before changing your password.";
  return "We couldn't change your password. Check your current password and try again.";
}

function passkeyErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export function getPasskeyRegistrationErrorMessage(error: unknown): string {
  const code = passkeyErrorCode(error);
  if (code === "SESSION_NOT_FRESH") return "For security, adding a passkey requires a recent sign-in. Sign out and sign in again, then try once more.";
  if (code === "UNAUTHORIZED" || code === "SESSION_REQUIRED") return "Your sign-in session is no longer available. Sign in again before adding a passkey.";
  if (code === "INVALID_ORIGIN" || code === "MISSING_OR_NULL_ORIGIN") return "Open Athena Vault at its configured secure address before adding a passkey.";
  if (code === "AUTH_CANCELLED" || code === "REGISTRATION_CANCELLED") return "Passkey setup was cancelled. Try again when you are ready.";
  return "We couldn't register that passkey. Check your browser and try again.";
}

function getPasskeySecurityErrorMessage(error: unknown): string {
  const code = passkeyErrorCode(error);
  if (code === "SESSION_NOT_FRESH") return "For security, this action requires a sign-in from the last 15 minutes. Sign out and sign in again, then try once more.";
  if (code === "AUTH_CANCELLED" || code === "REGISTRATION_CANCELLED") return "Passkey verification was cancelled. Try again when you are ready.";
  if (code === "UNAUTHORIZED" || code === "SESSION_REQUIRED") return "Your passkey verification session is no longer available. Sign in again and try once more.";
  return "We couldn't verify a passkey for this security change. Try again.";
}

async function postSecurityEndpoint(path: string, body: Record<string, string> = {}): Promise<boolean> {
  try {
    const response = await fetch(`/api/auth/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function TwoFactorSecurityPanel({
  enabled,
  readOnly,
  passkeysEnabled,
  sectionRef,
  onEnabled,
  onDisabled,
}: {
  readonly enabled: boolean;
  readonly readOnly: boolean;
  readonly passkeysEnabled: boolean;
  readonly sectionRef: React.RefObject<HTMLElement | null>;
  readonly onEnabled: () => void;
  readonly onDisabled: () => void;
}) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<readonly string[] | null>(null);
  const [backupCodesAcknowledged, setBackupCodesAcknowledged] = useState(false);
  const [pendingAction, setPendingAction] = useState<"enable" | "verify" | "disable" | "passkey" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [enrollmentOpen, setEnrollmentOpen] = useState(false);
  const [enrollmentVerified, setEnrollmentVerified] = useState(false);

  function clearMessage() {
    setMessage(null);
  }

  function closeEnrollment() {
    if (pendingAction !== null || (enrollmentVerified && !backupCodesAcknowledged)) return;
    setEnrollmentOpen(false);
    setEnrollmentVerified(false);
    setTotpUri(null);
    setBackupCodes(null);
    setBackupCodesAcknowledged(false);
    setCode("");
    setDisableCode("");
    setPassword("");
    clearMessage();
  }

  async function beginEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password) {
      setMessage("Enter your current password to begin setup.");
      return;
    }

    setPendingAction("enable");
    clearMessage();
    try {
      const result = await authClient.twoFactor.enable({ password, method: "totp" });
      const data = result.data;
      if (result.error || !data || data.method !== "totp" || typeof data.totpURI !== "string" || !Array.isArray(data.backupCodes) || data.backupCodes.length === 0) {
        setMessage("We couldn't start two-factor setup. Check your current password and try again.");
        return;
      }
      setTotpUri(data.totpURI);
      setBackupCodes(data.backupCodes);
      setBackupCodesAcknowledged(false);
      setCode("");
      setEnrollmentVerified(false);
      setEnrollmentOpen(true);
      setMessage(null);
    } catch {
      setMessage("We couldn't start two-factor setup. Check your current password and try again.");
    } finally {
      setPendingAction(null);
    }
  }

  async function verifyEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!code.trim()) {
      setMessage("Enter the code from your authenticator app.");
      return;
    }

    setPendingAction("verify");
    clearMessage();
    try {
      const result = await authClient.twoFactor.verifyTotp({ code: code.trim() });
      if (result.error) {
        setMessage("We couldn't verify that code. Check it and try again.");
        return;
      }
      setEnrollmentVerified(true);
      setBackupCodesAcknowledged(false);
      setPassword("");
      setCode("");
      onEnabled();
      setMessage("Two-factor authentication is enabled. Keep your backup codes somewhere safe.");
    } catch {
      setMessage("We couldn't verify that code. Check it and try again.");
    } finally {
      setPendingAction(null);
    }
  }

  async function disableTwoFactor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password) {
      setMessage("Enter your current password to disable two-factor authentication.");
      return;
    }
    if (!disableCode.trim()) {
      setMessage("Enter the current code from your authenticator app.");
      return;
    }

    setPendingAction("disable");
    clearMessage();
    try {
      const intentStarted = await postSecurityEndpoint("security/request-password-proof", { operation: "two-factor-disable", password });
      if (!intentStarted) {
        setMessage("We couldn't verify your current password. Try again.");
        return;
      }
      const verification = await authClient.twoFactor.verifyTotp({ code: disableCode.trim() });
      if (verification.error) {
        setMessage("We couldn't verify that code. Check it and try again.");
        return;
      }
      const result = await postSecurityEndpoint("security/disable-two-factor");
      if (!result) {
        setMessage("We couldn't disable two-factor authentication. Try again.");
        return;
      }
      setPassword("");
      setDisableCode("");
      setBackupCodes(null);
      onDisabled();
      setMessage("Two-factor authentication is disabled.");
    } catch {
      setMessage("We couldn't disable two-factor authentication. Try again.");
    } finally {
      setPendingAction(null);
    }
  }

  async function disableTwoFactorWithPasskey(): Promise<void> {
    if (!passkeysEnabled) return;
    setPendingAction("passkey");
    clearMessage();
    try {
      const intentStarted = await postSecurityEndpoint("security/request-passkey-proof", { operation: "two-factor-disable" });
      if (!intentStarted) {
        setMessage("We couldn't start passkey verification. Try again.");
        return;
      }
      const verification = await authClient.signIn.passkey();
      if (verification.error) {
        setMessage(getPasskeySecurityErrorMessage(verification.error));
        return;
      }
      const result = await postSecurityEndpoint("security/disable-two-factor");
      if (!result) {
        setMessage("We couldn't disable two-factor authentication. Try again.");
        return;
      }
      setPassword("");
      setDisableCode("");
      setBackupCodes(null);
      onDisabled();
      setMessage("Two-factor authentication is disabled.");
    } catch {
      setMessage("We couldn't disable two-factor authentication. Try again.");
    } finally {
      setPendingAction(null);
    }
  }

  return <SettingsTwoFactorSection
    sectionRef={sectionRef}
    enabled={enabled}
    readOnly={readOnly}
    passkeysEnabled={passkeysEnabled}
    password={password}
    code={code}
    disableCode={disableCode}
    totpUri={totpUri}
    backupCodes={backupCodes ?? []}
    backupCodesAcknowledged={backupCodesAcknowledged}
    pendingAction={pendingAction}
    message={message}
    enrollmentOpen={enrollmentOpen}
    enrollmentVerified={enrollmentVerified}
    onPasswordChange={(event) => { setPassword(event.target.value); clearMessage(); }}
    onCodeChange={(event) => { setCode(event.target.value); clearMessage(); }}
    onDisableCodeChange={(event) => { setDisableCode(event.target.value); clearMessage(); }}
    onBackupCodesAcknowledgedChange={(event) => setBackupCodesAcknowledged(event.target.checked)}
    onBeginEnrollment={beginEnrollment}
    onVerifyEnrollment={verifyEnrollment}
    onDisable={disableTwoFactor}
    onDisableWithPasskey={() => { void disableTwoFactorWithPasskey(); }}
    onCloseEnrollment={closeEnrollment}
  />;
}


const securityTips: readonly { readonly icon: LucideIcon; readonly title: string; readonly detail: string; readonly action?: "logout" }[] = [
  { icon: KeyRound, title: "Use a strong password", detail: "Create a unique password with a mix of letters, numbers, and symbols." },
  { icon: ShieldCheck, title: "Enable two-factor authentication", detail: "Add an extra layer of protection to your account." },
  { icon: KeyRound, title: "Save backup codes when shown", detail: "Two-factor backup codes appear once during setup; this deployment does not offer email or phone account recovery." },
  { icon: Monitor, title: "Review active sessions", detail: "Sign out of devices you no longer use.", action: "logout" },
];
export function SettingsManager({ securitySummary, readOnly = false, passkeysEnabled = false, twoFactorEnabled: initialTwoFactorEnabled = false, twoFactorSetupRequired = false, onboardingState = "active" }: { readonly securitySummary: SettingsSecuritySummary; readonly readOnly?: boolean; readonly passkeysEnabled?: boolean; readonly twoFactorEnabled?: boolean; readonly twoFactorSetupRequired?: boolean; readonly onboardingState?: OnboardingState }) {
  const router = useRouter();
  const [values, setValues] = useState<PasswordValues>({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [visibility, setVisibility] = useState<PasswordVisibility>({ currentPassword: false, newPassword: false, confirmPassword: false });
  const [message, setMessage] = useState<string | null>(null);
  const [passwordTotpCode, setPasswordTotpCode] = useState("");
  const [pending, setPending] = useState(false);
  const [logoutConfirmationOpen, setLogoutConfirmationOpen] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutMessage, setLogoutMessage] = useState<string | null>(null);
  const [sessions, setSessions] = useState<readonly SettingsSecuritySession[] | null>(securitySummary.activeSessions);
  const [sessionConfirmationId, setSessionConfirmationId] = useState<string | null>(null);
  const [sessionActionId, setSessionActionId] = useState<string | null>(null);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const [tipsOpen, setTipsOpen] = useState(false);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(initialTwoFactorEnabled);
  const [twoFactorRequirementOpen, setTwoFactorRequirementOpen] = useState(twoFactorSetupRequired && !initialTwoFactorEnabled);
  const [twoFactorRequirementAcknowledged, setTwoFactorRequirementAcknowledged] = useState(false);
  const twoFactorSectionRef = useRef<HTMLElement | null>(null);
  const [passkeys, setPasskeys] = useState<readonly SettingsPasskey[]>([]);
  const [passkeyName, setPasskeyName] = useState("This device");
  const [passkeyMessage, setPasskeyMessage] = useState<string | null>(null);
  const [passkeyPending, setPasskeyPending] = useState(false);
  const passkeysEnabledByServer = passkeysEnabled;
  const [showGettingStartedRestore, setShowGettingStartedRestore] = useState(onboardingState === "dismissed");
  const fetchPasskeys = useCallback(async (): Promise<readonly SettingsPasskey[] | null> => {
    if (!passkeysEnabledByServer || readOnly) return null;
    const result = await authClient.passkey.listUserPasskeys();
    return result.error ? null : result.data ?? [];
  }, [passkeysEnabledByServer, readOnly]);
  const refreshPasskeys = useCallback(async (): Promise<void> => {
    const nextPasskeys = await fetchPasskeys();
    if (nextPasskeys !== null) setPasskeys(nextPasskeys);
  }, [fetchPasskeys]);
  useEffect(() => {
    let subscribed = true;
    void fetchPasskeys().then((nextPasskeys) => {
      if (subscribed && nextPasskeys !== null) setPasskeys(nextPasskeys);
    }, () => undefined);
    return () => { subscribed = false; };
  }, [fetchPasskeys]);
  async function addPasskey(): Promise<void> {
    if (!passkeysEnabledByServer || readOnly) return;
    setPasskeyPending(true); setPasskeyMessage(null);
    try {
      const result = await authClient.passkey.addPasskey({ name: passkeyName.trim() || "This device", createSession: false });
      if (result.error) {
        setPasskeyMessage(getPasskeyRegistrationErrorMessage(result.error));
      }
      else await refreshPasskeys();
    } catch { setPasskeyMessage(getPasskeyRegistrationErrorMessage(null)); }
    finally { setPasskeyPending(false); }
  }
  async function removePasskey(id: string): Promise<void> {
    if (!passkeysEnabledByServer || readOnly || passkeys.length <= 1) return;
    setPasskeyPending(true); setPasskeyMessage(null);
    const result = await authClient.passkey.deletePasskey({ id });
    if (result.error) setPasskeyMessage(getPasskeySecurityErrorMessage(result.error));
    else await refreshPasskeys();
    setPasskeyPending(false);
  }
  const restoreOnboardingAction = useCallback(async (previousState: OnboardingActionState, formData: FormData): Promise<OnboardingActionState> => {
    const result = await updateOnboardingStateAction(previousState, formData);
    if (result.ok && result.state === "active") setShowGettingStartedRestore(false);
    return result;
  }, []);
  const [onboardingRestoreState, onboardingRestoreAction, onboardingRestorePending] = useActionState(restoreOnboardingAction, initialOnboardingActionState);
  useEffect(() => {
    if (twoFactorRequirementOpen || !twoFactorSetupRequired || twoFactorEnabled) return;
    const frame = window.requestAnimationFrame(() => {
      const section = twoFactorSectionRef.current;
      if (!section) return;
      section.scrollIntoView({ behavior: "smooth", block: "start" });
      section.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [twoFactorEnabled, twoFactorRequirementOpen, twoFactorSetupRequired]);
  const passwordDate = securitySummary.passwordChangedAt ? formatSessionDate(securitySummary.passwordChangedAt) : "Not available";
  const sessionCount = sessions === null ? "Not available" : String(sessions.length);

  function updateValue(field: keyof PasswordValues, event: ChangeEvent<HTMLInputElement>) {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setMessage(null);
  }

  function toggleVisibility(field: keyof PasswordVisibility) {
    setVisibility((current) => ({ ...current, [field]: !current[field] }));
  }

  function finishTwoFactorRequirement() {
    if (!twoFactorRequirementAcknowledged || twoFactorEnabled) return;
    setTwoFactorRequirementOpen(false);
  }

  async function revokeSession(sessionId: string) {
    setSessionActionId(sessionId);
    setSessionMessage(null);
    try {
      const result = await revokeSettingsSessionAction(sessionId);
      if (!result.ok) {
        setSessionMessage(result.message ?? "We couldn't revoke that session. Please try again.");
        return;
      }
      const revokedSession = sessions?.find((session) => session.id === sessionId);
      setSessions((current) => current?.filter((session) => session.id !== sessionId) ?? null);
      setSessionConfirmationId(null);
      if (revokedSession?.isCurrent) {
        try {
          await authClient.signOut();
        } finally {
          router.replace("/login");
          router.refresh();
        }
      }
    } catch {
      setSessionMessage("We couldn't revoke that session. Please try again.");
    } finally {
      setSessionActionId(null);
    }
  }

  async function logoutEverywhere() {
    setLogoutPending(true);
    setLogoutMessage(null);
    try {
      const result = await authClient.revokeSessions();
      if (result.error) {
        setLogoutMessage("We couldn't sign out all sessions. Please try again.");
        return;
      }
      try {
        await authClient.signOut();
      } finally {
        router.replace("/login");
        router.refresh();
      }
    } catch {
      setLogoutMessage("We couldn't sign out all sessions. Please try again.");
    } finally {
      setLogoutPending(false);
    }
  }

  async function changePasswordWithPasskey(): Promise<void> {
    const validationMessage = validatePasswordChange(values, { requireCurrentPassword: false });
    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }
    if (!passkeysEnabledByServer) {
      setMessage("Passkey verification is not available in this deployment.");
      return;
    }

    setPending(true);
    setMessage(null);
    try {
      const intentStarted = await postSecurityEndpoint("security/request-passkey-proof", { operation: "password-change" });
      if (!intentStarted) {
        setMessage("We couldn't start passkey verification. Try again.");
        return;
      }
      const verification = await authClient.signIn.passkey();
      if (verification.error) {
        setMessage(getPasskeySecurityErrorMessage(verification.error));
        return;
      }
      const result = await postSecurityEndpoint("security/change-password", { newPassword: values.newPassword });
      if (!result) {
        setMessage("We couldn't change your password after passkey verification. Try again.");
        return;
      }
      try {
        await authClient.signOut();
      } finally {
          router.replace("/login");
          router.refresh();
      }
    } catch {
      setMessage("We couldn't change your password after passkey verification. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationMessage = validatePasswordChange(values);
    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }
    if (twoFactorEnabled && !passwordTotpCode.trim()) {
      setMessage("Enter the current code from your authenticator app, or use a passkey instead.");
      return;
    }

    setPending(true);
    setMessage(null);
    try {
      if (twoFactorEnabled) {
        const intentStarted = await postSecurityEndpoint("security/request-password-proof", { operation: "password-change", password: values.currentPassword });
        if (!intentStarted) {
          setMessage("We couldn't verify your current password. Try again.");
          return;
        }
        const verification = await authClient.twoFactor.verifyTotp({ code: passwordTotpCode.trim() });
        if (verification.error) {
          setMessage("We couldn't verify that code. Check it and try again.");
          return;
        }
      }
      const result = await authClient.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
        revokeOtherSessions: true,
      });
      if (result.error) {
        setMessage(getPasswordChangeErrorMessage(result.error));
        return;
      }
      try {
        await authClient.signOut();
      } finally {
          router.replace("/login");
          router.refresh();
      }
    } catch {
      setMessage("We couldn't change your password. Check your current password and try again.");
    } finally {
      setPending(false);
    }
  }

  return <div className="settings-dashboard">
    <section className="settings-security-strip editorial-page-art-surface" aria-label="Account security summary">
      <SecurityMetric icon={LockKeyhole} label="Password" value={passwordDate} detail="Last changed" status={securitySummary.passwordChangedAt ? "Strong" : "Not available"} tone={securitySummary.passwordChangedAt ? "positive" : "neutral"} />
      <SecurityMetric icon={Monitor} label="Sessions" value={sessionCount} detail="Active sessions" status={securitySummary.activeSessionCount === null ? "Unavailable" : "Secure"} tone={securitySummary.activeSessionCount === null ? "neutral" : "positive"} />
      <SecurityMetric icon={ShieldCheck} label="Recovery" value="Backup codes only" detail="No email or phone recovery" status="Info" tone="neutral" />
      <SecurityMetric icon={Link2} label="Sign-in protection" value={readOnly ? "Not available" : twoFactorEnabled ? "Enabled" : "Not enabled"} detail="2FA" status={readOnly ? "Unavailable" : twoFactorEnabled ? "On" : "Off"} tone={twoFactorEnabled ? "positive" : "neutral"} />
    </section>

    {showGettingStartedRestore && !readOnly ? <SettingsOnboardingRestoreSection action={onboardingRestoreAction} pending={onboardingRestorePending} /> : null}
    <TwoFactorSecurityPanel sectionRef={twoFactorSectionRef} enabled={twoFactorEnabled} readOnly={readOnly} passkeysEnabled={passkeysEnabledByServer} onEnabled={() => setTwoFactorEnabled(true)} onDisabled={() => setTwoFactorEnabled(false)} />
    {twoFactorSetupRequired && !twoFactorEnabled ? <ConfirmationDialog
      open={twoFactorRequirementOpen}
      eyebrow="Action required"
      title="Two-factor authentication is required"
      description="Set up an authenticator app before continuing to use Athena Vault. You can begin setup in the security card below."
      confirmLabel="Continue to setup"
      cancelLabel={null}
      restoreFocus={false}
      acknowledgement={{
        label: "I understand that I must set up two-factor authentication to continue.",
        description: "After you acknowledge this message, we will take you to the setup card.",
        checked: twoFactorRequirementAcknowledged,
        onChange: setTwoFactorRequirementAcknowledged,
      }}
      onConfirm={finishTwoFactorRequirement}
      onCancel={finishTwoFactorRequirement}
    /> : null}
    <SettingsPasskeySection
      enabled={passkeysEnabledByServer}
      twoFactorEnabled={twoFactorEnabled}
      readOnly={readOnly}
      passkeys={passkeys}
      name={passkeyName}
      message={passkeyMessage}
      pending={passkeyPending}
      onNameChange={(event) => setPasskeyName(event.target.value)}
      onAdd={() => { void addPasskey(); }}
      onRemove={(id) => { void removePasskey(id); }}
    />
    <div className="settings-main-grid">
      <SettingsPasswordSection
        readOnly={readOnly}
        twoFactorEnabled={twoFactorEnabled}
        passkeysEnabled={passkeysEnabledByServer}
        values={values}
        visibility={visibility}
        totpCode={passwordTotpCode}
        pending={pending}
        message={message}
        onSubmit={submit}
        onValueChange={updateValue}
        onVisibilityToggle={toggleVisibility}
        onTotpCodeChange={(event) => { setPasswordTotpCode(event.target.value); setMessage(null); }}
        onPasskeyChange={() => { void changePasswordWithPasskey(); }}
      />
      <aside className="card section-card settings-tips-card editorial-page-art-surface" aria-label="Security tips" data-mobile-open={tipsOpen}>
        <button className="settings-tips-toggle" type="button" aria-controls="settings-tips-content" aria-expanded={tipsOpen} onClick={() => setTipsOpen((current) => !current)}>
          <span><span className="eyebrow">Security tips</span><span className="settings-tips-toggle-title">Simple steps to keep your account secure.</span></span>
          <ChevronDown aria-hidden="true" size={22} strokeWidth={1.8} />
        </button>
        <div className="settings-tips-heading">
          <p className="eyebrow"><ShieldCheck aria-hidden="true" size={15} strokeWidth={1.8} /> Security tips</p>
          <h2 className="card-title" id="settings-tips-heading">Simple steps to keep your account secure.</h2>
        </div>
        <div className="settings-tips-content" id="settings-tips-content">
           <div className="settings-tips-list">{securityTips.filter(({ action }) => !(readOnly && action === "logout")).map(({ icon: Icon, title, detail, action }) => <div className="settings-tip" key={title}><span className="settings-tip-icon"><Icon aria-hidden="true" size={16} strokeWidth={1.8} /></span><div className="settings-tip-content"><strong>{title}</strong><small>{detail}</small>{action === "logout" ? logoutConfirmationOpen ? <div className="settings-session-confirmation" role="alertdialog" aria-label="Confirm log out everywhere"><strong>Sign out of all devices?</strong><small>This will end every active session.</small><div><button className="settings-session-confirm-button" type="button" onClick={logoutEverywhere} disabled={logoutPending}>{logoutPending ? "Signing out…" : "Confirm"}</button><button className="settings-session-cancel-button" type="button" onClick={() => { setLogoutConfirmationOpen(false); setLogoutMessage(null); }} disabled={logoutPending}>Cancel</button></div></div> : <button className="settings-session-review-action" type="button" onClick={() => { setLogoutConfirmationOpen(true); setLogoutMessage(null); }}>Log out everywhere</button> : null}{logoutMessage && action === "logout" ? <small className="settings-session-message" role="alert">{logoutMessage}</small> : null}</div></div>)}</div>
          <Link className="settings-tips-link" href="/security">Learn more about account security <ArrowRight aria-hidden="true" size={15} strokeWidth={1.8} /></Link>
        </div>
      </aside>
    </div>
    <div className="settings-security-history-grid">
      <SettingsSessionSection
        readOnly={readOnly}
        sessions={sessions}
        confirmationId={sessionConfirmationId}
        actionId={sessionActionId}
        message={sessionMessage}
        onConfirmRevoke={revokeSession}
        onCancelRevoke={() => setSessionConfirmationId(null)}
        onRequestRevoke={(id) => { setSessionConfirmationId(id); setSessionMessage(null); }}
      />
      {!readOnly && securitySummary.securityActivity !== undefined ? <SettingsSecurityActivitySection activity={securitySummary.securityActivity} /> : null}
    </div>
    <ActionNotification state={onboardingRestoreState} />
  </div>;
}
