// @vitest-environment jsdom

import React, { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { changeInput, createDomTestRoot } from "../../test/dom";
import { LOGIN_CONNECTED_STORAGE_KEY, LoginGreeting } from "./login-greeting";

const auth = vi.hoisted(() => ({
  email: vi.fn(async (_input: unknown) => ({ error: null as { readonly message: string } | null, data: null as unknown })),
  verifyTotp: vi.fn(async (_input: unknown) => ({ error: null as { readonly message: string } | null, data: null as unknown })),
  verifyBackupCode: vi.fn(async (_input: unknown) => ({ error: null as { readonly message: string } | null, data: null as unknown })),
}));

vi.mock("../../lib/auth-client", () => ({
  authClient: {
    signIn: { email: auth.email },
    twoFactor: { verifyTotp: auth.verifyTotp, verifyBackupCode: auth.verifyBackupCode },
  },
}));

import { LoginForm } from "./login-form";

const dom = createDomTestRoot();

async function submitForm() {
  await act(async () => {
    const form = dom.get<HTMLFormElement>("form.login-form");
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("login form", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem(LOGIN_CONNECTED_STORAGE_KEY);
  });

  it("renders the POST fallback, branded controls, and invitation action", async () => {
    await dom.render(<LoginForm nextPath="/accounts" />);

    const form = dom.get<HTMLFormElement>("form.login-form");
    expect(form.getAttribute("method")).toBe("post");
    expect(form.querySelectorAll(".login-input-shell")).toHaveLength(2);
    expect(form.querySelector<HTMLInputElement>('input[name="email"]')?.placeholder).toBe("Enter your email address");
    expect(form.querySelector<HTMLInputElement>('input[name="password"]')?.placeholder).toBe("Enter your password");
    expect(dom.get<HTMLAnchorElement>("a.login-invite-button").getAttribute("href")).toBe("/invite");
    expect(dom.get<HTMLAnchorElement>("a.login-invite-button").textContent).toContain("Accept an invitation");
  });

  it("marks a returning visitor after successful password sign-in", async () => {
    const onNavigate = vi.fn();
    await dom.render(<><LoginGreeting /><LoginForm nextPath="/accounts" onNavigate={onNavigate} /></>);
    await changeInput(dom.get<HTMLInputElement>('input[name="email"]'), "owner@example.test");
    auth.email.mockResolvedValueOnce({ error: null, data: null });

    await submitForm();

    expect(localStorage.getItem(LOGIN_CONNECTED_STORAGE_KEY)).toBe("1");
    expect(dom.container.textContent).toContain("Welcome back");
    expect(onNavigate).toHaveBeenCalledWith("/accounts");
  });

  it("waits for successful second-factor verification before marking the visitor connected", async () => {
    const onNavigate = vi.fn();
    await dom.render(<><LoginGreeting /><LoginForm nextPath="/accounts" onNavigate={onNavigate} /></>);
    expect(dom.container.textContent).toContain("Welcome");
    expect(localStorage.getItem(LOGIN_CONNECTED_STORAGE_KEY)).toBeNull();

    await changeInput(dom.get<HTMLInputElement>('input[name="email"]'), "owner@example.test");
    auth.email.mockResolvedValueOnce({ error: { message: "Sign-in failed." }, data: null });
    await submitForm();
    expect(dom.container.querySelector('[role="alert"]')?.textContent).toBe("Sign-in failed.");
    expect(localStorage.getItem(LOGIN_CONNECTED_STORAGE_KEY)).toBeNull();

    auth.email.mockResolvedValueOnce({ error: null, data: { twoFactorRedirect: true } });
    await submitForm();
    expect(dom.get<HTMLInputElement>('input[name="twoFactorCode"]').getAttribute("inputmode")).toBe("numeric");
    expect(dom.container.textContent).toContain("Use a backup code");
    expect(localStorage.getItem(LOGIN_CONNECTED_STORAGE_KEY)).toBeNull();

    await act(async () => {
      dom.get<HTMLButtonElement>(".login-two-factor-switch").click();
    });
    expect(dom.get<HTMLInputElement>('input[name="twoFactorCode"]').getAttribute("inputmode")).toBe("text");
    expect(dom.container.textContent).toContain("Backup code");

    await submitForm();
    expect(auth.verifyBackupCode).toHaveBeenCalledOnce();
    expect(localStorage.getItem(LOGIN_CONNECTED_STORAGE_KEY)).toBe("1");
    expect(dom.container.textContent).toContain("Welcome back");
    expect(onNavigate).toHaveBeenCalledWith("/accounts");
  });
});
