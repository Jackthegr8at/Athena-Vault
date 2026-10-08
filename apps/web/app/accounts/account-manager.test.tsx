// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { changeInput, click, createDomTestRoot } from "../../test/dom";

const mocks = vi.hoisted(() => {
  const idleState = { ok: false, message: "", fieldErrors: {} };
  return {
    createAccountAction: vi.fn(async () => idleState),
    archiveAccountAction: vi.fn(async () => idleState),
    deleteAccountAction: vi.fn(async () => idleState),
    restoreAccountAction: vi.fn(async () => idleState),
    updateAccountAvailableCashAction: vi.fn(async () => idleState),
    updateAccountCashFlowPlannedTimelineAction: vi.fn(async () => idleState),
    updateAccountAction: vi.fn(async () => idleState),
  };
});

vi.mock("./actions", () => mocks);

import { AccountManager, type AccountManagerProps } from "./account-manager";

const presentation = {
  activeAccountCount: 0,
  visibleAccountCount: 0,
  todayIso: "2026-09-08",
  groups: [],
} as unknown as AccountManagerProps["presentation"];

const kindOptions = [
  { code: "checking", label: "Chequing" },
  { code: "rdsp", label: "REEI / RDSP" },
] satisfies AccountManagerProps["kindOptions"];

const dom = createDomTestRoot();

describe("AccountManager create form", () => {
  it("keeps every entered field after the server action returns validation errors", async () => {
    mocks.createAccountAction.mockResolvedValueOnce({
      ok: false,
      message: "Review the highlighted fields.",
      fieldErrors: { name: "Account name is required." },
    });

    await dom.render(React.createElement(AccountManager, { presentation, kindOptions, formPrefix: "account-test" }));

    await changeInput(dom.get<HTMLInputElement>("#account-test-name"), "Reserve");
    await changeInput(dom.get<HTMLInputElement>("#account-test-institution"), "CIBC");
    await changeInput(dom.get<HTMLInputElement>("#account-test-last-four"), "4242");
    await changeInput(dom.get<HTMLInputElement>("#account-test-balance"), "0.00");

    const form = dom.get<HTMLFormElement>("form.account-form");
    const submitEvent = new Event("submit", { bubbles: true, cancelable: true });
    await act(async () => {
      form.dispatchEvent(submitEvent);
    });

    expect(submitEvent.defaultPrevented).toBe(true);
    expect(dom.get<HTMLInputElement>("#account-test-name").value).toBe("Reserve");
    expect(dom.get<HTMLInputElement>("#account-test-institution").value).toBe("CIBC");
    expect(dom.get<HTMLInputElement>("#account-test-last-four").value).toBe("4242");
    expect(dom.get<HTMLInputElement>("#account-test-balance").value).toBe("0.00");
    expect(dom.get<HTMLInputElement>("#account-test-balance-date").value).toBe("2026-09-08");
    expect(dom.get("#account-test-name-error").textContent).toContain("Account name is required.");
  });

  it("closes and resets the optional create form after a successful action", async () => {
    mocks.createAccountAction.mockResolvedValueOnce({
      ok: true,
      message: "Account created.",
      fieldErrors: {},
    });

    const hasAccountPresentation = {
      ...presentation,
      activeAccountCount: 1,
      visibleAccountCount: 1,
    } as AccountManagerProps["presentation"];

    await dom.render(React.createElement(AccountManager, { presentation: hasAccountPresentation, kindOptions, formPrefix: "account-test" }));
    await click(dom.get<HTMLButtonElement>("button.account-add-account-button"));
    await changeInput(dom.get<HTMLInputElement>("#account-test-name"), "Reserve");

    const form = dom.get<HTMLFormElement>("form.account-form");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(dom.container.querySelector("form.account-form")).toBeNull();
    await click(dom.get<HTMLButtonElement>("button.account-add-account-button"));
    expect(dom.get<HTMLInputElement>("#account-test-name").value).toBe("");
  });

  it("switches the last-four field to uppercase alphanumeric input for REEI/RDSP", async () => {
    await dom.render(React.createElement(AccountManager, { presentation, kindOptions, formPrefix: "account-test" }));

    const lastFour = dom.get<HTMLInputElement>("#account-test-last-four");
    expect(lastFour.inputMode).toBe("numeric");
    expect(lastFour.pattern).toBe("[0-9]{4}");
    expect(dom.get("#account-test-last-four-help").textContent).toContain("four digits");

    const kind = dom.get<HTMLButtonElement>("#account-test-kind");
    await click(kind);
    const rdspOption = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]'))
      .find((option) => option.textContent?.includes("REEI / RDSP"));
    expect(rdspOption).toBeDefined();
    if (!rdspOption) throw new Error("Missing REEI / RDSP option");
    await click(rdspOption);

    expect(lastFour.inputMode).toBe("text");
    expect(lastFour.pattern).toBe("[A-Za-z0-9]{4}");
    expect(lastFour.getAttribute("autocapitalize")).toBe("characters");
    expect(dom.get("#account-test-last-four-help").textContent).toContain("letters or numbers");

    await changeInput(lastFour, "a1b2");
    expect(lastFour.value).toBe("A1B2");
  });
});
