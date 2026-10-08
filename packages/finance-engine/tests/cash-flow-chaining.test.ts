import { describe, expect, it } from "vitest";
import { money, projectCashFlow, projectChainedCashFlow } from "../src/index";
import type { MinorUnits } from "../src/index";

const periods = [
  { id: "p1", startsOn: "2026-08-06", endsOn: "2026-08-19", payDate: "2026-08-19" },
  { id: "p2", startsOn: "2026-08-20", endsOn: "2026-09-02", payDate: "2026-09-02" },
  { id: "p3", startsOn: "2026-09-03", endsOn: "2026-09-16", payDate: "2026-09-16" },
] as const;

describe("chained account cash-flow projection", () => {
  it("chains periods, handles multiple incomes and negative balances, and resets at a later manual anchor", () => {
    const result = projectChainedCashFlow({
      accounts: [
        { id: "checking", name: "Checking", includeInAvailableCash: true },
        { id: "reserve", name: "Reserve", includeInAvailableCash: true },
        { id: "credit", name: "Credit", includeInAvailableCash: false },
      ],
      anchors: [
        { id: "checking-anchor", accountId: "checking", asOf: "2026-08-05", balanceMinor: money(10000), source: "actual" },
        { id: "reserve-anchor", accountId: "reserve", asOf: "2026-08-05", balanceMinor: money(100), source: "actual" },
        { id: "credit-anchor", accountId: "credit", asOf: "2026-08-05", balanceMinor: money(0), source: "actual" },
        { id: "checking-manual", accountId: "checking", asOf: "2026-08-25", balanceMinor: money(9000), source: "manual" },
      ],
      transactions: [
        { id: "income-a", accountId: "checking", transactionDate: "2026-08-10", kind: "income", amountMinor: money(1000), status: "planned", description: "First income" },
        { id: "income-b", accountId: "checking", transactionDate: "2026-08-10", kind: "income", amountMinor: money(500), status: "planned", description: "Second income" },
        { id: "expense-a", accountId: "checking", transactionDate: "2026-08-11", kind: "expense", amountMinor: money(300), status: "planned", description: "Expense" },
        { id: "before-anchor", accountId: "checking", transactionDate: "2026-08-21", kind: "income", amountMinor: money(2000), status: "planned", description: "Covered by manual anchor" },
        { id: "after-anchor", accountId: "checking", transactionDate: "2026-08-26", kind: "expense", amountMinor: money(500), status: "planned", description: "After manual anchor" },
        { id: "negative", accountId: "reserve", transactionDate: "2026-08-08", kind: "expense", amountMinor: money(200), status: "planned", description: "Overdraft" },
        { id: "later-expense", accountId: "checking", transactionDate: "2026-09-04", kind: "expense", amountMinor: money(1000), status: "planned", description: "Later expense" },
      ],
      transfers: [],
      periods,
    });

    const checking = (periodId: string) => result.periods.find((period) => period.period.id === periodId)?.accounts.find((account) => account.accountId === "checking");
    expect(checking("p1")).toMatchObject({ openingBalanceMinor: 10000, incomeMinor: 1500, expenseMinor: 300, endingBalanceMinor: 11200 });
    expect(checking("p2")).toMatchObject({ openingBalanceMinor: 11200, expenseMinor: 500, endingBalanceMinor: 8500, endingSource: "projected" });
    expect(checking("p2")?.movements.map((movement) => movement.recordId)).toEqual(["before-anchor", "checking-manual", "after-anchor"]);
    expect(checking("p3")).toMatchObject({ openingBalanceMinor: 8500, expenseMinor: 1000, endingBalanceMinor: 7500 });
    expect(result.periods[0]?.accounts.find((account) => account.accountId === "reserve")).toMatchObject({ endingBalanceMinor: -100 });
    expect(result.periods[0]?.warnings).toContain("Reserve is projected below zero.");
    expect(result.periods[0]?.warnings).not.toContain("Checking is projected below zero.");
  });

  it("chains the next projected payday from an observed current-payday balance", () => {
    const paydayPeriods = [
      { id: "p1", startsOn: "2026-08-06", endsOn: "2026-08-19", payDate: "2026-08-06" },
      { id: "p2", startsOn: "2026-08-20", endsOn: "2026-09-02", payDate: "2026-08-20" },
      { id: "p3", startsOn: "2026-09-03", endsOn: "2026-09-16", payDate: "2026-09-03" },
    ] as const;
    const result = projectChainedCashFlow({
      accounts: [{ id: "checking", name: "Checking", includeInAvailableCash: true }],
      anchors: [
        { id: "opening", accountId: "checking", asOf: "2026-08-05", balanceMinor: money(200000), source: "actual" },
        { id: "observed", accountId: "checking", asOf: "2026-08-20", balanceMinor: money(215000), source: "actual" },
      ],
      transactions: [
        { id: "first-period-income", accountId: "checking", transactionDate: "2026-08-10", kind: "income", amountMinor: money(20000), status: "planned" },
        { id: "second-period-income", accountId: "checking", transactionDate: "2026-08-25", kind: "income", amountMinor: money(50000), status: "planned" },
      ],
      transfers: [],
      periods: paydayPeriods,
    });

    expect(result.periods[0]?.endingBalanceMinor).toBe(220000);
    expect(result.periods[1]?.accounts[0]).toMatchObject({ openingBalanceMinor: 215000, endingBalanceMinor: 265000 });
    expect(result.periods[2]?.accounts[0]).toMatchObject({ openingBalanceMinor: 265000, endingBalanceMinor: 265000 });
  });

  it("reports available-cash boundary transfer directions separately on the period timeline", () => {
    const result = projectChainedCashFlow({
      accounts: [
        { id: "perso", name: "Perso", includeInAvailableCash: true },
        { id: "reserve", name: "Reserve", includeInAvailableCash: false },
      ],
      anchors: [{ id: "a1", accountId: "perso", asOf: "2026-08-01", balanceMinor: money(5000), source: "actual" }],
      transactions: [],
      transfers: [{
        id: "to-reserve",
        fromAccountId: "perso",
        toAccountId: "reserve",
        transferDate: "2026-08-06",
        amountMinor: money(75168),
        status: "planned",
        description: "Reserve",
      }],
      periods: [{ id: "p1", startsOn: "2026-08-06", endsOn: "2026-08-19", payDate: "2026-08-06" }],
    });
    const period = result.periods[0]!;
    expect(period.transfersOutMinor).toBe(75168);
    expect(period.transfersInMinor).toBe(0);
    expect(period.accounts.find((account) => account.accountId === "perso")?.transfersOutMinor).toBe(75168);
    expect(period.accounts.find((account) => account.accountId === "perso")?.transfersInMinor).toBe(0);
  });

  it("counts transfer outflows marked as expense toward spending totals while keeping ledger transfer kind", () => {
    const result = projectChainedCashFlow({
      accounts: [
        { id: "perso", name: "Perso", includeInAvailableCash: true },
        { id: "cibc", name: "CIBC", includeInAvailableCash: false },
      ],
      anchors: [{ id: "a1", accountId: "perso", asOf: "2026-08-01", balanceMinor: money(5000), source: "actual" }],
      transactions: [],
      transfers: [{
        id: "home",
        fromAccountId: "perso",
        toAccountId: "cibc",
        transferDate: "2026-08-06",
        amountMinor: money(1289),
        status: "planned",
        description: "Transfert Maison",
        countsAsExpense: true,
      }],
      periods: [{ id: "p1", startsOn: "2026-08-06", endsOn: "2026-08-19", payDate: "2026-08-06" }],
    });
    const period = result.periods[0]!;
    const perso = period.accounts.find((account) => account.accountId === "perso")!;
    const cibc = period.accounts.find((account) => account.accountId === "cibc")!;
    expect(period.spendingMinor).toBe(1289);
    expect(period.transfersOutMinor).toBe(0);
    expect(period.transfersInMinor).toBe(0);
    expect(perso.expenseMinor).toBe(1289);
    expect(perso.transfersOutMinor).toBe(0);
    expect(perso.movements.map((movement) => ({ kind: movement.kind, countsAsExpense: movement.countsAsExpense }))).toEqual([
      { kind: "transfer-out", countsAsExpense: true },
    ]);
    expect(cibc.transfersInMinor).toBe(1289);
    expect(cibc.movements.map((movement) => movement.kind)).toEqual(["transfer-in"]);
  });

  it("uses deterministic same-day ordering with anchors, income, transfers, expenses, and transfer outflows", () => {
    const result = projectChainedCashFlow({
      accounts: [
        { id: "included", name: "Included", includeInAvailableCash: true },
        { id: "other", name: "Other", includeInAvailableCash: false },
      ],
      anchors: [{ id: "anchor", accountId: "included", asOf: "2026-08-05", balanceMinor: money(1000), source: "actual" }],
      transactions: [
        { id: "expense", accountId: "included", transactionDate: "2026-08-06", kind: "expense", amountMinor: money(100), status: "planned" },
        { id: "income", accountId: "included", transactionDate: "2026-08-06", kind: "income", amountMinor: money(200), status: "planned" },
      ],
      transfers: [{ id: "transfer", fromAccountId: "included", toAccountId: "other", transferDate: "2026-08-06", amountMinor: money(50), status: "planned" }],
      periods: [periods[0]!],
    });
    expect(result.periods[0]?.accounts[0]?.movements.map((movement) => movement.kind)).toEqual(["income", "expense", "transfer-out"]);
    expect(result.periods[0]?.accounts[0]?.movements.map((movement) => movement.balanceAfterMinor)).toEqual([1200, 1100, 1050]);
  });

  it("uses a later anchor as the ending source after earlier planned activity", () => {
    const result = projectChainedCashFlow({
      accounts: [{ id: "checking", name: "Checking", includeInAvailableCash: true }],
      anchors: [
        { id: "initial", accountId: "checking", asOf: "2026-08-05", balanceMinor: money(1000), source: "actual" },
        { id: "later", accountId: "checking", asOf: "2026-08-10", balanceMinor: money(900), source: "manual" },
      ],
      transactions: [{ id: "covered", accountId: "checking", transactionDate: "2026-08-08", kind: "expense", amountMinor: money(100), status: "planned" }],
      transfers: [],
      periods: [periods[0]!],
    });
    expect(result.periods[0]?.accounts[0]).toMatchObject({ endingBalanceMinor: 900, endingSource: "manual" });
  });

  it("carries a same-day movement after an anchor into the next period opening", () => {
    const result = projectChainedCashFlow({
      accounts: [{ id: "checking", name: "Checking", includeInAvailableCash: true }],
      anchors: [{ id: "anchor", accountId: "checking", asOf: "2026-08-06", balanceMinor: money(900), source: "manual" }],
      transactions: [{ id: "same-day-expense", accountId: "checking", transactionDate: "2026-08-06", kind: "expense", amountMinor: money(100), status: "planned" }],
      transfers: [],
      periods,
    });
    expect(result.periods[0]?.accounts[0]).toMatchObject({ endingBalanceMinor: 800 });
    expect(result.periods[1]?.accounts[0]).toMatchObject({ openingBalanceMinor: 800 });
  });

  it("replays a same-day movement after an anchor before the first displayed period", () => {
    const result = projectChainedCashFlow({
      accounts: [{ id: "checking", name: "Checking", includeInAvailableCash: true }],
      anchors: [{ id: "anchor", accountId: "checking", asOf: "2026-08-19", balanceMinor: money(900), source: "manual" }],
      transactions: [{ id: "same-day-expense", accountId: "checking", transactionDate: "2026-08-19", kind: "expense", amountMinor: money(100), status: "planned" }],
      transfers: [],
      periods: [periods[1]!],
    });
    expect(result.periods[0]?.accounts[0]).toMatchObject({ openingBalanceMinor: 800, endingBalanceMinor: 800 });
  });
});

