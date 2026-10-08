import { describe, expect, it } from "vitest";
import {
  ACCOUNT_KIND_OPTIONS,
  ACCOUNT_TIMELINE_SOURCE_STATUS_BOUNDARY,
  accountGroupForKind,
  accountKindLabel,
  accountTimelineDedicatedOtherSectionKeys,
  accountTimelineSectionForAccount,
  accountTimelineSectionKeyForCustomTypeLabel,
  derivePeriodState,
  isCreditAccountKind,
  isInvestmentAccountKind,
  isLiquidAccountKind,
  navigatePayday,
  selectClosestPaydayOnOrBefore,
  statusAtAccountTimelineSourceBoundary,
  toTorontoDateIso,
} from "./account-timeline";

const paydays = ["2026-06-10", "2026-06-24", "2026-07-08", "2026-07-22", "2026-08-05"];

describe("account taxonomy", () => {
  it("keeps liquid, credit, and investment group boundaries explicit", () => {
    expect(isLiquidAccountKind("checking")).toBe(true);
    expect(isLiquidAccountKind("savings")).toBe(true);
    expect(isLiquidAccountKind("cash")).toBe(true);
    expect(isLiquidAccountKind("rrsp")).toBe(false);
    expect(isCreditAccountKind("credit")).toBe(true);
    expect(isInvestmentAccountKind("crypto")).toBe(true);
    expect(accountGroupForKind("tfsa")).toBe("investment");
    expect(accountGroupForKind("rdsp")).toBe("investment");
    expect(isLiquidAccountKind("rdsp")).toBe(false);
    expect(isInvestmentAccountKind("rdsp")).toBe(true);
    expect(ACCOUNT_KIND_OPTIONS.find((option) => option.code === "rdsp")).toMatchObject({
      label: "REEI / RDSP",
      group: "investment",
      isLiquid: false,
      supportsCustomLabel: false,
    });
  });

  it("uses the custom label only for Other", () => {
    expect(accountKindLabel("other", "  Emergency reserve  ")).toBe("Emergency reserve");
    expect(accountKindLabel("checking", "Ignored custom")).toBe("Chequing");
    expect(accountKindLabel("rdsp")).toBe("REEI / RDSP");
  });

  it("dedicates repeated Other labels while keeping singleton labels in investments", () => {
    const dedicatedSections = accountTimelineDedicatedOtherSectionKeys([
      { kind: "other", customTypeLabel: "  Emergency   reserve ", isActive: true },
      { kind: "other", customTypeLabel: "emergency reserve", isActive: true },
      { kind: "other", customTypeLabel: "Collectible", isActive: true },
      { kind: "other", customTypeLabel: "Emergency reserve", isActive: false },
    ]);

    expect(accountTimelineSectionKeyForCustomTypeLabel(" Emergency reserve ")).toBe("other:emergency reserve");
    expect(dedicatedSections.has("other:emergency reserve")).toBe(true);
    expect(dedicatedSections.has("other:collectible")).toBe(false);
    expect(accountTimelineSectionForAccount("other", "Emergency reserve", dedicatedSections)).toBe("other:emergency reserve");
    expect(accountTimelineSectionForAccount("other", "Collectible", dedicatedSections)).toBe("investment");
    expect(accountTimelineSectionForAccount("other", "Emergency reserve", new Set())).toBe("investment");
    expect(accountTimelineSectionForAccount("checking", "Emergency reserve", dedicatedSections)).toBe("liquid");
  });
});

describe("Toronto current date and payday selection", () => {
  it("converts dates around Toronto midnight using the runtime timezone", () => {
    expect(toTorontoDateIso(new Date("2026-08-06T03:59:59.999Z"))).toBe("2026-08-05");
    expect(toTorontoDateIso(new Date("2026-08-06T04:00:00.000Z"))).toBe("2026-08-06");
  });

  it.each([
    ["before first", "2026-05-31", "2026-06-10"],
    ["exact payday", "2026-06-24", "2026-06-24"],
    ["between paydays", "2026-07-01", "2026-06-24"],
    ["after last", "2026-08-20", "2026-08-05"],
  ])("selects the closest payday on or before for %s", (_label, today, expected) => {
    expect(selectClosestPaydayOnOrBefore(paydays, today)).toBe(expected);
  });

  it("navigates without creating dates outside the known timeline", () => {
    expect(navigatePayday(paydays, "2026-07-08", "previous")).toBe("2026-06-24");
    expect(navigatePayday(paydays, "2026-07-08", "next")).toBe("2026-07-22");
    expect(navigatePayday(paydays, "2026-06-10", "previous")).toBe("2026-06-10");
    expect(navigatePayday(paydays, "2026-08-05", "next")).toBe("2026-08-05");
  });
});

describe("period state", () => {
  it("derives Actual, Projected, and Mixed from snapshot statuses", () => {
    expect(derivePeriodState(["actual", "actual"])).toBe("actual");
    expect(derivePeriodState(["planned", "planned"])).toBe("projected");
    expect(derivePeriodState(["actual", "planned"])).toBe("mixed");
    expect(derivePeriodState([])).toBe("projected");
  });

  it("labels period position as Past, Current, or Projected for display", async () => {
    const { periodPositionLabel, periodStateLabel, snapshotStatusDisplayLabel } = await import("./account-timeline");
    expect(periodPositionLabel("2026-08-05", "2026-08-19")).toBe("Past");
    expect(periodPositionLabel("2026-08-19", "2026-08-19")).toBe("Current");
    expect(periodPositionLabel("2026-09-02", "2026-08-19")).toBe("Projected");
    expect(periodStateLabel("actual")).toBe("Confirmed");
    expect(periodStateLabel("planned")).toBe("Projected");
    expect(snapshotStatusDisplayLabel("actual")).toBe("Confirmed");
    expect(snapshotStatusDisplayLabel("planned")).toBe("Projected");
  });

  it("keeps the imported source boundary fixed and produces five Actual and seven Projected columns", () => {
    const importedPaydays = [
      "2026-06-10", "2026-06-24", "2026-07-08", "2026-07-22", "2026-08-05",
      "2026-08-19", "2026-09-02", "2026-09-16", "2026-09-30", "2026-10-14", "2026-10-28", "2026-11-11",
    ];
    const statuses = importedPaydays.map(statusAtAccountTimelineSourceBoundary);
    expect(ACCOUNT_TIMELINE_SOURCE_STATUS_BOUNDARY).toBe("2026-08-05");
    expect(statuses.slice(0, 5)).toEqual(["actual", "actual", "actual", "actual", "actual"]);
    expect(statuses.slice(5)).toEqual(["planned", "planned", "planned", "planned", "planned", "planned", "planned"]);
    expect(statuses.map((status) => derivePeriodState([status]))).not.toContain("mixed");
    expect(() => statusAtAccountTimelineSourceBoundary("2026/08/05")).toThrow(RangeError);
  });
});
