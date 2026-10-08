// @vitest-environment jsdom

import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { changeInput, click, createDomTestRoot } from "../../test/dom";
import { HomeMobileDisclosure } from "./home-mobile-disclosure";
import { HomeMobileSubdisclosure } from "./home-mobile-subdisclosure";

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


describe("Home mobile disclosures", () => {
  beforeEach(() => stubViewport(false));

  it("preserves user toggles until the default-open state changes", async () => {
    const disclosure = (defaultOpen: boolean, title = "Household expenses") => (
      <HomeMobileDisclosure eyebrow="Recurring costs" title={title} meta="3 active" defaultOpen={defaultOpen}>
        <p>Disclosure content</p>
      </HomeMobileDisclosure>
    );

    await dom.render(disclosure(false));
    expect(dom.get<HTMLElement>(".home-mobile-disclosure").dataset.open).toBe("false");
    await click(dom.get<HTMLButtonElement>(".home-mobile-disclosure-trigger"));
    expect(dom.get<HTMLElement>(".home-mobile-disclosure").dataset.open).toBe("true");

    await dom.render(disclosure(false, "Updated household expenses"));
    expect(dom.get<HTMLElement>(".home-mobile-disclosure").dataset.open).toBe("true");

    await dom.render(disclosure(true));
    expect(dom.get<HTMLElement>(".home-mobile-disclosure").dataset.open).toBe("true");
    await click(dom.get<HTMLButtonElement>(".home-mobile-disclosure-trigger"));
    await dom.render(disclosure(false));
    expect(dom.get<HTMLElement>(".home-mobile-disclosure").dataset.open).toBe("false");
  });

  it("keeps children unmounted on compact viewports until the disclosure opens", async () => {
    stubViewport(true);
    await dom.render(
      <HomeMobileDisclosure eyebrow="Recurring costs" title="Household expenses" meta="3 active">
        <p>Disclosure content</p>
      </HomeMobileDisclosure>,
    );

    expect(dom.container.querySelector(".home-mobile-disclosure")).not.toBeNull();
    expect(dom.container.querySelector(".home-mobile-disclosure-body")).not.toBeNull();
    expect(dom.container.querySelector(".home-mobile-disclosure-body p")).toBeNull();

    await click(dom.get<HTMLButtonElement>(".home-mobile-disclosure-trigger"));

    expect(dom.get<HTMLElement>(".home-mobile-disclosure").dataset.open).toBe("true");
    expect(dom.container.querySelector(".home-mobile-disclosure-body p")?.textContent).toBe("Disclosure content");
  });

  it("keeps once-opened children mounted so compact closures preserve unsaved input", async () => {
    stubViewport(true);
    await dom.render(
      <HomeMobileDisclosure eyebrow="Recurring costs" title="Household expenses" meta="3 active">
        <input name="note" defaultValue="" />
      </HomeMobileDisclosure>,
    );

    await click(dom.get<HTMLButtonElement>(".home-mobile-disclosure-trigger"));
    await changeInput(dom.get<HTMLInputElement>(".home-mobile-disclosure-body input"), "Unsaved note");
    await click(dom.get<HTMLButtonElement>(".home-mobile-disclosure-trigger"));

    expect(dom.get<HTMLElement>(".home-mobile-disclosure").dataset.open).toBe("false");
    expect(dom.get<HTMLInputElement>(".home-mobile-disclosure-body input").value).toBe("Unsaved note");
  });

  it("always mounts children on wide viewports even while closed", async () => {
    await dom.render(
      <HomeMobileDisclosure eyebrow="Recurring costs" title="Household expenses" meta="3 active">
        <p>Disclosure content</p>
      </HomeMobileDisclosure>,
    );

    expect(dom.get<HTMLElement>(".home-mobile-disclosure").dataset.open).toBe("false");
    expect(dom.container.querySelector(".home-mobile-disclosure-body p")?.textContent).toBe("Disclosure content");
  });

  it("resets nested disclosure state when its default-open intent changes", async () => {
    const disclosure = (defaultOpen: boolean, title = "Edit maintenance item") => (
      <HomeMobileSubdisclosure eyebrow="Manage" title={title} meta="Editing" defaultOpen={defaultOpen}>
        <p>Nested editor content</p>
      </HomeMobileSubdisclosure>
    );

    await dom.render(disclosure(true));
    expect(dom.get<HTMLElement>(".home-mobile-subdisclosure").dataset.open).toBe("true");
    await click(dom.get<HTMLButtonElement>(".home-mobile-subdisclosure-trigger"));
    expect(dom.get<HTMLElement>(".home-mobile-subdisclosure").dataset.open).toBe("false");

    await dom.render(disclosure(true, "Edit another item"));
    expect(dom.get<HTMLElement>(".home-mobile-subdisclosure").dataset.open).toBe("false");

    await dom.render(disclosure(false));
    expect(dom.get<HTMLElement>(".home-mobile-subdisclosure").dataset.open).toBe("false");
    await dom.render(disclosure(true));
    expect(dom.get<HTMLElement>(".home-mobile-subdisclosure").dataset.open).toBe("true");
  });
});