describe("available-cash transfer boundaries", () => {
  it("keeps included-to-included transfers neutral and applies each boundary once", () => {
    const result = projectChainedCashFlow({
      accounts: [
        { id: "included-a", name: "Included A", includeInAvailableCash: true },
        { id: "included-b", name: "Included B", includeInAvailableCash: true },
        { id: "excluded-a", name: "Excluded A", includeInAvailableCash: false },
        { id: "excluded-b", name: "Excluded B", includeInAvailableCash: false },
      ],
      anchors: ["included-a", "included-b", "excluded-a", "excluded-b"].map((accountId) => ({
        id: `${accountId}-anchor`, accountId, asOf: "2026-08-05", balanceMinor: money(1000), source: "actual" as const,
      })),
      transactions: [],
      transfers: [
        { id: "internal", fromAccountId: "included-a", toAccountId: "included-b", transferDate: "2026-08-06", amountMinor: money(100), status: "planned" },
        { id: "out-boundary", fromAccountId: "included-a", toAccountId: "excluded-a", transferDate: "2026-08-06", amountMinor: money(100), status: "planned" },
        { id: "in-boundary", fromAccountId: "excluded-a", toAccountId: "included-b", transferDate: "2026-08-06", amountMinor: money(100), status: "planned" },
        { id: "external", fromAccountId: "excluded-a", toAccountId: "excluded-b", transferDate: "2026-08-06", amountMinor: money(100), status: "planned" },
      ],
      periods: [periods[0]!],
    });
    const period = result.periods[0]!;
    // Boundary-only: excluded→included = 100 in, included→excluded = 100 out.
    // Internal and external-external transfers are not timeline transfer metrics.
    expect(period.transfersInMinor).toBe(100);
    expect(period.transfersOutMinor).toBe(100);
    expect(period.availableCashDeltaMinor).toBe(0);
    expect(period.availableBeforeNextPayMinor).toBe(2000);
    expect(period.accounts.find((account) => account.accountId === "included-a")?.endingBalanceMinor).toBe(800);
    expect(period.accounts.find((account) => account.accountId === "included-b")?.endingBalanceMinor).toBe(1200);
    expect(period.accounts.find((account) => account.accountId === "excluded-a")?.endingBalanceMinor).toBe(900);
    expect(period.accounts.find((account) => account.accountId === "excluded-b")?.endingBalanceMinor).toBe(1100);
  });

  it("warns and excludes unassigned transactions and transfers without guessing an account", () => {
    const result = projectChainedCashFlow({
      accounts: [{ id: "included", name: "Included", includeInAvailableCash: true }],
      anchors: [{ id: "anchor", accountId: "included", asOf: "2026-08-05", balanceMinor: money(1000), source: "actual" }],
      transactions: [{ id: "unassigned-income", accountId: null, transactionDate: "2026-08-06", kind: "income", amountMinor: money(500), status: "planned", description: "Unassigned pay" }],
      transfers: [{ id: "unknown-transfer", fromAccountId: "included", toAccountId: "missing", transferDate: "2026-08-06", amountMinor: money(100), status: "planned", description: "Unknown destination" }],
      periods: [periods[0]!],
    });
    const period = result.periods[0]!;
    expect(period.accounts[0]).toMatchObject({ endingBalanceMinor: 1000, incomeMinor: 0, transfersInMinor: 0, transfersOutMinor: 0 });
    expect(period.warnings).toEqual(expect.arrayContaining([
      "Unassigned pay is unassigned and was excluded from account balances.",
      "Unknown destination is unassigned and was excluded from account balances.",
    ]));
  });
});

