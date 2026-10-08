// @vitest-environment jsdom

import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { HomeHouseholdCashFlowLinkView, HomeMortgageTermView } from "@athena/database";
import { createDomTestRoot } from "../../test/dom";
import { HomeOverviewTop, type HomeOverviewTopProps } from "./home-overview-top";

const actions = vi.hoisted(() => ({
  createHomeHouseholdCashFlowSeriesAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  syncHomeHouseholdCashFlowAmountAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
}));
vi.mock("./cash-flow-actions", () => actions);

const monthlyLink: HomeHouseholdCashFlowLinkView = {
  frequency: "monthly",
  seriesId: "household-monthly",
  seriesState: "active",
  name: "Household costs",
  kind: "expense",
  amountMinor: 125_000,
  scheduleFrequency: "monthly",
  countsAsExpense: true,
  nextOccurrenceOn: "2026-10-01",
};

const mortgageTerm: HomeMortgageTermView = {
  id: "mortgage-term-1",
  effectiveOn: "2026-08-01",
  annualRateBps: 525,
  compoundingConvention: "canadian_semi_annual",
  paymentExpenseId: "mortgage-payment",
  paymentExpenseName: "Mortgage payment",
  paymentMinor: 150_000,
  nextPaymentOn: "2026-10-01",
  renewalOn: "2028-10-01",
  payoffOn: "2046-10-01",
};

const props: HomeOverviewTopProps = {
  monthlyMinor: 125_000,
  biweeklyMinor: 65_000,
  annualMinor: 1_560_000,
  homeEquityMinor: 23_000_000,
  latestPropertyValueMinor: 35_000_000,
  mortgageBalanceMinor: 12_000_000,
  mortgageStatus: "actual",
  mortgageTerm,
  liabilityMinor: 175_500,
  cashFlowHref: "/cash-flow?period=period-1",
  cashFlowLinked: true,
  householdCashFlowLinks: [monthlyLink],
  householdCashFlowAccounts: [{ id: "account-1", name: "Main account", institution: "North Bank" }],
  todayIso: "2026-09-22",
};

const dom = createDomTestRoot();

describe("Home top presentation", () => {
  it("renders household, property, mortgage, liability, and linked Cash Flow values", async () => {
    await dom.render(React.createElement(HomeOverviewTop, props));

    const desktopSummary = dom.get<HTMLElement>('section.home-overview-top[aria-label="Home overview summary"]');
    expect(desktopSummary.querySelector(".home-summary-hero h2")?.textContent).toBe("Your household obligations at a glance");
    expect(desktopSummary.querySelector(".home-summary-value")?.textContent).toContain("$1,250.00");

    const metric = (label: string) => Array.from(desktopSummary.querySelectorAll<HTMLElement>(".home-summary-metric"))
      .find((entry) => entry.querySelector("small")?.textContent === label);
    expect(metric("Bi-weekly costs")?.querySelector("strong")?.textContent).toBe("$650.00");
    expect(metric("Annual costs")?.querySelector("strong")?.textContent).toBe("$15,600.00");
    expect(metric("Annual costs")?.textContent).toContain("Annual household reserve");
    expect(metric("Home equity")?.querySelector("strong")?.textContent).toBe("$230,000.00");
    expect(metric("Home equity")?.textContent).toContain("Market value minus mortgage");

    const liabilitiesCard = dom.get<HTMLElement>(".home-liabilities-card");
    expect(liabilitiesCard.textContent).toContain("Liabilities snapshot");
    expect(liabilitiesCard.textContent).toContain("$1,755.00");
    const cashFlowLink = liabilitiesCard.querySelector<HTMLAnchorElement>(".home-cash-flow-summary a");
    expect(cashFlowLink?.getAttribute("href")).toBe("/cash-flow?period=period-1");
    expect(cashFlowLink?.textContent).toContain("View in Cash Flow");

    const glance = dom.get<HTMLElement>(".home-glance-card");
    expect(glance.textContent).toContain("Cash Flow coverage");
    expect(glance.textContent).toContain("Covered");
    expect(glance.textContent).toContain("Property value");
    expect(glance.textContent).toContain("$350,000.00");
    expect(glance.textContent).toContain("Mortgage balance");
    expect(glance.textContent).toContain("$120,000.00");
    expect(glance.textContent).toContain("Actual balance");
    expect(glance.textContent).toContain("Payment $1,500.00 · 5.25% · renewal Oct 01, 2028");

    const image = glance.querySelector<HTMLImageElement>("img.home-glance-art");
    expect(image?.getAttribute("src")).toBe("/brand/athena-vault-background-mountains-houses.png");
    expect(image?.getAttribute("width")).toBe("713");
    expect(image?.getAttribute("height")).toBe("459");
    expect(image?.getAttribute("sizes")).toBe("300px");
    expect(image?.getAttribute("loading")).toBe("eager");
    expect(image?.getAttribute("fetchpriority")).toBe("high");
    expect(image?.getAttribute("alt")).toBe("");
    expect(image?.getAttribute("aria-hidden")).toBe("true");
  });

  it("includes the compact Home pulse and property snapshot as separate responsive content", async () => {
    await dom.render(React.createElement(HomeOverviewTop, props));

    const mobileSummary = dom.get<HTMLElement>('section.home-overview-mobile[aria-label="Home pulse"]');
    expect(mobileSummary.querySelector(".home-mobile-pulse h2")?.textContent).toBe("Household costs");
    expect(mobileSummary.querySelector(".home-mobile-pulse-value")?.textContent).toContain("$1,250.00");
    expect(mobileSummary.querySelector('[role="group"][aria-label="Home financial snapshot"]')?.textContent)
      .toContain("Annual reserve$15,600.00");
    expect(mobileSummary.querySelector(".home-mobile-snapshot h3")?.textContent).toBe("Property & mortgage");
    expect(mobileSummary.querySelector(".home-mobile-snapshot-list")?.textContent).toContain("$350,000.00");
    expect(mobileSummary.querySelector(".home-mobile-snapshot-list")?.textContent).toContain("$120,000.00");
    expect(mobileSummary.querySelector<HTMLAnchorElement>(".home-mobile-primary-action")?.getAttribute("href"))
      .toBe("/cash-flow?period=period-1");
    expect(mobileSummary.querySelector<HTMLAnchorElement>(".home-mobile-text-action")?.getAttribute("href"))
      .toBe("#home-property-details");
  });
});
