// @vitest-environment jsdom

import React from "react";
import { describe, expect, it } from "vitest";
import { click, createDomTestRoot } from "../../test/dom";
import { ActionNotification } from "./action-notification";

const dom = createDomTestRoot();

describe("ActionNotification state identity", () => {
  it("reopens for a new action result and keeps errors dismissible", async () => {
    await dom.render(<ActionNotification state={{ ok: true, message: "Saved." }} />);
    expect(dom.get<HTMLElement>("[role='status']").textContent).toContain("Saved.");

    await click(dom.get<HTMLButtonElement>("button[aria-label='Dismiss notification']"));
    expect(dom.container.querySelector(".account-notification")).toBeNull();

    await dom.render(<ActionNotification state={{ ok: true, message: "Saved." }} />);
    expect(dom.get<HTMLElement>("[role='status']").textContent).toContain("Saved.");

    await dom.render(<ActionNotification state={{ ok: false, message: "Could not save." }} />);
    expect(dom.get<HTMLElement>("[role='alert']").textContent).toContain("Could not save.");
    expect(dom.container.querySelector(".account-notification.is-error")).not.toBeNull();
  });
});
