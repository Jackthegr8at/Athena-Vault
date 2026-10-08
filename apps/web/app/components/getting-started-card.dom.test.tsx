// @vitest-environment jsdom

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { click, createDomTestRoot } from "../../test/dom";
import type { OnboardingActionState, OnboardingSnapshot } from "../onboarding-types";

const actions = vi.hoisted(() => ({
  updateOnboardingStateAction: vi.fn(async (): Promise<OnboardingActionState> => ({ ok: false, message: "", state: null })),
}));

vi.mock("../onboarding-actions", () => actions);

import { GettingStartedCard } from "./getting-started-card";

const activeSnapshot: OnboardingSnapshot = {
  state: "active",
  account: false,
  balance: false,
  recurring: false,
  completedCount: 0,
  nextStepId: "account",
};
const dom = createDomTestRoot();

describe("GettingStartedCard visibility", () => {
  it("shows the restored active guide after a local hide and refreshed state changes", async () => {
    actions.updateOnboardingStateAction.mockReset();
    actions.updateOnboardingStateAction.mockResolvedValue({ ok: false, message: "", state: null });
    actions.updateOnboardingStateAction.mockResolvedValueOnce({ ok: true, message: "", state: "dismissed" });
    await dom.render(<GettingStartedCard snapshot={activeSnapshot} />);
    expect(dom.container.querySelector(".getting-started-card")).not.toBeNull();

    await click(dom.get<HTMLButtonElement>(".getting-started-hide-guide"));
    expect(dom.container.querySelector(".getting-started-card")).toBeNull();
    expect(dom.container.querySelector(".getting-started-compact")).toBeNull();

    await dom.render(<GettingStartedCard snapshot={{ ...activeSnapshot, state: "dismissed" }} />);
    expect(dom.container.querySelector(".getting-started-card")).toBeNull();
    expect(dom.container.querySelector(".getting-started-compact")).toBeNull();

    await dom.render(<GettingStartedCard snapshot={activeSnapshot} />);
    expect(dom.container.querySelector(".getting-started-compact")).not.toBeNull();

    await click(dom.get<HTMLButtonElement>(".getting-started-compact button"));
    expect(dom.container.querySelector(".getting-started-card")).not.toBeNull();
  });

  it("restores the compact guide after a failed hide action", async () => {
    actions.updateOnboardingStateAction.mockReset();
    actions.updateOnboardingStateAction.mockResolvedValue({ ok: false, message: "Could not update the guide.", state: null });
    await dom.render(<GettingStartedCard snapshot={activeSnapshot} />);
    await click(dom.get<HTMLButtonElement>(".getting-started-hide-guide"));

    expect(actions.updateOnboardingStateAction).toHaveBeenCalledOnce();
    expect(dom.container.querySelector(".getting-started-compact")).not.toBeNull();
    expect(dom.container.textContent).toContain("Could not update the guide.");
  });
});
