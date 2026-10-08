"use client";

import React, { useSyncExternalStore } from "react";

export const LOGIN_CONNECTED_STORAGE_KEY = "athena-vault:login-connected:v1";
const LOGIN_CONNECTED_CHANGE_EVENT = "athena-vault:login-connected-change";

type LoginStorageReader = Pick<Storage, "getItem">;
type LoginStorageWriter = Pick<Storage, "setItem">;

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function hasLoginConnection(storage: LoginStorageReader | null | undefined = browserStorage()): boolean {
  try {
    return storage?.getItem(LOGIN_CONNECTED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markLoginConnected(storage: LoginStorageWriter | null | undefined = browserStorage()): void {
  try {
    if (!storage) return;
    storage.setItem(LOGIN_CONNECTED_STORAGE_KEY, "1");
    if (typeof window !== "undefined") window.dispatchEvent(new window.Event(LOGIN_CONNECTED_CHANGE_EVENT));
  } catch {
    // Private browsing or a restrictive storage policy can disable localStorage.
  }
}

function subscribeLoginConnection(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  function handleStorage(event: StorageEvent): void {
    if (event.key === null || event.key === LOGIN_CONNECTED_STORAGE_KEY) onStoreChange();
  }
  window.addEventListener("storage", handleStorage);
  window.addEventListener(LOGIN_CONNECTED_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(LOGIN_CONNECTED_CHANGE_EVENT, onStoreChange);
  };
}

function getLoginConnectionSnapshot(): boolean {
  return hasLoginConnection();
}

function getLoginConnectionServerSnapshot(): boolean {
  return false;
}

export function LoginGreeting() {
  const returningVisitor = useSyncExternalStore(subscribeLoginConnection, getLoginConnectionSnapshot, getLoginConnectionServerSnapshot);

  return <p className="auth-card-eyebrow">{returningVisitor ? "Welcome back" : "Welcome"}</p>;
}
