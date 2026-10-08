import { describe, expect, it } from "vitest";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { authRateLimits } from "@athena/database";

describe("Better Auth rate-limit Drizzle contract", () => {
  it("accepts Better Auth generated ids with the configured table", async () => {
    let insertedValues: Record<string, unknown> | undefined;
    const database = {
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          insertedValues = values;
          return { returning: async () => [values] };
        },
      }),
    };
    const adapter = drizzleAdapter(database as never, {
      provider: "pg",
      schema: { auth_rate_limits: authRateLimits },
    })({
      rateLimit: {
        enabled: true,
        storage: "database",
        modelName: "auth_rate_limits",
      },
    } as never);

    await expect(adapter.create({
      model: "rateLimit",
      data: { key: "global:login", count: 1, lastRequest: Date.now() },
    })).resolves.toMatchObject({ key: "global:login", count: 1 });
    expect(insertedValues?.id).toEqual(expect.any(String));
  });
});
