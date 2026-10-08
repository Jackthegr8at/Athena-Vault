import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  repository: { getPageData: vi.fn() },
  holdingsRepository: { getPageData: vi.fn() },
  createInvestmentProjectionRepository: vi.fn(),
  createInvestmentHoldingsRepository: vi.fn(),
  toTorontoDateIso: vi.fn(() => "2026-08-11"),
  holdingsManager: vi.fn(() => null),
  getServerDatabase: vi.fn(() => ({})),
  owner: vi.fn(async () => ({ id: "00000000-0000-0000-0000-000000000001" })),
}));

vi.mock("@athena/database", () => ({ createInvestmentProjectionRepository: mocks.createInvestmentProjectionRepository, createInvestmentHoldingsRepository: mocks.createInvestmentHoldingsRepository, toTorontoDateIso: mocks.toTorontoDateIso }));
vi.mock("../components/module-page", () => ({ ModulePage: vi.fn(({ children }: { readonly children: unknown }) => children) }));
vi.mock("../../lib/server/database", () => ({ getServerDatabase: mocks.getServerDatabase }));
vi.mock("../../lib/server/page-help", () => ({ hasPageHelpSeen: vi.fn(async () => true) }));
vi.mock("../../lib/server/owner-database", () => ({
  withAuthenticatedPageDatabase: async (callback: (database: unknown, user: { readonly owner: { readonly id: string } }) => unknown) => callback(mocks.getServerDatabase(), { owner: await mocks.owner() }),
}));
vi.mock("./holdings-manager", () => ({ InvestmentHoldingsManager: mocks.holdingsManager }));
vi.mock("./investment-project-manager", () => ({ InvestmentProjectManager: vi.fn(() => null) }));

import InvestmentsPage from "./page";

describe("Investments route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createInvestmentProjectionRepository.mockReturnValue(mocks.repository);
    mocks.createInvestmentHoldingsRepository.mockReturnValue(mocks.holdingsRepository);
    mocks.repository.getPageData.mockResolvedValue({ asOf: "2026-08-11", availableAccounts: [], cashFlowAccounts: [], projects: [] });
    mocks.holdingsRepository.getPageData.mockResolvedValue({ asOf: "2026-08-11", accounts: [] });
  });

  it("loads the owner-scoped projection data and exposes the first projection action", async () => {
    const page = await InvestmentsPage({});
    expect(mocks.owner).toHaveBeenCalledOnce();
    expect(mocks.createInvestmentProjectionRepository).toHaveBeenCalledWith({});
    expect(mocks.toTorontoDateIso).toHaveBeenCalledOnce();
    expect(mocks.repository.getPageData).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", "2026-08-11");
    expect(mocks.createInvestmentHoldingsRepository).toHaveBeenCalledWith({});
    expect(mocks.holdingsRepository.getPageData).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", "2026-08-11");
    const pageElement = page as unknown as { readonly props: { readonly help: { readonly content: { readonly pageId: string }; readonly snapshot: { readonly action: { readonly label: string; readonly href: string } } } } };
    expect(pageElement.props.help.content.pageId).toBe("investments");
    expect(pageElement.props.help.snapshot.action).toEqual({ label: "Create first projection", href: "/investments" });
  });

  it("omits the REEI/RDSP holdings section when no REEI account exists", async () => {
    const page = await InvestmentsPage({});
    const pageElement = page as unknown as { readonly props: { readonly children: readonly ({ readonly type?: unknown } | null)[] } };

    expect(pageElement.props.children.some((child) => child?.type === mocks.holdingsManager)).toBe(false);
  });

  it("keeps the REEI/RDSP holdings section when an account exists", async () => {
    mocks.holdingsRepository.getPageData.mockResolvedValueOnce({ asOf: "2026-08-11", accounts: [{ holdings: [] }] });

    const page = await InvestmentsPage({});
    const pageElement = page as unknown as { readonly props: { readonly children: readonly ({ readonly type?: unknown } | null)[] } };

    expect(pageElement.props.children.some((child) => child?.type === mocks.holdingsManager)).toBe(true);
  });
});
