import { describe, expect, it } from "vitest";
import {
  buildAccountsPresentation,
  buildAccountsHelpSnapshot,
  buildTimelineNavigation,
  formatTimelineDelta,
  maskedAccountLastFour,
  resolveTimelineSelection,
  shouldShowAccountsFirstUse,
} from "./presentation";
import type { AccountTimelinePresentationInput } from "./presentation";

const ownerCurrency = "CAD" as const;

function snapshot(id: string, accountId: string, asOf: string, balanceMinor: number, status: "actual" | "planned") {
  return { id, accountId, asOf, balanceMinor, status, currency: ownerCurrency };
}

const timeline: AccountTimelinePresentationInput = {
  paydays: ["2026-08-05", "2026-08-19", "2026-09-02"],
  accounts: [
    {
      id: "checking",
      name: "Main chequing",
      institution: "Bank",
      kind: "checking",
      customTypeLabel: null,
      lastFour: "4242",
      isActive: true,
      includeInAvailableCash: true,
      snapshots: [
        snapshot("checking-1", "checking", "2026-08-05", 10000, "actual"),
        snapshot("checking-2", "checking", "2026-08-19", 11000, "planned"),
        snapshot("checking-3", "checking", "2026-09-02", 12000, "planned"),
      ],
      notes: [{ asOf: "2026-08-19", note: "Rent cleared later than expected" }],
    },
    {
      id: "savings",
      name: "Emergency savings",
      institution: "Bank",
      kind: "savings",
      customTypeLabel: null,
      isActive: true,
      includeInAvailableCash: true,
      snapshots: [snapshot("savings-1", "savings", "2026-08-05", 2500, "actual")],
    },
    {
      id: "credit",
      name: "Card",
      institution: "Bank",
      kind: "credit",
      customTypeLabel: null,
      isActive: true,
      includeInAvailableCash: false,
      snapshots: [snapshot("credit-1", "credit", "2026-08-05", 1200, "actual")],
    },
    {
      id: "tfsa",
      name: "TFSA",
      institution: "Broker",
      kind: "tfsa",
      customTypeLabel: null,
      isActive: true,
      includeInAvailableCash: false,
      snapshots: [snapshot("tfsa-1", "tfsa", "2026-08-05", 5000, "actual"), snapshot("tfsa-2", "tfsa", "2026-08-19", 5500, "planned")],
    },
    {
      id: "archived",
      name: "Old account",
      institution: "Bank",
      kind: "other",
      customTypeLabel: "Collectible",
      isActive: false,
      includeInAvailableCash: false,
      snapshots: [],
    },
  ],
};

