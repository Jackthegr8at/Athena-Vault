import React, { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ownerId: "00000000-0000-0000-0000-000000000001",
  getAnnualExpensesReadModel: vi.fn(),
  toTorontoDateIso: vi.fn(),
  withDatabaseObservation: vi.fn(),
  withAuthenticatedPageDatabase: vi.fn(),
  modulePage: vi.fn(),
  firstUseCard: vi.fn(),
  annualExpenseManager: vi.fn(),
}));

vi.mock("@athena/database", () => ({
  addIsoDays: vi.fn(),
  getAnnualExpensesReadModel: mocks.getAnnualExpensesReadModel,
  occurrencesBetween: vi.fn(() => []),
  toTorontoDateIso: mocks.toTorontoDateIso,
  withDatabaseObservation: mocks.withDatabaseObservation,
}));
vi.mock("@athena/finance-engine", () => ({ projectAnnualBudget: vi.fn() }));
vi.mock("../components/module-page", () => ({ ModulePage: mocks.modulePage }));
vi.mock("../components/module-first-use-card", () => ({ ModuleFirstUseCard: mocks.firstUseCard }));
vi.mock("../components/animated-line-background", () => ({ AnimatedLineBackground: () => null }));
vi.mock("../../lib/server/owner-database", () => ({ withAuthenticatedPageDatabase: mocks.withAuthenticatedPageDatabase }));
vi.mock("../../lib/server/page-help", () => ({ hasPageHelpSeen: vi.fn(async () => true) }));
vi.mock("./annual-expense-manager", () => ({ AnnualExpenseManager: mocks.annualExpenseManager }));

import { getAnnualExpensesReadModel } from "@athena/database";
import AnnualExpensesPage from "./page";

type AnnualExpensesReadModel = Awaited<ReturnType<typeof getAnnualExpensesReadModel>>;

function readModel(overrides: Partial<AnnualExpensesReadModel> = {}): AnnualExpensesReadModel {
  return {
    initialSummary: { taxYear: 2026, budgets: [] } as unknown as AnnualExpensesReadModel["initialSummary"],
    eligibleAccounts: [],
    years: [2025, 2026],
    taxYear: 2026,
    summary: { taxYear: 2026, budgets: [] } as unknown as AnnualExpensesReadModel["summary"],
    projectionSummaries: [],
    timeline: { accounts: [], institutions: [], paydays: [], selectedPayday: null, selectedValues: [] } as unknown as AnnualExpensesReadModel["timeline"],
    ...overrides,
  };
}

function renderModulePage({ active, title, help, children }: {
  readonly active: string;
  readonly title: string;
  readonly help: { readonly snapshot: { readonly items: readonly { readonly label: string; readonly value: string }[]; readonly action: { readonly label: string; readonly href: string } } };
  readonly children?: ReactNode;
}) {
  return React.createElement("main", { "data-active-module": active },
    React.createElement("h1", null, title),
    React.createElement("dl", { "aria-label": "Annual expenses snapshot" }, ...help.snapshot.items.flatMap(({ label, value }) => [
      React.createElement("dt", { key: `${label}-label` }, label),
      React.createElement("dd", { key: `${label}-value` }, value),
    ])),
    React.createElement("a", { href: help.snapshot.action.href }, help.snapshot.action.label),
    children,
  );
}

describe("Annual Expenses route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    mocks.toTorontoDateIso.mockReturnValue("2026-09-22");
    mocks.getAnnualExpensesReadModel.mockResolvedValue(readModel());
    mocks.withDatabaseObservation.mockImplementation(async (_name: string, callback: () => Promise<unknown>) => callback());
    mocks.withAuthenticatedPageDatabase.mockImplementation(async (
      callback: (database: unknown, user: unknown) => Promise<unknown>,
    ) => callback({}, { owner: { id: mocks.ownerId } }));
    mocks.modulePage.mockImplementation(renderModulePage);
    mocks.firstUseCard.mockImplementation(({ title, description, actionHref, actionLabel }: {
      readonly title: string;
      readonly description: string;
      readonly actionHref: string;
      readonly actionLabel: string;
    }) => React.createElement("section", null,
      React.createElement("h2", null, title),
      React.createElement("p", null, description),
      React.createElement("a", { href: actionHref }, actionLabel),
    ));
    mocks.annualExpenseManager.mockImplementation(({ firstUse }: { readonly firstUse: boolean }) =>
      React.createElement("section", { "data-first-use": String(firstUse), "aria-label": "Annual expense manager" }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("routes an owner with no eligible account to the account prerequisite", async () => {
    const page = await AnnualExpensesPage({});
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Add an account before planning expenses");
    expect(html).toContain('href="/accounts"');
    expect(html).toContain("Add one in Accounts, then come back to create your first budget.");
    expect(html).toContain('aria-label="Annual expenses snapshot"');
    expect(html).toContain("Available funding accounts");
    expect(html).toContain(">0</dd>");
  });

  it("passes the selected year and authenticated owner to the observed read model", async () => {
    await AnnualExpensesPage({ searchParams: Promise.resolve({ year: ["2025", "2024"] }) });

    expect(mocks.withDatabaseObservation).toHaveBeenCalledWith("annual-expenses-page", expect.any(Function));
    expect(mocks.withAuthenticatedPageDatabase).toHaveBeenCalledWith(expect.any(Function), { requireTwoFactor: true });
    expect(mocks.getAnnualExpensesReadModel).toHaveBeenCalledWith({}, mocks.ownerId, "2025", "2026-09-22");
  });

  it("renders first-budget setup and contextual help when an eligible account exists", async () => {
    mocks.getAnnualExpensesReadModel.mockResolvedValueOnce(readModel({
      eligibleAccounts: [{ id: "account-1", name: "Chequing", institutionName: "North Bank" }],
    }));

    const page = await AnnualExpensesPage({});
    const html = renderToStaticMarkup(page);

    expect(html).toContain('aria-label="Annual expense manager"');
    expect(html).toContain('data-first-use="true"');
    expect(html).toContain('href="/annual-expenses#annual-expenses-first-budget-heading"');
    expect(html).toContain("Available funding accounts");
  });
});
