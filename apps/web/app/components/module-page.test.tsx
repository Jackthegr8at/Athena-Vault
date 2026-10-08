import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CASH_FLOW_PAGE_HELP_CONTENT } from "./page-help-content";

vi.stubGlobal("React", React);

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(async () => null),
  getPrimaryOwnerId: vi.fn(async () => null),
  getServerDatabase: vi.fn(() => ({})),
  usePathname: vi.fn(() => "/cash-flow"),
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() })),
}));

vi.mock("../../lib/server/auth-session", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("../../lib/server/auth-setup", () => ({ getPrimaryOwnerId: mocks.getPrimaryOwnerId }));
vi.mock("../../lib/server/database", () => ({ getServerDatabase: mocks.getServerDatabase }));
vi.mock("next/navigation", () => ({ usePathname: mocks.usePathname, useRouter: mocks.useRouter }));

import { ModulePage } from "./module-page";

const help = {
  content: CASH_FLOW_PAGE_HELP_CONTENT,
  snapshot: { items: [{ label: "Active accounts", value: "2" }], action: { label: "Review projection", href: "/cash-flow" } },
};

describe("ModulePage page-help integration", () => {
  it("renders the optional help trigger and header action in the existing top-right composition", async () => {
    const element = await ModulePage({
      active: "Cash flow",
      eyebrow: "Cash flow",
      title: "Cash Flow",
      subtitle: "Plan the next pay periods.",
      pageArtwork: "cash-flow",
      headerAction: <button type="button">Add movement</button>,
      help,
      pageHelpSeen: true,
      children: <p>Cash flow content</p>,
    });
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain('class="top-actions"');
    expect(markup).toContain('aria-label="Open Cash Flow help"');
    expect(markup).toContain('class="topbar-header-action"');
    expect(markup).toContain("Add movement");
    expect(markup).toContain("Cash flow content");
    expect(markup).toContain("Log out");
    expect(markup).toContain('class="main module-page-art module-page-art-cash-flow"');
  });

  it("omits the topbar while preserving children when the content header mode is selected", async () => {
    const element = await ModulePage({
      active: "Accounts",
      eyebrow: "Accounts",
      title: "Accounts",
      subtitle: "Track balances.",
      headerMode: "content",
      children: <p>Headerless content</p>,
    });
    const markup = renderToStaticMarkup(element);

    expect(markup).not.toContain('class="topbar"');
    expect(markup).toContain("Headerless content");
    expect(markup).toContain('class="mobile-nav"');
    expect(markup).not.toContain("module-page-art");
  });
});
