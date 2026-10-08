// @vitest-environment jsdom

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { click, createDomTestRoot } from "../../test/dom";
import type { InvestmentProjectionPageData, InvestmentProjectionProjectView } from "@athena/database";

const mocks = vi.hoisted(() => ({
  createInvestmentProjectionAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  deleteInvestmentProjectionAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  updateInvestmentCashFlowAccountLinkAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  updateInvestmentProjectionAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  refresh: vi.fn(),
}));

vi.mock("./actions", () => ({
  createInvestmentProjectionAction: mocks.createInvestmentProjectionAction,
  deleteInvestmentProjectionAction: mocks.deleteInvestmentProjectionAction,
  updateInvestmentCashFlowAccountLinkAction: mocks.updateInvestmentCashFlowAccountLinkAction,
  updateInvestmentProjectionAction: mocks.updateInvestmentProjectionAction,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

import { InvestmentProjectManager } from "./investment-project-manager";

const projectId = "00000000-0000-4000-8000-000000000101";

function project(name: string, endingBalanceMinor: number): InvestmentProjectionProjectView {
  return {
    id: projectId,
    name,
    notes: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-08T00:00:00Z"),
    mode: "calculator",
    manualStartingAmountMinor: 100_000,
    horizonYears: 10,
    baselineDate: "2026-09-08",
    accountCount: 0,
    rateBps: 500,
    startingBalanceMinor: 100_000,
    endingBalanceMinor,
    warningCount: 0,
    compoundingPeriodsPerYear: 12,
    accounts: [],
    accountSchedules: [],
    rates: [{ id: "rate-1", rateBps: 500, displayOrder: 0 }],
    annualContributionSummary: [],
    scenarios: [{
      rateBps: 500,
      points: [
        { year: 0, calendarYear: 2026, balanceMinor: 100_000, contributionsMinor: 0, growthMinor: 0 },
        { year: 10, calendarYear: 2036, balanceMinor: endingBalanceMinor, contributionsMinor: 0, growthMinor: endingBalanceMinor - 100_000 },
      ],
    }],
    warnings: [],
  };
}

function pageData(projects: readonly InvestmentProjectionProjectView[]): InvestmentProjectionPageData {
  return { asOf: "2026-09-08", availableAccounts: [], cashFlowAccounts: [], projects };
}

const dom = createDomTestRoot();

describe("InvestmentProjectManager modal freshness", () => {
  it("renders revalidated project props in an already-open detail modal", async () => {
    await dom.render(<InvestmentProjectManager {...pageData([project("Retirement outlook", 162_889)])} />);

    await click(dom.get<HTMLButtonElement>(".investment-project-table .investment-table-link"));

    const dialog = dom.get<HTMLElement>("[role='dialog']");
    expect(dialog.textContent).toContain("Retirement outlook");
    expect(dialog.textContent).toContain("$1,628.89");

    await dom.render(<InvestmentProjectManager {...pageData([project("Cottage fund", 250_000)])} />);

    const refreshed = dom.get<HTMLElement>("[role='dialog']");
    expect(refreshed.textContent).toContain("Cottage fund");
    expect(refreshed.textContent).toContain("$2,500.00");
    expect(refreshed.textContent).not.toContain("Retirement outlook");
    expect(refreshed.textContent).not.toContain("$1,628.89");
  });

  it("closes the detail modal when the project disappears from props", async () => {
    await dom.render(<InvestmentProjectManager {...pageData([project("Retirement outlook", 162_889)])} />);

    await click(dom.get<HTMLButtonElement>(".investment-project-table .investment-table-link"));
    expect(dom.container.querySelector("[role='dialog']")).not.toBeNull();

    await dom.render(<InvestmentProjectManager {...pageData([])} />);

    expect(dom.container.querySelector("[role='dialog']")).toBeNull();
    await dom.render(<InvestmentProjectManager {...pageData([project("Retirement outlook", 162_889)])} />);
    expect(dom.container.querySelector("[role='dialog']")).toBeNull();
  });
});