describe("account timeline presentation", () => {
  it("builds an owner-safe Accounts guide snapshot with the next setup action", () => {
    const empty = buildAccountsPresentation({ paydays: [], accounts: [] }, { todayIso: "2026-08-20" });
    expect(buildAccountsHelpSnapshot(empty)).toEqual({
      items: [
        { label: "Active accounts", value: "0" },
        { label: "Pay periods", value: "0" },
        { label: "Current balance", value: "Not recorded" },
        { label: "Available cash accounts", value: "0" },
      ],
      action: { label: "Create main account", href: "/accounts" },
    });

    const mainAccount = timeline.accounts[0];
    if (!mainAccount) throw new Error("Expected fixture account is missing.");
    const needsTimeline = buildAccountsPresentation({ paydays: [], accounts: [mainAccount] }, { todayIso: "2026-08-20" });
    expect(buildAccountsHelpSnapshot(needsTimeline).action).toEqual({ label: "Set up Cash Flow rhythm", href: "/cash-flow" });

    const noBalance = buildAccountsPresentation({
      paydays: timeline.paydays,
      accounts: [{ ...mainAccount, snapshots: [] }],
    }, { todayIso: "2026-08-20", selectedDate: "2026-08-19" });
    expect(buildAccountsHelpSnapshot(noBalance).action).toEqual({ label: "Record current balance", href: "/accounts" });

    const noAvailableCash = buildAccountsPresentation({
      ...timeline,
      accounts: timeline.accounts.map((account) => ({ ...account, includeInAvailableCash: false })),
    }, { todayIso: "2026-08-20", selectedDate: "2026-08-19" });
    expect(buildAccountsHelpSnapshot(noAvailableCash).action).toEqual({ label: "Configure available cash", href: "/accounts" });

    expect(buildAccountsHelpSnapshot(buildAccountsPresentation(timeline, { todayIso: "2026-08-20", selectedDate: "2026-08-19" })).action).toEqual({ label: "Review balance timeline", href: "/accounts" });
  });

  it("shows the first-use state only when no visible or active accounts exist", () => {
    expect(shouldShowAccountsFirstUse({ activeAccountCount: 0, visibleAccountCount: 0 })).toBe(true);
    expect(shouldShowAccountsFirstUse({ activeAccountCount: 0, visibleAccountCount: 1 })).toBe(false);
    expect(shouldShowAccountsFirstUse({ activeAccountCount: 1, visibleAccountCount: 1 })).toBe(false);
  });

  it("resolves Today, previous, next, and Latest against the payday axis", () => {
    expect(resolveTimelineSelection(timeline.paydays, null, "2026-08-20")).toBe("2026-08-19");
    expect(buildTimelineNavigation(timeline.paydays, "2026-08-19", "2026-08-20")).toEqual({
      previous: "2026-08-05",
      today: "2026-08-19",
      next: "2026-09-02",
      latest: "2026-09-02",
    });
  });

  it("masks the optional account last four for account displays", () => {
    expect(maskedAccountLastFour("4242")).toBe("•••• 4242");
    expect(maskedAccountLastFour(null)).toBeNull();
    const result = buildAccountsPresentation(timeline, { todayIso: "2026-08-20", selectedDate: "2026-08-19" });
    expect(result.groups.flatMap((group) => group.accounts).find((account) => account.id === "checking")?.lastFour).toBe("4242");
  });

  it("labels the open payday as Current and others as Past or Projected", () => {
    const result = buildAccountsPresentation(timeline, { todayIso: "2026-08-20", selectedDate: "2026-08-19" });
    expect(result.columns.map((column) => ({ date: column.date, stateLabel: column.stateLabel }))).toEqual(expect.arrayContaining([
      { date: "2026-08-05", stateLabel: "Past" },
      { date: "2026-08-19", stateLabel: "Current" },
      { date: "2026-09-02", stateLabel: "Projected" },
    ]));
    expect(result.selectedStateLabel).toBe("Current");
    const checking = result.groups.flatMap((group) => group.accounts).find((account) => account.id === "checking");
    expect(checking?.cells[0]?.statusLabel).toBe("Confirmed");
    expect(checking?.cells[1]?.statusLabel).toBe("Projected");
    expect(checking?.cells[1]?.note).toBe("Rent cleared later than expected");
  });

  it("uses the canonical payday boundary for future status affordances", () => {
    const result = buildAccountsPresentation(timeline, { todayIso: "2026-08-01", selectedDate: "2026-08-05", pastPeriods: 0, futurePeriods: 2 });
    expect(result.columns.map((column) => ({ date: column.date, stateLabel: column.stateLabel, isFuture: column.isFuture }))).toEqual([
      { date: "2026-08-05", stateLabel: "Current", isFuture: false },
      { date: "2026-08-19", stateLabel: "Projected", isFuture: true },
      { date: "2026-09-02", stateLabel: "Projected", isFuture: true },
    ]);
  });

  it("keeps liquid totals separate from credit and investment balances", () => {
    const result = buildAccountsPresentation(timeline, { todayIso: "2026-08-05", selectedDate: "2026-08-05" });
    expect(result.selectedLiquidTotalMinor).toBe(12500);
    expect(result.liquidTotalMinor).toBe(12500);
    expect(result.totalTimeline).toEqual([16300, 16500, 12000]);
    expect(result.selectedTotalMinor).toBe(16300);
    expect(result.groups.find((group) => group.key === "liquid")?.totals[0]).toBe(12500);
    expect(result.groups.find((group) => group.key === "credit")?.totals[0]).toBe(-1200);
    expect(result.groups.find((group) => group.key === "investment")?.totals[0]).toBe(5000);
  });

  it("derives signed asset and liability deltas with favourable semantic tones", () => {
    const checking = timeline.accounts.find((account) => account.id === "checking");
    const credit = timeline.accounts.find((account) => account.id === "credit");
    if (!checking || !credit) throw new Error("Expected fixture accounts are missing.");
    const result = buildAccountsPresentation({
      ...timeline,
      accounts: [
        {
          ...checking,
          snapshots: [
            snapshot("checking-delta-1", "checking", "2026-08-05", 10000, "actual"),
            snapshot("checking-delta-2", "checking", "2026-08-19", 12000, "planned"),
            snapshot("checking-delta-3", "checking", "2026-09-02", 11000, "planned"),
          ],
        },
        {
          ...credit,
          snapshots: [
            snapshot("credit-delta-1", "credit", "2026-08-05", 5000, "actual"),
            snapshot("credit-delta-2", "credit", "2026-08-19", 4000, "planned"),
            snapshot("credit-delta-3", "credit", "2026-09-02", 4500, "planned"),
          ],
        },
      ],
    }, { todayIso: "2026-08-05", selectedDate: "2026-08-05" });
    const asset = result.groups.flatMap((group) => group.accounts).find((account) => account.id === "checking");
    const liability = result.groups.flatMap((group) => group.accounts).find((account) => account.id === "credit");
    expect(asset?.cells.map((cell) => cell.delta)).toEqual([
      null,
      { deltaMinor: 2000, tone: "favorable" },
      { deltaMinor: -1000, tone: "unfavorable" },
    ]);
    expect(liability?.cells.map((cell) => cell.delta)).toEqual([
      null,
      { deltaMinor: -1000, tone: "favorable" },
      { deltaMinor: 500, tone: "unfavorable" },
    ]);

    const creditGroup = result.groups.find((group) => group.key === "credit");
    expect(creditGroup?.totals).toEqual([-5000, -4000, -4500]);
    expect(creditGroup?.totalDeltas).toEqual([
      null,
      { deltaMinor: 1000, tone: "favorable" },
      { deltaMinor: -500, tone: "unfavorable" },
    ]);
  });

  it("omits missing comparisons, keeps zero neutral, and compares only visible neighbours", () => {
    const checking = timeline.accounts.find((account) => account.id === "checking");
    const savings = timeline.accounts.find((account) => account.id === "savings");
    if (!checking || !savings) throw new Error("Expected fixture accounts are missing.");
    const result = buildAccountsPresentation({
      ...timeline,
      accounts: [
        {
          ...checking,
          snapshots: [
            snapshot("checking-missing-1", "checking", "2026-08-05", 10000, "actual"),
            snapshot("checking-missing-2", "checking", "2026-08-19", 10000, "planned"),
          ],
        },
        {
          ...savings,
          snapshots: [
            snapshot("savings-missing-2", "savings", "2026-08-19", 10000, "planned"),
            snapshot("savings-missing-3", "savings", "2026-09-02", 10500, "planned"),
          ],
        },
      ],
    }, { todayIso: "2026-08-05", selectedDate: "2026-08-05" });
    const checkingResult = result.groups.flatMap((group) => group.accounts).find((account) => account.id === "checking");
    const savingsResult = result.groups.flatMap((group) => group.accounts).find((account) => account.id === "savings");
    expect(checkingResult?.cells.map((cell) => cell.delta)).toEqual([
      null,
      { deltaMinor: 0, tone: "neutral" },
      null,
    ]);
    expect(savingsResult?.cells.map((cell) => cell.delta)).toEqual([
      null,
      null,
      { deltaMinor: 500, tone: "favorable" },
    ]);

    const visibleWindow = buildAccountsPresentation({
      ...timeline,
      accounts: [{
        ...checking,
        snapshots: [
          snapshot("checking-visible-1", "checking", "2026-08-05", 10000, "actual"),
          snapshot("checking-visible-2", "checking", "2026-08-19", 10000, "planned"),
          snapshot("checking-visible-3", "checking", "2026-09-02", 10100, "planned"),
        ],
      }],
    }, { todayIso: "2026-08-05", selectedDate: "2026-08-19", pastPeriods: 0, futurePeriods: 1 });
    expect(visibleWindow.columns.map((column) => column.date)).toEqual(["2026-08-19", "2026-09-02"]);
    expect(visibleWindow.groups.flatMap((group) => group.accounts)[0]?.cells.map((cell) => cell.delta)).toEqual([
      null,
      { deltaMinor: 100, tone: "favorable" },
    ]);
  });

  it("formats signed minor-unit deltas without floating-point conversion", () => {
    expect(formatTimelineDelta(125)).toBe("+$1.25");
    expect(formatTimelineDelta(-125)).toBe("-$1.25");
    expect(formatTimelineDelta(0)).toBe("±$0.00");
  });

  it("does not use available-cash inclusion for net-worth totals", () => {
    const allExcluded = buildAccountsPresentation({
      ...timeline,
      accounts: timeline.accounts.map((account) => ({ ...account, includeInAvailableCash: false })),
    }, { todayIso: "2026-08-05", selectedDate: "2026-08-05" });
    expect(allExcluded.selectedTotalMinor).toBe(16300);
    expect(allExcluded.selectedLiquidTotalMinor).toBe(12500);
  });

  it("creates a dedicated section for repeated Other labels while keeping singleton labels in assets", () => {
    const reserveAccounts = [
      ["Emergency reserve", 36969],
      ["Travel reserve", 3100],
      ["Home reserve", 33576],
      ["Annual reserve", 46521],
      ["Gifts reserve", 22672],
    ].map(([name, balanceMinor], index) => ({
      id: `reserve-${index}`,
      name: name as string,
      institution: "Community bank",
      kind: "other",
      customTypeLabel: index === 0 ? "Emergency reserve" : "  emergency   reserve  ",
      groupName: "Imported legacy label",
      timelineOrder: index,
      isActive: true,
      includeInAvailableCash: false,
      snapshots: [snapshot(`reserve-${index}-snapshot`, `reserve-${index}`, "2026-08-05", balanceMinor as number, "actual")],
    }));
    const result = buildAccountsPresentation({ ...timeline, accounts: [...timeline.accounts, ...reserveAccounts] }, { todayIso: "2026-08-05", selectedDate: "2026-08-05" });
    const dedicated = result.groups.find((group) => group.key === "other:emergency reserve");
    expect(dedicated?.accounts.map((account) => account.name)).toEqual(reserveAccounts.map((account) => account.name));
    expect(dedicated?.label).toBe("Imported legacy label");
    expect(dedicated?.totals[0]).toBe(142838);
    expect(result.selectedTotalMinor).toBe(159138);
    expect(result.selectedLiquidTotalMinor).toBe(12500);
    expect(result.groups.find((group) => group.key === "investment")?.accounts.map((account) => account.id)).toContain("archived");
    expect(result.groups.some((group) => group.key === "other:collectible")).toBe(false);
  });

  it("preserves archived visibility and standardized/custom type labels in the matrix model", () => {
    const result = buildAccountsPresentation(timeline, { todayIso: "2026-08-05", selectedDate: "2026-08-05" });
    const archived = result.groups.flatMap((group) => group.accounts).find((account) => account.id === "archived");
    expect(archived?.isActive).toBe(false);
    expect(archived?.kindLabel).toBe("Collectible");
    expect(result.groups.find((group) => group.key === "investment")?.accounts.map((account) => account.id)).toContain("tfsa");
    expect(result.columns[0]?.state).toBe("actual");
    expect(result.columns[1]?.state).toBe("projected");
  });

  it("derives one non-mixed status for every imported payday column", () => {
    const paydays = [
      "2026-06-10", "2026-06-24", "2026-07-08", "2026-07-22", "2026-08-05",
      "2026-08-19", "2026-09-02", "2026-09-16", "2026-09-30", "2026-10-14", "2026-10-28", "2026-11-11",
    ];
    const completeTimeline: AccountTimelinePresentationInput = {
      paydays,
      accounts: timeline.accounts.map((account) => ({
        ...account,
        snapshots: account.isActive
          ? paydays.map((asOf, index) => snapshot(`${account.id}-${index}`, account.id, asOf, 100, asOf <= "2026-08-05" ? "actual" : "planned"))
          : [],
      })),
    };
    const result = buildAccountsPresentation(completeTimeline, { todayIso: "2026-08-05", selectedDate: "2026-08-05", pastPeriods: 12, futurePeriods: 12 });
    expect(result.columns.map((column) => column.state)).toEqual([
      "actual", "actual", "actual", "actual", "actual",
      "projected", "projected", "projected", "projected", "projected", "projected", "projected",
    ]);
    expect(result.columns.some((column) => column.state === "mixed")).toBe(false);
  });

  it("selects visible periods relative to the selected period", () => {
    const result = buildAccountsPresentation(timeline, { todayIso: "2026-08-05", selectedDate: "2026-09-02", pastPeriods: 1, futurePeriods: 1 });
    expect(result.columns.map((column) => column.date)).toEqual(["2026-08-19", "2026-09-02"]);
    expect(result.pastPeriods).toBe(1);
    expect(result.futurePeriods).toBe(1);
    expect(result.totalPeriodCount).toBe(3);
  });
});
