import { describe, expect, it } from "vitest";

import { hasLoginConnection, LOGIN_CONNECTED_STORAGE_KEY, markLoginConnected } from "./login-greeting";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("login greeting", () => {
  it("uses a browser-local marker for successful normal connections", () => {
    const storage = memoryStorage();

    expect(hasLoginConnection(storage)).toBe(false);
    markLoginConnected(storage);
    expect(storage.getItem(LOGIN_CONNECTED_STORAGE_KEY)).toBe("1");
    expect(hasLoginConnection(storage)).toBe(true);
  });

  it("fails closed when browser storage is unavailable", () => {
    const throwingStorage = {
      getItem: () => { throw new Error("storage unavailable"); },
      setItem: () => { throw new Error("storage unavailable"); },
    };

    expect(hasLoginConnection(throwingStorage)).toBe(false);
    expect(() => markLoginConnected(throwingStorage)).not.toThrow();
  });
});
