// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { click, createDomTestRoot } from "../../test/dom";
import { buildAccountsPresentation, type AccountTimelinePresentationInput } from "./presentation";

const actionMocks = vi.hoisted(() => {
  const idleState = { ok: false, message: "", fieldErrors: {} };
  return {
    deleteContributionRuleAction: vi.fn(async () => idleState),
    saveContributionRuleAction: vi.fn(async () => idleState),
    updateContributionExceptionsAction: vi.fn(async () => idleState),
  };
});

vi.mock("./actions", () => actionMocks);

import { RecurringContributions } from "./recurring-contributions";

function recurringPresentation() {
  const accounts: AccountTimelinePresentationInput["accounts"] = [
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `account-${index + 1}`,
      name: `Reserve ${index + 1}`,
      institution: "North Bank",
      kind: "checking",
      customTypeLabel: null,
      isActive: true,
      includeInAvailableCash: false,
      snapshots: [{ id: `snapshot-${index + 1}`, asOf: "2026-09-02", balanceMinor: 10_000, status: "actual" as const }],
      contributionRules: [{
        id: `rule-${index + 1}`,
        accountId: `account-${index + 1}`,
        amountMinor: 2_500 + index * 100,
        frequency: "biweekly" as const,
        startsOn: "2026-09-02",
        endsOn: null,
        isEnabled: true,
        nextOccurrenceOn: "2026-09-16",
        exceptions: [],
      }],
    })),
    {
      id: "account-without-rule",
      name: "Unfunded account",
      institution: "North Bank",
      kind: "savings",
      customTypeLabel: null,
      isActive: true,
      includeInAvailableCash: false,
      snapshots: [],
      contributionRules: [],
    },
  ];

  return buildAccountsPresentation({ paydays: ["2026-09-02"], accounts }, { todayIso: "2026-09-14", selectedDate: "2026-09-02" });
}

type RecurringFrequency = NonNullable<AccountTimelinePresentationInput["accounts"][number]["contributionRules"]>[number]["frequency"];

function highValueRule(
  id: string,
  accountId: string,
  frequency: RecurringFrequency,
  amountMinor = Number.MAX_SAFE_INTEGER,
  nextOccurrenceOn = "2026-09-16",
): NonNullable<AccountTimelinePresentationInput["accounts"][number]["contributionRules"]>[number] {
  return {
    id,
    accountId,
    amountMinor,
    frequency,
    startsOn: "2026-09-02",
    endsOn: null,
    isEnabled: true,
    nextOccurrenceOn,
    exceptions: [],
  };
}

function highValueRecurringPresentation() {
  const accounts: AccountTimelinePresentationInput["accounts"] = [
    {
      id: "weekly-account",
      name: "Weekly reserve",
      institution: "Weekly Bank",
      kind: "checking",
      customTypeLabel: null,
      isActive: true,
      includeInAvailableCash: false,
      snapshots: [],
      contributionRules: [highValueRule("weekly-rule", "weekly-account", "weekly")],
    },
    {
      id: "monthly-account",
      name: "Monthly reserve",
      institution: "Monthly Bank",
      kind: "checking",
      customTypeLabel: null,
      isActive: true,
      includeInAvailableCash: false,
      snapshots: [],
      contributionRules: [highValueRule("monthly-rule", "monthly-account", "monthly")],
    },
    {
      id: "annual-account",
      name: "Annual reserve",
      institution: "Annual Bank",
      kind: "checking",
      customTypeLabel: null,
      isActive: true,
      includeInAvailableCash: false,
      snapshots: [],
      contributionRules: [highValueRule("annual-rule", "annual-account", "annual")],
    },
    {
      id: "multi-account",
      name: "Multi reserve",
      institution: "Multi Bank",
      kind: "checking",
      customTypeLabel: null,
      isActive: true,
      includeInAvailableCash: false,
      snapshots: [],
      contributionRules: [
        highValueRule("multi-rule-1", "multi-account", "biweekly"),
        highValueRule("multi-rule-2", "multi-account", "biweekly"),
      ],
    },
  ];

  return buildAccountsPresentation({ paydays: ["2026-09-02"], accounts }, { todayIso: "2026-09-14", selectedDate: "2026-09-02" });
}

const dom = createDomTestRoot();