describe("cash-flow minor-unit safety", () => {
  it("rejects a chained-projection anchor whose balance is not a safe integer", () => {
    expect(() => projectChainedCashFlow({
      accounts: [{ id: "checking", name: "Checking", includeInAvailableCash: true }],
      anchors: [
        { id: "unsafe-anchor", accountId: "checking", asOf: "2026-08-05", balanceMinor: (Number.MAX_SAFE_INTEGER + 2) as MinorUnits, source: "actual" },
      ],
      transactions: [],
      transfers: [],
      periods,
    })).toThrowError(new RangeError("Anchor balance must be a safe integer minor-unit amount."));
  });

  it("rejects a single-period projection whose opening balance is not a safe integer", () => {
    expect(() => projectCashFlow({
      id: "p1",
      label: "Period 1",
      payDate: "2026-08-19",
      openingBalance: (Number.MAX_SAFE_INTEGER + 2) as MinorUnits,
      items: [],
    })).toThrowError(new RangeError("Anchor balance must be a safe integer minor-unit amount."));
  });

  it("computes a safe net ending balance without overflowing an unreported subtotal", () => {
    const result = projectCashFlow({
      id: "net-boundary",
      label: "Net boundary",
      payDate: "2026-08-19",
      openingBalance: money(Number.MAX_SAFE_INTEGER),
      items: [
        { id: "expense", label: "Expense", account: "Checking", amount: money(Number.MAX_SAFE_INTEGER), kind: "expense", planned: true },
        { id: "transfer", label: "Transfer out", account: "Checking", amount: money(1), kind: "transfer", direction: "out", planned: false },
      ],
    });
    expect(result.endingBalance).toBe(-1);
    expect(result.availableBeforeNextPay).toBe(-1);
  });

  it("nets boundary transfers and transactions before checking the available-cash delta", () => {
    const result = projectChainedCashFlow({
      accounts: [
        { id: "checking", name: "Checking", includeInAvailableCash: true },
        { id: "external-a", name: "External A", includeInAvailableCash: false },
        { id: "external-b", name: "External B", includeInAvailableCash: false },
      ],
      anchors: [{ id: "checking-anchor", accountId: "checking", asOf: "2026-08-05", balanceMinor: money(0), source: "actual" }],
      transactions: [
        { id: "income", accountId: "checking", transactionDate: "2026-08-10", kind: "income", amountMinor: money(Number.MAX_SAFE_INTEGER), status: "actual" },
      ],
      transfers: [
        { id: "pure-out", fromAccountId: "checking", toAccountId: "external-a", transferDate: "2026-08-11", amountMinor: money(Number.MAX_SAFE_INTEGER), status: "actual" },
        { id: "expense-out", fromAccountId: "checking", toAccountId: "external-b", transferDate: "2026-08-12", amountMinor: money(Number.MAX_SAFE_INTEGER), status: "actual", countsAsExpense: true },
      ],
      periods,
    });
    expect(result.periods[0]).toMatchObject({
      incomeMinor: Number.MAX_SAFE_INTEGER,
      spendingMinor: Number.MAX_SAFE_INTEGER,
      transfersOutMinor: Number.MAX_SAFE_INTEGER,
      availableCashDeltaMinor: -Number.MAX_SAFE_INTEGER,
    });
  });

  it("nets included account balances before checking aggregate totals", () => {
    const result = projectChainedCashFlow({
      accounts: [
        { id: "a", name: "A", includeInAvailableCash: true },
        { id: "b", name: "B", includeInAvailableCash: true },
        { id: "c", name: "C", includeInAvailableCash: true },
      ],
      anchors: [
        { id: "a-anchor", accountId: "a", asOf: "2026-08-05", balanceMinor: money(Number.MAX_SAFE_INTEGER), source: "actual" },
        { id: "b-anchor", accountId: "b", asOf: "2026-08-05", balanceMinor: money(Number.MAX_SAFE_INTEGER), source: "actual" },
        { id: "c-anchor", accountId: "c", asOf: "2026-08-05", balanceMinor: money(-Number.MAX_SAFE_INTEGER), source: "actual" },
      ],
      transactions: [],
      transfers: [],
      periods,
    });
    expect(result.periods[0]).toMatchObject({
      openingBalanceMinor: Number.MAX_SAFE_INTEGER,
      availableBeforeNextPayMinor: Number.MAX_SAFE_INTEGER,
      endingBalanceMinor: Number.MAX_SAFE_INTEGER,
    });
  });

  it("throws RangeError when accumulated income exceeds the safe integer range", () => {
    expect(() => projectChainedCashFlow({
      accounts: [{ id: "checking", name: "Checking", includeInAvailableCash: true }],
      anchors: [
        { id: "checking-anchor", accountId: "checking", asOf: "2026-08-05", balanceMinor: money(1), source: "actual" },
      ],
      transactions: [
        { id: "income-a", accountId: "checking", transactionDate: "2026-08-10", kind: "income", amountMinor: money(Number.MAX_SAFE_INTEGER - 1), status: "planned" },
        { id: "income-b", accountId: "checking", transactionDate: "2026-08-11", kind: "income", amountMinor: money(Number.MAX_SAFE_INTEGER - 1), status: "planned" },
      ],
      transfers: [],
      periods,
    })).toThrowError(RangeError);
  });

  it("rejects a period income total that overflows across safe account balances", () => {
    expect(() => projectChainedCashFlow({
      accounts: [
        { id: "a", name: "A", includeInAvailableCash: true },
        { id: "b", name: "B", includeInAvailableCash: true },
      ],
      anchors: [],
      transactions: [
        { id: "income-a", accountId: "a", transactionDate: "2026-08-10", kind: "income", amountMinor: money(Number.MAX_SAFE_INTEGER), status: "planned" },
        { id: "income-b", accountId: "b", transactionDate: "2026-08-10", kind: "income", amountMinor: money(1), status: "planned" },
      ],
      transfers: [],
      periods,
    })).toThrowError(RangeError);
  });
});
describe("cash-flow algorithmic equivalence", () => {
  it("matches the same projection for unsorted valid rows at period boundaries", () => {
    const input = {
      accounts: [
        { id: "included", name: "Included", includeInAvailableCash: true },
        { id: "external", name: "External", includeInAvailableCash: false },
      ],
      anchors: [
        { id: "opening", accountId: "included", asOf: "2026-08-01", balanceMinor: money(1000), source: "actual" as const },
      ],
      transactions: [
        { id: "late", accountId: "included", transactionDate: "2026-08-20", kind: "expense" as const, amountMinor: money(30), status: "planned" as const },
        { id: "boundary", accountId: "included", transactionDate: "2026-08-19", kind: "income" as const, amountMinor: money(200), status: "planned" as const },
        { id: "early", accountId: "included", transactionDate: "2026-08-06", kind: "income" as const, amountMinor: money(100), status: "planned" as const },
      ],
      transfers: [
        { id: "late-transfer", fromAccountId: "included", toAccountId: "external", transferDate: "2026-08-20", amountMinor: money(40), status: "planned" as const },
        { id: "boundary-transfer", fromAccountId: "external", toAccountId: "included", transferDate: "2026-08-19", amountMinor: money(50), status: "planned" as const },
      ],
      periods,
    };
    const ordered = projectChainedCashFlow(input);
    const unsorted = projectChainedCashFlow({
      ...input,
      transactions: [...input.transactions].reverse(),
      transfers: [...input.transfers].reverse(),
    });
    expect(unsorted).toEqual(ordered);
    expect(unsorted.periods.map((period) => ({
      id: period.period.id,
      income: period.incomeMinor,
      spending: period.spendingMinor,
      transfersIn: period.transfersInMinor,
      transfersOut: period.transfersOutMinor,
    }))).toEqual([
      { id: "p1", income: 300, spending: 0, transfersIn: 50, transfersOut: 0 },
      { id: "p2", income: 0, spending: 30, transfersIn: 0, transfersOut: 40 },
      { id: "p3", income: 0, spending: 0, transfersIn: 0, transfersOut: 0 },
    ]);
  });

  it("attributes invalid warnings before and after the period range once", () => {
    const result = projectChainedCashFlow({
      accounts: [{ id: "included", name: "Included", includeInAvailableCash: true }],
      anchors: [{ id: "opening", accountId: "included", asOf: "2026-08-01", balanceMinor: money(1000), source: "actual" }],
      transactions: [
        { id: "before", accountId: "included", transactionDate: "2026-08-01", kind: "income", amountMinor: -1 as MinorUnits, status: "planned", description: "Before range" },
        { id: "inside", accountId: null, transactionDate: "2026-08-21", kind: "income", amountMinor: money(10), status: "planned", description: "Inside range" },
      ],
      transfers: [
        { id: "after", fromAccountId: "included", toAccountId: "missing", transferDate: "2026-10-01", amountMinor: money(10), status: "planned", description: "After range" },
      ],
      periods,
    });
    expect(result.periods[0]?.warnings).toContain("Transaction before has an invalid non-negative minor-unit amount and was ignored.");
    expect(result.periods[1]?.warnings).toContain("Inside range is unassigned and was excluded from account balances.");
    expect(result.periods[2]?.warnings).toContain("After range is unassigned and was excluded from account balances.");
  });

  it("keeps the stable final anchor for equal date and id keys", () => {
    const result = projectChainedCashFlow({
      accounts: [{ id: "included", name: "Included", includeInAvailableCash: true }],
      anchors: [
        { id: "opening", accountId: "included", asOf: "2026-08-01", balanceMinor: money(1000), source: "actual" },
        { id: "duplicate", accountId: "included", asOf: "2026-08-06", balanceMinor: money(1100), source: "actual" },
        { id: "duplicate", accountId: "included", asOf: "2026-08-06", balanceMinor: money(1200), source: "manual" },
      ],
      transactions: [],
      transfers: [],
      periods: [periods[0]!],
    });
    expect(result.periods[0]?.accounts[0]?.openingBalanceMinor).toBe(1200);
    expect(result.periods[0]?.accounts[0]?.endingBalanceMinor).toBe(1200);
    expect(result.periods[0]?.accounts[0]?.endingSource).toBe("manual");
  });
});
