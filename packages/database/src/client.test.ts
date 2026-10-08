import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { type Database, type DatabaseObservation, withAuthUserContext, withDatabaseContext, withDatabaseObservation } from "./client";

const ownerA = "00000000-0000-4000-8000-0000000000a1";
const ownerB = "00000000-0000-4000-8000-0000000000b1";

type FakeTransaction = {
  readonly execute: ReturnType<typeof vi.fn>;
};

function fakeDatabase(executeResults: readonly unknown[][] = []) {
  const transactions: FakeTransaction[] = [];
  const database = {
    transaction: vi.fn(async <T>(callback: (transaction: FakeTransaction) => Promise<T>) => {
      const pendingResults = [...executeResults];
      const transaction: FakeTransaction = { execute: vi.fn(async () => pendingResults.shift() ?? []) };
      transactions.push(transaction);
      return callback(transaction);
    }),
  } as unknown as Database;
  return { database, transactions };
}

const dialect = new PgDialect();

describe("database context", () => {
  it("sets the transaction-local context before nested operations", async () => {
    const fixture = fakeDatabase();
    const result = await withDatabaseContext(fixture.database, { ownerId: ownerA, authUserId: "auth-a" }, async (transaction) => {
      await transaction.execute(sql`select 42`);
      return "completed";
    });

    expect(result).toBe("completed");
    expect(fixture.database.transaction).toHaveBeenCalledOnce();
    expect(fixture.transactions).toHaveLength(1);
    expect(fixture.transactions[0]!.execute).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ ownerId: "", authUserId: "auth-a" }, "Database owner context is invalid."],
    [{ ownerId: "not-a-uuid", authUserId: "auth-a" }, "Database owner context is invalid."],
    [{ ownerId: ownerA, authUserId: "   " }, "Database auth-user context is required."],
  ])("rejects invalid context %j", async (context, message) => {
    const fixture = fakeDatabase();

    await expect(withDatabaseContext(fixture.database, context, async () => undefined)).rejects.toThrow(message);
    expect(fixture.database.transaction).not.toHaveBeenCalled();
  });

  it("uses isolated transaction objects for sequential owner contexts", async () => {
    const fixture = fakeDatabase();

    await withDatabaseContext(fixture.database, { ownerId: ownerA, authUserId: "auth-a" }, async () => undefined);
    await withDatabaseContext(fixture.database, { ownerId: ownerB, authUserId: "auth-b" }, async () => undefined);

    expect(fixture.database.transaction).toHaveBeenCalledTimes(2);
    expect(fixture.transactions).toHaveLength(2);
    expect(fixture.transactions[0]).not.toBe(fixture.transactions[1]);
    expect(fixture.transactions[0]!.execute).toHaveBeenCalledOnce();
    expect(fixture.transactions[1]!.execute).toHaveBeenCalledOnce();
  });
});

