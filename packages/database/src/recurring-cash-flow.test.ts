import { describe, expect, it } from "vitest";
import {
  applyRecurringCashFlowException,
  expandRecurringCashFlowOccurrences,
  recurringCashFlowOccurrencesBetween,
  recurringCashFlowRangeOptions,
  recurringCashFlowTotalMinor,
  selectRecurringCashFlowVersion,
  nextRecurringCashFlowOccurrenceAfter,
  type RecurringCashFlowOccurrence,
  type RecurringCashFlowVersionSchedule,
  type RecurringOccurrenceException,
} from "./recurring-cash-flow";

const schedule = (overrides: Partial<RecurringCashFlowVersionSchedule> = {}): RecurringCashFlowVersionSchedule => ({
  id: "version-1",
  seriesId: "series-1",
  name: "Base schedule",
  kind: "expense",
  accountId: "account-1",
  fromAccountId: null,
  toAccountId: null,
  amountMinor: 1250,
  frequency: "weekly",
  weekdayAdjustment: "none",
  startsOn: "2026-01-05",
  endsOn: null,
  effectiveFrom: "2026-01-05",
  effectiveTo: null,
  ...overrides,
});

const exception = (overrides: Partial<RecurringOccurrenceException> = {}): RecurringOccurrenceException => ({
  id: "exception-1",
  seriesId: "series-1",
  versionId: "version-1",
  scheduledOccurrenceOn: "2026-01-12",
  kind: "override",
  dateOverride: null,
  amountOverrideMinor: null,
  accountOverrideId: null,
  fromAccountOverrideId: null,
  toAccountOverrideId: null,
  transferId: null,
  statusOverride: null,
  note: null,
  overrideGroupId: null,
  isActive: true,
  ...overrides,
});

