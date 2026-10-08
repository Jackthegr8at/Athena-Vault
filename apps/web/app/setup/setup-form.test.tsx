// @vitest-environment jsdom

import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
  signInEmail: vi.fn(),
}));

vi.mock("../../lib/auth-client", () => ({
  authClient: { signIn: { email: mocks.signInEmail } },
}));
vi.mock("./actions", () => ({ setupFirstUserAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks }));

import { SetupForm } from "./setup-form";
import { createDomTestRoot } from "../../test/dom";
import { setupFirstUserAction } from "./actions";

const dom = createDomTestRoot();

describe("setup form", () => {
  it("uses POST for no-JavaScript fallback", () => {
    const markup = renderToStaticMarkup(React.createElement(SetupForm, { setupTokenRequired: false }));

    expect(markup).toMatch(/<form[^>]*method="post"/);
  });

  it("does not render a token field for tokenless setup", () => {
    const markup = renderToStaticMarkup(React.createElement(SetupForm, { setupTokenRequired: false }));

    expect(markup).not.toContain('name="setupToken"');
  });

  it("uses the shared authentication input shells and submit styling", () => {
    const markup = renderToStaticMarkup(React.createElement(SetupForm, { setupTokenRequired: false }));

    expect(markup).toContain("login-input-shell");
    expect(markup).toContain("login-submit-button");
    expect(markup).not.toContain("account-primary-button");
  });

  it("renders a required password-style token field when configured", () => {
    const markup = renderToStaticMarkup(React.createElement(SetupForm, { setupTokenRequired: true }));

    expect(markup).toContain('name="setupToken"');
    expect(markup).toContain('type="password"');
    expect(markup).toContain('required=""');
  });

  it("replaces setup history and refreshes the authenticated route after first-user creation", async () => {
    mocks.replace.mockClear();
    mocks.refresh.mockClear();
    mocks.signInEmail.mockResolvedValue({ error: null });
    await dom.render(React.createElement(SetupForm, { setupTokenRequired: false }));
    await act(async () => {
      dom.get<HTMLFormElement>("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(setupFirstUserAction).toHaveBeenCalledWith({ email: "", password: "", displayName: "", setupToken: "" });
    expect(mocks.replace).toHaveBeenCalledWith("/");
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
});
