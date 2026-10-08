// @vitest-environment jsdom

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { click, createDomTestRoot } from "../../test/dom";
import { AccountCommandCenter, percentageOfSelectedTotal } from "./account-command-center";
import { AccountManager, type AccountManagerProps } from "./account-manager";
import { AccountSelectedPeriodCard } from "./account-selected-period-card";
import { AccountsHeroTimeline } from "./accounts-hero-timeline";
import { AccountsMobileCockpit } from "./accounts-mobile-cockpit";
import { BalanceTimeline } from "./balance-timeline";
import { buildAccountsPresentation, type AccountTimelinePresentationInput } from "./presentation";

const actionMocks = vi.hoisted(() => {
  const idleState = { ok: false, message: "", fieldErrors: {} };
  return {
    archiveAccountAction: vi.fn(async () => idleState),
    confirmPeriodAction: vi.fn(async () => idleState),
    createAccountAction: vi.fn(async () => idleState),
    deleteAccountAction: vi.fn(async () => idleState),
    deleteBalanceSnapshotAction: vi.fn(async () => idleState),
    deleteContributionRuleAction: vi.fn(async () => idleState),
    extendAccountTimelineAction: vi.fn(async () => idleState),
    recalculateProjectionsAction: vi.fn(async () => idleState),
    reorderAccountsAction: vi.fn(async () => idleState),
    restoreAccountAction: vi.fn(async () => idleState),
    saveContributionRuleAction: vi.fn(async () => idleState),
    updateAccountAction: vi.fn(async () => idleState),
    updateAccountAvailableCashAction: vi.fn(async () => idleState),
    updateAccountBalanceNoteAction: vi.fn(async () => idleState),
    updateAccountCashFlowPlannedTimelineAction: vi.fn(async () => idleState),
    updateContributionExceptionsAction: vi.fn(async () => idleState),
    upsertBalanceSnapshotAction: vi.fn(async () => idleState),
  };
});

vi.mock("./actions", () => actionMocks);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

const kindOptions = [
  { code: "checking", label: "Chequing" },
  { code: "savings", label: "Savings" },
  { code: "credit", label: "Credit card" },
  { code: "investment", label: "Investments" },
] satisfies AccountManagerProps["kindOptions"];

const timeline: AccountTimelinePresentationInput = {
  paydays: ["2026-09-02", "2026-09-16"],
  accounts: [
    {
      id: "checking",
      name: "Main chequing",
      institution: "North Bank",
      kind: "checking",
      customTypeLabel: null,
      lastFour: "4242",
      isActive: true,
      includeInAvailableCash: true,
      snapshots: [
        { id: "checking-current", asOf: "2026-09-02", balanceMinor: 12_000, status: "actual" },
        { id: "checking-future", asOf: "2026-09-16", balanceMinor: 13_000, status: "planned", isGenerated: true },
      ],
    },
    {
      id: "savings",
      name: "Emergency savings",
      institution: "North Bank",
      kind: "savings",
      customTypeLabel: null,
      isActive: true,
      includeInAvailableCash: true,
      snapshots: [{ id: "savings-current", asOf: "2026-09-02", balanceMinor: 4_000, status: "actual" }],
    },
    {
      id: "credit",
      name: "Travel card",
      institution: "North Bank",
      kind: "credit",
      customTypeLabel: null,
      isActive: true,
      includeInAvailableCash: false,
      snapshots: [{ id: "credit-current", asOf: "2026-09-02", balanceMinor: 1_500, status: "actual" }],
    },
    {
      id: "investments",
      name: "Long-term investments",
      institution: "North Broker",
      kind: "investment",
      customTypeLabel: null,
      isActive: true,
      includeInAvailableCash: false,
      snapshots: [{ id: "investments-current", asOf: "2026-09-02", balanceMinor: 8_000, status: "actual" }],
    },
  ],
};

const presentation = buildAccountsPresentation(timeline, { todayIso: "2026-09-14", selectedDate: "2026-09-02" });
const emptyPresentation = buildAccountsPresentation({ paydays: [], accounts: [] }, { todayIso: "2026-09-14" });
const summaries = [
  { code: "checking", label: "Chequing", count: 1, totalMinor: 12_000 },
  { code: "savings", label: "Savings", count: 1, totalMinor: 4_000 },
  { code: "credit", label: "Credit", count: 1, totalMinor: -1_500 },
  { code: "investment", label: "Investments", count: 1, totalMinor: 8_000 },
];
const dom = createDomTestRoot();

