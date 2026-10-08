import { describe, expect, it } from "vitest";
import { computePreviewForStart } from "./goal-plan-utils";

describe("computePreviewForStart", () => {
  it.each([
    {
      name: "weekly",
      input: { targetMinor: 70000, currentMinor: 0, targetDate: "2026-10-31", todayIso: "2026-09-13", startsOn: "2026-09-15", frequency: "weekly" as const },
      occurrenceDates: ["2026-09-15", "2026-09-22", "2026-09-29", "2026-10-06", "2026-10-13", "2026-10-20", "2026-10-27"],
      requiredAmountMinor: 10000,
    },
    {
      name: "biweekly",
      input: { targetMinor: 625000, currentMinor: 0, targetDate: "2026-11-19", todayIso: "2026-09-11", startsOn: "2026-09-17", frequency: "biweekly" as const },
      occurrenceDates: ["2026-09-17", "2026-10-01", "2026-10-15", "2026-10-29", "2026-11-12"],
      requiredAmountMinor: 125000,
    },
    {
      name: "monthly",
      input: { targetMinor: 100000, currentMinor: 0, targetDate: "2026-12-31", todayIso: "2026-09-13", startsOn: "2026-10-20", frequency: "monthly" as const },
      occurrenceDates: ["2026-10-20", "2026-11-20", "2026-12-20"],
      requiredAmountMinor: 33334,
    },
    {
      name: "month-end anchor",
      input: { targetMinor: 40000, currentMinor: 0, targetDate: "2026-05-30", todayIso: "2026-01-01", startsOn: "2026-01-31", frequency: "monthly" as const },
      occurrenceDates: ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"],
      requiredAmountMinor: 10000,
    },
    {
      name: "today after start",
      input: { targetMinor: 60000, currentMinor: 0, targetDate: "2026-11-30", todayIso: "2026-09-13", startsOn: "2026-09-01", frequency: "biweekly" as const },
      occurrenceDates: ["2026-09-15", "2026-09-29", "2026-10-13", "2026-10-27", "2026-11-10", "2026-11-24"],
      requiredAmountMinor: 10000,
    },
    {
      name: "near max safe integer",
      input: { targetMinor: Number.MAX_SAFE_INTEGER, currentMinor: 0, targetDate: "2026-10-31", todayIso: "2026-09-13", startsOn: "2026-09-15", frequency: "weekly" as const },
      occurrenceDates: ["2026-09-15", "2026-09-22", "2026-09-29", "2026-10-06", "2026-10-13", "2026-10-20", "2026-10-27"],
      requiredAmountMinor: 1286742750677285,
    },
  ])("preserves $name preview values", ({ input, occurrenceDates, requiredAmountMinor }) => {
    expect(computePreviewForStart(input)).toMatchObject({
      occurrenceDates,
      occurrences: occurrenceDates.length,
      remainingMinor: input.targetMinor - input.currentMinor,
      requiredAmountMinor,
      defaultStartsOn: input.startsOn,
    });
  });
});
