import { describe, expect, it } from "vitest";
import { calculateMortgagePayment, projectMortgageTimeline } from "../src/mortgage";

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe("integer mortgage calculations", () => {
  it("applies a biweekly payment using integer minor units at zero interest", () => {
    expect(calculateMortgagePayment({
      principalMinor: 100_000,
      paymentMinor: 3_000,
      annualRateBps: 0,
      compoundingConvention: "canadian_semi_annual",
    })).toEqual({ interestMinor: 0, principalPortionMinor: 3_000, endingPrincipalMinor: 97_000 });
  });

  it("rounds interest deterministically and never returns a fractional minor unit", () => {
    const first = calculateMortgagePayment({
      principalMinor: 100_000,
      paymentMinor: 3_000,
      annualRateBps: 549,
      compoundingConvention: "canadian_semi_annual",
    });
    const second = calculateMortgagePayment({
      principalMinor: 100_000,
      paymentMinor: 3_000,
      annualRateBps: 549,
      compoundingConvention: "canadian_semi_annual",
    });
    expect(first).toEqual(second);
    expect(Number.isSafeInteger(first.interestMinor)).toBe(true);
    expect(first.principalPortionMinor).toBe(3_000 - first.interestMinor);
    expect(first.endingPrincipalMinor).toBe(100_000 - first.principalPortionMinor);
  });

  it("matches the date-aware fixed-point Canadian semi-annual payment result", () => {
    expect(calculateMortgagePayment({
      principalMinor: 10_000_000,
      paymentMinor: 250_000,
      annualRateBps: 600,
      compoundingConvention: "canadian_semi_annual",
    })).toEqual({ interestMinor: 22_701, principalPortionMinor: 227_299, endingPrincipalMinor: 9_772_701 });
  });

  it("caps payoff principal at the outstanding balance for overpayments", () => {
    const payment = calculateMortgagePayment({
      principalMinor: 10_000,
      paymentMinor: 15_000,
      annualRateBps: 0,
      compoundingConvention: "canadian_semi_annual",
    });
    expect(payment).toEqual({ interestMinor: 0, principalPortionMinor: 10_000, endingPrincipalMinor: 0 });

    const points = projectMortgageTimeline(
      ["2026-08-05", "2026-08-19", "2026-09-02"],
      [{ asOf: "2026-08-05", principalMinor: 10_000 }],
      [{
        effectiveOn: "2026-08-05",
        annualRateBps: 0,
        compoundingConvention: "canadian_semi_annual",
        paymentMinor: 15_000,
        nextPaymentOn: "2026-08-19",
        renewalOn: "2027-08-05",
        payoffOn: "2026-09-02",
      }],
    );

    expect(points[1]).toMatchObject({ principalMinor: 0, interestMinor: 0, principalPortionMinor: 10_000, endingPrincipalMinor: 0 });
    expect(points[2]).toMatchObject({ principalMinor: 0, interestMinor: 0, principalPortionMinor: 0, endingPrincipalMinor: 0 });
    for (let index = 1; index < points.length; index++) {
      expect(points[index - 1]!.principalMinor - points[index]!.principalPortionMinor).toBe(points[index]!.endingPrincipalMinor);
    }
  });

  it("chains from the previous balance, preserves actual anchors, and labels renewal estimates", () => {
    const points = projectMortgageTimeline(
      ["2026-08-05", "2026-08-19", "2026-09-02", "2026-09-16", "2026-09-30"],
      [{ asOf: "2026-08-05", principalMinor: 100_000 }],
      [{
        effectiveOn: "2026-08-05",
        annualRateBps: 0,
        compoundingConvention: "canadian_semi_annual",
        paymentMinor: 3_000,
        nextPaymentOn: "2026-08-19",
        renewalOn: "2026-09-16",
        payoffOn: "2051-08-05",
      }],
    );

    expect(points).toMatchObject([
      { asOf: "2026-08-05", principalMinor: 100_000, status: "actual", paymentMinor: 0 },
      { asOf: "2026-08-19", principalMinor: 97_000, status: "projected", paymentMinor: 3_000 },
      { asOf: "2026-09-02", principalMinor: 94_000, status: "projected" },
      { asOf: "2026-09-16", principalMinor: 91_000, status: "projected" },
      { asOf: "2026-09-30", principalMinor: 88_000, status: "estimated" },
    ]);

    const anchorReset = projectMortgageTimeline(
      ["2026-08-05", "2026-08-19", "2026-09-02", "2026-09-16"],
      [{ asOf: "2026-08-05", principalMinor: 100_000 }, { asOf: "2026-09-02", principalMinor: 80_000 }],
      [{
        effectiveOn: "2026-08-05",
        annualRateBps: 0,
        compoundingConvention: "annual",
        paymentMinor: 3_000,
        nextPaymentOn: "2026-08-19",
        renewalOn: "2029-08-05",
        payoffOn: "2051-08-05",
      }],
    );
    expect(anchorReset.find((point) => point.asOf === "2026-09-16")?.principalMinor).toBe(77_000);
  });

  it("uses a changed term only from its effective date forward", () => {
    const points = projectMortgageTimeline(
      ["2026-08-05", "2026-08-19", "2026-09-02", "2026-09-16"],
      [{ asOf: "2026-08-05", principalMinor: 100_000 }],
      [
        {
          effectiveOn: "2026-08-05",
          annualRateBps: 0,
          compoundingConvention: "annual",
          paymentMinor: 3_000,
          nextPaymentOn: "2026-08-19",
          renewalOn: "2029-08-05",
          payoffOn: "2051-08-05",
        },
        {
          effectiveOn: "2026-09-02",
          annualRateBps: 0,
          compoundingConvention: "annual",
          paymentMinor: 5_000,
          nextPaymentOn: "2026-09-02",
          renewalOn: "2029-08-05",
          payoffOn: "2051-08-05",
        },
      ],
    );
    expect(points.map((point) => point.principalMinor)).toEqual([100_000, 97_000, 92_000, 87_000]);
  });

  it("uses calendar-day accrual for an irregular first payment interval", () => {
    const points = projectMortgageTimeline(
      ["2026-07-28", "2026-08-16", "2026-08-30"],
      [{ asOf: "2026-07-28", principalMinor: 100_000 }],
      [{
        effectiveOn: "2026-07-28",
        annualRateBps: 394,
        compoundingConvention: "canadian_semi_annual",
        paymentMinor: 3_000,
        nextPaymentOn: "2026-08-16",
        renewalOn: "2027-07-28",
        payoffOn: "2027-07-28",
      }],
    );
    const irregular = calculateMortgagePayment({
      principalMinor: 100_000,
      paymentMinor: 3_000,
      annualRateBps: 394,
      compoundingConvention: "canadian_semi_annual",
      daysElapsed: 19,
    });
    const regular = calculateMortgagePayment({
      principalMinor: 100_000,
      paymentMinor: 3_000,
      annualRateBps: 394,
      compoundingConvention: "canadian_semi_annual",
      daysElapsed: 14,
    });

    expect(points.find((point) => point.asOf === "2026-08-16")).toMatchObject(irregular);
    expect(irregular.interestMinor).toBeGreaterThan(regular.interestMinor);
    expect(points.find((point) => point.asOf === "2026-08-30")?.interestMinor).toBeGreaterThan(0);
  });

  it("supports date-aware accrual for every stored nominal convention", () => {
    for (const compoundingConvention of ["canadian_semi_annual", "annual", "monthly"] as const) {
      const regular = calculateMortgagePayment({
        principalMinor: 10_000_000,
        paymentMinor: 250_000,
        annualRateBps: 394,
        compoundingConvention,
        daysElapsed: 14,
      });
      const longerInterval = calculateMortgagePayment({
        principalMinor: 10_000_000,
        paymentMinor: 250_000,
        annualRateBps: 394,
        compoundingConvention,
        daysElapsed: 15,
      });

      expect(regular.interestMinor).toBeGreaterThan(0);
      expect(longerInterval.interestMinor).toBeGreaterThan(regular.interestMinor);
    }
  });

  it("lands within one cent of the CIBC semi-annual fixed mortgage maturity balance while reconciling every row", () => {
    const dates = Array.from({ length: 61 }, (_, index) => addDays("2026-07-28", index * 14));
    const points = projectMortgageTimeline(
      dates,
      [{ asOf: "2026-07-28", principalMinor: 22_661_969 }],
      [{
        effectiveOn: "2026-07-28",
        annualRateBps: 394,
        compoundingConvention: "canadian_semi_annual",
        paymentMinor: 64_252,
        nextPaymentOn: "2026-08-11",
        renewalOn: "2028-11-14",
        payoffOn: "2028-11-14",
      }],
    );
    const maturity = points[points.length - 1];

    expect(dates[60]).toBe("2028-11-14");
    expect(maturity).toMatchObject({
      asOf: "2028-11-14",
      principalMinor: 20_760_516,
      endingPrincipalMinor: 20_760_516,
      paymentMinor: 64_252,
      status: "projected",
    });
    expect(points.slice(1).every((point) => point.interestMinor + point.principalPortionMinor === point.paymentMinor)).toBe(true);
    expect(maturity!.interestMinor + maturity!.principalPortionMinor).toBe(64_252);
  });

  it("reconciles principal, principal portion, and ending principal across a 26-payment schedule", () => {
    const dates = Array.from({ length: 27 }, (_, index) => addDays("2026-07-28", index * 14));
    const points = projectMortgageTimeline(
      dates,
      [{ asOf: "2026-07-28", principalMinor: 22_661_969 }],
      [{
        effectiveOn: "2026-07-28",
        annualRateBps: 394,
        compoundingConvention: "canadian_semi_annual",
        paymentMinor: 64_252,
        nextPaymentOn: "2026-08-11",
        renewalOn: "2028-11-14",
        payoffOn: "2028-11-14",
      }],
    );

    expect(points).toHaveLength(27);
    for (let index = 1; index < points.length; index++) {
      const point = points[index]!;
      expect(point.paymentMinor).toBe(64_252);
      expect(point.interestMinor + point.principalPortionMinor).toBe(point.paymentMinor);
      expect(point.principalMinor).toBe(point.endingPrincipalMinor);
      expect(points[index - 1]!.principalMinor - point.principalPortionMinor).toBe(point.endingPrincipalMinor);
    }
    expect(points[26]!.principalMinor).toBeLessThan(22_661_969);

    // The standalone payment calculation reconciles the same way when chained.
    let principalMinor = 22_661_969;
    for (let index = 0; index < 26; index++) {
      const payment = calculateMortgagePayment({
        principalMinor,
        paymentMinor: 64_252,
        annualRateBps: 394,
        compoundingConvention: "canadian_semi_annual",
        daysElapsed: 14,
      });
      expect(principalMinor - payment.principalPortionMinor).toBe(payment.endingPrincipalMinor);
      principalMinor = payment.endingPrincipalMinor;
    }
    expect(principalMinor).toBe(points[26]!.principalMinor);
  });

  it("carries a non-payment date without accruing or applying a payment", () => {
    const points = projectMortgageTimeline(
      ["2026-07-28", "2026-08-06", "2026-08-11"],
      [{ asOf: "2026-07-28", principalMinor: 22_661_969 }],
      [{
        effectiveOn: "2026-07-28",
        annualRateBps: 394,
        compoundingConvention: "canadian_semi_annual",
        paymentMinor: 64_252,
        nextPaymentOn: "2026-08-11",
        renewalOn: "2028-11-14",
        payoffOn: "2028-11-14",
      }],
    );
    expect(points.find((point) => point.asOf === "2026-08-06")).toEqual({
      asOf: "2026-08-06",
      principalMinor: 22_661_969,
      paymentMinor: 0,
      interestMinor: 0,
      principalPortionMinor: 0,
      endingPrincipalMinor: 22_661_969,
      status: "actual",
      termEffectiveOn: null,
    });
  });
  it("keeps repeated day-factor tuples equivalent across leap-day and term boundaries", () => {
    const points = projectMortgageTimeline(
      [
        "2028-02-28",
        "2028-03-01",
        "2028-03-15",
        "2028-03-29",
        "2028-03-29",
        "2028-04-12",
        "2028-04-26",
      ],
      [{ asOf: "2028-02-28", principalMinor: 1_000_000 }],
      [
        {
          effectiveOn: "2028-02-28",
          annualRateBps: 500,
          compoundingConvention: "annual",
          paymentMinor: 20_000,
          nextPaymentOn: "2028-03-01",
          renewalOn: "2029-02-28",
          payoffOn: "2028-03-28",
        },
        {
          effectiveOn: "2028-03-29",
          annualRateBps: 500,
          compoundingConvention: "monthly",
          paymentMinor: 20_000,
          nextPaymentOn: "2028-03-29",
          renewalOn: "2029-03-29",
          payoffOn: "2028-04-26",
        },
      ],
    );

    expect(points.map((point) => point.asOf)).toEqual([
      "2028-02-28",
      "2028-03-01",
      "2028-03-15",
      "2028-03-29",
      "2028-04-12",
      "2028-04-26",
    ]);
    const firstPayment = calculateMortgagePayment({
      principalMinor: 1_000_000,
      paymentMinor: 20_000,
      annualRateBps: 500,
      compoundingConvention: "annual",
      daysElapsed: 2,
    });
    expect(points[1]).toMatchObject({
      interestMinor: firstPayment.interestMinor,
      principalPortionMinor: firstPayment.principalPortionMinor,
      endingPrincipalMinor: firstPayment.endingPrincipalMinor,
    });

    const monthlyPayment = calculateMortgagePayment({
      principalMinor: points[2]!.principalMinor,
      paymentMinor: 20_000,
      annualRateBps: 500,
      compoundingConvention: "monthly",
      daysElapsed: 14,
    });
    expect(points[3]).toMatchObject({
      interestMinor: monthlyPayment.interestMinor,
      principalPortionMinor: monthlyPayment.principalPortionMinor,
      endingPrincipalMinor: monthlyPayment.endingPrincipalMinor,
    });
    expect(points[4]!.paymentMinor).toBe(20_000);
    expect(points[5]!.paymentMinor).toBe(20_000);
  });
});
