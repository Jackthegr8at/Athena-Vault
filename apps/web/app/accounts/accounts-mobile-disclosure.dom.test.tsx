// @vitest-environment jsdom

import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { changeInput, click, createDomTestRoot } from "../../test/dom";
import { AccountsMobileDisclosure } from "./accounts-mobile-disclosure";

const dom = createDomTestRoot();

function stubViewport(compact: boolean) {
  vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
    matches: compact ? query === "(max-width: 720px)" : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}

describe("Accounts mobile disclosure", () => {
  beforeEach(() => stubViewport(false));

  it("keeps children unmounted on compact viewports until the disclosure opens", async () => {
    stubViewport(true);
    await dom.render(
      <AccountsMobileDisclosure eyebrow="SETTINGS" title="Manage accounts" meta="Edit">
        <p>Disclosure content</p>
      </AccountsMobileDisclosure>,
    );

    expect(dom.get<HTMLElement>(".accounts-mobile-disclosure").dataset.open).toBe("false");
    expect(dom.container.querySelector(".accounts-mobile-disclosure-body")).not.toBeNull();
    expect(dom.container.querySelector(".accounts-mobile-disclosure-body p")).toBeNull();

    await click(dom.get<HTMLButtonElement>(".accounts-mobile-disclosure-trigger"));

    expect(dom.get<HTMLElement>(".accounts-mobile-disclosure").dataset.open).toBe("true");
    expect(dom.container.querySelector(".accounts-mobile-disclosure-body p")?.textContent).toBe("Disclosure content");
  });

  it("keeps once-opened children mounted so compact closures preserve unsaved input", async () => {
    stubViewport(true);
    await dom.render(
      <AccountsMobileDisclosure eyebrow="SETTINGS" title="Manage accounts" meta="Edit">
        <input name="note" defaultValue="" />
      </AccountsMobileDisclosure>,
    );

    await click(dom.get<HTMLButtonElement>(".accounts-mobile-disclosure-trigger"));
    await changeInput(dom.get<HTMLInputElement>(".accounts-mobile-disclosure-body input"), "Unsaved note");
    await click(dom.get<HTMLButtonElement>(".accounts-mobile-disclosure-trigger"));

    expect(dom.get<HTMLElement>(".accounts-mobile-disclosure").dataset.open).toBe("false");
    expect(dom.get<HTMLInputElement>(".accounts-mobile-disclosure-body input").value).toBe("Unsaved note");
  });

  it("always mounts children on wide viewports even while closed", async () => {
    await dom.render(
      <AccountsMobileDisclosure eyebrow="BREAKDOWN" title="Category breakdown" meta="Dollars">
        <p>Disclosure content</p>
      </AccountsMobileDisclosure>,
    );

    expect(dom.get<HTMLElement>(".accounts-mobile-disclosure").dataset.open).toBe("false");
    expect(dom.container.querySelector(".accounts-mobile-disclosure-body p")?.textContent).toBe("Disclosure content");
  });

  it("gates the advanced variant body the same way", async () => {
    stubViewport(true);
    await dom.render(
      <AccountsMobileDisclosure variant="advanced" title="Open full timeline editor" meta="Edit">
        <p>Editor content</p>
      </AccountsMobileDisclosure>,
    );

    expect(dom.container.querySelector(".accounts-mobile-advanced-body p")).toBeNull();
    await click(dom.get<HTMLButtonElement>(".accounts-mobile-advanced-trigger"));
    expect(dom.container.querySelector(".accounts-mobile-advanced-body p")?.textContent).toBe("Editor content");
  });
});
