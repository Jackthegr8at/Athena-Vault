import { describe, expect, it } from "vitest";
import { selectAccountTimelineWindow } from "../account-timeline-window";
interface Seed { id: string; asOf: string; balanceMinor: number; status: "actual" | "planned"; isGenerated: boolean }
export const timelineWindowBaseline = {
  hiddenAccountId: "synthetic-hidden",
  snapshots: [
    { id: "old-actual", asOf: "2030-01-01", balanceMinor: 10000, status: "actual", isGenerated: false },
    { id: "manual", asOf: "2030-01-15", balanceMinor: 11000, status: "planned", isGenerated: false },
    { id: "generated", asOf: "2030-01-29", balanceMinor: 12000, status: "planned", isGenerated: true },
  ] satisfies Seed[],
};
describe("Accounts historical baseline fixtures", () => {
  it("normalizes dates and preserves selection and bounded navigation metadata", () => {
    const dates = ["2030-01-29", "2030-01-01", "2030-01-15", "2030-01-15"];
    expect(selectAccountTimelineWindow(dates, { todayIso: "2030-01-20", pastPeriods: 0, futurePeriods: 0 })).toMatchObject({ selectedDate: "2030-01-15", visibleDates: ["2030-01-15"], dates: ["2030-01-01", "2030-01-15", "2030-01-29"] });
    expect(selectAccountTimelineWindow(dates, { todayIso: "2029-01-01", selectedDate: "foreign" }).selectedDate).toBe("2030-01-01");
    expect(selectAccountTimelineWindow([], { todayIso: "2030-01-20" }).visibleDates).toEqual([]);
  });
  it("retains sparse Actual, manual and generated source identities without mutation", () => {
    const rows = timelineWindowBaseline.snapshots;
    expect(rows.filter(row => row.status === "actual" || !row.isGenerated).map(row => row.id)).toEqual(["old-actual", "manual"]);
    expect(rows.find(row => row.asOf === "2030-01-29")?.balanceMinor).toBe(12000);
    expect(rows.every(row => Number.isSafeInteger(row.balanceMinor))).toBe(true);
  });
});
