// @vitest-environment jsdom

import React, { type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isFirstRun: vi.fn(),
  getDemoAccessPresentation: vi.fn(),
  headers: vi.fn(),
  cookies: vi.fn(),
  redirect: vi.fn(),
  signInEmail: vi.fn(async () => ({ error: null, data: null })),
  verifyTotp: vi.fn(async () => ({ error: null })),
  verifyBackupCode: vi.fn(async () => ({ error: null })),
}));

vi.mock("../../lib/server/auth-setup", () => ({ isFirstRun: mocks.isFirstRun }));
vi.mock("../../lib/server/demo-access", () => ({ getDemoAccessPresentation: mocks.getDemoAccessPresentation }));
vi.mock("../../lib/server/demo-csrf", () => ({
  DEMO_CSRF_COOKIE_NAME: "athena_demo_csrf",
  DEMO_CSRF_REQUEST_HEADER: "x-athena-demo-csrf",
}));
vi.mock("next/headers", () => ({ headers: mocks.headers, cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("../../lib/auth-client", () => ({
  authClient: { signIn: { email: mocks.signInEmail }, twoFactor: { verifyTotp: mocks.verifyTotp, verifyBackupCode: mocks.verifyBackupCode } },
}));

import { DemoAccessCard } from "./demo-access-card";
import { LoginForm } from "./login-form";
import LoginPage from "./page";

function findElement(node: ReactNode, type: unknown): ReactElement | null {
  for (const child of React.Children.toArray(node)) {
    if (!React.isValidElement(child)) continue;
    if (child.type === type) return child;
    const nested = findElement((child.props as { readonly children?: ReactNode }).children, type);
    if (nested) return nested;
  }
  return null;
}

function renderPage(page: ReactElement): HTMLDivElement {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(page);
  return container;
}

describe("login route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    mocks.isFirstRun.mockResolvedValue(false);
    mocks.getDemoAccessPresentation.mockReturnValue(null);
    mocks.headers.mockResolvedValue({ get: vi.fn(() => null) });
    mocks.cookies.mockResolvedValue({ get: vi.fn(() => undefined) });
    mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); });
  });

  it("renders the optimized brand image and passes only a safe internal destination to LoginForm", async () => {
    const page = await LoginPage({ searchParams: Promise.resolve({ next: "//attacker.example/accounts" }) });
    const form = findElement(page, LoginForm) as ReactElement<{ readonly nextPath: string }> | null;
    expect(form?.props.nextPath).toBe("/");

    const rendered = renderPage(page);
    expect(rendered.querySelector("main.auth-page")).not.toBeNull();
    const wordmark = rendered.querySelector<HTMLImageElement>("img.auth-brand-wordmark");
    expect(wordmark?.getAttribute("src")).toBe("/brand/athena-vault-wordmark.svg");
    expect(wordmark?.getAttribute("width")).toBe("300");
    expect(wordmark?.getAttribute("height")).toBe("81");
    expect(wordmark?.getAttribute("alt")).toBe("Athena Vault");
    expect(wordmark?.getAttribute("data-next-image")).toBe("true");
    expect(Array.from(rendered.querySelectorAll("img")).every((image) => !image.getAttribute("src")?.includes("mockup/"))).toBe(true);
    expect(mocks.getDemoAccessPresentation).toHaveBeenCalledOnce();
    expect(mocks.headers).not.toHaveBeenCalled();
    expect(mocks.cookies).not.toHaveBeenCalled();
  });

  it("keeps the shared demo read-only and posts only to its dedicated endpoint", async () => {
    mocks.getDemoAccessPresentation.mockReturnValue({ identifier: "demo@example.test" });
    const nextPath = "/cash-flow?period=current";
    const page = await LoginPage({ searchParams: Promise.resolve({ next: nextPath }) });
    const card = findElement(page, DemoAccessCard) as ReactElement<{ readonly identifier: string; readonly nextPath: string; readonly csrfToken: string | null }> | null;
    expect(card?.props).toEqual({ identifier: "demo@example.test", nextPath, csrfToken: null });

    const rendered = renderPage(page);
    const demoCard = rendered.querySelector<HTMLElement>(".login-demo-card");
    expect(demoCard?.textContent).toContain("Explore a read-only workspace");
    expect(demoCard?.textContent).toContain("Changes to financial records, settings, and the shared fixture are blocked.");
    expect(demoCard?.textContent).toContain("Shared account · read-only · no personal data · no password entry");
    const form = demoCard?.querySelector<HTMLFormElement>("form.login-demo-form");
    expect(form?.getAttribute("method")).toBe("post");
    expect(form?.getAttribute("action")).toBe("/api/demo/sign-in");
    expect(form?.querySelector<HTMLInputElement>('input[name="next"]')?.value).toBe(nextPath);
    expect(form?.querySelector('input[name="password"], input[type="password"]')).toBeNull();
    expect(form?.querySelector('input[name="demoCsrfToken"]')).toBeNull();
    expect(mocks.headers).toHaveBeenCalledOnce();
    expect(mocks.cookies).toHaveBeenCalledOnce();
  });

  it("redirects first-run users to setup before presenting Login", async () => {
    mocks.isFirstRun.mockResolvedValueOnce(true);

    await expect(LoginPage({})).rejects.toThrow("redirect:/setup");

    expect(mocks.redirect).toHaveBeenCalledWith("/setup");
    expect(mocks.getDemoAccessPresentation).not.toHaveBeenCalled();
  });
});
