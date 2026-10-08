import { describe, expect, it } from "vitest";
import {
  createDatabase,
  DATABASE_HEALTH_QUERY,
  withDatabaseObservation,
  type DatabaseObservation,
} from "./client";

const connectionString = process.env.DATABASE_URL;
const database = connectionString ? createDatabase(connectionString) : undefined;

describe("withDatabaseObservation (unit)", () => {
  it("reports success with label, bounded nonnegative elapsedMs, and zero query count", async () => {
    const observations: DatabaseObservation[] = [];
    const result = await withDatabaseObservation("test-success", async () => "ok", {
      onObservation: (observation) => observations.push(observation),
    });

    expect(result).toBe("ok");
    expect(observations).toHaveLength(1);
    expect(observations[0]!.label).toBe("test-success");
    expect(observations[0]!.queryCount).toBe(0);
    expect(observations[0]!.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(observations[0]!.elapsedMs).toBeLessThan(1_000);
    expect(Number.isFinite(observations[0]!.elapsedMs)).toBe(true);
    expect(observations[0]!.outcome).toBe("success");
  });

  it("reports an errored observation, rethrows, and still delivers the sink", async () => {
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
        },
      ),
    ).rejects.toThrow(error);

    expect(observations).toHaveLength(1);
    expect(observations[0]!.outcome).toBe("error");
    expect(observations[0]!.queryCount).toBe(0);
  });

  it("does not call the sink when disabled", async () => {
    const observations: DatabaseObservation[] = [];
    const result = await withDatabaseObservation("test-disabled", async () => "ok", {
      disabled: true,
      onObservation: (observation) => observations.push(observation),
    });

    expect(result).toBe("ok");
    expect(observations).toHaveLength(0);
  });

  it("does not call the sink when no sink is provided", async () => {
    const result = await withDatabaseObservation("test-no-sink", async () => "ok");
    expect(result).toBe("ok");
  });
});

describe.skipIf(!database)("withDatabaseObservation (integration)", () => {
  it("counts real database queries and preserves label and outcome", async () => {
    if (!database) return;
    const observations: DatabaseObservation[] = [];
    const result = await withDatabaseObservation(
      "db-query",
      async () => {
        await database.execute(DATABASE_HEALTH_QUERY);
        return "ok";
      },
      {
        onObservation: (observation) => observations.push(observation),
      },
    );

    expect(result).toBe("ok");
    expect(observations).toHaveLength(1);
    expect(observations[0]!.label).toBe("db-query");
    expect(observations[0]!.queryCount).toBeGreaterThanOrEqual(1);
    expect(observations[0]!.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(observations[0]!.elapsedMs).toBeLessThan(1_000);
    expect(observations[0]!.outcome).toBe("success");
  });
});
