import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  assertPasswordNotCompromised,
  isPasswordBreachCheckEnabled,
  PasswordBreachCheckUnavailableError,
  PasswordCompromisedError,
} from "./password-breach";
import { PASSWORD_BREACH_CHECK_UNAVAILABLE_ERROR, PASSWORD_COMPROMISED_ERROR } from "../password-policy";

const testEnvironment = { NODE_ENV: "test", ATHENA_PASSWORD_BREACH_CHECK: "enforce" } as const;

function hashParts(password: string): { readonly fullHash: string; readonly prefix: string; readonly suffix: string } {
  const fullHash = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  return { fullHash, prefix: fullHash.slice(0, 5), suffix: fullHash.slice(5) };
}

function mockFetch(body: string, status = 200) {
  return vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(body, { status }));
}

describe("password breach screening", () => {
  it("sends only the five-character hash prefix with padded, non-cached request options", async () => {
    const password = "synthetic-hibp-check-1A";
    const { fullHash, prefix, suffix } = hashParts(password);
    const fetchMock = mockFetch(`${"A".repeat(35)}:0\r\n`);

    await expect(assertPasswordNotCompromised(password, fetchMock, testEnvironment)).resolves.toBeUndefined();

    const [input, options] = fetchMock.mock.calls[0] ?? [];
    expect(input).toBe(`https://api.pwnedpasswords.com/range/${prefix}`);
    expect(String(input)).not.toContain(password);
    expect(String(input)).not.toContain(fullHash);
    expect(String(input)).not.toContain(suffix);
    expect(options).toEqual(expect.objectContaining({
      cache: "no-store",
      headers: { "Add-Padding": "true", "User-Agent": "Athena Vault Password Checker" },
    }));
  });

  it("rejects a password when the returned suffix matches", async () => {
    const { suffix } = hashParts("synthetic-compromised-2B");
    const fetchMock = mockFetch(`${suffix}:12\n${"A".repeat(35)}:0\n`);

    await expect(assertPasswordNotCompromised("synthetic-compromised-2B", fetchMock, testEnvironment))
      .rejects.toBeInstanceOf(PasswordCompromisedError);
    await expect(assertPasswordNotCompromised("synthetic-compromised-2B", fetchMock, testEnvironment))
      .rejects.toThrow(PASSWORD_COMPROMISED_ERROR);
  });

  it("allows a non-matching suffix", async () => {
    const fetchMock = mockFetch(`${"B".repeat(35)}:1\n`);

    await expect(assertPasswordNotCompromised("synthetic-safe-3C", fetchMock, testEnvironment)).resolves.toBeUndefined();
  });

  it.each([
    ["an HTTP failure", mockFetch("", 503)],
    ["a malformed response", mockFetch("not-a-hash-count")],
  ])("fails closed for %s", async (_label, fetchMock) => {
    await expect(assertPasswordNotCompromised("synthetic-unavailable-4D", fetchMock, testEnvironment))
      .rejects.toBeInstanceOf(PasswordBreachCheckUnavailableError);
    await expect(assertPasswordNotCompromised("synthetic-unavailable-4D", fetchMock, testEnvironment))
      .rejects.toThrow(PASSWORD_BREACH_CHECK_UNAVAILABLE_ERROR);
  });

  it("supports an explicit local-only bypass", async () => {
    const fetchMock = mockFetch("");

    await expect(assertPasswordNotCompromised("synthetic-local-5E", fetchMock, { NODE_ENV: "development", ATHENA_PASSWORD_BREACH_CHECK: "off" }))
      .resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(isPasswordBreachCheckEnabled({ NODE_ENV: "development", ATHENA_PASSWORD_BREACH_CHECK: "off" })).toBe(false);
  });

  it("rejects the bypass in production and rejects unknown settings", () => {
    expect(() => isPasswordBreachCheckEnabled({ NODE_ENV: "production", ATHENA_PASSWORD_BREACH_CHECK: "off" }))
      .toThrow("ATHENA_PASSWORD_BREACH_CHECK=off is allowed only in development or test.");
    expect(() => isPasswordBreachCheckEnabled({ ATHENA_PASSWORD_BREACH_CHECK: "off" }))
      .toThrow("ATHENA_PASSWORD_BREACH_CHECK=off is allowed only in development or test.");
    expect(() => isPasswordBreachCheckEnabled({ NODE_ENV: "development", ATHENA_PASSWORD_BREACH_CHECK: "unexpected" }))
      .toThrow("ATHENA_PASSWORD_BREACH_CHECK must be unset, enforce, or off.");
  });
});
