"use client";

import React, { type ChangeEvent } from "react";
import { Eye, EyeOff, LockKeyhole, type LucideIcon } from "lucide-react";
export { DemoSessionPrivacyNotice } from "./settings-demo-notices";

export type PasswordValues = {
  readonly currentPassword: string;
  readonly newPassword: string;
  readonly confirmPassword: string;
};
export type PasswordVisibility = {
  readonly currentPassword: boolean;
  readonly newPassword: boolean;
  readonly confirmPassword: boolean;
};
export type SecurityMetricProps = {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly status: string;
  readonly tone: "positive" | "neutral";
};
const dateFormatter = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
export function formatSessionDate(value: string): string {
  return dateFormatter.format(new Date(value));
}
export function sessionDeviceLabel(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Chrome\//.test(userAgent) ? "Chrome" : /Firefox\//.test(userAgent) ? "Firefox" : /Safari\//.test(userAgent) ? "Safari" : "Browser";
  const operatingSystem = /Windows/.test(userAgent) ? "Windows" : /Mac OS X/.test(userAgent) ? "macOS" : /Android/.test(userAgent) ? "Android" : /iPhone|iPad/.test(userAgent) ? "iOS" : /Linux/.test(userAgent) ? "Linux" : "device";
  return `${browser} on ${operatingSystem}`;
}
export function SecurityMetric({ icon: Icon, label, value, detail, status, tone }: SecurityMetricProps) {
  return <article className="settings-security-metric">
    <span className="settings-security-metric-icon"><Icon aria-hidden="true" size={22} strokeWidth={1.7} /></span>
    <div className="settings-security-metric-copy"><small>{label}</small><strong>{value}</strong><span>{detail}</span></div>
    <span className={`settings-security-status is-${tone}`}>{status}</span>
  </article>;
}
export function PasswordField({
  id,
  label,
  autoComplete,
  value,
  visible,
  onChange,
  onToggle,
}: {
  readonly id: keyof PasswordValues;
  readonly label: string;
  readonly autoComplete: string;
  readonly value: string;
  readonly visible: boolean;
  readonly onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onToggle: () => void;
}) {
  return <label className="settings-password-field" htmlFor={id}>
    <span className="settings-password-label">{label}</span>
    <span className="settings-password-input-shell">
      <LockKeyhole aria-hidden="true" size={17} strokeWidth={1.8} />
      <input id={id} name={id} type={visible ? "text" : "password"} autoComplete={autoComplete} value={value} onChange={onChange} required />
      <button type="button" className="settings-password-toggle" onClick={onToggle} aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}>
        {visible ? <EyeOff aria-hidden="true" size={17} strokeWidth={1.8} /> : <Eye aria-hidden="true" size={17} strokeWidth={1.8} />}
      </button>
    </span>
  </label>;
}
export function TwoFactorPasswordField({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return <label className="settings-password-field" htmlFor="two-factor-password">
    <span className="settings-password-label">Current password</span>
    <span className="settings-password-input-shell">
      <LockKeyhole aria-hidden="true" size={17} strokeWidth={1.8} />
      <input id="two-factor-password" name="twoFactorPassword" type="password" autoComplete="current-password" value={value} onChange={onChange} required />
    </span>
  </label>;
}
