import { describe, expect, it, vi } from "vitest";
import type { Database } from "../client";
import {
  createGoalPlanRepository,
  GOAL_PLAN_FREQUENCIES,
  type FinancialGoalPlanView,
  type GoalPlanDestinationAccountView,
} from "./goal-plans";

vi.mock("./shared", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    recalculateAccountProjection: vi.fn(async () => ({ snapshotsCreated: 0, snapshotsUpdated: 0 })),
    refreshCashFlowLinkedAccountProjections: vi.fn(async () => ({ accountCount: 0, snapshotsCreated: 0, snapshotsUpdated: 0 })),
  };
});
vi.mock("./cash-flow", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    recurringFutureThroughDate: vi.fn(async (_db: unknown, _owner: string, _series: string, _from: string, end: string | null) => end ?? "2026-12-31"),
    syncGeneratedRecurringOccurrences: vi.fn(async () => ({ insertedCount: 0, updatedCount: 0, deletedCount: 0, skippedCount: 0, preservedCount: 0, affectedTransactionIds: [], affectedTransferIds: [] })),
  };
});

type QueryResult = unknown;

class MockChain {
  constructor(private readonly results: QueryResult[]) {}
  from() { return this; }
  innerJoin() { return this; }
  leftJoin() { return this; }
  where() { return this; }
  orderBy() { return this; }
  limit() { return this; }
  for() { return this; }
  set() { return this; }
  values() { return this; }
  returning() { return this; }
  then(resolve: (value: QueryResult) => void) {
    resolve(this.results.shift());
  }
}

function createMockTx(results: QueryResult[], operationLog: string[] = []) {
  const chain = () => new MockChain(results);
  return {
    select: vi.fn(() => chain()),
    insert: vi.fn(() => { operationLog.push("insert"); return chain(); }),
    update: vi.fn(() => { operationLog.push("update"); return chain(); }),
    delete: vi.fn(() => { operationLog.push("delete"); return chain(); }),
  };
}

function createMockDb(options: { selectResults?: QueryResult[]; txResults?: QueryResult[]; operationLog?: string[] } = {}) {
  const operationLog = options.operationLog ?? [];
  const tx = createMockTx(options.txResults ?? [], operationLog);
  const selectResults = options.selectResults ?? [];
  return {
    select: vi.fn(() => new MockChain(selectResults)),
    transaction: vi.fn(async (callback: (tx: ReturnType<typeof createMockTx>) => Promise<unknown>) => callback(tx)),
  } as unknown as Database;
}

const planViewRow = {
  id: "plan-1",
  goalId: "goal-1",
  contributionRuleId: "rule-1",
  cashFlowSeriesId: null,
  isEnabled: true,
  ruleAccountId: "acct-1",
  ruleAmountMinor: 25000,
  ruleFrequency: "monthly",
  ruleStartsOn: "2026-09-11",
  ruleEndsOn: "2026-12-31",
  ruleIsEnabled: true,
  versionFromAccountId: null,
  versionToAccountId: null,
  versionAmountMinor: null,
  versionFrequency: null,
  versionStartsOn: null,
  versionEndsOn: null,
  versionCountsAsExpense: null,
  goalName: "Emergency fund",
  targetMinor: 500000,
  targetDate: "2026-12-31",
  priority: 1,
  goalStatus: "active",
  currency: "CAD",
  createdAt: new Date("2026-09-11T00:00:00.000Z"),
  updatedAt: new Date("2026-09-11T00:00:00.000Z"),
};

const expectedView: FinancialGoalPlanView = {
  id: "plan-1",
  goalId: "goal-1",
  contributionRuleId: "rule-1",
  cashFlowSeriesId: null,
  accountId: "acct-1",
  sourceAccountId: null,
  enabled: true,
  ruleEnabled: true,
  amountMinor: 25000,
  frequency: "monthly",
  startsOn: "2026-09-11",
  endsOn: "2026-12-31",
  countsAsExpense: false,
  sourceRequired: true,
  goalName: "Emergency fund",
  targetMinor: 500000,
  targetDate: "2026-12-31",
  priority: 1,
  goalStatus: "active",
  currency: "CAD",
  accountName: "Savings",
  accountKind: "savings",
  institutionName: "Bank",
  sourceAccountName: null,
  sourceAccountKind: null,
  sourceInstitutionName: null,
  sourceIsVisibleInCashFlow: null,
  createdAt: new Date("2026-09-11T00:00:00.000Z"),
  updatedAt: new Date("2026-09-11T00:00:00.000Z"),
};

