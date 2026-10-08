import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const rows: unknown[][] = [];
  const tables = {
    accounts: { id: "accounts.id", ownerId: "accounts.ownerId", isActive: "accounts.isActive" },
    balanceSnapshots: { id: "balanceSnapshots.id", accountId: "balanceSnapshots.accountId", ownerId: "balanceSnapshots.ownerId" },
    recurringCashFlowSeries: { id: "recurringCashFlowSeries.id", ownerId: "recurringCashFlowSeries.ownerId", state: "recurringCashFlowSeries.state", kind: "recurringCashFlowSeries.kind" },
    users: { id: "users.id", onboardingState: "users.onboardingState" },
  };
  const eq = vi.fn((left: unknown, right: unknown) => ({ left, right }));
  const and = vi.fn((...conditions: unknown[]) => ({ conditions }));
  const sql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }));
  const select = vi.fn(() => {
    const row = rows.shift() ?? [];
    const limit = vi.fn(async () => row);
    const where = vi.fn(() => ({ limit }));
    const chain = { where, innerJoin: vi.fn(() => chain) };
    return { from: vi.fn(() => chain) };
  });
  return { rows, tables, eq, and, sql, select, database: { select } };
});

vi.mock("@athena/database", () => ({
  accounts: mocks.tables.accounts,
  and: mocks.and,
  balanceSnapshots: mocks.tables.balanceSnapshots,
  eq: mocks.eq,
  recurringCashFlowSeries: mocks.tables.recurringCashFlowSeries,
  sql: mocks.sql,
  users: mocks.tables.users,
}));

import { getOnboardingSnapshot } from "./onboarding";

describe("server onboarding loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows.splice(0, mocks.rows.length,
      [{ onboardingState: "active" }],
      [{ id: "account-a" }],
      [{ id: "balance-a" }],
      [{ id: "series-a" }],
    );
  });

  it("derives complete owner-scoped progress from the four server queries", async () => {
    const snapshot = await getOnboardingSnapshot(mocks.database as never, "00000000-0000-0000-0000-000000000001");

    expect(snapshot).toEqual({ state: "active", account: true, balance: true, recurring: true, completedCount: 3, nextStepId: null });
    expect(mocks.eq).toHaveBeenCalledWith("users.id", "00000000-0000-0000-0000-000000000001");
    expect(mocks.eq).toHaveBeenCalledWith("accounts.ownerId", "00000000-0000-0000-0000-000000000001");
    expect(mocks.eq).toHaveBeenCalledWith("balanceSnapshots.ownerId", "00000000-0000-0000-0000-000000000001");
    expect(mocks.eq).toHaveBeenCalledWith("recurringCashFlowSeries.ownerId", "00000000-0000-0000-0000-000000000001");
  });

  it("fails closed when the persisted state is outside the schema contract", async () => {
    mocks.rows.unshift([{ onboardingState: "invalid" }]);
    await expect(getOnboardingSnapshot(mocks.database as never, "00000000-0000-0000-0000-000000000001")).rejects.toThrow("Onboarding state is invalid.");
  });

  it("produces an identical snapshot from precomputed flags while skipping the derived queries", async () => {
    mocks.rows.splice(0, mocks.rows.length, [{ onboardingState: "active" }]);
    const precomputed = { hasAccount: true, hasBalance: true, hasRecurring: true };

    const snapshot = await getOnboardingSnapshot(mocks.database as never, "00000000-0000-0000-0000-000000000001", precomputed);

    expect(snapshot).toEqual({ state: "active", account: true, balance: true, recurring: true, completedCount: 3, nextStepId: null });
    expect(mocks.database.select).toHaveBeenCalledTimes(1);
    expect(mocks.eq).toHaveBeenCalledWith("users.id", "00000000-0000-0000-0000-000000000001");
    expect(mocks.eq).not.toHaveBeenCalledWith("accounts.ownerId", expect.anything());
  });

  it("keeps querying only the flags that were not precomputed", async () => {
    mocks.rows.splice(0, mocks.rows.length,
      [{ onboardingState: "active" }],
      [{ id: "account-a" }],
      [{ id: "series-a" }],
    );

    const snapshot = await getOnboardingSnapshot(mocks.database as never, "00000000-0000-0000-0000-000000000001", { hasBalance: false });

    expect(snapshot).toEqual({ state: "active", account: true, balance: false, recurring: true, completedCount: 2, nextStepId: "balance" });
    expect(mocks.database.select).toHaveBeenCalledTimes(3);
  });
});
