import { describe, expect, it } from "vitest";
import { ownerDisplayLabel } from "./owner-presentation";

describe("owner greeting presentation", () => {
  it("prefers the display name and falls back to the email prefix", () => {
    expect(ownerDisplayLabel({ displayName: "Jack & Julie", email: "owner@athena-vault.local" })).toBe("Jack & Julie");
    expect(ownerDisplayLabel({ displayName: null, email: "owner@athena-vault.local" })).toBe("owner");
  });
});
