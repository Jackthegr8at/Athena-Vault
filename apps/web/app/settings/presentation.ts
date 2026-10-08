import { SETTINGS_PAGE_HELP_CONTENT, type PageHelpSnapshot, type SettingsPageHelpActionId } from "../components/page-help-content";

export interface SettingsHelpSnapshotInput {
  readonly hasPasswordChangeRecord: boolean;
  readonly activeSessionCount: number | null;
  readonly hasCurrentSession: boolean | null;
  readonly twoFactorEnabled: boolean;
}

const SETTINGS_PAGE_HELP_ACTION_HREFS: Readonly<Record<SettingsPageHelpActionId, string>> = {
  password: "/settings#settings-password-heading",
  sessions: "/settings#settings-sessions-heading",
  review: "/settings",
};

export function buildSettingsHelpSnapshot(input: SettingsHelpSnapshotInput): PageHelpSnapshot {
  let actionId: SettingsPageHelpActionId;
  if (!input.hasPasswordChangeRecord) actionId = "password";
  else if (input.activeSessionCount !== null && input.activeSessionCount > 1) actionId = "sessions";
  else actionId = "review";

  return {
    items: [
      { label: SETTINGS_PAGE_HELP_CONTENT.snapshotLabels.passwordStatus, value: input.hasPasswordChangeRecord ? "Recorded" : "Not recorded" },
      { label: SETTINGS_PAGE_HELP_CONTENT.snapshotLabels.activeSessions, value: input.activeSessionCount === null ? "Unavailable" : String(input.activeSessionCount) },
      { label: SETTINGS_PAGE_HELP_CONTENT.snapshotLabels.currentSession, value: input.hasCurrentSession === null ? "Unavailable" : input.hasCurrentSession ? "Active" : "Not found" },
      { label: SETTINGS_PAGE_HELP_CONTENT.snapshotLabels.recoveryOptions, value: "Backup codes only" },
      { label: SETTINGS_PAGE_HELP_CONTENT.snapshotLabels.twoFactorAuthentication, value: input.twoFactorEnabled ? "Enabled" : "Not enabled" },
    ],
    action: {
      label: SETTINGS_PAGE_HELP_CONTENT.actionLabels[actionId],
      href: SETTINGS_PAGE_HELP_ACTION_HREFS[actionId],
    },
  };
}
