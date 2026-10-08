// @vitest-environment jsdom

import React, { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOGIN_CONNECTED_STORAGE_KEY, LoginGreeting, markLoginConnected } from "./login-greeting";

let container: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.removeItem(LOGIN_CONNECTED_STORAGE_KEY);
  container = document.createElement("div");
  document.body.append(container);
  root = null;
});

afterEach(async () => {
  if (root) await act(async () => { root?.unmount(); });
  container.remove();
  localStorage.removeItem(LOGIN_CONNECTED_STORAGE_KEY);
  vi.unstubAllGlobals();
});

describe("LoginGreeting hydration", () => {
  it("keeps the server greeting stable, then reads the returning-visitor marker after hydration", async () => {
    localStorage.setItem(LOGIN_CONNECTED_STORAGE_KEY, "1");
    const serverMarkup = renderToString(<LoginGreeting />);
    expect(serverMarkup).toContain(">Welcome</p>");
    expect(serverMarkup).not.toContain("Welcome back");

    container.innerHTML = serverMarkup;
    await act(async () => {
      root = hydrateRoot(container, <LoginGreeting />);
    });

    expect(container.textContent).toBe("Welcome back");
  });

  it("updates when the login marker changes in the same tab or another tab", async () => {
    container.innerHTML = renderToString(<LoginGreeting />);
    await act(async () => {
      root = hydrateRoot(container, <LoginGreeting />);
    });
    expect(container.textContent).toBe("Welcome");

    await act(async () => { markLoginConnected(); });
    expect(container.textContent).toBe("Welcome back");

    localStorage.removeItem(LOGIN_CONNECTED_STORAGE_KEY);
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: LOGIN_CONNECTED_STORAGE_KEY, newValue: null }));
    });
    expect(container.textContent).toBe("Welcome");
  });
});