describe("goal plan repository", () => {
  it("exposes the required API surface", () => {
    const repository = createGoalPlanRepository(createMockDb());
    expect(typeof repository.listByOwner).toBe("function");
    expect(typeof repository.getByGoal).toBe("function");
    expect(typeof repository.listEligibleDestinationAccounts).toBe("function");
    expect(typeof repository.savePlan).toBe("function");
    expect(typeof repository.setEnabled).toBe("function");
    expect(GOAL_PLAN_FREQUENCIES).toEqual(["weekly", "biweekly", "monthly"]);
  });

  it("maps joined rows to FinancialGoalPlanView", async () => {
    const db = createMockDb({ selectResults: [[planViewRow], [{ id: "acct-1", name: "Savings", institution: "Bank", kind: "savings", currency: "CAD", isVisibleInCashFlow: true }]] });
    const repository = createGoalPlanRepository(db);
    await expect(repository.listByOwner("owner-1")).resolves.toEqual([expectedView]);
  });

  it("returns null when a goal has no plan", async () => {
    const db = createMockDb({ selectResults: [[]] });
    const repository = createGoalPlanRepository(db);

    await expect(repository.getByGoal("owner-1", "goal-1")).resolves.toBeNull();
  });

  it("maps eligible destination accounts", async () => {
    const destinationRow = {
      id: "acct-1",
      name: "Savings",
      institution: "Bank",
      kind: "savings",
      currency: "CAD",
    };
    const db = createMockDb({ selectResults: [[destinationRow]] });
    const repository = createGoalPlanRepository(db);

    const expected: GoalPlanDestinationAccountView = {
      id: "acct-1",
      name: "Savings",
      institution: "Bank",
      kind: "savings",
      currency: "CAD",
    };
    await expect(repository.listEligibleDestinationAccounts("owner-1")).resolves.toEqual([expected]);
  });

  it("rejects non-positive or unsafe contribution amounts", async () => {
    const repository = createGoalPlanRepository(createMockDb());
    const input = { goalId: "goal-1", accountId: "acct-1", sourceAccountId: "source-1", amountMinor: 0, frequency: "monthly" as const, countsAsExpense: false };

    await expect(repository.savePlan("owner-1", input, "2026-09-11")).rejects.toThrow(
      "Contribution amount must be a positive safe integer.",
    );
  });

  it("rejects unsupported frequencies", async () => {
    const repository = createGoalPlanRepository(createMockDb());
    const input = { goalId: "goal-1", accountId: "acct-1", sourceAccountId: "source-1", amountMinor: 25000, frequency: "quarterly" as never, countsAsExpense: false };

    await expect(repository.savePlan("owner-1", input, "2026-09-11")).rejects.toThrow(
      "Goal plan frequency is not supported.",
    );
  });

  it("rejects goals without a target date", async () => {
    const db = createMockDb({
      txResults: [[{ id: "goal-1", targetDate: null }]],
    });
    const repository = createGoalPlanRepository(db);
    const input = { goalId: "goal-1", accountId: "acct-1", sourceAccountId: "source-1", amountMinor: 25000, frequency: "monthly" as const, countsAsExpense: false };

    await expect(repository.savePlan("owner-1", input, "2026-09-11")).rejects.toThrow(
      "Goal target date is required.",
    );
  });

  it("rejects goals with a past target date", async () => {
    const db = createMockDb({
      txResults: [[{ id: "goal-1", targetDate: "2026-09-10" }]],
    });
    const repository = createGoalPlanRepository(db);
    const input = { goalId: "goal-1", accountId: "acct-1", sourceAccountId: "source-1", amountMinor: 25000, frequency: "monthly" as const, countsAsExpense: false };

    await expect(repository.savePlan("owner-1", input, "2026-09-11")).rejects.toThrow(
      "Goal target date must be on or after today.",
    );
  });

  it("rejects ineligible destination accounts", async () => {
    const db = createMockDb({
      txResults: [
        [{ id: "goal-1", targetDate: "2026-12-31" }],
        [{ id: "source-1" }],
        [],
      ],
    });
    const repository = createGoalPlanRepository(db);
    const input = { goalId: "goal-1", accountId: "acct-1", sourceAccountId: "source-1", amountMinor: 25000, frequency: "monthly" as const, countsAsExpense: false };
    await expect(repository.savePlan("owner-1", input, "2026-09-11")).rejects.toThrow("Goal plan destination account is not eligible.");
  });

  it("rejects missing plans when toggling", async () => {
    const db = createMockDb({ txResults: [[]] });
    const repository = createGoalPlanRepository(db);
    await expect(repository.setEnabled("owner-1", "goal-1", true, "2026-09-11")).rejects.toThrow("Goal plan not found.");
  });

  it("creates a new plan linkage and returns the joined view", async () => {
    const db = createMockDb({
      txResults: [
        [{ id: "goal-1", targetDate: "2026-12-31" }],
        [{ id: "source-1" }],
        [{ id: "acct-1" }],
        [],
        [{ id: "series-1" }],
        [{ id: "version-1" }],
        [{}],
        [{ id: "plan-1" }],
        [planViewRow],
      ],
    });
    const repository = createGoalPlanRepository(db);
    const input = { goalId: "goal-1", accountId: "acct-1", sourceAccountId: "source-1", amountMinor: 25000, frequency: "monthly" as const, countsAsExpense: false };
    await expect(repository.savePlan("owner-1", input, "2026-09-11")).resolves.toMatchObject({ goalId: "goal-1" });
  });
  it("detaches a legacy contribution rule before deleting it during conversion", async () => {
    const operationLog: string[] = [];
    const db = createMockDb({
      operationLog,
      txResults: [
        [{ id: "goal-1", targetDate: "2026-12-31" }],
        [{ id: "source-1" }],
        [{ id: "acct-1" }],
        [{ id: "plan-1", contributionRuleId: "rule-1", cashFlowSeriesId: null, isEnabled: true }],
        [{ id: "plan-1" }],
        [{ accountId: "acct-old" }],
        [{}],
        [{ id: "series-1" }],
        [{ id: "version-1" }],
        [{}],
        [{}],
        [planViewRow],
      ],
    });
    const repository = createGoalPlanRepository(db);
    const input = { goalId: "goal-1", accountId: "acct-1", sourceAccountId: "source-1", amountMinor: 25000, frequency: "monthly" as const, countsAsExpense: false };

    await expect(repository.savePlan("owner-1", input, "2026-09-11")).resolves.toMatchObject({ id: "plan-1" });
    expect(operationLog.indexOf("update")).toBeGreaterThanOrEqual(0);
    expect(operationLog.indexOf("delete")).toBeGreaterThan(operationLog.indexOf("update"));
  });

});
