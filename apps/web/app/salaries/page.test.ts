import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  repository: { listByOwner: vi.fn() },
  createSalaryTrackingRepository: vi.fn(),
  toTorontoDateIso: vi.fn(() => "2026-08-11"),
  getServerDatabase: vi.fn(() => ({})),
  owner: vi.fn(async () => ({ id: "00000000-0000-0000-0000-000000000001" })),
  SalariesManager: vi.fn(() => null),
}));

vi.mock("@athena/database", () => ({
  createSalaryTrackingRepository: mocks.createSalaryTrackingRepository,
  toTorontoDateIso: mocks.toTorontoDateIso,
}));
vi.mock("../components/module-page", () => ({ ModulePage: vi.fn(({ children }: { readonly children: unknown }) => children) }));
vi.mock("../../lib/server/database", () => ({ getServerDatabase: mocks.getServerDatabase }));
vi.mock("../../lib/server/page-help", () => ({ hasPageHelpSeen: vi.fn(async () => true) }));
vi.mock("../../lib/server/owner-database", () => ({
  withAuthenticatedPageDatabase: async (callback: (database: unknown, user: { readonly owner: { readonly id: string }; readonly authUserId: string; readonly session: { readonly id: string } }) => unknown) => callback(mocks.getServerDatabase(), { owner: await mocks.owner(), authUserId: "auth-user", session: { id: "session" } }),
}));
vi.mock("./salaries-manager", () => ({ SalariesManager: mocks.SalariesManager }));

import SalariesPage from "./page";

describe("Salaries route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSalaryTrackingRepository.mockReturnValue(mocks.repository);
    mocks.repository.listByOwner.mockResolvedValue([]);
  });

  it("loads salary data through the initial owner scope and selects the requested year", async () => {
    const page = await SalariesPage({ searchParams: Promise.resolve({ year: "2026" }) });
    expect(mocks.owner).toHaveBeenCalledOnce();
    expect(mocks.createSalaryTrackingRepository).toHaveBeenCalledWith({});
    expect(mocks.repository.listByOwner).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001");
    const pageElement = page as unknown as { readonly props: { readonly mainClassName: string; readonly help: { readonly content: { readonly pageId: string }; readonly snapshot: { readonly action: { readonly label: string; readonly href: string } } }; readonly children: { readonly props: { readonly selectedTaxYear: number; readonly currentTaxYear: number; readonly availableYears: readonly number[] } } } };
    expect(pageElement.props.help.content.pageId).toBe("salaries");
    expect(pageElement.props.help.snapshot.action).toEqual({ label: "Create salary year", href: "/salaries?year=2026" });
    expect(pageElement.props.mainClassName).toBe("salaries-page editorial-page-art");
    const managerElement = pageElement.props.children;
    expect(managerElement.props.selectedTaxYear).toBe(2026);
    expect(managerElement.props.currentTaxYear).toBe(2026);
    expect(managerElement.props.availableYears).toEqual([2024, 2025, 2026, 2027]);
  });

  it("fills every year between the earliest record and next year", async () => {
    mocks.repository.listByOwner.mockResolvedValue([{
      id: "00000000-0000-0000-0000-000000000011",
      ownerId: "00000000-0000-0000-0000-000000000001",
      taxYear: 2011,
      annualBaseMinor: null,
      status: "finalized",
      finalFederalMinor: 2_151_297,
      payPeriodsPerYearOverride: null,
      totalPayPeriods: 26,
      paydayAnchorOn: null,
      note: null,
      createdAt: new Date("2011-12-31T00:00:00.000Z"),
      updatedAt: new Date("2011-12-31T00:00:00.000Z"),
      latestSnapshot: null,
      snapshots: [],
      federalCumulativeMinor: null,
      provincialCumulativeMinor: null,
      federalProjectedYearEndMinor: 2_151_297,
      provincialProjectedYearEndMinor: null,
      federalVarianceToBaseMinor: null,
    }]);
    const page = await SalariesPage({ searchParams: Promise.resolve({ year: "2024" }) });
    const managerElement = (page as unknown as { readonly props: { readonly children: { readonly props: { readonly selectedTaxYear: number; readonly availableYears: readonly number[] } } } }).props.children;
    expect(managerElement.props.selectedTaxYear).toBe(2024);
    expect(managerElement.props.availableYears).toEqual(Array.from({ length: 17 }, (_, index) => 2011 + index));
  });
});