describe("recurring cash-flow schedules", () => {
  it("expands weekly, biweekly, monthly, quarterly, and annual schedules", () => {
    expect(recurringCashFlowOccurrencesBetween(schedule({ frequency: "weekly" }), "2026-01-05", "2026-01-19")).toEqual([
      "2026-01-05", "2026-01-12", "2026-01-19",
    ]);
    expect(recurringCashFlowOccurrencesBetween(schedule({ frequency: "biweekly" }), "2026-01-05", "2026-02-02")).toEqual([
      "2026-01-05", "2026-01-19", "2026-02-02",
    ]);
    expect(recurringCashFlowOccurrencesBetween(schedule({ frequency: "monthly", startsOn: "2026-01-31" }), "2026-02-01", "2026-04-30")).toEqual([
      "2026-02-28", "2026-03-31", "2026-04-30",
    ]);
    expect(recurringCashFlowOccurrencesBetween(schedule({ frequency: "quarterly", startsOn: "2026-01-31" }), "2026-02-01", "2026-10-31")).toEqual([
      "2026-04-30", "2026-07-31", "2026-10-31",
    ]);
    expect(recurringCashFlowOccurrencesBetween(schedule({ frequency: "annual", startsOn: "2024-02-29" }), "2025-01-01", "2027-12-31")).toEqual([
      "2025-02-28", "2026-02-28", "2027-02-28",
    ]);
  });

  it("clamps month ends from the original anchor without drifting", () => {
    expect(recurringCashFlowOccurrencesBetween(schedule({ frequency: "monthly", startsOn: "2026-08-31" }), "2026-09-01", "2027-02-28")).toEqual([
      "2026-09-30", "2026-10-31", "2026-11-30", "2026-12-31", "2027-01-31", "2027-02-28",
    ]);
  });

  it("applies weekday adjustment after weekly and month-end anchor expansion", () => {
    expect(recurringCashFlowOccurrencesBetween(schedule({ startsOn: "2026-05-09", weekdayAdjustment: "next_weekday" }), "2026-05-09", "2026-05-25")).toEqual([
      "2026-05-11", "2026-05-18", "2026-05-25",
    ]);
    expect(recurringCashFlowOccurrencesBetween(schedule({ startsOn: "2026-05-09", weekdayAdjustment: "previous_weekday" }), "2026-05-08", "2026-05-22")).toEqual([
      "2026-05-08", "2026-05-15", "2026-05-22",
    ]);
    expect(recurringCashFlowOccurrencesBetween(schedule({ frequency: "monthly", startsOn: "2026-01-31", weekdayAdjustment: "next_weekday" }), "2026-02-01", "2026-04-30")).toEqual([
      "2026-02-02", "2026-03-02", "2026-03-31", "2026-04-30",
    ]);
  });

  it("supports none, next weekday, and previous weekday for every supported frequency", () => {
    const cases = [
      ["weekly", "2026-05-08", "2026-05-08", "2026-05-08", "2026-05-08"],
      ["biweekly", "2026-05-09", "2026-05-09", "2026-05-11", "2026-05-08"],
      ["monthly", "2026-05-31", "2026-05-31", "2026-06-01", "2026-05-29"],
      ["quarterly", "2026-03-29", "2026-03-29", "2026-03-30", "2026-03-27"],
      ["annual", "2026-05-30", "2026-05-30", "2026-06-01", "2026-05-29"],
    ] as const;
    for (const [frequency, startsOn, none, nextWeekday, previousWeekday] of cases) {
      const first = (weekdayAdjustment: "none" | "next_weekday" | "previous_weekday") => recurringCashFlowOccurrencesBetween(
        schedule({ frequency, startsOn, weekdayAdjustment }),
        "2026-01-01",
        "2026-12-31",
      )[0];
      expect(first("none")).toBe(none);
      expect(first("next_weekday")).toBe(nextWeekday);
      expect(first("previous_weekday")).toBe(previousWeekday);
    }
  });

  it("validates adjusted occurrences and calculates the next date without anchor drift", async () => {
    const { assertRecurringCashFlowOccurrence, isRecurringCashFlowOccurrence, nextRecurringCashFlowOccurrence } = await import("./recurring-cash-flow");
    const adjusted = schedule({ startsOn: "2026-05-09", weekdayAdjustment: "previous_weekday" });
    expect(isRecurringCashFlowOccurrence(adjusted, "2026-05-08")).toBe(true);
    expect(isRecurringCashFlowOccurrence(adjusted, "2026-05-09")).toBe(false);
    expect(() => assertRecurringCashFlowOccurrence(adjusted, "2026-05-09")).toThrow("match the recurring schedule");
    expect(nextRecurringCashFlowOccurrence(adjusted, "2026-05-09")).toBe("2026-05-15");
  });

  it("calculates a fresh next date after the read-model date", () => {
    const income = schedule({ frequency: "biweekly", startsOn: "2026-01-02" });
    expect(nextRecurringCashFlowOccurrenceAfter(income, "2026-08-30")).toBe("2026-09-11");
    expect(nextRecurringCashFlowOccurrenceAfter(income, "2026-09-11")).toBe("2026-09-25");
  });

  it("selects exactly one effective version and rejects overlapping boundaries", () => {
    const first = schedule({ id: "version-1", startsOn: "2026-05-31", effectiveFrom: "2026-05-31", effectiveTo: "2026-05-31", endsOn: "2026-05-31" });
    const second = schedule({ id: "version-2", name: "Renamed schedule", startsOn: "2026-06-01", effectiveFrom: "2026-06-01" });
    expect(selectRecurringCashFlowVersion([first, second], "2026-05-31")?.id).toBe("version-1");
    expect(selectRecurringCashFlowVersion([first, second], "2026-06-01")?.name).toBe("Renamed schedule");
    expect(() => selectRecurringCashFlowVersion([
      first,
      { ...second, startsOn: "2026-05-31", effectiveFrom: "2026-05-31" },
    ], "2026-05-31")).toThrow("Overlapping recurring versions");
  });

  it("partitions versions deterministically and rejects a gap-free overlap", async () => {
    const { partitionRecurringCashFlowVersions } = await import("./recurring-cash-flow");
    const first = schedule({ id: "version-1", effectiveFrom: "2026-01-05", effectiveTo: "2026-05-31" });
    const second = schedule({ id: "version-2", effectiveFrom: "2026-06-01" });
    expect(partitionRecurringCashFlowVersions([second, first], "series-1").map((version) => version.id)).toEqual(["version-1", "version-2"]);
    expect(() => partitionRecurringCashFlowVersions([
      first,
      { ...second, startsOn: "2026-05-31", effectiveFrom: "2026-05-31" },
    ], "series-1")).toThrow("Overlapping recurring versions");
  });

});

