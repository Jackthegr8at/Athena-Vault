// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { changeInput, createDomTestRoot } from "../../test/dom";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  acceptInvitationAction: vi.fn(),
  signInEmail: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => mocks }));
vi.mock("./actions", () => ({ acceptInvitationAction: mocks.acceptInvitationAction }));
vi.mock("../../lib/auth-client", () => ({ authClient: { signIn: { email: mocks.signInEmail } } }));

import { AcceptInviteForm } from "./accept-invite-form";

const dom = createDomTestRoot();

describe("AcceptInviteForm", () => {
  it("pushes the new account route and refreshes server data after accepting an invitation", async () => {
    mocks.push.mockClear();
    mocks.refresh.mockClear();
    mocks.acceptInvitationAction.mockResolvedValue(undefined);
    mocks.signInEmail.mockResolvedValue({ error: null });
    await dom.render(<AcceptInviteForm initialToken="" />);
    await changeInput(dom.get<HTMLInputElement>('input[name="email"]'), "new-owner@example.test");
    await changeInput(dom.get<HTMLInputElement>('input[name="displayName"]'), "New owner");

    await act(async () => {
      dom.get<HTMLFormElement>("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(mocks.acceptInvitationAction).toHaveBeenCalledWith({ token: "", email: "new-owner@example.test", password: "", displayName: "New owner" });
    expect(mocks.push).toHaveBeenCalledWith("/");
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
});
