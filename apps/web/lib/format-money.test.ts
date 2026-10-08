import { describe, expect, it } from "vitest";
import { formatCompactMoneyMinor, formatMoneyInputMinor, formatMoneyMinor, formatSignedMoneyMinor } from "./format-money";

describe("format money", () => {
  it("formats safe integer minor units without floating-point conversion", () => {
    expect(formatMoneyMinor(12345678)).toBe("$123,456.78");
    expect(formatMoneyMinor(-125)).toBe("-$1.25");
    expect(formatMoneyMinor(0)).toBe("$0.00");
    expect(formatMoneyMinor(Number.MAX_SAFE_INTEGER)).toBe("$90,071,992,547,409.91");
    expect(formatMoneyMinor(-Number.MAX_SAFE_INTEGER)).toBe("-$90,071,992,547,409.91");
  });

  it("formats exact bigint minor units beyond the number safe-integer range", () => {
    expect(formatMoneyMinor(18014398509481982n)).toBe("$180,143,985,094,819.82");
    expect(formatMoneyMinor(-18014398509481982n)).toBe("-$180,143,985,094,819.82");
    expect(formatMoneyMinor(36028797018963964n)).toBe("$360,287,970,189,639.64");
    expect(formatMoneyMinor(-36028797018963964n)).toBe("-$360,287,970,189,639.64");
    expect(formatMoneyMinor(0n)).toBe("$0.00");
    expect(formatMoneyMinor(18014398509481982n, { currency: "USD", positiveSign: "+" })).toBe("+US$180,143,985,094,819.82");
    expect(formatMoneyMinor(-36028797018963964n, { currency: "EUR", negativeSign: "−" })).toBe("−€360,287,970,189,639.64");
    expect(formatMoneyMinor(0n, { zeroSign: "±" })).toBe("±$0.00");
    expect(formatSignedMoneyMinor(18014398509481982n)).toBe("+$180,143,985,094,819.82");
  });

  it("uses the configured currency prefixes", () => {
    expect(formatMoneyMinor(12345, { currency: "CAD" })).toBe("$123.45");
    expect(formatMoneyMinor(12345, { currency: "USD" })).toBe("US$123.45");
    expect(formatMoneyMinor(12345, { currency: "EUR" })).toBe("€123.45");
  });

  it("returns the configured unavailable label for nullable and unsafe values", () => {
    expect(formatMoneyMinor(null)).toBe("Unavailable");
    expect(formatMoneyMinor(undefined, { unavailableLabel: "—" })).toBe("—");
    expect(formatMoneyMinor(Number.MAX_SAFE_INTEGER + 1, { unavailableLabel: "—" })).toBe("—");
    expect(formatMoneyMinor(10.5, { unavailableLabel: "Amount unavailable" })).toBe("Amount unavailable");
  });

  it("supports exact signed-display contracts", () => {
    expect(formatSignedMoneyMinor(125)).toBe("+$1.25");
    expect(formatSignedMoneyMinor(-125)).toBe("-$1.25");
    expect(formatSignedMoneyMinor(0, { zeroSign: "±" })).toBe("±$0.00");
    expect(formatSignedMoneyMinor(125, { negativeSign: "−" })).toBe("+$1.25");
    expect(formatSignedMoneyMinor(-125, { negativeSign: "−" })).toBe("−$1.25");
    expect(formatSignedMoneyMinor(null, { unavailableLabel: "—" })).toBe("—");
  });

  it.each([
    [0, "0.00"],
    [1, "0.01"],
    [-1, "-0.01"],
    [125, "1.25"],
    [-125, "-1.25"],
    [12345678, "123456.78"],
    [Number.MAX_SAFE_INTEGER, "90071992547409.91"],
    [Number.MIN_SAFE_INTEGER, "-90071992547409.91"],
    [-Number.MAX_SAFE_INTEGER, "-90071992547409.91"],
    [Number.MAX_SAFE_INTEGER - 1, "90071992547409.90"],
    [-(Number.MAX_SAFE_INTEGER - 1), "-90071992547409.90"],
  ])("formats %s minor units as the exact plain input %s", (minor, expected) => {
    expect(formatMoneyInputMinor(minor)).toBe(expected);
  });

  it("keeps high-value input strings ungrouped and cent-accurate", () => {
    const input = formatMoneyInputMinor(9007199254740990);

    expect(input).toBe("90071992547409.90");
    expect(input).not.toContain(",");
    expect(input).not.toContain("$");
    expect(input).not.toContain("NaN");
  });

  it.each([
    Number.MAX_SAFE_INTEGER + 1,
    -Number.MAX_SAFE_INTEGER - 1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    1.5,
  ])("rejects unsafe or non-integer minor units: %s", (minor) => {
    expect(() => formatMoneyInputMinor(minor)).toThrow(RangeError);
  });
});

