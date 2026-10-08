import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  isTwoFactorRequired: vi.fn(() => true),
  loadSettingsSecuritySummary: vi.fn(),
  getOnboardingSnapshot: vi.fn(),
  hasPageHelpSeen: vi.fn(async () => true),
  withAuthenticatedPageDatabase: vi.fn(),
  settingsManager: vi.fn(() => null),
  redirect: vi.fn(() => { throw new Error("REDIRECT"); }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("../components/module-page", () => ({ ModulePage: vi.fn(({ children }: { readonly children: unknown }) => children) }));
vi.mock("../../lib/server/auth-session", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("../../lib/server/auth-policy", () => ({ isTwoFactorRequired: mocks.isTwoFactorRequired }));
vi.mock("./settings-manager", () => ({ SettingsManager: mocks.settingsManager }));
vi.mock("./security-summary", () => ({
  loadSettingsSecuritySummary: mocks.loadSettingsSecuritySummary,
  neutralSettingsSecuritySummary: () => ({ passwordChangedAt: null, activeSessionCount: null, activeSessions: null }),
}));
vi.mock("../../lib/server/onboarding", () => ({ getOnboardingSnapshot: mocks.getOnboardingSnapshot }));
vi.mock("../../lib/server/page-help", () => ({ hasPageHelpSeen: mocks.hasPageHelpSeen }));
vi.mock("../../lib/server/owner-database", () => ({ withAuthenticatedPageDatabase: mocks.withAuthenticatedPageDatabase }));

import SettingsPage from "./page";

describe("Settings route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUser.mockResolvedValue({ session: { id: "session-1" }, owner: { isDemo: false }, twoFactorEnabled: false });
    mocks.getOnboardingSnapshot.mockResolvedValue({ state: "dismissed" });
    mocks.withAuthenticatedPageDatabase.mockImplementation(async (
      callback: (database: unknown, user: unknown) => unknown,
    ) => callback({ name: "settings database" }, { session: { id: "session-1" }, owner: { id: "owner-1", isDemo: false }, authUserId: "auth-user" }));
    mocks.loadSettingsSecuritySummary.mockResolvedValue({
      passwordChangedAt: "2026-08-18T00:00:00.000Z",
      activeSessionCount: 2,
      activeSessions: [{ id: "session-1", isCurrent: true }],
    });
  });

  it("loads the authenticated security summary and exposes contextual help", async () => {
    const page = await SettingsPage({});
    expect(mocks.getAuthenticatedUser).toHaveBeenCalledOnce();
    expect(mocks.loadSettingsSecuritySummary).toHaveBeenCalledWith(
      { name: "settings database" },
      expect.objectContaining({ session: { id: "session-1" } }),
    );
    expect(mocks.getOnboardingSnapshot).toHaveBeenCalledWith({ name: "settings database" }, "owner-1");
    expect(mocks.hasPageHelpSeen).toHaveBeenCalledWith(
      { name: "settings database" },
      expect.objectContaining({ owner: { id: "owner-1", isDemo: false } }),
      "settings",
    );
    expect(mocks.withAuthenticatedPageDatabase).toHaveBeenCalledTimes(1);
    const pageElement = page as unknown as { readonly props: { readonly mainClassName: string; readonly help: { readonly content: { readonly pageId: string }; readonly snapshot: { readonly action: { readonly label: string; readonly href: string } } }; readonly pageHelpSeen: boolean } };
    expect(pageElement.props.help.content.pageId).toBe("settings");
    expect(pageElement.props.help.snapshot.action).toEqual({ label: "Review active sessions", href: "/settings#settings-sessions-heading" });
    expect(pageElement.props.mainClassName).toBe("settings-page editorial-module-page editorial-page-art");
    expect(pageElement.props.pageHelpSeen).toBe(true);
    const pageWithManager = page as unknown as { readonly props: { readonly children: { readonly props: { readonly twoFactorEnabled: boolean; readonly onboardingState: string } } } }; // ModulePage is mocked to return the child element directly.
    const pageProps = pageWithManager.props;
    const managerElement = pageProps.children;
    expect(managerElement.props.twoFactorEnabled).toBe(false);
    expect(managerElement.props.onboardingState).toBe("dismissed");
  });

  it("skips the security-summary read and passes a neutral summary for demo owners", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ session: { id: "session-demo" }, owner: { isDemo: true }, twoFactorEnabled: false });
    mocks.withAuthenticatedPageDatabase.mockImplementation(async (
      callback: (database: unknown, user: unknown) => unknown,
    ) => callback({ name: "settings database" }, { session: { id: "session-demo" }, owner: { id: "owner-demo", isDemo: true }, authUserId: "auth-user" }));
    const page = await SettingsPage({});
    expect(mocks.loadSettingsSecuritySummary).not.toHaveBeenCalled();
    // ModulePage is mocked to return its child element, so the manager element is the page's child.
    const modulePageElement = page as ReactElement<{ readonly children: ReactElement<{ readonly securitySummary: unknown; readonly readOnly: boolean }> }>;
    const managerProps = modulePageElement.props.children.props;
    expect(managerProps.securitySummary).toEqual({ passwordChangedAt: null, activeSessionCount: null, activeSessions: null });
    expect(managerProps.readOnly).toBe(true);
  });

  it("uses the returned session identity for the security summary", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ session: { id: "new-session" }, owner: { isDemo: false }, twoFactorEnabled: true });
    mocks.withAuthenticatedPageDatabase.mockImplementation(async (
      callback: (database: unknown, user: unknown) => unknown,
    ) => callback({ name: "settings database" }, { session: { id: "new-session" }, owner: { id: "owner-1", isDemo: false }, authUserId: "auth-user" }));
    const page = await SettingsPage({});
    expect(mocks.loadSettingsSecuritySummary).toHaveBeenCalledWith(
      { name: "settings database" },
      expect.objectContaining({ session: { id: "new-session" } }),
    );
    const modulePageElement = page as ReactElement<{ readonly children: ReactElement<{ readonly twoFactorEnabled: boolean }> }>;
    expect(modulePageElement.props.children.props.twoFactorEnabled).toBe(true);
  });

  it("passes the mandatory two-factor handoff state from the redirect query", async () => {
    const page = await SettingsPage({ searchParams: Promise.resolve({ security: "two-factor" }) });
    const modulePageElement = page as ReactElement<{ readonly children: ReactElement<{ readonly twoFactorSetupRequired: boolean }> }>;
    expect(modulePageElement.props.children.props.twoFactorSetupRequired).toBe(true);
    expect(mocks.isTwoFactorRequired).toHaveBeenCalledOnce();
  });

  it("loads page data through a single page-database transaction without requiring two-factor", async () => {
    await SettingsPage({});
    expect(mocks.withAuthenticatedPageDatabase).toHaveBeenCalledWith(expect.any(Function), { requireTwoFactor: false });
    expect(mocks.withAuthenticatedPageDatabase).toHaveBeenCalledTimes(1);
  });
});
