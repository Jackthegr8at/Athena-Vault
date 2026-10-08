// @vitest-environment jsdom

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { NetWorthHistoryModel, NetWorthHistoryPoint } from "@athena/finance-engine";
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createDomTestRoot } from "../../test/dom";
import { NetWorthHistoryChart } from "./net-worth-history-chart";
import { stackBandForPoint } from "./net-worth-history-data";
import type * as NwHistoryData from "./net-worth-history-data";
import { chartXForDate, CHART_MARGIN, CHART_WIDTH } from "./net-worth-history-geometry";

const renderSpies = vi.hoisted(() => ({ formatShortDate: vi.fn(), pointAriaLabel: vi.fn() }));
vi.mock("./net-worth-history-data", async (importOriginal) => {
  const actual = await importOriginal<typeof NwHistoryData>();
  return {
    ...actual,
    formatShortDate: (...args: Parameters<typeof actual.formatShortDate>) => {
      renderSpies.formatShortDate(...args);
      return actual.formatShortDate(...args);
    },
    pointAriaLabel: (...args: Parameters<typeof actual.pointAriaLabel>) => {
      renderSpies.pointAriaLabel(...args);
      return actual.pointAriaLabel(...args);
    },
  };
});

vi.stubGlobal("React", React);

const actualPoint: NetWorthHistoryPoint = {
  asOf: "2026-08-01",
  phase: "actual",
  isFirstProjected: false,
  cashOtherMinor: 5_000,
  homeEquityMinor: 17_000,
  investmentsMinor: 15_000,
  netWorthMinor: 38_000,
};

const projectedPoint: NetWorthHistoryPoint = {
  asOf: "2026-10-01",
  phase: "projected",
  isFirstProjected: true,
  cashOtherMinor: 5_500,
  homeEquityMinor: 17_500,
  investmentsMinor: 15_500,
  netWorthMinor: 39_500,
};

const model: NetWorthHistoryModel = {
  currency: "CAD",
  evaluationDate: "2026-09-14",
  historicalFrom: actualPoint.asOf,
  projectedThrough: projectedPoint.asOf,
  firstProjectedAsOf: projectedPoint.asOf,
  selectedRange: "1y",
  defaultRange: "1y",
  points: [actualPoint, { ...actualPoint, asOf: "2026-09-01", netWorthMinor: 38_500, cashOtherMinor: 5_250 }, projectedPoint],
  changes: [],
};

const dom = createDomTestRoot();

