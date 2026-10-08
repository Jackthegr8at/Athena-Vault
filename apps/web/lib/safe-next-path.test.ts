import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next-path";

describe("safeNextPath", () => {
  it.each([
    ["backslash path", "/\\evil.example"],
    ["protocol-relative URL", "//evil.example"],
    ["encoded slashes", "/%2F%2Fevil"],
    ["encoded backslash", "/%5cevil"],
    ["control character", "/\u0009x"],
    ["absolute URL", "https://evil.example"],
    ["over-length path", `/${"a".repeat(2048)}`],
  ])("rejects %s", (_label, value) => {
    expect(safeNextPath(value)).toBe("/");
  });

  it.each([
    ["query string", "/cash-flow?period=a"],
    ["fragment", "/goals#x"],
  ])("accepts a safe local path with %s", (_label, value) => {
    expect(safeNextPath(value)).toBe(value);
  });
});
