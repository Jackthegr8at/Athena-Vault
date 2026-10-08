// @vitest-environment jsdom

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { click, createDomTestRoot } from "../../test/dom";

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(() => "/cash-flow/recurring"),
  useRouter: vi.fn(() => ({ replace: vi.fn(), refresh: vi.fn() })),
}));
vi.mock("next/navigation", () => ({ usePathname: mocks.usePathname, useRouter: mocks.useRouter }));

import { AppMobileNav } from "./app-mobile-nav";
import { AppSidebar } from "./app-shell";

const dom = createDomTestRoot();

describe("AppShell navigation groups", () => {
  it("exposes Shared Expenses and the Cash flow recurring sublink in rendered navigation", async () => {
    await dom.render(<AppSidebar active="Cash flow" />);

    const shared = dom.get<HTMLAnchorElement>('a[href="/shared-expenses"]');
    expect(shared.textContent).toContain("Shared Expenses");
    expect(dom.get(".nav-group").querySelector(".nav-subnav")?.getAttribute("aria-label")).toBe("Cash flow sections");
    const recurring = dom.get<HTMLAnchorElement>('a[href="/cash-flow/recurring"]');
    expect(recurring.textContent).toContain("Recurring payments");
    expect(recurring.classList.contains("active")).toBe(true);
    expect(recurring.getAttribute("aria-current")).toBe("page");
  });

  it("opens the compact More navigation menu with the same active state", async () => {
    await dom.render(<AppMobileNav active="Shared Expenses" isAdmin={false} />);

    const toggle = dom.get<HTMLButtonElement>('button[aria-label="More navigation"]');
    expect(dom.container.querySelector("#mobile-more-menu")).toBeNull();
    await click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const shared = dom.get<HTMLAnchorElement>('#mobile-more-menu a[href="/shared-expenses"]');
    expect(shared.classList.contains("active")).toBe(true);
    expect(dom.get("#mobile-more-menu").textContent).toContain("Shared Expenses");
  });
});
