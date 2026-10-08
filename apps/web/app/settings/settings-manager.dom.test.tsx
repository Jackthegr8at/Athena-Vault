// @vitest-environment jsdom

import React, { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { changeInput, click, createDomTestRoot } from "../../test/dom";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  changePassword: vi.fn(),
  revokeSessions: vi.fn(),
  signOut: vi.fn(),
  enableTwoFactor: vi.fn(),
  verifyTotp: vi.fn(),
  disableTwoFactor: vi.fn(),
  signInPasskey: vi.fn(),
  listUserPasskeys: vi.fn(),
  addPasskey: vi.fn(),
  deletePasskey: vi.fn(),
  revokeSettingsSessionAction: vi.fn(),
  updateOnboardingStateAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }) }));
vi.mock("../../lib/auth-client", () => ({
  authClient: {
    passkey: {
      listUserPasskeys: mocks.listUserPasskeys,
      addPasskey: mocks.addPasskey,
      deletePasskey: mocks.deletePasskey,
    },
    twoFactor: { enable: mocks.enableTwoFactor, verifyTotp: mocks.verifyTotp, disable: mocks.disableTwoFactor },
    signIn: { passkey: mocks.signInPasskey },
    changePassword: mocks.changePassword,
    revokeSessions: mocks.revokeSessions,
    signOut: mocks.signOut,
  },
}));
vi.mock("../onboarding-actions", () => ({ updateOnboardingStateAction: mocks.updateOnboardingStateAction }));
vi.mock("./actions", () => ({ revokeSettingsSessionAction: mocks.revokeSettingsSessionAction }));
vi.mock("next/dynamic", () => ({ default: () => TwoFactorEnrollmentDialog }));

import { TwoFactorEnrollmentDialog } from "./settings-two-factor-dialog";
import { SettingsManager } from "./settings-manager";

