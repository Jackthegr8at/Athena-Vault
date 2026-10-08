// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("../../lib/server/auth-session", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));

import SecurityPage from "./page";

async function renderSecurityPage(): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(await SecurityPage());
  return container;
}

function twoFactorRow(container: ParentNode): HTMLElement {
  const row = Array.from(container.querySelectorAll<HTMLElement>(".public-security-status-list > div"))
    .find((entry) => entry.querySelector("strong")?.textContent === "Two-factor authentication");
  if (!row) throw new Error("Missing two-factor status row");
  return row;
}

describe("public security page", () => {
  it("renders for anonymous visitors with a Login return action and optimized brand image", async () => {
    mocks.getAuthenticatedUser.mockResolvedValueOnce(null);
    const page = await renderSecurityPage();

    expect(page.querySelector("h1#public-security-title")?.textContent).toContain("Your financial workspace,");
    expect(page.querySelector(".public-security-protection-grid")?.textContent).toContain("Protected authentication");
    expect(page.querySelector(".public-security-status-list")?.textContent).toContain("Not configured");
    expect(page.querySelector(".public-security-status-list")?.textContent).toContain("Password protection");
    expect(page.querySelector(".public-security-status-list")?.textContent).toContain("Content security");
    expect(page.querySelector(".public-security-status-list")?.textContent).toContain("without sending the password itself");
    expect(page.querySelector(".public-security-status-list")?.textContent).toContain("fresh security nonce");
    expect(twoFactorRow(page).querySelector(".public-security-status")?.textContent).toBe("Available");
    expect(twoFactorRow(page).textContent).toContain("Add an authenticator app from Account settings");
    expect(page.querySelector<HTMLAnchorElement>(".public-security-return")?.getAttribute("href")).toBe("/login");
    expect(page.querySelectorAll('a[href="/settings"]')).toHaveLength(0);

    const wordmark = page.querySelector<HTMLImageElement>("a.public-security-brand img");
    expect(wordmark?.getAttribute("src")).toBe("/brand/athena-vault-wordmark.svg");
    expect(wordmark?.getAttribute("alt")).toBe("Athena Vault");
    expect(wordmark?.getAttribute("width")).toBe("220");
    expect(wordmark?.getAttribute("height")).toBe("59");
    expect(wordmark?.getAttribute("data-next-image")).toBe("true");
    expect(page.querySelector("svg.animated-line-background--public-security")).not.toBeNull();
  });

  it("renders a Settings return action for authenticated visitors", async () => {
    mocks.getAuthenticatedUser.mockResolvedValueOnce({ authUserId: "auth-user", session: { id: "session" }, owner: { id: "owner" }, twoFactorEnabled: false });
    const page = await renderSecurityPage();

    expect(page.querySelector<HTMLAnchorElement>(".public-security-return")?.getAttribute("href")).toBe("/settings");
    expect(page.querySelector(".public-security-return")?.textContent).toBe("Back to Settings");
  });

  it("shows enabled TOTP for an enrolled authenticated account", async () => {
    mocks.getAuthenticatedUser.mockResolvedValueOnce({ authUserId: "auth-user", session: { id: "session" }, owner: { id: "owner" }, twoFactorEnabled: true });
    const page = await renderSecurityPage();

    const status = twoFactorRow(page).querySelector<HTMLElement>(".public-security-status");
    expect(status?.classList.contains("is-enabled")).toBe(true);
    expect(status?.textContent).toBe("Enabled");
    expect(twoFactorRow(page).textContent).toContain("Your authenticator app or a backup code is required after your password");
    expect(twoFactorRow(page).querySelector(".is-available")).toBeNull();
  });
});
