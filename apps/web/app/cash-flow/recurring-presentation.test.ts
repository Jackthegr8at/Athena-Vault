import { describe, expect, it } from "vitest";
import { buildRecurringPaymentsHelpSnapshot } from "./recurring-presentation";

const activeSeries = {
  id: "series-1",
  state: "active" as const,
  versions: [{ id: "version-1" }],
  exceptions: [],
};

describe("Recurring payments help presentation", () => {
  it("starts with an account, then points to first income", () => {
    expect(buildRecurringPaymentsHelpSnapshot({ series: [], accountCount: 0, periodCount: 0 }).action).toEqual({ label: "Add an account", href: "/accounts" });
    expect(buildRecurringPaymentsHelpSnapshot({ series: [], accountCount: 1, periodCount: 0 }).action).toEqual({ label: "Add first income", href: "/cash-flow/recurring#recurring-create" });
    expect(buildRecurringPaymentsHelpSnapshot({ series: [{ ...activeSeries, state: "ended" as const }], accountCount: 1, periodCount: 1 }).action).toEqual({ label: "Add first income", href: "/cash-flow/recurring#recurring-create" });
  });

  it("prioritizes active exception review", () => {
    expect(buildRecurringPaymentsHelpSnapshot({ series: [{ ...activeSeries, exceptions: [{ isActive: true }] }], accountCount: 1, periodCount: 4 }).action).toEqual({ label: "Review occurrence exceptions", href: "/cash-flow/recurring#recurring-series-series-1" });
  });

  it("reports schedule state counts without exposing amounts", () => {
    expect(buildRecurringPaymentsHelpSnapshot({
      series: [activeSeries, { id: "paused", state: "paused", versions: [{ id: "version-2" }, { id: "version-3" }], exceptions: [{ isActive: false }] }, { id: "ended", state: "ended", versions: [], exceptions: [] }],
      accountCount: 2,
      periodCount: 8,
    })).toEqual({
      items: [
        { label: "Available accounts", value: "2" },
        { label: "Active schedules", value: "2" },
        { label: "Paused schedules", value: "1" },
        { label: "Ended schedules", value: "1" },
        { label: "Schedule versions", value: "3" },
        { label: "Active exceptions", value: "0" },
        { label: "Cash Flow periods", value: "8" },
      ],
      action: { label: "Review recurring schedules", href: "/cash-flow/recurring" },
    });
  });
});
