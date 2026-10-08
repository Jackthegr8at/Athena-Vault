import { describe, expect, it } from "vitest";
import { buildCashFlowHelpSnapshot, cashFlowBalanceDifference, cashFlowCurrentPeriodHref, cashFlowFirstUseStep, cashFlowItemGroup, cashFlowPaydayVariance, cashFlowItemSignedAmount, cashFlowMovementSection, cashFlowMovementSectionLabel, cashFlowPeriodHref, cashFlowPeriodTimelineMetrics, cashFlowProjectionBalanceDifference, cashFlowProjectionMovementLabel, compactCashFlowWindowRange, groupCashFlowMovementsBySection, orderCashFlowItems, recurringCashFlowManagerPath, recurringCashFlowSummaryItems, recurringOccurrenceDisplayState, recurringRangeLabel } from "./presentation";
import { money } from "@athena/finance-engine";

describe("Cash flow timeline presentation", () => {
  it("routes an empty Cash Flow workspace through the first useful prerequisite", () => {
    expect(cashFlowFirstUseStep({ accountCount: 0, totalPeriodCount: 0 })).toBe("account");
    expect(cashFlowFirstUseStep({ accountCount: 1, totalPeriodCount: 0 })).toBe("timeline");
    expect(cashFlowFirstUseStep({ accountCount: 1, totalPeriodCount: 1 })).toBeNull();
  });

  it("builds the approved Cash Flow help snapshot and action sequence", () => {
    expect(buildCashFlowHelpSnapshot({
      accountCount: 0,
      totalPeriodCount: 0,
      anchors: [],
      recurringSeries: [],
    })).toEqual({
      items: [
        { label: "Active accounts", value: "0" },
        { label: "Pay periods", value: "0" },
        { label: "Current balance", value: "Not recorded" },
        { label: "Recurring movements", value: "0" },
      ],
      action: { label: "Create main account", href: "/accounts" },
    });

    expect(buildCashFlowHelpSnapshot({
      accountCount: 1,
      totalPeriodCount: 0,
      anchors: [],
      recurringSeries: [],
    }).action).toEqual({ label: "Set up Cash Flow rhythm", href: "/cash-flow" });

    expect(buildCashFlowHelpSnapshot({
      accountCount: 1,
      totalPeriodCount: 4,
      anchors: [{ status: "planned", isGenerated: true }],
      recurringSeries: [],
    }).action).toEqual({ label: "Record current balance", href: "/accounts" });

    expect(buildCashFlowHelpSnapshot({
      accountCount: 2,
      totalPeriodCount: 4,
      anchors: [{ status: "planned", isGenerated: false }],
      recurringSeries: [
        { kind: "transfer", state: "active" },
        { kind: "income", state: "ended" },
      ],
    })).toMatchObject({
      items: expect.arrayContaining([{ label: "Recurring movements", value: "0" }]),
      action: { label: "Add recurring income or expense", href: "/cash-flow/recurring?first=1" },
    });

    expect(buildCashFlowHelpSnapshot({
      accountCount: 2,
      totalPeriodCount: 4,
      anchors: [{ status: "actual", isGenerated: false }],
      recurringSeries: [{ kind: "income", state: "active" }],
    }).action).toEqual({ label: "Review current projection", href: "/cash-flow" });
  });

  it("keeps the selected period centered in the compact window when possible", () => {
    expect(compactCashFlowWindowRange(5, 12, 2, 3)).toEqual({ start: 3, end: 9 });
    expect(compactCashFlowWindowRange(0, 12, 2, 3)).toEqual({ start: 0, end: 4 });
    expect(compactCashFlowWindowRange(11, 12, 2, 3)).toEqual({ start: 9, end: 12 });
  });

  it("returns every period in expanded mode", () => {
    expect(compactCashFlowWindowRange(5, 12, 2, 3, true)).toEqual({ start: 0, end: 12 });
    expect(compactCashFlowWindowRange(-1, 0, 2, 3)).toEqual({ start: 0, end: 0 });
  });

  it("groups account movements into income, spending, and transfers sections", () => {
    expect(cashFlowMovementSection("income")).toBe("income");
    expect(cashFlowMovementSection("expense")).toBe("spending");
    expect(cashFlowMovementSection("transfer-in")).toBe("transfer");
    expect(cashFlowMovementSection("transfer-out")).toBe("transfer");
    expect(cashFlowMovementSection("transfer-out", true)).toBe("spending");
    expect(cashFlowMovementSectionLabel("spending")).toBe("Spending");
    expect(cashFlowMovementSectionLabel("transfer")).toBe("Transfers");
    expect(groupCashFlowMovementsBySection([
      { id: "e1", kind: "expense" as const },
      { id: "t1", kind: "transfer-out" as const },
      { id: "i1", kind: "income" as const },
      { id: "t2", kind: "transfer-in" as const },
      { id: "home", kind: "transfer-out" as const, countsAsExpense: true },
    ]).map((group) => [group.section, group.movements.map((movement) => movement.id)])).toEqual([
      ["income", ["i1"]],
      ["spending", ["e1", "home"]],
      ["transfer", ["t1", "t2"]],
    ]);
  });

  it("groups and signs cash-flow items for the detail view", () => {
    const income = { id: "income", label: "Pay", account: "Bank", amount: money(1000), kind: "income" as const, planned: false, date: "2026-08-01" };
    const expense = { id: "expense", label: "Rent", account: "Bank", amount: money(300), kind: "expense" as const, planned: true, date: "2026-08-01" };
    const transferIn = { id: "in", label: "Move in", account: "Bank", amount: money(200), kind: "transfer" as const, direction: "in" as const, planned: true, date: "2026-07-31" };
    expect(cashFlowItemGroup(income)).toBe("income");
    expect(cashFlowItemGroup(expense)).toBe("expense");
    expect(cashFlowItemGroup(transferIn)).toBe("transfer-in");
    expect(cashFlowItemSignedAmount(expense)).toBe(-300);
    expect(orderCashFlowItems([income, expense, transferIn]).map((item) => item.id)).toEqual(["in", "income", "expense"]);
  });

  it("keeps unavailable chained balances from producing a false variance", () => {
    expect(cashFlowProjectionBalanceDifference(null, 1000)).toBeNull();
    expect(cashFlowProjectionBalanceDifference(1000, null)).toBeNull();
    expect(cashFlowProjectionBalanceDifference(900, 1000)).toBe(100);
    expect(cashFlowProjectionMovementLabel("expense")).toBe("Spending");
    expect(cashFlowProjectionMovementLabel("transfer-out")).toBe("Transfer out");
  });

  it("compares a period ending balance with the next opening balance", () => {
    expect(cashFlowBalanceDifference(10000, 10000)).toBe(0);
    expect(cashFlowBalanceDifference(10000, 9500)).toBe(-500);
    expect(cashFlowBalanceDifference(10000, null)).toBeNull();
  });

  it("calculates payday variance as observed minus projected", () => {
    expect(cashFlowPaydayVariance(220000, 215000)).toBe(-5000);
    expect(cashFlowPaydayVariance(220000, 225000)).toBe(5000);
    expect(cashFlowPaydayVariance(220000, null)).toBeNull();
    expect(cashFlowPaydayVariance(null, 215000)).toBeNull();
  });

  it("keeps every detailed period metric in the timeline presentation", () => {
    expect(cashFlowPeriodTimelineMetrics({
      openingBalanceMinor: money(10000),
      incomeMinor: money(25000),
      spendingMinor: money(3200),
      transfersInMinor: money(1800),
      transfersOutMinor: money(900),
      endingBalanceMinor: null,
    })).toEqual([
      { label: "Opening", amountMinor: 10000 },
      { label: "Income", amountMinor: 25000, emphasis: "positive" },
      { label: "Spending", amountMinor: 3200, emphasis: "negative" },
      { label: "Transfers in", amountMinor: 1800 },
      { label: "Transfers out", amountMinor: 900 },
      { label: "Available ending", amountMinor: null },
      { label: "Change", amountMinor: null, emphasis: undefined, signed: true },
    ]);
  });

  it("appends signed period change as ending minus opening", () => {
    expect(cashFlowPeriodTimelineMetrics({
      openingBalanceMinor: money(10000),
      incomeMinor: money(25000),
      spendingMinor: money(3200),
      transfersInMinor: money(1800),
      transfersOutMinor: money(900),
      endingBalanceMinor: money(14500),
    }).at(-1)).toEqual({ label: "Change", amountMinor: 4500, emphasis: "positive", signed: true });

    expect(cashFlowPeriodTimelineMetrics({
      openingBalanceMinor: money(10000),
      incomeMinor: money(0),
      spendingMinor: money(2500),
      transfersInMinor: money(0),
      transfersOutMinor: money(0),
      endingBalanceMinor: money(7500),
    }).at(-1)).toEqual({ label: "Change", amountMinor: -2500, emphasis: "negative", signed: true });
  });

  it("builds selected-period URLs and preserves period and account-toggle state", () => {
    expect(cashFlowPeriodHref("period-123", false)).toBe("/cash-flow?period=period-123");
    expect(cashFlowPeriodHref("period-123", true)).toBe("/cash-flow?period=period-123&view=all");
    expect(cashFlowPeriodHref("period-123", false, true)).toBe("/cash-flow?period=period-123&accounts=all");
    expect(cashFlowPeriodHref("period-123", true, true)).toBe("/cash-flow?period=period-123&view=all&accounts=all");
  });

  it("targets the server-selected current period even outside the compact window", () => {
    expect(cashFlowCurrentPeriodHref("current-period", "distant-period", true, true)).toBe("/cash-flow?period=current-period&view=all&accounts=all");
    expect(cashFlowCurrentPeriodHref(null, "distant-period", false, false)).toBeNull();
    expect(cashFlowCurrentPeriodHref("current-period", "current-period", false, false)).toBeNull();
  });

  it("labels protected and modified recurring occurrences", () => {
    expect(recurringOccurrenceDisplayState({ generated: true, planned: true, hasException: false })).toBe("regular");
    expect(recurringOccurrenceDisplayState({ generated: true, planned: true, hasException: true })).toBe("modified");
    expect(recurringOccurrenceDisplayState({ generated: true, planned: true, hasException: false, skipped: true })).toBe("skipped");
    expect(recurringOccurrenceDisplayState({ generated: false, planned: true, hasException: false })).toBe("manual");
    expect(recurringOccurrenceDisplayState({ generated: true, planned: false, hasException: true })).toBe("actual");
    expect(recurringRangeLabel("2026-09-18", 6)).toBe("Through 2026-09-18 (6 planned)");
  });

  it("summarizes active schedules and keeps the full manager on its dedicated route", () => {
    expect(recurringCashFlowManagerPath).toBe("/cash-flow/recurring");
    expect(recurringCashFlowSummaryItems([
      {
        id: "ended",
        kind: "expense",
        state: "ended",
        nextOccurrenceOn: null,
        versions: [{ name: "Old", amountMinor: 100, frequency: "monthly", isCurrent: true }],
      },
      {
        id: "later",
        kind: "income",
        state: "active",
        nextOccurrenceOn: "2026-09-01",
        versions: [
          { name: "Old pay", amountMinor: 100, frequency: "monthly", isCurrent: false },
          { name: "Pay", amountMinor: 12500, frequency: "biweekly", isCurrent: true },
        ],
      },
      {
        id: "paused",
        kind: "expense",
        state: "paused",
        nextOccurrenceOn: null,
        versions: [],
      },
    ])).toEqual([
      { id: "later", kind: "income", state: "active", name: "Pay", amountMinor: 12500, frequency: "biweekly", nextOccurrenceOn: "2026-09-01" },
      { id: "paused", kind: "expense", state: "paused", name: "Unnamed series", amountMinor: null, frequency: null, nextOccurrenceOn: null },
    ]);
  });
});
