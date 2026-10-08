import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ShieldCheck } from "lucide-react";
import {
  DemoSessionPrivacyNotice,
  formatSessionDate,
  PasswordField,
  SecurityMetric,
  sessionDeviceLabel,
  TwoFactorPasswordField,
} from "./settings-presentation";

describe("settings-presentation", () => {
  it("formatSessionDate formats UTC dates", () => {
    expect(formatSessionDate("2026-09-01T10:00:00.000Z")).toContain("Sep");
    expect(formatSessionDate("2026-01-05T00:00:00.000Z")).toContain("2026");
  });

  it("sessionDeviceLabel extracts browser and operating system", () => {
    expect(sessionDeviceLabel("Mozilla/5.0 Chrome/120.0 Windows")).toBe("Chrome on Windows");
    expect(sessionDeviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15")).toBe("Browser on macOS");
    expect(sessionDeviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("Browser on macOS");
    expect(sessionDeviceLabel(null)).toBe("Unknown device");
    expect(sessionDeviceLabel("")).toBe("Unknown device");
  });

  it("SecurityMetric renders accessible card markup", () => {
    const markup = renderToStaticMarkup(
      <SecurityMetric
        icon={ShieldCheck}
        label="Password"
        value="Set"
        detail="Changed 2 days ago"
        status="Current"
        tone="positive"
      />
    );
    expect(markup).toContain("settings-security-metric");
    expect(markup).toContain("Set");
    expect(markup).toContain("Current");
    expect(markup).toContain('aria-hidden="true"');
  });

  it("PasswordField renders accessible input and toggle button", () => {
    const markup = renderToStaticMarkup(
      <PasswordField
        id="newPassword"
        label="New password"
        autoComplete="new-password"
        value="secret"
        visible={false}
        onChange={() => undefined}
        onToggle={() => undefined}
      />
    );
    expect(markup).toContain('id="newPassword"');
    expect(markup).toContain('type="password"');
    expect(markup).toContain("required");
    expect(markup).toContain("<button");
    expect(markup).toContain('type="button"');
    expect(markup).toContain('aria-label="Show new password"');
    expect(markup).toContain('autoComplete="new-password"');
  });

  it("PasswordField toggles input type and aria label when visible", () => {
    const markup = renderToStaticMarkup(
      <PasswordField
        id="newPassword"
        label="New password"
        autoComplete="new-password"
        value="secret"
        visible={true}
        onChange={() => undefined}
        onToggle={() => undefined}
      />
    );
    expect(markup).toContain('type="text"');
    expect(markup).toContain('aria-label="Hide new password"');
  });

  it("TwoFactorPasswordField renders a controlled password input", () => {
    const markup = renderToStaticMarkup(
      <TwoFactorPasswordField value="token" onChange={() => undefined} />
    );
    expect(markup).toContain('id="two-factor-password"');
    expect(markup).toContain('type="password"');
    expect(markup).toContain('name="twoFactorPassword"');
  });

  it("DemoSessionPrivacyNotice renders the demo-only state", () => {
    const markup = renderToStaticMarkup(<DemoSessionPrivacyNotice />);
    expect(markup).toContain('aria-labelledby="settings-demo-privacy-heading"');
    expect(markup).toContain("Session details stay private");
    expect(markup).not.toContain("DemoSessionPrivacyNotice");
    expect(markup).toContain("read-only");
  });
});
