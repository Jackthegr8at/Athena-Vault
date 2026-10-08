"use client";

import { useState, useSyncExternalStore } from "react";

const compactViewportQuery = "(max-width: 720px)";

function subscribeCompactViewport(onChange: () => void): () => void {
  const query = window.matchMedia(compactViewportQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getCompactViewportSnapshot(): boolean {
  return window.matchMedia(compactViewportQuery).matches;
}

/**
 * Decides whether a mobile disclosure should mount its children. Wide
 * viewports always mount so the transparent desktop DOM is unchanged, and the
 * server snapshot reports the desktop value so SSR markup keeps the children.
 * On compact viewports children mount lazily on first open, then stay mounted
 * so editors do not lose unsaved input when the disclosure is closed again.
 */
export function useMobileDisclosureChildren(isOpen: boolean): boolean {
  const isCompactViewport = useSyncExternalStore(subscribeCompactViewport, getCompactViewportSnapshot, () => false);
  const [hasOpened, setHasOpened] = useState(isOpen);
  if (isOpen && !hasOpened) {
    setHasOpened(true);
  }
  return !isCompactViewport || hasOpened;
}