describe("NetWorthHistoryChart presentation", () => {
  it("builds stacked display bands with integer minor units", () => {
    expect(stackBandForPoint(actualPoint, "cashOther")).toEqual({ lowerMinor: 0, upperMinor: 5_000 });
    expect(stackBandForPoint(actualPoint, "homeEquity")).toEqual({ lowerMinor: 5_000, upperMinor: 22_000 });
    expect(stackBandForPoint(actualPoint, "investments")).toEqual({ lowerMinor: 22_000, upperMinor: 37_000 });
    expect(stackBandForPoint(actualPoint, "netWorth")).toEqual({ lowerMinor: 37_000, upperMinor: 38_000 });
  });

  it("rejects unsafe stacked money totals", () => {
    const unsafePoint: NetWorthHistoryPoint = {
      ...actualPoint,
      cashOtherMinor: 1,
      homeEquityMinor: 1,
      investmentsMinor: Number.MAX_SAFE_INTEGER,
      netWorthMinor: Number.MAX_SAFE_INTEGER,
    };

    expect(stackBandForPoint(unsafePoint, "investments")).toBeNull();
    expect(stackBandForPoint(unsafePoint, "netWorth")).toBeNull();
  });

  it("renders the approved series, date axis, projected boundary, and composition metrics", () => {
    const markup = renderToStaticMarkup(React.createElement(NetWorthHistoryChart, { model, currentNetWorthMinor: 40_000, currentLiabilitiesMinor: 2_000 }));

    expect(markup).toContain("Total net worth over time");
    expect(markup).toContain('aria-label="Total net worth over time"');
    expect(markup).toContain('aria-label="Projected values begin here"');
    expect(markup).toContain(">Projected</text>");
    expect(markup).toContain("Net worth");
    expect(markup).toContain("Investments");
    expect(markup).toContain("Home equity");
    expect(markup).toContain("Cash / other");
    expect(markup).toContain("net-worth-history-date-axis");
    expect(markup).toContain("net-worth-history-series-line");
    expect(markup).toContain("net-worth-history-area");
    expect(markup).toContain("Total net worth");
    expect(markup).toContain("Liabilities");
    expect(markup).toContain("Accessible summary");
    expect(markup).toContain("Values by date");
    expect(markup).toContain("Change summary");
    expect(markup).toContain("Projected");
  });

  it("anchors the projected boundary to the evaluation date", () => {
    const markup = renderToStaticMarkup(React.createElement(NetWorthHistoryChart, { model, currentNetWorthMinor: 40_000, currentLiabilitiesMinor: 2_000 }));
    const boundaryLine = markup.match(/<g class="net-worth-history-boundary"[^>]*>[\s\S]*?<line[^>]+x1="([^"]+)"/);
    const evaluationX = chartXForDate(model.evaluationDate, model.points, CHART_MARGIN.left, CHART_WIDTH - CHART_MARGIN.right);
    const firstProjectedX = chartXForDate(projectedPoint.asOf, model.points, CHART_MARGIN.left, CHART_WIDTH - CHART_MARGIN.right);

    expect(boundaryLine?.[1]).toBeDefined();
    expect(evaluationX).not.toBeNull();
    expect(firstProjectedX).not.toBeNull();
    expect(Number(boundaryLine?.[1])).toBeCloseTo(evaluationX!);
    expect(Number(boundaryLine?.[1])).not.toBeCloseTo(firstProjectedX!);
  });

  it("keeps the custom tooltip hidden until a keyboard-accessible point is activated", async () => {
    await dom.render(React.createElement(NetWorthHistoryChart, { model, currentNetWorthMinor: 40_000, currentLiabilitiesMinor: 2_000 }));
    expect(dom.container.querySelector(".net-worth-history-chart-tooltip")).toBeNull();

    const point = dom.get(".net-worth-history-point");
    await act(async () => {
      point.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(dom.container.querySelector(".net-worth-history-chart-tooltip")).not.toBeNull();
    expect(dom.container.querySelector(".net-worth-history-point-detail")).not.toBeNull();
  });

  it("resets range and active-point state when the model evaluation changes", async () => {
    await dom.render(React.createElement(NetWorthHistoryChart, { model, currentNetWorthMinor: 40_000, currentLiabilitiesMinor: 2_000 }));
    const point = dom.get(".net-worth-history-point");
    await act(async () => {
      point.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(dom.container.querySelector(".net-worth-history-chart-tooltip")).not.toBeNull();

    const refreshed = { ...model, evaluationDate: "2026-09-15", defaultRange: "6m" as const };
    await dom.render(React.createElement(NetWorthHistoryChart, { model: refreshed, currentNetWorthMinor: 40_000, currentLiabilitiesMinor: 2_000 }));
    expect(dom.container.querySelector(".net-worth-history-chart-tooltip")).toBeNull();
    expect(dom.container.querySelector<HTMLButtonElement>("button[aria-pressed='true']")?.textContent).toBe("6M");
  });

  it("renders explicit empty and unavailable history states", () => {
    const empty = renderToStaticMarkup(React.createElement(NetWorthHistoryChart, { model: null, currentNetWorthMinor: 0, currentLiabilitiesMinor: 0 }));
    expect(empty).toContain("No net-worth history yet");

    const unavailable: NetWorthHistoryModel = {
      ...model,
      points: [{ ...actualPoint, netWorthMinor: null, investmentsMinor: null, homeEquityMinor: null, cashOtherMinor: null }],
    };
    expect(renderToStaticMarkup(React.createElement(NetWorthHistoryChart, { model: unavailable, currentNetWorthMinor: 0, currentLiabilitiesMinor: 0 }))).toContain("History values are unavailable");
  });
});

describe("NetWorthHistoryChart re-render isolation", () => {
  it("re-renders only the tooltip and activated points on hover", async () => {
    await dom.render(React.createElement(NetWorthHistoryChart, { model, currentNetWorthMinor: 40_000, currentLiabilitiesMinor: 2_000 }));
    const points = Array.from(dom.container.querySelectorAll(".net-worth-history-point"));
    expect(points).toHaveLength(3);
    renderSpies.formatShortDate.mockClear();
    renderSpies.pointAriaLabel.mockClear();

    await act(async () => {
      points[2]!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });

    // Tooltip and point detail mount on activation...
    expect(dom.container.querySelector(".net-worth-history-chart-tooltip")).not.toBeNull();
    expect(dom.container.querySelector(".net-worth-history-point-detail")).not.toBeNull();
    // ...but the sr-only values table does not re-render: its formatShortDate
    // calls happen only inside AccessibleValues/ChangeSummary render.
    expect(renderSpies.formatShortDate).not.toHaveBeenCalled();
    // Only the two point groups whose props changed re-render their aria label:
    // the previously focusable first point and the newly activated one.
    expect(renderSpies.pointAriaLabel).toHaveBeenCalledTimes(2);
  });
});
