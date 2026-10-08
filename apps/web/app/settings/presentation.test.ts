import { describe, expect, it } from "vitest";
import { buildSettingsHelpSnapshot } from "./presentation";

describe("Settings page help presentation", () => {
  it("points an incomplete security record to password security", () => {
    expect(buildSettingsHelpSnapshot({ hasPasswordChangeRecord: false, activeSessionCount: 1, hasCurrentSession: true, twoFactorEnabled: false }).action).toEqual({ label: "Review password security", href: "/settings#settings-password-heading" });
  });

  it("points multi-session workspaces to the session review", () => {
    expect(buildSettingsHelpSnapshot({ hasPasswordChangeRecord: true, activeSessionCount: 2, hasCurrentSession: true, twoFactorEnabled: false }).action).toEqual({ label: "Review active sessions", href: "/settings#settings-sessions-heading" });
  });

  it("reports only non-sensitive security status", () => {
    expect(buildSettingsHelpSnapshot({ hasPasswordChangeRecord: true, activeSessionCount: 1, hasCurrentSession: true, twoFactorEnabled: false })).toEqual({
      items: [
        { label: "Password status", value: "Recorded" },
        { label: "Active sessions", value: "1" },
        { label: "Current session", value: "Active" },
        { label: "Recovery options", value: "Backup codes only" },
        { label: "Two-factor authentication", value: "Not enabled" },
      ],
      action: { label: "Review account security", href: "/settings" },
    });
  });

  it("reports enabled two-factor protection without exposing enrollment data", () => {
    expect(buildSettingsHelpSnapshot({ hasPasswordChangeRecord: true, activeSessionCount: 1, hasCurrentSession: true, twoFactorEnabled: true }).items.at(-1)).toEqual({ label: "Two-factor authentication", value: "Enabled" });
  });
  it("describes recovery truthfully without promising email or phone recovery", () => {
    const result = buildSettingsHelpSnapshot({ hasPasswordChangeRecord: true, activeSessionCount: 1, hasCurrentSession: true, twoFactorEnabled: false });
    const recovery = result.items.find((item) => item.label === "Recovery options");
    expect(recovery).toEqual({ label: "Recovery options", value: "Backup codes only" });
    expect(recovery?.value).not.toMatch(/email/i);
    expect(recovery?.value).not.toMatch(/phone/i);
  });

  it("does not include session identifiers, tokens, or recovery codes in the help snapshot", () => {
    const result = buildSettingsHelpSnapshot({
      hasPasswordChangeRecord: true,
      activeSessionCount: 3,
      hasCurrentSession: true,
      twoFactorEnabled: true,
    });
    const serialized = JSON.stringify(result).toLowerCase();
    expect(serialized).not.toContain("sessionid");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("recoverycode");
    expect(serialized).not.toContain("useragent");
    expect(serialized).not.toContain("ipaddress");
    expect(result.items).toHaveLength(5);
  });
});
