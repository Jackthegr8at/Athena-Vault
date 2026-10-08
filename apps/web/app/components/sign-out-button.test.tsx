// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createDomTestRoot } from "../../test/dom";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => mocks }));
vi.mock("../../lib/auth-client", () => ({ authClient: { signOut: mocks.signOut } }));

import { SignOutButton } from "./sign-out-button";

const dom = createDomTestRoot();

describe("SignOutButton", () => {
  it("replaces authenticated history and refreshes after sign-out", async () => {
    mocks.replace.mockClear();
    mocks.refresh.mockClear();
    mocks.signOut.mockResolvedValue(undefined);
    await dom.render(<SignOutButton />);

    await act(async () => {
      dom.get<HTMLButtonElement>("button.user-menu-logout").click();
      await Promise.resolve();
    });

    expect(mocks.replace).toHaveBeenCalledWith("/login");
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
});