describe("format compact money minor", () => {
  it("renders compact suffixes with at most one meaningful decimal", () => {
    expect(formatCompactMoneyMinor(4_000_000, "CAD")).toBe("$40K");
    expect(formatCompactMoneyMinor(1_234_500, "CAD")).toBe("$12.3K");
    expect(formatCompactMoneyMinor(123_456_789, "CAD")).toBe("$1.2M");
    expect(formatCompactMoneyMinor(2_500_000_000_000, "CAD")).toBe("$25B");
    expect(formatCompactMoneyMinor(123_456_789_000_000, "CAD")).toBe("$1.2T");
  });

  it("renders values below $1,000 without a compact suffix", () => {
    expect(formatCompactMoneyMinor(0, "CAD")).toBe("$0");
    expect(formatCompactMoneyMinor(50, "CAD")).toBe("$0.5");
    expect(formatCompactMoneyMinor(99_900, "CAD")).toBe("$999");
  });

  it("uses the configured currency prefixes", () => {
    expect(formatCompactMoneyMinor(4_000_000, "USD")).toBe("US$40K");
    expect(formatCompactMoneyMinor(4_000_000, "EUR")).toBe("€40K");
    expect(formatCompactMoneyMinor(1_234_500, "USD")).toBe("US$12.3K");
  });

  it("keeps the leading minus on negative labels", () => {
    expect(formatCompactMoneyMinor(-4_000_000, "CAD")).toBe("-$40K");
    expect(formatCompactMoneyMinor(-1_234_500, "CAD")).toBe("-$12.3K");
    expect(formatCompactMoneyMinor(-99_995_000, "CAD")).toBe("-$1M");
  });

  it("promotes to the next suffix when rounding reaches 1,000.0 of a unit", () => {
    expect(formatCompactMoneyMinor(99_995_000, "CAD")).toBe("$1M");
    expect(formatCompactMoneyMinor(99_994_999, "CAD")).toBe("$999.9K");
    expect(formatCompactMoneyMinor(99_995, "CAD")).toBe("$1K");
    expect(formatCompactMoneyMinor(99_994, "CAD")).toBe("$999.9");
  });

  it("rounds fractional minor units to the nearest minor unit, ties away from zero", () => {
    expect(formatCompactMoneyMinor(4_000_000.5, "CAD")).toBe("$40K");
    expect(formatCompactMoneyMinor(1_234_549.6, "CAD")).toBe("$12.3K");
    expect(formatCompactMoneyMinor(1_234_999.6, "CAD")).toBe("$12.4K");
    expect(formatCompactMoneyMinor(94.5, "CAD")).toBe("$1");
    expect(formatCompactMoneyMinor(-94.5, "CAD")).toBe("-$1");
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    -Number.MAX_SAFE_INTEGER - 1,
  ])("returns Unavailable for non-finite or unsafe minor units: %s", (minor) => {
    expect(formatCompactMoneyMinor(minor, "CAD")).toBe("Unavailable");
  });
});
