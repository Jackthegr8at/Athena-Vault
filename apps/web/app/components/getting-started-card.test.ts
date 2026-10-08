import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../onboarding-actions", () => ({
  updateOnboardingStateAction: vi.fn(async () => ({ ok: false, message: "", state: null })),
}));

import { GettingStartedCard } from "./getting-started-card";
import type { OnboardingSnapshot } from "../onboarding-types";

vi.stubGlobal("React", React);

const activeSnapshot: OnboardingSnapshot = {
  state: "active",
  account: false,
  balance: false,
  recurring: false,
  completedCount: 0,
  nextStepId: "account",
};

describe("Getting Started card", () => {
  it("renders a non-blocking guide with real product routes and explicit completion controls", () => {
    const markup = renderToStaticMarkup(React.createElement(GettingStartedCard, { snapshot: activeSnapshot }));

    expect(markup).toContain("Build your financial starting point");
    expect(markup).toContain('href="/accounts"');
    expect(markup).toContain("Add recurring income or expense");
    expect(markup).toContain('href="/cash-flow"');
    expect(markup).toContain('href="/goals"');
    expect(markup).toContain('href="/home"');
    expect(markup).toContain('href="/investments"');
    expect(markup).toContain('href="/annual-expenses"');
    expect(markup).toContain('href="/shared-expenses"');
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-valuenow="0"');
    expect(markup).toContain('name="state" value="completed"');
    expect(markup).toContain('name="state" value="dismissed"');
    expect(markup).toContain("Hide guide");
    expect(markup).toContain("getting-started-card-footer");
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("animated-line-background--getting-started");
  });

  it("hides the guide completely after a dismissed snapshot", () => {
    const markup = renderToStaticMarkup(React.createElement(GettingStartedCard, { snapshot: { ...activeSnapshot, state: "dismissed" } }));

    expect(markup).not.toContain("Build your financial starting point");
    expect(markup).not.toContain("getting-started-card");
  });
});
