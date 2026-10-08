import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, vi } from "vitest";

// Vitest's existing TSX transform is classic; production Next uses automatic JSX.
export function createDomTestRoot() {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  return {
    async render(node: ReactNode) {
      await act(async () => {
        root.render(node);
      });
    },
    async unmount() {
      await act(async () => {
        root.unmount();
      });
    },
    get container() { return container; },
    get<T extends Element>(selector: string): T {
      const element = container.querySelector<T>(selector);
      if (!element) throw new Error(`Missing test element: ${selector}`);
      return element;
    },
  };
}

export async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
}

export async function changeInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    // Bypass React's value tracker to dispatch the same change as native typing.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Missing native input setter");
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export async function changeSelect(select: HTMLSelectElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    if (!setter) throw new Error("Missing native select setter");
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
