import { describe, expect, it } from "vitest";
import { calculateGoalSavingPlanPreview, computeGoalPlanDefaultStartDate } from "./goal-saving-plans";

describe("goal-saving plan preview", () => {
  it("counts weekly occurrences inclusive of the target date", () => {
    const preview = calculateGoalSavingPlanPreview({
      targetMinor: 300,
      currentMinor: 0,
      todayIso: "2026-08-03",
      targetDate: "2026-08-17",
      frequency: "weekly",
    });
    expect(preview).toEqual({
      frequency: "weekly",
      occurrences: 3,
      remainingMinor: 300,
      requiredAmountMinor: 100,
      status: null,
      completionDate: null,
      shortfallMinor: null,
    });
  });

  it("counts biweekly occurrences", () => {
    const preview = calculateGoalSavingPlanPreview({
      targetMinor: 300,
      currentMinor: 0,
      todayIso: "2026-08-03",
      targetDate: "2026-08-31",
      frequency: "biweekly",
    });
    expect(preview).toEqual({
      frequency: "biweekly",
      occurrences: 3,
      remainingMinor: 300,
      requiredAmountMinor: 100,
      status: null,
      completionDate: null,
      shortfallMinor: null,
    });
  });

  it("counts monthly occurrences", () => {
    const preview = calculateGoalSavingPlanPreview({
      targetMinor: 300,
      currentMinor: 0,
      todayIso: "2026-08-31",
      targetDate: "2026-10-31",
      frequency: "monthly",
    });
    expect(preview).toEqual({
      frequency: "monthly",
      occurrences: 3,
      remainingMinor: 300,
      requiredAmountMinor: 100,
      status: null,
      completionDate: null,
      shortfallMinor: null,
    });
  });

  it("includes the target date as an occurrence", () => {
    const preview = calculateGoalSavingPlanPreview({
      targetMinor: 100,
      currentMinor: 0,
      todayIso: "2026-08-03",
      targetDate: "2026-08-03",
      frequency: "weekly",
    });
    expect(preview.occurrences).toBe(1);
    expect(preview.requiredAmountMinor).toBe(100);
  });

  it("aligns monthly defaults to the target day of month", () => {
    const preview = calculateGoalSavingPlanPreview({
      targetMinor: 100,
      currentMinor: 0,
      todayIso: "2026-01-31",
      targetDate: "2026-02-28",
      frequency: "monthly",
    });
    expect(preview.occurrences).toBe(1);
    expect(preview.requiredAmountMinor).toBe(100);
  });
  it("starts biweekly plans on the next target weekday", () => {
    expect(computeGoalPlanDefaultStartDate({
      targetDate: "2026-11-19",
      frequency: "biweekly",
      todayIso: "2026-09-11",
    })).toBe("2026-09-17");
  });

  it("reports target-reached when already funded", () => {
    const preview = calculateGoalSavingPlanPreview({
      targetMinor: 500,
      currentMinor: 500,
      todayIso: "2026-08-03",
      targetDate: "2026-08-17",
      frequency: "weekly",
    });
    expect(preview).toEqual({
      frequency: "weekly",
      occurrences: 3,
      remainingMinor: 0,
      requiredAmountMinor: null,
      status: "target-reached",
      completionDate: null,
      shortfallMinor: null,
    });
  });

  it("reports no-occurrence when the target date is before today", () => {
    const preview = calculateGoalSavingPlanPreview({
      targetMinor: 100,
      currentMinor: 0,
      todayIso: "2026-08-05",
      targetDate: "2026-08-04",
      frequency: "weekly",
    });
    expect(preview).toEqual({
      frequency: "weekly",
      occurrences: 0,
      remainingMinor: 100,
      requiredAmountMinor: null,
      status: "no-occurrence",
      completionDate: null,
      shortfallMinor: null,
    });
  });

  it("uses integer ceiling division for required amounts", () => {
    const preview = calculateGoalSavingPlanPreview({
      targetMinor: 100,
      currentMinor: 0,
      todayIso: "2026-08-03",
      targetDate: "2026-08-17",
      frequency: "weekly",
    });
    expect(preview.requiredAmountMinor).toBe(34);
  });

  it("reports on-pace and the completion date when the amount meets the target", () => {
    const preview = calculateGoalSavingPlanPreview({
      targetMinor: 100,
      currentMinor: 0,
      todayIso: "2026-08-03",
      targetDate: "2026-08-17",
      frequency: "weekly",
      amountMinor: 34,
    });
    expect(preview).toMatchObject({ status: "on-pace", amountMinor: 34, completionDate: "2026-08-17", shortfallMinor: null });
  });

  it("reports ahead and the first completion date for an oversized amount", () => {
    const preview = calculateGoalSavingPlanPreview({
      targetMinor: 100,
      currentMinor: 0,
      todayIso: "2026-08-03",
      targetDate: "2026-08-17",
      frequency: "weekly",
      amountMinor: 50,
    });
    expect(preview).toMatchObject({ status: "ahead", amountMinor: 50, completionDate: "2026-08-10", shortfallMinor: null });
  });

  it("reports the target-date shortfall for an undersized amount", () => {
    const preview = calculateGoalSavingPlanPreview({
      targetMinor: 100,
      currentMinor: 0,
      todayIso: "2026-08-03",
      targetDate: "2026-08-17",
      frequency: "weekly",
      amountMinor: 33,
    });
    expect(preview).toMatchObject({ status: "shortfall", amountMinor: 33, completionDate: null, shortfallMinor: 1 });
  });

  it("rejects a planned contribution total outside the safe integer range", () => {
    expect(() => calculateGoalSavingPlanPreview({
      targetMinor: 1,
      currentMinor: 0,
      todayIso: "2026-08-03",
      targetDate: "2026-08-17",
      frequency: "weekly",
      amountMinor: Number.MAX_SAFE_INTEGER,
    })).toThrow(RangeError);
  });

  it("rejects unsafe integer overflow in the goal amounts", () => {
    expect(() => calculateGoalSavingPlanPreview({
      targetMinor: Number.MAX_SAFE_INTEGER + 1,
      currentMinor: 0,
      todayIso: "2026-08-03",
      targetDate: "2026-08-17",
      frequency: "weekly",
    })).toThrow(RangeError);
  });
});
