import { describe, expect, it } from "vitest";
import { money } from "../src/index";

describe("money constructor", () => {
  it("accepts Number.MAX_SAFE_INTEGER unchanged", () => {
    expect(money(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("rejects a fractional amount with a RangeError", () => {
    expect(() => money(100.5)).toThrowError(new RangeError("Money must be a safe integer minor-unit amount."));
  });

  it("rejects an unsafe integer with a RangeError", () => {
    expect(() => money(Number.MAX_SAFE_INTEGER + 1)).toThrowError(new RangeError("Money must be a safe integer minor-unit amount."));
  });
});
