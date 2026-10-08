import { describe, expect, it } from "vitest";
import { buildInvestmentsHelpSnapshot } from "./presentation";

const calculator = {
  mode: "calculator" as const,
  accountCount: 0,
  accountSchedules: [],
  rates: [{ id: "rate-1", rateBps: 500, displayOrder: 0 }],
  warnings: [],
};

const portfolio = {
  mode: "portfolio" as const,
  accountCount: 1,
  accountSchedules: [{ id: "schedule-1" }],
  rates: [{ id: "rate-1", rateBps: 500, displayOrder: 0 }],
  warnings: [],
};

describe("Investments page help presentation", () => {
  it("guides an empty workspace to create its first projection", () => {
    expect(buildInvestmentsHelpSnapshot({ projects: [], investmentAccountCount: 0, rdspAccountCount: 0, holdingCount: 0 })).toEqual({
      items: [
        { label: "REEI / RDSP accounts", value: "0" },
        { label: "Current holdings", value: "0" },
        { label: "Projection projects", value: "0" },
        { label: "Calculator plans", value: "0" },
        { label: "Portfolio plans", value: "0" },
        { label: "Investment accounts", value: "0" },
        { label: "Contribution schedules", value: "0" },
        { label: "Plans needing review", value: "0" },
      ],
      action: { label: "Create first projection", href: "/investments" },
    });
  });

  it("summarizes calculator and portfolio inputs without exposing financial values", () => {
    expect(buildInvestmentsHelpSnapshot({ projects: [calculator, portfolio], investmentAccountCount: 2, rdspAccountCount: 1, holdingCount: 3 })).toEqual({
      items: [
        { label: "REEI / RDSP accounts", value: "1" },
        { label: "Current holdings", value: "3" },
        { label: "Projection projects", value: "2" },
        { label: "Calculator plans", value: "1" },
        { label: "Portfolio plans", value: "1" },
        { label: "Investment accounts", value: "2" },
        { label: "Contribution schedules", value: "1" },
        { label: "Plans needing review", value: "0" },
      ],
      action: { label: "Review projections", href: "/investments" },
    });
  });

  it("routes portfolio gaps toward accounts or schedules", () => {
    expect(buildInvestmentsHelpSnapshot({ projects: [{ ...portfolio, accountCount: 0, accountSchedules: [] }], investmentAccountCount: 0 }).action).toEqual({ label: "Configure investment accounts", href: "/accounts" });
    expect(buildInvestmentsHelpSnapshot({ projects: [{ ...portfolio, accountSchedules: [] }], investmentAccountCount: 1 }).action).toEqual({ label: "Review contribution schedules", href: "/investments" });
  });
});
