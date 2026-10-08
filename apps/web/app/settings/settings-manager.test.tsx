import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const routerMocks = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routerMocks }));
vi.mock("../../lib/auth-client", () => ({
  authClient: {
    changePassword: vi.fn(),
    revokeSessions: vi.fn(),
    signOut: vi.fn(),
    passkey: { listUserPasskeys: vi.fn(), addPasskey: vi.fn(), deletePasskey: vi.fn() },
    signIn: { passkey: vi.fn() },
    twoFactor: { enable: vi.fn(), verifyTotp: vi.fn(), disable: vi.fn() },
  },
}));
vi.mock("./actions", () => ({ revokeSettingsSessionAction: vi.fn() }));
vi.mock("../onboarding-actions", () => ({ updateOnboardingStateAction: vi.fn() }));

import { getPasskeyRegistrationErrorMessage, getPasswordChangeErrorMessage, SettingsManager, validatePasswordChange } from "./settings-manager";
import { PASSWORD_BREACH_CHECK_UNAVAILABLE_ERROR, PASSWORD_COMPROMISED_ERROR, PASSWORD_POLICY_ERROR } from "../../lib/password-policy";

const securitySummary = {
  passwordChangedAt: "2026-08-18T00:00:00.000Z",
  activeSessionCount: 2,
  activeSessions: [
    { id: "session-a", createdAt: "2026-08-18T10:00:00.000Z", updatedAt: "2026-08-18T12:00:00.000Z", expiresAt: "2026-08-25T10:00:00.000Z", userAgent: "Mozilla/5.0 Chrome/120.0 Windows", isCurrent: true },
  ],
} as const;

function renderSettings(props: Partial<React.ComponentProps<typeof SettingsManager>> = {}) {
  return renderToStaticMarkup(React.createElement(SettingsManager, { securitySummary, ...props }));
}

describe("settings security presentation", () => {
  it("renders password controls, security summaries, tips, and active session actions", () => {
    const markup = renderSettings();

    expect(markup).toContain('id="currentPassword"');
    expect(markup).toContain('autoComplete="current-password"');
    expect(markup).toContain('id="newPassword"');
    expect(markup).toContain('autoComplete="new-password"');
    expect(markup).toContain("Confirm new password");
    expect(markup).toContain(PASSWORD_POLICY_ERROR);
    expect(markup).toContain("Change password");
    expect(markup).toContain("Backup codes only");
    expect(markup).toContain("Security tips");
    expect(markup).toContain("Review active sessions");
    expect(markup).toContain("Log out everywhere");
    expect(markup).toContain("Current session");
    expect(markup).toContain("Revoke");
    expect(markup).toContain("Enable TOTP");
  });

  it("renders allowlisted security activity without exposing session metadata", () => {
    const markup = renderSettings({
      securitySummary: {
        passwordChangedAt: null,
        activeSessionCount: null,
        activeSessions: null,
        securityActivity: [
          { createdAt: "2026-09-01T00:00:00.000Z", operation: "session-create", status: "success" },
          { createdAt: "2026-09-01T00:01:00.000Z", operation: "backup-codes-regenerate", status: "success" },
        ],
      },
    });

    expect(markup).toContain("Security activity");
    expect(markup).toContain("Signed in");
    expect(markup).toContain("Backup codes regenerated");
    expect(markup).not.toMatch(/sessionId|token|recoveryCode|userAgent|ipAddress/i);
  });

  it("shows the Getting Started restore action only when dismissed", () => {
    expect(renderSettings({ onboardingState: "dismissed" })).toContain('name="state" value="active"');
    expect(renderSettings({ onboardingState: "active" })).not.toContain("Show the Getting Started guide back");
  });

  it("keeps the shared demo read-only and hides account/session mutation controls", () => {
    const markup = renderSettings({ readOnly: true });

    expect(markup).toContain("Shared demo workspace");
    expect(markup).toContain("Data and credentials cannot be changed");
    expect(markup).toContain("Not available on the demo workspace.");
    expect(markup).toContain("Session details stay private");
    expect(markup).toContain("session metadata is never loaded or shown");
    expect(markup).not.toContain('id="currentPassword"');
    expect(markup).not.toContain("Change password");
    expect(markup).not.toContain("Enable TOTP");
    expect(markup).not.toContain("Log out everywhere");
    expect(markup).not.toContain('class="settings-session-row"');
    expect(markup).not.toContain(">Revoke<");
  });

  it("renders enabled TOTP controls and the mandatory setup acknowledgement", () => {
    const enabled = renderSettings({ twoFactorEnabled: true, passkeysEnabled: true });
    const required = renderSettings({ twoFactorSetupRequired: true });

    expect(enabled).toContain("Disable two-factor authentication");
    expect(enabled).toContain('id="two-factor-password"');
    expect(enabled).toContain('id="two-factor-disable-code"');
    expect(enabled).toContain("Use a passkey instead");
    expect(enabled).not.toContain("Enable TOTP");
    expect(required).toContain("Two-factor authentication is required");
    expect(required).toContain("I understand that I must set up two-factor authentication to continue.");
    expect(required).toContain("Continue to setup");
    expect(required).toContain('id="settings-two-factor-section"');
  });

  it("keeps sessions and activity in the security history view", () => {
    const markup = renderSettings({
      securitySummary: {
        ...securitySummary,
        securityActivity: [{ operation: "signed_in", status: "success", createdAt: "2026-09-07T00:00:00.000Z" }],
      },
    });

    expect(markup).toContain('class="settings-security-history-grid"');
    expect(markup.indexOf('id="settings-sessions-heading"')).toBeLessThan(markup.indexOf('id="settings-activity-heading"'));
  });
});

