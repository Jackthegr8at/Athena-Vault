import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authHandler: vi.fn(async () => new Response("authenticated")),
  consumeGlobalAuthRateLimit: vi.fn(async () => true),
}));

vi.mock("better-auth/next-js", () => ({
  toNextJsHandler: vi.fn(() => ({ GET: mocks.authHandler, POST: mocks.authHandler })),
}));
vi.mock("../../../../lib/server/auth", () => ({ auth: {} }));
vi.mock("../../../../lib/server/auth-rate-limit", () => ({ consumeGlobalAuthRateLimit: mocks.consumeGlobalAuthRateLimit }));

import { GET, POST } from "./route";

describe("authentication route abuse cap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consumeGlobalAuthRateLimit.mockResolvedValue(true);
  });

  it("applies a shared cap to login and leaves unrelated auth actions alone", async () => {
    const loginResponse = await POST(new Request("http://vault.example.test/api/auth/sign-in/email", { method: "POST" }));
    expect(loginResponse.status).toBe(200);
    expect(mocks.consumeGlobalAuthRateLimit).toHaveBeenCalledWith("global:login", expect.objectContaining({ windowSeconds: 60, max: 120 }));

    await POST(new Request("http://vault.example.test/api/auth/sign-out", { method: "POST" }));
    expect(mocks.consumeGlobalAuthRateLimit).toHaveBeenCalledOnce();
  });

  it("returns a generic 429 when the shared cap is exhausted", async () => {
    mocks.consumeGlobalAuthRateLimit.mockResolvedValueOnce(false);

    const response = await POST(new Request("http://vault.example.test/api/auth/forget-password", { method: "POST" }));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("300");
    await expect(response.json()).resolves.toEqual({ error: "Too many requests. Please try again later." });
    expect(mocks.authHandler).not.toHaveBeenCalled();
  });

  it("returns a generic unavailable response when the rate limiter fails", async () => {
    mocks.consumeGlobalAuthRateLimit.mockRejectedValueOnce(new Error("rate limiter backend failure"));

    const response = await POST(new Request("http://vault.example.test/api/auth/sign-in/email", { method: "POST" }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Authentication is currently unavailable." });
    expect(mocks.authHandler).not.toHaveBeenCalled();
  });

  it("keeps invalid credentials generic at the web auth boundary", async () => {
    mocks.authHandler.mockResolvedValueOnce(Response.json({ error: "Invalid email or password." }, { status: 401 }));

    const response = await POST(new Request("http://vault.example.test/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email: "missing@example.test", password: "wrong-password" }),
    }));
    const body = await response.text();

    expect(response.status).toBe(401);
    expect(body).toBe(JSON.stringify({ error: "Invalid email or password." }));
    expect(body).not.toContain("missing@example.test");
    expect(body).not.toContain("wrong-password");
  });

  it("keeps recovery responses generic and rate-limited", async () => {
    mocks.authHandler.mockResolvedValueOnce(Response.json({ message: "If the account exists, recovery instructions will be sent." }, { status: 200 }));

    const response = await POST(new Request("http://vault.example.test/api/auth/forget-password", {
      method: "POST",
      body: JSON.stringify({ email: "unknown@example.test" }),
    }));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toBe(JSON.stringify({ message: "If the account exists, recovery instructions will be sent." }));
    expect(body).not.toContain("unknown@example.test");
    expect(mocks.consumeGlobalAuthRateLimit).toHaveBeenCalledWith("global:recovery", expect.objectContaining({ windowSeconds: 300, max: 60 }));
  });

  it("wraps Better Auth GET failures in a neutral response", async () => {
    mocks.authHandler.mockRejectedValueOnce(new Error("internal auth details"));

    const response = await GET(new Request("http://vault.example.test/api/auth/get-session", { method: "GET" }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });
});
