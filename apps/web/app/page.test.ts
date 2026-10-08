import React, { type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ownerId: "00000000-0000-0000-0000-000000000001",
  authUserId: "auth-user-00000000-0000-0000-0000-000000000099",
  database: { name: "test database" },
  getDashboardReadModel: vi.fn(),
  pageHelpSeen: vi.fn(),
  withDatabaseObservation: vi.fn(),
  withAuthenticatedPageDatabase: vi.fn(),
  getOnboardingSnapshot: vi.fn(),
  getPrimaryOwnerId: vi.fn(),
}));

vi.mock("@athena/database", () => ({
  createPageHelpRepository: vi.fn(() => ({ hasSeen: mocks.pageHelpSeen })),
  getDashboardReadModel: mocks.getDashboardReadModel,
  toTorontoDateIso: vi.fn(() => "2026-09-14"),
  withDatabaseObservation: mocks.withDatabaseObservation,
}));
vi.mock("../lib/server/database", () => ({ getServerDatabase: vi.fn(() => mocks.database) }));
vi.mock("../lib/server/owner-database", () => ({ withAuthenticatedPageDatabase: mocks.withAuthenticatedPageDatabase }));
vi.mock("../lib/server/onboarding", () => ({ getOnboardingSnapshot: mocks.getOnboardingSnapshot }));
vi.mock("../lib/server/auth-setup", () => ({ getPrimaryOwnerId: mocks.getPrimaryOwnerId }));

import { DashboardClient } from "./components/dashboard-client";
import Dashboard from "./page";

describe("Overview route read boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    mocks.getDashboardReadModel.mockResolvedValue({
      periodWindow: {
        periods: [],
        accounts: [],
        anchors: [],
        paydayChecks: [],
        paydayNotes: [],
        projectionTransactions: [],
        projectionTransfers: [],
        selectedPeriodId: null,
        currentPeriodId: null,
        currentPeriodPayDate: null,
        totalPeriodCount: 0,
      },
      upcomingPeriods: [],
      annual: { expenses: [], currentYear: 2026, nextYear: 2027, baseTotalMinor: 0, currentTotalMinor: 0, nextTotalMinor: 0, fundedMinor: 0, remainingMinor: 0 },
      investments: { accounts: [], scenarios: [], currentValueMinor: 0, monthlyContributionMinor: 0 },
      accounts: [],
      home: null,
      netWorthHistory: {
        currency: "CAD",
        evaluationDate: "2026-09-22",
        historicalFrom: null,
        projectedThrough: null,
        firstProjectedAsOf: null,
        selectedRange: "1y",
        defaultRange: "1y",
        points: [],
        changes: [],
      },
    });
    mocks.pageHelpSeen.mockResolvedValue(true);
    mocks.withDatabaseObservation.mockImplementation(async (_name: string, callback: () => Promise<unknown>) => callback());
    mocks.withAuthenticatedPageDatabase.mockImplementation(async (
      callback: (database: unknown, user: {
        readonly owner: { readonly id: string; readonly isDemo: boolean; readonly displayName: string; readonly email: string };
        readonly authUserId: string;
        readonly session: { readonly id: string };
      }) => unknown,
      _options: { readonly requireTwoFactor: boolean },
    ) => callback(mocks.database, {
      owner: { id: mocks.ownerId, isDemo: false, displayName: "Owner", email: "owner@example.test" },
      authUserId: mocks.authUserId,
      session: { id: "session-1" },
    }));
    mocks.getOnboardingSnapshot.mockResolvedValue(null);
    mocks.getPrimaryOwnerId.mockResolvedValue(mocks.ownerId);
  });

  it("loads the Overview read model with the authenticated owner's scope and keeps auth identity distinct", async () => {
    const page = await Dashboard() as ReactElement<{ readonly data: { readonly ownerLabel: string }; readonly isAdmin: boolean }>;

    expect(mocks.withDatabaseObservation).toHaveBeenCalledWith("dashboard-page", expect.any(Function));
    expect(mocks.withAuthenticatedPageDatabase).toHaveBeenCalledWith(expect.any(Function), { requireTwoFactor: true });
    expect(mocks.getDashboardReadModel).toHaveBeenCalledWith(
      mocks.database,
      mocks.ownerId,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
    expect(mocks.getOnboardingSnapshot).toHaveBeenCalledWith(mocks.database, mocks.ownerId, {
      hasAccount: false,
      hasBalance: false,
      hasRecurring: false,
    });
    expect(mocks.pageHelpSeen).toHaveBeenCalledWith(mocks.ownerId, "overview");
    expect(mocks.getPrimaryOwnerId).toHaveBeenCalledWith(mocks.database);
    expect(page.type).toBe(DashboardClient);
    expect(page.props.data.ownerLabel).toBe("Owner");
    expect(page.props.isAdmin).toBe(false);
  });

  it("exposes an unseen guide as open-once state without writing on GET", async () => {
    mocks.pageHelpSeen.mockResolvedValue(false);

    const page = await Dashboard() as ReactElement<{ readonly data: { readonly overviewHelpSeen: boolean } }>;

    expect(page.props.data.overviewHelpSeen).toBe(false);
    expect(mocks.pageHelpSeen).toHaveBeenCalledWith(mocks.ownerId, "overview");
  });
});