describe("Recurring contributions presentation", () => {
  it("renders the hero artwork, accessible tabs, and only the first four active rules", async () => {
    await dom.render(React.createElement(RecurringContributions, { presentation: recurringPresentation() }));

    const hero = dom.get(".recurring-contributions-hero");
    expect(hero.querySelector(".animated-line-background--recurring-hero")).not.toBeNull();
    const artwork = hero.querySelector<HTMLImageElement>("img.recurring-contributions-hero-art");
    expect(artwork?.getAttribute("src")).toBe("/brand/recurring-background.png");
    expect(artwork?.getAttribute("data-unoptimized")).toBe("true");
    expect(artwork?.getAttribute("alt")).toBe("");
    expect(artwork?.getAttribute("width")).toBe("2200");
    expect(artwork?.getAttribute("height")).toBe("734");
    expect(artwork?.getAttribute("loading")).toBe("lazy");
    expect(artwork?.getAttribute("fetchpriority")).toBe("low");
    expect(dom.get('[role="tablist"]').getAttribute("aria-label")).toBe("Recurring contribution views");
    expect(dom.container.querySelectorAll(".contribution-rule-row")).toHaveLength(4);
    expect(dom.container.textContent).toContain("View all 5 rules");
    expect(dom.container.textContent).not.toContain("Unfunded account");
  });

  it("reveals account menus and the Add rule account selector through the public controls", async () => {
    await dom.render(React.createElement(RecurringContributions, { presentation: recurringPresentation() }));

    const byAccount = Array.from(dom.container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')).find((button) => button.textContent?.includes("By account"));
    if (!byAccount) throw new Error("Missing By account tab");
    await click(byAccount);

    expect(dom.container.querySelector(".contribution-account-chevron")).not.toBeNull();
    const more = dom.get<HTMLButtonElement>('button[aria-label="More actions for Reserve 1 rule"]');
    expect(dom.container.querySelector('[role="menu"]')).toBeNull();
    await click(more);
    expect(dom.get('[role="menu"]').textContent).toContain("Disable");
    expect(dom.get('[role="menu"]').textContent).toContain("Delete");

    await click(dom.get<HTMLButtonElement>(".contribution-add-rule"));
    expect(dom.get<HTMLInputElement>('input[type="hidden"][name="accountId"]').value).toBe("account-1");
    await click(dom.get<HTMLButtonElement>('#contribution-account-new[role="combobox"]'));
    expect(document.body.querySelectorAll('[role="listbox"] [role="option"]')).toHaveLength(6);
    expect(dom.get<HTMLButtonElement>(".contribution-add-rule").textContent).toContain("Add rule");
  });

  it("closes an edited rule at the successful save boundary", async () => {
    actionMocks.saveContributionRuleAction.mockResolvedValueOnce({ ok: true, message: "Rule saved.", fieldErrors: {} });
    await dom.render(React.createElement(RecurringContributions, { presentation: recurringPresentation() }));
    await click(dom.get<HTMLButtonElement>('button[aria-label="Edit Reserve 1 rule"]'));

    const form = dom.get<HTMLFormElement>("form.contribution-rule-form");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(dom.container.querySelector("form.contribution-rule-form")).toBeNull();
  });

  it("renders exact high-value frequency normalization and same-day aggregates", async () => {
    await dom.render(React.createElement(RecurringContributions, { presentation: highValueRecurringPresentation() }));

    const byAccount = Array.from(dom.container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')).find((button) => button.textContent?.includes("By account"));
    if (!byAccount) throw new Error("Missing By account tab");
    await click(byAccount);

    await click(dom.get<HTMLButtonElement>('button[aria-label="More actions for Weekly reserve rule"]'));
    const amountInput = dom.get<HTMLInputElement>('.contribution-rule-menu-popover input[name="amount"]');
    expect(amountInput.value).toBe("90071992547409.91");
    expect(amountInput.value).not.toMatch(/[,$]|NaN/);

    const accountSummary = (institution: string): string => {
      const summary = Array.from(dom.container.querySelectorAll<HTMLElement>(".contribution-account-summary")).find((element) => element.textContent?.includes(institution));
      if (!summary) throw new Error(`Missing account summary for ${institution}`);
      return summary.textContent ?? "";
    };

    expect(accountSummary("Weekly Bank")).toContain("$180,143,985,094,819.82");
    expect(accountSummary("Monthly Bank")).toContain("$41,571,688,868,035.34");
    expect(accountSummary("Annual Bank")).toContain("$3,464,307,405,669.61");
    expect(accountSummary("Multi Bank")).toContain("2 active rules");
    expect(accountSummary("Multi Bank")).toContain("$180,143,985,094,819.82");

    const summaryText = dom.get(".recurring-summary-card").textContent ?? "";
    expect(summaryText).toContain("$405,323,966,463,344.59");

    const upcomingCard = dom.get(".recurring-upcoming-card");
    expect(upcomingCard.querySelectorAll(".recurring-upcoming-row")).toHaveLength(1);
    expect(upcomingCard.textContent).toContain("5 contributions");
    expect(upcomingCard.textContent).toContain("$450,359,962,737,049.55");

    const renderedText = dom.container.textContent ?? "";
    expect(renderedText).not.toContain("Unavailable");
    expect(renderedText).not.toContain("NaN");
    expect(renderedText).not.toContain("$41,571,688,868,035.35");
  });
});