describe("Accounts overview presentation", () => {
  it("renders the selected timeline as an accessible hero chart", () => {
    const markup = renderToStaticMarkup(React.createElement(AccountsHeroTimeline, { columns: presentation.columns, values: presentation.totalTimeline }));

    expect(markup).toContain('class="accounts-hero-timeline"');
    expect(markup).toContain('role="img"');
    expect(markup).toContain("All accounts total timeline");
    expect(markup).toContain("accounts-hero-timeline-selected");
    expect(markup).toContain("accounts-hero-timeline-segment");
    expect(markup).toContain('pathLength="1"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain("$225.00");
  });

  it("renders the selected-period summary with negative movement and decorative artwork", () => {
    const markup = renderToStaticMarkup(React.createElement(AccountSelectedPeriodCard, { selectedTotalMinor: 22_500, liquidChangeMinor: -750, largestMovement: { accountName: "Travel card", deltaMinor: -1_500 } }));

    expect(markup).toContain("Liquid accounts change");
    expect(markup).toContain("Largest movement");
    expect(markup).toContain("Travel card");
    expect(markup).toContain("animated-line-background--account-selected");
    expect(markup).not.toContain("Current state");
  });

  it("switches command-center totals between dollars and percentages through its controls", async () => {
    await dom.render(React.createElement(AccountCommandCenter, { summaries, selectedTotalMinor: 22_500 }));
    expect(dom.get<HTMLButtonElement>('button[aria-label="Show account totals in dollars"]').getAttribute("aria-pressed")).toBe("true");
    await click(dom.get<HTMLButtonElement>('button[aria-label="Show account totals as percentages"]'));
    expect(dom.get<HTMLButtonElement>('button[aria-label="Show account totals as percentages"]').getAttribute("aria-pressed")).toBe("true");
    expect(dom.container.querySelector(".account-command-grid")?.textContent).toContain("53.3%");
  });

  it("renders the first-use account form and the managed-account last-four action row", () => {
    const firstUseMarkup = renderToStaticMarkup(React.createElement(AccountManager, { presentation: emptyPresentation, kindOptions, firstUse: true, formPrefix: "new-account-desktop" }));
    expect(firstUseMarkup).toContain("Create your main account");
    expect(firstUseMarkup).toContain("This first account will be included in available cash");
    expect(firstUseMarkup).toContain('id="new-account-desktop-name"');
    expect(firstUseMarkup).toContain("Account last four");

    const managedMarkup = renderToStaticMarkup(React.createElement(AccountManager, { presentation, kindOptions }));
    expect(managedMarkup).toContain("Manage accounts");
    expect(managedMarkup).toContain("•••• 4242");
    expect(managedMarkup).toContain('aria-haspopup="menu"');
    expect(managedMarkup).toContain("More actions for Main chequing");
  });

  it("renders the balance timeline and mobile cockpit from the same presentation", () => {
    const timelineMarkup = renderToStaticMarkup(React.createElement(BalanceTimeline, { presentation, showArchived: false }));
    expect(timelineMarkup).toContain('class="account-timeline-table is-fluid"');
    expect(timelineMarkup).toContain("Biweekly balance timeline");
    expect(timelineMarkup).toContain("•••• 4242");
    expect(timelineMarkup).toContain("Projected");

    const mobileMarkup = renderToStaticMarkup(React.createElement(AccountsMobileCockpit, {
      presentation,
      showArchived: false,
      kindOptions,
      previousHref: "?selected=2026-08-19",
      todayHref: "?selected=2026-09-02",
      nextHref: "?selected=2026-09-16",
      archiveHref: "?archived=1",
    }));
    expect(mobileMarkup).toContain("Current balance");
    expect(mobileMarkup).toContain("Money map");
    expect(mobileMarkup).toContain("Account balances");
    expect(mobileMarkup).toContain("Recurring contributions");
    expect(mobileMarkup).toContain("Manage accounts");
    expect(mobileMarkup).toContain('id="accounts-mobile-manager"');
    expect(mobileMarkup).toContain('data-open="false"');
  });

  it("keeps the percentage helper based on integer minor-unit totals", () => {
    expect(percentageOfSelectedTotal(2_500, 10_000)).toBe("25.0%");
    expect(percentageOfSelectedTotal(-1_250, 10_000)).toBe("-12.5%");
    expect(percentageOfSelectedTotal(null, 10_000)).toBe("—");
    expect(percentageOfSelectedTotal(10_000, 0)).toBe("0.0%");
  });
});