const dom = createDomTestRoot();
const securitySummary = { passwordChangedAt: null, activeSessionCount: 0, activeSessions: [] } as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SettingsManager effect boundaries", () => {
  it("subscribes to the asynchronous passkey load and renders the loaded list", async () => {
    mocks.listUserPasskeys.mockResolvedValue({ error: null, data: [{ id: "passkey-1", name: "Laptop", createdAt: "2026-09-20T12:00:00.000Z" }] });

    await dom.render(<SettingsManager securitySummary={securitySummary} passkeysEnabled />);

    expect(mocks.listUserPasskeys).toHaveBeenCalledOnce();
    expect(dom.container.textContent).toContain("Laptop");
  });

  it("does not load passkeys in read-only mode", async () => {
    mocks.listUserPasskeys.mockClear();
    await dom.render(<SettingsManager securitySummary={securitySummary} passkeysEnabled readOnly />);

    expect(mocks.listUserPasskeys).not.toHaveBeenCalled();
    expect(dom.container.textContent).toContain("Not available on the demo workspace.");
  });

  it("hides the restore control at the successful onboarding-action boundary", async () => {
    mocks.updateOnboardingStateAction.mockResolvedValue({ ok: true, message: "Getting started is active again.", state: "active" });
    await dom.render(<SettingsManager securitySummary={securitySummary} onboardingState="dismissed" />);

    const button = dom.get<HTMLButtonElement>('form.settings-onboarding-form button[type="submit"]');
    await act(async () => {
      button.form?.requestSubmit(button);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mocks.updateOnboardingStateAction).toHaveBeenCalledOnce();
    expect(dom.container.querySelector(".settings-onboarding-card")).toBeNull();
  });

  it("changes a password through Better Auth and revokes the other sessions", async () => {
    mocks.changePassword.mockResolvedValue({ error: null });
    mocks.signOut.mockResolvedValue(undefined);
    await dom.render(<SettingsManager securitySummary={securitySummary} />);
    await changeInput(dom.get<HTMLInputElement>("#currentPassword"), "current password");
    await changeInput(dom.get<HTMLInputElement>("#newPassword"), "correct horse1");
    await changeInput(dom.get<HTMLInputElement>("#confirmPassword"), "correct horse1");

    await act(async () => {
      dom.get<HTMLFormElement>(".settings-password-form").requestSubmit();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mocks.changePassword).toHaveBeenCalledWith({ currentPassword: "current password", newPassword: "correct horse1", revokeOtherSessions: true });
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(mocks.replace).toHaveBeenCalledWith("/login");
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("registers a passkey with its chosen name and refreshes the rendered list", async () => {
    mocks.listUserPasskeys.mockResolvedValue({ error: null, data: [{ id: "passkey-1", name: "Existing key", createdAt: "2026-09-20T12:00:00.000Z" }] });
    mocks.addPasskey.mockResolvedValue({ error: null });
    await dom.render(<SettingsManager securitySummary={securitySummary} passkeysEnabled />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    await changeInput(dom.get<HTMLInputElement>('input[aria-label="Passkey name"]'), "Travel laptop");
    await click(dom.get<HTMLButtonElement>('button[type="button"]:is(.navy-action-button)'));

    expect(mocks.addPasskey).toHaveBeenCalledWith({ name: "Travel laptop", createSession: false });
    expect(mocks.listUserPasskeys).toHaveBeenCalledTimes(2);
    expect(dom.container.textContent).toContain("Existing key");
  });

  it("requires confirmation before revoking a session and signs out if it is current", async () => {
    mocks.revokeSettingsSessionAction.mockResolvedValue({ ok: true, message: "Session revoked." });
    mocks.signOut.mockResolvedValue(undefined);
    const summary = {
      passwordChangedAt: null,
      activeSessionCount: 1,
      activeSessions: [{ id: "current-session", createdAt: "2026-09-21T10:00:00.000Z", updatedAt: "2026-09-21T11:00:00.000Z", expiresAt: "2026-09-28T10:00:00.000Z", userAgent: "Mozilla/5.0 Chrome/120.0 Windows", isCurrent: true }],
    } as const;
    await dom.render(<SettingsManager securitySummary={summary} />);

    await click(dom.get<HTMLButtonElement>(".settings-session-revoke-button"));
    expect(dom.get('[role="alertdialog"]').textContent).toContain("Revoke this session?");
    await click(dom.get<HTMLButtonElement>(".settings-row-confirmation .settings-session-confirm-button"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    expect(mocks.revokeSettingsSessionAction).toHaveBeenCalledWith("current-session");
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(mocks.replace).toHaveBeenCalledWith("/login");
    expect(dom.container.querySelector(".settings-session-row")).toBeNull();
  });

  it("requires confirmation before signing out all sessions", async () => {
    mocks.revokeSessions.mockResolvedValue({ error: null });
    mocks.signOut.mockResolvedValue(undefined);
    await dom.render(<SettingsManager securitySummary={securitySummary} />);

    await click(dom.get<HTMLButtonElement>(".settings-session-review-action"));
    expect(dom.get('[role="alertdialog"]').textContent).toContain("Sign out of all devices?");
    await click(dom.get<HTMLButtonElement>(".settings-session-confirmation .settings-session-cancel-button"));
    expect(mocks.revokeSessions).not.toHaveBeenCalled();

    await click(dom.get<HTMLButtonElement>(".settings-session-review-action"));
    await click(dom.get<HTMLButtonElement>(".settings-session-confirmation .settings-session-confirm-button"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    expect(mocks.revokeSessions).toHaveBeenCalledOnce();
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(mocks.replace).toHaveBeenCalledWith("/login");
  });

  it("completes TOTP enrollment and requires backup-code acknowledgement before closing", async () => {
    mocks.enableTwoFactor.mockResolvedValue({
      error: null,
      data: { method: "totp", totpURI: "otpauth://totp/Athena:owner?secret=not-a-real-secret", backupCodes: ["test-code-one", "test-code-two"] },
    });
    mocks.verifyTotp.mockResolvedValue({ error: null });
    await dom.render(<SettingsManager securitySummary={securitySummary} />);
    await changeInput(dom.get<HTMLInputElement>("#two-factor-password"), "current password");
    await act(async () => {
      dom.get<HTMLFormElement>("#settings-two-factor-section .settings-two-factor-form").requestSubmit();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const dialog = document.querySelector<HTMLDialogElement>("dialog.settings-two-factor-dialog");
    expect(dialog?.textContent).toContain("test-code-one");
    await changeInput(dialog!.querySelector<HTMLInputElement>("#two-factor-code")!, "123456");
    await act(async () => {
      dialog!.querySelector<HTMLFormElement>(".settings-two-factor-dialog-form")!.requestSubmit();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mocks.enableTwoFactor).toHaveBeenCalledWith({ password: "current password", method: "totp" });
    expect(mocks.verifyTotp).toHaveBeenCalledWith({ code: "123456" });
    expect(dom.get(".settings-two-factor-status").textContent).toBe("Enabled");
    expect(dialog?.querySelector<HTMLButtonElement>('button[aria-label="Close two-factor setup"]')?.disabled).toBe(true);
    await click(dialog!.querySelector<HTMLInputElement>(".settings-two-factor-dialog-acknowledgement input")!);
    await click(dialog!.querySelector<HTMLButtonElement>(".settings-two-factor-dialog-footer button")!);
    expect(document.querySelector("dialog.settings-two-factor-dialog")).toBeNull();
  });
});
