import "./settings.css";
import React from "react";
import { preload } from "react-dom";
import { redirect } from "next/navigation";
import { ModulePage } from "../components/module-page";
import { SETTINGS_PAGE_HELP_CONTENT } from "../components/page-help-content";
import { getAuthenticatedUser } from "../../lib/server/auth-session";
import { isTwoFactorRequired } from "../../lib/server/auth-policy";
import { SettingsManager } from "./settings-manager";
import { loadSettingsSecuritySummary, neutralSettingsSecuritySummary } from "./security-summary";
import { withAuthenticatedPageDatabase } from "../../lib/server/owner-database";
import { getOnboardingSnapshot } from "../../lib/server/onboarding";
import { hasPageHelpSeen } from "../../lib/server/page-help";
import { buildSettingsHelpSnapshot } from "./presentation";

export const dynamic = "force-dynamic";

type SettingsSearchParams = { readonly security?: string | string[] };

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SettingsPage({ searchParams }: { readonly searchParams?: Promise<SettingsSearchParams> }) {
  preload("/brand/backgrounds/settings.png", { as: "image" });
  const params = searchParams ? await searchParams : {};
  const authenticatedUser = await getAuthenticatedUser();
  if (!authenticatedUser) redirect("/login");
  const isDemo = authenticatedUser.owner.isDemo;
  const requiresTwoFactorSetup = firstQueryValue(params.security) === "two-factor" && !isDemo && !authenticatedUser.twoFactorEnabled && isTwoFactorRequired();
  const { securitySummary, onboardingSnapshot, pageHelpSeen } = await withAuthenticatedPageDatabase(async (database, user) => {
    const [securitySummary, onboardingSnapshot, pageHelpSeen] = await Promise.all([
      isDemo ? Promise.resolve(neutralSettingsSecuritySummary()) : loadSettingsSecuritySummary(database, user),
      getOnboardingSnapshot(database, user.owner.id),
      hasPageHelpSeen(database, user, SETTINGS_PAGE_HELP_CONTENT.pageId),
    ]);
    return { securitySummary, onboardingSnapshot, pageHelpSeen };
  }, { requireTwoFactor: false });
  const settingsHelp = {
    content: SETTINGS_PAGE_HELP_CONTENT,
    snapshot: buildSettingsHelpSnapshot({
      hasPasswordChangeRecord: securitySummary.passwordChangedAt !== null,
      activeSessionCount: securitySummary.activeSessionCount ?? securitySummary.activeSessions?.length ?? null,
      hasCurrentSession: securitySummary.activeSessions === null ? null : securitySummary.activeSessions.some((session) => session.isCurrent),
      twoFactorEnabled: authenticatedUser.twoFactorEnabled,
    }),
  };
  return <ModulePage active="Settings" mainClassName="settings-page editorial-module-page editorial-page-art" eyebrow="Settings" title="Account settings" subtitle="Manage the security settings for your signed-in account." help={settingsHelp} pageHelpSeen={pageHelpSeen}>
    <SettingsManager securitySummary={securitySummary} readOnly={authenticatedUser.owner.isDemo} passkeysEnabled={process.env.ATHENA_PASSKEYS_ENABLED?.trim().toLowerCase() === "true"} twoFactorEnabled={authenticatedUser.twoFactorEnabled} twoFactorSetupRequired={requiresTwoFactorSetup} onboardingState={onboardingSnapshot.state} />
  </ModulePage>;
}