describe("settings security validation", () => {
  it("validates password quality and confirmation before authentication", () => {
    expect(validatePasswordChange({ currentPassword: "current", newPassword: "short", confirmPassword: "short" })).toBe(PASSWORD_POLICY_ERROR);
    expect(validatePasswordChange({ currentPassword: "current", newPassword: "a".repeat(12), confirmPassword: "a".repeat(12) })).toBe(PASSWORD_POLICY_ERROR);
    expect(validatePasswordChange({ currentPassword: "current", newPassword: "1".repeat(12), confirmPassword: "1".repeat(12) })).toBe(PASSWORD_POLICY_ERROR);
    expect(validatePasswordChange({ currentPassword: "correct horse1", newPassword: "correct horse1", confirmPassword: "different" })).toBe("New password and confirmation do not match.");
    expect(validatePasswordChange({ currentPassword: "current", newPassword: "correct horse1", confirmPassword: "correct horse1" })).toBeNull();
    expect(validatePasswordChange({ currentPassword: "", newPassword: "correct horse1", confirmPassword: "correct horse1" }, { requireCurrentPassword: false })).toBeNull();
  });

  it("maps authentication and passkey failures to safe, actionable messages", () => {
    expect(getPasswordChangeErrorMessage({ code: "PASSWORD_COMPROMISED" })).toBe(PASSWORD_COMPROMISED_ERROR);
    expect(getPasswordChangeErrorMessage({ code: "INTERNAL_SERVER_ERROR" })).toBe(PASSWORD_BREACH_CHECK_UNAVAILABLE_ERROR);
    expect(getPasswordChangeErrorMessage({ code: "INVALID_PASSWORD" })).toContain("Check your current password");
    expect(getPasskeyRegistrationErrorMessage({ code: "SESSION_NOT_FRESH" })).toContain("recent sign-in");
    expect(getPasskeyRegistrationErrorMessage({ code: "INVALID_ORIGIN" })).toContain("configured secure address");
    expect(getPasskeyRegistrationErrorMessage({ code: "internal-secret" })).toBe("We couldn't register that passkey. Check your browser and try again.");
  });
});
