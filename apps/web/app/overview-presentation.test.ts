import { describe, expect, it } from "vitest";
import { buildOverviewHelpSnapshot } from "./overview-presentation";

const readyInput = {
  activeAccountCount: 1,
  totalPeriodCount: 4,
  hasCurrentBalance: true,
  hasActiveRecurringMovement: true,
  hasHomeProfile: false,
} as const;

describe("Overview page help", () => {
  it("follows the first-use path from an empty Overview", () => {
    expect(buildOverviewHelpSnapshot({ ...readyInput, activeAccountCount: 0, totalPeriodCount: 0, hasCurrentBalance: false, hasActiveRecurringMovement: false }).action).toEqual({ label: "Create main account", href: "/accounts" });
    expect(buildOverviewHelpSnapshot({ ...readyInput, totalPeriodCount: 0, hasCurrentBalance: false, hasActiveRecurringMovement: false }).action).toEqual({ label: "Set up Cash Flow rhythm", href: "/cash-flow" });
    expect(buildOverviewHelpSnapshot({ ...readyInput, hasCurrentBalance: false, hasActiveRecurringMovement: false }).action).toEqual({ label: "Record current balance", href: "/accounts" });
    expect(buildOverviewHelpSnapshot({ ...readyInput, hasActiveRecurringMovement: false }).action).toEqual({ label: "Add recurring income or expense", href: "/cash-flow/recurring?first=1" });
  });

  it("routes a ready Overview to the projection without making Home required", () => {
    const snapshot = buildOverviewHelpSnapshot(readyInput);

    expect(snapshot.action).toEqual({ label: "Review current projection", href: "/cash-flow" });
    expect(snapshot.items).toContainEqual({ label: "Home profile", value: "Optional" });
  });
});
