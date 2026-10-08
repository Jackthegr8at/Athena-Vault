import { describe, expect, it } from "vitest";
import { createDatabase, eq, type Database } from "@athena/database";
import { authRateLimits } from "@athena/database";
import { consumeGlobalAuthRateLimit } from "./auth-rate-limit";

function resolveAuthDatabaseUrl(): string | undefined {
  const configured = (process.env.ATHENA_AUTH_DATABASE_URL ?? process.env.DATABASE_URL)?.trim();
  if (!configured) return undefined;
  const marker = "$ATHENA_AUTH_ROLE_PASSWORD";
  if (!configured.includes(marker)) return configured;
  const password = process.env.ATHENA_AUTH_ROLE_PASSWORD;
  return password ? configured.replaceAll(marker, encodeURIComponent(password)) : configured;
}

const connectionString = resolveAuthDatabaseUrl();
const database = connectionString ? createDatabase(connectionString) : undefined;

interface RecordedStatement {
  table: unknown;
  values: unknown;
  config: {
    readonly target: unknown;
    readonly setWhere: unknown;
    readonly set: Record<string, unknown>;
  };
  returningKeys: readonly string[];
}

function stubDatabase(rows: unknown[]): { database: Database; statements: RecordedStatement[]; tracker: { transactions: number } } {
  const statements: RecordedStatement[] = [];
  const tracker = { transactions: 0 };
  const chain = {
    values: (values: unknown) => {
      chain.record.values = values;
      return chain;
    },
    onConflictDoUpdate: (config: RecordedStatement["config"]) => {
      chain.record.config = config;
      return chain;
    },
    returning: (selection: Record<string, unknown>) => {
      chain.record.returningKeys = Object.keys(selection);
      return Promise.resolve(rows);
    },
    record: { table: undefined as unknown, values: undefined as unknown } as RecordedStatement,
  };
  const transaction: { insert: (table: unknown) => typeof chain } = {
    insert: (table: unknown) => {
      chain.record = { table, values: undefined, config: undefined as never, returningKeys: [] };
      statements.push(chain.record);
      return chain;
    },
  };
  const stub = {
    transaction: async (callback: (tx: typeof transaction) => Promise<boolean>) => {
      tracker.transactions += 1;
      return callback(transaction);
    },
  };
  return { database: stub as unknown as Database, statements, tracker };
}

describe("consumeGlobalAuthRateLimit (unit)", () => {
  it("issues one insert with an upsert-on-key inside a single transaction", async () => {
    const { database: stub, statements, tracker } = stubDatabase([{ key: "global:login" }]);

    await expect(consumeGlobalAuthRateLimit("global:login", { windowSeconds: 60, max: 120 }, stub)).resolves.toBe(true);

    expect(tracker.transactions).toBe(1);
    expect(statements).toHaveLength(1);
    const statement = statements[0]!;
    expect(statement.table).toBe(authRateLimits);
    expect(statement.values).toEqual({ key: "global:login", count: 1, lastRequest: expect.any(Number) });
    expect(statement.config.target).toBe(authRateLimits.key);
    expect(Object.keys(statement.config.set).sort()).toEqual(["count", "lastRequest"]);
    expect(statement.config.setWhere).toBeDefined();
    expect(statement.returningKeys).toEqual(["key"]);
  });

  it("denies the request when the upsert returns no row", async () => {
    const { database: stub } = stubDatabase([]);

    await expect(consumeGlobalAuthRateLimit("global:recovery", { windowSeconds: 300, max: 60 }, stub)).resolves.toBe(false);
  });
});

describe.skipIf(!database)("consumeGlobalAuthRateLimit (integration)", () => {
  function uniqueKey(): string {
    return `test:rate-limit:${crypto.randomUUID()}`;
  }

  async function storedRow(key: string) {
    if (!database) return undefined;
    const [row] = await database.select().from(authRateLimits).where(eq(authRateLimits.key, key));
    return row;
  }

  it("allows the first request in a window", async () => {
    if (!database) return;
    const key = uniqueKey();

    await expect(consumeGlobalAuthRateLimit(key, { windowSeconds: 60, max: 2 }, database)).resolves.toBe(true);

    const row = await storedRow(key);
    expect(row?.count).toBe(1);
    expect(row?.lastRequest).toBeGreaterThan(0);
  });

  it("denies at max and keeps the last allowed timestamp", async () => {
    if (!database) return;
    const key = uniqueKey();
    const rule = { windowSeconds: 600, max: 2 };

    await expect(consumeGlobalAuthRateLimit(key, rule, database)).resolves.toBe(true);
    await expect(consumeGlobalAuthRateLimit(key, rule, database)).resolves.toBe(true);
    const beforeDeny = await storedRow(key);
    await expect(consumeGlobalAuthRateLimit(key, rule, database)).resolves.toBe(false);

    const afterDeny = await storedRow(key);
    expect(afterDeny?.count).toBe(2);
    expect(afterDeny?.lastRequest).toBe(beforeDeny?.lastRequest);
  });

  it("resets the count after the window rolls over", async () => {
    if (!database) return;
    const key = uniqueKey();
    const staleTimestamp = Date.now() - 10 * 60 * 1000;
    await database.insert(authRateLimits).values({ key, count: 7, lastRequest: staleTimestamp });

    await expect(consumeGlobalAuthRateLimit(key, { windowSeconds: 60, max: 1 }, database)).resolves.toBe(true);

    const row = await storedRow(key);
    expect(row?.count).toBe(1);
    expect(row?.lastRequest).toBeGreaterThan(staleTimestamp);
  });

  it("shared cap holds under concurrent consumption", async () => {
    if (!database) return;
    const key = uniqueKey();
    const rule = { windowSeconds: 60, max: 5 };

    const results = await Promise.all(
      Array.from({ length: 8 }, () => consumeGlobalAuthRateLimit(key, rule, database)),
    );

    expect(results.filter(Boolean)).toHaveLength(5);
    expect((await storedRow(key))?.count).toBe(5);
  });
});
