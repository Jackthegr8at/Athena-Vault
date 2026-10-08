import { describe, expect, it } from "vitest";
import {
  calculateRrqContributionTracker,
  composeRrqYearLimits,
  deriveRrqContributionIntervals,
  normalizeRrqObservations,
} from "../src";

const limits = {
  taxYear: 2026,
  firstMaximumMinor: 447930,
  additionalMaximumMinor: 41600,
  ympeMinor: 7460000,
  yampeMinor: 8500000,
  firstRateBps: 630,
  additionalRateBps: 400,
};

function observation(completedPayNumber: number, rrqContributionYtdMinor: number | null, snapshotOn = `2026-01-${String(completedPayNumber).padStart(2, "0")}`) {
  return { snapshotOn, completedPayNumber, rrqContributionYtdMinor };
}

describe("RRQ contribution calculations", () => {
  it("composes the total employee maximum from first and additional maximums", () => {
    expect(composeRrqYearLimits(limits)).toMatchObject({ ...limits, totalEmployeeMaximumMinor: 489530 });
  });

  it("normalizes only entered cumulative observations in snapshot order", () => {
    expect(normalizeRrqObservations([
      observation(3, 300, "2026-02-01"),
      observation(2, null, "2026-01-15"),
      observation(1, 100, "2026-01-01"),
    ])).toEqual([
      { snapshotId: null, snapshotOn: "2026-01-01", completedPayNumber: 1, rrqContributionYtdMinor: 100 },
      { snapshotId: null, snapshotOn: "2026-02-01", completedPayNumber: 3, rrqContributionYtdMinor: 300 },
    ]);
  });

  it("orders equal-date observations by relational ID ordering and preserves exact ties", () => {
    expect(normalizeRrqObservations([
      { snapshotId: "z", snapshotOn: "2026-01-01", completedPayNumber: 1, rrqContributionYtdMinor: 100 },
      { snapshotId: "a", snapshotOn: "2026-01-01", completedPayNumber: 1, rrqContributionYtdMinor: 90 },
      { snapshotId: "a", snapshotOn: "2026-01-01", completedPayNumber: 1, rrqContributionYtdMinor: 80 },
      { snapshotId: null, snapshotOn: "2026-01-01", completedPayNumber: 1, rrqContributionYtdMinor: 70 },
    ])).toEqual([
      { snapshotId: null, snapshotOn: "2026-01-01", completedPayNumber: 1, rrqContributionYtdMinor: 70 },
      { snapshotId: "a", snapshotOn: "2026-01-01", completedPayNumber: 1, rrqContributionYtdMinor: 90 },
      { snapshotId: "a", snapshotOn: "2026-01-01", completedPayNumber: 1, rrqContributionYtdMinor: 80 },
      { snapshotId: "z", snapshotOn: "2026-01-01", completedPayNumber: 1, rrqContributionYtdMinor: 100 },
    ]);
  });

  it("keeps tracker entries and weighted intervals equivalent for unsorted and omitted observations", () => {
    const inputObservations = [
      observation(4, 260, "2026-01-04"),
      observation(3, null, "2026-01-03"),
      observation(1, 100, "2026-01-01"),
      observation(2, 200, "2026-01-02"),
    ];
    const normalized = normalizeRrqObservations(inputObservations);
    const intervals = deriveRrqContributionIntervals(inputObservations);
    let intervalIndex = 0;
    const expectedEntries = normalized.map((current, index) => {
      const previous = normalized[index - 1];
      if (!previous) {
        return {
          snapshotId: current.snapshotId,
          snapshotOn: current.snapshotOn,
          completedPayNumber: current.completedPayNumber,
          rrqContributionYtdMinor: current.rrqContributionYtdMinor,
          derivedContributionMinor: null,
          derivedPayPeriodCount: null,
          derivedPerPayMinor: null,
          isReanchor: false,
        };
      }
      const contributionMinor = current.rrqContributionYtdMinor - previous.rrqContributionYtdMinor;
      const payPeriodCount = current.completedPayNumber - previous.completedPayNumber;
      const valid = payPeriodCount > 0 && contributionMinor >= 0;
      const interval = valid ? intervals[intervalIndex++] : undefined;
      return {
        snapshotId: current.snapshotId,
        snapshotOn: current.snapshotOn,
        completedPayNumber: current.completedPayNumber,
        rrqContributionYtdMinor: current.rrqContributionYtdMinor,
        derivedContributionMinor: interval?.contributionMinor ?? null,
        derivedPayPeriodCount: interval?.payPeriodCount ?? null,
        derivedPerPayMinor: interval?.perPayMinor ?? null,
        isReanchor: !valid,
      };
    });
    const tracker = calculateRrqContributionTracker({
      limits,
      observations: inputObservations,
      totalPayPeriods: 26,
      federalCumulativeMinor: null,
      provincialCumulativeMinor: null,
      provincialProjectedYearEndMinor: null,
    });

    expect(tracker.recentEntries).toEqual(expectedEntries.reverse());
    expect(tracker.weightedPerPayMinor).toBe(60);
  });

  it("derives a per-pay contribution across omitted snapshots with integer rounding", () => {
    expect(deriveRrqContributionIntervals([
      observation(10, 1000, "2026-05-01"),
      observation(11, null, "2026-05-15"),
      observation(13, 1601, "2026-06-12"),
    ])).toEqual([{
      fromSnapshotOn: "2026-05-01",
      toSnapshotOn: "2026-06-12",
      fromCompletedPayNumber: 10,
      toCompletedPayNumber: 13,
      contributionMinor: 601,
      payPeriodCount: 3,
      perPayMinor: 200,
    }]);
  });

  it("weights the newest four valid intervals 4, 3, 2, 1", () => {
    const observations = [100, 300, 600, 1000, 1500].map((value, index) => observation(index + 1, value, `2026-01-${String(index + 1).padStart(2, "0")}`));
    expect(calculateRrqContributionTracker({ limits, observations, totalPayPeriods: 26, federalCumulativeMinor: 1_000_000, provincialCumulativeMinor: null, provincialProjectedYearEndMinor: null }).weightedPerPayMinor).toBe(400);
  });

  it("uses rounded YTD divided by pay number when there is one observation", () => {
    const tracker = calculateRrqContributionTracker({ limits, observations: [observation(2, 365)], totalPayPeriods: 26, federalCumulativeMinor: 1_000_000, provincialCumulativeMinor: null, provincialProjectedYearEndMinor: null });
    expect(tracker.weightedPerPayMinor).toBe(183);
    expect(tracker.unavailableReason).toBe("maximum-not-reached-within-year");
  });

  it("re-anchors on a lower correction without producing a negative deduction", () => {
    const tracker = calculateRrqContributionTracker({
      limits,
      observations: [observation(1, 100), observation(2, 80), observation(3, 180)],
      totalPayPeriods: 26,
      federalCumulativeMinor: 1_000_000,
      provincialCumulativeMinor: null,
      provincialProjectedYearEndMinor: null,
    });
    expect(tracker.recentEntries).toEqual([
      expect.objectContaining({ completedPayNumber: 3, derivedContributionMinor: 100, derivedPerPayMinor: 100, isReanchor: false }),
      expect.objectContaining({ completedPayNumber: 2, derivedContributionMinor: null, derivedPerPayMinor: null, isReanchor: true }),
      expect.objectContaining({ completedPayNumber: 1, derivedContributionMinor: null, isReanchor: false }),
    ]);
    expect(tracker.weightedPerPayMinor).toBe(100);
  });

  it("returns remaining, percentage, overage, YMPE, and YAMPE progress", () => {
    const tracker = calculateRrqContributionTracker({ limits, observations: [observation(26, 500000)], totalPayPeriods: 26, federalCumulativeMinor: 3_730_000, provincialCumulativeMinor: 3_730_000, provincialProjectedYearEndMinor: 3_730_000 });
    expect(tracker.remainingMinor).toBe(0);
    expect(tracker.overageMinor).toBe(10470);
    expect(tracker.completionPercent).toBe(102.14);
    expect(tracker.ympeProgressPercent).toBe(50);
    expect(tracker.yampeProgressPercent).toBe(43.88);
    expect(tracker.projectedCompletionPayNumber).toBe(26);
    expect(tracker.projectedCompletionOn).toBe("2026-01-26");
  });

  it("projects the maximum-reach pay number and date from the latest weighted rate", () => {
    const tracker = calculateRrqContributionTracker({
      limits: { ...limits, firstMaximumMinor: 1000, additionalMaximumMinor: 0, ympeMinor: 10000, yampeMinor: 20000 },
      observations: [observation(2, 200, "2026-01-15"), observation(3, 300, "2026-01-29")],
      totalPayPeriods: 10,
      paydays: ["2026-01-01", "2026-01-15", "2026-01-29", "2026-02-12", "2026-02-26", "2026-03-12", "2026-03-26", "2026-04-09", "2026-04-23", "2026-05-07"],
      federalCumulativeMinor: 5000,
      provincialCumulativeMinor: null,
      provincialProjectedYearEndMinor: null,
    });
    expect(tracker.remainingMinor).toBe(700);
    expect(tracker.weightedPerPayMinor).toBe(100);
    expect(tracker.projectedCompletionPayNumber).toBe(10);
    expect(tracker.projectedCompletionOn).toBe("2026-05-07");
  });

  it("reports unavailable states for missing limits, missing observations, re-anchors, and zero rates", () => {
    expect(calculateRrqContributionTracker({ limits: null, observations: [], totalPayPeriods: 26, federalCumulativeMinor: null, provincialCumulativeMinor: null, provincialProjectedYearEndMinor: null })).toMatchObject({ status: "unavailable", unavailableReason: "missing-year-limits" });
    expect(calculateRrqContributionTracker({ limits, observations: [], totalPayPeriods: 26, federalCumulativeMinor: null, provincialCumulativeMinor: null, provincialProjectedYearEndMinor: null })).toMatchObject({ status: "unavailable", unavailableReason: "no-observations", remainingMinor: 489530 });
    expect(calculateRrqContributionTracker({ limits, observations: [observation(1, 100), observation(2, 80)], totalPayPeriods: 26, federalCumulativeMinor: 1000, provincialCumulativeMinor: null, provincialProjectedYearEndMinor: null })).toMatchObject({ status: "available", unavailableReason: "needs-follow-up-observation" });
    expect(calculateRrqContributionTracker({ limits, observations: [observation(1, 0)], totalPayPeriods: 26, federalCumulativeMinor: 1000, provincialCumulativeMinor: null, provincialProjectedYearEndMinor: null })).toMatchObject({ status: "available", unavailableReason: "zero-forecast-rate" });
  });

  it("uses provincial gross to forecast the first and additional RRQ zones", () => {
    const tracker = calculateRrqContributionTracker({
      limits,
      observations: [observation(17, 427_238, "2026-08-19")],
      totalPayPeriods: 26,
      paydays: ["2026-01-07", "2026-01-21", "2026-02-04", "2026-02-18", "2026-03-04", "2026-03-18", "2026-04-01", "2026-04-15", "2026-04-29", "2026-05-13", "2026-05-27", "2026-06-10", "2026-06-24", "2026-07-08", "2026-07-22", "2026-08-05", "2026-08-19", "2026-09-02", "2026-09-16", "2026-09-30", "2026-10-14", "2026-10-28", "2026-11-11", "2026-11-25", "2026-12-09", "2026-12-23"],
      federalCumulativeMinor: 6_558_710,
      provincialCumulativeMinor: 7_107_303,
      provincialProjectedYearEndMinor: 10_869_993,
    });

    expect(tracker.ympeProgressPercent).toBe(95.27);
    expect(tracker.yampeProgressPercent).toBe(83.62);
    expect(tracker.tierAwareForecastPerPayMinor).toBe(23_307);
    expect(tracker.projectedTier).toBe("mixed");
    expect(tracker.projectedCompletionPayNumber).toBe(21);
    expect(tracker.projectedCompletionOn).toBe("2026-10-14");
  });

  it("uses the additional-zone rate after the first maximum is reached", () => {
    const tracker = calculateRrqContributionTracker({
      limits,
      observations: [observation(17, limits.firstMaximumMinor, "2026-08-19")],
      totalPayPeriods: 26,
      federalCumulativeMinor: 6_500_000,
      provincialCumulativeMinor: 7_500_000,
      provincialProjectedYearEndMinor: 8_000_000,
    });

    expect(tracker.tierAwareForecastPerPayMinor).toBe(2_222);
    expect(tracker.projectedTier).toBe("additional");
  });

  it("stops the tier-aware forecast at the remaining employee maximum", () => {
    const tracker = calculateRrqContributionTracker({
      limits,
      observations: [observation(17, 489_500, "2026-08-19")],
      totalPayPeriods: 26,
      federalCumulativeMinor: 6_500_000,
      provincialCumulativeMinor: 7_500_000,
      provincialProjectedYearEndMinor: 8_500_000,
    });

    expect(tracker.tierAwareForecastPerPayMinor).toBe(30);
    expect(tracker.remainingMinor).toBe(30);
    expect(tracker.projectedCompletionPayNumber).toBe(18);
    expect(tracker.projectedTier).toBe("additional");
  });

  it("keeps the weighted forecast as a fallback when provincial projection is missing", () => {
    const tracker = calculateRrqContributionTracker({
      limits,
      observations: [observation(1, 100), observation(2, 300)],
      totalPayPeriods: 26,
      federalCumulativeMinor: 7_000_000,
      provincialCumulativeMinor: null,
      provincialProjectedYearEndMinor: null,
    });
    expect(tracker.tierAwareForecastPerPayMinor).toBeNull();
    expect(tracker.weightedPerPayMinor).toBe(200);
    expect(tracker.ympeProgressPercent).toBeNull();
  });
});
