import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  repository: {
    listRecurringSeries: vi.fn(),
    listCashFlowAccounts: vi.fn(),
    listPeriods: vi.fn(),
  },
  createCashFlowRepository: vi.fn(),
  initialIncomeSetup: vi.fn(() => null),
  recurringManager: vi.fn(() => null),
  recurringCreateHeaderAction: vi.fn(() => null),
  toTorontoDateIso: vi.fn(() => "2026-08-09"),
  getServerDatabase: vi.fn(() => ({})),
  owner: vi.fn(async () => ({ id: "00000000-0000-0000-0000-000000000001" })),
  withAuthenticatedPageDatabase: vi.fn(),
}));

vi.mock("@athena/database", () => ({
  addIsoDays: vi.fn((date: string, days: number) => date === "2026-08-09" && days === 364 ? "2027-08-08" : date),
  createCashFlowRepository: mocks.createCashFlowRepository,
  toTorontoDateIso: mocks.toTorontoDateIso,
}));
vi.mock("../../components/module-page", () => ({
  ModulePage: vi.fn((props: { readonly children: unknown }) => props.children),
}));
vi.mock("../../../lib/server/database", () => ({ getServerDatabase: mocks.getServerDatabase }));
vi.mock("../../../lib/server/owner-database", () => ({ withAuthenticatedPageDatabase: mocks.withAuthenticatedPageDatabase }));
vi.mock("../../../lib/server/page-help", () => ({ hasPageHelpSeen: vi.fn(async () => true) }));
vi.mock("../recurring-manager", () => ({ RecurringCashFlowManager: mocks.recurringManager, RecurringCreateHeaderAction: mocks.recurringCreateHeaderAction }));
vi.mock("../initial-income-setup", () => ({ InitialCashFlowIncomeSetup: mocks.initialIncomeSetup }));

import RecurringCashFlowPage from "./page";

describe("recurring Cash Flow route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createCashFlowRepository.mockReturnValue(mocks.repository);
    mocks.repository.listRecurringSeries.mockResolvedValue([]);
    mocks.repository.listCashFlowAccounts.mockResolvedValue([]);
    mocks.repository.listPeriods.mockResolvedValue([]);
    mocks.withAuthenticatedPageDatabase.mockImplementation(async (
      callback: (database: unknown, user: { readonly owner: { readonly id: string }; readonly authUserId: string; readonly session: { readonly id: string } }) => unknown,
    ) => callback(mocks.getServerDatabase(), { owner: await mocks.owner(), authUserId: "auth-user", session: { id: "session" } }));
  });

  it("uses the authenticated owner for every read and exposes the account prerequisite help action", async () => {
    const page = await RecurringCashFlowPage({});
    expect(mocks.owner).toHaveBeenCalledOnce();
    expect(mocks.withAuthenticatedPageDatabase).toHaveBeenCalledWith(expect.any(Function), { requireTwoFactor: true });
    expect(mocks.repository.listRecurringSeries).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", { includeHistory: true, asOfIso: "2026-08-09" });
    expect(mocks.repository.listCashFlowAccounts).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001");
    expect(mocks.repository.listPeriods).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001");
    const props = (page as { readonly props: { readonly help: { readonly content: { readonly pageId: string }; readonly snapshot: { readonly items: readonly { readonly label: string; readonly value: string }[]; readonly action: { readonly label: string; readonly href: string } } }; readonly children: { readonly props: { readonly title: string; readonly actionHref: string; readonly actionLabel: string } } } }).props;
    expect(props.help.content.pageId).toBe("recurring-payments");
    expect(props.help.snapshot.action).toEqual({ label: "Add an account", href: "/accounts" });
    expect(props.help.snapshot.items).toContainEqual({ label: "Available accounts", value: "0" });
    expect(props.children.props.title).toBe("Add an account before scheduling movement");
    expect(props.children.props.actionHref).toBe("/accounts");
  });

  it("renders the first-income setup for the requested first-use path even when an old timeline remains", async () => {
    mocks.repository.listCashFlowAccounts.mockResolvedValue([{ id: "account", name: "Main account", institution: "CIBC" }]);
    mocks.repository.listPeriods.mockResolvedValue([{ id: "old-period", payDate: "2026-08-09", endsOn: "2026-08-09" }]);

    const page = await RecurringCashFlowPage({ searchParams: Promise.resolve({ first: "1" }) });
    const modulePage = page as { readonly props: { readonly help: { readonly snapshot: { readonly action: { readonly label: string; readonly href: string } } }; readonly headerAction: unknown; readonly children: { readonly props: { readonly children: { readonly type: unknown; readonly props: { readonly hasExistingTimeline: boolean; readonly defaultThroughDate: string } } } } } };

    expect(modulePage.props.children.props.children.type).toBe(mocks.initialIncomeSetup);
    expect(modulePage.props.children.props.children.props.hasExistingTimeline).toBe(true);
    expect(modulePage.props.children.props.children.props.defaultThroughDate).toBe("2027-08-08");
    expect(modulePage.props.help.snapshot.action).toEqual({ label: "Add first income", href: "/cash-flow/recurring#recurring-create" });
    expect(modulePage.props.headerAction).toBeUndefined();
  });

  it("offers the regular manager and header create action outside the first-use path", async () => {
    mocks.repository.listCashFlowAccounts.mockResolvedValue([{ id: "account", name: "Main account", institution: "CIBC" }]);
    const page = await RecurringCashFlowPage({});
    const modulePage = page as { readonly props: { readonly help: { readonly snapshot: { readonly action: { readonly label: string; readonly href: string } } }; readonly headerAction: { readonly type: unknown } | undefined; readonly children: { readonly type: unknown; readonly props: { readonly accountOptions: readonly { readonly id: string; readonly label: string }[] } } } };

    expect(modulePage.props.children.type).toBe(mocks.recurringManager);
    expect(modulePage.props.children.props.accountOptions).toEqual([{ id: "account", label: "Main account · CIBC" }]);
    expect(modulePage.props.headerAction?.type).toBe(mocks.recurringCreateHeaderAction);
    expect(modulePage.props.help.snapshot.action).toEqual({ label: "Add first income", href: "/cash-flow/recurring#recurring-create" });
  });
});