describe("recurring cash-flow exceptions", () => {
  it("applies a moved amount/account override and restores the inherited occurrence", () => {
    const base: RecurringCashFlowOccurrence = {
      seriesId: "series-1",
      versionId: "version-1",
      scheduledOccurrenceOn: "2026-01-12",
      transactionDate: "2026-01-12",
      amountMinor: 1250,
      accountId: "account-1",
      fromAccountId: null,
      toAccountId: null,
      name: "Base schedule",
      kind: "expense",
      status: "planned",
      isSkipped: false,
      exceptionId: null,
      note: null,
      overrideGroupId: null,
    };
    const changed = applyRecurringCashFlowException(base, exception({
      dateOverride: "2026-01-13",
      amountOverrideMinor: 2100,
      accountOverrideId: "account-2",
      note: "Moved after the holiday",
      overrideGroupId: "group-1",
    }));
    expect(changed).toMatchObject({ transactionDate: "2026-01-13", amountMinor: 2100, accountId: "account-2", name: "Base schedule", note: "Moved after the holiday", overrideGroupId: "group-1" });
    expect(applyRecurringCashFlowException(base, { ...exception(), isActive: false })).toEqual(base);
  });

  it("keeps skipped occurrences explicit and applies a temporary six-occurrence range", () => {
    const versions = [schedule({ startsOn: "2026-08-03", effectiveFrom: "2026-08-03", amountMinor: 1000 })];
    const occurrences = expandRecurringCashFlowOccurrences("series-1", versions, [], "2026-08-03", "2026-09-21");
    expect(occurrences).toHaveLength(8);
    expect(recurringCashFlowRangeOptions(occurrences, "2026-08-03").slice(0, 6)).toEqual([
      { endingOccurrenceOn: "2026-08-03", occurrenceCount: 1 },
      { endingOccurrenceOn: "2026-08-10", occurrenceCount: 2 },
      { endingOccurrenceOn: "2026-08-17", occurrenceCount: 3 },
      { endingOccurrenceOn: "2026-08-24", occurrenceCount: 4 },
      { endingOccurrenceOn: "2026-08-31", occurrenceCount: 5 },
      { endingOccurrenceOn: "2026-09-07", occurrenceCount: 6 },
    ]);
    const rangeException = (scheduledOccurrenceOn: string): RecurringOccurrenceException => exception({
      id: `exception-${scheduledOccurrenceOn}`,
      scheduledOccurrenceOn,
      amountOverrideMinor: 2500,
      note: "Temporary range",
      overrideGroupId: "group-1",
    });
    const changed = expandRecurringCashFlowOccurrences(
      "series-1",
      versions,
      occurrences.slice(0, 6).map((occurrence) => rangeException(occurrence.scheduledOccurrenceOn)),
      "2026-08-03",
      "2026-09-21",
    );
    expect(changed.slice(0, 6).every((occurrence) => occurrence.amountMinor === 2500)).toBe(true);
    expect(changed[6]).toMatchObject({ scheduledOccurrenceOn: "2026-09-14", amountMinor: 1000 });
    const skipped = expandRecurringCashFlowOccurrences("series-1", versions, [exception({ kind: "skip", scheduledOccurrenceOn: "2026-08-10", amountOverrideMinor: null })], "2026-08-03", "2026-08-17");
    expect(skipped[1]).toMatchObject({ scheduledOccurrenceOn: "2026-08-10", isSkipped: true, status: "skipped", transactionDate: null });
  });

  it("sums only active planned occurrences in integer minor units", () => {
    const occurrences = expandRecurringCashFlowOccurrences("series-1", [schedule({ amountMinor: 333, startsOn: "2026-01-05", effectiveFrom: "2026-01-05" })], [exception({ scheduledOccurrenceOn: "2026-01-12", kind: "skip", amountOverrideMinor: null })], "2026-01-05", "2026-01-19");
    expect(recurringCashFlowTotalMinor(occurrences)).toBe(666);
    expect(() => recurringCashFlowTotalMinor([{ ...occurrences[0]!, amountMinor: 1.5 }])).toThrow("positive integer minor-unit");
  });
});
