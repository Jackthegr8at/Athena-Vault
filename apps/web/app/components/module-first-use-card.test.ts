import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ModuleFirstUseCard } from "./module-first-use-card";

vi.stubGlobal("React", React);

describe("Module first-use card", () => {
  it("renders an accessible first path with optional primary and secondary actions", () => {
    const markup = renderToStaticMarkup(React.createElement(ModuleFirstUseCard, {
      headingId: "accounts-first-use",
      title: "Create your first account",
      description: "Start with the account you want to understand first.",
      actionHref: "/accounts",
      actionLabel: "Add account",
      secondaryHref: "/",
      secondaryLabel: "Back home",
      supportingText: "Your next useful record unlocks the rest of the workspace.",
      seed: "accounts-first-use",
    }));

    expect(markup).toContain('aria-labelledby="accounts-first-use"');
    expect(markup).toContain('id="accounts-first-use"');
    expect(markup).toContain("A clear first path");
    expect(markup).toContain("Create your first account");
    expect(markup).toContain('href="/accounts"');
    expect(markup).toContain('href="/"');
    expect(markup).toContain("animated-line-background--module-first-use");
    expect(markup).toContain("Your next useful record unlocks");
  });

  it("does not render an empty action region when no action is supplied", () => {
    const markup = renderToStaticMarkup(React.createElement(ModuleFirstUseCard, { headingId: "empty", title: "Nothing yet", description: "Add a record when you are ready." }));

    expect(markup).not.toContain("module-first-use-card-actions");
    expect(markup).toContain('aria-labelledby="empty"');
  });
});
