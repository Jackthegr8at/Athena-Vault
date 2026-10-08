import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_CSRF_COOKIE_NAME } from "../../../../lib/server/demo-csrf";

const mocks = vi.hoisted(() => ({
  authHandler: vi.fn(),
  consumeGlobalAuthRateLimit: vi.fn(),
  getDemoAccessCredentials: vi.fn(),
}));

vi.mock("../../../../lib/server/auth", () => ({ auth: { handler: mocks.authHandler } }));
vi.mock("../../../../lib/server/auth-rate-limit", () => ({ consumeGlobalAuthRateLimit: mocks.consumeGlobalAuthRateLimit }));
vi.mock("../../../../lib/server/demo-access", () => ({ getDemoAccessCredentials: mocks.getDemoAccessCredentials }));

import { POST } from "./route";

const csrfToken = "a".repeat(64);

function demoRequest(url: string, options: { readonly headers?: HeadersInit; readonly next?: string } = {}): Request {
  const headers = new Headers(options.headers);
  headers.set("cookie", `${DEMO_CSRF_COOKIE_NAME}=${csrfToken}`);
  return new Request(url, {
    method: "POST",
    headers,
    body: new URLSearchParams({ demoCsrfToken: csrfToken, ...(options.next === undefined ? {} : { next: options.next }) }),
  });
}

describe("demo sign-in route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDemoAccessCredentials.mockReturnValue({ identifier: "demo@example.test", password: "configured-demo-password" });
    mocks.consumeGlobalAuthRateLimit.mockResolvedValue(true);
    mocks.authHandler.mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "set-cookie": "athena-session=demo; Path=/; HttpOnly" },
    }));
  });

  it("keeps the configured password server-side and forwards a safe internal sign-in", async () => {
    const response = await POST(demoRequest("https://vault.example.test/api/demo/sign-in", {
      headers: { origin: "https://vault.example.test" },
      next: "/overview",
    }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/overview");
    expect(response.headers.get("set-cookie")).toContain("athena-session=demo");

    const request = mocks.authHandler.mock.calls[0]?.[0] as Request;
    expect(new URL(request.url).pathname).toBe("/api/auth/sign-in/email");
    await expect(request.json()).resolves.toEqual({
      email: "demo@example.test",
      password: "configured-demo-password",
      callbackURL: "/overview",
    });
  });

  it("falls back to home for an external next path", async () => {
    const response = await POST(demoRequest("https://vault.example.test/api/demo/sign-in", { next: "https://attacker.example.test" }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    const request = mocks.authHandler.mock.calls[0]?.[0] as Request;
    await expect(request.json()).resolves.toMatchObject({ callbackURL: "/" });
  });

  it("uses the browser-facing forwarded origin for an originless request", async () => {
    const response = await POST(demoRequest("https://0.0.0.0:3000/api/demo/sign-in", {
      headers: {
        "sec-fetch-site": "same-origin",
        "x-forwarded-host": "vault.example.test",
        "x-forwarded-proto": "https",
      },
      next: "/",
    }));

    expect(response.status).toBe(303);
    const request = mocks.authHandler.mock.calls[0]?.[0] as Request;
    expect(request.headers.get("origin")).toBe("https://vault.example.test");
  });

  it("replaces a null browser origin before the internal sign-in", async () => {
    const response = await POST(demoRequest("https://0.0.0.0:3000/api/demo/sign-in", {
      headers: {
        origin: "null",
        "x-forwarded-host": "vault.example.test",
        "x-forwarded-proto": "https",
      },
    }));

    expect(response.status).toBe(303);
    const request = mocks.authHandler.mock.calls[0]?.[0] as Request;
    expect(request.headers.get("origin")).toBe("https://vault.example.test");
  });

  it("rejects a demo submission without the server-issued CSRF token", async () => {
    const response = await POST(new Request("https://vault.example.test/api/demo/sign-in", {
      method: "POST",
      headers: { origin: "https://vault.example.test", cookie: `${DEMO_CSRF_COOKIE_NAME}=${csrfToken}` },
      body: new URLSearchParams({ next: "/" }),
    }));

    expect(response.status).toBe(403);
    expect(mocks.authHandler).not.toHaveBeenCalled();
  });

  it("does not invoke auth when demo access is disabled", async () => {
    mocks.getDemoAccessCredentials.mockReturnValue(null);

    const response = await POST(new Request("https://vault.example.test/api/demo/sign-in", { method: "POST" }));

    expect(response.status).toBe(404);
    expect(mocks.consumeGlobalAuthRateLimit).not.toHaveBeenCalled();
    expect(mocks.authHandler).not.toHaveBeenCalled();
  });

  it("enforces the shared login cap", async () => {
    mocks.consumeGlobalAuthRateLimit.mockResolvedValue(false);

    const response = await POST(demoRequest("https://vault.example.test/api/demo/sign-in"));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeTruthy();
    expect(mocks.authHandler).not.toHaveBeenCalled();
  });

  it("returns a generic unavailable response when the rate limiter fails", async () => {
    mocks.consumeGlobalAuthRateLimit.mockRejectedValueOnce(new Error("rate limiter backend failure"));

    const response = await POST(demoRequest("https://vault.example.test/api/demo/sign-in"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Demo sign-in is currently unavailable." });
    expect(mocks.authHandler).not.toHaveBeenCalled();
  });

  it("returns a generic response when the internal sign-in fails", async () => {
    mocks.authHandler.mockRejectedValue(new Error("database failure"));

    const response = await POST(demoRequest("https://vault.example.test/api/demo/sign-in"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Demo sign-in is currently unavailable." });
  });
});
