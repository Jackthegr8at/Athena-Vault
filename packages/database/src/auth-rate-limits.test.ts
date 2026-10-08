import { describe, expect, it } from "vitest";
import { authRateLimits } from "./drizzle-schema";

describe("Better Auth rate-limit Drizzle schema", () => {
  it("exposes the generated id and pinned rate-limit fields", () => {
    expect({
      id: authRateLimits.id.name,
      key: authRateLimits.key.name,
      count: authRateLimits.count.name,
      lastRequest: authRateLimits.lastRequest.name,
    }).toEqual({
      id: "id",
      key: "key",
      count: "count",
      lastRequest: "last_request",
    });
  });
});