describe("auth-user context", () => {
  it("sets the transaction-local auth user and mapped owner ids before nested operations", async () => {
    const fixture = fakeDatabase([[], [{ athena_user_id: ownerA }], []]);
    const result = await withAuthUserContext(fixture.database, "auth-a", async (transaction) => {
      await transaction.execute(sql`select 1`);
      return "completed";
    });

    expect(result).toBe("completed");
    expect(fixture.database.transaction).toHaveBeenCalledOnce();
    const statements = fixture.transactions[0]!.execute.mock.calls.map(([statement]) => dialect.sqlToQuery(statement as SQL).sql);
    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain("set_config('app.auth_user_id'");
    expect(statements[0]).not.toContain("auth_user_workspaces");
    expect(statements[1]).toContain("auth_user_workspaces");
    expect(statements[1]).toContain("set_config('app.owner_id'");
    expect(statements[2]).toBe("select 1");
  });

  it.each(["", "   "])("rejects empty auth user id %j", async (authUserId) => {
    const fixture = fakeDatabase();

    await expect(withAuthUserContext(fixture.database, authUserId, async () => undefined)).rejects.toThrow("Database auth-user context is required.");
    expect(fixture.database.transaction).not.toHaveBeenCalled();
  });

  it("does not require an owner UUID", async () => {
    const fixture = fakeDatabase([[], [{ athena_user_id: ownerA }]]);

    await expect(withAuthUserContext(fixture.database, "not-a-uuid", async () => "ok")).resolves.toBe("ok");
    expect(fixture.database.transaction).toHaveBeenCalledOnce();
  });

  it("rejects an authenticated user with no workspace before setting the owner or running the callback", async () => {
    const fixture = fakeDatabase([[], []]);
    const callback = vi.fn(async () => "unreachable");

    await expect(withAuthUserContext(fixture.database, "auth-a", callback)).rejects.toThrow("Authenticated user has no workspace.");
    expect(fixture.database.transaction).toHaveBeenCalledOnce();
    const statements = fixture.transactions[0]!.execute.mock.calls.map(([statement]) => dialect.sqlToQuery(statement as SQL).sql);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("set_config('app.auth_user_id'");
    expect(statements[1]).toContain("auth_user_workspaces");
    expect(statements[1]).toContain("set_config('app.owner_id'");
    expect(callback).not.toHaveBeenCalled();
  });
});

describe("database observation", () => {
  it("reports a successful observation", async () => {
    const observations: DatabaseObservation[] = [];
    const result = await withDatabaseObservation("test-success", async () => "ok", {
      onObservation: (observation) => observations.push(observation),
    });

    expect(result).toBe("ok");
    expect(observations).toHaveLength(1);
    expect(observations[0]!.label).toBe("test-success");
    expect(observations[0]!.queryCount).toBe(0);
    expect(observations[0]!.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(observations[0]!.outcome).toBe("success");
  });

  it("reports an errored observation and rethrows", async () => {
    const observations: DatabaseObservation[] = [];
    const error = new Error("boom");

    await expect(
      withDatabaseObservation(
        "test-error",
        async () => {
          throw error;
        },
        {
          onObservation: (observation) => observations.push(observation),
        }
      )
    ).rejects.toThrow(error);

    expect(observations).toHaveLength(1);
    expect(observations[0]!.outcome).toBe("error");
  });

  it("does not invoke onObservation when disabled", async () => {
    const observations: DatabaseObservation[] = [];
    const result = await withDatabaseObservation("test-disabled", async () => "ok", {
      disabled: true,
      onObservation: (observation) => observations.push(observation),
    });

    expect(result).toBe("ok");
    expect(observations).toHaveLength(0);
  });

  it("does not observe when no onObservation callback is provided", async () => {
    const result = await withDatabaseObservation("test-no-callback", async () => "ok");

    expect(result).toBe("ok");
  });

  it("isolates nested observation scopes", async () => {
    const observations: DatabaseObservation[] = [];
    const result = await withDatabaseObservation(
      "outer",
      async () =>
        withDatabaseObservation(
          "inner",
          async () => "inner",
          { onObservation: (observation) => observations.push(observation) }
        ),
      { onObservation: (observation) => observations.push(observation) }
    );

    expect(result).toBe("inner");
    expect(observations).toHaveLength(2);
    expect(observations.map((o) => o.label)).toEqual(["inner", "outer"]);
  });

  it("isolates parallel observation scopes", async () => {
    const observations: DatabaseObservation[] = [];
    const [a, b] = await Promise.all([
      withDatabaseObservation("parallel-a", async () => "a", {
        onObservation: (observation) => observations.push(observation),
      }),
      withDatabaseObservation("parallel-b", async () => "b", {
        onObservation: (observation) => observations.push(observation),
      }),
    ]);

    expect(a).toBe("a");
    expect(b).toBe("b");
    expect(observations).toHaveLength(2);
    expect(observations.map((o) => o.label).sort()).toEqual(["parallel-a", "parallel-b"]);
  });
});
